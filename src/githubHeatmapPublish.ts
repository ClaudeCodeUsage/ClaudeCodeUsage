export const GITHUB_PUBLIC_REPO_SCOPE = 'public_repo';
export const GITHUB_HEATMAP_DESTINATION_KEY = 'ccu.heatmapDestination.v1';

export interface GitHubHeatmapDestination {
  schemaVersion: 1;
  repository: string;
  filePath: string;
}

export interface GitHubApiResponse {
  status: number;
  body: string;
}

export type GitHubApiRequest = (
  method: 'GET' | 'PUT',
  apiPath: string,
  body?: unknown,
) => Promise<GitHubApiResponse>;

export interface GitHubPublishPlan {
  owner: string;
  repository: string;
  filePath: string;
  repoApiPath: string;
  contentsApiPath: string;
}

export interface GitHubPublishPreview extends GitHubPublishPlan {
  visibility: 'public';
  branch: string;
  action: 'create' | 'update';
  existingSha?: string;
  browserUrl: string;
}

export class GitHubPublishHttpError extends Error {
  constructor(
    public readonly operation: 'repository-probe' | 'file-probe' | 'file-write',
    public readonly status: number,
  ) {
    super(`GitHub ${operation} failed (status ${status}).`);
    this.name = 'GitHubPublishHttpError';
  }
}

export function parseGitHubHeatmapDestination(
  value: unknown,
): GitHubHeatmapDestination | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(',') !== 'filePath,repository,schemaVersion' ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.repository !== 'string' ||
    typeof candidate.filePath !== 'string'
  ) {
    return undefined;
  }
  try {
    const plan = createGitHubPublishPlan(candidate.repository, candidate.filePath);
    return {
      schemaVersion: 1,
      repository: `${plan.owner}/${plan.repository}`,
      filePath: plan.filePath,
    };
  } catch {
    return undefined;
  }
}

export async function completeSuccessfulGitHubPublish(
  preview: GitHubPublishPreview,
  callbacks: {
    persistDestination: (
      key: typeof GITHUB_HEATMAP_DESTINATION_KEY,
      destination: GitHubHeatmapDestination,
    ) => Promise<void>;
    showSuccess: () => Promise<boolean>;
    showPersistenceWarning: () => Promise<void>;
  },
): Promise<{ openBrowser: boolean; preferenceSaved: boolean }> {
  const destination: GitHubHeatmapDestination = {
    schemaVersion: 1,
    repository: `${preview.owner}/${preview.repository}`,
    filePath: preview.filePath,
  };
  let preferenceSaved = true;
  try {
    await callbacks.persistDestination(GITHUB_HEATMAP_DESTINATION_KEY, destination);
  } catch {
    preferenceSaved = false;
  }
  const openBrowser = await callbacks.showSuccess();
  if (!preferenceSaved) {
    await callbacks.showPersistenceWarning();
  }
  return { openBrowser, preferenceSaved };
}

function encodedSegments(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

export function createGitHubPublishPlan(
  repositoryInput: string,
  pathInput: string,
): GitHubPublishPlan {
  const repository = repositoryInput.trim();
  const parts = repository.split('/');
  if (parts.length !== 2) {
    throw new Error('Repository must use the exact owner/name form.');
  }
  const [owner, name] = parts;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
    throw new Error('Repository owner contains unsupported characters.');
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') {
    throw new Error('Repository name contains unsupported characters.');
  }

  const filePath = pathInput.trim();
  if (
    !filePath ||
    filePath.length > 512 ||
    filePath.startsWith('/') ||
    filePath.endsWith('/') ||
    /[\\?#\u0000-\u001f\u007f]/.test(filePath)
  ) {
    throw new Error('Repository path must be a relative path without query, fragment, or control characters.');
  }
  const pathSegments = filePath.split('/');
  if (pathSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Repository path contains an unsafe segment.');
  }

  const encodedOwner = encodeURIComponent(owner);
  const encodedRepository = encodeURIComponent(name);
  return {
    owner,
    repository: name,
    filePath,
    repoApiPath: `/repos/${encodedOwner}/${encodedRepository}`,
    contentsApiPath: `/repos/${encodedOwner}/${encodedRepository}/contents/${encodedSegments(filePath)}`,
  };
}

function parseObject(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('GitHub returned an unreadable response.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GitHub returned an unexpected response.');
  }
  return parsed as Record<string, unknown>;
}

export async function probePublicGitHubPublishTarget(
  plan: GitHubPublishPlan,
  request: GitHubApiRequest,
): Promise<GitHubPublishPreview> {
  const repository = await request('GET', plan.repoApiPath);
  if (repository.status !== 200) {
    throw new GitHubPublishHttpError('repository-probe', repository.status);
  }
  const repositoryBody = parseObject(repository.body);
  if (repositoryBody.private === true) {
    throw new Error('Private repositories are not supported by the public-only publisher. Export the SVG and add it manually instead.');
  }
  if (repositoryBody.private !== false) {
    throw new Error('GitHub repository visibility could not be verified.');
  }
  const branch = typeof repositoryBody.default_branch === 'string'
    ? repositoryBody.default_branch.trim()
    : '';
  if (!branch || /[\u0000-\u001f\u007f]/.test(branch)) {
    throw new Error('GitHub default branch could not be verified.');
  }

  const fileProbePath = `${plan.contentsApiPath}?ref=${encodeURIComponent(branch)}`;
  const file = await request('GET', fileProbePath);
  let action: 'create' | 'update';
  let existingSha: string | undefined;
  if (file.status === 404) {
    action = 'create';
  } else if (file.status === 200) {
    const fileBody = parseObject(file.body);
    if (typeof fileBody.sha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(fileBody.sha)) {
      throw new Error('GitHub existing-file identity could not be verified.');
    }
    action = 'update';
    existingSha = fileBody.sha;
  } else {
    throw new GitHubPublishHttpError('file-probe', file.status);
  }

  return {
    ...plan,
    visibility: 'public',
    branch,
    action,
    existingSha,
    browserUrl: `https://github.com/${encodeURIComponent(plan.owner)}/${encodeURIComponent(plan.repository)}/blob/${encodedSegments(branch)}/${encodedSegments(plan.filePath)}`,
  };
}

export function githubPublishConfirmationDetail(
  preview: GitHubPublishPreview,
  payloadBytes: number,
): string {
  const action = preview.action === 'update' ? 'OVERWRITE the existing file' : 'CREATE a new file';
  return [
    `Repository: ${preview.owner}/${preview.repository} (public)`,
    `Branch: ${preview.branch}`,
    `Path: ${preview.filePath}`,
    `Action: ${action}`,
    `Payload: one aggregate SVG (${Math.max(0, Math.trunc(payloadBytes))} bytes)`,
    'Excluded: accounts, projects, thread titles, local paths, prompts, and log content.',
  ].join('\n');
}

export async function publishPublicGitHubFile(
  preview: GitHubPublishPreview,
  contentBase64: string,
  request: GitHubApiRequest,
): Promise<void> {
  const response = await request('PUT', preview.contentsApiPath, {
    message: 'Update Claude Code usage heatmap',
    content: contentBase64,
    branch: preview.branch,
    ...(preview.existingSha ? { sha: preview.existingSha } : {}),
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new GitHubPublishHttpError('file-write', response.status);
  }
}
