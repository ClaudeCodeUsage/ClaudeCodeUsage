import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  buildCodexUsageView,
  tokenComposition,
} from '../providers/codex/codexUsage';
import {
  pseudonymousIdentityKey,
  stableCodexViewKey,
} from '../providers/codex/codexIdentity';
import { buildCodexInsights } from '../providers/codex/codexInsights';
import {
  anonymousRootNamedChildProjectFixture,
  codexFixtureIdentityKey,
  identityLineageFixture,
  parentlessNonRootTitleFixture,
  rootedTaskBeyondRecentRowCapFixture,
  rootlessCrossProjectCycleFixture,
  snapshotFixture,
} from './codexFixtures';

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const VIEW_SALT = 'codex-usage-view-test';
const pseudo = (label: string) => pseudonymousIdentityKey(VIEW_SALT, label);

test('session period membership comes only from verified period slices', () => {
  const snapshot = snapshotFixture();
  const projectKey = pseudo('period-project');
  const makeFile = (
    source: (typeof snapshot.files)[number],
    label: string,
    title: string,
    day: string,
  ) => ({
    ...source,
    session: {
      ...source.session,
      sessionKey: pseudo(`period-${label}`),
      parentSessionKey: undefined,
      projectKey,
      sessionTitle: title,
    },
    period: {
      ...source.period!,
      days: { [day]: source.period!.days[Object.keys(source.period!.days)[0]] },
    },
  });
  snapshot.files = [
    makeFile(snapshot.files[0], 'recent', 'Recent slice', '2026-07-20'),
    makeFile(snapshot.files[2], 'month', 'Month slice', '2026-07-10'),
    makeFile(snapshot.files[3], 'old', 'Old slice', '2026-06-01'),
  ];
  snapshot.coverage.period.last7Days.complete = true;
  snapshot.coverage.period.last30Days.complete = true;
  snapshot.coverage.period.allTime.complete = true;

  const view = buildCodexUsageView(snapshot, NOW);
  const periods = new Map(view.recentThreads.map((row) => [row.title, row.periodMembership]));

  assert.deepEqual(periods.get('Recent slice'), ['recent', '7d', '30d', 'all']);
  assert.deepEqual(periods.get('Month slice'), ['30d', 'all']);
  assert.deepEqual(periods.get('Old slice'), ['all']);
  assert.deepEqual(view.sessionPeriodAvailability, {
    recent: true,
    '7d': true,
    '30d': true,
    all: true,
  });
});

test('partial period coverage disables unreliable session membership ranges', () => {
  const snapshot = snapshotFixture();
  snapshot.coverage.period.last7Days.complete = false;
  snapshot.coverage.period.last30Days.complete = false;
  snapshot.coverage.period.allTime.complete = false;
  const view = buildCodexUsageView(snapshot, NOW);

  assert.deepEqual(view.sessionPeriodAvailability, {
    recent: true,
    '7d': false,
    '30d': false,
    all: false,
  });
});

test('index backfill quality warning follows index convergence', () => {
  const snapshot = snapshotFixture();
  const incomplete = buildCodexUsageView(snapshot, NOW);

  assert.equal(incomplete.lastTask?.indexedSubtotal, true);
  assert.equal(incomplete.last30Days.indexedSubtotal, true);
  assert.equal(incomplete.allTime.indexedSubtotal, true);

  assert.deepEqual(
    incomplete.qualityFlags.find(
      ({ flag }) => flag === 'index-backfill-incomplete',
    ),
    { flag: 'index-backfill-incomplete', count: 1 },
  );

  snapshot.coverage.indexedFiles = snapshot.coverage.totalFiles;
  snapshot.coverage.indexedBytes = snapshot.coverage.totalBytes;
  snapshot.coverage.complete = true;
  snapshot.coverage.identity.ambiguousSessionGroups = 2;
  snapshot.coverage.identity.complete = false;
  snapshot.coverage.period.last7Days.complete = true;
  snapshot.coverage.period.last30Days.complete = true;
  snapshot.coverage.period.allTime.complete = true;
  const converged = buildCodexUsageView(snapshot, NOW);

  assert.equal(converged.lastTask?.indexedSubtotal, false);
  assert.equal(converged.last30Days.indexedSubtotal, false);
  assert.equal(converged.allTime.indexedSubtotal, false);

  assert.equal(
    converged.qualityFlags.some(
      ({ flag }) => flag === 'index-backfill-incomplete',
    ),
    false,
  );
  assert.deepEqual(
    converged.qualityFlags.find(
      ({ flag }) => flag === 'ambiguous-session-identity',
    ),
    { flag: 'ambiguous-session-identity', count: 2 },
  );

  snapshot.coverage.identity.ambiguousSessionGroups = 0;
  snapshot.coverage.identity.complete = true;
  const exactIdentity = buildCodexUsageView(snapshot, NOW);
  assert.equal(
    exactIdentity.qualityFlags.some(
      ({ flag }) => flag === 'ambiguous-session-identity',
    ),
    false,
  );
});

