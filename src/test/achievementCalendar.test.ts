import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CODEX_PERIOD_LINEAGE_VERSION } from '../providers/codex/codexPeriodIndex';

// Dynamic access makes the first red run a behavioral failure, not a compile failure.
const calendar = require('../achievementCalendar') as any;
const day = (date: string, processed = 1_000_000, output = 1, model = 'gpt-6-astra') => ({
  day: date, processed, output, models: { [model]: { processed, output } },
});
const evidence = (days: unknown[], complete = true) => ({ days, complete, timeZone: 'UTC' });
const signals = (claude: unknown[], codex: unknown[], extra = {}) => calendar.achievementCalendarSignals({
  claude: evidence(claude), codex: evidence(codex), asOfDay: '2026-09-28', ...extra,
});

test('model output days need reconciled daily volume, output and exact family IDs', () => {
  const value = signals([], [day('2026-09-01'),
    day('2026-09-02', 999_999), day('2026-09-03', 1_000_000, 0),
    day('2026-09-04', 1_000_000, 1, 'custom-astra-proxy')]);
  assert.equal(value.familyDays.astra, 1);
  assert.equal(signals([day('2026-09-01', 1_000_000, 1, 'claude-opus-5')], []).familyDays.opus, 1);
  assert.equal(signals([], [day('2026-09-01')], { codex: evidence([day('2026-09-01')], false) }).familyDays.astra, 0);
});

test('calendar families share native namespace/date admission and reject custom suffixes', () => {
  const value = signals([], [
    day('2026-09-01', 1_000_000, 1, 'openai/gpt-6-sol'),
    day('2026-09-02', 1_000_000, 1, 'gpt-6-sol-20261001'),
    day('2026-09-03', 1_000_000, 1, 'gpt-6-sol-custom'),
  ]);
  assert.equal(value.familyDays.sol, 2);
  assert.equal(signals([], [day('2026-09-03', 1_000_000, 1, 'gpt-6-sol-custom')]).familyDays.sol, 0);
});

test('three-family and dual-provider milestones use same-day joined output evidence', () => {
  const rows = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'].map(model => day('2026-09-01', 1_000_000, 1, model));
  assert.equal(signals([], [{ day: '2026-09-01', processed: 3_000_000, output: 3,
    models: Object.assign({}, ...rows.map(row => row.models)) }]).threeFamilyDay, true);
  assert.equal(signals([], rows.map((row, index) => ({ ...row, day: `2026-09-0${index + 1}` }))).threeFamilyDay, false);
  assert.equal(signals([day('2026-09-01', 1_000_000, 1, 'claude-sonnet-5')], [day('2026-09-01')]).dualProviderDays, 1);
  assert.equal(signals([day('2026-09-01', 1_000_000, 0, 'claude-sonnet-5')], [day('2026-09-01')]).dualProviderDay, false);
  assert.equal(signals([day('2026-09-01', 1_000_000, 1, 'claude-sonnet-5')], [day('2026-09-02')]).dualProviderDays, 0);
});

test('normalized public calendar proof rejects duplicate dates and mismatched explicit zones', () => {
  assert.equal(signals([], [day('2026-09-01', 500_000), day('2026-09-01', 500_000)]).familyDays.astra, 0);
  assert.equal(signals([], [day('2026-09-01')], {
    claude: { ...evidence([]), timeZone: 'Europe/Istanbul' },
  }).familyDays.astra, 0);
});

test('Fable qualifies in the same seven-family daily system, while tiny output cannot manufacture active weeks', () => {
  const models = Object.fromEntries(['claude-fable-5-1', 'claude-sonnet-5', 'claude-opus-5']
    .map(model => [model, { processed: 1_000_000, output: 1 }]));
  const value = signals([{ day: '2026-09-01', processed: 3_000_000, output: 3, models }], []);
  assert.equal(value.threeFamilyDay, true);
  assert.equal(value.familyDays.fable, 1);
  assert.equal(signals(['01', '02', '03', '04'].map(date =>
    day(`2026-09-${date}`, 999_999, 1, 'claude-sonnet-5')), []).activeWeeks, 0);
});

