import { ACHIEVEMENT_DEFINITIONS, AchievementId, AchievementResult } from './achievements';
import type { ClaudeAchievementUsageDelta } from './claudeIncrementalIndex';
import { CodexAchievementUsageDelta, copyCodexUsageWindow, copyCodexUsageDelta } from './providers/codex/codexAchievementOrigin';

/** Same per-level causal test as Claude, with Codex's native input + output
 * semantics. Volume proof never authorizes calendar, effort breadth or agents. */
export function codexTailAchievementCrossings(
  before: readonly AchievementResult[], after: readonly AchievementResult[],
  rawDelta: CodexAchievementUsageDelta | undefined,
): AchievementId[] {
  const delta = copyCodexUsageDelta(rawDelta, copyCodexUsageWindow(rawDelta));
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (!delta || delta.processed === 0 || before.length > ACHIEVEMENT_DEFINITIONS.length ||
      after.length > ACHIEVEMENT_DEFINITIONS.length) return [];
  const previous = new Map(before.map(row => [row.id, row]));
  const current = new Map(after.map(row => [row.id, row]));
  if (previous.size !== before.length || current.size !== after.length) return [];
  const ids: AchievementId[] = [];
  for (const rule of ACHIEVEMENT_DEFINITIONS) {
    const old = previous.get(rule.id), next = current.get(rule.id);
    if (!old || !next || old.target !== rule.target || next.target !== rule.target ||
        old.group !== rule.group || next.group !== rule.group ||
        !count(old.progress) || !count(next.progress) || old.progress >= rule.target || next.progress < rule.target) continue;
    const addition = rule.id.startsWith('astra-regular') ? delta.families.astra
      : rule.id.startsWith('sol-regular') ? delta.families.sol
      : rule.id.startsWith('luna-regular') ? delta.families.luna
      : rule.id.startsWith('codex-output-') ? delta.output
      : rule.id.startsWith('codex-cache-read-') ? delta.cacheRead
      : ['hundred-million-club', 'billion-token-club', 'ten-billion-token-club',
        'hundred-billion-token-club', 'trillion-token-club'].includes(rule.id) ? delta.processed : 0;
    if (addition <= 0 || addition > next.progress || !count(old.progress + addition)) continue;
    if (old.progress + addition >= rule.target && next.progress - addition < rule.target) ids.push(rule.id);
  }
  return ids;
}

/** Proven tail additions are a lower bound, not permission to date all awards
 * in a mixed refresh. Certify only volume rules where this addition is both
 * sufficient against the prior baseline and necessary against the new total.
 * The caller still owns readiness, accepted producer window and lease fencing. */
