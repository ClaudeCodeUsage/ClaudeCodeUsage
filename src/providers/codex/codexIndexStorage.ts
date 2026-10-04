import { createHmac } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { CodexIndexV3, normalizeCodexIndex, saveCodexIndexAtomic } from './codexIndex';
import { CodexManifest } from './codexManifest';
import { acquireCodexIndexLease } from './codexIndexLease';
import { appendCodexQuotaHistory } from './codexQuotaHistory';

const MAX_CHECKPOINT_BYTES = 256 * 1024 * 1024;

/** A source namespace is not an account identity and never enters UI/export. */
export function codexIndexStoragePath(
  storageDirectory: string, codexHome: string, salt: string, timeZone: string,
): string {
  const fingerprint = createHmac('sha256', salt)
    .update(JSON.stringify(['codex-index-source-v1', path.resolve(codexHome), timeZone]))
    .digest('hex');
  return path.join(storageDirectory, `codex-index-v1-${fingerprint}.json`);
}

/** Exact extension-owned families only; never accept a suffix such as .bak. */
export function codexIndexCanonicalName(name: string): string | null {
  const match = /^(codex-index-v1(?:-[a-f0-9]{64})?)(?:\.json(?:\.tmp-\d+-[a-f0-9-]{36})?|\.corrupt-\d+-\d+\.json)$/.exec(name);
  return match ? `${match[1]}.json` : null;
}

export async function codexIndexExists(indexPath: string): Promise<boolean> {
  try {
    const stat = await lstat(indexPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid Codex derived storage');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Fixed legacy input is read under its lease; atomic scoped checkpoints are read-only.
 * Ownership is metadata-only, never a source-body scan.
 * Every saved file must belong to this allowlisted manifest under the same salt.
 * Unprovable/deleted entries fail closed; the old cache is never modified. */
export async function readOwnedLegacyCodexIndex(
  legacyPath: string, manifest: CodexManifest, timeZone: string,
  readBudget?: { remainingBytes: number },
): Promise<CodexIndexV3 | null> {
  try {
    const stat = await lstat(legacyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CHECKPOINT_BYTES) return null;
    const handle = await open(legacyPath, 'r');
    let raw: any;
    try {
      const opened = await handle.stat();
      // Pin one atomic checkpoint, rejecting replacement between lstat/open.
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino ||
        opened.size > MAX_CHECKPOINT_BYTES ||
        (readBudget && opened.size > readBudget.remainingBytes)) return null;
      if (readBudget) readBudget.remainingBytes -= opened.size;
      raw = JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
    if (!raw || ![1, 2, 3].includes(raw.schemaVersion) || !raw.files ||
      typeof raw.files !== 'object' || Array.isArray(raw.files)) return null;
    const keys = Object.keys(raw.files);
    if (keys.length === 0 || !keys.every(key =>
      /^[a-f0-9]{64}$/.test(key) && Object.prototype.hasOwnProperty.call(manifest.persistable, key) &&
      raw.files[key]?.fileKey === key)) return null;
    const index = normalizeCodexIndex(raw);
    if (!index) return null;
    // Old shared containers may retain another home's root quota history.
    // Keep only observations attached to proven file contributions. Already
    // migrated P2 observations remain independent and are not erased.
    index.quotaHistory = appendCodexQuotaHistory([], Object.values(index.files)
      .flatMap(file => file.quotaHistory ?? []));
    return index;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readOwnedTimezoneCheckpoint(
  indexPath: string, manifest: CodexManifest, timeZone: string,
  source: { codexHome: string; salt: string }, shouldCancel: () => boolean,
): Promise<CodexIndexV3 | null> {
  const directory = path.dirname(indexPath);
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const candidates: { filePath: string; size: number; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!/^codex-index-v1-[a-f0-9]{64}\.json$/.test(name)) continue;
    const filePath = path.join(directory, name);
    if (filePath === indexPath) continue;
    try {
      const stat = await lstat(filePath);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_CHECKPOINT_BYTES) {
        candidates.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    } catch { /* An optional unreadable/retired checkpoint is not a source failure. */ }
  }
  const readBudget = { remainingBytes: MAX_CHECKPOINT_BYTES };
  for (const candidate of candidates.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 16)) {
    if (shouldCancel()) return null;
    if (candidate.size > readBudget.remainingBytes) continue;
    try {
      const index = await readOwnedLegacyCodexIndex(candidate.filePath, manifest, timeZone, readBudget);
      if (index?.coverage.complete && codexIndexStoragePath(directory, source.codexHome,
        source.salt, index.coverage.period.timeZone) === candidate.filePath) return index;
    } catch { /* Keep the optional input unchanged and try another bounded candidate. */ }
  }
  return null;
}

/** Caller holds the scoped lease; all writers use scoped -> legacy lock order. */
export async function adoptLegacyCodexIndex(
  indexPath: string, legacyPath: string, manifest: CodexManifest, timeZone: string,
  shouldCancel: () => boolean,
  source?: { codexHome: string; salt: string },
): Promise<CodexIndexV3 | null> {
  if (indexPath === legacyPath || await codexIndexExists(indexPath)) return null;
  // Atomic sibling reads never acquire another scoped lock or alter its file.
  // Reuse verified primary usage; updateCodexIndex owns targeted timezone work.
  const checkpoint = source ? await readOwnedTimezoneCheckpoint(indexPath, manifest,
    timeZone, source, shouldCancel) : null;
  if (checkpoint) {
    if (!shouldCancel()) await saveCodexIndexAtomic(indexPath, checkpoint);
    return checkpoint;
  }
  const lease = await acquireCodexIndexLease(legacyPath, { shouldCancel });
  try {
    const index = await readOwnedLegacyCodexIndex(legacyPath, manifest, timeZone);
    if (index && !shouldCancel()) await saveCodexIndexAtomic(indexPath, index);
    return index;
  } finally { await lease.release(); }
}
