import type { AchievementResult } from './achievements';

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
