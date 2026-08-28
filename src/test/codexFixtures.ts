import { CodexProviderSnapshot } from '../providers/codex/codexProvider';
import {
  CodexFileAggregate,
  CodexStructuralSummary,
  createEmptyCodexIndex,
} from '../providers/codex/codexIndex';
import { ProviderTokenCounts } from '../providers/providerTypes';
import { pseudonymousIdentityKey } from '../providers/codex/codexIdentity';

const FIXTURE_IDENTITY_SALT = 'codex-fixture-identity';

export function codexFixtureIdentityKey(label: string) {
  return pseudonymousIdentityKey(FIXTURE_IDENTITY_SALT, label);
}

const EMPTY_STRUCTURAL: CodexStructuralSummary = {
  patchCalls: 0,
  toolCalls: 0,
  postPatchToolCalls: 0,
  compactCount: 0,
  taskCompleteCount: 0,
};

interface FixtureRow {
  sessionKey: string;
  parentSessionKey?: string;
  role: 'root' | 'subagent' | 'approval-reviewer';
  model: string;
  effort: string;
  end: string;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  projectKey: string;
  sessionTitle?: string;
  agentNickname?: string;
  projectName?: string;
  projectDirectoryName?: string;
}

const ROWS: FixtureRow[] = [
  {
    sessionKey: 'session:root-a',
    role: 'root',
    model: 'gpt-5.6-sol',
    effort: 'high',
    end: '2026-07-20T11:00:00.000Z',
    input: 500,
    cached: 400,
    output: 100,
    reasoning: 60,
    projectKey: 'project:a',
    sessionTitle: '完成 Codex v2.3.0 仪表板',
    projectName: 'ClaudeCodeUsage',
    projectDirectoryName: 'ClaudeCodeUsage-MyFix',
  },
  {
    sessionKey: 'session:child-a',
    parentSessionKey: 'session:root-a',
    role: 'subagent',
    model: 'gpt-5.6-sol',
    effort: 'high',
    end: '2026-07-20T11:30:00.000Z',
    input: 500,
    cached: 400,
    output: 100,
    reasoning: 60,
    projectKey: 'project:a',
    agentNickname: 'Locke',
    projectName: 'ClaudeCodeUsage',
    projectDirectoryName: 'claude-code-usage-v221',
  },
  {
    sessionKey: 'session:review-old',
    role: 'approval-reviewer',
    model: 'gpt-5.6-sol',
    effort: 'medium',
    end: '2026-07-10T09:00:00.000Z',
    input: 200,
    cached: 100,
    output: 40,
    reasoning: 10,
    projectKey: 'project:a',
    sessionTitle: '审批发布工作流',
    projectName: 'ClaudeCodeUsage',
    projectDirectoryName: 'ClaudeCodeUsage-MyFix',
  },
  {
    sessionKey: 'session:terra-old',
    role: 'root',
    model: 'gpt-5.6-terra',
    effort: 'medium',
    end: '2026-06-01T09:00:00.000Z',
    input: 100,
    cached: 20,
    output: 20,
    reasoning: 0,
    projectKey: 'project:b',
    sessionTitle: '分析天工项目',
    projectName: 'TianGong',
    projectDirectoryName: 'TianGong',
  },
];

function tokens(row: FixtureRow): ProviderTokenCounts {
  return {
    inputTotal: row.input,
    cachedInput: row.cached,
    outputTotal: row.output,
    reasoningOutput: row.reasoning,
    sourceTotal: row.input + row.output,
  };
}

