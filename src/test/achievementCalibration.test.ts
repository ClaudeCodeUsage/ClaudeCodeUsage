import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, codexModelSignals, evaluateAchievements } from '../achievements';
import { ACHIEVEMENT_RECORD_FILE, AchievementRecordRepository, loadAchievementRecords } from '../achievementRecordStore';
import { RECALIBRATED_ACHIEVEMENT_IDS_V2 } from '../achievementRuleVersions';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
const rules = require('../achievements') as any;

test('calibrated volume ladders leave sustained high-use milestones beyond entry tiers', () => {
  const expected: Record<string, number[]> = {
    'sol-regular': [1e9, 1e10, 1e11], 'astra-regular': [5e8, 5e9, 5e10], 'luna-regular': [1e8, 1e9, 1e10],
    'sonnet-main': [1e8, 1e9, 1e10], 'opus-cannon': [1e8, 1e9, 1e10], 'haiku-worker': [1e7, 1e8, 1e9],
    'fable-volume': [5e7, 5e8, 5e9], 'cache-wizard': [1e8, 1e9, 1e10],
    'claude-cache-creation': [1e7, 1e8, 1e9], 'claude-output': [2e6, 2e7, 2e8],
    'codex-output': [5e6, 5e7, 5e8], 'codex-cache-read': [1e9, 1e10, 1e11],
    'weekly-volume': [5e8, 2e9, 1e10], 'weekly-average': [5e8, 2e9, 5e9], 'model-rainbow': [2, 5, 7],
  };
  for (const [series, targets] of Object.entries(expected)) {
    assert.deepEqual(ACHIEVEMENT_SERIES[series].slice(0,targets.length).map(id => ACHIEVEMENT_DEFINITIONS.find(rule => rule.id === id)!.target), targets, series);
  }
});

test('candidate calibration remaps only volume proof, never carries a changed calendar condition', () => {
  assert.equal(typeof rules.migrateCalibratedAchievementGrants, 'function');
  const migrated = rules.migrateCalibratedAchievementGrants([
    'sol-regular-gold', 'astra-regular-gold', 'sonnet-main-gold', 'haiku-worker-gold',
    'codex-output-bronze', 'claude-cache-creation-silver', 'active-weeks-gold',
    'fable-days-gold', 'three-family-day', 'local-share-export', 'hundred-billion-token-club', 'unknown',
  ]);
  assert.deepEqual(migrated, [
    'astra-regular', 'astra-regular-silver', 'claude-cache-creation-bronze',
    'claude-cache-creation-gold', 'claude-cache-creation-silver',
    'haiku-worker', 'haiku-worker-silver', 'hundred-billion-token-club',
    'local-share-export', 'sol-regular', 'sol-regular-silver', 'sonnet-main', 'sonnet-main-silver',
  ].sort());
  assert.deepEqual(rules.migrateCalibratedAchievementGrants(null), []);
});

test('Fable completes the seven-family rainbow without proxy-name or output-day fallback', () => {
  const codexFiles = ['astra', 'sol', 'luna'].map(family => {
    const tokens = { inputTotal: 9_980_000, outputTotal: 20_000 };
    return { session: { sessionKey: family, role: 'root' }, total: tokens,
      byModel: { [`gpt-6-${family}`]: tokens }, byEffort: {}, byDay: {}, structural: {} } as CodexFileAggregate;
  });
  const facts: any = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    claudeFamilyTokens: { sonnet: 10_000_000, opus: 10_000_000, haiku: 10_000_000 },
    claudeFamilyOutputTokens: { sonnet: 20_000, opus: 20_000, haiku: 20_000 },
    fable: { processedTokens: 10_000_000, outputTokens: 20_000, activeDays: 200 },
    calendar: { familyDays: { fable: 6 } },
    codex: codexModelSignals(codexFiles),
  };
  const read = () => new Map(evaluateAchievements(facts).map(row => [row.id, row]));
  assert.equal(read().get('model-rainbow-gold')!.unlocked, true);
  assert.equal(read().get('fable-days-bronze')!.unlocked, false, 'unqualified old output days cannot substitute calendar proof');
  facts.calendar.familyDays.fable = 7;
  assert.equal(read().get('fable-days-bronze')!.unlocked, true);
  facts.fable.processedTokens = 9_999_999;
  assert.equal(read().get('model-rainbow-gold')!.unlocked, false);
  assert.equal(read().get('model-rainbow-gold')!.progress, 6);
  facts.fable.processedTokens = 10_000_000;
  facts.fable.outputTokens = 19_999;
  assert.equal(read().get('model-rainbow-gold')!.unlocked, false);
  facts.fable.outputTokens = 20_000;
  assert.equal(read().get('model-rainbow-gold')!.unlocked, true);
  for (const family of ['sonnet', 'opus', 'haiku']) {
    facts.claudeFamilyTokens[family]--;
    assert.equal(read().get('model-rainbow-gold')!.progress, 6, `${family}: processed floor`);
    facts.claudeFamilyTokens[family]++;
    facts.claudeFamilyOutputTokens[family]--;
    assert.equal(read().get('model-rainbow-gold')!.progress, 6, `${family}: output floor`);
    facts.claudeFamilyOutputTokens[family]++;
  }
});

