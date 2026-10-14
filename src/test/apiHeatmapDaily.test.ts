import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiHeatmapDailyRange, buildApiHeatmapDaily } from '../apiHeatmapDaily';
import { buildApiHeatmapArtifact, normalizeApiHeatmapConfig } from '../apiHeatmap';
import { addCalendarDays } from '../combinedHeatmap';
import type { CodexDailyUsageView } from '../providers/codex/codexUsage';
import type { UsageData } from '../types';

const date = '2026-10-12';
const range: ApiHeatmapDailyRange = {
  startDateISO: date, endDateISO: date, timezone: 'Asia/Shanghai',
  provider: 'both', metric: 'apiEquivalent', showAmounts: true,
};
type Model = UsageData['modelBreakdown'][string];
const model = (inputTokens: number, cost: number, count = 1): Model => ({
  inputTokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost, count,
});
const usage = (models: Record<string, Model> = { 'claude-sonnet-next[1m]': model(100, 12.345) }, totalCost = 12.345): UsageData => ({
  totalInputTokens: 100, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
  totalCost, costBreakdown: { input: totalCost, output: 0, cacheWrite: 0, cacheRead: 0 },
  messageCount: 0, modelBreakdown: models,
});
const claude = (data = usage(), day = date) => ({ date: day, data });
const codex = (processed = 100, equivalentUsd = 7, pricedTokens = processed, totalTokens = processed, day = date): CodexDailyUsageView => ({
  day, total: { processed, input: processed, output: 0, cachedInput: 0, reasoning: 0, fresh: processed },
  apiEquivalent: { equivalentUsd, pricedTokens, totalTokens, pricingCoverage: 999,
    freshInputUsd: equivalentUsd, cachedInputUsd: 0, outputUsd: 0 },
  threads: 1, childThreads: 0, approvalReviewerThreads: 0,
});
const dto = (tokens: number, amountUSD: number | null, pricingStatus: 'empty' | 'unpriced' | 'partial' | 'complete',
  estimated: boolean, pricedCount = 0, unpricedCount = 0) =>
  ({ tokens, amountUSD, pricingStatus, estimated, pricedCount, unpricedCount });
const trap = (object: object, keys: string[]) => {
  for (const key of keys) Object.defineProperty(object, key, { enumerable: true, configurable: true,
    get() { throw new Error(`unexpected read: ${key}`); } });
};

test('current Claude amount is preserved exactly; fallbacks/overrides stay estimated without TTL or repricing', () => {
  const input = usage({ 'proxy/claude-sonnet-next[1m]': model(100, 0.30000000000000004) }, 0.3);
  trap(input.modelBreakdown['proxy/claude-sonnet-next[1m]'], ['referenceUsage', 'pricebookVersion', 'path']);
  trap(input, ['costBreakdown', 'records', 'sessionId']);
  assert.deepEqual(buildApiHeatmapDaily([claude(input)], [], { ...range, provider: 'claude' })[date]?.claude,
    dto(100, 0.3, 'complete', true, 100));
});

test('all four Claude processed-token components add once and coverage uses the same token unit', () => {
  const part = { ...model(10, 2), outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40 };
  const input = { ...usage({ 'claude-fable-next': part }, 2),
    totalInputTokens: 10, totalOutputTokens: 20, totalCacheCreationTokens: 30, totalCacheReadTokens: 40 };
  assert.deepEqual(buildApiHeatmapDaily([claude(input)], [], range)[date]?.claude,
    dto(100, 2, 'complete', true, 100));
});

