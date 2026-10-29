import type {AchievementId} from './achievements';
import type {AchievementCopy} from './i18n';
import {isAchievementMoneyId} from './achievementMoneyCatalog';

/** Shared public measure names; qualification and eligibility remain in domain rules. */
export function achievementUnitFor(id:AchievementId,units:AchievementCopy['units'],moneyUnit:string):string {
  return isAchievementMoneyId(id) ? moneyUnit :
      id.startsWith('codex-output-') ? units.outputTokens :
      id.startsWith('codex-cache-read-') ? units.codexCachedTokens :
      /^(astra|sol|luna|sonnet|opus|haiku)-days-/.test(id) ? units.qualifiedDays :
      id.startsWith('fable-days-') ? units.qualifiedDays :
      id.startsWith('dual-provider-days-') ? units.sharedDays :
      id.startsWith('active-weeks-') ? units.weeks :
      id.startsWith('weekly-average-') ? units.weeklyAverage :
      id === 'three-family-day' ? units.threeFamilyDay :
      id === 'dual-provider-day' ? units.sharedDays :
      id.startsWith('claude-output-') && !id.startsWith('claude-output-sessions-') ? units.outputTokens :
      id.startsWith('cache-wizard') ? units.cacheReadTokens :
      id.startsWith('claude-cache-creation-') ? units.cacheCreationTokens :
      id.startsWith('output-hours-') ? units.hours :
      id === 'night-output-peak' ? units.nightPeak :
      id.startsWith('settings-explorer-') ? units.settings :
      id === 'safe-feature-explorer' ? units.features :
      id === 'local-share-export' ? units.exports :
      id === 'local-advice-feedback' ? units.feedback :
      id.startsWith('root-portfolio-') ||
      id.startsWith('model-relay-roots-') ? units.roots :
      id.startsWith('agent-participation-') ? units.childSessions :
      id.startsWith('agent-conductor') ? units.agentRoots :
      id === 'agent-standup' || id === 'tiny-ai-company' || id === 'agent-team-gold' ? units.agents :
      id.startsWith('effort-') ? units.efforts :
      id.startsWith('active-day-streak') || id === 'streak-machine' ? units.streak :
      id.startsWith('active-days-') ? units.days :
      id.startsWith('fable-sessions-') ? units.sessions :
      id.startsWith('claude-output-sessions-') ? units.outputSessions :
      id === 'fable-relay' ? units.relay :
      id.startsWith('model-rainbow') ? units.families :
      id === 'multi-core-human' || id.startsWith('same-root-models-') ? units.models : units.tokens;
}
