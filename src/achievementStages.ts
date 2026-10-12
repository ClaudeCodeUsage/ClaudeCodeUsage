import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from './achievements';

/** Display targets only: no IDs, grant writes, dates, notices or share choices. */
const TOKEN_STAGE_SERIES = new Set([
  'astra-regular', 'sol-regular', 'luna-regular', 'cumulative-volume',
  'weekly-volume', 'weekly-average', 'sonnet-main', 'opus-cannon',
  'haiku-worker', 'fable-volume', 'cache-wizard', 'claude-cache-creation',
  'claude-output', 'codex-output', 'codex-cache-read',
  'claude-api-total','claude-api-week','claude-api-session',
  'codex-api-total','codex-api-week','codex-api-task',
]);
const targets = new Map(ACHIEVEMENT_DEFINITIONS.map(rule => [rule.id, rule.target]));

export function achievementStages(series: string): readonly number[] {
  if (!TOKEN_STAGE_SERIES.has(series)) return [];
  const formal = ACHIEVEMENT_SERIES[series].map(id => targets.get(id)!);
  const stages: number[] = [];
  // One bounded decade before Token entry tiers; money keeps its existing gaps.
  const firstIndex = series.includes('-api-') ? 1 : 0;
  for (let index = firstIndex; index < formal.length; index++) {
    const lower = index === 0 ? formal[0] / 10 : formal[index - 1], upper = formal[index];
    for (let power = Math.floor(Math.log10(lower)); power <= Math.floor(Math.log10(upper)); power++) {
      for (const multiplier of [1, 2, 5]) {
        const value = multiplier * 10 ** power;
        if (Number.isSafeInteger(value) && (index === 0 ? value >= lower : value > lower) && value < upper) stages.push(value);
      }
    }
  }
  return stages;
}

export function nextAchievementStage(
  series: string, progress: number, formalTarget: number, evidenceReady: boolean,
): number | undefined {
  if (!evidenceReady || !Number.isSafeInteger(progress) || progress < 0 || !TOKEN_STAGE_SERIES.has(series)) return;
  const formal = ACHIEVEMENT_SERIES[series].map(id => targets.get(id)!);
  const index = formal.indexOf(formalTarget);
  if (index < 0 || progress >= formalTarget || index === 0 && progress === 0) return;
  const lower = index === 0 ? 0 : formal[index - 1];
  return achievementStages(series).find(value => value > lower && value > progress && value < formalTarget);
}