test('Explore lineage uses stable view keys for three levels and safely degrades cycles and orphans', () => {
  const snapshot = snapshotFixture();
  const [root, child] = snapshot.files;
  const rootKey = pseudo('lineage-root');
  root.session.sessionKey = rootKey;
  root.session.projectKey = pseudo('lineage-project');
  child.session.sessionKey = pseudo('lineage-child');
  child.session.parentSessionKey = root.session.sessionKey;
  child.session.projectKey = root.session.projectKey;
  const grandchild = {
    ...child,
    session: {
      ...child.session,
      sessionKey: pseudo('lineage-grandchild'),
      parentSessionKey: child.session.sessionKey,
      sessionTitle: 'Grandchild task',
      endedAt: NOW - 1_000,
    },
  };
  const cycle = {
    ...root,
    session: {
      ...root.session,
      sessionKey: pseudo('lineage-cycle'),
      parentSessionKey: pseudo('lineage-cycle'),
      sessionTitle: 'Cycle task',
      endedAt: NOW - 2_000,
    },
  };
  const orphan = {
    ...root,
    session: {
      ...root.session,
      sessionKey: pseudo('lineage-orphan'),
      parentSessionKey: pseudo('lineage-missing-parent'),
      sessionTitle: 'Orphan task',
      endedAt: NOW - 3_000,
    },
  };
  snapshot.files = [root, child, grandchild, cycle, orphan];

  const view = buildCodexUsageView(snapshot, NOW);
  const reordered = buildCodexUsageView(
    { ...snapshot, files: [...snapshot.files].reverse() },
    NOW,
  );
  const byTitle = new Map(view.recentThreads.map((row) => [row.title ?? row.agentNickname, row]));
  const rootRow = byTitle.get(root.session.sessionTitle)!;
  const childRow = byTitle.get(child.session.agentNickname)!;
  const grandchildRow = byTitle.get('Grandchild task')!;
  const cycleRow = byTitle.get('Cycle task')!;
  const orphanRow = byTitle.get('Orphan task')!;

  assert.equal(rootRow.depth, 0);
  assert.equal(childRow.depth, 1);
  assert.equal(grandchildRow.depth, 2);
  assert.equal(grandchildRow.parentViewKey, childRow.viewKey);
  assert.equal(grandchildRow.rootTaskViewKey, rootRow.viewKey);
  assert.equal(cycleRow.depth, 0);
  assert.equal(cycleRow.parentViewKey, undefined);
  assert.equal(cycleRow.parentStatus, 'cycle');
  assert.equal(orphanRow.depth, 0);
  assert.equal(orphanRow.parentViewKey, undefined);
  assert.equal(orphanRow.parentTitle, undefined);
  assert.equal(orphanRow.parentStatus, 'missing');
  assert.equal(rootRow.viewKey, stableCodexViewKey(rootKey));
  assert.equal(
    rootRow.viewKey,
    reordered.recentThreads.find((row) => row.title === root.session.sessionTitle)?.viewKey,
  );
});

test('Explore projects sort by lineage activity and expose a tree-to-flat filter contract', () => {
  const snapshot = snapshotFixture();
  const root = snapshot.files[0];
  const projectKey = pseudo('project-sessions-project');
  const sessions = Array.from({ length: 27 }, (_, index) => ({
    ...root,
    session: {
      ...root.session,
      sessionKey: pseudo(`project-session-${index}`),
      projectKey,
      sessionTitle: `Session ${index}`,
      endedAt: NOW - index * 1_000,
    },
  }));
  snapshot.files = [
    ...sessions,
    {
      ...snapshot.files[3],
      session: {
        ...snapshot.files[3].session,
        endedAt: NOW - 50_000,
      },
    },
  ];
  const view = buildCodexUsageView(snapshot, NOW);

  assert.equal(view.projects[0].name, 'ClaudeCodeUsage');
  assert.equal(view.projects[0].viewKey, stableCodexViewKey(projectKey));
  assert.equal(view.recentThreads[0].viewKey, stableCodexViewKey(pseudo('project-session-0')));
  assert.equal(view.exploreSessions.defaultLayout, 'tree');
  assert.equal(view.exploreSessions.filteredLayout, 'flat');
});

test('project previews use their complete project file set beyond the global recent cap', () => {
  const snapshot = snapshotFixture();
  const source = snapshot.files[0];
  const busyProject = pseudo('busy-project');
  const oldProject = pseudo('old-project');
  const busyFiles = Array.from({ length: 1_001 }, (_, index) => ({
    ...source,
    session: {
      ...source.session,
      sessionKey: pseudo(`busy-session-${index}`),
      projectKey: busyProject,
      projectName: 'BusyProject',
      sessionTitle: `Busy ${index}`,
      endedAt: NOW - index,
    },
  }));
  const oldFiles = Array.from({ length: 27 }, (_, index) => ({
    ...source,
    session: {
      ...source.session,
      sessionKey: pseudo(`old-session-${index}`),
      projectKey: oldProject,
      projectName: 'OldProject',
      sessionTitle: `Old ${index}`,
      endedAt: NOW - 100_000 - index,
    },
  }));
  snapshot.files = [...busyFiles, ...oldFiles];

  const view = buildCodexUsageView(snapshot, NOW);
  const project = view.projects.find((item) => item.name === 'OldProject')!;

  assert.equal(view.recentThreads.some((row) => row.projectViewKey === project.viewKey), false);
  assert.equal(project.recentThreads.length, 20);
  assert.equal(project.threadCount, 27);
  assert.deepEqual(
    project.recentThreads.map((row) => row.title),
    Array.from({ length: 20 }, (_, index) => `Old ${index}`),
  );
});

