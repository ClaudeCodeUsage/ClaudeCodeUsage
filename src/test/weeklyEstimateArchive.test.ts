import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WeeklyEstimateArchive, WeeklyEstimateInput } from '../weeklyEstimateArchive';

const SALT = 'synthetic-machine-salt';
const SOURCE = '/synthetic/source-private-canary';
const NOW = 1_800_000_000_000;
function estimate(overrides: Partial<WeeklyEstimateInput> = {}): WeeklyEstimateInput {
  return {
    provider: 'codex', windowStart: NOW - 604_800_000, resetAt: NOW,
    observedAt: NOW - 1000, estimatedAt: NOW,
    usedEquivalentUsd: 20, fullEquivalentUsd: 100, unusedEquivalentUsd: 80,
    utilizationPercent: 20, pricingCoverage: 1, method: 'paired-delta',
    pricingVersion: 'api-equivalent-v1', flags: ['account-unattributed'], ...overrides,
  };
}
async function fixture(t: { after(fn: () => Promise<void>): void }, options = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-estimate-archive-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json');
  return { root, file, archive: new WeeklyEstimateArchive(file, SALT, SOURCE, options) };
}

test('missing archive loads empty without creating files; records numeric fixed fields at mode 0600', async t => {
  const { archive, file, root } = await fixture(t);
  assert.deepEqual(await archive.load(), { status: 'ready', entries: [], totalEntries: 0,
    totalEntriesByProvider: { claude: 0, codex: 0 }, generation: 0, clearedThrough: {} });
  assert.deepEqual(await readdir(root), []);
  const input = { ...estimate(), secret: 'raw-secret-canary' };
  const result = await archive.record(input);
  assert.equal(result.outcome, 'recorded');
  assert.equal(result.entries[0].revision, 1);
  assert.match(result.entries[0].sourceKey, /^[a-f0-9]{64}$/);
  assert.match(result.entries[0].windowKey, /^[a-f0-9]{64}$/);
  const body = await readFile(file, 'utf8');
  assert.doesNotMatch(body, /source-private-canary|synthetic-machine-salt|raw-secret-canary|sourceNamespace/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(root), [path.basename(file)]);
  assert.deepEqual((await archive.load()).entries, result.entries);
});

test('refresh timestamps and flag order do not duplicate; changes append immutable revisions', async t => {
  const { archive, file } = await fixture(t);
  const first = await archive.record(estimate({ flags: ['partial-pricing', 'account-unattributed'] }));
  const before = await readFile(file, 'utf8');
  const duplicate = await archive.record(estimate({ observedAt: NOW, estimatedAt: NOW + 10,
    flags: ['account-unattributed', 'partial-pricing', 'partial-pricing'] }));
  assert.equal(duplicate.outcome, 'unchanged');
  assert.equal(await readFile(file, 'utf8'), before);
  const revised = await archive.record(estimate({ usedEquivalentUsd: 25, estimatedAt: NOW + 20 }));
  assert.equal(revised.entries.length, 2);
  assert.deepEqual(revised.entries[0], first.entries[0]);
  assert.equal(revised.entries[1].revision, 2);
  assert.equal(revised.entries[1].windowKey, first.entries[0].windowKey);
  assert.equal((await archive.record(estimate({ flags: ['account-unattributed', 'partial-pricing'] }))).outcome, 'unchanged');
});

test('reset, provider, method and optional account scope separate windows; loads retain all accounts', async t => {
  const { archive } = await fixture(t);
  for (const change of [{}, { resetAt: NOW + 1 }, { provider: 'claude' as const },
    { method: 'owned-window' as const }, { accountScopeKey: 'a'.repeat(64) }, { accountScopeKey: 'b'.repeat(64) }]) {
    await archive.record(estimate(change));
  }
  const loaded = await archive.load();
  assert.equal(loaded.entries.length, 6);
  assert.equal(new Set(loaded.entries.map(e => e.windowKey)).size, 6);
  assert.ok(loaded.entries.every(e => e.revision === 1));
});

test('source filtering and machine salt isolation never overwrite other source history', async t => {
  const { archive, file } = await fixture(t);
  const other = new WeeklyEstimateArchive(file, SALT, 'another-source');
  const otherMachine = new WeeklyEstimateArchive(file, 'other-salt', SOURCE);
  await archive.record(estimate());
  await other.record(estimate());
  await otherMachine.record(estimate());
  const groups = await Promise.all([archive.load(), other.load(), otherMachine.load()]);
  assert.ok(groups.every(g => g.entries.length === 1));
  assert.equal(new Set(groups.map(g => g.entries[0].sourceKey)).size, 3);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).entries.length, 3);
});

