import { createHmac } from 'node:crypto';
import { constants, Stats } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { CODEX_ZSTD_LIMITS, CodexZstdError, inspectCodexZstdHeader } from './codexZstd';

export type CodexSourceArea = 'sessions' | 'archive';

export interface CodexPersistedManifestEntry {
  fileKey: string;
  sourceArea: CodexSourceArea;
  size: number;
  mtimeMs: number;
  dev?: number;
  ino?: number;
  compression?: 'zstd';
  storageSize?: number;
  storageCtimeMs?: number;
}

export type CodexPersistedManifest = Record<
  string,
  CodexPersistedManifestEntry
>;

export interface CodexRuntimeManifestEntry
  extends CodexPersistedManifestEntry {
  absolutePath: string;
  nonPersisted: true;
}

export interface CodexManifest {
  files: CodexRuntimeManifestEntry[];
  persistable: CodexPersistedManifest;
}

export interface CodexManifestDiff {
  unchanged: string[];
  appended: string[];
  truncated: string[];
  replaced: string[];
  moved: Array<{ fromKey: string; toKey: string }>;
  added: string[];
  removed: string[];
}

export function resolveCodexHome(
  customDirectory: string,
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
): string {
  const custom = customDirectory.trim();
  if (custom) {
    return path.resolve(custom);
  }
  const configured = environment.CODEX_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(homeDirectory, '.codex');
}

export function pseudonymousFileKey(
  salt: string,
  absolutePath: string,
): string {
  const canonicalPath = absolutePath.endsWith('.jsonl.zst')
    ? absolutePath.slice(0, -4)
    : absolutePath;
  return createHmac('sha256', salt).update(canonicalPath).digest('hex');
}

function samePhysicalFile(expected: Stats, actual: Stats): boolean {
  return actual.isFile() && expected.dev === actual.dev && expected.ino === actual.ino &&
    expected.size === actual.size && expected.mtimeMs === actual.mtimeMs &&
    expected.ctimeMs === actual.ctimeMs;
}