test('rolling scopes use only selected promoted day slices from active sessions', () => {
  const snapshot = snapshotFixture();
  const file = snapshot.files[0];
  file.session.role = 'subagent';
  file.session.startedAt = Date.parse('2026-06-01T09:00:00.000Z');
  file.session.endedAt = Date.parse('2026-07-20T11:05:00.000Z');
  file.total = {
    inputTotal: 800,
    cachedInput: 700,
    outputTotal: 200,
    reasoningOutput: 120,
  };
  file.byModel = { aggregate: { ...file.total } };
  file.byEffort = { ultra: { ...file.total } };
  file.structural = {
    patchCalls: 9,
    toolCalls: 18,
    postPatchToolCalls: 9,
    compactCount: 2,
    taskCompleteCount: 2,
  };
  file.period = {
    timeZone: 'UTC',
    indexedThrough: 1,
    days: {
      '2026-06-01': {
        total: { inputTotal: 720, cachedInput: 630, outputTotal: 180, reasoningOutput: 110 },
        byModel: { old: { inputTotal: 720, cachedInput: 630, outputTotal: 180, reasoningOutput: 110 } },
        byEffort: { ultra: { inputTotal: 720, cachedInput: 630, outputTotal: 180, reasoningOutput: 110 } },
        structural: {
          patchCalls: 8,
          toolCalls: 16,
          postPatchToolCalls: 8,
          compactCount: 2,
          taskCompleteCount: 1,
        },
        firstObservedAt: Date.parse('2026-06-01T09:00:00.000Z'),
        lastObservedAt: Date.parse('2026-06-01T09:10:00.000Z'),
      },
      '2026-07-20': {
        total: { inputTotal: 80, cachedInput: 70, outputTotal: 20, reasoningOutput: 10 },
        byModel: { current: { inputTotal: 80, cachedInput: 70, outputTotal: 20, reasoningOutput: 10 } },
        byEffort: { low: { inputTotal: 80, cachedInput: 70, outputTotal: 20, reasoningOutput: 10 } },
        structural: {
          patchCalls: 1,
          toolCalls: 2,
          postPatchToolCalls: 1,
          compactCount: 0,
          taskCompleteCount: 1,
        },
        firstObservedAt: Date.parse('2026-07-20T11:00:00.000Z'),
        lastObservedAt: Date.parse('2026-07-20T11:05:00.000Z'),
      },
    },
  };
  snapshot.files = [file];
  snapshot.total = { ...file.total };
  snapshot.coverage.period.allTime.complete = false;

  const view = buildCodexUsageView(snapshot, NOW);

  assert.equal(view.last7Days.total.processed, 100);
  assert.equal(view.last7Days.total.reasoning, 10);
  assert.equal(view.allTime.total.processed, 1_000);
  assert.equal(view.lastTask?.total.processed, 1_000);
  assert.equal(view.last7Days.structural.patchCalls, 1);
  assert.deepEqual(view.last7Days.models.map((row) => [row.key, row.totals.processed]), [['current', 100]]);
  assert.deepEqual(view.last7Days.efforts.map((row) => [row.key, row.totals.processed]), [['low', 100]]);
  assert.equal(view.last7Days.threads, 1);
  assert.equal(view.last7Days.childThreads, 1);
  assert.equal(view.last7Days.childProcessedShare, 1);
  assert.equal(view.last7Days.durationMs, 5 * 60_000);
  assert.equal(view.last7DaysDaily.length, 7);
  const lastDaily = view.last7DaysDaily[view.last7DaysDaily.length - 1];
  assert.equal(lastDaily?.day, '2026-07-20');
  assert.equal(lastDaily?.total.processed, 100);
  assert.equal(view.last7DaysDaily[0].total.processed, 0);
  assert.equal(view.monthly.find((row) => row.period === '2026-06')?.total.processed, 900);
  assert.equal(view.monthly.find((row) => row.period === '2026-07')?.total.processed, 100);
  assert.equal(view.lastTask?.periodCoverage, undefined);
  assert.equal(view.allTime.periodCoverage, undefined);
  assert.equal(view.last7Days.periodCoverage, view.periodCoverage.last7Days);
  assert.equal(view.last30Days.periodCoverage, view.periodCoverage.last30Days);
  assert.equal(view.periodCoverage, snapshot.coverage.period);
});