test('absent day is empty; present true zero is complete; missing estimate/buckets and unknown model are unpriced', () => {
  const empty = buildApiHeatmapDaily([], [], range);
  assert.deepEqual(empty[date]?.claude, dto(0, null, 'empty', true));
  assert.deepEqual(empty[date]?.codex, dto(0, null, 'empty', false));
  const zero = { ...usage({}, 0), totalInputTokens: 0 };
  assert.deepEqual(buildApiHeatmapDaily([claude(zero)], [codex(0, 0)], range)[date], {
    claude: dto(0, 0, 'complete', true), codex: dto(0, 0, 'complete', false),
  });
  for (const input of [usage({}, 3), usage({ '<unknown>': model(100, 9) }, 9),
    usage({ '': model(100, 9) }, 9), { ...usage(), totalCost: undefined } as unknown as UsageData,
    { ...usage(), modelBreakdown: undefined } as unknown as UsageData]) {
    assert.deepEqual(buildApiHeatmapDaily([claude(input)], [], range)[date]?.claude,
      dto(100, null, 'unpriced', true, 0, 100));
  }
});

test('Claude partial pricing sums identifiable model costs and retains unpriced token/component gaps', () => {
  const cases: Record<string, Model>[] = [
    { 'claude-sonnet-next': model(60, 2), '<unknown>': model(40, 9) },
    { 'claude-sonnet-next': model(60, 2) },
    { 'claude-sonnet-next': model(60, 2), 'claude-opus-next': { ...model(40, 0), cost: undefined } as unknown as Model },
  ];
  for (const models of cases) assert.deepEqual(buildApiHeatmapDaily([claude(usage(models, 11))], [], range)[date]?.claude,
    dto(100, 2, 'partial', true, 60, 40));
  const componentGap = { ...usage({ 'claude-sonnet-next': model(100, 3) }, 3), totalCacheCreationTokens: 50 };
  assert.deepEqual(buildApiHeatmapDaily([claude(componentGap)], [], range)[date]?.claude,
    dto(150, 3, 'partial', true, 100, 50));
  assert.deepEqual(buildApiHeatmapDaily([claude(usage({ 'claude-sonnet-next': model(100, 0) }, 0))], [], range)[date]?.claude,
    dto(100, 0, 'complete', true, 100));
});

test('Codex keeps the current exact-model subtotal and token denominator without using pricingCoverage or repricing', () => {
  const input = codex(100, 0.123456, 80, 120);
  trap(input.apiEquivalent, ['pricingCoverage', 'freshInputUsd', 'cachedInputUsd', 'outputUsd', 'model', 'pricebookVersion']);
  trap(input.total, ['cachedInput', 'reasoning', 'input', 'fresh', 'output']);
  trap(input, ['threads', 'records', 'sessionKey']);
  assert.deepEqual(buildApiHeatmapDaily([], [input], range)[date]?.codex,
    dto(100, 0.123456, 'partial', false, 80, 40));
  assert.deepEqual(buildApiHeatmapDaily([], [codex(100, 0, 100)], range)[date]?.codex,
    dto(100, 0, 'complete', false, 100));
  assert.deepEqual(buildApiHeatmapDaily([], [codex(100, 0, 0)], range)[date]?.codex,
    dto(100, null, 'unpriced', false, 0, 100));
  const missing = { ...codex(), apiEquivalent: undefined } as unknown as CodexDailyUsageView;
  assert.deepEqual(buildApiHeatmapDaily([], [missing], range)[date]?.codex,
    dto(100, null, 'unpriced', false, 0, 100));
});

test('Token and hidden projections never read costs, model costs/counts, or Codex pricing getters', () => {
  const left = usage();
  trap(left, ['totalCost', 'costBreakdown', 'modelBreakdown', 'messageCount', 'records']);
  const right = codex();
  trap(right, ['apiEquivalent', 'records', 'models']);
  for (const override of [{ metric: 'tokens' as const }, { showAmounts: false }, { hideAmounts: true }]) {
    const output = buildApiHeatmapDaily([claude(left)], [right], { ...range, ...override });
    assert.equal(output[date]?.claude?.tokens, 100);
    assert.equal(output[date]?.codex?.tokens, 100);
    assert.equal(output[date]?.claude?.amountUSD, null);
    assert.equal(output[date]?.codex?.amountUSD, null);
  }
});

