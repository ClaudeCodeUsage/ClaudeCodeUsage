// Tests for the quota-window normalizer: the layer that reads Anthropic's
// generic `limits` array instead of the retired per-model fields.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  QuotaWindow,
  creditsFromUsage,
  groupQuotaRows,
  liveQuotaWindows,
  normalizeQuotaWindows,
  visibleQuotaWindows
} from '../quotaWindows';
import { ClaudeApiUsageResponse } from '../types';

const NOW = Date.parse('2026-08-03T12:00:00Z');
const H = 3600_000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

/** The shape observed live on 2026-08-03: the per-model fields are all null and
 * the real data lives in `limits`, whose scoped entry names "Fable". */
const MODERN: ClaudeApiUsageResponse = {
  five_hour: { utilization: 0, resets_at: null },
  seven_day: { utilization: 8, resets_at: at(80 * H) },
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [
    { kind: 'session', group: 'session', percent: 0, resets_at: null, scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 8, resets_at: at(80 * H), scope: null, is_active: false },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 16,
      resets_at: at(80 * H),
      scope: { model: { id: null, display_name: 'Fable' } },
      is_active: true
    }
  ]
};

/** The pre-2026-08 shape, still returned for some accounts. */
const LEGACY: ClaudeApiUsageResponse = {
  five_hour: { utilization: 6, resets_at: at(4 * H) },
  seven_day: { utilization: 1, resets_at: at(50 * H) },
  seven_day_opus: { utilization: 12, resets_at: at(50 * H) }
};

test('normalize reads the generic limits array, keyed off the API scope name', () => {
  const w = normalizeQuotaWindows(MODERN);
  assert.deepEqual(
    w.map((x: QuotaWindow) => [x.kind, x.scopeLabel, x.utilization]),
    [
      ['session', undefined, 0],
      ['weekly_all', undefined, 8],
      ['weekly_scoped', 'Fable', 16]
    ]
  );
  // The API's own is_active flag marks the binding window.
  assert.equal(w[2].isActive, true);
});

test('normalize does not double-count when legacy fields mirror limits', () => {
  // MODERN carries BOTH five_hour/seven_day AND limits with the same figures.
  const w = normalizeQuotaWindows(MODERN);
  assert.equal(w.filter((x: QuotaWindow) => x.kind === 'session').length, 1);
  assert.equal(w.filter((x: QuotaWindow) => x.kind === 'weekly_all').length, 1);
});

test('normalize falls back to legacy per-model fields when limits is absent', () => {
  const w = normalizeQuotaWindows(LEGACY);
  assert.deepEqual(
    w.map((x: QuotaWindow) => [x.kind, x.scopeLabel, x.utilization]),
    [
      ['session', undefined, 6],
      ['weekly_all', undefined, 1],
      ['weekly_scoped', 'Opus', 12]
    ]
  );
});

test('normalize ignores null per-model fields rather than emitting 0% rows', () => {
  // The 2026-08 regression: seven_day_opus is null, not absent. A truthiness
  // slip here would render a permanent "Opus 0%".
  const w = normalizeQuotaWindows(MODERN);
  assert.equal(w.some((x: QuotaWindow) => x.scopeLabel === 'Opus'), false);
});

test('normalize keeps an unknown weekly kind instead of dropping it', () => {
  // Forward compatibility: a future scoped kind we have never seen must still
  // surface, since the whole point is to stop hardcoding model names.
  const w = normalizeQuotaWindows({
    limits: [
      { kind: 'weekly_surface', group: 'weekly', percent: 30, resets_at: at(H), scope: { surface: 'cowork' }, is_active: false }
    ]
  } as ClaudeApiUsageResponse);
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'weekly_scoped');
  assert.equal(w[0].utilization, 30);
});

test('normalize tolerates a null / empty payload', () => {
  assert.deepEqual(normalizeQuotaWindows(null), []);
  assert.deepEqual(normalizeQuotaWindows({}), []);
  assert.deepEqual(normalizeQuotaWindows({ limits: [] } as ClaudeApiUsageResponse), []);
});

test('a null resets_at becomes an empty string, not "Invalid Date"', () => {
  // The session window has no reset until you send a message; /usage renders
  // "Starts when a message is sent".
  assert.equal(normalizeQuotaWindows(MODERN)[0].resetsAt, '');
});