test('daily and monthly Codex rows retain exact-model API-equivalent cost and conservative coverage', () => {
  const snapshot = snapshotFixture();
  const file = snapshot.files[0];
  const known = {
    inputTotal: 2_000_000,
    cachedInput: 1_000_000,
    outputTotal: 1_000_000,
    reasoningOutput: 750_000,
  };
  const unknown = {
    inputTotal: 1_000_000,
    cachedInput: 0,
    outputTotal: 500_000,
    reasoningOutput: 250_000,
  };
  file.period = {
    timeZone: 'UTC',
    indexedThrough: 1,
    days: {
      '2026-07-20': {
        total: {
          inputTotal: 3_000_000,
          cachedInput: 1_000_000,
          outputTotal: 1_500_000,
          reasoningOutput: 1_000_000,
        },
        byModel: {
          'gpt-5.6-sol': known,
          'codex-auto-review': unknown,
        },
        byEffort: { high: {
          inputTotal: 3_000_000,
          cachedInput: 1_000_000,
          outputTotal: 1_500_000,
          reasoningOutput: 1_000_000,
        } },
        structural: { ...file.structural },
      },
      '2026-07-19': {
        total: { ...known },
        byModel: { 'gpt-5.6-sol': { ...known } },
        byEffort: { high: { ...known } },
        structural: { ...file.structural },
      },
    },
  };
  snapshot.files = [file];

  const view = buildCodexUsageView(snapshot, NOW);
  const today = view.daily.find((row) => row.day === '2026-07-20')!;
  assert.equal(today.apiEquivalent.equivalentUsd, 35.5);
  assert.equal(today.apiEquivalent.freshInputUsd, 5);
  assert.equal(today.apiEquivalent.cachedInputUsd, 0.5);
  assert.equal(today.apiEquivalent.outputUsd, 30);
  assert.equal(today.apiEquivalent.pricedTokens, 3_000_000);
  assert.equal(today.apiEquivalent.totalTokens, 4_500_000);
  assert.equal(today.apiEquivalent.pricingCoverage, 2 / 3);

  const month = view.monthly.find((row) => row.period === '2026-07')!;
  assert.equal(month.apiEquivalent.equivalentUsd, 71);
  assert.equal(month.apiEquivalent.pricedTokens, 6_000_000);
  assert.equal(month.apiEquivalent.totalTokens, 7_500_000);
  assert.equal(month.apiEquivalent.pricingCoverage, 0.8);
});

test('Today is a calendar-day scope with exact sparse hourly cost and token composition', () => {
  const snapshot = snapshotFixture();
  for (const [index, file] of snapshot.files.slice(0, 2).entries()) {
    const slice = file.period!.days['2026-07-20'];
    const hour = index === 0 ? '10' : '11';
    file.today = {
      day: '2026-07-20',
      timeZone: 'UTC',
      indexedThrough: file.period!.indexedThrough,
      hours: {
        [hour]: {
          total: { ...slice.total },
          byModel: Object.fromEntries(
            Object.entries(slice.byModel).map(([model, tokens]) => [
              model,
              { ...tokens },
            ]),
          ),
        },
      },
    };
  }
  snapshot.coverage.today = {
    day: '2026-07-20',
    timeZone: 'UTC',
    indexedFiles: 2,
    totalFiles: 2,
    indexedBytes: 2,
    totalBytes: 2,
    complete: true,
  };

  const view = buildCodexUsageView(snapshot, NOW);

  assert.equal(view.today.total.processed, 1_200);
  assert.equal(view.today.threads, 2);
  assert.deepEqual(view.todayHourly.map((row) => row.hour), ['10', '11']);
  assert.equal(view.todayHourly[0].total.processed, 600);
  assert.equal(view.todayHourly[0].apiEquivalent.equivalentUsd, 0.0037);
  assert.equal(view.todayHourly[0].apiEquivalent.pricingCoverage, 1);
  assert.equal(view.todayHourly[0].threads, 1);
  assert.equal(view.todayCoverage.complete, true);
});

