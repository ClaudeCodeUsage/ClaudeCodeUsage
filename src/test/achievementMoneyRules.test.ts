import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { evaluateAchievements, ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { claudeAchievementMoneyScopes } from '../achievementMoneyScopes';
import { getAchievementMoneyPricebook } from '../achievementMoney';
import { AchievementRecordRepository, parseAchievementRecordStore } from '../achievementRecordStore';
import {renderAchievementShareSvg} from '../achievementShare';
import {achievementCopyFor} from '../i18n';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const base:any = {claudeTokens:0,codexTokens:0,activeDays:0,claudeFamilies:[],codex:{modelCount:0,efforts:[],familyRootCounts:{astra:0,sol:0,luna:0}}};
const amount = (microUsd:number,provider='claude') => ({provider,backend:provider==='codex' ? 'openai' : 'anthropic',
  pricebookVersion:getAchievementMoneyPricebook(provider==='codex' ? 'openai' : 'anthropic').version,
  cumulative:{microUsd,status:'complete'},completedMondayWeekPeak:microUsd,maxSessionTask:microUsd,
  coverage:{cumulative:{status:'complete'},completedMondayWeekPeak:{status:'complete'},maxSessionTask:{status:'complete'}}});
const row = (facts:any,id:string) => evaluateAchievements(facts).find(r=>r.id===id);

test('six provider-specific API themes have twenty-four award conditions, thresholds expressed as integer microUSD',()=>{
  const defs=ACHIEVEMENT_DEFINITIONS.filter(r=>/^(claude|codex)-api-/.test(r.id));
  assert.equal(defs.length,24);
  assert.equal(Object.keys(ACHIEVEMENT_SERIES).filter(key=>/^(claude|codex)-api-/.test(key)).length,6);
  for (const def of defs) {
    const provider=def.group as 'claude'|'codex';
    const below={...base,money:{[provider]:amount(def.target-1,provider)}};
    const exact={...base,money:{[provider]:amount(def.target,provider)}};
    assert.equal(row(below,def.id)?.unlocked,false,def.id+' below');
    assert.equal(row(exact,def.id)?.unlocked,true,def.id+' exact');
  }
});
test('unsafe, unpriced or mismatched reference DTOs cannot authorize monetary awards',()=>{
  for (const status of ['unpriced','invalid','scopepending','overflow']) {
    const bad=amount(100_000_000); bad.coverage.cumulative.status=status;
    assert.equal(row({...base,money:{claude:bad}},'claude-api-total-bronze')?.unlocked,false,status);
  }
  for (const value of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    const bad=amount(value);
    assert.equal(row({...base,money:{claude:bad}},'claude-api-total-bronze')?.unlocked,false);
  }
  const wrong=amount(100_000_000); wrong.pricebookVersion='runtime-overrides';
  assert.equal(row({...base,money:{claude:wrong}},'claude-api-total-bronze')?.unlocked,false);
});
test('providers and money scopes never substitute for one another or dashboard cost',()=>{
  const money=amount(100_000_000_000);
  money.completedMondayWeekPeak=undefined as any; money.maxSessionTask=undefined as any;
  const facts={...base,claudeTokens:1e12,codexTokens:1e12,totalCost:1e12,money:{claude:money}};
  assert.equal(row(facts,'claude-api-total-platinum')?.unlocked,true);
  assert.equal(row(facts,'claude-api-week-bronze')?.unlocked,false);
  assert.equal(row(facts,'claude-api-session-bronze')?.unlocked,false);
  assert.equal(row(facts,'codex-api-total-bronze')?.unlocked,false);
});

test('reference DTO backend must agree with its provider and known book',()=>{
  for (const provider of ['claude','codex']) {
    for (const backend of ['invented', provider==='codex' ? 'anthropic' : 'openai']) {
      const bad=amount(100_000_000,provider); bad.backend=backend;
      assert.equal(row({...base,money:{[provider]:bad}},provider+'-api-total-bronze')?.unlocked,false);
    }
  }
});
test('the trustworthy priced subset proves a lower bound, unknown TTL does not receive the ordinary cost fallback',()=>{
  const models={ 'claude-opus-5-5':{inputTokens:25_000_000,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,
    referenceUsage:{inputTokens:25_000_000,outputTokens:0,cacheReadTokens:0,cacheCreation5mTokens:0,cacheCreation1hTokens:0}},
    'unrecognized-model':{inputTokens:1e9,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0}};
  const scope=claudeAchievementMoneyScopes({backend:'anthropic',asOfDay:'2026-10-12',allTimeModels:models});
  assert.equal(scope.cumulative?.status,'partial');
  assert.equal(row({...base,money:{claude:scope}},'claude-api-total-bronze')?.unlocked,true);
  delete (models['claude-opus-5-5'] as any).referenceUsage;
  const unknown=claudeAchievementMoneyScopes({backend:'anthropic',asOfDay:'2026-10-12',allTimeModels:models});
  assert.equal(row({...base,money:{claude:unknown}},'claude-api-total-bronze')?.unlocked,false);
});
test('positive amounts below one microUSD remain distinct from a true zero after fixed-point flooring',()=>{
  const model={inputTokens:1,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,
    referenceUsage:{inputTokens:1,outputTokens:0,cacheReadTokens:0,cacheCreation5mTokens:0,cacheCreation1hTokens:0}};
  const tiny=claudeAchievementMoneyScopes({backend:'anthropic',asOfDay:'2026-10-12',
    allTimeModels:{'gpt-6-luna':model},days:{complete:true,rows:[{date:'2026-10-05',models:{'gpt-6-luna':model}}]},
    allSessionModels:[{'gpt-6-luna':model}],sessionsComplete:true});
  assert.equal(tiny.cumulative?.microUsd,0);
  for(const scope of Object.values(tiny.coverage)) if(scope && typeof scope==='object') assert.equal((scope as any).amountPositive,true);
  const zero=claudeAchievementMoneyScopes({backend:'anthropic',asOfDay:'2026-10-12',allTimeModels:{}});
  assert.equal((zero.coverage.cumulative as any).amountPositive,false);
});
test('saved monetary awards require a bounded reference pricebook identity and never enter a v1 file',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'ccu-money-award-'));
  try {
    const current=new AchievementRecordRepository(path.join(directory,'achievements-v2.json'));
    const initial=await current.initialize([]);
    const draft:any={id:'claude-api-total-bronze',origin:'history',recordedDay:null,timeZone:null,
      referencePricebook:getAchievementMoneyPricebook('anthropic').version};
    const saved=(await current.append(initial.generation,[draft])).store;
    assert.equal((saved.records[0] as any).referencePricebook,draft.referencePricebook);
    assert.deepEqual(parseAchievementRecordStore(saved),saved);
    const missing={...saved,records:saved.records.map(({referencePricebook,...rest}:any)=>rest)};
    assert.throws(()=>parseAchievementRecordStore(missing));
    assert.throws(()=>parseAchievementRecordStore({...saved,records:[{...saved.records[0],referencePricebook:'user/private/key'}]}));
    const old=new AchievementRecordRepository(path.join(directory,'achievements-v1.json'));
    const legacy=await old.initialize([]);
    await assert.rejects(old.append(legacy.generation,[draft]));
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('Codex uses an explicitly OpenAI reference identity, never a Claude backend label',()=>{
  const book=getAchievementMoneyPricebook('openai' as any);
  assert.equal(book.version,'api-reference-2026-10-openai-v1');
  assert.equal(book.prices['gpt-6.1-sol'].input,'2');
  assert.equal(book.prices['claude-opus-5-5'],undefined);
});
test('a provenance-free monetary Memento seed cannot poison unrelated valid legacy records',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'ccu-money-seed-'));
  try {
    await mkdir(path.join(directory,'fresh'));
    const repo=new AchievementRecordRepository(path.join(directory,'fresh','achievements-v2.json'));
    const saved=await repo.initialize(['local-share-export','claude-api-total-bronze'] as any);
    assert.deepEqual(saved.records.map(row=>row.id),['local-share-export']);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('the explicit monetary share exposes the public threshold, never a personal progress amount or price configuration',()=>{
  const copy=achievementCopyFor('en');
  const svg=renderAchievementShareSvg({selected:['claude-api-total-bronze'],titles:copy.titles,heading:copy.shareTitle,
    subtitle:copy.intro,groups:copy.groups,levels:copy.levels,milestone:copy.milestone,footer:copy.heading});
  assert.match(svg,/100 USD/);
  assert.doesNotMatch(svg,/microUSD|pricebookVersion|api-reference-|recordedDay|timeZone|pricingBackend/);
  assert.equal((svg.match(/data-achievement-share-badge=/g)??[]).length,1);
});
