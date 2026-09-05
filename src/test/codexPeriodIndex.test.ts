import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  CodexDailySlice,
  CodexHourlySlice,
  reduceCodexHourlySlice,
  reduceCodexStructuralSlice,
  reduceCodexUsageSlice,
} from '../providers/codex/codexPeriodIndex';
import { CodexStructuralEvent } from '../providers/codex/codexParser';
import { NormalizedUsageEvent } from '../providers/providerTypes';

function usage(
  timestamp: string,
  inputTotal: number,
  outputTotal: number,
  reasoningOutput: number,
): NormalizedUsageEvent {
  return {
    provider: 'codex',
    sourceKind: 'local-jsonl',
    schemaVariant: 'codex-token-count-v1',
    timestamp: Date.parse(timestamp),
    sessionKey: 'anonymous-session',
    model: 'gpt-5.6-sol',
    effort: 'high',
    tokens: {
      inputTotal,
      cachedInput: Math.floor(inputTotal / 2),
      outputTotal,
      reasoningOutput,
      sourceTotal: inputTotal + outputTotal,
    },
    confidence: 'exact',
    qualityFlags: [],
  };
}

function structural(
  timestamp: string,
  kind: CodexStructuralEvent['kind'],
  count = 1,
): CodexStructuralEvent {
  return { kind, count, timestamp: Date.parse(timestamp) };
}

test('usage and structural reducers split one session at Hong Kong midnight', () => {
  const days: Record<string, CodexDailySlice> = {};
  const before = usage('2026-07-20T15:55:00.000Z', 100, 20, 12);
  const after = usage('2026-07-20T16:05:00.000Z', 50, 10, 6);

  reduceCodexUsageSlice(days, before, 'Asia/Hong_Kong');
  reduceCodexUsageSlice(days, after, 'Asia/Hong_Kong');
  reduceCodexStructuralSlice(
    days,
    structural('2026-07-20T16:05:30.000Z', 'patch'),
    'Asia/Hong_Kong',
  );
  reduceCodexStructuralSlice(
    days,
    structural('2026-07-20T16:06:00.000Z', 'tool', 2),
    'Asia/Hong_Kong',
  );
  reduceCodexStructuralSlice(
    days,
    structural('2026-07-20T16:07:00.000Z', 'compaction', 3),
    'Asia/Hong_Kong',
  );
  reduceCodexStructuralSlice(
    days,
    structural('2026-07-20T16:08:00.000Z', 'task-complete', 4),
    'Asia/Hong_Kong',
  );

  assert.equal(days['2026-07-20'].total.inputTotal, 100);
  assert.equal(days['2026-07-21'].total.inputTotal, 50);
  assert.equal(days['2026-07-21'].byModel['gpt-5.6-sol'].inputTotal, 50);
  assert.equal(days['2026-07-21'].byEffort.high.inputTotal, 50);
  assert.equal(days['2026-07-21'].structural.patchCalls, 1);
  assert.equal(days['2026-07-21'].structural.toolCalls, 2);
  assert.equal(days['2026-07-21'].structural.postPatchToolCalls, 2);
  assert.equal(days['2026-07-21'].structural.compactCount, 3);
  assert.equal(days['2026-07-21'].structural.taskCompleteCount, 4);
  assert.equal(days['2026-07-20'].firstObservedAt, before.timestamp);
  assert.equal(days['2026-07-20'].lastObservedAt, before.timestamp);
  assert.equal(days['2026-07-21'].firstObservedAt, after.timestamp);
  assert.equal(
    days['2026-07-21'].lastObservedAt,
    Date.parse('2026-07-20T16:08:00.000Z'),
  );
});

test('fractional-offset slicing preserves reasoning as an output subset', () => {
  const days: Record<string, CodexDailySlice> = {};

  reduceCodexUsageSlice(
    days,
    usage('2026-07-20T18:10:00.000Z', 40, 9, 7),
    'Asia/Kathmandu',
  );
  reduceCodexUsageSlice(
    days,
    usage('2026-07-20T18:20:00.000Z', 60, 11, 8),
    'Asia/Kathmandu',
  );

  assert.deepEqual(Object.keys(days).sort(), ['2026-07-20', '2026-07-21']);
  assert.equal(days['2026-07-20'].total.outputTotal, 9);
  assert.equal(days['2026-07-20'].total.reasoningOutput, 7);
  assert.equal(days['2026-07-20'].total.sourceTotal, 49);
  assert.equal(days['2026-07-21'].total.outputTotal, 11);
  assert.equal(days['2026-07-21'].total.reasoningOutput, 8);
  assert.equal(days['2026-07-21'].total.sourceTotal, 71);
});

test('reducers do not invent an unknown day for invalid timestamps', () => {
  const days: Record<string, CodexDailySlice> = {};
  const invalidUsage = usage('2026-07-20T00:00:00.000Z', 10, 2, 1);
  invalidUsage.timestamp = 0;

  reduceCodexUsageSlice(days, invalidUsage, 'UTC');
  reduceCodexStructuralSlice(
    days,
    { kind: 'patch', timestamp: Number.NaN },
    'UTC',
  );

  assert.deepEqual(days, {});
  assert.equal('unknown' in days, false);
});

test('hourly reducer retains only the requested local day as sparse hour buckets', () => {
  const hours: Record<string, CodexHourlySlice> = {};

  reduceCodexHourlySlice(
    hours,
    usage('2026-07-20T15:55:00.000Z', 100, 20, 12),
    '2026-07-21',
    'Asia/Hong_Kong',
  );
  reduceCodexHourlySlice(
    hours,
    usage('2026-07-20T16:05:00.000Z', 50, 10, 6),
    '2026-07-21',
    'Asia/Hong_Kong',
  );
  reduceCodexHourlySlice(
    hours,
    usage('2026-07-20T18:05:00.000Z', 25, 5, 3),
    '2026-07-21',
    'Asia/Hong_Kong',
  );

  assert.deepEqual(Object.keys(hours).sort(), ['00', '02']);
  assert.equal(hours['00'].total.inputTotal, 50);
  assert.equal(hours['00'].byModel['gpt-5.6-sol'].inputTotal, 50);
  assert.equal(hours['02'].total.outputTotal, 5);
  assert.equal('byEffort' in hours['00'], false);
});
