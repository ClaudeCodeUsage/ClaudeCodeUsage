import { createReadStream } from 'node:fs';

import { CodexRuntimeManifestEntry } from './codexManifest';

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
  ): AsyncIterable<Buffer>;
}

export interface CodexJsonlScanResult {
  cursor: CodexJsonlCursor;
  bytesRead: number;
  reachedEnd: boolean;
  oversizedLines: number;
}

export interface CodexJsonlChunkProgress {
  cursor: CodexJsonlCursor;
  bytesRead: number;
}

export const defaultCodexJsonlReader: CodexJsonlReader = {
  async *read(entry, start, endExclusive) {
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
): Promise<CodexJsonlScanResult> {
  const start = Math.max(0, cursor.offset);
  const end = Math.max(start, endExclusive);
  let readPosition = start;
  let safeOffset = start;
  let discarding = cursor.discardingOversizedLine;
  let pendingParts: Buffer[] = [];
  let pendingBytes = 0;
  let bytesRead = 0;
  let oversizedLines = 0;

  for await (const rawChunk of reader.read(entry, start, end)) {
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
      bytesRead,
    });
  }

  return {
    cursor: snapshotCursor(safeOffset, discarding),
    bytesRead,
    reachedEnd: readPosition >= end,
    oversizedLines,
  };
}
