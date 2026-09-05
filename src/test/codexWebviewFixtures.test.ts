import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCodexUsageView } from '../providers/codex/codexUsage';
import { codexFixtureIdentityKey } from './codexFixtures';
import {
  CODEX_WEBVIEW_NOW,
  codexWebviewFixture,
} from './codexWebviewFixtures';

test('Codex webview fixture preserves three named projects and 24-session lineage', () => {
  const snapshot = codexWebviewFixture();
  const identityKey = /^[a-f0-9]{64}$/;
  for (const file of snapshot.files) {
    assert.match(file.session.sessionKey, identityKey);
    assert.match(file.session.projectKey ?? '', identityKey);
    if (file.session.parentSessionKey) {
      assert.match(file.session.parentSessionKey, identityKey);
    }
  }
  assert.equal(
    snapshot.files[0].session.sessionKey,
    codexFixtureIdentityKey('webview:session-0'),
  );

  const view = buildCodexUsageView(snapshot, CODEX_WEBVIEW_NOW);
  assert.deepEqual(
    view.projects.map((project) => project.name).sort(),
    ['ClaudeCodeUsage', 'PolyU Research', 'TianGong'],
  );
  assert.deepEqual(
    view.projects.map((project) => project.directoryName).sort(),
    ['ClaudeCodeUsage-MyFix', 'PolyU_research', 'TianGong'],
  );
  const sessions = view.projects.flatMap((project) => project.recentThreads);
  assert.equal(sessions.length, 24);
  assert.equal(new Set(sessions.map((session) => session.viewKey)).size, 24);

  const root = sessions.find((session) => session.title === 'Refine the Codex dashboard');
  const reviewer = sessions.find((session) => session.title === 'Dashboard fixture task 2');
  assert.ok(root);
  assert.ok(reviewer);
  assert.equal(root.depth, 0);
  assert.equal(reviewer.role, 'approval-reviewer');
  assert.equal(reviewer.parentTitle, 'Dashboard fixture task 1');
  assert.equal(reviewer.depth, 2);
  assert.equal(reviewer.rootTaskViewKey, root.viewKey);
});

test('Codex webview fixture period slices match all 24 generated records', () => {
  const snapshot = codexWebviewFixture();
  const expectedCoverage = {
    migratedFiles: 24,
    totalFiles: 30,
    migratedBytes: 2_400_000,
    totalBytes: 3_000_000,
    complete: false,
  };
  assert.equal(snapshot.coverage.period.timeZone, 'Asia/Hong_Kong');
  assert.equal(snapshot.coverage.period.asOfDay, '2026-07-20');
  assert.deepEqual(snapshot.coverage.period.last7Days, expectedCoverage);
  assert.deepEqual(snapshot.coverage.period.last30Days, expectedCoverage);
  assert.deepEqual(snapshot.coverage.period.allTime, expectedCoverage);

  for (const file of snapshot.files) {
    const [day] = Object.keys(file.byDay);
    assert.equal(file.period?.timeZone, 'Asia/Hong_Kong');
    assert.deepEqual(file.period?.days, {
      [day]: {
        total: file.total,
        byModel: file.byModel,
        byEffort: file.byEffort,
        structural: file.structural,
        firstObservedAt: file.session.startedAt,
        lastObservedAt: file.session.endedAt,
      },
    });
  }

  const view = buildCodexUsageView(snapshot, CODEX_WEBVIEW_NOW);
  assert.deepEqual(
    view.daily.map(({ day, threads }) => ({ day, threads })),
    [
      { day: '2026-07-20', threads: 4 },
      { day: '2026-07-19', threads: 4 },
      { day: '2026-07-18', threads: 4 },
      { day: '2026-07-17', threads: 3 },
      { day: '2026-07-16', threads: 3 },
      { day: '2026-07-15', threads: 3 },
      { day: '2026-07-14', threads: 3 },
    ],
  );
  assert.equal(view.last7Days.threads, 24);
  assert.equal(view.last30Days.threads, 24);
  assert.deepEqual(view.last7Days.total, view.allTime.total);
  assert.deepEqual(view.last30Days.total, view.allTime.total);
});
