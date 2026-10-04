import { createHmac } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { CodexIndexV3, normalizeCodexIndex, saveCodexIndexAtomic } from './codexIndex';
import { CodexManifest } from './codexManifest';
import { acquireCodexIndexLease } from './codexIndexLease';
import { appendCodexQuotaHistory } from './codexQuotaHistory';

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

/** Caller holds the legacy lease. Ownership is metadata-only, never a body scan.
 * Every saved file must belong to this allowlisted manifest under the same salt.
 * Unprovable/deleted entries fail closed; the old cache is never modified. */
export async function readOwnedLegacyCodexIndex(
  legacyPath: string, manifest: CodexManifest, timeZone: string,
): Promise<CodexIndexV3 | null> {
  try {
    const stat = await lstat(legacyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 * 1024) return null;
    const raw = JSON.parse(await readFile(legacyPath, 'utf8'));
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

/** Caller holds the scoped lease; all writers use scoped -> legacy lock order. */
export async function adoptLegacyCodexIndex(
  indexPath: string, legacyPath: string, manifest: CodexManifest, timeZone: string,
  shouldCancel: () => boolean,
): Promise<CodexIndexV3 | null> {
  if (indexPath === legacyPath || await codexIndexExists(indexPath)) return null;
  const lease = await acquireCodexIndexLease(legacyPath, { shouldCancel });
  try {
    const index = await readOwnedLegacyCodexIndex(legacyPath, manifest, timeZone);
    if (index && !shouldCancel()) await saveCodexIndexAtomic(indexPath, index);
    return index;
  } finally { await lease.release(); }
}
