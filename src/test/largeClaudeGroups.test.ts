import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeDataLoader } from '../dataLoader';
import { createClaudeUsageIndex, updateClaudeUsageIndex } from '../claudeIncrementalIndex';
import type { ClaudeUsageRecord } from '../types';

const count = 150_000;
const end = Date.now();
const start = end - (count - 1) * 1_000;
const records = Array.from({ length: count }, (_, i): ClaudeUsageRecord => ({
  timestamp: new Date(start + i * 1_000).toISOString(),
  _sessionId: 'synthetic-large-session', _projectPath: '/fixture/large', _projectName: 'large',
  _gitBranch: 'main', _workflowId: 'synthetic-workflow', _agentId: i % 2 ? 'agent-a' : 'agent-b',
  message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1 } },
}));

test('large session and current-session time ranges avoid argument-count stack limits', () => {
  const session = ClaudeDataLoader.getSessionBreakdown(records)[0];
  assert.equal(session.startTime.getTime(), start);
  assert.equal(session.endTime.getTime(), end);
  assert.equal(session.data.totalOutputTokens, count);
  const current = ClaudeDataLoader.getCurrentSessionData(records)!;
  assert.equal(current.sessionStart.getTime(), start);
  assert.equal(current.sessionEnd.getTime(), end);
});

test('large project, branch and workflow time ranges preserve exact totals', () => {
  // Project/branch visibility follows user-prompt count, not assistant count.
  const grouped = [...records, { ...records[0], _isUserPrompt: true,
    message: { usage: { input_tokens: 0, output_tokens: 0 } } }];
  const project = ClaudeDataLoader.getProjectBreakdown(grouped, 60, 'flat')[0];
  assert.equal(project.firstSeen.getTime(), start);
  assert.equal(project.lastSeen.getTime(), end);
  assert.equal(project.data.totalOutputTokens, count);
  assert.equal(ClaudeDataLoader.getBranchBreakdown(grouped)[0].lastSeen.getTime(), end);
  const workflow = ClaudeDataLoader.getWorkflowBreakdown(records)[0];
  assert.equal(workflow.startTime.getTime(), start);
  assert.equal(workflow.endTime.getTime(), end);
});

test('incremental index accepts one project above 150k rows and unchanged refresh reads zero bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccu-large-group-test-'));
  try {
    const project = join(root, 'projects', '-fixture-large');
    await mkdir(project, { recursive: true });
    // Split the project over files: the session cap is not a project-row cap.
    for (let part = 0; part < 3; part++) {
      const rows = records.slice(part * 50_000, (part + 1) * 50_000)
        .map((record, i) => JSON.stringify({ type: 'assistant', cwd: '/fixture/large',
          ...record, requestId: `synthetic-${part}-${i}` }));
      await writeFile(join(project, `session-${part}.jsonl`), rows.join('\n') + '\n');
    }
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: false });
    assert.equal(cold.records.length, count);
    const row = [...cold.index.projectRows.values()][0];
    assert.equal(row.firstSeen.getTime(), start);
    assert.equal(row.lastSeen.getTime(), end);
    assert.equal(row.data.totalOutputTokens, count);
    const warm = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: false });
    assert.equal(warm.diagnostics.bodyReads, 0);
    assert.equal(warm.diagnostics.bytesRead, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