test('rolling scopes stay anchored to snapshot coverage across Hong Kong midnight', () => {
  const snapshot = snapshotFixture();
  const coverage = snapshot.coverage.period;
  coverage.timeZone = 'Asia/Hong_Kong';
  coverage.asOfDay = '2026-07-20';
  coverage.last7Days.complete = false;
  coverage.last30Days.complete = true;
  const file = snapshot.files[0];
  file.total = { inputTotal: 800, cachedInput: 700, outputTotal: 200, reasoningOutput: 20 };
  file.byModel = { 'gpt-5.6-sol': { ...file.total } };
  file.byEffort = { high: { ...file.total } };
  file.period = {
    timeZone: 'Asia/Hong_Kong',
    indexedThrough: 1,
    days: {
      '2026-07-14': {
        total: { inputTotal: 30, cachedInput: 20, outputTotal: 10, reasoningOutput: 2 },
        byModel: { 'gpt-5.6-sol': { inputTotal: 30, cachedInput: 20, outputTotal: 10, reasoningOutput: 2 } },
        byEffort: { high: { inputTotal: 30, cachedInput: 20, outputTotal: 10, reasoningOutput: 2 } },
        structural: {
          patchCalls: 1,
          toolCalls: 2,
          postPatchToolCalls: 1,
          compactCount: 0,
          taskCompleteCount: 0,
        },
        firstObservedAt: Date.parse('2026-07-13T16:05:00.000Z'),
        lastObservedAt: Date.parse('2026-07-13T16:10:00.000Z'),
      },
      '2026-07-20': {
        total: { inputTotal: 50, cachedInput: 40, outputTotal: 10, reasoningOutput: 3 },
        byModel: { 'gpt-5.6-sol': { inputTotal: 50, cachedInput: 40, outputTotal: 10, reasoningOutput: 3 } },
        byEffort: { high: { inputTotal: 50, cachedInput: 40, outputTotal: 10, reasoningOutput: 3 } },
        structural: {
          patchCalls: 0,
          toolCalls: 0,
          postPatchToolCalls: 0,
          compactCount: 0,
          taskCompleteCount: 1,
        },
        firstObservedAt: Date.parse('2026-07-20T15:50:00.000Z'),
        lastObservedAt: Date.parse('2026-07-20T15:55:00.000Z'),
      },
      '2026-07-21': {
        total: { inputTotal: 720, cachedInput: 640, outputTotal: 180, reasoningOutput: 15 },
        byModel: { future: { inputTotal: 720, cachedInput: 640, outputTotal: 180, reasoningOutput: 15 } },
        byEffort: { ultra: { inputTotal: 720, cachedInput: 640, outputTotal: 180, reasoningOutput: 15 } },
        structural: {
          patchCalls: 8,
          toolCalls: 16,
          postPatchToolCalls: 8,
          compactCount: 2,
          taskCompleteCount: 1,
        },
        firstObservedAt: Date.parse('2026-07-20T16:01:00.000Z'),
        lastObservedAt: Date.parse('2026-07-20T16:04:00.000Z'),
      },
    },
  };
  snapshot.files = [file];
  snapshot.total = { ...file.total };

  const view = buildCodexUsageView(
    snapshot,
    Date.parse('2026-07-20T16:05:00.000Z'),
  );

  assert.equal(view.last7Days.total.processed, 100);
  assert.equal(view.last30Days.total.processed, 100);
  assert.equal(view.last7Days.threads, 1);
  assert.equal(view.last7Days.rootTasks, 1);
  assert.equal(view.last7DaysDaily[0].day, '2026-07-14');
  assert.equal(view.last7DaysDaily[6].day, '2026-07-20');
  assert.equal(view.last7DaysDaily.some((row) => row.day === '2026-07-21'), false);
  assert.deepEqual(buildCodexInsights(view.last7Days, '7d'), []);
  assert.equal(
    buildCodexInsights(view.last30Days, '30d').some((insight) => insight.kind === 'effort-comparison'),
    true,
  );
});

test('view builds recent task, 7d, 30d, and projects without double counting subsets', () => {
  const view = buildCodexUsageView(snapshotFixture(), NOW);

  assert.equal(view.lastTask?.total.processed, 1_200);
  assert.equal(view.lastTask?.total.fresh, 400);
  assert.equal(view.lastTask?.total.reasoning, 120);
  assert.equal(view.lastTask?.cacheShare, 0.8);
  assert.equal(view.last7Days.cacheShare, 0.8);
  assert.equal(view.last7Days.childFreshShare, 0.5);
  assert.equal(view.last7Days.rootTasks, 1);
  assert.equal(view.last30Days.approvalReviewerThreads, 1);
  assert.match(view.projects[0].projectKey, /^[a-f0-9]{64}$/);
  assert.equal(view.projects[0].name, 'ClaudeCodeUsage');
  assert.equal(view.projects[0].directoryName, 'claude-code-usage-v221');
  assert.equal(view.lastTaskIdentity?.title, '完成 Codex v2.3.0 仪表板');
});

test('model and effort buckets preserve provider-specific dimensions', () => {
  const view = buildCodexUsageView(snapshotFixture(), NOW);

  assert.deepEqual(view.last7Days.models, [
    {
      key: 'gpt-5.6-sol',
      totals: {
        processed: 1_200,
        fresh: 400,
        input: 1_000,
        cachedInput: 800,
        output: 200,
        reasoning: 120,
      },
    },
  ]);
  assert.equal(view.last30Days.efforts.find((row) => row.key === 'medium')?.totals.fresh, 140);
});

test('daily and recent-thread details explain where Codex usage came from', () => {
  const view = buildCodexUsageView(snapshotFixture(), NOW);
  const childKey = codexFixtureIdentityKey('session:child-a');
  const rootKey = codexFixtureIdentityKey('session:root-a');
  const projectKey = codexFixtureIdentityKey('project:a');

  const { apiEquivalent, ...daily } = view.daily[0];
  assert.equal(apiEquivalent.pricingCoverage, 1);
  assert.deepEqual(daily, {
    day: '2026-07-20',
    total: {
      processed: 1_200,
      fresh: 400,
      input: 1_000,
      cachedInput: 800,
      output: 200,
      reasoning: 120,
    },
    threads: 2,
    childThreads: 1,
    approvalReviewerThreads: 0,
  });
  assert.equal(view.daily[1].day, '2026-07-10');
  assert.equal(view.recentThreads.length, 4);
  assert.deepEqual(view.recentThreads[0], {
    viewKey: stableCodexViewKey(childKey),
    parentViewKey: stableCodexViewKey(rootKey),
    rootTaskViewKey: stableCodexViewKey(rootKey),
    depth: 1,
    parentStatus: 'available',
    sessionKey: childKey,
    parentSessionKey: rootKey,
    title: undefined,
    parentTitle: '完成 Codex v2.3.0 仪表板',
    agentNickname: 'Locke',
    observedAt: Date.parse('2026-07-20T11:30:00.000Z'),
    role: 'subagent',
    projectViewKey: stableCodexViewKey(projectKey),
    projectKey,
    projectName: 'ClaudeCodeUsage',
    projectDirectoryName: 'claude-code-usage-v221',
    models: ['gpt-5.6-sol'],
    efforts: ['high'],
    periodMembership: ['recent', '7d', '30d', 'all'],
    dayMembership: ['2026-07-20'],
    total: {
      processed: 600,
      fresh: 200,
      input: 500,
      cachedInput: 400,
      output: 100,
      reasoning: 60,
    },
    durationMs: 600_000,
    structural: { ...snapshotFixture().files[1].structural },
  });
  assert.equal(view.totalThreadCount, 4);
});