test('liveQuotaWindows keeps current windows untouched', () => {
  const w = liveQuotaWindows(normalizeQuotaWindows(LEGACY), NOW);
  assert.equal(w.length, 3);
  assert.equal(w[0].utilization, 6);
});

test('liveQuotaWindows zeroes a just-rolled-over window and clears its reset', () => {
  const stale = normalizeQuotaWindows({
    five_hour: { utilization: 100, resets_at: at(-H) },
    seven_day: { utilization: 90, resets_at: at(-H) }
  });
  const w = liveQuotaWindows(stale, NOW);
  assert.deepEqual(w.map((x: QuotaWindow) => [x.utilization, x.resetsAt]), [[0, ''], [0, '']]);
});

test('liveQuotaWindows drops a window stale by more than two periods', () => {
  const stale = normalizeQuotaWindows({
    five_hour: { utilization: 100, resets_at: at(-11 * H) },
    seven_day: { utilization: 90, resets_at: at(-H) }
  });
  assert.deepEqual(liveQuotaWindows(stale, NOW).map((x: QuotaWindow) => x.kind), ['weekly_all']);
});

test('liveQuotaWindows rolls a scoped weekly on the weekly period, not the 5h one', () => {
  // A scoped weekly 11h stale is well inside two weekly periods, so it must
  // survive as 0% rather than being dropped like a 5h window would be.
  const stale = normalizeQuotaWindows({
    seven_day_opus: { utilization: 77, resets_at: at(-11 * H) }
  });
  const w = liveQuotaWindows(stale, NOW);
  assert.equal(w.length, 1);
  assert.equal(w[0].utilization, 0);
});

test('liveQuotaWindows keeps a window with no reset time', () => {
  const w = liveQuotaWindows(normalizeQuotaWindows(MODERN), NOW);
  assert.equal(w.length, 3);
  assert.equal(w[0].resetsAt, '');
});

test('credits prefer the spend block and convert minor units', () => {
  const c = creditsFromUsage({
    spend: {
      used: { amount_minor: 1234, currency: 'USD', exponent: 2 },
      limit: { amount_minor: 30000, currency: 'USD', exponent: 2 },
      percent: 4,
      enabled: true
    }
  } as ClaudeApiUsageResponse);
  assert.ok(c);
  assert.equal(c!.used, 12.34);
  assert.equal(c!.limit, 300);
  assert.equal(c!.currency, 'USD');
  assert.equal(c!.percent, 4);
});

test('credits fall back to extra_usage using its decimal_places', () => {
  const c = creditsFromUsage({
    extra_usage: { is_enabled: true, monthly_limit: 30000, used_credits: 500, currency: 'USD', decimal_places: 2 }
  } as ClaudeApiUsageResponse);
  assert.ok(c);
  assert.equal(c!.used, 5);
  assert.equal(c!.limit, 300);
  assert.equal(c!.percent, 500 / 30000 * 100);
});

test('credits derive a percent when the API omits it', () => {
  const c = creditsFromUsage({
    spend: {
      used: { amount_minor: 15000, currency: 'USD', exponent: 2 },
      limit: { amount_minor: 30000, currency: 'USD', exponent: 2 },
      enabled: true
    }
  } as ClaudeApiUsageResponse);
  assert.equal(c!.percent, 50);
});

test('credits are null only when the payload says nothing about them', () => {
  assert.equal(creditsFromUsage(null), null);
  assert.equal(creditsFromUsage({} as ClaudeApiUsageResponse), null);
  assert.equal(creditsFromUsage({ spend: {} } as ClaudeApiUsageResponse), null);
});

test('spend already incurred survives the credits toggle being switched off', () => {
  // Turning credits off does not un-spend the money, so the figure must not
  // vanish from the report. The caller hides the row when nothing was spent.
  const c = creditsFromUsage({
    spend: {
      used: { amount_minor: 4200, currency: 'USD', exponent: 2 },
      limit: { amount_minor: 30000, currency: 'USD', exponent: 2 },
      enabled: false
    }
  } as ClaudeApiUsageResponse);
  assert.equal(c!.used, 42);
  const legacy = creditsFromUsage({
    extra_usage: { is_enabled: false, monthly_limit: 30000, used_credits: 4200, decimal_places: 2 }
  } as ClaudeApiUsageResponse);
  assert.equal(legacy!.used, 42);
});

