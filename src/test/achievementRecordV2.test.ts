import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as api from '../achievementRecordStore';
import { acquireCodexIndexLease } from '../providers/codex/codexIndexLease';

async function fixture(run: (legacy: string, current: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-awards-v2-'));
  try { await run(path.join(directory, 'achievements-v1.json'), path.join(directory, 'achievements-v2.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const ids = ['sonnet-main', 'opus-cannon', 'haiku-worker', 'astra-regular', 'sol-regular', 'luna-regular', 'local-share-export'] as const;
const repository = (file: string): any => new api.AchievementRecordRepository(file);
test('frozen v1 pin vocabulary cannot grow new monetary themes or poison a downgrade file',async()=>{
  await fixture(async legacy=>{
    const old=repository(legacy),base=await old.initialize(['local-share-export']);
    const before=await readFile(legacy);
    assert.throws(()=>api.parseAchievementRecordStore({...base,pins:['claude-api-total']}));
    await assert.rejects(old.pin(base.generation,['claude-api-total']));
    await assert.rejects(old.setPinned(base.generation,'codex-api-week',false));
    assert.deepEqual(await readFile(legacy),before);
  });
});

test('v2 migrates an existing canonical v1 while archiving changed qualifications and preserving its bytes', async () => {
  await fixture(async (legacy, current) => {
    const old = repository(legacy), base = await old.initialize(['sonnet-main', 'agent-team-gold']);
    await old.setPinned(base.generation, 'sonnet-main', true);
    await old.setPinned(base.generation, 'agent-team', true);
    const before = await readFile(legacy);
    const saved = await repository(current).initialize([]);
    assert.equal(saved.schemaVersion, 2);
    assert.deepEqual(saved.records.map((row: any) => row.id), ['sonnet-main']);
    assert.deepEqual(saved.legacyRecords.map((row: any) => [row.id, row.ruleVersion, row.unread]), [['agent-team-gold', 1, false]]);
    assert.deepEqual(saved.pins, ['sonnet-main', 'agent-team']);
    assert.equal(saved.showcaseMode, 'manual');
    assert.deepEqual(await readFile(legacy), before, 'normal migration reads but does not rewrite v1');
    assert.deepEqual(await repository(current).initialize(['agent-team-gold']), saved, 'existing v2 never reimports legacy Memento');
  });
});

test('new awards use the changed rule version and retain their old provenance separately', async () => {
  await fixture(async (legacy, current) => {
    await repository(legacy).initialize(['agent-team-gold']);
    const host = repository(current), saved = await host.initialize([]);
    const result = await host.append(saved.generation, [{id:'agent-team-gold',origin:'history',recordedDay:null,timeZone:null}]);
    assert.equal(result.added[0].ruleVersion, 2);
    assert.equal(result.added[0].unread, false);
    assert.equal(result.store.legacyRecords[0].ruleVersion, 1);
    assert.equal(result.store.legacyRecords[0].recordedDay, null);
  });
});

test('v2 supports six independent concurrent pin intents without awarding or marking read', async () => {
  await fixture(async (_legacy, current) => {
    const a = repository(current), b = repository(current), initial = await a.initialize(ids);
    await b.initialize([]);
    await Promise.all([a.setPinned(initial.generation, ids[0], true), b.setPinned(initial.generation, ids[1], true)]);
    for (const id of ids.slice(2, 6)) await a.setPinned(initial.generation, id, true);
    const saved: any = await api.loadAchievementRecords(current);
    assert.equal(saved.pins.length, 6);
    assert.equal(saved.showcaseMode, 'manual');
    assert.equal(saved.sequence, initial.sequence);
    const before = await readFile(current);
    await a.setPinned(initial.generation, ids[0], true);
    await assert.rejects(b.setPinned(initial.generation, ids[6], true), /pin-limit/);
    assert.deepEqual(await readFile(current), before);
    assert.ok(saved.records.every((row: any) => !row.unread));
  });
});

test('reordering pins fences stale whole-list requests and retains peers selections', async () => {
  await fixture(async (_legacy, current) => {
    const a = repository(current), b = repository(current), initial = await a.initialize(ids);
    await b.initialize([]);
    let saved = await a.setPinned(initial.generation, ids[0], true);
    saved = await a.setPinned(initial.generation, ids[1], true);
    const revision = saved.pinRevision;
    await b.setPinned(initial.generation, ids[2], true);
    await assert.rejects(a.reorderPinned(initial.generation, [ids[1], ids[0]], revision), /pin-stale/);
    saved = await api.loadAchievementRecords(current);
    const reordered = await a.reorderPinned(initial.generation, [ids[2], ids[1], ids[0]], saved.pinRevision);
    assert.deepEqual(reordered.pins, [ids[2], ids[1], ids[0]]);
    const automatic = await a.setShowcaseMode(initial.generation, 'automatic', reordered.pinRevision);
    assert.deepEqual(automatic.pins, reordered.pins, 'automatic display does not delete explicit choices');
    assert.equal(automatic.showcaseMode, 'automatic');
  });
});

test('a legacy writer changing state after v2 adoption fences writes until reload without importing its qualification', async () => {
  await fixture(async (legacy, current) => {
    const old = repository(legacy), oldBase = await old.initialize(['agent-team-gold']);
    const host = repository(current), saved = await host.initialize([]);
    await old.setPinned(oldBase.generation, 'agent-team', true);
    const before = await readFile(current);
    await assert.rejects(host.append(saved.generation, [{id:'sol-regular',origin:'history',recordedDay:null,timeZone:null}]), /old-writer/);
    assert.deepEqual(await readFile(current), before);
    const reloaded = await repository(current).initialize(['agent-team-gold']);
    assert.equal(reloaded.records.length, 0);
    assert.equal(reloaded.legacyRecords.length, 1);
  });
});

test('clearing v2 also fences legacy writers and downgrade/reupgrade cannot resurrect old awards', async () => {
  await fixture(async (legacy, current) => {
    const old = repository(legacy), oldBase = await old.initialize(['agent-team-gold', 'sonnet-main']);
    const host = repository(current), saved = await host.initialize([]);
    const cleared = await host.clear();
    assert.ok(cleared.generation > saved.generation);
    assert.deepEqual(cleared.records, []);
    assert.deepEqual(cleared.legacyRecords, []);
    assert.deepEqual(cleared.pins, []);
    await assert.rejects(old.setPinned(oldBase.generation, 'sonnet-main', true), /generation/);
    const downgraded = await repository(legacy).initialize(['agent-team-gold', 'sonnet-main']);
    assert.deepEqual(downgraded.records, []);
    const resumed = await repository(current).initialize(['agent-team-gold', 'sonnet-main']);
    assert.deepEqual(resumed.records, []);
    assert.deepEqual(resumed.legacyRecords, []);
  });
});

test('invalid legacy canonical input fails closed and leaves both ownership and source bytes intact', async () => {
  await fixture(async (legacy, current) => {
    const body = '{"schemaVersion":99,"privateCanary":"do not adopt"}';
    await writeFile(legacy, body);
    await assert.rejects(repository(current).initialize(['sonnet-main']), /invalid/);
    assert.equal(await readFile(legacy, 'utf8'), body);
    await assert.rejects(lstat(current), {code:'ENOENT'});
  });
});

test('OFF while migration waits for the real legacy lease leaves no v2 and does not alter v1', async () => {
  await fixture(async (legacy, current) => {
    await repository(legacy).initialize(['sonnet-main']);
    const before = await readFile(legacy);
    const lease = await acquireCodexIndexLease(legacy);
    let enabled = true;
    try {
      const pending = repository(current).initialize([], () => enabled);
      const rejected = assert.rejects(pending, /cancelled/);
      await new Promise(resolve => setTimeout(resolve, 25));
      await assert.rejects(lstat(current), {code:'ENOENT'}, 'migration really waits for the v1 owner');
      enabled = false;
      await rejected;
    } finally { await lease.release(); }
    assert.deepEqual(await readFile(legacy), before);
    await assert.rejects(lstat(current), {code:'ENOENT'});
  });
});

test('partial clear recovers its legacy fence before any old qualification can return', async () => {
  await fixture(async (legacy, current) => {
    await repository(legacy).initialize(['sonnet-main','agent-team-gold']);
    const before = await readFile(legacy);
    const host = repository(current);
    await host.initialize([]);
    const cleared = await host.clear();
    // A persisted v2 clear with an old v1 represents a failure between the two
    // fsync/rename commits. Recovery must complete the empty old-version fence.
    await writeFile(legacy,before);
    const resumed = await repository(current).initialize(['sonnet-main','agent-team-gold']);
    assert.equal(resumed.generation,cleared.generation);
    assert.deepEqual(resumed.records,[]);
    assert.deepEqual(resumed.legacyRecords,[]);
    assert.deepEqual((await repository(legacy).initialize(['sonnet-main'])).records,[]);
  });
});

test('a clear performed by a legacy host retires the v2 generation before new writes', async () => {
  await fixture(async (legacy,current) => {
    const old = repository(legacy);
    await old.initialize(['sonnet-main']);
    const host = repository(current),saved = await host.initialize([]);
    await old.clear();
    await assert.rejects(host.append(saved.generation,[{id:'sol-regular',origin:'history',recordedDay:null,timeZone:null}]), /generation/);
    const resumed = await repository(current).initialize(['sonnet-main']);
    assert.ok(resumed.generation > saved.generation);
    assert.deepEqual(resumed.records,[]);
  });
});

test('archived and current records cannot reuse one public receipt sequence', async () => {
  await fixture(async (legacy,current) => {
    await repository(legacy).initialize(['agent-team-gold']);
    const host = repository(current),saved = await host.initialize([]);
    const next = (await host.append(saved.generation,[{id:'agent-team-gold',origin:'history',recordedDay:null,timeZone:null}])).store;
    const malformed = JSON.parse(JSON.stringify(next));
    malformed.records[0].seq = malformed.legacyRecords[0].seq;
    assert.throws(()=>api.parseAchievementRecordStore(malformed),/invalid/);
  });
});

test('an explicit already-saved pin restores manual mode without losing the remaining selection', async () => {
  await fixture(async (_legacy,current) => {
    const host = repository(current),saved = await host.initialize(ids);
    const pinned = await host.setPinned(saved.generation,ids[0],true);
    const automatic = await host.setShowcaseMode(saved.generation,'automatic',pinned.pinRevision);
    const manual = await host.setPinned(saved.generation,ids[0],true);
    assert.equal(manual.showcaseMode,'manual');
    assert.ok(manual.pinRevision > automatic.pinRevision);
    assert.deepEqual(manual.pins,[ids[0]]);
  });
});

test('a downgrade clear is honored even when no legacy file existed at first v2 activation', async () => {
  await fixture(async (legacy,current) => {
    const saved = await repository(current).initialize(['sonnet-main']);
    assert.equal(saved.legacyBoundary,null);
    const old = repository(legacy);
    await old.initialize([]);
    await old.clear();
    const resumed = await repository(current).initialize(['sonnet-main']);
    assert.ok(resumed.generation > saved.generation);
    assert.deepEqual(resumed.records,[]);
  });
});

test('v2 whole-list pin changes require a current revision and cannot overwrite a peer', async () => {
  await fixture(async (_legacy,current) => {
    const a = repository(current), b = repository(current), saved = await a.initialize(ids);
    await b.initialize([]);
    const first = await a.setPinned(saved.generation,ids[0],true);
    await b.setPinned(saved.generation,ids[1],true);
    const before = await readFile(current);
    await assert.rejects(a.pin(saved.generation,[ids[0]]),/invalid/);
    await assert.rejects(a.pin(saved.generation,[ids[0]],()=>true,first.pinRevision),/pin-stale/);
    assert.deepEqual(await readFile(current),before);
  });
});

test('clear with no legacy file uses a fence above the first old-host generation', async () => {
  await fixture(async (legacy,current) => {
    const old = repository(legacy),oldBase = await old.initialize(['sonnet-main']);
    await rm(legacy);
    const host = repository(current);
    await host.initialize([]);
    await host.clear();
    await assert.rejects(old.append(oldBase.generation,[{id:'sonnet-main',origin:'history',recordedDay:null,timeZone:null}]),/generation/);
  });
});
