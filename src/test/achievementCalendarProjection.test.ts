import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { codexAchievementMoneyScopes } from '../achievementMoneyScopes';
import { CODEX_PERIOD_LINEAGE_VERSION } from '../providers/codex/codexPeriodIndex';
const calendar = require('../achievementCalendar') as any;
const project = (files: any[], indexed = true) => calendar.codexAchievementCalendarProjection(files, 'UTC', indexed);
function file(key: string, parent?: string): any {
  const t = { inputTotal: 500_000_000, outputTotal: 4 };
  const s = { inputTotal: 125_000_000, outputTotal: 1 };
  return { total: t, byModel: { 'gpt-6.1-sol': t }, byEffort: {}, byDay: {}, structural: {},
    session: { sessionKey: key, parentSessionKey: parent, role: parent ? 'subagent' : 'root' },
    achievementPeriodWitness: { size: 100, offset: 100, expectedPrefixEvents: 0, timeZone: 'UTC' },
    period: { timeZone: 'UTC', indexedThrough: 100, lineageVersion: CODEX_PERIOD_LINEAGE_VERSION,
      lineagePrefixEvents: 0, days: Object.fromEntries(['05','06','07','08'].map(d => [`2026-10-${d}`,
        { total: { ...s }, byModel: { 'gpt-6.1-sol': { ...s } }, byEffort: {}, structural: {} }])) } };
}
const money = (files: any[], dayEvidence = project(files).evidence) =>
  codexAchievementMoneyScopes({ files, complete: true, backend: 'openai', asOfDay: '2026-10-12', dayEvidence });