test('highest weekly average needs four closed consecutive calendar weeks and includes zero weeks', () => {
  const rows = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'].map(date => day(date, 2_000_000_000));
  assert.equal(signals([], rows).peakFourWeekAverage, 2_000_000_000);
  assert.equal(signals([], rows.slice(1)).peakFourWeekAverage, 0, 'short history is not a four-week record');
  assert.equal(signals([], [rows[0], rows[3]]).peakFourWeekAverage, 1_000_000_000, 'inactive weeks stay in the denominator');
  assert.equal(signals([], [...rows, day('2026-09-28', 999_000_000_000)]).peakFourWeekAverage, 2_000_000_000, 'current week excluded');
  assert.equal(signals([], rows, { codex: evidence(rows, false) }).peakFourWeekAverage, 0);
});

test('calendar evidence rejects invalid dates, future days and unsafe totals', () => {
  const rows = [day('2026-02-30'), day('2026-10-01'), day('2026-09-01', Number.MAX_SAFE_INTEGER),
    day('2026-09-01', Number.MAX_SAFE_INTEGER), day('2026-09-02', -1)];
  assert.equal(signals([], rows).familyDays.astra, 0);
  assert.equal(signals([], rows).peakFourWeekAverage, 0);
});

test('active weeks require four distinct output days, not rows or input-only activity', () => {
  const rows = ['01', '02', '03', '04'].map(d => day(`2026-09-${d}`));
  assert.equal(signals([], rows).activeWeeks, 1);
  assert.equal(signals([], [rows[0], rows[0], rows[1], rows[2]]).activeWeeks, 0);
  assert.equal(signals([], rows.map(row => ({ ...row, output: 0 }))).activeWeeks, 0);
});

test('new calendar awards use closed days and malformed expected-provider evidence blocks the mean', () => {
  assert.equal(signals([], [day('2026-09-28')]).familyDays.astra, 0);
  const weeks = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'].map(date => day(date, 2_000_000_000));
  assert.equal(signals([day('2026-09-01', -1, 1, 'claude-sonnet-5')], weeks).peakFourWeekAverage, 0);
  assert.equal(signals([], [day('2026-09-01', 1_000_000, 1, 'gpt-6-astra-')]).familyDays.astra, 0);
});

test('Codex token proof validates lineage and subset components before new output/cache awards', () => {
  const total = { inputTotal: 120_000_000, cachedInput: 100_000_000, outputTotal: 1_000_000, reasoningOutput: 1_000_000 };
  const file = { total, byModel: { 'gpt-6-astra': total }, byDay: {}, byEffort: {},
    session: { sessionKey: 'one', role: 'root' }, structural: {} };
  const read = (files: any[], complete = true) => calendar.codexAchievementTokenEvidence(files, complete);
  assert.deepEqual(read([file]), { complete: true, output: 1_000_000, cachedInput: 100_000_000 });
  assert.equal(read([file], false).complete, false);
  assert.equal(read([file, file]).complete, false);
  assert.equal(read([{ ...file, session: { ...file.session, parentSessionKey: 'absent', role: 'subagent' } }]).complete, false);
  assert.equal(read([{ ...file, total: { ...total, cachedInput: 121_000_000 } }]).complete, false);
  assert.equal(read([{ ...file, total: { ...total, reasoningOutput: 1_000_001 } }]).complete, false);
});

