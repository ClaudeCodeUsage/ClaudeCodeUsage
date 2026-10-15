import { open, lstat } from 'node:fs/promises';
import { constants, Stats } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';

/** Max bytes needed to inspect any RFC 8878 frame header, including magic. */
export const CODEX_ZSTD_HEADER_BYTES = 18;

/** Hard per-call ceilings. Options may reduce, but never increase these bounds. */
export const CODEX_ZSTD_LIMITS = Object.freeze({
  chunkBytes: 64 * 1024,
  maxChunkBytes: 1024 * 1024,
  maxDecodedBytes: 4 * 1024 ** 3,
  maxWindowBytes: 64 * 1024 * 1024,
  maxCompressedBytes: 2 * 1024 ** 3,
  maxReplayBytes: 4 * 1024 ** 3,
});

export interface CodexZstdHeader {
  decodedSize: number;
  windowSize: number;
  hasChecksum: boolean;
  singleSegment: boolean;
  headerSize: number;
}

export interface CodexZstdReadOptions {
  /** 64 bytes to 1 MiB; bounds compressed reads and emitted decoded chunks. */
  chunkBytes?: number;
  maxDecodedBytes?: number;
  maxWindowBytes?: number;
  maxCompressedBytes?: number;
  /** Maximum discarded decoded prefix (start). Resuming always replays from byte zero. */
  maxReplayBytes?: number;
  signal?: AbortSignal;
  /** Awaited prefix byte DELTAS, each <= chunkBytes; callback errors propagate unchanged. */
  onReplayProgress?: (decodedPrefixBytes: number) => Promise<void>;
  expectedSource?: {
    size: number;
    mtimeMs: number;
    ctimeMs?: number;
    dev?: number;
    ino?: number;
  };
}

export type CodexZstdErrorCode =
  | 'codec-unavailable' | 'unknown-size' | 'dictionary' | 'reserved' | 'malformed'
  | 'size-limit' | 'replay-limit' | 'invalid-range' | 'invalid-options'
  | 'size-mismatch' | 'trailing-data' | 'truncated' | 'decode-failed' | 'io-error' | 'aborted'
  | 'source-changed';

/** Safe for diagnostics: no source path, decoded contents or native error payload. */
export class CodexZstdError extends Error {
  constructor(readonly code: CodexZstdErrorCode) {
    super(`Codex Zstd: ${code}`);
    this.name = 'CodexZstdError';
  }
}

/**
 * RFC 8878 §3.1.1.1. Header metadata only: this does NOT establish frame/body
 * validity, checksum integrity, or absence of concatenated/trailing frames.
 * Callers may supply just the header or a longer prefix. Unknown sizes and all
 * dictionary-ID fields (including zero) are deliberately unsupported.
 */
export function inspectCodexZstdHeader(buffer: Buffer): CodexZstdHeader {
  if (buffer.length < 5 || buffer.readUInt32LE(0) !== 0xfd2fb528) {
    throw new CodexZstdError('malformed');
  }
  const descriptor = buffer[4];
  if (descriptor & 0x08) throw new CodexZstdError('reserved');
  // Bit 4 is unused: RFC requires decoders to ignore it.
  const singleSegment = Boolean(descriptor & 0x20);
  const sizeFlag = descriptor >>> 6;
  const sizeBytes = sizeFlag === 0 ? (singleSegment ? 1 : 0) : 2 ** sizeFlag;
  const dictionaryBytes = [0, 1, 2, 4][descriptor & 3];
  const sizeOffset = 5 + (singleSegment ? 0 : 1) + dictionaryBytes;
  const headerSize = sizeOffset + sizeBytes;
  if (buffer.length < headerSize) throw new CodexZstdError('malformed');
  if (dictionaryBytes) throw new CodexZstdError('dictionary');
  if (!sizeBytes) throw new CodexZstdError('unknown-size');
  const size = sizeBytes === 8
    ? buffer.readBigUInt64LE(sizeOffset)
    : BigInt(buffer.readUIntLE(sizeOffset, sizeBytes) + (sizeBytes === 2 ? 256 : 0));
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new CodexZstdError('size-limit');
  const decodedSize = Number(size);
  const windowBase = 2 ** (10 + (buffer[5] >>> 3));
  const windowSize = singleSegment ? decodedSize : windowBase * (1 + (buffer[5] & 7) / 8);
  return { decodedSize, windowSize, hasChecksum: Boolean(descriptor & 4), singleSegment, headerSize };
}

/** Namespace access is safe on Node 20, which has no Zstd named exports. */
export function supportsCodexZstd(): boolean {
  return typeof zlib.createZstdDecompress === 'function' &&
    typeof zlib.constants.ZSTD_d_windowLogMax === 'number';
}

function boundedOption(value: number | undefined, fallback: number, ceiling = fallback, minimum = 0): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > ceiling) {
    throw new CodexZstdError('invalid-options');
  }
  return result;
}

