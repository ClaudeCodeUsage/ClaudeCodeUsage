import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Module = require('node:module');
import {
  ACHIEVEMENT_RECORD_FILE, ACHIEVEMENT_LEGACY_RECORD_FILE,
  AchievementRecordRepository, loadAchievementRecords,
} from '../achievementRecordStore';
import { createEmptyQuotaObservationStore } from '../quotaObservationStore';

function loadExtension() {
  const originalLoad = (Module as any)._load;
  const vscodeStub: any = new Proxy(function () {}, {
    get: (_target, property) => property === 'then' ? undefined : vscodeStub,
    apply: () => vscodeStub,
    construct: () => vscodeStub,
  });
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    return request === 'vscode' ? vscodeStub : originalLoad.call(this, request, parent, isMain);
  };
  try { return require('../extension') as typeof import('../extension'); }
  finally { (Module as any)._load = originalLoad; }
}
const { ClaudeCodeUsageExtension } = loadExtension();
const temporaryNames = [
  '.achievements-v1.json.123e4567-e89b-12d3-a456-426614174000.tmp',
  '.achievements-v2.json.123e4567-e89b-12d3-a456-426614174001.tmp',
];

async function fixture(run: (extension: any, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-local-data-v2-'));
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  extension.context = { globalStorageUri: { fsPath: root }, globalState: { keys: () => [], get: () => undefined } };
  extension.outputChannel = { appendLine: () => undefined };
  extension.localDataQuotaScopes = new Map();
  extension.quotaObservationStore = createEmptyQuotaObservationStore();
  extension.settings = { snapshot: () => [] };
  extension.webviewProvider = {
    adviceLocalDataInventorySummary: () => ({ approximateBytes: 0, itemCount: 0, oldestAt: null, newestAt: null }),
  };
  try {
    await writeFile(path.join(root, 'quota-observations-v2.json'), JSON.stringify(createEmptyQuotaObservationStore()));
    await run(extension, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function achievementRow(extension: any) {
  const inventory = await extension.buildLocalDataInventory({ uiPreferenceKeys: 0, webviewStateFields: 0, sharingPreferenceKeys: 0 });
  return inventory.rows.find((row: any) => row.id === 'P12');
}

test('actual v2 inventory counts current and archived receipts and bytes from both exact file families without leaking proof', async t => {
  await fixture(async (extension, root) => {
    assert.equal(ACHIEVEMENT_RECORD_FILE, 'achievements-v2.json', 'exercise the active production filename');
    const legacy = path.join(root, ACHIEVEMENT_LEGACY_RECORD_FILE);
    const current = path.join(root, ACHIEVEMENT_RECORD_FILE);
    await new AchievementRecordRepository(legacy).initialize(['sonnet-main', 'agent-team-gold']);
    const before = await readFile(legacy);
    const migrated = await new AchievementRecordRepository(current).initialize([]);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.records.length, 1);
    assert.equal(migrated.legacyRecords?.length, 1);
    const preserved = ['achievements-v1.json.bak', 'achievements-v2.json.bak', 'achievements-v3.json',
      '.achievements-v2.json.not-a-uuid.tmp', 'achievements-v1.json.lock', 'source.jsonl'];
    for (const name of [...temporaryNames, ...preserved]) await writeFile(path.join(root, name), 'private-proof-canary');
    const expectedNames = [ACHIEVEMENT_LEGACY_RECORD_FILE, ACHIEVEMENT_RECORD_FILE, ...temporaryNames].sort();
    const expectedBytes = (await Promise.all(expectedNames.map(name => readFile(path.join(root, name))))).reduce((sum, bytes) => sum + bytes.length, 0);
    await t.test('both canonical names and only exact interrupted files belong to the family', async () => {
      for (const file of [legacy, current]) {
        assert.deepEqual((await extension.derivedFileFamilyNames(file, 'achievement-records')).sort(), expectedNames);
      }
    });
    await t.test('file inventory includes both versions without scanning source files', async () => {
      const family = await extension.localFileFamilyInventory(current, 'achievement-records');
      assert.equal(family.itemCount, 4);
      assert.equal(family.approximateBytes, expectedBytes);
    });
    const row = await achievementRow(extension);
    await t.test('public inventory describes schema 2 and its bound', () => assert.match(row.schema, /^2\b.*64 KiB/));
    await t.test('public count includes archives without double-counting v1 migration input', () => assert.equal(row.itemCount, 2));
    await t.test('public bytes include both versions', () => assert.equal(row.approximateBytes, expectedBytes));
    assert.equal(row.oldestAt, null);
    assert.equal(row.newestAt, null);
    const publicData = JSON.stringify(row);
    for (const privateValue of [root, 'private-proof-canary', 'agent-team-gold', 'sonnet-main', migrated.legacyBoundary!.signature]) {
      assert.equal(publicData.includes(privateValue), false, 'only value-free counts leave the host');
    }
    assert.deepEqual(await readFile(legacy), before, 'inventory leaves migration input unchanged');
  });
});

test('inventory describes legacy-only migration input and fails closed for invalid, oversized or linked current records', async () => {
  await fixture(async (extension, root) => {
    const legacy = path.join(root, ACHIEVEMENT_LEGACY_RECORD_FILE);
    const current = path.join(root, ACHIEVEMENT_RECORD_FILE);
    await new AchievementRecordRepository(legacy).initialize(['agent-team-gold']);
    const legacyRow = await achievementRow(extension);
    assert.match(legacyRow.schema, /^1\b/);
    assert.equal(legacyRow.itemCount, 1);
    assert.equal(legacyRow.approximateBytes, (await readFile(legacy)).length);
    await new AchievementRecordRepository(current).initialize([]);
    const valid = await readFile(current);
    for (const body of ['{"schemaVersion":99,"privateCanary":"private-proof-canary"}', ' '.repeat(65_537), await readFile(legacy, 'utf8')]) {
      await writeFile(current, body);
      const row = await achievementRow(extension);
      assert.equal(row.itemCount, null, 'an invalid current file cannot fall back to legacy grants');
      assert.equal(JSON.stringify(row).includes('private-proof-canary'), false);
    }
    await rm(current);
    const target = path.join(root, 'unrelated-private-target.json');
    await writeFile(target, valid);
    await symlink(target, current);
    assert.equal((await achievementRow(extension)).itemCount, null);
    assert.deepEqual(await readFile(target), valid);
  });
});

test('clear postcondition rejects archive-only v2 and accepts actual clear with its required empty downgrade fence', async () => {
  await fixture(async (extension, root) => {
    const legacy = path.join(root, ACHIEVEMENT_LEGACY_RECORD_FILE);
    const current = path.join(root, ACHIEVEMENT_RECORD_FILE);
    await new AchievementRecordRepository(legacy).initialize(['agent-team-gold']);
    const repository = new AchievementRecordRepository(current);
    const migrated = await repository.initialize([]);
    assert.deepEqual(migrated.records, []);
    assert.equal(migrated.legacyRecords?.length, 1);
    await assert.rejects(extension.verifyClearAllPostcondition(), /achievement/, 'archived receipts are derived data too');
    for (const name of temporaryNames) await writeFile(path.join(root, name), 'interrupted-private-proof');
    await repository.clear();
    await extension.verifyClearAllPostcondition();
    assert.deepEqual((await extension.derivedFileFamilyNames(current, 'achievement-records')).sort(),
      [ACHIEVEMENT_LEGACY_RECORD_FILE, ACHIEVEMENT_RECORD_FILE].sort());
    assert.deepEqual((await loadAchievementRecords(current))?.legacyRecords, []);
    assert.deepEqual((await loadAchievementRecords(legacy))?.records, []);
  });
});

test('clear postcondition rejects missing, populated, invalid, linked or mismatched downgrade fences and v2 residue', async t => {
  await fixture(async (extension, root) => {
    const legacy = path.join(root, ACHIEVEMENT_LEGACY_RECORD_FILE);
    const current = path.join(root, ACHIEVEMENT_RECORD_FILE);
    const old = new AchievementRecordRepository(legacy);
    await old.initialize(['sonnet-main']);
    const oldBytes = await readFile(legacy);
    const repository = new AchievementRecordRepository(current);
    await repository.initialize([]);
    const cleared = await repository.clear();
    const currentBytes = await readFile(current);
    const legacyBytes = await readFile(legacy);
    const fence = JSON.parse(legacyBytes.toString());
    const cases: Array<[string, () => Promise<void>]> = [
      ['missing v1', () => rm(legacy)],
      ['populated v1', () => writeFile(legacy, oldBytes)],
      ['invalid v1', () => writeFile(legacy, ' '.repeat(65_537))],
      ['v2 schema in v1', () => writeFile(legacy, currentBytes)],
      ['v1 schema in v2', () => writeFile(current, legacyBytes)],
      ['unmatched fence', () => writeFile(legacy, JSON.stringify({ ...fence, sequence: fence.sequence + 1 }))],
      ['v2 archive residue', () => writeFile(current, JSON.stringify({ ...cleared, sequence: cleared.sequence + 1,
        legacyRecords: [{ id: 'agent-team-gold', origin: 'existing', recordedDay: null, timeZone: null,
          ruleVersion: 1, seq: cleared.sequence + 1, unread: false }] }))],
      ['interrupted v1 write', () => writeFile(path.join(root, temporaryNames[0]), 'private-proof-canary')],
      ['interrupted v2 write', () => writeFile(path.join(root, temporaryNames[1]), 'private-proof-canary')],
      ['linked v1', async () => {
        const target = path.join(root, 'private-fence-target.json');
        await writeFile(target, legacyBytes);
        await rm(legacy);
        await symlink(target, legacy);
      }],
    ];
    for (const [name, corrupt] of cases) {
      await rm(legacy, { force: true });
      await writeFile(legacy, legacyBytes);
      await writeFile(current, currentBytes);
      for (const temporary of temporaryNames) await rm(path.join(root, temporary), { force: true });
      await corrupt();
      await t.test(name, async () => {
        await assert.rejects(extension.verifyClearAllPostcondition(), /achievement-record:invalid|achievement-postcondition-failed/, name);
      });
    }
  });
});