test('Codex day proof rejects fallback UTC dates, wrong zones and malformed model buckets', () => {
  const total = { inputTotal: 999_999, outputTotal: 1, cachedInput: 900_000 };
  const slice = { total, byModel: { 'gpt-6-astra': total }, byEffort: {}, structural: {} };
  const file = { total, byDay: { '2026-09-01': total }, byModel: { 'gpt-6-astra': total },
    byEffort: {}, session: { sessionKey: 'one', role: 'root' }, structural: {},
    period: { timeZone: 'Europe/Istanbul', indexedThrough: 1, lineageVersion: 1, lineagePrefixEvents: 0,
      days: { '2026-09-01': slice } } };
  const read = (files: any[], complete = true) => calendar.codexAchievementDayEvidence(files, 'Europe/Istanbul', complete);
  assert.equal(read([file]).complete, true);
  assert.equal(read([file]).days[0].models['gpt-6-astra'].processed, 1_000_000);
  assert.equal(read([file], false).complete, false);
  assert.equal(read([{ ...file, period: undefined }]).complete, false);
  assert.equal(read([{ ...file, period: { ...file.period, timeZone: 'UTC' } }]).complete, false);
  assert.equal(read([{ ...file, period: { ...file.period, days: { '2026-09-01': { ...slice,
    byModel: { 'gpt-6-astra': { inputTotal: 2_000_000, outputTotal: 1 } } } } } }]).complete, false);
  assert.equal(read([file, file]).complete, false, 'duplicate session copies cannot manufacture output days');
});

const zone = 'America/New_York';
const tokens = (inputTotal = 999_999, outputTotal = 1) => ({ inputTotal, outputTotal });
const file = (sessionKey = 'root', total: any = tokens()): any => ({
  total, byModel: { 'gpt-6-astra': total }, byDay: {}, byEffort: {},
  session: { sessionKey, role: 'root' }, structural: {},
  period: { timeZone: zone, indexedThrough: 1, lineageVersion: CODEX_PERIOD_LINEAGE_VERSION,
    lineagePrefixEvents: 0, days: { '2026-09-01': { total, byModel: { 'gpt-6-astra': total }, byEffort: {}, structural: {} } } },
});
const dayProof = (files: any[], complete = true, timeZone = zone) =>
  calendar.codexAchievementDayEvidence(files, timeZone, complete);
const tokenProof = (files: any[], complete = true) => calendar.codexAchievementTokenEvidence(files, complete);
const fourWeeks = () => ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'].map(date => day(date, 2_000_000_000));
const claudeRow = (date = '2026-09-01'): any => ({
  date, data: { totalInputTokens: 100_000, totalOutputTokens: 1, totalCacheCreationTokens: 200_000, totalCacheReadTokens: 699_999,
  totalCost: 0.1, costBreakdown: { input: 0.01, output: 0.01, cacheWrite: 0.03, cacheRead: 0.05 }, messageCount: 1,
  modelBreakdown: { 'claude-sonnet-5': { inputTokens: 100_000, outputTokens: 1,
    cacheCreationTokens: 200_000, cacheReadTokens: 699_999, cost: 0.1, count: 1 } } },
});

