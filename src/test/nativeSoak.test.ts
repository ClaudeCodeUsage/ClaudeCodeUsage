import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Module = require('node:module');

const helper = (): any => require(path.resolve(__dirname, '../../tests/native/soak.cjs'));
const isolation = (): any => require(path.resolve(__dirname, '../../tests/native/isolation.cjs'));
const memory = { rss: 300 * 1024 ** 2, heapUsed: 30 * 1024 ** 2,
  external: 5 * 1024 ** 2, arrayBuffers: 1024 };
const owned = { activeCount: 3, byKind: { timer: 1, watcher: 2, worker: 0, network: 0, backfill: 0 } };

test('native soak options are explicit, finite and never turn a short preflight into a long-soak pass', () => {
  assert.deepEqual(helper().validateSoakOptions({ durationMs: 1800000 }), { durationMs: 1800000 });
  for (const value of [null, {}, { durationMs: -1 }, { durationMs: NaN }, { durationMs: 3600001 },
    { durationMs: 1800000, root: '/' }, { durationMs: '1800000' }]) {
    assert.throws(() => helper().validateSoakOptions(value), /^Error: native-soak:invalid-options$/);
  }
  assert.equal(helper().longSoakDurationPassed(500), false);
  assert.equal(helper().longSoakDurationPassed(1799999), false);
  assert.equal(helper().longSoakDurationPassed(1800000), true);
});

test('native soak samples keep only fixed anonymous numbers and copied ownership counts', () => {
  const input: any = { ...memory, arbitrary: 'must not be retained' };
  const resources: any = { ...owned, byKind: { ...owned.byKind }, active: ['must not be retained'] };
  const sample = helper().sampleOwnedResources(input, resources, 123, true, true, 2, 1);
  resources.byKind.watcher = 99;
  assert.deepEqual(sample, { elapsedMs: 123, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external, arrayBufferBytes: memory.arrayBuffers, ownedActive: 3,
    ownedByKind: owned.byKind, achievementsEnabled: true, panelOpen: true, panelCacheEntries: 2,
    pendingNoticeEntries: 1 });
  assert.ok(!JSON.stringify(sample).includes('retained'));
});

test('native soak resource guard rejects owned network, excess watchers and incomplete samples', () => {
  const sample = helper().sampleOwnedResources(memory, owned, 0, false, false, 0, 0);
  helper().assertResourceBudget(sample);
  for (const [kind, count] of [['network', 1], ['watcher', 3], ['worker', 2], ['timer', 9]]) {
    const changed = { ...sample, ownedByKind: { ...sample.ownedByKind, [kind]: count } };
    assert.throws(() => helper().assertResourceBudget(changed), /native-soak:resource-budget/);
  }
  assert.throws(() => helper().sampleOwnedResources({ ...memory, rss: undefined }, owned, 0, false, false, 0, 0),
    /native-soak:invalid-sample/);
  assert.throws(() => helper().assertResourceBudget({ ...sample, rssBytes: 2 * 1024 ** 3 }),
    /native-soak:resource-budget/);
});

test('native soak sample count and panel/notice caches cannot grow without bound', () => {
  const sample = helper().sampleOwnedResources(memory, owned, 0, true, false, 0, 0);
  for (const changed of [{ ...sample, panelCacheEntries: 25 }, { ...sample, pendingNoticeEntries: 3 }]) {
    assert.throws(() => helper().assertResourceBudget(changed), /native-soak:resource-budget/);
  }
  const samples: any[] = [];
  for (let i = 0; i < 1024; i++) helper().appendBoundedSample(samples, sample);
  assert.throws(() => helper().appendBoundedSample(samples, sample), /native-soak:sample-budget/);
  assert.equal(samples.length, 1024);
});

test('native soak operation deadlines reject a stuck operation but keep settled results exact', async () => {
  assert.equal(await helper().bounded(Promise.resolve(42), 50), 42);
  await assert.rejects(helper().bounded(new Promise(() => undefined), 10), /native-soak:operation-timeout/);
});