test('nullable estimates remain missing and all allowlisted flags survive', async t => {
  const { archive } = await fixture(t);
  const result = await archive.record(estimate({ fullEquivalentUsd: null, unusedEquivalentUsd: null,
    utilizationPercent: null, pricingCoverage: 0, method: 'legacy-prefix-ratio',
    flags: ['account-unattributed', 'boundary-uncertain', 'partial-pricing', 'stale-observation',
      'counter-change', 'reconstructed'] }));
  assert.equal(result.entries[0].fullEquivalentUsd, null);
  assert.equal(result.entries[0].flags.length, 6);
});

test('invalid input is rejected without creating or changing an archive', async t => {
  const { archive, root } = await fixture(t);
  for (const changes of [
    { provider: 'other' }, { method: 'other' }, { pricingCoverage: -0.1 }, { pricingCoverage: 1.01 },
    { usedEquivalentUsd: NaN }, { usedEquivalentUsd: Infinity }, { usedEquivalentUsd: -1 },
    { fullEquivalentUsd: 1e13 }, { unusedEquivalentUsd: undefined }, { utilizationPercent: 101 },
    { observedAt: -1 }, { estimatedAt: 1.2 }, { resetAt: Number.MAX_SAFE_INTEGER },
    { windowStart: NOW }, { flags: ['secret-flag'] }, { flags: Array(20).fill('partial-pricing') },
    { accountScopeKey: 'raw-account-id' }, { accountScopeKey: 'A'.repeat(64) },
    { pricingVersion: '/private/path' }, { pricingVersion: 'x'.repeat(100) },
  ]) {
    assert.equal((await archive.record({ ...estimate(), ...changes } as WeeklyEstimateInput)).outcome, 'invalid', JSON.stringify(changes));
  }
  assert.deepEqual(await readdir(root), []);
});

test('malformed or unsupported documents fail closed without overwriting or quarantining', async t => {
  const { archive, file } = await fixture(t);
  await archive.record(estimate());
  const valid = JSON.parse(await readFile(file, 'utf8'));
  for (const body of ['{secret', JSON.stringify({ ...valid, schemaVersion: 99 }),
    JSON.stringify({ ...valid, entries: [...valid.entries, { ...valid.entries[0], usedEquivalentUsd: -1 }] }),
    JSON.stringify({ ...valid, entries: [{ ...valid.entries[0], windowKey: '0'.repeat(64) }] }),
    JSON.stringify({ ...valid, entries: [{ ...valid.entries[0], revision: 2 }] }),
    JSON.stringify({ ...valid, entries: [...valid.entries, valid.entries[0]] }),
  ]) {
    await writeFile(file, body);
    assert.equal((await archive.load()).status, 'invalid');
    assert.equal((await archive.record(estimate())).outcome, 'invalid');
    assert.equal(await readFile(file, 'utf8'), body);
  }
  assert.equal((await archive.clear()).status, 'invalid');
  const cleared = await archive.clear({ allSources: true });
  assert.equal(cleared.status, 'ready'); assert.equal(cleared.totalEntries, 0);
});

test('unknown persisted fields are not returned or copied by a subsequent record', async t => {
  const { archive, file } = await fixture(t);
  await archive.record(estimate());
  const document = JSON.parse(await readFile(file, 'utf8'));
  document.secret = 'unknown-canary';
  document.entries[0].secret = 'unknown-canary';
  await writeFile(file, JSON.stringify(document));
  assert.doesNotMatch(JSON.stringify(await archive.load()), /unknown-canary/);
  await archive.record(estimate({ usedEquivalentUsd: 21 }));
  assert.doesNotMatch(await readFile(file, 'utf8'), /unknown-canary/);
});

test('entry capacity is global, stops appends without eviction, and still deduplicates', async t => {
  const { archive, file } = await fixture(t, { maxEntries: 2 });
  await archive.record(estimate());
  await archive.record(estimate({ usedEquivalentUsd: 21 }));
  const before = await readFile(file, 'utf8');
  assert.equal((await archive.load()).status, 'full');
  assert.equal((await archive.record(estimate())).outcome, 'unchanged');
  assert.equal((await archive.record(estimate({ usedEquivalentUsd: 22 }))).outcome, 'full');
  assert.equal(await readFile(file, 'utf8'), before);
  const other = new WeeklyEstimateArchive(file, SALT, 'other', { maxEntries: 2 });
  assert.equal((await other.record(estimate())).outcome, 'full');
  assert.deepEqual((await other.load()).entries, []);
  const cleared = await archive.clear();
  assert.equal((await archive.record(estimate({ observedAt: cleared.clearedThrough.codex! + 1 }))).outcome, 'recorded');
});

