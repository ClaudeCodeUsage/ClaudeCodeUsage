import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WeeklyEstimateArchive, WeeklyEstimateInput, sameWeeklyEstimateQuotaPoint } from '../weeklyEstimateArchive';
import { copyCodexCalibrationEvidence } from '../codexCalibrationEvidence';
const T = Date.parse('2026-10-23T01:00Z'), M = 60000, R = T + 604800000;
function entry(strength = 4): WeeklyEstimateInput {
  const through = T + (strength === 4 ? 10 : 11) * M;
  const receipt = copyCodexCalibrationEvidence({ schemaVersion: 1, methodVersion: 2, collectionMode: 'forward-matched-cut-v1',
    pricebook: { schemaVersion: 1, parserVersion: 4, periodVersion: 1,
      rates: [{ model: 'gpt-5', input: .1, cachedInput: .01, output: .2 }] },
    interval: { from: T, through, requestedFrom: T - 100, requestedThrough: through - 100,
      percentFrom: 36, percentThrough: 40, deltaUsd: 10, pricedTokens: 100, totalTokens: 100,
      linkedSources: 1, excludedSources: 0, continuityGap: false },
    matchedCut: { from: T + (strength === 4 ? 1 : 9) * M, through: T + (strength === 4 ? 9 : 10) * M,
      percentFrom: strength === 4 ? 38 : 39, percentThrough: strength === 4 ? 39 : 40 },
    accumulated: { intervals: strength - 2, deltaPercent: strength, deltaUsd: strength * 10,
      pricedTokens: strength * 100, totalTokens: strength * 100 } });
  assert.ok(receipt);
  return { provider: 'codex', method: 'account-delta-v1', pricingVersion: 'api-v1', accountScopeKey: 'a'.repeat(64),
    windowStart: T, resetAt: R, observedAt: through, estimatedAt: through, utilizationPercent: 40,
    usedEquivalentUsd: strength * 10, fullEquivalentUsd: 1000, unusedEquivalentUsd: 600, pricingCoverage: 1,
    calibrationStart: T + M, quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' },
    calibrationEvidence: receipt, flags: [] };
}
test('stronger matched evidence at the same official percentage is not compacted as an unchanged quota point', async t => {
  const a = entry(4), b = entry(5);
  assert.equal(sameWeeklyEstimateQuotaPoint(a, b), false);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-matched-retention-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = new WeeklyEstimateArchive(path.join(root, 'weekly-estimates-v1.json'), 'synthetic', 'source');
  assert.equal((await archive.record(a)).outcome, 'recorded');
  assert.equal((await archive.record(b)).outcome, 'recorded');
  assert.deepEqual((await archive.load()).entries.map(x => x.calibrationEvidence?.accumulated.deltaPercent), [4, 5]);
});