test('a cap that is absent, zero, or unlimited reports no percent', () => {
  // The cap can be raised, lowered, or removed entirely, so a display cannot
  // assume one exists. Amount stays; percent goes null rather than 0 or NaN.
  for (const spend of [
    { used: { amount_minor: 4200, exponent: 2 }, limit: { amount_minor: 0, exponent: 2 }, enabled: true },
    { used: { amount_minor: 4200, exponent: 2 }, limit: null, enabled: true },
    { used: { amount_minor: 4200, exponent: 2 }, enabled: true }
  ]) {
    const c = creditsFromUsage({ spend } as ClaudeApiUsageResponse);
    assert.equal(c!.used, 42, JSON.stringify(spend));
    assert.equal(c!.limit, null, JSON.stringify(spend));
    assert.equal(c!.percent, null, JSON.stringify(spend));
  }
});

test('an unlimited cap still reports through the legacy shape', () => {
  const c = creditsFromUsage({
    extra_usage: { is_enabled: true, monthly_limit: null, used_credits: 4200, decimal_places: 2 }
  } as ClaudeApiUsageResponse);
  assert.equal(c!.used, 42);
  assert.equal(c!.limit, null);
  assert.equal(c!.percent, null);
});


// Row grouping for the tooltip. The account-wide and per-model weekly caps roll
// over together, so printing the same reset on two rows wasted a line.

test('a per-model weekly cap folds into the all-models weekly row', () => {
  const rows = groupQuotaRows(normalizeQuotaWindows(MODERN));
  assert.deepEqual(rows.map((r) => r.window.kind), ['session', 'weekly_all']);
  assert.deepEqual(rows[1].scoped.map((s: QuotaWindow) => s.scopeLabel), ['Fable']);
});