test('byte bounds reject oversized files and candidates without eviction', async t => {
  const { archive, file } = await fixture(t);
  await archive.record(estimate());
  const body = await readFile(file, 'utf8');
  const small = new WeeklyEstimateArchive(file, SALT, SOURCE, { maxBytes: Buffer.byteLength(body) + 1 });
  assert.equal((await small.record(estimate({ usedEquivalentUsd: 21 }))).outcome, 'full');
  assert.equal(await readFile(file, 'utf8'), body);
  await writeFile(file, ' '.repeat(1024 * 1024 + 1));
  assert.equal((await archive.load()).status, 'invalid');
  assert.equal((await archive.record(estimate())).outcome, 'invalid');
});

test('symlink files and parent directories are refused for load, record and clear', async t => {
  const { root, file } = await fixture(t);
  const target = path.join(root, 'target');
  await writeFile(target, 'untouched-canary');
  await symlink(target, file);
  const outside = path.join(root, 'real');
  await mkdir(outside);
  const link = path.join(root, 'linked');
  await symlink(outside, link);
  for (const archive of [new WeeklyEstimateArchive(file, SALT, SOURCE),
    new WeeklyEstimateArchive(path.join(link, 'archive.json'), SALT, SOURCE)]) {
    assert.equal((await archive.load()).status, 'unsafe');
    assert.equal((await archive.record(estimate())).outcome, 'unsafe');
    assert.equal((await archive.clear({ allSources: true })).status, 'unsafe');
  }
  assert.equal(await readFile(target, 'utf8'), 'untouched-canary');
  assert.deepEqual(await readdir(outside), []);
});

test('nonregular archive path fails closed', async t => {
  const { archive, file } = await fixture(t);
  await mkdir(file);
  assert.equal((await archive.load()).status, 'unsafe');
  assert.equal((await archive.record(estimate())).outcome, 'unsafe');
  assert.equal((await archive.clear({ allSources: true })).status, 'unsafe');
});

test('cross-instance appends reread under lease; concurrent duplicates remain unique', async t => {
  const { archive, file } = await fixture(t);
  const other = new WeeklyEstimateArchive(file, SALT, SOURCE);
  await Promise.all([archive.record(estimate()), other.record(estimate({ usedEquivalentUsd: 21 }))]);
  assert.deepEqual((await archive.load()).entries.map(e => e.revision), [1, 2]);
  await Promise.all([archive.record(estimate({ usedEquivalentUsd: 22 })), other.record(estimate({ usedEquivalentUsd: 22 }))]);
  assert.equal((await archive.load()).entries.length, 3);
});

test('source/provider clear preserves other accounts and sources as selected; all clear empties canonical', async t => {
  const { archive, file } = await fixture(t);
  const other = new WeeklyEstimateArchive(file, SALT, 'other');
  await archive.record(estimate());
  await archive.record(estimate({ provider: 'claude' }));
  await other.record(estimate());
  assert.deepEqual((await archive.clear({ provider: 'codex' })).entries.map(e => e.provider), ['claude']);
  await archive.clear();
  assert.equal((await other.load()).entries.length, 1);
  await archive.clear({ allSources: true });
  assert.equal((await other.load()).entries.length, 0);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).entries, []);
  const fence = (await other.load()).clearedThrough.codex!;
  await other.record(estimate({ observedAt: fence + 1 }));
  assert.equal((await other.load()).entries[0].revision, 1);
});

test('cross-instance clear and append do not resurrect stale cached history', async t => {
  const { archive, file } = await fixture(t);
  const other = new WeeklyEstimateArchive(file, SALT, SOURCE);
  await archive.record(estimate());
  await other.load();
  const cleared = await archive.clear({ allSources: true });
  assert.equal((await other.record(estimate({ usedEquivalentUsd: 22 }))).outcome, 'cleared-observation');
  await other.record(estimate({ usedEquivalentUsd: 22, observedAt: cleared.clearedThrough.codex! + 1 }));
  assert.deepEqual((await archive.load()).entries.map(e => e.usedEquivalentUsd), [22]);
  await Promise.all([archive.clear({ provider: 'codex' }), other.record(estimate({ provider: 'claude',
    observedAt: cleared.clearedThrough.claude! + 1 }))]);
  assert.deepEqual((await archive.load()).entries.map(e => e.provider), ['claude']);
});