function aggregate(row: FixtureRow): CodexFileAggregate {
  const total = tokens(row);
  const endedAt = Date.parse(row.end);
  const day = row.end.slice(0, 10);
  return {
    total,
    byDay: { [day]: { ...total } },
    byModel: { [row.model]: { ...total } },
    byEffort: { [row.effort]: { ...total } },
    session: {
      sessionKey: codexFixtureIdentityKey(row.sessionKey),
      parentSessionKey: row.parentSessionKey
        ? codexFixtureIdentityKey(row.parentSessionKey)
        : undefined,
      projectKey: codexFixtureIdentityKey(row.projectKey),
      sessionTitle: row.sessionTitle,
      agentNickname: row.agentNickname,
      projectName: row.projectName,
      projectDirectoryName: row.projectDirectoryName,
      role: row.role,
      startedAt: endedAt - 10 * 60_000,
      endedAt,
    },
    structural: { ...EMPTY_STRUCTURAL },
    period: {
      timeZone: 'UTC',
      indexedThrough: 1,
      days: {
        [day]: {
          total: { ...total },
          byModel: { [row.model]: { ...total } },
          byEffort: { [row.effort]: { ...total } },
          structural: { ...EMPTY_STRUCTURAL },
          firstObservedAt: endedAt - 10 * 60_000,
          lastObservedAt: endedAt,
        },
      },
    },
  };
}

function sum(files: CodexFileAggregate[]): ProviderTokenCounts {
  return files.reduce<ProviderTokenCounts>(
    (total, file) => ({
      inputTotal: total.inputTotal + file.total.inputTotal,
      cachedInput: (total.cachedInput ?? 0) + (file.total.cachedInput ?? 0),
      outputTotal: total.outputTotal + file.total.outputTotal,
      reasoningOutput:
        (total.reasoningOutput ?? 0) + (file.total.reasoningOutput ?? 0),
      sourceTotal: (total.sourceTotal ?? 0) + (file.total.sourceTotal ?? 0),
    }),
    {
      inputTotal: 0,
      cachedInput: 0,
      outputTotal: 0,
      reasoningOutput: 0,
      sourceTotal: 0,
    },
  );
}

export function snapshotFixture(): CodexProviderSnapshot {
  const files = ROWS.map(aggregate);
  const periodCoverage = createEmptyCodexIndex('UTC').coverage.period;
  const todayCoverage = createEmptyCodexIndex('UTC').coverage.today;
  periodCoverage.asOfDay = '2026-07-20';
  todayCoverage.day = '2026-07-20';
  return {
    provider: 'codex',
    total: sum(files),
    files,
    coverage: {
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
      period: periodCoverage,
      today: todayCoverage,
    },
    todayCoverage,
    todayPartial: !todayCoverage.complete,
    qualityFlags: { 'unknown-event': 1 },
    limits: [],
    limit: {
      provider: 'codex',
      observedAt: Date.parse('2026-07-20T09:00:00.000Z'),
      source: 'local-log',
      confidence: 'last-observed',
      windows: [
        {
          label: 'primary',
          usedPercent: 42,
          windowMinutes: 300,
          resetsAt: Date.parse('2026-07-20T10:00:00.000Z'),
        },
      ],
    },
  };
}

export function identityLineageFixture(): CodexProviderSnapshot {
  const snapshot = snapshotFixture();
  const root = aggregate({
    ...ROWS[0],
    end: '2026-07-20T11:40:00.000Z',
    sessionTitle: undefined,
    projectName: 'RootProject',
    projectDirectoryName: 'RootDirectory',
  });
  const namedChild = aggregate({
    ...ROWS[1],
    end: '2026-07-20T11:30:00.000Z',
    sessionTitle: 'child title must not become the task title',
    projectName: 'RealChildProject',
    projectDirectoryName: 'NamedChildDirectory',
    projectKey: 'project:child-lineage',
  });
  const latestChild = aggregate({
    ...ROWS[1],
    sessionKey: 'session:child-latest',
    end: '2026-07-20T11:50:00.000Z',
    sessionTitle: 'newest child title must not become the task title',
    projectName: '',
    projectDirectoryName: 'LatestDirectory',
    projectKey: 'project:child-lineage',
  });
  snapshot.files = [root, namedChild, latestChild, ...snapshot.files.slice(2)];
  snapshot.total = sum(snapshot.files);
  return snapshot;
}

export function anonymousRootNamedChildProjectFixture(): CodexProviderSnapshot {
  const snapshot = snapshotFixture();
  const [root, child] = snapshot.files;

  root.session.sessionTitle = 'Canonical root task';
  root.session.projectName = undefined;
  root.session.projectDirectoryName = undefined;
  root.session.endedAt = Date.parse('2026-07-20T11:55:00.000Z');

  child.session.projectName = 'RealChildProject';
  child.session.projectDirectoryName = 'RealChildDirectory';
  child.session.endedAt = Date.parse('2026-07-20T11:50:00.000Z');

  snapshot.files = [root, child];
  snapshot.total = sum(snapshot.files);
  return snapshot;
}