test('selected provider is the only source touched, including array access', () => {
  const forbidden = new Proxy([], { get() { throw new Error('unselected provider'); } });
  assert.equal(buildApiHeatmapDaily([claude()], forbidden, { ...range, provider: 'claude' })[date]?.claude?.amountUSD, 12.345);
  assert.deepEqual(Object.keys(buildApiHeatmapDaily([claude()], forbidden, { ...range, provider: 'claude' })[date]!), ['claude']);
  assert.equal(buildApiHeatmapDaily(forbidden, [codex()], { ...range, provider: 'codex' })[date]?.codex?.amountUSD, 7);
});

test('bounded 366-day selection reads only selected payloads and uses logarithmic date-key lookup over history', () => {
  let dateReads = 0;
  let payloadReads = 0;
  const rows = Array.from({ length: 2000 }, (_, index) => {
    const day = addCalendarDays('2027-01-01', -index);
    return Object.defineProperties({}, {
      date: { get() { dateReads++; return day; } },
      data: { get() {
        assert.ok(day >= '2026-01-01' && day <= '2026-12-31', `old/future payload: ${day}`);
        payloadReads++;
        return usage();
      } },
    }) as { date: string; data: UsageData };
  });
  const output = buildApiHeatmapDaily(rows, [], { ...range, startDateISO: '2026-01-01', endDateISO: '2026-12-31', provider: 'claude' });
  assert.equal(Object.keys(output).length, 365);
  assert.equal(payloadReads, 365);
  assert.ok(dateReads < 400, `date-key scans: ${dateReads}`);
  const leap = buildApiHeatmapDaily([], [], { ...range, startDateISO: '2024-01-01', endDateISO: '2024-12-31' });
  assert.equal(Object.keys(leap).length, 366);
  assert.equal(leap['2024-02-29']?.claude?.pricingStatus, 'empty');
});

test('canonical range validation uses supplied dates/zone, never an implicit clock or widened history', () => {
  for (const change of [
    { startDateISO: '2026-02-30' }, { endDateISO: '2026-2-01' },
    { startDateISO: '2026-10-13' }, { startDateISO: '2025-01-01' }, { timezone: '/Users/private' },
  ]) assert.throws(() => buildApiHeatmapDaily([], [], { ...range, ...change }));
  const config = normalizeApiHeatmapConfig({ endDateISO: date, range: '30d', provider: 'both',
    metric: 'apiEquivalent', showAmounts: true, timezone: range.timezone });
  assert.equal(config.timezone, 'Asia/Shanghai');
  const output = buildApiHeatmapDaily([claude()], [codex()], config);
  assert.equal(Object.keys(output).length, 30);
  assert.equal(output[date]?.claude?.amountUSD, 12.345);
  assert.ok(Object.keys(output).every(key => key >= config.startDateISO && key <= config.endDateISO));
});

test('daily fixed-offset validation follows runtime support without rebucketing or repricing', () => {
  const expected = buildApiHeatmapDaily([claude()], [codex()], range);
  const unreadable = new Proxy([], { get() { throw new Error('invalid zone must reject before source access'); } });
  for (const timezone of ['+08:00', '+0530', '-03:30']) {
    let supported = false;
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
      supported = true;
    } catch (error) {
      assert.ok(error instanceof RangeError);
    }
    if (supported) {
      assert.deepEqual(buildApiHeatmapDaily([claude()], [codex()], { ...range, timezone }), expected,
        `${timezone}: supplied civil-date buckets and prices must stay identical`);
    } else {
      assert.throws(() => buildApiHeatmapDaily(unreadable, unreadable, { ...range, timezone }), RangeError,
        `${timezone}: unsupported offsets must not silently use the system zone`);
    }
  }
  for (const timezone of ['+99:99', '+24:00', '+08:60', 'UTC+08:00', '<script>', '/Users/private']) {
    assert.throws(() => buildApiHeatmapDaily(unreadable, unreadable, { ...range, timezone }), RangeError);
  }
  for (const timezone of ['', '   ']) {
    assert.throws(() => buildApiHeatmapDaily(unreadable, unreadable, { ...range, timezone }), /zone must be supplied/);
  }
});

