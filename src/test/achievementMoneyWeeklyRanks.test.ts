import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, evaluateAchievements, type AchievementId} from '../achievements';
import {API_ACHIEVEMENT_DEFINITIONS} from '../achievementMoneyCatalog';
import {ACHIEVEMENT_IMAGE_FILES} from '../achievementIcons';
import {achievementCopyFor} from '../i18n';
import {highestEarnedAchievements, selectShareAchievements} from '../achievementShare';
import {historyRegistrationAllows} from '../achievementHistoryRegistry';
import {achievementHistoryDates, type AchievementHistoryDay, type AchievementHistoryInput} from '../achievementHistoryDates';
import {claudeMoneyEvidenceFromModels, codexMoneyEvidenceFromModels, claudeAchievementMoneyScopes} from '../achievementMoneyScopes';
import {getAchievementMoneyPricebook} from '../achievementMoney';
import {achievementRuleVersion, isLegacyAchievementId} from '../achievementRuleVersions';

const providers=['claude','codex'] as const;
const ranks=['bronze','silver','gold','platinum','legendary'];
const targets=[100_000_000,500_000_000,2_500_000_000,10_000_000_000,25_000_000_000];
const base:any={claudeTokens:0,codexTokens:0,activeDays:0,claudeFamilies:[],
  codex:{modelCount:0,efforts:[],familyRootCounts:{astra:0,sol:0,luna:0}}};
const models=(n:number)=>({'claude-opus-5-5':{inputTokens:n,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,
  referenceUsage:{inputTokens:n,outputTokens:0,cacheReadTokens:0,cacheCreation5mTokens:0,cacheCreation1hTokens:0}}});
const amount=(provider:'claude'|'codex',microUsd:number)=>({provider,backend:provider==='claude'?'anthropic':'openai',
  pricebookVersion:getAchievementMoneyPricebook(provider==='claude'?'anthropic':'openai').version,
  completedMondayWeekPeak:microUsd,coverage:{completedMondayWeekPeak:{status:'complete'}}});

test('weekly money adds exactly two ordered ranks per provider, preserving old thresholds and series artwork',()=>{
  for(const provider of providers){
    const key=provider+'-api-week';
    const ids=ranks.map(rank=>key+'-'+rank);
    assert.deepEqual(API_ACHIEVEMENT_DEFINITIONS.filter(r=>r.group===provider&&r.scope==='completedMondayWeekPeak').map(r=>[r.id,r.target]),
      ids.map((id,i)=>[id,targets[i]]));
    assert.deepEqual(ACHIEVEMENT_SERIES[key],ids);
    for(const id of ids){
      assert.equal(ACHIEVEMENT_IMAGE_FILES[id as AchievementId],key+'-v242-v2.png');
      assert.equal(historyRegistrationAllows(id,key),true);
      assert.equal(achievementRuleVersion(id),1);
      assert.equal(isLegacyAchievementId(id),false);
    }
  }
  assert.equal(Object.keys(ACHIEVEMENT_SERIES).filter(k=>/^(claude|codex)-api-/.test(k)).length,6);
});

test('all eight locales have localized weekly titles including Platinum and Legendary',()=>{
  for(const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id']){
    const copy=achievementCopyFor(locale);
    for(const provider of providers) for(const index of [3,4]){
      const id=(provider+'-api-week-'+ranks[index]) as AchievementId;
      assert.equal(typeof copy.titles[id],'string',locale+': '+id);
      assert.ok(copy.titles[id].endsWith(' · '+copy.levels[index]),locale+': '+id);
      assert.ok(copy.titles[id].startsWith(provider==='claude'?'Claude ':'Codex '));
      assert.doesNotMatch(copy.titles[id],/undefined/);
    }
  }
});

test('new weekly ranks use exact microUSD and highest-earned sharing within each provider',()=>{
  for(const provider of providers) for(const index of [3,4]){
    const id=provider+'-api-week-'+ranks[index];
    for(const delta of [-1,0]){
      const results=evaluateAchievements({...base,money:{[provider]:amount(provider,targets[index]+delta)}});
      assert.equal(results.find(r=>r.id===id)?.unlocked,delta===0,id);
      const expected=provider+'-api-week-'+ranks[index+(delta===0?0:-1)];
      assert.deepEqual(highestEarnedAchievements(results).filter(r=>r.id.includes('-api-week-')).map(r=>r.id),[expected]);
      assert.deepEqual(selectShareAchievements(results,ranks.map(rank=>provider+'-api-week-'+rank)),[expected]);
      assert.ok(results.filter(r=>r.id.startsWith(provider==='claude'?'codex-api-':'claude-api-')).every(r=>!r.unlocked));
    }
  }
});