test('current and future civil days cannot prove family, dual-provider or three-family days', () => {
  for (const date of ['2026-09-28', '2026-09-29']) {
    const value = signals([day(date, 1_000_000, 1, 'claude-sonnet-5')],
      ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'].map(model => day(date, 1_000_000, 1, model)));
    assert.equal(value.familyDays.astra, 0);
    assert.equal(value.familyDays.sonnet, 0);
    assert.equal(value.dualProviderDays, 0);
    assert.equal(value.threeFamilyDay, false);
  }
});

test('malformed complete provider blocks the combined mean; verified complete-empty permits it', () => {
  const weeks = fourWeeks();
  assert.equal(signals([], weeks).peakFourWeekAverage, 2_000_000_000);
  for (const bad of [day('2026-09-01', -1), day('2026-02-30'), day('2026-09-01', 0.5)]) {
    assert.equal(signals([bad], weeks).peakFourWeekAverage, 0);
    assert.equal(signals(weeks, [bad]).peakFourWeekAverage, 0);
  }
  assert.equal(signals([], weeks, { claude: evidence([], false) }).peakFourWeekAverage, 0);
  assert.equal(signals([], weeks, { claude: { complete: true, days: null } }).peakFourWeekAverage, 0);
});

test('malformed rows and models fail closed without discarding the other provider family proof', () => {
  for (const bad of [null, {}, { ...day('2026-09-01'), models: null },
    { ...day('2026-09-01'), models: { 'gpt-6-astra': null } }]) {
    const value = signals([day('2026-09-01', 1_000_000, 1, 'claude-opus-5')], [bad]);
    assert.equal(value.familyDays.opus, 1);
    assert.equal(value.familyDays.astra, 0);
    assert.equal(value.dualProviderDays, 0);
  }
});

test('unsafe daily originals and duplicate-date overflow invalidate expected-provider proof', () => {
  const badRows = [
    [day('2026-09-01', NaN)], [day('2026-09-01', Infinity)],
    [day('2026-09-01', Number.MAX_SAFE_INTEGER + 1)],
    [day('2026-09-01', Number.MAX_SAFE_INTEGER), day('2026-09-01', 1)],
    [{ ...day('2026-09-01'), models: { 'gpt-6-astra': { processed: 0.5, output: 0 } } }],
    [{ ...day('2026-09-01'), models: { 'gpt-6-astra': { processed: 1_000_001, output: 1 } } }],
  ];
  for (const rows of badRows) {
    assert.equal(signals(fourWeeks(), rows).peakFourWeekAverage, 0);
    assert.equal(signals([], rows).familyDays.astra, 0);
  }
});

test('Codex family matching requires a complete named-model grammar before matching the prefix', () => {
  for (const model of ['gpt-6-astra-', 'gpt-6-sol--max', 'gpt-6-luna/preview',
    'gpt-6-astra-☀', 'gpt-6-astra-hello world', 'gpt-6-astra.proxy', 'gpt-6-astra-max_1',
    'gpt-6.1-astra-max-2', ' GPT-6.1-ASTRA-MAX ']) {
    const value = signals([], [day('2026-09-01', 1_000_000, 1, model)]);
    assert.equal(Object.values(value.familyDays).reduce((a: number, b: any) => a + b, 0), 0, model);
  }
  // Effort is a separate field, not evidence for an arbitrary model suffix.
  for (const model of ['gpt-6-astra', 'gpt-6.1-astra-20261001', ' GPT-6.1-ASTRA ']) {
    assert.equal(signals([], [day('2026-09-01', 1_000_000, 1, model)]).familyDays.astra, 1, model);
  }
  assert.equal(signals([day('2026-09-01', 1_000_000, 1, 'claude-fable-5')], []).threeFamilyDay, false);
  assert.deepEqual(Object.keys(signals([], []).familyDays).sort(), ['astra', 'fable', 'haiku', 'luna', 'opus', 'sol', 'sonnet']);
});

test('civil Mondays and four-week means survive spring and autumn DST transitions', () => {
  for (const [dates, asOfDay] of [
    [['2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16'], '2026-03-23'],
    [['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'], '2026-11-09'],
  ] as const) {
    const rows = dates.map(date => day(date, 8_000_000));
    assert.equal(signals([], [], { asOfDay, claude: { ...evidence([]), timeZone: zone },
      codex: { ...evidence(rows), timeZone: zone } }).peakFourWeekAverage, 8_000_000);
  }
});

test('first partial week and current week are excluded from four-week windows', () => {
  const rows = [day('2026-08-25', 1_000_000_000_000), ...fourWeeks(), day('2026-09-28', 1_000_000_000_000)];
  assert.equal(signals([], rows).peakFourWeekAverage, 2_000_000_000);
  const currentWeek = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map(date => day(date));
  assert.equal(signals([], currentWeek, { asOfDay: '2026-10-02' }).activeWeeks, 0);
});

test('four-week divisor includes leading, internal and trailing zero weeks', () => {
  assert.equal(signals([], [day('2026-08-31', 0, 0), day('2026-09-07', 8_000_000)]).peakFourWeekAverage, 0,
    'zero rows cannot invent an earlier history start');
  assert.equal(signals([], [day('2026-08-31', 8_000_000)]).peakFourWeekAverage, 2_000_000);
  assert.equal(signals([], [day('2026-08-31', 4_000_000), day('2026-09-21', 4_000_000)]).peakFourWeekAverage, 2_000_000);
});

test('peak four-week mean retains an older maximum and floors fractional averages', () => {
  const older = ['2025-12-01', '2025-12-08', '2025-12-15', '2025-12-22'].map(date => day(date, 80_000_000));
  assert.equal(signals([], [...older, ...fourWeeks().map(row => ({ ...row, processed: 1, output: 1, models: {} }))])
    .peakFourWeekAverage, 80_000_000);
  assert.equal(signals([], [day('2026-08-31', 7)]).peakFourWeekAverage, 1);
});

test('active weeks join providers by distinct date and need positive output', () => {
  const value = signals(['2026-09-01', '2026-09-02'].map(date => day(date, 1_000_000, 1, 'claude-sonnet-5')),
    ['2026-09-02', '2026-09-03', '2026-09-04'].map(date => day(date, 1_000_000)));
  assert.equal(value.activeWeeks, 1);
  assert.equal(signals([], ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']
    .map(date => day(date, 0, 0))).activeWeeks, 0);
});

test('Codex token proof distinguishes complete-empty, incomplete and malformed evidence', () => {
  assert.deepEqual(tokenProof([]), { complete: true, output: 0, cachedInput: 0 });
  assert.deepEqual(tokenProof([], false), { complete: false, output: 0, cachedInput: 0 });
  for (const bad of [null, {}, { ...file(), total: null }, { ...file(), session: null }]) {
    assert.deepEqual(tokenProof([bad]), { complete: false, output: 0, cachedInput: 0 });
    assert.deepEqual(tokenProof([file('valid'), bad]), { ...tokenProof([file('valid')]), lowerBound: true });
  }
});

test('canonical Codex roots and nested children can arrive in any order', () => {
  const root = file('root', { ...tokens(10, 4), cachedInput: 7, reasoningOutput: 3 });
  const child = file('child', { ...tokens(5, 2), cachedInput: 2 });
  child.session = { sessionKey: 'child', parentSessionKey: 'root', role: 'subagent' };
  const grandchild = file('grandchild', tokens(1, 1));
  grandchild.session = { sessionKey: 'grandchild', parentSessionKey: 'child', role: 'approval-reviewer' };
  assert.deepEqual(tokenProof([grandchild, child, root]), { complete: true, output: 7, cachedInput: 9 });
  assert.equal(dayProof([grandchild, child, root]).complete, true);
  assert.equal(dayProof([grandchild, child, root]).days[0].processed, 23);
});

test('Codex calendar rejects bad ancestry; token proof withholds only affected branches', () => {
  const root = file();
  const child = file('child');
  child.session = { sessionKey: 'child', parentSessionKey: 'root', role: 'subagent' };
  const cycleRoot = { ...root, session: { ...root.session, parentSessionKey: 'child' } };
  const cases = [
    [root, root], [child], [root, { ...child, session: { ...child.session, parentSessionKey: 'absent' } }],
    [{ ...root, session: { ...root.session, parentSessionKey: 'root' } }], [cycleRoot, child],
    [{ ...child, session: { sessionKey: 'child', role: 'subagent' } }],
    [{ ...child, session: { sessionKey: 'child', role: 'approval-reviewer' } }],
    [{ ...root, session: { ...root.session, sessionKey: '' } }],
    [{ ...root, session: { ...root.session, sessionKey: ' ' } }],
    [{ ...root, session: { ...root.session, parentSessionKey: '' } }],
  ];
  for (const files of cases) {
    const safeRootSurvives = files.length === 2 && files[0] === root && files[1].session.parentSessionKey === 'absent';
    assert.equal(tokenProof(files).complete, safeRootSurvives);
    if (safeRootSurvives) assert.deepEqual(tokenProof(files), { ...tokenProof([root]), lowerBound: true });
    assert.equal(dayProof(files).complete, false);
  }
});

test('token proof rejects unsafe original components, impossible subsets and aggregate overflow', () => {
  for (const field of ['inputTotal', 'outputTotal', 'cachedInput', 'reasoningOutput', 'cacheWriteInput', 'sourceTotal']) {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      assert.equal(tokenProof([file('bad', { ...tokens(10, 4), [field]: value })]).complete, false, `${field}: ${value}`);
    }
  }
  for (const bad of [{ ...tokens(10, 4), cachedInput: 11 }, { ...tokens(10, 4), reasoningOutput: 5 },
    tokens(Number.MAX_SAFE_INTEGER, 1)]) {
    assert.equal(tokenProof([file('bad', bad)]).complete, false);
  }
  assert.equal(tokenProof([file('one', tokens(Number.MAX_SAFE_INTEGER, 0)), file('two', tokens(1, 0))]).complete, false);
});

