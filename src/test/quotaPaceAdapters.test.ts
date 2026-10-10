import { test } from 'node:test';
import * as assert from 'node:assert/strict';

// Runtime import also makes the pre-implementation run fail without changing
// the shared contracts owned by other workers.
const adapters = (): any => require('../quotaPaceAdapters');
const WEEK = 7 * 24 * 60 * 60 * 1000;
const START = Date.parse('2026-10-01T00:00:00Z');
const T = START + WEEK / 4;
function snapshot(overrides: any = {}): any {
  return {
    observedAt: T, source: 'observed', accountWindowTrust: 'trusted',
    windows: [{ slot: 0, kind: 'weekly_all', periodMs: WEEK, resetAt: START + WEEK, usedPercent: 29 }],
    ...overrides,
  };
}
const input = (current: any = snapshot(), previous: any = null): any => ({ enabled: true, now: T, snapshot: current, previous });
const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-10);

test('Claude adapters keep account and explicitly scoped weekly observations independent', () => {
  const current = snapshot();
  current.windows.push({ ...current.windows[0], slot: 1, kind: 'weekly_scoped', usedPercent: 40 });
  const result = adapters().adaptClaudeQuotaPace(input(current));
  assert.equal(result.length, 2);
  close(result[0].result.forecastPercent, 116);
  assert.equal(result[1].result.forecastPercent, 160);
  assert.equal(result[0].result.observedAt, T);
  assert.deepEqual(Object.keys(result[0]).sort(), ['kind', 'result', 'slot']);
});

test('off adapters never inspect observations or create derived state', () => {
  for (const adapt of [adapters().adaptClaudeQuotaPace, adapters().adaptCodexQuotaPace]) {
    assert.deepEqual(adapt({ enabled: false, now: T, get snapshot(): never { throw new Error('must not consume'); } }), []);
  }
});

test('raw time stays anchored across repaints and stale observations lose forecasts', () => {
  const adapt = adapters().adaptClaudeQuotaPace;
  close(adapt({ ...input(), now: T + 10 * 60_000 })[0].result.forecastPercent, 116);
  assert.equal(adapt({ ...input(), now: T + 31 * 60_000 })[0].result.reason, 'stale-observation');
  assert.equal(adapt(input(snapshot({ observedAt: null })))[0].result.status, 'unavailable');
  assert.equal(adapt(input(snapshot({ source: 'synthetic-reset' })))[0].result.reason, 'synthetic-observation');
});

test('decline, source changes, unknown identity and abnormal resets fail closed', () => {
  const adapt = adapters().adaptClaudeQuotaPace;
  const previous = snapshot({ observedAt: T - 60_000 });
  previous.windows[0].usedPercent = 30;
  assert.equal(adapt(input(snapshot(), previous))[0].result.reason, 'untrusted-account-window');
  for (const trust of ['unknown', 'ambiguous', 'discontinuous']) {
    assert.equal(adapt(input(snapshot({ accountWindowTrust: trust })))[0].result.reason, 'untrusted-account-window');
  }
  const earlyReset = snapshot();
  earlyReset.windows[0].resetAt += 60_000;
  assert.equal(adapt(input(earlyReset, snapshot()))[0].result.reason, 'untrusted-account-window');
  const next = snapshot({ observedAt: START + WEEK + 7 * 60 * 60_000 });
  next.windows[0].resetAt += WEEK;
  next.windows[0].usedPercent = 1;
  assert.equal(adapt({ ...input(next, previous), now: next.observedAt })[0].result.status, 'ready');
});

test('Codex requires one latest trusted account window; scoped/conflicting windows never merge', () => {
  const adapt = adapters().adaptCodexQuotaPace;
  close(adapt(input())[0].result.forecastPercent, 116);
  assert.equal(adapt(input(snapshot({ accountWindowTrust: 'unknown' })))[0].result.status, 'unavailable');
  const conflict = snapshot();
  conflict.windows.push({ ...conflict.windows[0], slot: 1, usedPercent: 70 });
  assert.equal(adapt(input(conflict))[0].result.reason, 'untrusted-account-window');
  conflict.windows = [{ ...conflict.windows[0], kind: 'weekly_scoped' }];
  assert.deepEqual(adapt(input(conflict)), []);
  conflict.windows = [{ ...snapshot().windows[0], resetAt: null }];
  assert.equal(adapt(input(conflict))[0].result.reason, 'missing-reset');
  conflict.windows[0].periodMs = null;
  conflict.windows[0].resetAt = START + WEEK;
  assert.equal(adapt(input(conflict))[0].result.reason, 'unknown-period');
});

test('bounded numeric DTO rejects malformed numbers, duplicate slots and excess windows', () => {
  const adapt = adapters().adaptClaudeQuotaPace;
  for (const usedPercent of [NaN, Infinity, -1, 101, '29', null, undefined]) {
    const current = snapshot();
    current.windows[0].usedPercent = usedPercent;
    assert.equal(adapt(input(current))[0].result.status, 'unavailable');
  }
  const current = snapshot();
  current.windows.push({ ...current.windows[0], kind: 'weekly_scoped' });
  assert.ok(adapt(input(current)).every((entry: any) => entry.result.status === 'unavailable'));
  const oversized = snapshot({ windows: Array.from({ length: 17 }, (_, slot) => ({ ...snapshot().windows[0], slot })) });
  assert.equal(adapt(input(oversized)).length, 1);
  assert.equal(adapt(input(oversized))[0].result.status, 'unavailable');
});
