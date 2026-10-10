import type { AchievementId } from './achievements';

/** Joint output/repeated-task conditions supersede the R1 count-only rules. */
export const RECALIBRATED_ACHIEVEMENT_IDS_V2: readonly AchievementId[] = Object.freeze([
  'agent-standup', 'tiny-ai-company', 'agent-team-gold',
  'agent-conductor', 'agent-conductor-silver', 'agent-conductor-gold',
  'agent-participation-bronze', 'agent-participation-silver', 'agent-participation-gold',
  'model-relay-roots-bronze', 'model-relay-roots-silver', 'model-relay-roots-gold',
  'multi-core-human', 'same-root-models-silver', 'same-root-models-gold',
  'effort-explorer', 'effort-breadth-silver', 'effort-spectrum',
  'model-rainbow-bronze', 'model-rainbow', 'model-rainbow-gold',
]);
const changed = new Set<string>(RECALIBRATED_ACHIEVEMENT_IDS_V2);
export function achievementRuleVersion(id: string): 1 | 2 { return changed.has(id) ? 2 : 1; }

/** Frozen v1 allowlist. New monetary IDs must never be accepted as old proof. */
const legacyIds = new Set<string>([
  'sonnet-main','sonnet-main-silver','sonnet-main-gold','opus-cannon','opus-cannon-silver','opus-cannon-gold',
  'haiku-worker','haiku-worker-silver','haiku-worker-gold','cache-wizard','cache-wizard-silver','cache-wizard-gold',
  'claude-output-bronze','claude-output-silver','claude-output-gold','claude-output-sessions-bronze','claude-output-sessions-silver','claude-output-sessions-gold',
  'claude-cache-creation-bronze','claude-cache-creation-silver','claude-cache-creation-gold',
  'fable-volume-bronze','fable-volume-silver','fable-volume-gold','fable-days-bronze','fable-days-silver','fable-days-gold','fable-relay',
  'fable-sessions-bronze','fable-sessions-silver','fable-sessions-gold','weekly-volume-bronze','weekly-volume-silver','weekly-volume-gold',
  'output-hours-bronze','output-hours-silver','output-hours-gold','night-output-peak',
  'settings-explorer-bronze','settings-explorer-silver','settings-explorer-gold','safe-feature-explorer','local-share-export','local-advice-feedback',
  'astra-regular','astra-regular-silver','astra-regular-gold','sol-regular','sol-regular-silver','sol-regular-gold','luna-regular','luna-regular-silver','luna-regular-gold',
  ...RECALIBRATED_ACHIEVEMENT_IDS_V2,
  'root-portfolio-bronze','root-portfolio-silver','root-portfolio-gold',
  'active-day-streak','active-day-streak-silver','active-day-streak-gold','active-days-bronze','active-days-silver','active-days-gold','streak-machine',
  'hundred-million-club','billion-token-club','ten-billion-token-club','hundred-billion-token-club','trillion-token-club',
  'codex-output-bronze','codex-output-silver','codex-output-gold','codex-cache-read-bronze','codex-cache-read-silver','codex-cache-read-gold',
  'astra-days-bronze','astra-days-silver','astra-days-gold','sol-days-bronze','sol-days-silver','sol-days-gold','luna-days-bronze','luna-days-silver','luna-days-gold',
  'sonnet-days-bronze','sonnet-days-silver','sonnet-days-gold','opus-days-bronze','opus-days-silver','opus-days-gold','haiku-days-bronze','haiku-days-silver','haiku-days-gold',
  'dual-provider-days-bronze','dual-provider-days-silver','dual-provider-days-gold','active-weeks-bronze','active-weeks-silver','active-weeks-gold',
  'weekly-average-bronze','weekly-average-silver','weekly-average-gold','three-family-day','dual-provider-day',
]);
export function isLegacyAchievementId(id: string): boolean { return legacyIds.has(id); }