test('folding tolerates the sub-minute skew between the two stamps', () => {
  // Observed live: the two caps are stamped either side of a minute boundary.
  const rows = groupQuotaRows([
    { kind: 'weekly_all', utilization: 8, decimals: 0, resetsAt: '2026-08-06T23:59:59.227Z', isActive: false },
    { kind: 'weekly_scoped', scopeLabel: 'Fable', utilization: 16, decimals: 0, resetsAt: '2026-08-07T00:00:00.227Z', isActive: true }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scoped.length, 1);
});

test('a scoped cap on its own schedule keeps its own row', () => {
  // Guards the merge: a future cap with a different cadence must never be
  // displayed under the all-models reset.
  const rows = groupQuotaRows([
    { kind: 'weekly_all', utilization: 8, decimals: 0, resetsAt: at(80 * H), isActive: false },
    { kind: 'weekly_scoped', scopeLabel: 'Fable', utilization: 16, decimals: 0, resetsAt: at(20 * H), isActive: true }
  ]);
  assert.deepEqual(rows.map((r) => r.window.kind), ['weekly_all', 'weekly_scoped']);
  assert.deepEqual(rows.map((r) => r.scoped.length), [0, 0]);
});

test('two not-yet-started weekly windows fold together', () => {
  const rows = groupQuotaRows([
    { kind: 'weekly_all', utilization: 0, decimals: 0, resetsAt: '', isActive: false },
    { kind: 'weekly_scoped', scopeLabel: 'Fable', utilization: 0, decimals: 0, resetsAt: '', isActive: false }
  ]);
  assert.equal(rows.length, 1);
});

test('a scoped cap with no all-models row to fold into stands alone', () => {
  const rows = groupQuotaRows(normalizeQuotaWindows({
    seven_day_opus: { utilization: 12, resets_at: at(50 * H) }
  }));
  assert.deepEqual(rows.map((r) => r.window.kind), ['weekly_scoped']);
});

test('credits carry a derived reset on the 1st of next month', () => {
  const c = creditsFromUsage({
    spend: {
      used: { amount_minor: 0, currency: 'USD', exponent: 2 },
      limit: { amount_minor: 30000, currency: 'USD', exponent: 2 },
      enabled: true
    }
  } as ClaudeApiUsageResponse, Date.parse('2026-08-03T12:00:00Z'));
  const reset = new Date(c!.resetsAt);
  assert.equal(reset.getDate(), 1);
  assert.equal(reset.getMonth(), 8); // September, local time
  assert.equal(reset.getFullYear(), 2026);
});

test('the credits reset rolls into January across a year boundary', () => {
  const c = creditsFromUsage({
    extra_usage: { is_enabled: true, monthly_limit: 30000, used_credits: 0, decimal_places: 2 }
  } as ClaudeApiUsageResponse, new Date(2026, 11, 20).getTime());
  const reset = new Date(c!.resetsAt);
  assert.equal(reset.getMonth(), 0);
  assert.equal(reset.getFullYear(), 2027);
});

// Hiding caps with nothing to report. A per-model cap at 0% and unspent credits
// are noise: they cannot be the binding constraint, and the 5-hour / all-models
// rows already establish that quota tracking is working.

test('a per-model cap with no usage yet is hidden', () => {
  const rows = visibleQuotaWindows([
    { kind: 'session', utilization: 3, decimals: 0, resetsAt: at(H), isActive: false },
    { kind: 'weekly_all', utilization: 9, decimals: 0, resetsAt: at(80 * H), isActive: false },
    { kind: 'weekly_scoped', scopeLabel: 'Fable', utilization: 0, decimals: 0, resetsAt: at(80 * H), isActive: true }
  ]);
  assert.deepEqual(rows.map((w: QuotaWindow) => w.kind), ['session', 'weekly_all']);
});

test('a per-model cap with any usage is kept, including a sub-1% share', () => {
  const rows = visibleQuotaWindows([
    { kind: 'weekly_all', utilization: 9, decimals: 0, resetsAt: at(80 * H), isActive: false },
    { kind: 'weekly_scoped', scopeLabel: 'Fable', utilization: 0.4, decimals: 0, resetsAt: at(80 * H), isActive: false }
  ]);
  assert.equal(rows.length, 2);
});

test('the baseline windows stay visible at 0%', () => {
  // Never hide these: "5h 0%" is the signal that quota tracking works at all.
  const rows = visibleQuotaWindows([
    { kind: 'session', utilization: 0, decimals: 0, resetsAt: '', isActive: false },
    { kind: 'weekly_all', utilization: 0, decimals: 0, resetsAt: '', isActive: false }
  ]);
  assert.equal(rows.length, 2);
});

test('a rolled-over per-model cap drops out until usage lands again', () => {
  // liveQuotaWindows zeroes a window whose period has passed, so the two
  // compose: after a weekly rollover the scoped row disappears until next use.
  const rolled = liveQuotaWindows([
    { kind: 'weekly_all', utilization: 9, decimals: 0, resetsAt: at(80 * H), isActive: false },
    { kind: 'weekly_scoped', scopeLabel: 'Fable', utilization: 88, decimals: 0, resetsAt: at(-H), isActive: false }
  ], NOW);
  assert.deepEqual(visibleQuotaWindows(rolled).map((w: QuotaWindow) => w.kind), ['weekly_all']);
});

test('credits report whether anything has been spent', () => {
  const unspent = creditsFromUsage({
    spend: {
      used: { amount_minor: 0, currency: 'USD', exponent: 2 },
      limit: { amount_minor: 30000, currency: 'USD', exponent: 2 },
      enabled: true
    }
  } as ClaudeApiUsageResponse, NOW);
  assert.equal(unspent!.used, 0);
  const spent = creditsFromUsage({
    spend: {
      used: { amount_minor: 1, currency: 'USD', exponent: 2 },
      limit: { amount_minor: 30000, currency: 'USD', exponent: 2 },
      enabled: true
    }
  } as ClaudeApiUsageResponse, NOW);
  // One cent of real spend must survive, even though it rounds to 0%. This is
  // why the row gates on the amount rather than on the percentage.
  assert.ok(spent!.used > 0);
  assert.equal(Math.round(spent!.percent!), 0);
});


// Precision is recorded per source shape, since JSON.parse collapses 3.0 to 3.

test('windows from limits[] carry integer precision', () => {
  assert.deepEqual(normalizeQuotaWindows(MODERN).map((w: QuotaWindow) => w.decimals), [0, 0, 0]);
});

test('windows from the legacy float fields carry one decimal', () => {
  // The endpoint serializes these as "6.0" / "1.0" / "12.0", so the field can
  // report a tenth and the display should say so.
  assert.deepEqual(normalizeQuotaWindows(LEGACY).map((w: QuotaWindow) => w.decimals), [1, 1, 1]);
});

test('a rolled-over window keeps its source precision', () => {
  const rolled = liveQuotaWindows(normalizeQuotaWindows({
    five_hour: { utilization: 100, resets_at: at(-H) }
  }), NOW);
  assert.equal(rolled[0].utilization, 0);
  assert.equal(rolled[0].decimals, 1);
});