test('native soak preserves anonymous entry and failure reports when activation rejects', async t => {
  const { plan } = await fixtures(t);
  await fs.writeFile(path.join(plan.root, 'native-stage-manifest.json'), JSON.stringify({ sourceHead: 'fea8879' }));
  const load = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return { version: 'synthetic-api-not-native', extensions: {
      getExtension: () => ({ activate: async () => { throw new Error('private-activation-detail'); } }),
    } };
    return load.call(this, request, parent, isMain);
  };
  try {
    await assert.rejects(helper().run(plan, { durationMs: 100 }), /^Error: native-soak:failed-activation$/);
    const progress = JSON.parse(await fs.readFile(path.join(plan.root, 'native-soak-progress.json'), 'utf8'));
    const reportText = await fs.readFile(path.join(plan.root, 'native-soak-result.json'), 'utf8');
    const report = JSON.parse(reportText);
    assert.equal(progress.stage, 'activation');
    assert.equal(report.outcome, 'fail');
    assert.equal(report.failureStage, 'activation');
    assert.equal(report.stopCompleted, false);
    assert.equal(report.longSoakDurationPassed, false);
    assert.deepEqual(report.samples, []);
    assert.ok(!reportText.includes('private-activation-detail'));
    assert.ok(!reportText.includes(plan.root));
  } finally { (Module as any)._load = load; }
});

async function fixtures(t: TestContext): Promise<any> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ccu-native-v242-')));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const plan = isolation().buildNativeIsolationPlan(root), p = plan.directories;
  for (const directory of Object.values(p) as string[]) await fs.mkdir(directory);
  await fs.mkdir(path.join(p.claudeHome, 'projects/synthetic-native'), { recursive: true });
  await fs.mkdir(path.join(p.codexHome, 'sessions'));
  const files = [path.join(p.claudeHome, 'projects/synthetic-native/synthetic-native-0.jsonl'),
    path.join(p.codexHome, 'sessions/rollout-0.jsonl')];
  for (const file of files) await fs.writeFile(file, '{}\n');
  return { plan, files };
}

test('native soak appends only bounded anonymous synthetic records to its two exact regular files', async t => {
  const { plan, files } = await fixtures(t);
  const before = await Promise.all(files.map((file: string) => fs.readFile(file, 'utf8')));
  const result = await helper().appendSyntheticActivity(plan, 201, 1767225600000);
  assert.equal(result.files, 2);
  assert.ok(result.bytes > 0 && result.bytes < 4096);
  for (let i = 0; i < 2; i++) {
    const body = await fs.readFile(files[i], 'utf8');
    assert.ok(body.startsWith(before[i]));
    const row = JSON.parse(body.trim().split('\n')[1]);
    assert.equal(row.timestamp, '2026-01-01T00:00:00.000Z');
  }
  const claude = JSON.parse((await fs.readFile(files[0], 'utf8')).trim().split('\n')[1]);
  assert.equal(claude.message.usage.input_tokens, 1000);
  const codex = JSON.parse((await fs.readFile(files[1], 'utf8')).trim().split('\n')[1]);
  assert.equal(codex.payload.info.total_token_usage.input_tokens, 201000);
});

test('native soak refuses malformed sequence, forged source plan and symlink targets before append', async t => {
  const { plan, files } = await fixtures(t);
  const before = await fs.readFile(files[0], 'utf8');
  for (const sequence of [200, 0, 300, NaN, '201']) {
    await assert.rejects(helper().appendSyntheticActivity(plan, sequence, Date.now()), /native-soak:invalid-activity/);
  }
  const forged = structuredClone(plan);
  forged.directories.claudeHome = os.tmpdir();
  await assert.rejects(helper().appendSyntheticActivity(forged, 201, Date.now()), /native-test-isolation:invalid-plan/);
  await fs.unlink(files[1]);
  await fs.symlink(files[0], files[1]);
  await assert.rejects(helper().appendSyntheticActivity(plan, 201, Date.now()), /native-soak:nonregular-target/);
  // Both exact targets are verified before either write begins.
  assert.equal(await fs.readFile(files[0], 'utf8'), before);
});