test('all-time, monthly, and behavior views stay provider-native', () => {
  const view = buildCodexUsageView(snapshotFixture(), NOW);

  assert.equal(view.allTime.total.processed, 1_560);
  assert.equal(view.allTime.total.fresh, 640);
  assert.equal(view.monthly[0].period, '2026-07');
  assert.equal(view.monthly[0].total.processed, 1_440);
  assert.equal(view.monthly[0].threads, 3);
  assert.equal(view.last7DaysDaily.length, 7);
  assert.equal(view.last7DaysDaily[0].day, '2026-07-14');
  assert.equal(view.last7DaysDaily[6].day, '2026-07-20');
  assert.equal(view.last7DaysDaily[0].total.processed, 0);
  assert.equal(view.last30DaysDaily.length, 30);
  assert.equal(view.last30DaysDaily[0].day, '2026-06-21');
  assert.equal(
    view.last30DaysDaily.find((row) => row.day === '2026-07-10')?.total.processed,
    240,
  );
  assert.equal(view.last30DaysDaily[29].day, '2026-07-20');
  assert.equal(view.behavior.childThreadsPerRootTask, 0.5);
  assert.equal(view.behavior.childFreshShare, 0.3125);
  assert.equal(view.behavior.approvalReviewerFreshShare, 0.21875);
  assert.equal(view.behavior.highEffortFreshShare, 0.625);
  assert.equal(view.behavior.reasoningOutputShare, 0.5);
  assert.equal(view.behaviorScopes.recent?.childFreshShare, 0.5);
  assert.equal(view.behaviorScopes.last7Days.childFreshShare, 0.5);
  assert.equal(view.behaviorScopes.last30Days.approvalReviewerFreshShare, 140 / 540);
  assert.equal(view.behaviorScopes.allTime.childFreshShare, view.behavior.childFreshShare);
});

test('behavior exposes patch and tool call proxies without file or command claims', () => {
  const snapshot = snapshotFixture();
  snapshot.files[0].structural = {
    patchCalls: 2,
    toolCalls: 6,
    postPatchToolCalls: 4,
    compactCount: 1,
    taskCompleteCount: 1,
  };

  const view = buildCodexUsageView(snapshot, NOW);

  assert.equal(view.behavior.patchCalls, 2);
  assert.equal(view.behavior.postPatchToolCallsPerPatchCall, 2);
});

test('token composition partitions processed tokens without counting reasoning twice', () => {
  assert.deepEqual(
    tokenComposition({
      processed: 600,
      fresh: 200,
      input: 500,
      cachedInput: 400,
      output: 100,
      reasoning: 60,
    }),
    {
      freshInput: 100,
      cachedInput: 400,
      output: 100,
      reasoningWithinOutput: 60,
    },
  );
});

test('usage view exposes classified limits and a safe recent task identity', () => {
  const view = buildCodexUsageView(snapshotFixture(), NOW);

  assert.equal(view.limits[0]?.state, 'expired');
  assert.match(view.lastTaskIdentity?.taskKey ?? '', /^[a-f0-9]{16}$/);
  assert.match(view.lastTaskIdentity?.projectKey ?? '', /^[a-f0-9]{16}$/);
  assert.equal(view.lastTaskIdentity?.lastActiveAt, view.lastTaskIdentity?.observedAt);
  assert.equal(view.lastTaskIdentity?.taskKey.includes('session:'), false);
  assert.equal(view.lastTaskIdentity?.projectKey.includes('project:'), false);
  assert.deepEqual(view.coverage, {
    indexedFiles: 4,
    totalFiles: 5,
    indexedBytes: 1_300,
    totalBytes: 1_500,
    complete: false,
    identity: {
      exactDuplicateFiles: 0,
      ambiguousSessionGroups: 0,
      complete: true,
    },
    period: {
      timeZone: 'UTC',
      asOfDay: '2026-07-20',
      last7Days: {
        migratedFiles: 0,
        totalFiles: 0,
        migratedBytes: 0,
        totalBytes: 0,
        complete: true,
      },
      last30Days: {
        migratedFiles: 0,
        totalFiles: 0,
        migratedBytes: 0,
        totalBytes: 0,
        complete: true,
      },
      allTime: {
        migratedFiles: 0,
        totalFiles: 0,
        migratedBytes: 0,
        totalBytes: 0,
        complete: true,
      },
    },
    today: {
      timeZone: 'UTC',
      day: '2026-07-20',
      indexedFiles: 0,
      totalFiles: 0,
      indexedBytes: 0,
      totalBytes: 0,
      complete: true,
    },
  });
  assert.deepEqual(view.qualityFlags, [
    { flag: 'index-backfill-incomplete', count: 1 },
    { flag: 'unknown-event', count: 1 },
  ]);
});