test('Codex file model originals and component sums must fit their aggregate', () => {
  for (const models of [null, { 'gpt-6-astra': tokens(0.5, 0) }, { 'gpt-6-astra': tokens(1_000_000, 1) },
    { one: tokens(500_000, 1), two: tokens(500_000, 1) },
    { 'gpt-6-astra': { ...tokens(), cachedInput: 1_000_000 } }]) {
    const bad = { ...file(), byModel: models };
    assert.equal(dayProof([bad]).complete, false);
    assert.equal(tokenProof([bad]).complete, false);
  }
});

test('Codex day evidence returns its exact zone for valid-empty and incomplete inputs', () => {
  assert.deepEqual(dayProof([]), { complete: true, days: [], timeZone: zone });
  assert.deepEqual(dayProof([], false), { complete: false, days: [], timeZone: zone });
  assert.equal(dayProof([file()]).timeZone, zone);
  for (const badZone of ['', 'Invalid/Zone']) {
    assert.deepEqual(dayProof([], true, badZone), { complete: false, days: [], timeZone: badZone });
  }
});

test('Codex daily proof requires current lineage marker and exact zone with no UTC fallback', () => {
  for (const period of [undefined, { ...file().period, lineageVersion: undefined },
    { ...file().period, lineageVersion: CODEX_PERIOD_LINEAGE_VERSION - 1 },
    { ...file().period, timeZone: 'UTC' }, { ...file().period, days: null }]) {
    assert.equal(dayProof([{ ...file(), byDay: { '2026-09-01': tokens() }, period }]).complete, false);
  }
});