test('full census conflicts retain separately witnessed dates and positive weekly money as a bound', () => {
  const good = file('good'), files = [file('duplicate'), good, file('duplicate'), file('child','duplicate')];
  const p = project(files);
  assert.equal(p.evidence.complete, false);
  assert.equal(p.evidence.scope, 'verified-subset');
  assert.equal(p.evidence.days.length, 4);
  const facts = calendar.achievementCalendarSignals({claude:{complete:true,days:[],timeZone:'UTC'},codex:p.evidence,asOfDay:'2026-10-12'});
  assert.equal(facts.familyDays.sol, 4);
  assert.equal(facts.activeWeeks, 1);
  assert.equal(facts.codexEvidenceComplete, false);
  assert.equal(facts.codexEvidenceUsable, true);
  assert.equal(facts.peakEvidenceComplete, false);
  const joined=calendar.achievementCalendarSignals({claude:{complete:true,timeZone:'UTC',days:[
    {day:'2026-10-05',processed:2_000_000,output:1,models:{'claude-sonnet-5':{processed:2_000_000,output:1}}}]},
    codex:p.evidence,asOfDay:'2026-10-12'});
  assert.equal(joined.dualProviderDays,0,'existing dual-provider full-coverage fence is not expanded');
  const value = money(files, p.evidence), exact = money([good]);
  assert.equal(value.completedMondayWeekPeak, exact.completedMondayWeekPeak);
  assert.equal(value.completedMondayWeekPeak, 1_000_000_040);
  assert.equal(value.coverage.completedMondayWeekPeak.status, 'partial');
  assert.equal((value.coverage.completedMondayWeekPeak as any).scopeLowerBound, true);
  assert.equal(value.cumulative?.microUsd, exact.cumulative?.microUsd);
  assert.equal(money(files, project([good]).evidence).completedMondayWeekPeak, undefined, 'subset proof is bound to its original census');
});
test('undated residual is usable positive evidence, not complete-zero or weekly monetary evidence', () => {
  const f = file('r'); delete f.period.days['2026-10-08'];
  const p = project([f]);
  assert.equal(p.evidence.complete, false);
  assert.equal(p.evidence.scope, 'verified-subset');
  assert.equal(p.evidence.days.length, 3);
  assert.equal(money([f],p.evidence).completedMondayWeekPeak, undefined);
  f.period.days = {};
  assert.equal(project([f]).evidence.scope, undefined);
  assert.deepEqual(project([f]).evidence.days, []);
  assert.equal(project([f]).evidence.complete, false);
  assert.equal(money([f]).coverage.completedMondayWeekPeak.status, 'scopepending');
});
test('witness mismatch, absent provenance or incomplete manifest cannot admit a date', () => {
  for (const mutate of [(f:any)=>delete f.achievementPeriodWitness,
    (f:any)=>f.achievementPeriodWitness.offset--, (f:any)=>f.achievementPeriodWitness.size++,
    (f:any)=>f.achievementPeriodWitness.expectedPrefixEvents++, (f:any)=>f.period.indexedThrough--,
    (f:any)=>f.period.lineageVersion--, (f:any)=>f.achievementPeriodWitness.timeZone='Asia/Shanghai',
    (f:any)=>f.period.days['2026-10-05'].total.inputTotal=-1]) {
    const f = file('bad'); mutate(f);
    assert.deepEqual(project([f]).evidence.days, []);
    assert.equal(project([f]).evidence.complete, false);
    assert.equal(money([f]).completedMondayWeekPeak, undefined);
  }
  assert.deepEqual(project([file('r')],false).evidence.days, []);
});
test('resolved ancestry precedes date selection; net child usage is not subtracted again', () => {
  const root = file('root'), child = file('child','root'); delete root.achievementPeriodWitness;
  child.achievementPeriodWitness.expectedPrefixEvents = child.period.lineagePrefixEvents = 123;
  assert.equal(project([child,root]).evidence.days[0].processed, 125_000_001);
  assert.equal(money([child,root]).completedMondayWeekPeak, 1_000_000_040);
  assert.deepEqual(project([child]).evidence.days, [], 'orphan cannot be made sound by shortening the census');
  root.session.parentSessionKey='child'; root.session.role='subagent';
  assert.deepEqual(project([root,child]).evidence.days, [], 'cycle withheld');
});
test('whole empty remains verified empty; positive-less subsets never certify a zero peak', () => {
  assert.equal(project([]).evidence.complete, true);
  assert.equal(money([]).coverage.completedMondayWeekPeak.status, 'empty');
  const onlyOpen = file('r'); onlyOpen.period.days=Object.fromEntries(Object.values(onlyOpen.period.days).map((s:any,i)=>[`2026-10-${12+i}`,s]));
  const files = [onlyOpen,file('duplicate'),file('duplicate')];
  assert.equal(money(files).completedMondayWeekPeak, undefined);
  assert.equal(money(files).coverage.completedMondayWeekPeak.status, 'scopepending');
});
test('runtime census revision and numeric proof mismatch retire weekly money without changing cumulative', () => {
  const f = file('r'), p=project([f]).evidence, before=money([f],p).cumulative?.microUsd;
  f.period.indexedThrough=99;
  assert.equal(money([f],p).completedMondayWeekPeak, undefined);
  assert.equal(money([f],p).cumulative?.microUsd,before);
  f.period.indexedThrough=100;
  const forged=structuredClone(project([f]).evidence); forged.days[0].models['gpt-6.1-sol'].output++;
  assert.equal(money([f],forged).completedMondayWeekPeak, undefined);
});
test('independent global fence stays partial even when every supplied file is fully dated', () => {
  const files=[file('r')], p=calendar.codexAchievementCalendarProjection(files,'UTC',true,false).evidence;
  assert.equal(p.complete,false);
  assert.equal(p.scope,'verified-subset');
  const value=codexAchievementMoneyScopes({files,complete:true,calendarComplete:false,dayEvidence:p,backend:'openai',asOfDay:'2026-10-12'});
  assert.equal(value.completedMondayWeekPeak,1_000_000_040);
  assert.equal(value.coverage.completedMondayWeekPeak.status,'partial');
  assert.equal(codexAchievementMoneyScopes({files,complete:true,calendarComplete:true,dayEvidence:p,backend:'openai',asOfDay:'2026-10-12'}).completedMondayWeekPeak,undefined);
});
test('unknown model and overflowing merged vectors do not fabricate safe weekly dollars', () => {
  const f=file('r'); f.byModel={unknown:f.total};
  for (const slice of Object.values(f.period.days) as any[]) slice.byModel={unknown:slice.total};
  assert.equal(money([f]).coverage.completedMondayWeekPeak.status,'unpriced');
  assert.equal(money([f]).completedMondayWeekPeak,undefined);
  const big=file('one'), second=file('two');
  for (const row of [big,second]) {
    row.total={inputTotal:Number.MAX_SAFE_INTEGER,outputTotal:0}; row.byModel={'gpt-6.1-sol':row.total};
    row.period.days={'2026-10-05':{total:row.total,byModel:row.byModel,byEffort:{},structural:{}}};
  }
  assert.deepEqual(project([big,second]).evidence.days,[]);
  assert.equal(money([big,second]).completedMondayWeekPeak,undefined);
});
test('a fully dated child behind invalid ancestry stays withheld, regardless of array order', () => {
  const root=file('root'), child=file('child','root'), good=file('good');
  root.session.role='unknown';
  assert.equal(project([child,root,good]).evidence.days[0].processed,125_000_001);
  assert.equal(project([good,root,child]).evidence.days[0].processed,125_000_001);
  assert.equal(money([child,root,good]).completedMondayWeekPeak,1_000_000_040);
});
