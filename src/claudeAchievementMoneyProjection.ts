import type {ClaudeUsageIndex} from './claudeIncrementalIndex';
import type {AchievementMoneyBackend} from './achievementMoney';
import {claudeAchievementMoneyScopes,type AchievementMoneyScopes} from './achievementMoneyScopes';
import {dayKeyInZone} from './dateKeys';

interface Cached { backend:AchievementMoneyBackend; day:string; timeZone:string;
  allTime:ClaudeUsageIndex['aggregates']['allTime']; days:ClaudeUsageIndex['aggregates']['byLocalDay'];
  sessions:ClaudeUsageIndex['aggregates']['bySession']; manifest:ClaudeUsageIndex['manifest']; value:AchievementMoneyScopes }
// One entry per committed immutable index, weakly held. Never copy a corpus,
// retain session identities in the DTO, or re-iterate warm aggregates.
const cache=new WeakMap<ClaudeUsageIndex,Cached>();
/** Called by the canonical reducer only after a successful commit with zero
 * aggregate mutations. New Map wrappers alone are not new usage evidence. */
export function inheritClaudeAchievementMoneyProjection(previous:ClaudeUsageIndex,next:ClaudeUsageIndex):void {
  const old=cache.get(previous);
  if (!old || next.timeZone!==previous.timeZone || next.manifest===null) return;
  cache.set(next,{...old,allTime:next.aggregates.allTime,days:next.aggregates.byLocalDay,
    sessions:next.aggregates.bySession,manifest:next.manifest});
}
export function claudeAchievementMoneyProjection(index:ClaudeUsageIndex,backend:AchievementMoneyBackend,now:Date,enabled:boolean):AchievementMoneyScopes|undefined {
  if (enabled!==true || index.manifest===null) return;
  const day=dayKeyInZone(now,index.timeZone);
  const old=cache.get(index);
  if (old && old.backend===backend && old.day===day && old.timeZone===index.timeZone &&
      old.allTime===index.aggregates.allTime && old.days===index.aggregates.byLocalDay &&
      old.sessions===index.aggregates.bySession && old.manifest===index.manifest) return old.value;
  function* days() {
    for (const [date,data] of index.aggregates.byLocalDay) yield {date,models:data.modelBreakdown};
  }
  function* sessions() {
    for (const [key,data] of index.aggregates.bySession) {
      // Missing session identity must not combine unrelated records into one
      // apparently large single session. Cumulative evidence remains separate.
      if (key && key!=='unknown') yield data.modelBreakdown;
    }
  }
  const scopes=claudeAchievementMoneyScopes({backend,asOfDay:day,allTimeModels:index.aggregates.allTime.modelBreakdown,
    days:{complete:true,rows:days()},allSessionModels:sessions(),sessionsComplete:true});
  const value=Object.freeze({...scopes,coverage:Object.freeze(scopes.coverage)});
  cache.set(index,{backend,day,timeZone:index.timeZone,allTime:index.aggregates.allTime,days:index.aggregates.byLocalDay,
    sessions:index.aggregates.bySession,manifest:index.manifest,value});
  return value;
}