test('Codex daily proof validates original day and model integers even if fractions add to integers', () => {
  for (const field of ['inputTotal', 'outputTotal', 'cachedInput', 'reasoningOutput']) {
    const bad = file('bad', { ...tokens(10, 4), cachedInput: 10, reasoningOutput: 4 });
    bad.period.days = Object.fromEntries(['2026-09-01', '2026-09-02'].map(date => [date, {
      total: { ...tokens(2, 2), [field]: 0.5 }, byModel: {}, byEffort: {}, structural: {},
    }]));
    assert.equal(dayProof([bad]).complete, false, field);
  }
  const bad = file();
  bad.period.days['2026-09-01'].byModel = { one: tokens(0.5, 0), two: tokens(0.5, 0) };
  assert.equal(dayProof([bad]).complete, false);
});

test('Codex period model totals across days must fit the same all-time model component buckets', () => {
  const bad = file('root', tokens(20, 10));
  bad.byModel = { 'gpt-6-astra': tokens(5, 2), 'gpt-6-sol': tokens(15, 8) };
  bad.period.days = Object.fromEntries(['2026-09-01', '2026-09-02'].map(date => [date, {
    total: tokens(4, 2), byModel: { 'gpt-6-astra': tokens(4, 2) }, byEffort: {}, structural: {},
  }]));
  assert.equal(dayProof([bad]).complete, false, 'each day fits, but the model period exceeds its file allowance');
  bad.byModel = { 'gpt-6-astra': tokens(8, 4), 'gpt-6-sol': tokens(12, 6) };
  assert.equal(dayProof([bad]).complete, false, 'valid dated subset is not exhaustive all-time coverage');
  assert.equal(dayProof([bad]).scope, 'verified-subset');
  assert.equal(dayProof([bad]).days.length, 2);
  bad.period.days['2026-09-02'].byModel = { 'gpt-6-luna': tokens(4, 2) };
  assert.equal(dayProof([bad]).complete, false, 'a period model missing from the file cannot prove a named family');
});