test('canonical upper-year ranges stop on the supplied end day without stepping outside the date contract', () => {
  for (const startDateISO of ['9999-12-31', '9999-01-01']) {
    const output = buildApiHeatmapDaily([], [], { ...range, startDateISO, endDateISO: '9999-12-31' });
    assert.equal(Object.keys(output).length, startDateISO === '9999-12-31' ? 1 : 365);
    const keys = Object.keys(output);
    assert.equal(keys[keys.length - 1], '9999-12-31');
  }
});

test('equal duplicate dates deduplicate; conflicting projected scalars withhold amounts independent of order', () => {
  const first = claude();
  const equal = claude();
  trap(equal, ['privateId']);
  const baseline = buildApiHeatmapDaily([first], [codex()], range);
  assert.deepEqual(buildApiHeatmapDaily([first, equal], [codex(), codex()], range), baseline);
  const conflict = claude(usage(undefined, 100));
  for (const duplicates of [[first, conflict, equal], [equal, conflict, first]]) {
    const output = buildApiHeatmapDaily(duplicates, [codex()], range);
    assert.deepEqual(output[date]?.claude, dto(100, null, 'unpriced', true, 0, 100));
    assert.deepEqual(output[date]?.codex, baseline[date]?.codex);
  }
  assert.deepEqual(buildApiHeatmapDaily([first, conflict], [], { ...range, metric: 'tokens' })[date]?.claude?.tokens, 100);
  const output = buildApiHeatmapDaily([first], [codex(), codex(101), codex()], range);
  assert.deepEqual(output[date]?.codex, dto(101, null, 'unpriced', false, 0, 101));
});

test('conflicting positive days remain unpriced while an absent day stays empty, including rendered cell styles', () => {
  const previousDate = '2026-10-11';
  const output = buildApiHeatmapDaily([claude(), claude(usage(undefined, 100))],
    [codex(), codex(101)], { ...range, startDateISO: previousDate });
  for (const provider of ['claude', 'codex'] as const) {
    const conflict = output[date]![provider]!;
    const absent = output[previousDate]![provider]!;
    assert.equal(conflict.pricingStatus, 'unpriced');
    assert.equal(conflict.amountUSD, null);
    assert.ok(conflict.tokens > 0);
    assert.equal(conflict.pricedCount, 0);
    assert.deepEqual(absent, dto(0, null, 'empty', provider === 'claude'));
    const artifact = buildApiHeatmapArtifact(output, { endDateISO: date, range: '30d', provider,
      timezone: range.timezone, metric: 'apiEquivalent', showAmounts: true });
    const renderedCell = (day: string) => artifact.svg.match(new RegExp(`<rect[^>]*><title>${day}[^<]*<\\/title><\\/rect>`))?.[0] ?? '';
    assert.match(renderedCell(date), /fill="#d1d5db".*Unpriced/);
    assert.match(renderedCell(previousDate), /fill="#f6f8fa".*No data/);
    assert.doesNotMatch(artifact.summary, /\$/);
  }
});

test('conflict remains sticky across later duplicates and keeps maximum valid token/coverage bounds without summing', () => {
  const largerClaude = claude({ ...usage({ known: model(200, 3) }, 3), totalInputTokens: 200 });
  const claudeRows = [claude(), claude(usage(undefined, 100)), largerClaude];
  const codexRows = [codex(), codex(101, 8, 101, 120), codex(200, 7, 100, 240)];
  const baseline = buildApiHeatmapDaily(claudeRows, codexRows, range);
  assert.deepEqual(baseline[date], {
    claude: dto(200, null, 'unpriced', true, 0, 200),
    codex: dto(200, null, 'unpriced', false, 0, 240),
  });
  for (const rows of [claudeRows.slice().reverse(), [claudeRows[0], claudeRows[2], claudeRows[1]]]) {
    for (const right of [codexRows.slice().reverse(), [codexRows[0], codexRows[2], codexRows[1]]]) {
      assert.deepEqual(buildApiHeatmapDaily(rows, right, range), baseline);
    }
  }
});

