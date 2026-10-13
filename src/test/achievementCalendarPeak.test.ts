import { test } from 'node:test';
import * as assert from 'node:assert/strict';

const calendar = require('../achievementCalendar') as any;

test('retained calendar peak is bounded numeric evidence tied to current rules, parser, zone and providers', () => {
  const context = calendar.calendarPeakContext('UTC', true, true);
  const saved = calendar.updateCalendarPeakEvidence(undefined, context, 2_000_000_000, true);
  assert.equal(saved.peakFourWeekAverage, 2_000_000_000);
  assert.equal(calendar.readCalendarPeakEvidence(saved, context, true), 2_000_000_000);
  assert.equal(calendar.readCalendarPeakEvidence(saved, context, false), 0);
  for (const change of [
    { timeZone: 'Europe/Istanbul' }, { providers: 1 }, { parserVersion: context.parserVersion + 1 },
    { periodVersion: context.periodVersion + 1 }, { ruleVersion: context.ruleVersion + 1 },
  ]) assert.equal(calendar.readCalendarPeakEvidence(saved, { ...context, ...change }, true), 0);
  assert.equal(calendar.updateCalendarPeakEvidence(saved, context, 1_000_000_000, true), saved);
  assert.equal(calendar.updateCalendarPeakEvidence(saved, context, 9_000_000_000, false), saved);
  assert.equal(calendar.updateCalendarPeakEvidence(saved, context, 3_000_000_000, true).peakFourWeekAverage, 3_000_000_000);
  assert.equal(calendar.updateCalendarPeakEvidence(saved, { ...context, timeZone: 'Europe/Istanbul' }, 0, true), saved);
  assert.equal(calendar.updateCalendarPeakEvidence(saved, { ...context, timeZone: 'Europe/Istanbul' }, 500_000_000, true).peakFourWeekAverage, 500_000_000);
  assert.ok(JSON.stringify(saved).length < 512, 'one context and one maximum, not an unbounded history');
});

test('malformed calendar maxima and unknown storage fields cannot become award proof', () => {
  const context = calendar.calendarPeakContext('UTC', false, true);
  const valid = calendar.updateCalendarPeakEvidence(undefined, context, 10, true);
  for (const value of [null, [], {}, { ...valid, schemaVersion: 2 }, { ...valid, peakFourWeekAverage: -1 },
    { ...valid, peakFourWeekAverage: Infinity }, { ...valid, peakFourWeekAverage: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, timeZone: 'invalid/zone' }, { ...valid, providers: 0 }, { ...valid, parserVersion: '4' }]) {
    assert.equal(calendar.parseCalendarPeakEvidence(value), undefined);
    assert.equal(calendar.readCalendarPeakEvidence(value, context, true), 0);
  }
  assert.deepEqual(calendar.parseCalendarPeakEvidence({ ...valid, prompt: 'discard', path: 'discard' }), valid);
  for (const volume of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    assert.equal(calendar.updateCalendarPeakEvidence(undefined, context, volume, true), undefined);
  }
});

test('Claude-only retained peaks ignore unrelated Codex versions but retain zone, rules and completeness fences',()=>{
  const context=calendar.calendarPeakContext('UTC',true,false);
  const saved=calendar.updateCalendarPeakEvidence(undefined,context,4_900_000_000,true);
  const revised={...context,parserVersion:context.parserVersion+1,periodVersion:context.periodVersion+1};
  assert.equal(calendar.readCalendarPeakEvidence(saved,revised,true),4_900_000_000);
  assert.equal(calendar.readCalendarPeakEvidence(saved,revised,false),0);
  for(const change of [{timeZone:'Asia/Shanghai'},{ruleVersion:context.ruleVersion+1},{providers:3}])
    assert.equal(calendar.readCalendarPeakEvidence(saved,{...revised,...change},true),0);
});

test('a complete flag alone does not certify duplicated or malformed normalized day evidence', () => {
  const day = { day: '2026-08-31', processed: 8_000_000_000, output: 1, models: {} };
  const input = { claude: { complete: true, days: [], timeZone: 'UTC' },
    codex: { complete: true, days: [day], timeZone: 'UTC' }, asOfDay: '2026-09-28' };
  assert.equal(calendar.achievementCalendarSignals(input).peakEvidenceComplete, true);
  assert.equal(calendar.achievementCalendarSignals({ ...input,
    codex: { ...input.codex, days: [day, day] } }).peakEvidenceComplete, false);
  assert.equal(calendar.achievementCalendarSignals({ ...input,
    codex: { ...input.codex, complete: false } }).peakEvidenceComplete, false);
});
