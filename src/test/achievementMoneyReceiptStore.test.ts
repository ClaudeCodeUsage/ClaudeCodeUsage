import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ACHIEVEMENT_RECORD_BYTE_LIMIT, ACHIEVEMENT_LEGACY_RECORD_FILE, ACHIEVEMENT_V2_RECORD_FILE,
  AchievementRecordRepository, loadAchievementRecords, parseAchievementRecordStore,
  type AchievementRecordDraft, type AchievementRecordStore,
} from '../achievementRecordStore';
import { type AchievementId } from '../achievements';
import { getAchievementMoneyPricebook } from '../achievementMoney';
import { API_ACHIEVEMENT_DEFINITIONS, type AchievementMoneyId } from '../achievementMoneyCatalog';
import { acquireCodexIndexLease } from '../providers/codex/codexIndexLease';

const stamp = { recordedDay: '2026-10-10', timeZone: 'UTC' };
const anthropic = getAchievementMoneyPricebook('anthropic').version;
const bedrock = getAchievementMoneyPricebook('aws-bedrock-in-region').version;
const openai = getAchievementMoneyPricebook('openai').version;
const claudeId: AchievementMoneyId = 'claude-api-total-bronze';
const codexId: AchievementMoneyId = 'codex-api-total-bronze';
type Recording = Parameters<AchievementRecordRepository['recordUsage']>[3];
function recording(referencePricebooks: Partial<Record<AchievementMoneyId, string>>): Recording {
  // Structural typing keeps the red test compilable before the public type grows.
  const value = { ...stamp, referencePricebooks };
  return value;
}
const history = (id: AchievementMoneyId, book: string): AchievementRecordDraft => ({
  id, origin: 'history', recordedDay: null, timeZone: null, referencePricebook: book,
});
interface Fixture {
  directory: string;
  legacy: string;
  current: string;
  host: AchievementRecordRepository;
  peer: AchievementRecordRepository;
  old: AchievementRecordRepository;
  initial: AchievementRecordStore;
}
async function fixture(run: (value: Fixture) => Promise<void>): Promise<void> {
  // Each test owns fresh synthetic global storage; no real usage/source history.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-money-receipt-store-'));
  const legacy = path.join(directory, ACHIEVEMENT_LEGACY_RECORD_FILE);
  const current = path.join(directory, ACHIEVEMENT_V2_RECORD_FILE);
  try {
    const old = new AchievementRecordRepository(legacy);
    await old.initialize([]);
    const host = new AchievementRecordRepository(current), peer = new AchievementRecordRepository(current);
    const initial = await host.initialize([]);
    await peer.initialize([]);
    await run({ directory, legacy, current, host, peer, old, initial });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
async function bytes(f: Fixture): Promise<Buffer[]> {
  return Promise.all([readFile(f.current), readFile(f.legacy)]);
}
function waitingGuard() {
  let enabled = true, checks = 0;
  let notify!: () => void;
  const waiting = new Promise<void>(resolve => { notify = resolve; });
  return {
    waiting,
    // Third call proves the acquisition loop retried while the real lease was held.
    guard: () => { if (++checks >= 3) notify(); return enabled; },
    disable: () => { enabled = false; },
  };
}

test('money receipt grants mixed token/money IDs with only public book identities', async () => {
  await fixture(async f => {
    const receipt = await f.host.recordUsage(f.initial.generation, f.initial.sequence,
      ['sol-regular', claudeId, codexId], recording({ [claudeId]: bedrock, [codexId]: openai }));
    assert.deepEqual(receipt.added.map(row => [row.id, row.origin, row.seq, row.unread]), [
      ['sol-regular', 'usage', 1, true], [claudeId, 'usage', 2, true], [codexId, 'usage', 3, true],
    ]);
    const saved = await loadAchievementRecords(f.current);
    assert.deepEqual(saved, receipt.store);
    assert.deepEqual(parseAchievementRecordStore(saved), saved);
    for (const row of receipt.added) {
      assert.equal(row.recordedDay, stamp.recordedDay);
      assert.equal(row.timeZone, stamp.timeZone);
      assert.equal(row.ruleVersion, 1);
      assert.deepEqual(Object.keys(row).sort(), ['id', 'origin', 'recordedDay', 'timeZone', 'ruleVersion', 'seq', 'unread',
        ...(row.id === 'sol-regular' ? [] : ['referencePricebook'])].sort());
    }
    assert.equal(receipt.added[1].referencePricebook, bedrock);
    assert.equal(receipt.added[2].referencePricebook, openai);
    const serialized = await readFile(f.current, 'utf8');
    assert.ok(Buffer.byteLength(serialized) <= ACHIEVEMENT_RECORD_BYTE_LIMIT);
    assert.doesNotMatch(serialized, /microUsd|microUSD|amount|totalTokens|referencePricebooks|pricingBackend|numericProof/);
    const before = await bytes(f);
    assert.deepEqual((await f.peer.recordUsage(f.initial.generation, 0,
      [claudeId, codexId], recording({ [claudeId]: anthropic, [codexId]: openai }))).added, []);
    assert.deepEqual(await bytes(f), before, 'already granted usage keeps its original public basis');
  });
});

test('money receipt accepts exactly the enumerated money IDs and provider-specific books', async () => {
  await fixture(async f => {
    const ids = API_ACHIEVEMENT_DEFINITIONS.map(row => row.id);
    const books = Object.fromEntries(ids.map(id => [id, id.startsWith('codex-') ? openai : anthropic]));
    const receipt = await f.host.recordUsage(f.initial.generation, 0, ids, recording(books));
    assert.equal(receipt.added.length, ids.length);
    assert.ok(Buffer.byteLength(JSON.stringify(receipt.store)) <= ACHIEVEMENT_RECORD_BYTE_LIMIT);
  });
});

test('same-book later peer history repairs to dated unread usage and a new ACK-fenced sequence', async () => {
  await fixture(async f => {
    const peer = await f.peer.append(f.initial.generation, [history(claudeId, anthropic), history(codexId, openai)]);
    const receipt = await f.host.recordUsage(f.initial.generation, f.initial.sequence,
      [claudeId, codexId], recording({ [claudeId]: anthropic, [codexId]: openai }));
    assert.deepEqual(receipt.added.map(row => [row.id, row.origin, row.seq, row.unread]), [
      [claudeId, 'usage', 3, true], [codexId, 'usage', 4, true],
    ]);
    assert.deepEqual(receipt.store.records, receipt.added);
    const before = await bytes(f);
    await f.peer.acknowledgeRecords(f.initial.generation, peer.store.sequence, [claudeId, codexId]);
    assert.deepEqual(await bytes(f), before, 'preempting history ACK cannot read reissued usage');
  });
});

test('different-book later peer history remains immutable beside same-book and token repair', async () => {
  for (const [original, supplied] of [[anthropic, bedrock], [bedrock, anthropic]]) {
    await fixture(async f => {
      const peer = await f.peer.append(f.initial.generation, [history(claudeId, original), history(codexId, openai),
        { id: 'sol-regular', origin: 'history', recordedDay: null, timeZone: null }]);
      const originalRow = peer.added[0];
      const receipt = await f.host.recordUsage(f.initial.generation, f.initial.sequence,
        [claudeId, codexId, 'sol-regular'], recording({ [claudeId]: supplied, [codexId]: openai }));
      assert.deepEqual(receipt.added.map(row => [row.id, row.seq]), [[codexId, 4], ['sol-regular', 5]]);
      assert.deepEqual(receipt.store.records[0], originalRow);
      assert.equal(receipt.store.records.filter(row => row.id === claudeId).length, 1);
      const before = await bytes(f);
      assert.deepEqual((await f.host.recordUsage(f.initial.generation, 0,
        [claudeId], recording({ [claudeId]: supplied }))).added, []);
      assert.deepEqual(await bytes(f), before, 'different basis never redates or duplicates history');
    });
  }
});

test('money records established at or before the baseline keep all provenance regardless of book', async () => {
  for (const supplied of [anthropic, bedrock]) await fixture(async f => {
    const established = await f.peer.append(f.initial.generation, [
      history(claudeId, anthropic), { ...history('claude-api-total-silver', anthropic), origin: 'existing' },
    ]);
    const before = await bytes(f);
    const receipt = await f.host.recordUsage(f.initial.generation, established.store.sequence,
      [claudeId, 'claude-api-total-silver'], recording({ [claudeId]: supplied, 'claude-api-total-silver': supplied }));
    assert.deepEqual(receipt.added, []);
    assert.deepEqual(receipt.store, established.store);
    assert.deepEqual(await bytes(f), before);
  });
});

test('later existing money provenance is never eligible for same-book history repair', async () => {
  await fixture(async f => {
    await f.peer.append(f.initial.generation, [{ ...history(claudeId, anthropic), origin: 'existing' }]);
    const before = await bytes(f);
    assert.deepEqual((await f.host.recordUsage(f.initial.generation, 0,
      [claudeId], recording({ [claudeId]: anthropic }))).added, []);
    assert.deepEqual(await bytes(f), before);
  });
});

test('receipt rejects missing, unknown, private, extraneous and contradictory books without byte changes', async t => {
  await fixture(async f => {
    const before = await bytes(f);
    const hiddenKey = Object.defineProperty({ [claudeId]: anthropic }, 'privateCanary', { value: 'secret' });
    const symbolKey = { [claudeId]: anthropic, [Symbol('privateCanary')]: 'secret' };
    const cases: Array<{ name: string; ids?: AchievementId[]; value: unknown }> = [
      { name: 'missing mapping', value: stamp },
      { name: 'undefined mapping', value: { ...stamp, referencePricebooks: undefined } },
      { name: 'null mapping', value: { ...stamp, referencePricebooks: null } },
      { name: 'array mapping', value: { ...stamp, referencePricebooks: [] } },
      { name: 'missing selected ID', value: recording({}) },
      { name: 'one missing among two', ids: [claudeId, codexId], value: recording({ [claudeId]: anthropic }) },
      { name: 'unknown book', value: recording({ [claudeId]: 'unknown' }) },
      { name: 'unsupported version', value: recording({ [claudeId]: anthropic.replace('-v1', '-v2') }) },
      { name: 'private book', value: recording({ [claudeId]: '/private/receipt-canary/pricebook.json' }) },
      { name: 'numeric proof string', value: recording({ [claudeId]: '100000000' }) },
      { name: 'object book', value: { ...stamp, referencePricebooks: { [claudeId]: { version: anthropic, microUsd: 100000000 } } } },
      { name: 'private mapping key', value: { ...stamp, referencePricebooks: { [claudeId]: anthropic, privateCanary: 'secret' } } },
      { name: 'hidden private mapping key', value: { ...stamp, referencePricebooks: hiddenKey } },
      { name: 'symbol private mapping key', value: { ...stamp, referencePricebooks: symbolKey } },
      { name: 'prototype mapping key', value: { ...stamp, referencePricebooks: JSON.parse(`{"${claudeId}":"${anthropic}","__proto__":"private"}`) } },
      { name: 'token mapping key', ids: [claudeId, 'sol-regular'], value: { ...stamp, referencePricebooks: { [claudeId]: anthropic, 'sol-regular': openai } } },
      { name: 'money key outside values', value: recording({ [claudeId]: anthropic, [codexId]: openai }) },
      { name: 'Claude with OpenAI', value: recording({ [claudeId]: openai }) },
      { name: 'Codex with Anthropic', ids: [codexId], value: recording({ [codexId]: anthropic }) },
      { name: 'Codex with Bedrock', ids: [codexId], value: recording({ [codexId]: bedrock }) },
      { name: 'extra recording key', value: { ...recording({ [claudeId]: anthropic }), amount: 100000000 } },
      { name: 'empty mapping on tokens', ids: ['sol-regular'], value: recording({}) },
      { name: 'money mapping on tokens', ids: ['sol-regular'], value: recording({ [claudeId]: anthropic }) },
      { name: 'empty mapping on no selection', ids: [], value: recording({}) },
      { name: 'invalid date', value: { ...recording({ [claudeId]: anthropic }), recordedDay: '2026-02-30' } },
      { name: 'invalid zone', value: { ...recording({ [claudeId]: anthropic }), timeZone: 'private/unknown' } },
    ];
    for (const row of cases) await t.test(row.name, async () => {
      await assert.rejects(f.host.recordUsage(f.initial.generation, 0, row.ids ?? [claudeId], row.value as Recording), /invalid/);
      assert.deepEqual(await bytes(f), before);
    });
    assert.deepEqual((await readdir(f.directory)).sort(), [ACHIEVEMENT_LEGACY_RECORD_FILE, ACHIEVEMENT_V2_RECORD_FILE].sort());
  });
});

test('token-only recording keeps the exact two-key shape and its later peer history repair', async () => {
  await fixture(async f => {
    await f.peer.append(f.initial.generation, [{ id: 'sol-regular', origin: 'history', recordedDay: null, timeZone: null }]);
    const receipt = await f.host.recordUsage(f.initial.generation, 0, ['sol-regular'], stamp);
    assert.equal(receipt.added[0].origin, 'usage');
    assert.equal(receipt.added[0].seq, 2);
    assert.equal(Object.hasOwnProperty.call(receipt.added[0], 'referencePricebook'), false);
  });
});

test('money receipt retains canonical baseline validation without byte changes', async () => {
  await fixture(async f => {
    const before = await bytes(f);
    for (const baseline of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1, 1]) {
      await assert.rejects(f.host.recordUsage(f.initial.generation, baseline,
        [claudeId], recording({ [claudeId]: anthropic })), /invalid/);
      assert.deepEqual(await bytes(f), before);
    }
    for (const ids of [[claudeId, claudeId], [claudeId, 'local-share-export'], [claudeId, 'private-canary']]) {
      await assert.rejects(f.host.recordUsage(f.initial.generation, 0,
        ids as AchievementId[], recording({ [claudeId]: anthropic })), /invalid/);
      assert.deepEqual(await bytes(f), before);
    }
  });
});

test('OFF before or while a money receipt waits on the shared legacy lease never writes', async () => {
  await fixture(async f => {
    const before = await bytes(f);
    await assert.rejects(f.host.recordUsage(f.initial.generation, 0,
      [claudeId], recording({ [claudeId]: anthropic }), () => false), /cancelled/);
    const lease = await acquireCodexIndexLease(f.legacy), control = waitingGuard();
    try {
      const rejected = assert.rejects(f.host.recordUsage(f.initial.generation, 0,
        [claudeId], recording({ [claudeId]: anthropic }), control.guard), /cancelled/);
      await control.waiting;
      assert.deepEqual(await bytes(f), before, 'receipt is blocked on the common v1 lease');
      control.disable();
      await rejected;
    } finally { await lease.release(); }
    assert.deepEqual(await bytes(f), before);
  });
});

test('queued money receipt snapshots its validated public basis before waiting on the lease', async () => {
  await fixture(async f => {
    const peer = await f.peer.append(f.initial.generation, [history(claudeId, anthropic)]);
    const lease = await acquireCodexIndexLease(f.legacy), control = waitingGuard();
    const books = { [claudeId]: bedrock };
    const pending = f.host.recordUsage(f.initial.generation, 0, [claudeId], recording(books), control.guard);
    try {
      await control.waiting;
      books[claudeId] = anthropic;
    } finally { await lease.release(); }
    const receipt = await pending;
    assert.deepEqual(receipt.added, [], 'mutating the caller mapping cannot authorize another basis');
    assert.deepEqual(receipt.store, peer.store);
    assert.deepEqual(await loadAchievementRecords(f.current), peer.store);
  });
});

test('a peer clear holding the common lease retires a queued monetary receipt and old writer', async () => {
  await fixture(async f => {
    const oldBase = await f.old.initialize([]);
    let entered!: () => void, finish!: () => void;
    const locked = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { finish = resolve; });
    const clearing = f.peer.clear(async () => { entered(); await resume; });
    await locked;
    const control = waitingGuard();
    const rejected = assert.rejects(f.host.recordUsage(f.initial.generation, 0,
      [claudeId], recording({ [claudeId]: anthropic }), control.guard), /generation/);
    try { await control.waiting; } finally { finish(); }
    const cleared = await clearing;
    const before = await bytes(f);
    await rejected;
    await assert.rejects(f.old.recordUsage(oldBase.generation, 0, ['sol-regular'], stamp), /generation/);
    assert.deepEqual(await bytes(f), before);
    assert.deepEqual((await loadAchievementRecords(f.current))?.records, []);
    assert.ok(cleared.generation > f.initial.generation);
  });
});

test('old-writer revision fences money receipts after waiting on the common lease', async () => {
  await fixture(async f => {
    const oldBase = await f.old.initialize([]);
    await f.old.recordUsage(oldBase.generation, 0, ['sol-regular'], stamp);
    const before = await bytes(f);
    const lease = await acquireCodexIndexLease(f.legacy), control = waitingGuard();
    const rejected = assert.rejects(f.host.recordUsage(f.initial.generation, 0,
      [claudeId], recording({ [claudeId]: anthropic }), control.guard), /old-writer/);
    try {
      await control.waiting;
      assert.deepEqual(await bytes(f), before);
    } finally { await lease.release(); }
    await rejected;
    assert.deepEqual(await bytes(f), before);
  });
});

test('frozen v1 still rejects every new money receipt without changing either canonical file', async () => {
  await fixture(async f => {
    const oldBase = await f.old.initialize([]), before = await bytes(f);
    await assert.rejects(f.old.recordUsage(oldBase.generation, oldBase.sequence,
      ['sol-regular', claudeId], recording({ [claudeId]: anthropic })), /invalid/);
    assert.deepEqual(await bytes(f), before);
    assert.equal((await loadAchievementRecords(f.legacy))?.schemaVersion, 1);
  });
});
