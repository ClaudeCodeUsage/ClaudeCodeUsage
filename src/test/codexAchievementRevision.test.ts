import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { codexAchievementProofRevision } from '../codexAchievementRevision';
import { snapshotFixture } from './codexFixtures';

const fence = { indexed: true, calendarComplete: true, timeZone: 'UTC' };

test('achievement proof revision ignores display, structural and quota metadata', () => {
  const snapshot = snapshotFixture();
  const before = codexAchievementProofRevision(snapshot.files, fence);
  assert.match(before, /^[a-f0-9]{64}$/);
  const changed = structuredClone(snapshot);
  changed.files[0].session.sessionTitle = 'another safe title';
  changed.files[0].session.projectName = 'another display name';
  changed.files[0].session.endedAt = 0;
  changed.files[0].structural.toolCalls++;
  Object.values(changed.files[0].period!.days)[0].structural.toolCalls++;
  assert.equal(codexAchievementProofRevision(changed.files, fence), before);
});

test('calendar cursor provenance changes the proof revision even when counters stay equal', () => {
  const files=snapshotFixture().files;
  const before=codexAchievementProofRevision(files,fence);
  const changed=structuredClone(files);
  changed[0].period!.indexedThrough++;
  assert.notEqual(codexAchievementProofRevision(changed,fence),before);
  assert.equal(codexAchievementProofRevision(files,fence),before,'unchanged witnesses stay reusable');
});

test('calendar witness presence and every field independently retire the proof revision', () => {
  const files = snapshotFixture().files;
  const absent = codexAchievementProofRevision(files, fence);
  files[0].achievementPeriodWitness = {
    size: 100, offset: 100, expectedPrefixEvents: 0, timeZone: 'UTC',
  };
  const witnessed = codexAchievementProofRevision(files, fence);
  assert.notEqual(witnessed, absent);
  assert.equal(codexAchievementProofRevision(structuredClone(files), fence), witnessed);
  for (const change of [
    { size: 101 }, { offset: 99 }, { expectedPrefixEvents: 1 }, { timeZone: 'Asia/Shanghai' },
  ]) {
    const changed = structuredClone(files);
    Object.assign(changed[0].achievementPeriodWitness!, change);
    assert.notEqual(codexAchievementProofRevision(changed, fence), witnessed, JSON.stringify(change));
  }
  const removed = structuredClone(files);
  delete removed[0].achievementPeriodWitness;
  assert.equal(codexAchievementProofRevision(removed, fence), absent);
});

test('calendar witness changes are hashed even when no readable period is present', () => {
  const files = snapshotFixture().files;
  delete files[0].period;
  const absent = codexAchievementProofRevision(files, fence);
  files[0].achievementPeriodWitness = {
    size: 100, offset: 100, expectedPrefixEvents: 0, timeZone: 'UTC',
  };
  assert.notEqual(codexAchievementProofRevision(files, fence), absent);
});

test('every consumed numeric proof counter and completeness fence changes the revision', () => {
  const files = snapshotFixture().files;
  const before = codexAchievementProofRevision(files, fence);
  for (const field of ['inputTotal', 'cachedInput', 'cacheWriteInput', 'outputTotal', 'reasoningOutput', 'sourceTotal'] as const) {
    for (const vector of ['total', 'model', 'effort', 'dayTotal', 'dayModel', 'dayEffort']) {
      const changed = structuredClone(files);
      const file = changed[0], day = Object.values(file.period!.days)[0];
      const tokens = vector === 'total' ? file.total : vector === 'model' ? Object.values(file.byModel)[0]
        : vector === 'effort' ? Object.values(file.byEffort)[0] : vector === 'dayTotal' ? day.total
        : vector === 'dayModel' ? Object.values(day.byModel)[0] : Object.values(day.byEffort)[0];
      tokens[field] = (tokens[field] ?? 0) + 1;
      assert.notEqual(codexAchievementProofRevision(changed, fence), before, `${vector}.${field}`);
    }
  }
  for (const change of [{ indexed: false }, { calendarComplete: false }, { timeZone: 'Asia/Shanghai' }]) {
    assert.notEqual(codexAchievementProofRevision(files, { ...fence, ...change }), before);
  }
  for (const change of [
    (file: typeof files[number]) => { file.session.sessionKey = 'different-identity'; },
    (file: typeof files[number]) => { file.session.parentSessionKey = 'different-parent'; },
    (file: typeof files[number]) => { file.session.role = 'subagent'; },
    (file: typeof files[number]) => { file.period!.lineageVersion = 1; },
    (file: typeof files[number]) => { file.period!.lineagePrefixEvents = 0; },
    (file: typeof files[number]) => { file.period!.timeZone = 'Asia/Shanghai'; },
  ]) {
    const changed = structuredClone(files); change(changed[0]);
    assert.notEqual(codexAchievementProofRevision(changed, fence), before);
  }
});

test('proof revisions distinguish absent optional counters from invalid values', () => {
  const files = snapshotFixture().files;
  const before = codexAchievementProofRevision(files, fence);
  for (const value of [null, NaN, Infinity, -Infinity, -1, '0', false]) {
    const changed = structuredClone(files);
    (changed[0].byEffort.high as any).cacheWriteInput = value;
    assert.notEqual(codexAchievementProofRevision(changed, fence), before, String(value));
  }
});

test('proof revision streams deep lineages without retaining or serializing a full corpus', () => {
  const file = snapshotFixture().files[0];
  const files = Array.from({ length: 10_000 }, (_, index) => ({ ...file,
    session: { ...file.session, sessionKey: `synthetic-${index}`,
      parentSessionKey: index ? `synthetic-${index - 1}` : undefined,
      role: (index ? 'subagent' : 'root') as 'subagent' | 'root' },
  }));
  assert.match(codexAchievementProofRevision(files, fence), /^[a-f0-9]{64}$/);
  assert.equal(files[0].session.parentSessionKey, undefined);
});