test('configuration bounds cannot increase hard limits or accept missing namespace/salt', () => {
  for (const options of [{ maxEntries: 4097 }, { maxEntries: NaN }, { maxEntries: 0 },
    { maxBytes: 1024 * 1024 + 1 }, { maxBytes: -1 }]) {
    assert.throws(() => new WeeklyEstimateArchive('/synthetic/archive', SALT, SOURCE, options));
  }
  assert.throws(() => new WeeklyEstimateArchive('/synthetic/archive', '', SOURCE));
  assert.throws(() => new WeeklyEstimateArchive('/synthetic/archive', SALT, ''));
});

test('persisted structural and numeric malformations reject the entire document', async t => {
  const { archive, file } = await fixture(t);
  await archive.record(estimate());
  const document = JSON.parse(await readFile(file, 'utf8'));
  for (const body of [null, [], {}, { ...document, entries: {} },
    { ...document, entries: Array(4097).fill(null) },
    ...[{ sourceKey: 'raw-account' }, { revision: 0 }, { revision: 1.5 },
      { accountScopeKey: 'raw-id' }, { flags: ['raw-flag'] }, { pricingCoverage: 2 },
      { usedEquivalentUsd: null }, { fullEquivalentUsd: -1 }, { observedAt: 'timestamp' }]
      .map(changes => ({ ...document, entries: [{ ...document.entries[0], ...changes }] })),
  ]) {
    const serialized = JSON.stringify(body);
    await writeFile(file, serialized);
    const loaded = await archive.load();
    assert.equal(loaded.status, 'invalid'); assert.deepEqual(loaded.entries, []);
    assert.equal((await archive.record(estimate())).outcome, 'invalid');
    assert.equal(await readFile(file, 'utf8'), serialized);
  }
});

test('exact byte limit is accepted as full; returned values cannot mutate retained records', async t => {
  const { archive, file } = await fixture(t);
  const input = estimate();
  const recorded = await archive.record(input);
  const body = await readFile(file, 'utf8');
  const bounded = new WeeklyEstimateArchive(file, SALT, SOURCE, { maxBytes: Buffer.byteLength(body) });
  assert.equal((await bounded.load()).status, 'full');
  assert.equal((await bounded.record(estimate())).outcome, 'unchanged');
  recorded.entries[0].usedEquivalentUsd = 123;
  (recorded.entries[0].flags as string[]).push('raw-canary');
  assert.equal((await archive.load()).entries[0].usedEquivalentUsd, 20);
  assert.equal(await readFile(file, 'utf8'), body);
});

test('clear all purges exact interrupted writes under the lease, preserving lookalikes and symlink targets', async t => {
  const { archive, root, file } = await fixture(t);
  await archive.record(estimate());
  const temporary = path.join(root, `.${path.basename(file)}.123.abcdef123456.tmp`);
  const lookalike = `${temporary}.unrelated`;
  const target = path.join(root, 'untouched-target');
  const linkedTemporary = path.join(root, `.${path.basename(file)}.456.abcdef123456.tmp`);
  await writeFile(temporary, 'old-derived-canary');
  await writeFile(lookalike, 'lookalike-canary');
  await writeFile(target, 'target-canary');
  await symlink(target, linkedTemporary);
  assert.equal((await archive.clear()).status, 'invalid');
  await archive.clear({ allSources: true });
  assert.equal(await readFile(target, 'utf8'), 'target-canary');
  assert.deepEqual((await readdir(root)).sort(), [path.basename(file), path.basename(lookalike), 'untouched-target'].sort());
});

test('symlink lock cannot redirect mutation or hang waiting on an unsafe lease', async t => {
  const { archive, root, file } = await fixture(t);
  const target = path.join(root, 'lock-target');
  await writeFile(target, 'untouched-lock-canary');
  await symlink(target, `${file}.lock`);
  assert.equal((await archive.record(estimate())).outcome, 'unsafe');
  assert.equal((await archive.clear({ allSources: true })).status, 'unsafe');
  assert.equal(await readFile(target, 'utf8'), 'untouched-lock-canary');
});

