import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const { freezeClock } = require(path.resolve(__dirname, '../../tests/ui/support/frozen-clock.cjs')) as {
  freezeClock: (now: number) => () => void;
};

test('UI fixture clock freezes every calendar entry point and preserves explicit dates', () => {
  const original = Date;
  const now = Date.parse('2026-07-20T12:00:00Z');
  const restore = freezeClock(now);
  try {
    assert.equal(Date.now(), now);
    assert.equal(new Date().getTime(), now);
    assert.equal(Date(), new original(now).toString());
    assert.equal(new Date(0).getTime(), 0);
    assert.equal(new Date('2026-07-19T10:00:00Z').getTime(), original.parse('2026-07-19T10:00:00Z'));
    assert.equal(new Date(2026, 6, 19, 10).getTime(), new original(2026, 6, 19, 10).getTime());
    assert.equal(Date.UTC(2026, 6, 20, 12), now);
    assert.ok(new Date() instanceof original);
  } finally { restore(); }
  assert.equal(Date, original);
});

test('asynchronous fixture clocks restore the real date after out-of-order completion', () => {
  const original = Date;
  const restoreA = freezeClock(100);
  const restoreB = freezeClock(200);
  restoreA();
  assert.equal(Date.now(), 200);
  restoreB();
  assert.equal(Date, original);
  restoreA(); restoreB();
  assert.equal(Date, original);
});