test('an empty snapshot has no recent task and safe zero scopes', () => {
  const snapshot = snapshotFixture();
  snapshot.files = [];
  snapshot.total = { inputTotal: 0, outputTotal: 0 };
  const view = buildCodexUsageView(snapshot, NOW);

  assert.equal(view.lastTask, null);
  assert.equal(view.last7Days.total.processed, 0);
  assert.deepEqual(view.projects, []);
  assert.deepEqual(view.daily, []);
  assert.equal(view.last7DaysDaily.length, 7);
  assert.equal(view.last7DaysDaily.every((row) => row.total.processed === 0), true);
  assert.equal(view.last30DaysDaily.length, 30);
  assert.equal(view.last30DaysDaily.every((row) => row.total.processed === 0), true);
  assert.deepEqual(view.monthly, []);
  assert.deepEqual(view.recentThreads, []);
  assert.equal(view.totalThreadCount, 0);
  assert.equal(view.allTime.total.processed, 0);
  assert.equal(view.behavior.processedToFreshRatio, 0);
  assert.equal(view.behaviorScopes.recent, null);
  assert.equal(view.behaviorScopes.last7Days.processedToFreshRatio, 0);
});

test('missing model and effort values are grouped as unknown', () => {
  const snapshot = snapshotFixture();
  snapshot.files[0].byModel = {};
  snapshot.files[0].byEffort = {};
  const periodDay = snapshot.files[0].period?.days['2026-07-20'];
  assert.ok(periodDay);
  periodDay.byModel = {};
  periodDay.byEffort = {};
  const view = buildCodexUsageView(snapshot, NOW);

  assert.equal(view.last7Days.models.find((row) => row.key === 'unknown')?.totals.processed, 600);
  assert.equal(view.last7Days.efforts.find((row) => row.key === 'unknown')?.totals.processed, 600);
});

test('incomplete session timestamps never invent a multi-year duration', () => {
  const snapshot = snapshotFixture();
  snapshot.files[0].session.startedAt = undefined;
  const view = buildCodexUsageView(snapshot, NOW);

  assert.equal(view.recentThreads[1].role, 'root');
  assert.equal(view.recentThreads[1].durationMs, 0);
  assert.equal(view.last7Days.durationMs, 1_200_000);
});

test('cross-project lineage keeps the recent task card anchored to its canonical root project', () => {
  const childEndedAt = Date.parse('2026-07-20T11:50:00.000Z');
  const view = buildCodexUsageView(identityLineageFixture(), NOW);
  const rootThread = view.recentThreads.find((thread) => thread.role === 'root' && thread.projectName === 'RootProject');

  assert.ok(rootThread);
  assert.equal(view.lastTaskIdentity?.projectKey, rootThread.projectViewKey);
  assert.equal(view.lastTaskIdentity?.projectName, 'RootProject');
  assert.equal(view.lastTaskIdentity?.projectDirectoryName, 'RootDirectory');
  assert.equal(view.lastTaskIdentity?.title, undefined);
  assert.equal(view.lastTaskIdentity?.observedAt, childEndedAt);
  assert.equal(view.lastTask?.threads, 3);
});

test('an anonymous root uses its named child project without changing root lineage identity', () => {
  const snapshot = anonymousRootNamedChildProjectFixture();
  const root = snapshot.files[0];
  const child = snapshot.files[1];
  const rootViewKey = stableCodexViewKey(
    codexFixtureIdentityKey('session:root-a'),
  );
  const view = buildCodexUsageView(snapshot, NOW);
  const project = view.projects.find((row) =>
    row.projectKey === root.session.projectKey
  );
  const childRow = view.recentThreads.find((row) =>
    row.sessionKey === child.session.sessionKey
  );

  assert.ok(project);
  assert.equal(project.name, 'RealChildProject');
  assert.equal(view.lastTaskIdentity?.projectName, project.name);
  assert.equal(view.lastTaskIdentity?.projectName, 'RealChildProject');
  assert.equal(view.lastTaskIdentity?.projectKey, project.viewKey);
  assert.equal(view.lastTaskIdentity?.taskKey, rootViewKey);
  assert.equal(view.lastTaskIdentity?.title, 'Canonical root task');
  assert.equal(childRow?.parentViewKey, rootViewKey);
  assert.equal(childRow?.rootTaskViewKey, rootViewKey);
  assert.equal(childRow?.depth, 1);
});

