import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '..', '..');

function repoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

function activePatterns(relativePath: string): Set<string> {
  return new Set(
    repoFile(relativePath)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

test('AGENTS is the canonical Codex repository policy', () => {
  const agents = repoFile('AGENTS.md');
  assert.match(agents, /Claude-only in v2\.2\.1/);
  assert.match(agents, /no new runtime dependencies/i);
  assert.match(agents, /all seven UI locales/i);
  assert.match(agents, /push, open a pull request, merge, or publish a release/i);
  assert.match(agents, /Generated with \[OpenAI Codex\]/);
});

test('AGENTS links a faithful Simplified-Chinese review copy', () => {
  const agents = repoFile('AGENTS.md');
  const chinese = repoFile('AGENTS.zh-CN.md');
  assert.match(agents, /AGENTS\.zh-CN\.md/);
  assert.match(chinese, /v2\.2\.1 保持 Claude-only/);
  assert.match(chinese, /中文链接排在英文链接之前/);
  assert.match(chinese, /推送、创建 PR、合并或发布 Release/);
});

test('CLAUDE is a compatibility entry point, not a conflicting policy source', () => {
  const claude = repoFile('CLAUDE.md');
  assert.match(claude, /AGENTS\.md.*canonical repository policy/);
  assert.match(claude, /polling always follows\s+`refreshInterval`/);
  assert.doesNotMatch(claude, /activity-aware: ~15 s|never writes to `~\/\.claude\/`/);
});

test('line endings and tracked file modes are repository-safe', () => {
  const attributes = repoFile('.gitattributes');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
  for (const binary of ['*.png binary', '*.jpg binary', '*.jpeg binary', '*.gif binary', '*.webp binary', '*.ico binary', '*.vsix binary']) {
    assert.match(attributes, new RegExp(`^${binary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }

  const badModes = execFileSync('git', ['ls-files', '--stage'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.startsWith('100644 '));
  assert.deepEqual(badModes, []);
});

test('git and VSIX ignores exclude private and development-only material', () => {
  const gitIgnore = activePatterns('.gitignore');
  for (const pattern of ['out', 'node_modules', '*.vsix', '.env', '.env.*', 'secrets.json', 'CLAUDE.local.md', 'docs/', '.claude/', '.agents/', '.codex/', '.worktrees/']) {
    assert.ok(gitIgnore.has(pattern), `.gitignore missing ${pattern}`);
  }

  const vscodeIgnore = activePatterns('.vscodeignore');
  for (const pattern of ['.github/**', 'src/**', 'out/test/**', 'AGENTS.md', 'AGENTS.zh-CN.md', 'CLAUDE.md', 'CLAUDE.local.md', 'CONTRIBUTING.md', 'docs/**', '.claude/**', '.agents/**', '.codex/**', '.worktrees/**', '.env', '**/.env', '**/.env.*', '**/secrets.json', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx']) {
    assert.ok(vscodeIgnore.has(pattern), `.vscodeignore missing ${pattern}`);
  }
});

test('all six README files credit both development tools', () => {
  const readmes = [
    'README.md',
    'README-en.md',
    'README-zh-CN.md',
    'README-zh-TW.md',
    'README-ja.md',
    'README-ko.md',
  ];
  for (const readme of readmes) {
    const body = repoFile(readme);
    assert.match(body, /https:\/\/claude\.com\/claude-code/, `${readme} missing Claude Code credit`);
    assert.match(body, /https:\/\/developers\.openai\.com\/codex\//, `${readme} missing OpenAI Codex credit`);
  }
});

test('pull request checklist names the actual seven UI locales', () => {
  const packageJson = JSON.parse(repoFile('package.json')) as {
    contributes: { configuration: { properties: Record<string, { enum?: string[] }> } };
  };
  const languageValues = packageJson.contributes.configuration.properties['claudeCodeUsage.language'].enum ?? [];
  assert.equal(languageValues.filter((value) => value !== 'auto').length, 7);

  const template = repoFile('.github/PULL_REQUEST_TEMPLATE.md');
  assert.match(template, /all seven UI locales/);
  assert.doesNotMatch(template, /all six languages/);
  assert.match(template, /all six README editions/);
});

test('changelog records the released baseline and the v2.2.1 tooling transition', () => {
  const changelog = repoFile('CHANGELOG.md');
  assert.match(changelog, /^## \[2\.2\.1\] — Unreleased$/m);
  assert.match(changelog, /^## \[2\.2\.0\] — 2026-07-07$/m);
  assert.match(changelog, /OpenAI Codex/);
  assert.doesNotMatch(changelog, /^## \[2\.2\.0\] — Unreleased$/m);
});