test('paired calibration evidence survives a reload with fixed copied fields', async t => {
  const { archive, file } = await fixture(t);
  const evidence = { calibrationStart: NOW - 2000, fullRange: { lower: 90, upper: 110, secret: 'range-canary' } };
  const recorded = await archive.record(estimate(evidence));
  assert.equal(recorded.entries[0].calibrationStart, NOW - 2000);
  assert.deepEqual(recorded.entries[0].fullRange, { lower: 90, upper: 110 });
  const reloaded = await new WeeklyEstimateArchive(file, SALT, SOURCE).load();
  assert.deepEqual(reloaded.entries[0], recorded.entries[0]);
  assert.doesNotMatch(await readFile(file, 'utf8'), /range-canary/);
  assert.equal((await archive.record(estimate({ ...evidence, calibrationStart: NOW - 3000 }))).entries[1].revision, 2);
});

test('malformed calibration intervals and full ranges fail closed on input and disk', async t => {
  const { archive, file } = await fixture(t);
  await archive.record(estimate());
  const valid = JSON.parse(await readFile(file, 'utf8'));
  for (const changes of [
    { calibrationStart: NOW - 604_800_001 }, { calibrationStart: NOW - 1000 },
    { calibrationStart: NaN }, { calibrationStart: NOW - 2000.5 },
    { fullRange: null }, { fullRange: { lower: 0, upper: 110 } },
    { fullRange: { lower: 101, upper: 110 } }, { fullRange: { lower: 90, upper: 99 } },
    { fullRange: { lower: 110, upper: 90 } }, { fullRange: { lower: 90, upper: Infinity } },
    { fullRange: { lower: 90, upper: 110 }, fullEquivalentUsd: null },
  ]) {
    assert.equal((await archive.record(estimate(changes as Partial<WeeklyEstimateInput>))).outcome, 'invalid');
    await writeFile(file, JSON.stringify({ ...valid, entries: [{ ...valid.entries[0], ...changes }] }));
    assert.equal((await archive.load()).status, 'invalid');
    await writeFile(file, JSON.stringify(valid));
  }
  const edge = await archive.record(estimate({ calibrationStart: NOW - 604_800_000, fullRange: { lower: 100, upper: 100 } }));
  assert.equal(edge.outcome, 'recorded');
});

test('four-component public pricing timestamp versions survive reload', async t => {
  const { archive } = await fixture(t);
  const result = await archive.record(estimate({ pricingVersion: 'openai-v0001.7923.7746.1234' }));
  assert.equal(result.outcome, 'recorded');
  assert.equal((await archive.load()).entries[0].pricingVersion, 'openai-v0001.7923.7746.1234');
});

test('a file already at byte capacity stops distinct records even if serialization would shrink it', async t => {
  const { archive, file } = await fixture(t);
  await archive.record(estimate());
  const body = await readFile(file, 'utf8');
  await writeFile(file, body + ' '.repeat(1024 * 1024 - Buffer.byteLength(body)));
  assert.equal((await archive.record(estimate({ usedEquivalentUsd: 21 }))).outcome, 'full');
  assert.equal((await stat(file)).size, 1024 * 1024);
});

test('global counts and generation are independent of source-filtered entry reads', async t => {
  const { archive, file } = await fixture(t);
  await archive.record(estimate());
  const verifier = new WeeklyEstimateArchive(file, SALT, 'clear');
  const loaded = await verifier.load();
  assert.deepEqual(loaded.entries, []);
  assert.equal(loaded.totalEntries, 1);
  assert.deepEqual(loaded.totalEntriesByProvider, { codex: 1, claude: 0 });
  const cleared = await verifier.clear({ allSources: true });
  assert.equal(cleared.totalEntries, 0);
  assert.ok(cleared.generation! > loaded.generation!);
});

test('generation rejects a stale writer, and durable clear cutoffs reject old observations after reload', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { archive, file } = await fixture(t);
  const seeded = await archive.record(estimate());
  const cleared = await new WeeklyEstimateArchive(file, SALT, 'clear').clear({ allSources: true });
  const before = await readFile(file, 'utf8');
  assert.equal((await archive.record(estimate({ observedAt: NOW + 1 }), { expectedGeneration: seeded.generation! })).outcome, 'stale-generation');
  assert.equal(await readFile(file, 'utf8'), before);
  const freshProcess = new WeeklyEstimateArchive(file, SALT, SOURCE);
  const loaded = await freshProcess.load();
  assert.equal(loaded.generation, cleared.generation);
  assert.equal(loaded.clearedThrough.codex, NOW);
  assert.equal((await freshProcess.record(estimate({ estimatedAt: NOW + 10_000 }), { expectedGeneration: loaded.generation! })).outcome, 'cleared-observation');
  assert.equal((await freshProcess.record(estimate({ observedAt: NOW }), { expectedGeneration: loaded.generation! })).outcome, 'cleared-observation');
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal((await freshProcess.record(estimate({ observedAt: NOW + 1, estimatedAt: NOW + 2 }), { expectedGeneration: loaded.generation! })).outcome, 'recorded');
});

