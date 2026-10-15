import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { immutableCodexAchievementFiles, codexAchievementProofRevision } from '../codexAchievementRevision';
import { codexAchievementCalendarProjection, codexAchievementTokenEvidence } from '../achievementCalendar';
import { codexAchievementMoneyScopes } from '../achievementMoneyScopes';
import { codexAchievementEffortStatistics } from '../achievementEffortStatistics';
import { codexModelSignals } from '../achievements';
import {codexAchievementHistoryEvidence} from '../achievementHistoryDates';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
import { CODEX_PERIOD_LINEAGE_VERSION } from '../providers/codex/codexPeriodIndex';

// Opt-in deterministic synthetic CPU benchmark, no homes/logs/worker/storage.
// Set CCU_CODEX_ACHIEVEMENT_PERF=1. Timings are observations, not CI speed gates.
test('20k files x 3 days: changed, unchanged and legitimate append achievement work', {
  skip: process.env.CCU_CODEX_ACHIEVEMENT_PERF !== '1',
}, () => {
  const tokens = (scale = 1) => ({ inputTotal: 1000 * scale, cachedInput: 100 * scale,
    cacheWriteInput: 0, outputTotal: 2000 * scale, reasoningOutput: 100 * scale, sourceTotal: 3000 * scale });
  const structural = { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 };
  const make = (i: number): CodexFileAggregate => ({ total: tokens(3), byModel: { 'gpt-6.1-sol': tokens(3) },
    byEffort: { high: tokens(3) }, byDay: {}, structural: { ...structural },
    session: { sessionKey: `synthetic-${i}`, role: i % 3 ? 'subagent' : 'root',
      ...(i % 3 ? { parentSessionKey: `synthetic-${i - i % 3}` } : {}) },
    achievementPeriodWitness: { size: 100, offset: 100, expectedPrefixEvents: 0, timeZone: 'UTC' },
    period: { timeZone: 'UTC', lineageVersion: CODEX_PERIOD_LINEAGE_VERSION, lineagePrefixEvents: 0,
      indexedThrough: 100, days: Object.fromEntries(['06', '07', '08'].map(day => [`2026-07-${day}`,
        { total: tokens(), byModel: { 'gpt-6.1-sol': tokens() }, byEffort: { high: tokens() }, structural: { ...structural } }])) },
  });
  const files = Array.from({ length: 20_000 }, (_, i) => make(i));
  const fence = { indexed: true, calendarComplete: true, timeZone: 'UTC' };
  const evaluate = (files: CodexFileAggregate[]) => {
    const revision = codexAchievementProofRevision(files, fence);
    const signals = codexModelSignals(files);
    signals.effortStatistics = codexAchievementEffortStatistics(files);
    signals.tokenEvidence = codexAchievementTokenEvidence(files, true);
    signals.dayEvidence = codexAchievementCalendarProjection(files, 'UTC', true).evidence;
    signals.historyDayEvidence = codexAchievementHistoryEvidence(files,'UTC',true,true);
    signals.money = codexAchievementMoneyScopes({ files, complete: true, calendarComplete: true,
      dayEvidence: signals.dayEvidence, backend: 'openai', asOfDay: '2026-08-03' });
    return { revision, signals };
  };
  const measurements: Record<string, number[]> = {};
  const measure = <T>(name: string, fn: () => T): T => {
    const start = performance.now(), value = fn();
    (measurements[name] ??= []).push(Number((performance.now() - start).toFixed(2)));
    return value;
  };
  // Warm code paths before comparing. Mutable inputs retain the original
  // three-hash/two-calendar algorithm and act as the pre-repair baseline.
  evaluate(files.slice(0, 90));
  for (let round = 0; round < 3; round++) {
    const baseline = measure('baseline_changed_ms', () => evaluate(files));
    measure('baseline_warm_hash_ms', () => codexAchievementProofRevision(files, fence));
    const immutable = measure('producer_changed_capture_ms', () => immutableCodexAchievementFiles(files));
    const repaired = measure('repaired_changed_evaluation_ms', () => evaluate(immutable));
    assert.deepEqual(repaired, baseline);
    const warm = measure('producer_warm_compare_ms', () => immutableCodexAchievementFiles(files, immutable));
    assert.equal(warm, immutable);
    measure('repaired_warm_revision_ms', () => assert.equal(codexAchievementProofRevision(warm, fence), repaired.revision));
    const next = [...files];
    next[0] = structuredClone(files[0]);
    const added = tokens(), day = next[0].period!.days['2026-07-08'];
    for (const vector of [next[0].total, next[0].byModel['gpt-6.1-sol'], next[0].byEffort.high,
      day.total, day.byModel['gpt-6.1-sol'], day.byEffort.high]) {
      for (const key of Object.keys(added) as Array<keyof typeof added>) vector[key] = (vector[key] ?? 0) + added[key];
    }
    next[0].period!.indexedThrough = 120;
    next[0].achievementPeriodWitness!.offset = next[0].achievementPeriodWitness!.size = 120;
    const append = measure('producer_append_capture_ms', () => immutableCodexAchievementFiles(next, immutable));
    const updated = measure('repaired_append_evaluation_ms', () => evaluate(append));
    assert.notEqual(updated.revision, repaired.revision);
    assert.equal(updated.signals.tokenEvidence!.output, repaired.signals.tokenEvidence!.output + 2000);
    assert.equal(updated.signals.dayEvidence!.complete, true);
  }
  console.log(JSON.stringify({ benchmark: 'codex-achievement-r2', files: 20_000, daysPerFile: 3,
    rounds: 3, node: process.version, measurements,
    scope: 'achievement pipeline plus immutable producer publication; excludes worker, source discovery and dashboard construction' }));
});
