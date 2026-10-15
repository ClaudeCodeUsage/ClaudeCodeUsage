import type { AchievementMoneyScopes } from './achievementMoneyScopes';
import {getAchievementMoneyPricebook} from './achievementMoney';

/** All targets are exact integer microUSD, never rounded display dollars. */
export const API_ACHIEVEMENT_DEFINITIONS = [
  {id:'claude-api-total-bronze',group:'claude',target:100_000_000,scope:'cumulative'},
  {id:'claude-api-total-silver',group:'claude',target:1_000_000_000,scope:'cumulative'},
  {id:'claude-api-total-gold',group:'claude',target:10_000_000_000,scope:'cumulative'},
  {id:'claude-api-total-platinum',group:'claude',target:100_000_000_000,scope:'cumulative'},
  {id:'claude-api-week-bronze',group:'claude',target:100_000_000,scope:'completedMondayWeekPeak'},
  {id:'claude-api-week-silver',group:'claude',target:500_000_000,scope:'completedMondayWeekPeak'},
  {id:'claude-api-week-gold',group:'claude',target:2_500_000_000,scope:'completedMondayWeekPeak'},
  {id:'claude-api-week-platinum',group:'claude',target:10_000_000_000,scope:'completedMondayWeekPeak'},
  {id:'claude-api-week-legendary',group:'claude',target:25_000_000_000,scope:'completedMondayWeekPeak'},
  {id:'claude-api-session-bronze',group:'claude',target:10_000_000,scope:'maxSessionTask'},
  {id:'claude-api-session-silver',group:'claude',target:100_000_000,scope:'maxSessionTask'},
  {id:'claude-api-session-gold',group:'claude',target:1_000_000_000,scope:'maxSessionTask'},
  {id:'codex-api-total-bronze',group:'codex',target:100_000_000,scope:'cumulative'},
  {id:'codex-api-total-silver',group:'codex',target:1_000_000_000,scope:'cumulative'},
  {id:'codex-api-total-gold',group:'codex',target:10_000_000_000,scope:'cumulative'},
  {id:'codex-api-total-platinum',group:'codex',target:100_000_000_000,scope:'cumulative'},
  {id:'codex-api-week-bronze',group:'codex',target:100_000_000,scope:'completedMondayWeekPeak'},
  {id:'codex-api-week-silver',group:'codex',target:500_000_000,scope:'completedMondayWeekPeak'},
  {id:'codex-api-week-gold',group:'codex',target:2_500_000_000,scope:'completedMondayWeekPeak'},
  {id:'codex-api-week-platinum',group:'codex',target:10_000_000_000,scope:'completedMondayWeekPeak'},
  {id:'codex-api-week-legendary',group:'codex',target:25_000_000_000,scope:'completedMondayWeekPeak'},
  {id:'codex-api-task-bronze',group:'codex',target:10_000_000,scope:'maxSessionTask'},
  {id:'codex-api-task-silver',group:'codex',target:100_000_000,scope:'maxSessionTask'},
  {id:'codex-api-task-gold',group:'codex',target:1_000_000_000,scope:'maxSessionTask'},
] as const;
export type AchievementMoneyId = typeof API_ACHIEVEMENT_DEFINITIONS[number]['id'];
export type AchievementMoneyFacts = Partial<Record<'claude'|'codex',AchievementMoneyScopes>>;
const known = new Set<string>(API_ACHIEVEMENT_DEFINITIONS.map(row=>row.id));
export function isAchievementMoneyId(id: string): id is AchievementMoneyId { return known.has(id); }
export function achievementMoneyProgress(facts: AchievementMoneyFacts | undefined): Record<AchievementMoneyId,number> {
  const value = (row: typeof API_ACHIEVEMENT_DEFINITIONS[number]): number => {
    const input=facts?.[row.group];
    if (input?.provider!==row.group) return 0;
    const backend=input.backend;
    if (!backend || (row.group==='codex' ? backend!=='openai' : backend!=='anthropic' && backend!=='aws-bedrock-in-region') ||
        input.pricebookVersion!==getAchievementMoneyPricebook(backend).version ||
        !['complete','partial'].includes(input.coverage?.[row.scope]?.status)) return 0;
    const raw=row.scope==='cumulative' ? input.cumulative?.microUsd : input[row.scope];
    return typeof raw==='number' && Number.isSafeInteger(raw) && raw>=0 ? raw : 0;
  };
  return Object.fromEntries(API_ACHIEVEMENT_DEFINITIONS.map(row=>[row.id,value(row)])) as Record<AchievementMoneyId,number>;
}
export const API_ACHIEVEMENT_SERIES: Record<string,readonly AchievementMoneyId[]> = Object.fromEntries(
  [...new Set(API_ACHIEVEMENT_DEFINITIONS.map(row=>row.id.replace(/-(bronze|silver|gold|platinum|legendary)$/,'')))].map(key=>
    [key,API_ACHIEVEMENT_DEFINITIONS.filter(row=>row.id.startsWith(key+'-')).map(row=>row.id)]),
);