test('rooted recent task key is anchored to the canonical root when a child is appended', () => {
  const snapshot = snapshotFixture();
  snapshot.files = snapshot.files.slice(0, 2);
  const before = buildCodexUsageView(snapshot, NOW);
  const appendedChild = {
    ...snapshot.files[1],
    session: {
      ...snapshot.files[1].session,
      sessionKey: 'session:raw-appended-child',
      parentSessionKey: snapshot.files[0].session.sessionKey,
      endedAt: Date.parse('2026-07-20T11:55:00.000Z'),
    },
  };
  snapshot.files.push(appendedChild);

  const after = buildCodexUsageView(snapshot, NOW);

  assert.equal(after.lastTaskIdentity?.taskKey, before.lastTaskIdentity?.taskKey);
  assert.equal(after.lastTaskIdentity?.projectKey, before.lastTaskIdentity?.projectKey);
  assert.doesNotMatch(JSON.stringify(after.lastTaskIdentity), /session:|project:|raw-appended-child/);
});

test('recent row cap can omit an old canonical root while retaining its lineage', () => {
  const view = buildCodexUsageView(rootedTaskBeyondRecentRowCapFixture(), NOW);
  const identity = view.lastTaskIdentity!;
  const lineageRows = view.recentThreads.filter((row) =>
    row.rootTaskViewKey === identity.taskKey &&
    row.projectViewKey === identity.projectKey
  );

  assert.equal(view.lastTask?.threads, 1_002);
  assert.equal(view.recentThreads.length, 1_000);
  assert.equal(
    view.recentThreads.some((row) => row.viewKey === identity.taskKey),
    false,
  );
  assert.equal(lineageRows.length, 1_000);
  assert.equal(
    lineageRows.every((row) => row.parentViewKey === identity.taskKey),
    true,
  );
});

test('lineage traversal groups a parent cycle once without borrowing a child title', () => {
  const snapshot = snapshotFixture();
  snapshot.files = snapshot.files.slice(0, 2);
  snapshot.files[0].session.role = 'subagent';
  snapshot.files[0].session.parentSessionKey = snapshot.files[1].session.sessionKey;
  snapshot.files[0].session.sessionTitle = 'cycle title a';
  snapshot.files[1].session.parentSessionKey = snapshot.files[0].session.sessionKey;
  snapshot.files[1].session.sessionTitle = 'cycle title b';
  snapshot.files[1].session.endedAt = Date.parse('2026-07-20T11:55:00.000Z');

  const view = buildCodexUsageView(snapshot, NOW);
  const reordered = { ...snapshot, files: [...snapshot.files].reverse() };
  const reorderedView = buildCodexUsageView(reordered, NOW);

  assert.equal(view.lastTask?.threads, 2);
  assert.equal(view.lastTaskIdentity?.title, undefined);
  assert.equal(view.lastTaskIdentity?.taskKey, reorderedView.lastTaskIdentity?.taskKey);
  assert.doesNotMatch(JSON.stringify(view.lastTaskIdentity), /session:|project:/);
  assert.equal(
    view.lastTaskIdentity?.observedAt,
    Date.parse('2026-07-20T11:55:00.000Z'),
  );
});

test('rootless cross-project cycle uses one deterministic representative identity', () => {
  const snapshot = rootlessCrossProjectCycleFixture();
  const expectedFile = [...snapshot.files].sort((left, right) =>
    left.session.sessionKey.localeCompare(right.session.sessionKey) ||
    (left.session.projectKey ?? '').localeCompare(right.session.projectKey ?? '')
  )[0];
  const view = buildCodexUsageView(snapshot, NOW);
  const reorderedView = buildCodexUsageView(
    { ...snapshot, files: [...snapshot.files].reverse() },
    NOW,
  );
  const expectedRow = view.recentThreads.find((row) =>
    row.sessionKey === expectedFile.session.sessionKey
  );

  assert.ok(expectedRow);
  assert.equal(expectedRow.parentStatus, 'cycle');
  assert.equal(expectedRow.title, 'Representative cycle thread');
  assert.equal(view.lastTask?.threads, 3);
  assert.equal(view.lastTaskIdentity?.taskKey, expectedRow.viewKey);
  assert.equal(view.lastTaskIdentity?.projectKey, expectedRow.projectViewKey);
  assert.equal(view.lastTaskIdentity?.projectName, expectedRow.projectName);
  assert.equal(
    view.lastTaskIdentity?.projectDirectoryName,
    expectedRow.projectDirectoryName,
  );
  // Without a canonical root, titles remain thread-only instead of being
  // promoted to the task card from any member of the cycle.
  assert.equal(view.lastTaskIdentity?.title, undefined);
  assert.deepEqual(reorderedView.lastTaskIdentity, view.lastTaskIdentity);
  assert.deepEqual(reorderedView.lastTask, view.lastTask);
  assert.doesNotMatch(
    JSON.stringify(view.lastTaskIdentity),
    /session:|project:|rootless-cycle/,
  );
});

test('a parentless non-root cannot supply the task title', () => {
  const view = buildCodexUsageView(parentlessNonRootTitleFixture(), NOW);

  assert.equal(view.lastTask?.threads, 1);
  assert.equal(view.recentThreads[0].role, 'approval-reviewer');
  assert.equal(
    view.recentThreads[0].title,
    'parentless reviewer title must not become a task title',
  );
  assert.equal(view.lastTaskIdentity?.title, undefined);
  assert.match(view.lastTaskIdentity?.taskKey ?? '', /^[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(view.lastTaskIdentity), /session:|project:/);
});
