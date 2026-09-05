import { createHmac } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import * as path from 'node:path';

export type CodexSourceArea = 'sessions' | 'archive';

export interface CodexPersistedManifestEntry {
  fileKey: string;
  sourceArea: CodexSourceArea;
  size: number;
  mtimeMs: number;
  dev?: number;
  ino?: number;
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
  return createHmac('sha256', salt).update(absolutePath).digest('hex');
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
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkAllowlistedDirectory(absolutePath, sourceArea, salt, output);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue;
    }
    try {
      const fileStat = await lstat(absolutePath);
      if (!fileStat.isFile()) {
        continue;
      }
      const fileKey = pseudonymousFileKey(salt, absolutePath);
      output.push({
        fileKey,
        absolutePath,
        nonPersisted: true,
        sourceArea,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        dev: fileStat.dev > 0 ? fileStat.dev : undefined,
        ino: fileStat.ino > 0 ? fileStat.ino : undefined,
      });
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
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
    if (stableIdentityChanged(before, after)) {
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
    } else {
      result.added.push(currentKey);
    }
  }

  result.removed = Object.keys(previous)
    .filter((key) => !consumedPrevious.has(key))
    .sort();
  return result;
}