/**
 * Read [start, end) in DECODED byte coordinates, without modifying the source
 * or materializing a decoded file. Each call starts at the compressed beginning;
 * maxReplayBytes bounds the discarded prefix, maxDecodedBytes the entire frame.
 *
 * Partial ranges intentionally cancel both streams: their unread suffix and
 * checksum are NOT verified. Full ranges (including empty frames/end ranges)
 * consume decoder EOF and validate exact length and a single frame. Yielded
 * bytes remain provisional until successful iterator completion. A consumer
 * break/return is cancellation, never evidence of a verified full frame.
 * AbortSignal interrupts active reads; always close an abandoned iterator.
 *
 * Native API: Node 22.16 zlib ZstdOptions/ZSTD_d_windowLogMax; do not use relaxed
 * finishFlush or maxOutputLength (the latter only bounds convenience methods).
 */
export async function* readCodexZstdRange(
  path: string, start: number, end: number, expectedDecodedSize: number,
  options: CodexZstdReadOptions = {},
): AsyncGenerator<Buffer> {
  if (!supportsCodexZstd()) throw new CodexZstdError('codec-unavailable');
  if (![start, end, expectedDecodedSize].every(n => Number.isSafeInteger(n) && n >= 0)
    || start > end || end > expectedDecodedSize) throw new CodexZstdError('invalid-range');
  const limits = CODEX_ZSTD_LIMITS;
  const chunkBytes = boundedOption(options.chunkBytes, limits.chunkBytes, limits.maxChunkBytes, 64);
  const maxDecoded = boundedOption(options.maxDecodedBytes, limits.maxDecodedBytes);
  const maxWindow = boundedOption(options.maxWindowBytes, limits.maxWindowBytes);
  const maxCompressed = boundedOption(options.maxCompressedBytes, limits.maxCompressedBytes);
  const maxReplay = boundedOption(options.maxReplayBytes, limits.maxReplayBytes);
  if (expectedDecodedSize > maxDecoded) throw new CodexZstdError('size-limit');
  if (start > maxReplay) throw new CodexZstdError('replay-limit');
  const checkAbort = () => {
    if (options.signal?.aborted) throw new CodexZstdError('aborted');
  };
  checkAbort();
  const before = await lstat(path).catch(() => { throw new CodexZstdError('io-error'); });
  if (!before.isFile() || before.isSymbolicLink()) throw new CodexZstdError('source-changed');
  // NONBLOCK also avoids hanging on a FIFO substituted between lstat/open.
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    .catch(() => { throw new CodexZstdError('io-error'); });
  // Classify at the filesystem boundary, before pipeline can forward the same
  // rejection as a decoder error. Temporary EIO must never poison a version.
  const readSource = (buffer: Buffer, offset: number, length: number, position: number) =>
    file.read(buffer, offset, length, position).catch(() => { throw new CodexZstdError('io-error'); });
  const statSource = () => file.stat().catch(() => { throw new CodexZstdError('io-error'); });
  let source: Readable | undefined;
  let decoder: zlib.ZstdDecompress | undefined;
  let completion: Promise<void> | undefined;
  let streamError: unknown;
  let snapshot: Stats | undefined;
  let failed = false;
  let fullyConsumed = false;
  let replayCallbackFailed = false;
  const cancellation = new AbortController();
  const sameSource = (actual: Stats, expected: NonNullable<CodexZstdReadOptions['expectedSource']>) =>
    actual.isFile() && (['size', 'mtimeMs', 'ctimeMs', 'dev', 'ino'] as const)
      .every(key => expected[key] === undefined || actual[key] === expected[key]);
  const abort = () => {
    cancellation.abort();
    const error = new CodexZstdError('aborted');
    source?.destroy(error);
    decoder?.destroy(error);
  };
  try {
    checkAbort();
    const stat = await statSource();
    if (!sameSource(stat, before) || (options.expectedSource && !sameSource(stat, options.expectedSource))) {
      throw new CodexZstdError('source-changed');
    }
    snapshot = stat;
    if (stat.size > maxCompressed) throw new CodexZstdError('size-limit');
    const prefix = Buffer.alloc(CODEX_ZSTD_HEADER_BYTES);
    let prefixBytes = 0;
    while (prefixBytes < prefix.length) {
      checkAbort();
      const { bytesRead } = await readSource(prefix, prefixBytes, prefix.length - prefixBytes, prefixBytes);
      if (!bytesRead) break;
      prefixBytes += bytesRead;
    }
    const header = inspectCodexZstdHeader(prefix.subarray(0, prefixBytes));
    if (header.decodedSize !== expectedDecodedSize) throw new CodexZstdError('size-mismatch');
    if (header.windowSize > maxWindow) throw new CodexZstdError('size-limit');

    // Parse only the frame envelope, not compressed contents. This bounded
    // input generator prevents a second frame (even zero-output/skippable) from
    // reaching the decoder: native EOF alone may silently ignore trailing data.
    let position = header.headerSize;
    let frameComplete = false;
    const exact = async (size: number): Promise<Buffer> => {
      if (position + size > maxCompressed) throw new CodexZstdError('size-limit');
      const buffer = Buffer.allocUnsafe(size);
      let offset = 0;
      while (offset < size) {
        checkAbort();
        const { bytesRead } = await readSource(buffer, offset, size - offset, position);
        if (!bytesRead) throw new CodexZstdError('truncated');
        offset += bytesRead;
        position += bytesRead;
      }
      return buffer;
    };
    async function* compressedChunks(): AsyncGenerator<Buffer> {
      yield prefix.subarray(0, header.headerSize);
      let last = false;
      while (!last) {
        const block = await exact(3);
        const bits = block.readUIntLE(0, 3);
        last = Boolean(bits & 1);
        const kind = (bits >>> 1) & 3;
        const size = bits >>> 3;
        if (kind === 3 || size > Math.min(header.windowSize, 128 * 1024)) {
          throw new CodexZstdError('malformed');
        }
        yield block;
        let remaining = kind === 1 ? 1 : size;
        while (remaining > 0) {
          const length = Math.min(remaining, chunkBytes);
          yield await exact(length);
          remaining -= length;
        }
      }
      if (header.hasChecksum) yield await exact(4);
      checkAbort();
      const tail = Buffer.alloc(1);
      if ((await readSource(tail, 0, 1, position)).bytesRead) throw new CodexZstdError('trailing-data');
      frameComplete = true;
    }

    const decoderOptions = {
      chunkSize: chunkBytes,
      readableHighWaterMark: chunkBytes,
      writableHighWaterMark: chunkBytes,
      params: {
        // Native minimum is 1 KiB. The exact requested ceiling was checked above;
        // rounding up never exceeds our power-of-two hard window ceiling.
        [zlib.constants.ZSTD_d_windowLogMax]: Math.max(10, Math.ceil(Math.log2(Math.max(1, maxWindow)))),
      },
    };
    decoder = zlib.createZstdDecompress(decoderOptions);
    source = Readable.from(compressedChunks(), { objectMode: false, highWaterMark: chunkBytes });
    // Install rejection handling immediately: input/decode errors may precede next().
    completion = pipeline(source, decoder, { signal: cancellation.signal }).catch(error => { streamError = error; });
    options.signal?.addEventListener('abort', abort, { once: true });
    checkAbort();
    let decoded = 0;
    for await (const value of decoder) {
      checkAbort();
      const chunk = value as Buffer;
      const next = decoded + chunk.length;
      if (next > maxDecoded) throw new CodexZstdError('size-limit');
      if (next > expectedDecodedSize) throw new CodexZstdError('size-mismatch');
      const prefixLength = Math.max(0, Math.min(next, start) - decoded);
      if (options.onReplayProgress) {
        for (let offset = 0; offset < prefixLength; offset += chunkBytes) {
          checkAbort();
          try {
            await options.onReplayProgress(Math.min(chunkBytes, prefixLength - offset));
          } catch (error) {
            replayCallbackFailed = true;
            throw error;
          }
          checkAbort();
        }
      }
      const from = Math.max(start - decoded, 0);
      const to = Math.min(end - decoded, chunk.length);
      for (let offset = from; offset < to; offset += chunkBytes) {
        checkAbort();
        yield chunk.subarray(offset, Math.min(offset + chunkBytes, to));
      }
      decoded = next;
      // Only an explicitly partial range may stop before native end/checksum.
      if (end < expectedDecodedSize && decoded >= end) return;
    }
    await completion;
    checkAbort();
    if (streamError) throw streamError;
    if (!frameComplete) throw new CodexZstdError('truncated');
    if (decoded !== expectedDecodedSize) throw new CodexZstdError('size-mismatch');
    fullyConsumed = true;
  } catch (error) {
    failed = true;
    if (replayCallbackFailed) throw error;
    if (options.signal?.aborted) throw new CodexZstdError('aborted');
    if (error instanceof CodexZstdError) throw error;
    throw new CodexZstdError('decode-failed');
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (!fullyConsumed) cancellation.abort();
    source?.destroy();
    decoder?.destroy();
    await completion;
    try {
      if (!failed && snapshot) {
        const after = await statSource();
        const named = await lstat(path).catch(() => { throw new CodexZstdError('source-changed'); });
        if (!sameSource(after, snapshot) || !sameSource(named, snapshot) || named.isSymbolicLink()) {
          throw new CodexZstdError('source-changed');
        }
      }
    } finally {
      await file.close().catch(() => { throw new CodexZstdError('io-error'); });
    }
  }
}