export function claudeTailAchievementCrossings(
  before: readonly AchievementResult[], after: readonly AchievementResult[],
  delta: ClaudeAchievementUsageDelta | undefined,
): AchievementId[] {
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (!delta || delta.provider !== 'claude' || !count(delta.after) || !count(delta.through) ||
      delta.through > 8.64e15 || delta.through <= delta.after ||
      !count(delta.processed) || delta.processed === 0 || !count(delta.output) ||
      !count(delta.cacheRead) || !Number.isSafeInteger(delta.output + delta.cacheRead) ||
      delta.output + delta.cacheRead > delta.processed ||
      !delta.families || typeof delta.families !== 'object' || Array.isArray(delta.families)) return [];
  let families = 0;
  for (const family of ['sonnet', 'opus', 'haiku', 'fable'] as const) {
    const value = delta.families[family];
    if (!count(value)) return [];
    families += value;
  }
  if (!Number.isSafeInteger(families) || families > delta.processed ||
      before.length > ACHIEVEMENT_DEFINITIONS.length || after.length > ACHIEVEMENT_DEFINITIONS.length) return [];
  const previous = new Map(before.map((row) => [row.id, row]));
  const current = new Map(after.map((row) => [row.id, row]));
  if (previous.size !== before.length || current.size !== after.length) return [];
  const ids: AchievementId[] = [];
  for (const rule of ACHIEVEMENT_DEFINITIONS) {
    const old = previous.get(rule.id), next = current.get(rule.id);
    if (!old || !next || old.target !== rule.target || next.target !== rule.target ||
        old.group !== rule.group || next.group !== rule.group ||
        !count(old.progress) || !count(next.progress) ||
        old.progress >= rule.target || next.progress < rule.target) continue;
    const addition = rule.id.startsWith('sonnet-main') ? delta.families.sonnet
      : rule.id.startsWith('opus-cannon') ? delta.families.opus
      : rule.id.startsWith('haiku-worker') ? delta.families.haiku
      : rule.id.startsWith('fable-volume-') ? delta.families.fable
      : rule.id.startsWith('cache-wizard') ? delta.cacheRead
      : /^claude-output-(bronze|silver|gold)$/.test(rule.id) ? delta.output
      : ['hundred-million-club', 'billion-token-club', 'ten-billion-token-club',
        'hundred-billion-token-club', 'trillion-token-club'].includes(rule.id) ? delta.processed : 0;
    if (addition <= 0 || addition > next.progress || !Number.isSafeInteger(old.progress + addition)) continue;
    if (old.progress + addition >= rule.target && next.progress - addition < rule.target) ids.push(rule.id);
  }
  return ids;
}

export const ACHIEVEMENT_EVIDENCE_DOMAINS = [
  'claude-usage', 'codex-lineage', 'codex-tokens', 'claude-calendar',
  'codex-calendar', 'combined-usage', 'combined-calendar', 'hours', 'plugin',
] as const;
export type AchievementEvidenceDomain = typeof ACHIEVEMENT_EVIDENCE_DOMAINS[number];
export type AchievementEvidenceState = 'ready' | 'pending' | 'stale';
export type AchievementEvidenceStates = Record<AchievementEvidenceDomain, AchievementEvidenceState>;

/** Rule scope, not whichever provider tab happens to be selected. */
export function achievementEvidenceDomain(rule: Pick<AchievementResult, 'id' | 'group'>): AchievementEvidenceDomain {
  if (rule.group === 'plugin') return 'plugin';
  if (rule.id.startsWith('output-hours-') || rule.id === 'night-output-peak') return 'hours';
  if (/^(?:(?:astra|sol|luna|sonnet|opus|haiku|fable|dual-provider)-days-|active-|weekly-)/.test(rule.id) ||
      ['streak-machine', 'three-family-day', 'dual-provider-day'].includes(rule.id)) {
    return rule.group === 'claude' ? 'claude-calendar' : rule.group === 'codex' ? 'codex-calendar' : 'combined-calendar';
  }
  if (rule.group === 'claude') return 'claude-usage';
  if (rule.group === 'codex') return /^(?:codex-output-|codex-cache-read-)/.test(rule.id) ? 'codex-tokens' : 'codex-lineage';
  return 'combined-usage';
}

/** Nine runtime latches only. First/recovered history in each domain is quiet. */
export class AchievementNoticeBaseline {
  private readonly ready = new Set<AchievementEvidenceDomain>();

  accept(states: AchievementEvidenceStates): ReadonlySet<AchievementEvidenceDomain> {
    const previouslyReady = new Set<AchievementEvidenceDomain>();
    for (const domain of ACHIEVEMENT_EVIDENCE_DOMAINS) {
      if (states[domain] !== 'ready') { this.ready.delete(domain); continue; }
      if (this.ready.has(domain)) previouslyReady.add(domain);
      this.ready.add(domain);
    }
    return previouslyReady;
  }

  isReady(domain: AchievementEvidenceDomain): boolean { return this.ready.has(domain); }
  reset(domains: readonly AchievementEvidenceDomain[] = ACHIEVEMENT_EVIDENCE_DOMAINS): void {
    for (const domain of domains) this.ready.delete(domain);
  }
}
