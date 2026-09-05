import { CodexProviderSnapshot } from '../providers/codex/codexProvider';
import { CodexFileAggregate } from '../providers/codex/codexIndex';
import { ProviderTokenCounts } from '../providers/providerTypes';
import { codexFixtureIdentityKey, snapshotFixture } from './codexFixtures';

export const CODEX_WEBVIEW_NOW = Date.parse('2026-07-20T12:00:00.000Z');

function sumTotals(files: CodexFileAggregate[]): ProviderTokenCounts {
  return files.reduce<ProviderTokenCounts>(
    (sum, file) => ({
      inputTotal: sum.inputTotal + file.total.inputTotal,
      cachedInput: (sum.cachedInput ?? 0) + (file.total.cachedInput ?? 0),
      outputTotal: sum.outputTotal + file.total.outputTotal,
      reasoningOutput: (sum.reasoningOutput ?? 0) + (file.total.reasoningOutput ?? 0),
      sourceTotal: (sum.sourceTotal ?? 0) + (file.total.sourceTotal ?? 0),
    }),
    { inputTotal: 0, cachedInput: 0, outputTotal: 0, reasoningOutput: 0, sourceTotal: 0 },
  );
}

function generatedFile(index: number, template: CodexFileAggregate): CodexFileAggregate {
  const project = index % 3;
  const day = String(20 - (index % 7)).padStart(2, '0');
  const dayKey = `2026-07-${day}`;
  const endedAt = Date.parse(`2026-07-${day}T${String(8 + (index % 4)).padStart(2, '0')}:00:00.000Z`);
  const input = 1_000 + index * 100;
  const cached = 600 + index * 50;
  const output = 200 + index * 20;
  const reasoning = 80 + index * 5;
  const role = (
    index === 0 ? 'root' : index === 2 ? 'approval-reviewer' : 'subagent'
  ) as CodexFileAggregate['session']['role'];
  const sessionKey = codexFixtureIdentityKey(`webview:session-${index}`);
  const parentSessionKey = index === 0
    ? undefined
    : index === 2
      ? codexFixtureIdentityKey('webview:session-1')
      : codexFixtureIdentityKey('webview:session-0');
  const model = index % 2 === 0 ? 'gpt-5.6-sol' : 'gpt-5.6-terra';
  const effort = ['low', 'medium', 'high', 'xhigh'][index % 4];
  const total: ProviderTokenCounts = {
    inputTotal: input,
    cachedInput: cached,
    outputTotal: output,
    reasoningOutput: reasoning,
    sourceTotal: input + output,
  };
  const structural: CodexFileAggregate['structural'] = {
    patchCalls: index % 5,
    toolCalls: index % 6,
    postPatchToolCalls: index % 3,
    compactCount: index % 7 === 0 ? 1 : 0,
    taskCompleteCount: role === 'root' ? 1 : 0,
  };

  return {
    ...structuredClone(template),
    total,
    byDay: { [dayKey]: { ...total } },
    byModel: { [model]: { ...total } },
    byEffort: { [effort]: { ...total } },
    session: {
      sessionKey,
      parentSessionKey,
      projectKey: codexFixtureIdentityKey(`webview:project-${project}`),
      sessionTitle: index === 0 ? 'Refine the Codex dashboard' : `Dashboard fixture task ${index}`,
      agentNickname: role === 'subagent' ? `Agent ${index}` : undefined,
      projectName: ['ClaudeCodeUsage', 'TianGong', 'PolyU Research'][project],
      projectDirectoryName: ['ClaudeCodeUsage-MyFix', 'TianGong', 'PolyU_research'][project],
      role,
      startedAt: endedAt - 10 * 60_000,
      endedAt,
    },
    structural,
    period: {
      timeZone: 'Asia/Hong_Kong',
      indexedThrough: 1,
      days: {
        [dayKey]: {
          total: { ...total },
          byModel: { [model]: { ...total } },
          byEffort: { [effort]: { ...total } },
          structural: { ...structural },
          firstObservedAt: endedAt - 10 * 60_000,
          lastObservedAt: endedAt,
        },
      },
    },
    today: dayKey === '2026-07-20'
      ? {
          day: dayKey,
          timeZone: 'Asia/Hong_Kong',
          indexedThrough: 1,
          hours: {
            [String(8 + (index % 4)).padStart(2, '0')]: {
              total: { ...total },
              byModel: { [model]: { ...total } },
            },
          },
        }
      : undefined,
  };
}