test('hidden conflicting tokens retain the maximum and never read pricing even after conflict detection', () => {
  const claudeRows = [100, 101, 200].map(tokens => claude({ ...usage(), totalInputTokens: tokens }));
  const codexRows = [100, 101, 200].map(tokens => codex(tokens));
  for (const row of claudeRows) trap(row.data, ['totalCost', 'modelBreakdown', 'costBreakdown']);
  for (const row of codexRows) trap(row, ['apiEquivalent']);
  const output = buildApiHeatmapDaily(claudeRows, codexRows, { ...range, hideAmounts: true });
  assert.deepEqual(output[date], {
    claude: dto(200, null, 'unpriced', true, 0, 200),
    codex: dto(200, null, 'unpriced', false, 0, 200),
  });
});

test('invalid pricing evidence is withheld, while invalid/overflowing token aggregates fail closed', () => {
  for (const value of [NaN, Infinity, -1, Number.MAX_VALUE]) {
    assert.equal(buildApiHeatmapDaily([claude(usage(undefined, value))], [], range)[date]?.claude?.pricingStatus, 'unpriced');
    assert.equal(buildApiHeatmapDaily([], [codex(100, value)], range)[date]?.codex?.pricingStatus, 'unpriced');
  }
  for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_VALUE]) {
    assert.throws(() => buildApiHeatmapDaily([claude({ ...usage(), totalInputTokens: value })], [], range));
    assert.throws(() => buildApiHeatmapDaily([], [codex(value)], range));
  }
  assert.throws(() => buildApiHeatmapDaily([claude({ ...usage(), totalInputTokens: Number.MAX_SAFE_INTEGER, totalOutputTokens: 1 })], [], range));
  for (const priced of [-1, 101, 0.5, NaN]) {
    assert.equal(buildApiHeatmapDaily([], [codex(100, 1, priced)], range)[date]?.codex?.pricingStatus, 'unpriced');
  }
  for (const bad of [model(101, 1), { ...model(100, 1), count: NaN }, model(100, Infinity)]) {
    assert.equal(buildApiHeatmapDaily([claude(usage({ known: bad }, 1))], [], range)[date]?.claude?.pricingStatus, 'unpriced');
  }
  const maximum = { ...usage(), totalInputTokens: Number.MAX_SAFE_INTEGER };
  assert.throws(() => buildApiHeatmapDaily([claude(maximum), claude(usage(), '2026-10-11')], [],
    { ...range, startDateISO: '2026-10-11', metric: 'tokens' }));
});

test('output contains only date/provider/aggregate fields and feeds the generator without cross-provider monetary sums', () => {
  const left = claude();
  const right = codex();
  trap(left, ['records', 'path', 'accountId']);
  trap(right, ['sessionId', 'sourceId', 'path']);
  const output = buildApiHeatmapDaily([left], [right], range);
  for (const part of Object.values(output[date]!)) {
    assert.deepEqual(Object.keys(part).sort(), ['amountUSD', 'estimated', 'pricedCount', 'pricingStatus', 'tokens', 'unpricedCount']);
  }
  const artifact = buildApiHeatmapArtifact(output, { endDateISO: date, range: '30d',
    timezone: range.timezone, metric: 'apiEquivalent', showAmounts: true });
  assert.match(artifact.summary, /Claude.*\$12\.35/);
  assert.match(artifact.summary, /Codex.*\$7\.00/);
  assert.doesNotMatch(artifact.svg, /\$19\.35|private|accountId|sourceId|sessionId/);
});
