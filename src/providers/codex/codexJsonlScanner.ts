import { createReadStream } from 'node:fs';

import { CodexRuntimeManifestEntry } from './codexManifest';
import { readCodexZstdRange } from './codexZstd';
import { parseJsonObject } from './codexSchema';

// Cold rebuilds are dominated by JSON parsing and index bookkeeping rather
// than raw disk latency. A 1 MiB stream chunk keeps cancellation responsive
// while avoiding four callbacks for work that can safely be handled together.
export const CODEX_JSONL_CHUNK_BYTES = 1024 * 1024;
export const CODEX_MAX_JSONL_LINE_BYTES = 1024 * 1024;

export interface CodexJsonlCursor {
  offset: number;
  discardingOversizedLine: boolean;
}

export interface CodexJsonlReader {
  read(
    entry: CodexRuntimeManifestEntry,
    start: number,
    endExclusive: number,
    control?: { onReplayProgress(bytes: number): Promise<void> },
  ): AsyncIterable<Buffer>;
}

export interface CodexJsonlScanResult {
  cursor: CodexJsonlCursor;
  bytesRead: number;
  reachedEnd: boolean;
  oversizedLines: number;
  finalLineAccepted: boolean;
  finalLineDiscarded?: true;
}

export interface CodexJsonlChunkProgress {
  cursor: CodexJsonlCursor;
  bytesRead: number;
}

export const defaultCodexJsonlReader: CodexJsonlReader = {
  async *read(entry, start, endExclusive, control) {
    if (entry.compression === 'zstd') {
      yield* readCodexZstdRange(entry.absolutePath, start, endExclusive, entry.size, {
        expectedSource: { size: entry.storageSize!, mtimeMs: entry.mtimeMs,
          ctimeMs: entry.storageCtimeMs, dev: entry.dev, ino: entry.ino },
        onReplayProgress: control?.onReplayProgress,
      });
      return;
    }
    if (endExclusive <= start) {
      return;
    }
    const stream = createReadStream(entry.absolutePath, {
      start,
      end: endExclusive - 1,
      highWaterMark: CODEX_JSONL_CHUNK_BYTES,
    });
    for await (const chunk of stream) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  },
};

function snapshotCursor(
  offset: number,
  discardingOversizedLine: boolean,
): CodexJsonlCursor {
  return { offset, discardingOversizedLine };
}

export async function scanCodexJsonlLines(
  entry: CodexRuntimeManifestEntry,
  reader: CodexJsonlReader,
  cursor: CodexJsonlCursor,
  endExclusive: number,
  onLine: (line: string, endOffset: number) => void,
  onChunk?: (progress: CodexJsonlChunkProgress) => Promise<void>,
  maxLineBytes: number = CODEX_MAX_JSONL_LINE_BYTES,
  acceptFinalLine?: (line: string) => boolean,
): Promise<CodexJsonlScanResult> {
  const start = Math.max(0, cursor.offset);
  const end = Math.max(start, endExclusive);
  let readPosition = start;
  let safeOffset = start;
  let discarding = cursor.discardingOversizedLine;
  let pendingParts: Buffer[] = [];
  let pendingBytes = 0;
  let bytesRead = 0;
  let replayedBytes = 0;
  let oversizedLines = 0;
  let finalLineAccepted = false;

  for await (const rawChunk of reader.read(entry, start, end, {
    onReplayProgress: async bytes => {
      replayedBytes += bytes;
      await onChunk?.({ cursor: snapshotCursor(safeOffset, discarding), bytesRead: bytesRead + replayedBytes });
    },
  })) {
    if (readPosition >= end) {
      break;
    }
    const remaining = end - readPosition;
    const chunk = rawChunk.length > remaining
      ? rawChunk.subarray(0, remaining)
      : rawChunk;
    if (chunk.length === 0) {
      continue;
    }
    const chunkStart = readPosition;
    readPosition += chunk.length;
    bytesRead += chunk.length;
    let segmentStart = 0;

    while (segmentStart < chunk.length) {
      const newline = chunk.indexOf(0x0a, segmentStart);
      const segmentEnd = newline < 0 ? chunk.length : newline;
      const segment = chunk.subarray(segmentStart, segmentEnd);
      const absoluteSegmentEnd = chunkStart + segmentEnd;

      if (discarding) {
        safeOffset = absoluteSegmentEnd;
      } else if (pendingBytes + segment.length > maxLineBytes) {
        pendingParts = [];
        pendingBytes = 0;
        discarding = true;
        safeOffset = absoluteSegmentEnd;
      } else if (segment.length > 0) {
        pendingParts.push(segment);
        pendingBytes += segment.length;
      }

      if (newline < 0) {
        break;
      }

      const endOffset = chunkStart + newline + 1;
      if (discarding) {
        oversizedLines += 1;
        discarding = false;
      } else {
        let lineBuffer = pendingParts.length === 1
          ? pendingParts[0]
          : Buffer.concat(pendingParts, pendingBytes);
        if (lineBuffer[lineBuffer.length - 1] === 0x0d) {
          lineBuffer = lineBuffer.subarray(0, lineBuffer.length - 1);
        }
        onLine(lineBuffer.toString('utf8'), endOffset);
      }
      pendingParts = [];
      pendingBytes = 0;
      safeOffset = endOffset;
      segmentStart = newline + 1;
    }

    await onChunk?.({
      cursor: snapshotCursor(safeOffset, discarding),
      bytesRead: bytesRead + replayedBytes,
    });
  }

  const compressedEof = entry.compression === 'zstd' && end === entry.size && readPosition >= end;
  const finalAcceptor = acceptFinalLine ?? (compressedEof ? (line: string) => parseJsonObject(line) !== null : undefined);
  if (!discarding && pendingBytes > 0 && readPosition >= end && finalAcceptor) {
    let lineBuffer = pendingParts.length === 1
      ? pendingParts[0]
      : Buffer.concat(pendingParts, pendingBytes);
    if (lineBuffer[lineBuffer.length - 1] === 0x0d) {
      lineBuffer = lineBuffer.subarray(0, lineBuffer.length - 1);
    }
    const line = lineBuffer.toString('utf8');
    if (finalAcceptor(line)) {
      onLine(line, end);
      safeOffset = end;
      finalLineAccepted = true;
    }
  }

  // A validated compressed frame is immutable, unlike an active plain log.
  // Adjudicate its last record once; an invalid/oversized fragment cannot wait
  // for an append that will never arrive and force whole-frame replay forever.
  const finalLineDiscarded = compressedEof && !discarding && pendingBytes > 0 && !finalLineAccepted;
  if (compressedEof) {
    if (discarding) oversizedLines += 1;
    safeOffset = end;
    discarding = false;
  }

  return {
    cursor: snapshotCursor(safeOffset, discarding),
    bytesRead: bytesRead + replayedBytes,
    reachedEnd: readPosition >= end,
    oversizedLines,
    finalLineAccepted,
    ...(finalLineDiscarded ? { finalLineDiscarded: true as const } : {}),
  };
}