export function rootedTaskBeyondRecentRowCapFixture(): CodexProviderSnapshot {
  const snapshot = snapshotFixture();
  const root = structuredClone(snapshot.files[0]);
  root.session.startedAt = Date.parse('2026-07-20T09:50:00.000Z');
  root.session.endedAt = Date.parse('2026-07-20T10:00:00.000Z');
  const children = Array.from({ length: 1_001 }, (_, index) => {
    const child = structuredClone(snapshot.files[1]);
    child.session = {
      ...child.session,
      sessionKey: codexFixtureIdentityKey(`session:capped-child-${index}`),
      parentSessionKey: root.session.sessionKey,
      projectKey: root.session.projectKey,
      sessionTitle: `Recent capped child ${index}`,
      projectName: root.session.projectName,
      projectDirectoryName: root.session.projectDirectoryName,
      startedAt: Date.parse('2026-07-20T11:49:00.000Z'),
      endedAt: Date.parse('2026-07-20T11:59:00.000Z'),
    };
    return child;
  });

  snapshot.files = [root, ...children];
  snapshot.total = sum(snapshot.files);
  return snapshot;
}

export function rootlessCrossProjectCycleFixture(): CodexProviderSnapshot {
  const snapshot = snapshotFixture();
  const sessionLabels = [
    'session:rootless-cycle-alpha',
    'session:rootless-cycle-beta',
    'session:rootless-cycle-gamma',
  ].sort((left, right) =>
    codexFixtureIdentityKey(left).localeCompare(codexFixtureIdentityKey(right))
  );
  const projectLabels = [
    'project:rootless-cycle-alpha',
    'project:rootless-cycle-beta',
    'project:rootless-cycle-gamma',
  ].sort((left, right) =>
    codexFixtureIdentityKey(left).localeCompare(codexFixtureIdentityKey(right))
  );
  const [representativeSession, middleSession, latestSession] = sessionLabels;
  const [smallestProject, middleProject, largestProject] = projectLabels;

  const representative = aggregate({
    ...ROWS[1],
    sessionKey: representativeSession,
    parentSessionKey: middleSession,
    end: '2026-07-20T11:40:00.000Z',
    projectKey: largestProject,
    sessionTitle: 'Representative cycle thread',
    projectName: 'Representative Project',
    projectDirectoryName: 'Representative Directory',
  });
  const middle = aggregate({
    ...ROWS[1],
    sessionKey: middleSession,
    parentSessionKey: latestSession,
    end: '2026-07-20T11:50:00.000Z',
    projectKey: smallestProject,
    sessionTitle: 'Middle cycle thread',
    projectName: 'Smallest-key Project',
    projectDirectoryName: 'Middle Directory',
  });
  const latest = aggregate({
    ...ROWS[2],
    sessionKey: latestSession,
    parentSessionKey: representativeSession,
    role: 'approval-reviewer',
    end: '2026-07-20T11:59:00.000Z',
    projectKey: middleProject,
    sessionTitle: 'Latest cycle thread',
    projectName: 'Latest Project',
    projectDirectoryName: 'Latest Directory',
  });

  snapshot.files = [middle, latest, representative];
  snapshot.total = sum(snapshot.files);
  return snapshot;
}

export function parentlessNonRootTitleFixture(): CodexProviderSnapshot {
  const snapshot = snapshotFixture();
  const root = aggregate({
    ...ROWS[0],
    sessionTitle: undefined,
  });
  const reviewer = aggregate({
    ...ROWS[2],
    sessionKey: 'session:review-newest',
    end: '2026-07-20T11:55:00.000Z',
    sessionTitle: 'parentless reviewer title must not become a task title',
  });
  snapshot.files = [root, reviewer];
  snapshot.total = sum(snapshot.files);
  return snapshot;
}