export function codexWebviewFixture(): CodexProviderSnapshot {
  const base = snapshotFixture();
  const template = base.files[0];
  const files = Array.from({ length: 24 }, (_, index) => generatedFile(index, template));
  const periodCoverage = {
    migratedFiles: 24,
    totalFiles: 30,
    migratedBytes: 2_400_000,
    totalBytes: 3_000_000,
    complete: false,
  };
  return {
    ...base,
    files,
    total: sumTotals(files),
    weeklyValueInputs: {
      observations: [
        {
          provider: 'codex',
          seriesKey: 'codex',
          observedAt: CODEX_WEBVIEW_NOW - 26 * 60 * 60_000,
          resetAt: CODEX_WEBVIEW_NOW - 24 * 60 * 60_000,
          usedPercent: 75,
        },
        {
          provider: 'codex',
          seriesKey: 'codex',
          observedAt: CODEX_WEBVIEW_NOW - 60_000,
          resetAt: CODEX_WEBVIEW_NOW + 6 * 24 * 60 * 60_000,
          usedPercent: 20,
        },
      ],
      usage: [
        {
          timestamp: CODEX_WEBVIEW_NOW - 27 * 60 * 60_000,
          equivalentUsd: 45,
          pricedTokens: 1_000,
          totalTokens: 1_000,
        },
        {
          timestamp: CODEX_WEBVIEW_NOW - 23 * 60 * 60_000,
          equivalentUsd: 5,
          pricedTokens: 1_000,
          totalTokens: 1_000,
          intervalStart: CODEX_WEBVIEW_NOW - 25 * 60 * 60_000,
          intervalEnd: CODEX_WEBVIEW_NOW - 23 * 60 * 60_000,
        },
        {
          timestamp: CODEX_WEBVIEW_NOW - 60 * 60_000,
          equivalentUsd: 10,
          pricedTokens: 1_000,
          totalTokens: 1_000,
        },
      ],
    },
    coverage: {
      ...base.coverage,
      indexedFiles: 24,
      totalFiles: 30,
      indexedBytes: 2_400_000,
      totalBytes: 3_000_000,
      complete: false,
      period: {
        timeZone: 'Asia/Hong_Kong',
        asOfDay: '2026-07-20',
        last7Days: { ...periodCoverage },
        last30Days: { ...periodCoverage },
        allTime: { ...periodCoverage },
      },
      today: {
        timeZone: 'Asia/Hong_Kong',
        day: '2026-07-20',
        indexedFiles: 4,
        totalFiles: 4,
        indexedBytes: 400_000,
        totalBytes: 400_000,
        complete: true,
      },
    },
    qualityFlags: { 'partial-migration': 6 },
    limits: [
      {
        provider: 'codex',
        limitId: 'main',
        limitName: 'Codex',
        observedAt: CODEX_WEBVIEW_NOW - 60_000,
        source: 'local-log',
        confidence: 'last-observed',
        windows: [
          { label: 'primary', windowMinutes: 300, usedPercent: 42, resetsAt: CODEX_WEBVIEW_NOW + 3_600_000 },
          { label: 'secondary', windowMinutes: 10_080, usedPercent: 67, resetsAt: CODEX_WEBVIEW_NOW + 86_400_000 },
        ],
      },
    ],
  };
}

export function unknownModelCodexWebviewFixture(): CodexProviderSnapshot {
  const snapshot = codexWebviewFixture();
  return {
    ...snapshot,
    files: snapshot.files.map((file) => ({
      ...file,
      byModel: { 'unknown-model-fixture': { ...file.total } },
      period: file.period
        ? {
            ...file.period,
            days: Object.fromEntries(
              Object.entries(file.period.days).map(([dayKey, day]) => [
                dayKey,
                {
                  ...day,
                  byModel: { 'unknown-model-fixture': { ...day.total } },
                },
              ]),
            ),
          }
        : undefined,
      today: file.today
        ? {
            ...file.today,
            hours: Object.fromEntries(
              Object.entries(file.today.hours).map(([hour, slice]) => [
                hour,
                {
                  ...slice,
                  byModel: { 'unknown-model-fixture': { ...slice.total } },
                },
              ]),
            ),
          }
        : undefined,
    })),
  };
}