test('calibration rechecks every changed joint condition instead of inheriting its old grant', () => {
  assert.equal(RECALIBRATED_ACHIEVEMENT_IDS_V2.length, 21);
  assert.deepEqual(rules.migrateCalibratedAchievementGrants([
    ...RECALIBRATED_ACHIEVEMENT_IDS_V2, 'local-share-export', 'hundred-billion-token-club',
  ]), ['hundred-billion-token-club', 'local-share-export']);
});

test('canonical v2 archives all changed rules and reissues only newly proven qualifications without Memento promotion', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-calibration-joint-'));
  try {
    // An old writer remains an explicit v1 fixture, not a production read path.
    const legacyFile = path.join(directory, 'achievements-v1.json');
    await new AchievementRecordRepository(legacyFile).initialize([
      ...RECALIBRATED_ACHIEVEMENT_IDS_V2, 'local-share-export',
    ]);
    const oldBytes = await readFile(legacyFile);
    const currentFile = path.join(directory, ACHIEVEMENT_RECORD_FILE);
    const repository = new AchievementRecordRepository(currentFile);
    let saved = await repository.initialize(RECALIBRATED_ACHIEVEMENT_IDS_V2);
    assert.equal(saved.schemaVersion, 2);
    assert.deepEqual(saved.records.map(row => row.id), ['local-share-export']);
    assert.deepEqual(saved.legacyRecords!.map(row => row.id).sort(), [...RECALIBRATED_ACHIEVEMENT_IDS_V2].sort());
    assert.ok(saved.legacyRecords!.every(row => row.ruleVersion === 1 && !row.unread &&
      row.recordedDay === null && row.timeZone === null));
    assert.deepEqual(await readFile(legacyFile), oldBytes);
    assert.deepEqual(await new AchievementRecordRepository(currentFile).initialize(RECALIBRATED_ACHIEVEMENT_IDS_V2), saved);

    // Current family evidence independently meets bronze and silver, not gold.
    const results = evaluateAchievements({ claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
      claudeFamilyTokens: { sonnet: 10_000_000, opus: 10_000_000, haiku: 10_000_000 },
      claudeFamilyOutputTokens: { sonnet: 20_000, opus: 20_000, haiku: 20_000 },
      fable: { processedTokens: 10_000_000, outputTokens: 20_000, activeDays: 0,
        mixedFamilySession: false, outputSessions: 0, allOutputSessions: 0 },
      codex: codexModelSignals([{
        session: { sessionKey: 'current', role: 'root' }, total: { inputTotal: 9_980_000, outputTotal: 20_000 },
        byModel: { 'gpt-6-astra': { inputTotal: 9_980_000, outputTotal: 20_000 } },
        byEffort: {}, byDay: {}, structural: {} as CodexFileAggregate['structural'],
      }]),
    });
    const proven = results.filter(row => row.unlocked && RECALIBRATED_ACHIEVEMENT_IDS_V2.includes(row.id));
    assert.deepEqual(proven.map(row => row.id).sort(), ['model-rainbow', 'model-rainbow-bronze']);
    saved = (await repository.append(saved.generation, proven.map(row => ({
      id: row.id, origin: 'history' as const, recordedDay: null, timeZone: null,
    })))).store;
    assert.deepEqual(saved.records.filter(row => row.ruleVersion === 2).map(row => row.id).sort(),
      ['model-rainbow', 'model-rainbow-bronze']);
    assert.ok(saved.records.every(row => !row.unread && row.recordedDay === null));
    assert.equal(saved.legacyRecords!.length, 21);
    assert.deepEqual(await loadAchievementRecords(currentFile), saved);
    assert.deepEqual(await new AchievementRecordRepository(currentFile).initialize(RECALIBRATED_ACHIEVEMENT_IDS_V2), saved);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