test('new weekly ranks reject unsafe amounts, foreign providers, unknown books and missing weekly proof',()=>{
  for(const provider of providers) for(const patch of [
    {completedMondayWeekPeak:NaN},{completedMondayWeekPeak:Number.MAX_SAFE_INTEGER+1},
    {completedMondayWeekPeak:25_000_000_000.5},{completedMondayWeekPeak:-1},
    {pricebookVersion:'future-book'}, {provider:provider==='claude'?'codex':'claude'},
    {coverage:{completedMondayWeekPeak:{status:'scopepending'}}},
    {completedMondayWeekPeak:undefined,cumulative:{microUsd:25_000_000_000}},
  ]){
    const results=evaluateAchievements({...base,money:{[provider]:{...amount(provider,25_000_000_000),...patch}}});
    for(const rank of ['platinum','legendary'])assert.equal(results.find(r=>r.id===provider+'-api-week-'+rank)?.unlocked,false);
  }
});

function priced(provider:'claude'|'codex',day:string,dollars:number):AchievementHistoryDay{
  const n=dollars*1_000_000/(provider==='claude'?4:2);
  const model=provider==='claude'?'claude-opus-5-5':'gpt-6.1-sol';
  const money=provider==='claude'?claudeMoneyEvidenceFromModels(models(n),'anthropic'):
    codexMoneyEvidenceFromModels({[model]:{inputTotal:n,outputTotal:0}},'openai');
  assert.equal(money.status,'complete');
  return {day,processed:n,output:0,models:{[model]:{processed:n,output:0}},money:money as any};
}

test('each provider dates new ranks only after the qualifying Monday-start week ends, never from current week or another provider',()=>{
  for(const provider of providers){
    const days=[priced(provider,'2026-09-28',10000),priced(provider,'2026-10-05',12500),
      priced(provider,'2026-10-11',12500),priced(provider,'2026-10-12',100000)];
    const proof:AchievementHistoryInput={asOfDay:'2026-10-14',timeZone:'UTC',enabled:{claude:true,codex:true},
      claude:{complete:true,timeZone:'UTC',days:provider==='claude'?days:[]},
      codex:{complete:true,timeZone:'UTC',days:provider==='codex'?days:[]}};
    const result=achievementHistoryDates(proof);
    const platinum=(provider+'-api-week-platinum') as AchievementId;
    const legendary=(provider+'-api-week-legendary') as AchievementId;
    assert.equal(result[platinum]?.day,'2026-10-05');
    assert.equal(result[legendary]?.day,'2026-10-12');
    assert.equal(result[legendary]?.pricebookVersion,amount(provider,0).pricebookVersion);
    assert.equal(result[(provider==='claude'?'codex-api-week-legendary':'claude-api-week-legendary')],undefined);
    const sunday={...proof,asOfDay:'2026-10-11',[provider]:{complete:true,timeZone:'UTC',days:days.slice(0,3)}};
    assert.equal(achievementHistoryDates(sunday)[legendary],undefined);
    const current={...proof,[provider]:{complete:true,timeZone:'UTC',days:days.slice(3)}};
    assert.equal(achievementHistoryDates(current)[platinum],undefined);
    assert.equal(achievementHistoryDates(current)[legendary],undefined);
  }
});

test('new weekly evaluation excludes current-week money, while keeping frozen reference price attribution',()=>{
  const old=models(2_500_000_000),current=models(6_250_000_000);
  const scope=claudeAchievementMoneyScopes({backend:'anthropic',asOfDay:'2026-10-12',allTimeModels:current,
    days:{complete:true,rows:[{date:'2026-10-05',models:old},{date:'2026-10-12',models:current}]}});
  assert.equal(scope.completedMondayWeekPeak,10_000_000_000);
  const results=evaluateAchievements({...base,money:{claude:scope}});
  assert.equal(results.find(r=>r.id==='claude-api-week-platinum')?.unlocked,true);
  assert.equal(results.find(r=>r.id==='claude-api-week-legendary')?.unlocked,false);
});
