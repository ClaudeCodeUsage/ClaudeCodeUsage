import type { CodexFileAggregate } from './providers/codex/codexIndex';
import type { ProviderTokenCounts } from './providers/providerTypes';

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = ['inputTotal', 'cachedInput', 'cacheWriteInput', 'outputTotal', 'reasoningOutput', 'sourceTotal'] as const;

/** Counter subsets never become additional processed Tokens. */
export function validAchievementTokenVector(value: unknown): value is ProviderTokenCounts {
  return object(value) && count(value.inputTotal) && count(value.outputTotal) &&
    count(value.inputTotal + value.outputTotal) &&
    fields.every(field => value[field] === undefined || count(value[field])) &&
    (value.cachedInput === undefined || (value.cachedInput as number) <= value.inputTotal) &&
    (value.reasoningOutput === undefined || (value.reasoningOutput as number) <= value.outputTotal);
}

export function validAchievementBuckets(value: unknown, total: ProviderTokenCounts): boolean {
  if (!object(value) || !validAchievementTokenVector(total)) return false;
  const sums: Partial<Record<typeof fields[number], number>> = {};
  for (const row of Object.values(value)) {
    if (!validAchievementTokenVector(row)) return false;
    for (const field of fields) {
      const next = (sums[field] ?? 0) + (row[field] ?? 0);
      if (!count(next) || (total[field] !== undefined && next > total[field]!)) return false;
      sums[field] = next;
    }
  }
  return true;
}

/**
 * Input is the host's canonical, already-reconciled snapshot. Census every
 * identity before selecting: conflicting copies and all their descendants are
 * withheld, but an unrelated sound lineage keeps its positive evidence.
 * The caller still requires a complete current manifest/index: undiscovered
 * files could otherwise invalidate identity uniqueness. No I/O or extra scan.
 */
export function verifiedCodexAchievementFiles(files: readonly CodexFileAggregate[]): CodexFileAggregate[] {
  const bySession = new Map<string, CodexFileAggregate>();
  const conflicting = new Set<string>();
  for (const file of files) {
    const key = file?.session?.sessionKey;
    if (typeof key !== 'string' || !key.trim()) continue;
    if (bySession.has(key)) conflicting.add(key);
    bySession.set(key, file);
  }
  const sound = (file: CodexFileAggregate): boolean => {
    const { parentSessionKey: parent, role } = file.session;
    return !conflicting.has(file.session.sessionKey) &&
      ['root', 'subagent', 'approval-reviewer'].includes(role) &&
      (parent === undefined ? role === 'root' : role !== 'root' && typeof parent === 'string' && !!parent.trim()) &&
      validAchievementTokenVector(file.total) && validAchievementBuckets(file.byModel, file.total);
  };
  const verified = new Map<string, boolean>();
  for (const key of bySession.keys()) {
    if (verified.has(key)) continue;
    const chain = new Set<string>();
    let current: string | undefined = key;
    let valid = true;
    while (current !== undefined) {
      if (verified.has(current)) { valid = verified.get(current)!; break; }
      const file = bySession.get(current);
      if (!file || chain.has(current) || !sound(file)) { valid = false; break; }
      chain.add(current);
      current = file.session.parentSessionKey;
    }
    if (!chain.size) verified.set(key, false);
    for (const session of chain) verified.set(session, valid);
  }
  return files.filter(file => verified.get(file?.session?.sessionKey) === true && sound(file));
}
