import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

const helper = (): any => require(path.resolve(__dirname, '../../tests/native/background.cjs'));
const idle = { ownedActive: 0, ownedByKind: { timer: 0, watcher: 0, worker: 0, network: 0, backfill: 0 } };

test('native background observations require exact focus and known ownership, never simulated focus', () => {
  assert.equal(helper().assertBackgroundIdle(false, false, idle), true);
  assert.equal(helper().assertBackgroundIdle(true, true, idle), false);
  for (const values of [[undefined, false], [false, undefined], ['false', false], [true, false], [false, true]]) {
    assert.throws(() => helper().assertBackgroundIdle(...values, idle), /native-background:focus/);
  }
});

test('native background guard rejects recurring resources and never treats unknown as zero', () => {
  for (const kind of Object.keys(idle.ownedByKind)) {
    const sample = { ownedActive: 1, ownedByKind: { ...idle.ownedByKind, [kind]: 1 } };
    assert.throws(() => helper().assertBackgroundIdle(false, false, sample), /native-background:not-idle/);
  }
  for (const sample of [{ ...idle, ownedActive: undefined },
    { ...idle, ownedByKind: { ...idle.ownedByKind, watcher: undefined } },
    { ...idle, ownedByKind: { ...idle.ownedByKind, timer: '0' } }]) {
    assert.throws(() => helper().assertBackgroundIdle(false, false, sample), /native-background:not-idle/);
  }
});

test('native background acceptance cannot pass without duration, idle observations and completed teardown', () => {
  const complete = { elapsedMs: 120000, requestedMs: 120000, idleSamples: 20, stopCompleted: true,
    warmIo: { on: { claude: { records: 20, bodyReads: 0, unknownBodyReads: 0, bytesRead: 0, unknownBytesRead: 0 },
      codex: { records: 20, bodyReads: 0, unknownBodyReads: 0 } },
      off: { claude: { records: 20, bodyReads: 0, unknownBodyReads: 0, bytesRead: 0, unknownBytesRead: 0 },
      codex: { records: 20, bodyReads: 0, unknownBodyReads: 0 } } } };
  helper().assertBackgroundComplete(complete);
  for (const changed of [{ ...complete, elapsedMs: 119999 }, { ...complete, idleSamples: 0 },
    { ...complete, stopCompleted: false }, { ...complete, elapsedMs: undefined }]) {
    assert.throws(() => helper().assertBackgroundComplete(changed), /native-background:incomplete/);
  }
  assert.throws(() => helper().assertBackgroundComplete({ ...complete,
    warmIo: { ...complete.warmIo, off: { ...complete.warmIo.off,
      codex: { records: 0, bodyReads: 0, unknownBodyReads: 0 } } } }), /observed warm refreshes/);
});