test('Codex daily model subsets and component sums must fit both day and file', () => {
  const bad = file('root', { ...tokens(10, 4), cachedInput: 2, reasoningOutput: 1 });
  bad.period.days['2026-09-01'].byModel = { 'gpt-6-astra': { ...tokens(10, 4), cachedInput: 3, reasoningOutput: 2 } };
  assert.equal(dayProof([bad]).complete, false);
  bad.period.days['2026-09-01'] = { total: { ...tokens(10, 4), cachedInput: 3, reasoningOutput: 2 },
    byModel: {}, byEffort: {}, structural: {} };
  assert.equal(dayProof([bad]).complete, false);
});

test('Codex dated containment permits a positive bound, but completeness requires all-time equality', () => {
  const valid = file('root', tokens(10, 4));
  const slice = { total: tokens(5, 2), byModel: { 'gpt-6-astra': tokens(5, 2) }, byEffort: {}, structural: {} };
  valid.period.days = { '2026-09-01': slice };
  assert.equal(dayProof([valid]).complete, false);
  assert.equal(dayProof([valid]).scope, 'verified-subset');
  assert.equal(dayProof([valid]).days.length, 1);
  valid.period.days['2026-09-02'] = slice;
  assert.equal(dayProof([valid]).complete, true);
  valid.period.days['2026-09-03'] = slice;
  assert.equal(dayProof([valid]).complete, false);
});

test('Codex daily proof rejects impossible dates and merged-day safe-integer overflow', () => {
  const bad = file();
  bad.period.days = { '2026-02-30': bad.period.days['2026-09-01'] };
  assert.equal(dayProof([bad]).complete, false);
  assert.equal(dayProof([file('one', tokens(Number.MAX_SAFE_INTEGER, 0)), file('two', tokens(1, 0))]).complete, false);
  const lastDay = file();
  lastDay.period.days = { '9999-12-31': lastDay.period.days['2026-09-01'] };
  assert.equal(dayProof([lastDay]).days[0].day, '9999-12-31');
});

