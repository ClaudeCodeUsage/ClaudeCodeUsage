import * as fs from 'node:fs';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export interface UsageFileFingerprint {
  path: string;
  size: number;
  mtimeMs: number;
  /** Original v2.2.0 recursive discovery position; tie ordering depends on it. */
  discoveryIndex: number;
  dev?: number;
  ino?: number;
}

export interface UsageManifest {
  entries: ReadonlyMap<string, UsageFileFingerprint>;
  scannedAtMs: number;
  scanDurationMs: number;
}

export interface ManifestDelta {
  changed: UsageFileFingerprint[];
  reused: UsageFileFingerprint[];
  removed: UsageFileFingerprint[];
}

export function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

export interface UsageFileSystem {
  readdir(dir: string): Promise<fs.Dirent[]>;
  stat(filePath: string): Promise<fs.Stats>;
}

const DEFAULT_USAGE_FILE_SYSTEM: UsageFileSystem = {
  readdir: (dir) => fs.promises.readdir(dir, { withFileTypes: true }),
  stat: (filePath) => fs.promises.stat(filePath),
};

async function walkJsonl(
  dir: string,
  output: string[],
  io: UsageFileSystem,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await io.readdir(dir);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonl(fullPath, output, io);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      output.push(fullPath);
    }
  }
}

export async function scanUsageManifest(
  dataRoots: readonly string[],
  io: UsageFileSystem = DEFAULT_USAGE_FILE_SYSTEM,
): Promise<UsageManifest> {
  const started = performance.now();
  const paths: string[] = [];
  for (const root of dataRoots) {
    await walkJsonl(path.join(root, 'projects'), paths, io);
  }
  const entries = new Map<string, UsageFileFingerprint>();
  for (const [discoveryIndex, filePath] of paths.entries()) {
    try {
      const fileStat = await io.stat(filePath);
      const hasStableIdentity = fileStat.dev > 0 && fileStat.ino > 0;
      entries.set(filePath, {
        path: filePath,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        discoveryIndex,
        dev: hasStableIdentity ? fileStat.dev : undefined,
        ino: hasStableIdentity ? fileStat.ino : undefined,
      });
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }
  return {
    entries,
    scannedAtMs: Date.now(),
    scanDurationMs: performance.now() - started,
  };
}

export function sameFingerprint(
  a: UsageFileFingerprint,
  b: UsageFileFingerprint,
): boolean {
  const identityComparable = (a.dev ?? 0) > 0 && (a.ino ?? 0) > 0 &&
    (b.dev ?? 0) > 0 && (b.ino ?? 0) > 0;
  return a.path === b.path && a.size === b.size && a.mtimeMs === b.mtimeMs &&
    (!identityComparable || (a.dev === b.dev && a.ino === b.ino));
}

export function diffUsageManifests(
  previous: UsageManifest | null,
  current: UsageManifest,
): ManifestDelta {
  if (!previous) {
    return { changed: [...current.entries.values()], reused: [], removed: [] };
  }
  const changed: UsageFileFingerprint[] = [];
  const reused: UsageFileFingerprint[] = [];
  for (const entry of current.entries.values()) {
    const old = previous.entries.get(entry.path);
    (old && sameFingerprint(old, entry) ? reused : changed).push(entry);
  }
  const removed = [...previous.entries.values()].filter((entry) => !current.entries.has(entry.path));
  return { changed, reused, removed };
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit must be a positive integer');
  }
  const output = new Array<R>(values.length);
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < values.length) {
      const index = next++;
      output[index] = await worker(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return output;
}

function timestampFromLine(line: string): number | null {
  if (line.trim() === '') return null;
  try {
    const value = JSON.parse(line) as { timestamp?: unknown };
    if (typeof value.timestamp !== 'string') return null;
    const timestampMs = Date.parse(value.timestamp);
    return Number.isNaN(timestampMs) ? null : timestampMs;
  } catch {
    return null;
  }
}

export async function readEarliestTimestamp(
  filePath: string,
): Promise<{ timestampMs: number; bytesRead: number }> {
  const MAX_COMPLETED_INVALID_PREFIX_BYTES = 1024 * 1024;
  const stream = fs.createReadStream(filePath, {
    highWaterMark: 4096,
    start: 0,
  });
  const decoder = new StringDecoder('utf8');
  let lineParts: string[] = [];
  let bytesRead = 0;
  let completedInvalidBytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      bytesRead += buffer.byteLength;
      const pieces = decoder.write(buffer).split('\n');
      lineParts.push(pieces.shift()!);
      while (pieces.length > 0) {
        const line = lineParts.join('').replace(/\r$/, '');
        lineParts = [pieces.shift()!];
        const timestampMs = timestampFromLine(line);
        if (timestampMs !== null) return { timestampMs, bytesRead };
        completedInvalidBytes += Buffer.byteLength(`${line}\n`, 'utf8');
        if (completedInvalidBytes > MAX_COMPLETED_INVALID_PREFIX_BYTES) {
          const error = new Error('invalid timestamp prefix limit exceeded');
          error.name = 'TimestampProbeLimitError';
          throw error;
        }
      }
    }
    const finalDecoded = decoder.end();
    if (finalDecoded !== '') lineParts.push(finalDecoded);
    const pending = lineParts.join('');
    const finalTimestamp = timestampFromLine(pending);
    if (finalTimestamp !== null) return { timestampMs: finalTimestamp, bytesRead };
    completedInvalidBytes += Buffer.byteLength(pending, 'utf8');
    if (completedInvalidBytes > MAX_COMPLETED_INVALID_PREFIX_BYTES) {
      const error = new Error('invalid timestamp prefix limit exceeded');
      error.name = 'TimestampProbeLimitError';
      throw error;
    }
    return { timestampMs: 0, bytesRead };
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

export async function sortUsageFilesByEarliestTimestamp(
  entries: readonly UsageFileFingerprint[],
): Promise<{ files: string[]; bytesRead: number }> {
  const stamped = await mapWithConcurrency(entries, 8, async (entry) => ({
    file: entry.path,
    discoveryIndex: entry.discoveryIndex,
    ...(await readEarliestTimestamp(entry.path)),
  }));
  stamped.sort((a, b) =>
    a.timestampMs - b.timestampMs || a.discoveryIndex - b.discoveryIndex,
  );
  return {
    files: stamped.map((item) => item.file),
    bytesRead: stamped.reduce((sum, item) => sum + item.bytesRead, 0),
  };
}
