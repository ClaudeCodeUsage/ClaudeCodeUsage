import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ACHIEVEMENT_DEFINITIONS } from '../achievements';
import { spawn } from 'node:child_process';
import { acquireCodexIndexLease } from '../providers/codex/codexIndexLease';
import { isLegacyAchievementId } from '../achievementRuleVersions';
import { API_ACHIEVEMENT_DEFINITIONS } from '../achievementMoneyCatalog';
import { getAchievementMoneyPricebook } from '../achievementMoney';

// Dynamic loading lets the initial red test fail on the missing implementation,
// rather than preventing the existing project from compiling.
function storeApi(): any { return require('../achievementRecordStore'); }
async function withStore(run: (file: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-award-store-'));
  try { await run(path.join(directory, 'achievements-v1.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const local = (id = 'local-share-export') => ({ id, origin: 'activity', recordedDay: '2026-10-08', timeZone: 'Asia/Shanghai' });
const recording = { recordedDay: '2026-10-09', timeZone: 'UTC' };

test('usage transaction repairs only peer history written after its accepted baseline', async () => {
  await withStore(async file => {
    const api = storeApi();
    const host = new api.AchievementRecordRepository(file), peer = new api.AchievementRecordRepository(file);
    const initial = await host.initialize(['hundred-million-club']);
    await peer.append(initial.generation, [
      { id: 'astra-regular', origin: 'history', recordedDay: null, timeZone: null },
      { id: 'astra-regular-silver', origin: 'history', recordedDay: null, timeZone: null },
    ]);
    const accepted = await host.recordUsage(initial.generation, initial.sequence,
      ['hundred-million-club', 'astra-regular-silver', 'sol-regular'], recording);
    assert.deepEqual(accepted.added.map((row: any) => row.id), ['astra-regular-silver', 'sol-regular']);
    const saved = api.parseAchievementRecordStore(await api.loadAchievementRecords(file));
    assert.deepEqual(saved.records.map((row: any) => [row.id, row.origin, row.seq, row.unread]), [
      ['hundred-million-club', 'existing', 1, false], ['astra-regular', 'history', 2, false],
      ['astra-regular-silver', 'usage', 4, true], ['sol-regular', 'usage', 5, true],
    ]);
    assert.equal(saved.records[2].recordedDay, recording.recordedDay);
    await host.acknowledgeRecords(initial.generation, 3, ['astra-regular-silver']);
    assert.equal((await api.loadAchievementRecords(file)).records[2].unread, true, 'old receipt cannot read promoted usage');
    const again = await peer.recordUsage(initial.generation, initial.sequence, ['astra-regular-silver'], recording);
    assert.equal(again.added.length, 0, 'duplicate producer receipt is idempotent');
  });
});

test('usage transaction does not rewrite history already present at baseline or activity provenance', async () => {
  await withStore(async file => {
    const api = storeApi(), host = new api.AchievementRecordRepository(file);
    const initial = await host.initialize([]);
    const baseline = (await host.append(initial.generation, [
      { id: 'astra-regular', origin: 'history', recordedDay: null, timeZone: null }, local(),
    ])).store;
    const bytes = await readFile(file, 'utf8');
    assert.equal((await host.recordUsage(initial.generation, baseline.sequence, ['astra-regular'], recording)).added.length, 0);
    assert.equal(await readFile(file, 'utf8'), bytes);
    for (const args of [[-1, ['sol-regular']], [baseline.sequence + 1, ['sol-regular']],
      [0, ['sol-regular', 'sol-regular']], [0, ['local-share-export']], [0, ['private-canary']]]) {
      await assert.rejects(host.recordUsage(initial.generation, args[0], args[1], recording), /invalid/);
      assert.equal(await readFile(file, 'utf8'), bytes);
    }
  });
});

test('usage proof waits under the real shared lease and OFF or clear retires it', async () => {
  await withStore(async file => {
    const api = storeApi(), host = new api.AchievementRecordRepository(file);
    const initial = await host.initialize([]);
    const bytes = await readFile(file, 'utf8');
    const lease = await acquireCodexIndexLease(file);
    let enabled = true;
    try {
      const pending = host.recordUsage(initial.generation, initial.sequence, ['astra-regular-silver'], recording, () => enabled);
      const rejected = assert.rejects(pending, /cancelled/);
      enabled = false;
      await rejected;
    } finally { await lease.release(); }
    assert.equal(await readFile(file, 'utf8'), bytes);
    await host.clear();
    await assert.rejects(host.recordUsage(initial.generation, initial.sequence, ['astra-regular-silver'], recording), /generation/);
  });
});

test('separate processes cannot preempt proven usage with late quiet reconciliation', async () => {
  await withStore(async file => {
    const api = storeApi(), host = new api.AchievementRecordRepository(file);
    const initial = await host.initialize([]);
    const run = (usage: boolean): Promise<void> => new Promise((resolve, reject) => {
      const source = `const {AchievementRecordRepository}=require(process.argv[1]);
        (async()=>{const r=new AchievementRecordRepository(process.argv[2]);
        if(process.argv[3]==='usage')await r.recordUsage(1,0,['astra-regular-silver'],{recordedDay:'2026-10-09',timeZone:'UTC'});
        else await r.append(1,[{id:'astra-regular-silver',origin:'history',recordedDay:null,timeZone:null}]);})()
        .catch(()=>{process.exitCode=1;});`;
      const child = spawn(process.execPath, ['-e', source, require.resolve('../achievementRecordStore'), file,
        usage ? 'usage' : 'history'], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('fixture child failed')));
    });
    await run(false);
    await Promise.all([run(true), run(true), run(false)]);
    const saved = await api.loadAchievementRecords(file);
    assert.equal(saved.records.length, 1);
    assert.equal(saved.records[0].origin, 'usage');
    assert.equal(saved.records[0].unread, true);
    assert.equal(saved.sequence, initial.sequence + 2);
  });
});

test('pin actions merge concurrent hosts, are idempotent and preserve the three-slot bound', async () => {
  await withStore(async file => {
    const a = new (storeApi().AchievementRecordRepository)(file), b = new (storeApi().AchievementRecordRepository)(file);
    const initial = await a.initialize(['local-share-export', 'local-advice-feedback', 'astra-regular', 'sol-regular']);
    await Promise.all([a.setPinned(initial.generation, 'local-share-export', true), b.setPinned(initial.generation, 'astra-regular', true)]);
    await a.setPinned(initial.generation, 'local-advice-feedback', true);
    let saved = await storeApi().loadAchievementRecords(file);
    assert.equal(saved.pins.length, 3);
    assert.ok(saved.pins.includes('local-share-export') && saved.pins.includes('astra-regular'));
    const bytes = await readFile(file, 'utf8');
    await a.setPinned(initial.generation, 'astra-regular', true);
    assert.equal(await readFile(file, 'utf8'), bytes);
    await assert.rejects(b.setPinned(initial.generation, 'sol-regular', true), /pin-limit/);
    assert.equal(await readFile(file, 'utf8'), bytes);
    await b.setPinned(initial.generation, 'astra-regular', false);
    saved = await a.setPinned(initial.generation, 'sol-regular', true);
    assert.deepEqual(new Set(saved.pins), new Set(['local-share-export', 'local-advice-feedback', 'sol-regular']));
    assert.ok(saved.records.every((record: any) => !record.unread));
  });
});

test('pin requests reject unearned or malformed keys and old clear generations without changing proof', async () => {
  await withStore(async file => {
    const repository = new (storeApi().AchievementRecordRepository)(file);
    const initial = await repository.initialize(['local-share-export']);
    const bytes = await readFile(file, 'utf8');
    for (const key of ['astra-regular', 'private-canary', '__proto__', 'astra-regular-bronze']) {
      await assert.rejects(repository.setPinned(initial.generation, key, true), /invalid/);
    }
    await assert.rejects(repository.setPinned(initial.generation, 'local-share-export', 'true'), /invalid/);
    await assert.rejects(repository.setPinned(initial.generation, 'local-share-export', true, () => false), /cancelled/);
    assert.equal(await readFile(file, 'utf8'), bytes);
    await repository.clear();
    await assert.rejects(repository.setPinned(initial.generation, 'local-share-export', true), /generation/);
  });
});

test('notice reservations merge peers and retain unread until an exact scoped ACK', async () => {
  await withStore(async file => {
    const a = new (storeApi().AchievementRecordRepository)(file);
    const b = new (storeApi().AchievementRecordRepository)(file);
    const initial = await a.initialize([]);
    await a.append(initial.generation, [local(), local('local-advice-feedback')]);
    const reservations = await Promise.all([
      a.reserveNotice(initial.generation, ['local-share-export'], 1_000_000),
      b.reserveNotice(initial.generation, ['local-share-export'], 1_000_000),
    ]);
    assert.equal(reservations.reduce((sum, row) => sum + row.records.length, 0), 1);
    const saved = await storeApi().loadAchievementRecords(file);
    assert.equal(saved.lastNoticeAt, 1_000_000);
    assert.ok(saved.records.every((row: any) => row.unread));
    await a.append(initial.generation, [local('settings-explorer-bronze')]);
    const acked = await a.acknowledgeRecords(initial.generation, saved.sequence, ['local-share-export']);
    assert.deepEqual(acked.records.map((row: any) => row.unread), [false, true, true]);
  });
});

test('persistent notice cooldown survives reload, exact boundary and clock rollback', async () => {
  await withStore(async file => {
    const repository = new (storeApi().AchievementRecordRepository)(file);
    const initial = await repository.initialize([]);
    await repository.append(initial.generation, [local()]);
    await repository.reserveNotice(initial.generation, ['local-share-export'], 1_000_000);
    const next = new (storeApi().AchievementRecordRepository)(file);
    for (const now of [999_999, 1_000_000, 1_300_000]) {
      assert.deepEqual((await next.reserveNotice(initial.generation, ['local-share-export'], now)).records, []);
    }
    assert.equal((await next.reserveNotice(initial.generation, ['local-share-export'], 1_300_001)).records.length, 1);
    const saved = await storeApi().loadAchievementRecords(file);
    assert.equal(saved.records[0].unread, true, 'a lost delivery never reads an award');
  });
});

test('notice reservation rejects history, quiet rules, malformed requests and retired generations', async () => {
  await withStore(async file => {
    const repository = new (storeApi().AchievementRecordRepository)(file);
    const initial = await repository.initialize(['hundred-million-club']);
    await repository.append(initial.generation, [local('night-output-peak')]);
    const bytes = await readFile(file, 'utf8');
    assert.deepEqual((await repository.reserveNotice(initial.generation, ['hundred-million-club', 'night-output-peak'], 1_000_000)).records, []);
    for (const ids of [['private-canary'], ['local-share-export', 'local-share-export'], Array(125).fill('local-share-export')]) {
      await assert.rejects(repository.reserveNotice(initial.generation, ids, 1_000_000), /invalid/);
      await assert.rejects(repository.acknowledgeRecords(initial.generation, initial.sequence, ids), /invalid/);
    }
    await assert.rejects(repository.reserveNotice(initial.generation, ['local-share-export'], NaN), /invalid/);
    await assert.rejects(repository.acknowledgeRecords(initial.generation, 99, ['local-share-export']), /invalid/);
    assert.equal(await readFile(file, 'utf8'), bytes);
    const cleared = await repository.clear();
    await assert.rejects(repository.reserveNotice(initial.generation, ['local-share-export'], 1_000_000), /generation/);
    await assert.rejects(repository.acknowledgeRecords(initial.generation, 1, ['local-share-export']), /generation/);
    assert.equal((await storeApi().loadAchievementRecords(file)).generation, cleared.generation);
  });
});

test('OFF during a queued notice lease cannot reserve a cooldown or read an award', async () => {
  await withStore(async file => {
    const repository = new (storeApi().AchievementRecordRepository)(file);
    const initial = await repository.initialize([]);
    await repository.append(initial.generation, [local()]);
    const bytes = await readFile(file, 'utf8');
    const lease = await acquireCodexIndexLease(file);
    let enabled = true;
    try {
      const reservation = repository.reserveNotice(initial.generation, ['local-share-export'], 1_000_000, () => enabled);
      const rejected = assert.rejects(reservation, /cancelled/i);
      enabled = false;
      await rejected;
    } finally { await lease.release(); }
    assert.equal(await readFile(file, 'utf8'), bytes);
    await assert.rejects(repository.acknowledgeRecords(initial.generation, 1, ['local-share-export'], () => false), /cancelled/);
    assert.equal(await readFile(file, 'utf8'), bytes);
  });
});

test('canonical auxiliary proof merges peers and clear never imports stale legacy caches', async () => {
  await withStore(async file => {
    const api = storeApi();
    const a = new api.AchievementRecordRepository(file);
    const b = new api.AchievementRecordRepository(file);
    const initial = await a.initialize([]);
    const activity = (setting: string, feature: string) => ({ schemaVersion: 2, settingKeys: [setting], features: [feature] });
    await Promise.all([
      a.updateAuxiliary(initial.generation, 'activity', activity('compactNumbers', 'localShareExport')),
      b.updateAuxiliary(initial.generation, 'activity', activity('decimalPlaces', 'localAdviceFeedback')),
    ]);
    await Promise.all([
      a.updateAuxiliary(initial.generation, 'hours', { schemaVersion: 3, maxStreak: 24 }),
      b.updateAuxiliary(initial.generation, 'hours', { schemaVersion: 3, maxStreak: 12 }),
    ]);
    const saved = await api.loadAchievementRecords(file);
    assert.deepEqual(saved.auxiliary.activity.settingKeys, ['compactNumbers', 'decimalPlaces']);
    assert.deepEqual(saved.auxiliary.activity.features, ['localAdviceFeedback', 'localShareExport']);
    assert.equal(saved.auxiliary.hours.maxStreak, 24);
    const cleared = await b.clear();
    await assert.rejects(a.updateAuxiliary(initial.generation, 'hours', saved.auxiliary.hours), /generation/);
    const restored = await a.initialize([], () => true, saved.auxiliary);
    assert.deepEqual(restored.auxiliary, cleared.auxiliary);
    assert.deepEqual(restored.auxiliary.activity.features, []);
    assert.equal(restored.auxiliary.hours.maxStreak, 0);
  });
});

test('canonical auxiliary proof rejects nested private fields and keeps calendar contexts separate', async () => {
  await withStore(async file => {
    const api = storeApi();
    const repository = new api.AchievementRecordRepository(file);
    const first = await repository.initialize([]);
    const before = await readFile(file, 'utf8');
    for (const value of [
      { schemaVersion: 2, settingKeys: ['private-canary'], features: [] },
      { schemaVersion: 2, settingKeys: [], features: [], path: 'private-canary' },
    ]) {
      await assert.rejects(repository.updateAuxiliary(first.generation, 'activity', value), /invalid/);
      assert.equal(await readFile(file, 'utf8'), before);
    }
    await assert.rejects(repository.updateAuxiliary(first.generation, 'hours', { schemaVersion: 3, maxStreak: 49 }), /invalid/);
    const peak = (timeZone: string, amount: number) => ({ schemaVersion: 1, ruleVersion: 1, parserVersion: 1, periodVersion: 1, timeZone, providers: 3, peakFourWeekAverage: amount });
    await repository.updateAuxiliary(first.generation, 'calendarPeak', peak('UTC', 1000));
    await repository.updateAuxiliary(first.generation, 'calendarPeak', peak('UTC', 200));
    assert.equal((await api.loadAchievementRecords(file)).auxiliary.calendarPeak.peakFourWeekAverage, 1000);
    await repository.updateAuxiliary(first.generation, 'calendarPeak', peak('Asia/Shanghai', 200));
    assert.equal((await api.loadAchievementRecords(file)).auxiliary.calendarPeak.peakFourWeekAverage, 200);
  });
});

test('action proof and its awards commit together so a peer cannot steal fresh provenance', async () => {
  await withStore(async file => {
    const repository = new (storeApi().AchievementRecordRepository)(file);
    const initial = await repository.initialize([]);
    const action = await repository.recordActivity(initial.generation,
      { schemaVersion: 2, settingKeys: [], features: ['localShareExport'] },
      { recordedDay: '2026-10-08', timeZone: 'UTC' });
    assert.deepEqual(action.added.map((row: any) => row.id), ['local-share-export']);
    assert.equal(action.added[0].origin, 'activity');
    const peer = await repository.append(initial.generation,
      [{ id: 'local-share-export', origin: 'history', recordedDay: null, timeZone: null }]);
    assert.deepEqual(peer.added, []);
    assert.equal(peer.store.records[0].origin, 'activity');
    const duplicate = await repository.recordActivity(initial.generation,
      { schemaVersion: 2, settingKeys: [], features: ['localShareExport'] },
      { recordedDay: '2026-10-09', timeZone: 'UTC' });
    assert.deepEqual(duplicate.added, []);
    assert.equal(duplicate.store.records[0].recordedDay, '2026-10-08');
  });
});

test('old grants migrate quietly with unknown dates, once and within 64 KiB', async () => {
  await withStore(async file => {
    const api = storeApi();
    const repository = new api.AchievementRecordRepository(file);
    const legacyIds = ACHIEVEMENT_DEFINITIONS.filter(row => isLegacyAchievementId(row.id)).map(row => row.id);
    assert.equal(legacyIds.length, 124);
    const first = await repository.initialize(legacyIds);
    assert.equal(first.records.length, 124);
    assert.ok(first.records.every((row: any) => row.origin === 'existing' && row.recordedDay === null && row.timeZone === null && !row.unread));
    assert.equal(new Set(first.records.map((row: any) => row.seq)).size, 124);
    assert.ok(Buffer.byteLength(await readFile(file, 'utf8')) <= 65_536);
    assert.equal((await repository.initialize(['unknown-private-canary'])).records.length, 124, 'existing canonical state wins over stale legacy input');
    assert.equal(api.recentAchievementRecords(first).length, 30);
  });
});

test('frozen V1 initialization, append and codec reject every new money ID without changing bytes', async () => {
  for (const rule of API_ACHIEVEMENT_DEFINITIONS) {
    await withStore(async file => {
      const api = storeApi(), repository = new api.AchievementRecordRepository(file);
      assert.equal(isLegacyAchievementId(rule.id), false);
      await assert.rejects(repository.initialize([rule.id]), /invalid/);
      assert.deepEqual(await readdir(path.dirname(file)), [], 'rejected migration creates no canonical proof');
      const initial = await repository.initialize([]);
      const before = await readFile(file, 'utf8');
      const referencePricebook = getAchievementMoneyPricebook(rule.group === 'codex' ? 'openai' : 'anthropic').version;
      const draft = { id: rule.id, origin: 'usage', ...recording, referencePricebook };
      await assert.rejects(repository.append(initial.generation, [draft]), /invalid/);
      const record = { ...draft, ruleVersion: 1, seq: 1, unread: true };
      assert.throws(() => api.parseAchievementRecordStore({ ...initial, sequence: 1, records: [record] }), /invalid/);
      const { referencePricebook: _reference, ...withoutReference } = record;
      assert.throws(() => api.parseAchievementRecordStore({ ...initial, sequence: 1, records: [withoutReference] }), /invalid/);
      assert.equal(await readFile(file, 'utf8'), before);
    });
  }
});

test('two independent repositories merge concurrent append without lost or duplicate awards', async () => {
  await withStore(async file => {
    const { AchievementRecordRepository, loadAchievementRecords } = storeApi();
    const first = new AchievementRecordRepository(file);
    const second = new AchievementRecordRepository(file);
    const [a, b] = await Promise.all([first.initialize([]), second.initialize([])]);
    const results = await Promise.all([
      first.append(a.generation, [local(), local('settings-explorer-bronze')]),
      second.append(b.generation, [local(), local('local-advice-feedback')]),
    ]);
    const saved = await loadAchievementRecords(file);
    assert.equal(saved.records.length, 3);
    assert.deepEqual(saved.records.map((row: any) => row.seq).sort(), [1, 2, 3]);
    assert.equal(results.reduce((count: number, result: any) => count + result.added.length, 0), 3);
    assert.ok(saved.records.every((row: any) => row.unread));
    assert.deepEqual(await readdir(path.dirname(file)), ['achievements-v1.json']);
  });
});

test('separate Node processes share the actual lease and preserve both grants', async () => {
  await withStore(async file => {
    const run = (id: string): Promise<void> => new Promise((resolve, reject) => {
      const source = `const {AchievementRecordRepository}=require(process.argv[1]);
        (async()=>{const r=new AchievementRecordRepository(process.argv[2]);const s=await r.initialize([]);
        await r.append(s.generation,[{id:process.argv[3],origin:'activity',recordedDay:'2026-10-08',timeZone:'UTC'}]);})()
        .catch(()=>{process.exitCode=1;});`;
      const child = spawn(process.execPath, ['-e', source, require.resolve('../achievementRecordStore'), file, id], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('fixture child failed')));
    });
    await Promise.all([run('local-share-export'), run('local-advice-feedback')]);
    const saved = await storeApi().loadAchievementRecords(file);
    assert.deepEqual(saved.records.map((row: any) => row.id).sort(), ['local-advice-feedback', 'local-share-export']);
    assert.deepEqual(saved.records.map((row: any) => row.seq), [1, 2]);
  });
});

test('OFF while waiting for another process lease leaves canonical bytes unchanged', async () => {
  await withStore(async file => {
    const repository = new (storeApi().AchievementRecordRepository)(file);
    const initial = await repository.initialize([]);
    const before = await readFile(file, 'utf8');
    const lease = await acquireCodexIndexLease(file);
    let enabled = true;
    try {
      const pending = repository.append(initial.generation, [local()], () => enabled);
      const rejection = assert.rejects(pending, /cancelled/i);
      enabled = false;
      await rejection;
    } finally { await lease.release(); }
    assert.equal(await readFile(file, 'utf8'), before);
    assert.deepEqual(await readdir(path.dirname(file)), ['achievements-v1.json']);
  });
});

test('clear retains an empty generation fence and rejects every old-window mutation', async () => {
  await withStore(async file => {
    const { AchievementRecordRepository, loadAchievementRecords } = storeApi();
    const first = new AchievementRecordRepository(file);
    const second = new AchievementRecordRepository(file);
    const before = await first.initialize(['hundred-million-club']);
    await second.initialize([]);
    const cleared = await second.clear();
    assert.equal(cleared.generation, before.generation + 1);
    assert.equal(cleared.sequence, before.sequence, 'sequence never reuses a prior ACK number');
    assert.deepEqual(cleared.records, []);
    await assert.rejects(first.append(before.generation, [local()]), /generation/);
    await assert.rejects(first.acknowledge(before.generation, before.sequence), /generation/);
    await assert.rejects(first.pin(before.generation, ['cumulative-volume']), /generation/);
    assert.deepEqual((await first.initialize(['hundred-million-club'])).records, [], 'stale legacy grants cannot resurrect cleared canonical state');
    assert.deepEqual((await loadAchievementRecords(file)).records, []);
  });
});

test('only explicit bounded sequence ACK reads records; failed delivery and late ACK do not read later awards', async () => {
  await withStore(async file => {
    const { AchievementRecordRepository, loadAchievementRecords } = storeApi();
    const repository = new AchievementRecordRepository(file);
    const initial = await repository.initialize([]);
    const first = await repository.append(initial.generation, [local()]);
    assert.equal((await loadAchievementRecords(file)).records[0].unread, true, 'postMessage is not an ACK');
    await repository.append(initial.generation, [local('local-advice-feedback')]);
    const acked = await repository.acknowledge(initial.generation, first.store.sequence);
    assert.deepEqual(acked.records.map((row: any) => row.unread), [false, true]);
    const bytes = await readFile(file, 'utf8');
    await assert.rejects(repository.acknowledge(initial.generation, acked.sequence + 1), /invalid/);
    assert.equal(await readFile(file, 'utf8'), bytes);
  });
});

test('invalid, future, oversized and symlink documents fail closed without changing their bytes', async () => {
  await withStore(async file => {
    const { AchievementRecordRepository, loadAchievementRecords } = storeApi();
    const repository = new AchievementRecordRepository(file);
    const valid = await repository.initialize([]);
    for (const text of ['{', JSON.stringify({ ...valid, schemaVersion: 2 }), JSON.stringify({ ...valid, path: 'private-canary' }), ' '.repeat(65_537)]) {
      await writeFile(file, text);
      await assert.rejects(loadAchievementRecords(file), /invalid/);
      await assert.rejects(repository.initialize([]), /invalid/);
      await assert.rejects(repository.clear(), /invalid/);
      assert.equal(await readFile(file, 'utf8'), text);
    }
    await rm(file);
    const target = path.join(path.dirname(file), 'do-not-touch.json');
    await writeFile(target, JSON.stringify(valid));
    await symlink(target, file);
    await assert.rejects(loadAchievementRecords(file), /invalid/);
    await assert.rejects(repository.clear(), /invalid/);
    assert.equal(await readFile(target, 'utf8'), JSON.stringify(valid));
  });
});

test('strict drafts reject unknown IDs, arbitrary strings, impossible dates and duplicate keys', async () => {
  await withStore(async file => {
    const { AchievementRecordRepository } = storeApi();
    const repository = new AchievementRecordRepository(file);
    const initial = await repository.initialize([]);
    const before = await readFile(file, 'utf8');
    for (const draft of [{ ...local(), id: 'private-canary' }, { ...local(), origin: 'secret' }, { ...local(), timeZone: 'private-path-canary' }, { ...local(), recordedDay: '2026-02-30' }, { ...local(), prompt: 'private-canary' }]) {
      await assert.rejects(repository.append(initial.generation, [draft]), /invalid/);
      assert.equal(await readFile(file, 'utf8'), before);
    }
    await assert.rejects(repository.pin(initial.generation, ['astra', 'astra']), /invalid/);
    await assert.rejects(repository.pin(initial.generation, ['unknown']), /invalid/);
    await assert.rejects(repository.pin(initial.generation, Object.keys(require('../achievements').ACHIEVEMENT_SERIES).slice(0, 4)), /invalid/);
  });
});

test('OFF or retired work cancels before initialization and append; quiet reconciliation is not unread', async () => {
  await withStore(async file => {
    const { AchievementRecordRepository, loadAchievementRecords } = storeApi();
    const repository = new AchievementRecordRepository(file);
    await assert.rejects(repository.initialize([], () => false), /cancelled/);
    assert.deepEqual(await readdir(path.dirname(file)), []);
    const initial = await repository.initialize([]);
    await assert.rejects(repository.append(initial.generation, [local()], () => false), /cancelled/);
    const result = await repository.append(initial.generation, [{ id: 'hundred-million-club', origin: 'history', recordedDay: null, timeZone: null }]);
    assert.equal(result.added[0].unread, false);
    assert.equal((await loadAchievementRecords(file)).records.length, 1);
  });
});