async function compressedLogicalSize(absolutePath: string, expected: Stats): Promise<number> {
  try {
    // NOFOLLOW prevents a final-component symlink race; NONBLOCK lets fstat reject
    // a replacement FIFO without hanging. No body decompression occurs here.
    const handle = await open(absolutePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      if (!samePhysicalFile(expected, await handle.stat())) {
        throw new Error('source-changed');
      }
      const header = Buffer.alloc(18);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== Math.min(expected.size, header.length) ||
          !samePhysicalFile(expected, await handle.stat())) {
        throw new Error('source-changed');
      }
      const frame = inspectCodexZstdHeader(header.subarray(0, bytesRead));
      if (frame.decodedSize > CODEX_ZSTD_LIMITS.maxDecodedBytes ||
          frame.windowSize > CODEX_ZSTD_LIMITS.maxWindowBytes ||
          expected.size > CODEX_ZSTD_LIMITS.maxCompressedBytes) throw new CodexZstdError('size-limit');
      return frame.decodedSize;
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Native filesystem errors carry paths. Only the codec's safe typed errors
    // cross this boundary; never return a partial census after a header failure.
    if (error instanceof CodexZstdError) throw error;
    throw new Error('Codex compressed source inspection failed');
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function walkAllowlistedDirectory(
  directory: string,
  sourceArea: CodexSourceArea,
  salt: string,
  output: CodexRuntimeManifestEntry[],
): Promise<void> {
  try {
    const directoryStat = await lstat(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      return;
    }
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const candidates: Array<{ absolutePath: string; fileStat: Stats; compressed: boolean }> = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkAllowlistedDirectory(absolutePath, sourceArea, salt, output);
      continue;
    }
    const compressed = entry.name.endsWith('.jsonl.zst');
    if (!entry.isFile() || (!entry.name.endsWith('.jsonl') && !compressed)) {
      continue;
    }
    try {
      const fileStat = await lstat(absolutePath);
      if (!fileStat.isFile()) {
        continue;
      }
      candidates.push({ absolutePath, fileStat, compressed });
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }
  // Select from validated regular files before inspecting compressed headers.
  // Plain wins regardless of readdir order; this is not an equivalence claim.
  const plainPaths = new Set(candidates.filter(file => !file.compressed).map(file => file.absolutePath));
  for (const { absolutePath, fileStat, compressed } of candidates) {
    if (compressed && plainPaths.has(absolutePath.slice(0, -4))) continue;
    output.push({
      fileKey: pseudonymousFileKey(salt, absolutePath),
      absolutePath,
      nonPersisted: true,
      sourceArea,
      size: compressed ? await compressedLogicalSize(absolutePath, fileStat) : fileStat.size,
      ...(compressed ? {
        compression: 'zstd' as const,
        storageSize: fileStat.size,
        storageCtimeMs: fileStat.ctimeMs,
      } : {}),
      mtimeMs: fileStat.mtimeMs,
      dev: fileStat.dev > 0 ? fileStat.dev : undefined,
      ino: fileStat.ino > 0 ? fileStat.ino : undefined,
    });
  }
}

export async function scanCodexManifest(
  codexHome: string,
  salt: string,
): Promise<CodexManifest> {
  const files: CodexRuntimeManifestEntry[] = [];
  await walkAllowlistedDirectory(
    path.join(codexHome, 'sessions'),
    'sessions',
    salt,
    files,
  );
  await walkAllowlistedDirectory(
    path.join(codexHome, 'archived_sessions'),
    'archive',
    salt,
    files,
  );
  files.sort((left, right) => left.absolutePath.localeCompare(right.absolutePath));

  const persistable: CodexPersistedManifest = {};
  for (const file of files) {
    persistable[file.fileKey] = {
      fileKey: file.fileKey,
      sourceArea: file.sourceArea,
      size: file.size,
      mtimeMs: file.mtimeMs,
      dev: file.dev,
      ino: file.ino,
      ...(file.compression ? {
        compression: file.compression,
        storageSize: file.storageSize,
        storageCtimeMs: file.storageCtimeMs,
      } : {}),
    };
  }
  return { files, persistable };
}

function stableIdentityMatches(
  left: CodexPersistedManifestEntry,
  right: CodexPersistedManifestEntry,
): boolean {
  return (
    (left.dev ?? 0) > 0 &&
    (left.ino ?? 0) > 0 &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function stableIdentityChanged(
  left: CodexPersistedManifestEntry,
  right: CodexPersistedManifestEntry,
): boolean {
  const comparable =
    (left.dev ?? 0) > 0 &&
    (left.ino ?? 0) > 0 &&
    (right.dev ?? 0) > 0 &&
    (right.ino ?? 0) > 0;
  return comparable && !stableIdentityMatches(left, right);
}

function representationChanged(
  before: CodexPersistedManifestEntry,
  after: CodexPersistedManifestEntry,
): boolean {
  return before.compression !== after.compression ||
    before.storageSize !== after.storageSize ||
    before.storageCtimeMs !== after.storageCtimeMs ||
    // Decoded offsets are never append/truncate evidence for a changed frame.
    ((before.compression === 'zstd' || after.compression === 'zstd') &&
      (before.size !== after.size || before.mtimeMs !== after.mtimeMs));
}

export function diffCodexManifest(
  previous: CodexPersistedManifest,
  current: CodexPersistedManifest,
): CodexManifestDiff {
  const result: CodexManifestDiff = {
    unchanged: [],
    appended: [],
    truncated: [],
    replaced: [],
    moved: [],
    added: [],
    removed: [],
  };
  const consumedPrevious = new Set<string>();
  const unmatchedCurrent: string[] = [];

  for (const key of Object.keys(current).sort()) {
    const before = previous[key];
    const after = current[key];
    if (!before) {
      unmatchedCurrent.push(key);
      continue;
    }
    consumedPrevious.add(key);
    if (representationChanged(before, after) || stableIdentityChanged(before, after)) {
      result.replaced.push(key);
    } else if (before.size === after.size && before.mtimeMs === after.mtimeMs) {
      result.unchanged.push(key);
    } else if (after.size > before.size) {
      result.appended.push(key);
    } else if (after.size < before.size) {
      result.truncated.push(key);
    } else {
      result.replaced.push(key);
    }
  }

  for (const currentKey of unmatchedCurrent) {
    const after = current[currentKey];
    const movedFrom = Object.keys(previous)
      .sort()
      .find(
        (previousKey) =>
          !consumedPrevious.has(previousKey) &&
          stableIdentityMatches(previous[previousKey], after),
      );
    if (movedFrom) {
      consumedPrevious.add(movedFrom);
      result.moved.push({ fromKey: movedFrom, toKey: currentKey });
      // Preserve move identity, but force a rebuild when compressed evidence
      // changed (including rename's ctime); moving does not prove byte equality.
      if (representationChanged(previous[movedFrom], after)) {
        result.replaced.push(currentKey);
      }
    } else {
      result.added.push(currentKey);
    }
  }

  result.removed = Object.keys(previous)
    .filter((key) => !consumedPrevious.has(key))
    .sort();
  return result;
}
