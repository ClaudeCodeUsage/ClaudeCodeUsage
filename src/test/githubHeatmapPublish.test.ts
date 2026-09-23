import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  GITHUB_HEATMAP_DESTINATION_KEY,
  GITHUB_PUBLIC_REPO_SCOPE,
  GitHubApiRequest,
  completeSuccessfulGitHubPublish,
  createGitHubPublishPlan,
  githubPublishConfirmationDetail,
  parseGitHubHeatmapDestination,
  probePublicGitHubPublishTarget,
  publishPublicGitHubFile,
} from '../githubHeatmapPublish';

test('GitHub publisher uses the public-only scope and rejects ambiguous destinations', () => {
  assert.equal(GITHUB_PUBLIC_REPO_SCOPE, 'public_repo');
  for (const [repo, path] of [
    ['owner/repo/extra', 'heatmap.svg'],
    ['owner?x/repo', 'heatmap.svg'],
    ['owner/repo', '../heatmap.svg'],
    ['owner/repo', '/heatmap.svg'],
    ['owner/repo', 'folder//heatmap.svg'],
    ['owner/repo', 'heatmap.svg?raw=1'],
    ['owner/repo', 'folder\\heatmap.svg'],
  ]) {
    assert.throws(() => createGitHubPublishPlan(repo, path));
  }
});

test('destination paths are encoded segment by segment without introducing query or fragment data', () => {
  const plan = createGitHubPublishPlan('owner/repo.name', 'docs/AI activity.svg');
  assert.equal(plan.repoApiPath, '/repos/owner/repo.name');
  assert.equal(plan.contentsApiPath, '/repos/owner/repo.name/contents/docs/AI%20activity.svg');
});

test('mocked public create probe and write use the verified branch and no sha', async () => {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const request: GitHubApiRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    if (calls.length === 1) return { status: 200, body: JSON.stringify({ private: false, default_branch: 'main' }) };
    if (calls.length === 2) return { status: 404, body: '{}' };
    return { status: 201, body: '{}' };
  };
  const preview = await probePublicGitHubPublishTarget(
    createGitHubPublishPlan('owner/repo', 'assets/activity.svg'),
    request,
  );
  assert.equal(preview.action, 'create');
  await publishPublicGitHubFile(preview, 'U0ZH', request);
  assert.deepEqual(calls, [
    {
      method: 'GET',
      path: '/repos/owner/repo',
      body: undefined,
    },
    {
      method: 'GET',
      path: '/repos/owner/repo/contents/assets/activity.svg?ref=main',
      body: undefined,
    },
    {
      method: 'PUT',
      path: '/repos/owner/repo/contents/assets/activity.svg',
      body: {
        message: 'Update Claude Code usage heatmap',
        content: 'U0ZH',
        branch: 'main',
      },
    },
  ]);
});

test('mocked update carries only the exact probed endpoint, branch, and sha', async () => {
  const sha = 'a'.repeat(40);
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const request: GitHubApiRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    if (calls.length === 1) return { status: 200, body: JSON.stringify({ private: false, default_branch: 'release/v2' }) };
    if (calls.length === 2) return { status: 200, body: JSON.stringify({ sha }) };
    return { status: 200, body: '{}' };
  };
  const preview = await probePublicGitHubPublishTarget(
    createGitHubPublishPlan('owner/repo', 'activity.svg'),
    request,
  );
  assert.equal(preview.action, 'update');
  await publishPublicGitHubFile(preview, 'U0ZH', request);
  assert.deepEqual(calls, [
    { method: 'GET', path: '/repos/owner/repo', body: undefined },
    {
      method: 'GET',
      path: '/repos/owner/repo/contents/activity.svg?ref=release%2Fv2',
      body: undefined,
    },
    {
      method: 'PUT',
      path: '/repos/owner/repo/contents/activity.svg',
      body: {
        message: 'Update Claude Code usage heatmap',
        content: 'U0ZH',
        branch: 'release/v2',
        sha,
      },
    },
  ]);
});

test('private or unverifiable targets fail closed before any mock write', async () => {
  let calls = 0;
  const request: GitHubApiRequest = async () => {
    calls += 1;
    return { status: 200, body: JSON.stringify({ private: true, default_branch: 'main' }) };
  };
  await assert.rejects(
    probePublicGitHubPublishTarget(createGitHubPublishPlan('owner/repo', 'activity.svg'), request),
    /Private repositories are not supported/,
  );
  assert.equal(calls, 1);
});

test('exact confirmation names repository, branch, path, action, visibility, and payload class', () => {
  const detail = githubPublishConfirmationDetail({
    ...createGitHubPublishPlan('owner/repo', 'docs/activity.svg'),
    visibility: 'public',
    branch: 'main',
    action: 'update',
    existingSha: 'b'.repeat(40),
    browserUrl: 'https://github.com/owner/repo/blob/main/docs/activity.svg',
  }, 1234);
  assert.match(detail, /owner\/repo \(public\)/);
  assert.match(detail, /Branch: main/);
  assert.match(detail, /Path: docs\/activity\.svg/);
  assert.match(detail, /OVERWRITE/);
  assert.match(detail, /aggregate SVG \(1234 bytes\)/);
  assert.match(detail, /Excluded: accounts, projects, thread titles, local paths, prompts, and log content/);
});

test('mocked request failures expose status only, never response-body canaries', async () => {
  const request: GitHubApiRequest = async () => ({ status: 503, body: 'TOKEN_COOKIE_PRIVACY_CANARY' });
  await assert.rejects(
    probePublicGitHubPublishTarget(createGitHubPublishPlan('owner/repo', 'activity.svg'), request),
    (error: Error) => /status 503/.test(error.message) && !/PRIVACY_CANARY/.test(error.message),
  );
});

test('successful publication is reported before an atomic destination-save warning', async () => {
  const events: string[] = [];
  const result = await completeSuccessfulGitHubPublish(
    {
      ...createGitHubPublishPlan('owner/repo', 'images/activity.svg'),
      visibility: 'public',
      branch: 'main',
      action: 'create',
      browserUrl: 'https://github.com/owner/repo/blob/main/images/activity.svg',
    },
    {
      persistDestination: async (key, destination) => {
        events.push(`persist:${key}:${JSON.stringify(destination)}`);
        throw new Error('synthetic persistence failure');
      },
      showSuccess: async () => {
        events.push('success');
        return true;
      },
      showPersistenceWarning: async () => {
        events.push('warning');
      },
    },
  );

  assert.deepEqual(result, { openBrowser: true, preferenceSaved: false });
  assert.deepEqual(events, [
    `persist:${GITHUB_HEATMAP_DESTINATION_KEY}:${JSON.stringify({
      schemaVersion: 1,
      repository: 'owner/repo',
      filePath: 'images/activity.svg',
    })}`,
    'success',
    'warning',
  ]);
});

test('stored GitHub destination accepts only the exact atomic schema', () => {
  assert.deepEqual(parseGitHubHeatmapDestination({
    schemaVersion: 1,
    repository: 'owner/repo',
    filePath: 'images/activity.svg',
  }), {
    schemaVersion: 1,
    repository: 'owner/repo',
    filePath: 'images/activity.svg',
  });
  assert.equal(parseGitHubHeatmapDestination({
    schemaVersion: 1,
    repository: 'owner/repo',
    filePath: 'images/activity.svg',
    token: 'must-not-survive',
  }), undefined);
  assert.equal(parseGitHubHeatmapDestination({
    schemaVersion: 1,
    repository: 'owner/repo',
  }), undefined);
});