test('source/provider cutoffs preserve unrelated history and cannot be bypassed by account or pricing changes', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { archive, file } = await fixture(t);
  const other = new WeeklyEstimateArchive(file, SALT, 'source-b');
  await archive.record(estimate());
  await archive.record(estimate({ provider: 'claude' }));
  await other.record(estimate());
  await archive.clear({ provider: 'codex' });
  assert.equal((await other.load()).totalEntries, 2);
  assert.equal((await archive.record(estimate({ accountScopeKey: 'c'.repeat(64), pricingVersion: 'openai-v2' }))).outcome, 'cleared-observation');
  assert.equal((await other.record(estimate({ usedEquivalentUsd: 21 }))).outcome, 'recorded');
  assert.equal((await archive.record(estimate({ provider: 'claude', usedEquivalentUsd: 21 }))).outcome, 'recorded');
  await new WeeklyEstimateArchive(file, SALT, 'clear').clear({ allSources: true, provider: 'codex' });
  assert.equal((await other.record(estimate({ usedEquivalentUsd: 22 }))).outcome, 'cleared-observation');
  assert.equal((await other.record(estimate({ provider: 'claude' }))).outcome, 'recorded');
  assert.deepEqual((await other.load()).totalEntriesByProvider, { codex: 0, claude: 3 });
});

test('legacy schema-1 loads with generation zero; malformed fences fail closed and unknown counts stay unknown', async t => {
  const { archive, file } = await fixture(t);
  await archive.record(estimate());
  const document = JSON.parse(await readFile(file, 'utf8'));
  delete document.generation; delete document.clearFences;
  await writeFile(file, JSON.stringify(document));
  assert.equal((await archive.load()).generation, 0);
  for (const extra of [ { generation: -1 }, { generation: 1.2 }, { clearFences: {} },
    { clearFences: [{ observedThrough: -1 }] }, { clearFences: [{ observedThrough: NOW, sourceKey: 'raw-path' }] },
    { clearFences: [{ observedThrough: NOW, provider: 'unknown' }] },
    { clearFences: [{ observedThrough: NOW }, { observedThrough: NOW }] },
    { clearFences: Array(129).fill({ observedThrough: NOW }) },
    { clearFences: [{ observedThrough: NOW }] }, // retained entries below a global fence are invalid
  ]) {
    await writeFile(file, JSON.stringify({ ...document, ...extra }));
    const result = await archive.load();
    assert.equal(result.status, 'invalid');
    assert.equal(result.totalEntries, null);
    assert.equal(result.generation, null);
  }
});

test('bounded fences never evict clear receipts; all-clear compacts them and clock rollback cannot weaken them', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { archive, file } = await fixture(t);
  const clearFences = Array.from({ length: 128 }, (_, i) => ({ sourceKey: i.toString(16).padStart(64, '0'), observedThrough: NOW }));
  await writeFile(file, JSON.stringify({ schemaVersion: 1, generation: 128, entries: [], clearFences }));
  const before = await readFile(file, 'utf8');
  assert.equal((await archive.clear()).status, 'full');
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal((await archive.clear({ allSources: true })).status, 'ready');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).clearFences.length, 1);
  t.mock.method(Date, 'now', () => NOW - 1000);
  await archive.clear({ allSources: true });
  assert.equal((await archive.load()).clearedThrough.codex, NOW);
  assert.equal((await archive.record(estimate({ observedAt: NOW - 500 }))).outcome, 'cleared-observation');
});

test('partial-history is an allowlisted flag preserved without promoting a missing full estimate', async t => {
  const { archive, file } = await fixture(t);
  await archive.record(estimate({ fullEquivalentUsd: null, unusedEquivalentUsd: null,
    flags: ['account-unattributed', 'partial-history'] }));
  const [entry] = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.deepEqual(entry.flags, ['account-unattributed', 'partial-history']);
  assert.equal(entry.fullEquivalentUsd, null);
});