test('Codex daily proof requires both current lineage version and a valid prefix marker', () => {
  for (const prefix of [undefined, -1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const malformed = file();
    malformed.period.lineagePrefixEvents = prefix;
    assert.equal(dayProof([malformed]).complete, false);
  }
  const old = file();
  old.period.lineageVersion = undefined;
  assert.equal(dayProof([old]).complete, false);
});

test('Codex proof preserves unattributed and unknown-model volume without inventing named days', () => {
  const valid = file();
  valid.byModel = {};
  valid.period.days['2026-09-01'].byModel = {};
  assert.equal(dayProof([valid]).complete, true);
  assert.deepEqual(tokenProof([valid]), { complete: true, output: 1, cachedInput: 0 });
  assert.equal(signals([], dayProof([valid]).days).familyDays.astra, 0);
});

test('Claude numeric day adapter sums its four disjoint buckets and returns the supplied zone', () => {
  const value = calendar.claudeAchievementDayEvidence([claudeRow()], zone, true);
  assert.deepEqual(value, { complete: true, timeZone: zone, days: [
    day('2026-09-01', 1_000_000, 1, 'claude-sonnet-5'),
  ] });
  assert.deepEqual(calendar.claudeAchievementDayEvidence([], zone, true), { complete: true, timeZone: zone, days: [] });
  assert.deepEqual(calendar.claudeAchievementDayEvidence([claudeRow()], zone, false), { complete: false, timeZone: zone, days: [] });
  const noModels = claudeRow();
  noModels.data.modelBreakdown = {};
  assert.deepEqual(calendar.claudeAchievementDayEvidence([noModels], zone, true).days[0].models, {});
});

test('Claude adapter validates original numeric components and per-component model containment', () => {
  for (const [field, totalField] of [['inputTokens', 'totalInputTokens'], ['outputTokens', 'totalOutputTokens'],
    ['cacheCreationTokens', 'totalCacheCreationTokens'], ['cacheReadTokens', 'totalCacheReadTokens']]) {
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const row = claudeRow();
      row.data[totalField] = invalid;
      assert.equal(calendar.claudeAchievementDayEvidence([row], zone, true).complete, false);
    }
    const row = claudeRow();
    row.data.modelBreakdown['claude-sonnet-5'][field] = row.data[totalField] + 1;
    assert.equal(calendar.claudeAchievementDayEvidence([row], zone, true).complete, false, field);
  }
  assert.equal(calendar.claudeAchievementDayEvidence([claudeRow('2026-02-30')], zone, true).complete, false);
  assert.equal(calendar.claudeAchievementDayEvidence([claudeRow()], 'Invalid/Zone', true).complete, false);
});

test('Claude identical numeric duplicate projections deduplicate, while conflicting duplicates fail closed', () => {
  const first = claudeRow();
  const same = claudeRow();
  same.data.totalCost = 999;
  same.data.modelBreakdown['claude-sonnet-5'].count = 9;
  assert.equal(calendar.claudeAchievementDayEvidence([first, same], zone, true).days[0].processed, 1_000_000);
  const different = claudeRow();
  different.data.totalInputTokens++;
  assert.deepEqual(calendar.claudeAchievementDayEvidence([first, different], zone, true),
    { complete: false, days: [], timeZone: zone });
  const differentModels = claudeRow();
  differentModels.data.modelBreakdown = { 'claude-opus-5': differentModels.data.modelBreakdown['claude-sonnet-5'] };
  assert.equal(calendar.claudeAchievementDayEvidence([first, differentModels], zone, true).complete, false);
});

test('Claude duplicate equality includes all four original buckets, not only processed and output', () => {
  const first = claudeRow();
  const swapped = claudeRow();
  swapped.data.totalInputTokens--;
  swapped.data.totalCacheReadTokens++;
  swapped.data.modelBreakdown['claude-sonnet-5'].inputTokens--;
  swapped.data.modelBreakdown['claude-sonnet-5'].cacheReadTokens++;
  assert.equal(calendar.claudeAchievementDayEvidence([first, swapped], zone, true).complete, false);
});

test('numeric adapters and calendar aggregation leave caller-owned inputs untouched', () => {
  const deepFreeze = (value: any): any => {
    if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  };
  const files = deepFreeze([file()]);
  assert.equal(dayProof(files).complete, true);
  assert.equal(tokenProof(files).complete, true);
  const rows = deepFreeze([claudeRow(), claudeRow()]);
  const projected = calendar.claudeAchievementDayEvidence(rows, zone, true);
  assert.equal(projected.days.length, 1);
  assert.equal(projected.days[0].processed, 1_000_000);
  assert.equal(signals([], deepFreeze(dayProof(files).days)).familyDays.astra, 1);
});
