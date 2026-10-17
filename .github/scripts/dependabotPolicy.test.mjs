import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const active = (source) => source.replaceAll('\r\n', '\n').split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

// This is a fail-closed guard for this file's deliberately small, block-style
// YAML contract, not a general YAML parser. Real YAML syntax is also checked
// during configuration review without adding a project parser dependency.
function entries(source) {
  source = active(source);
  assert.match(source, /^version: 2\nupdates:\n/);
  assert.doesNotMatch(source, /\t|[&*][A-Za-z_]|<<:/, 'no YAML aliases/merges or tabs');
  assert.doesNotMatch(source, /^\s*(?:ignore|allow|target-branch|registries|insecure-external-code-execution|exclude-paths|reviewers|cooldown):/m,
    'do not restrict vulnerable-package coverage or silently change update routing');
  const matches = [...source.matchAll(/^  - package-ecosystem: "([^"]+)"\n([\s\S]*?)(?=^  - package-ecosystem:|(?![\s\S]))/gm)];
  assert.equal(matches.length, 3, 'exactly three update scopes');
  assert.equal((source.match(/^  - /gm) ?? []).length, 3);
  return matches.map(([, ecosystem, body]) => ({ ecosystem, body }));
}

function scalar(body, key, indentation) {
  const matches = [...body.matchAll(new RegExp(`^ {${indentation}}${key}: (.+)$`, 'gm'))];
  assert.equal(matches.length, 1, `one ${key} at indentation ${indentation}`);
  return JSON.parse(matches[0][1]);
}

function validate(source) {
  const updates = entries(source);
  const expected = [
    { ecosystem: 'npm', directory: '/', time: '09:00', group: 'dev-tooling', sensitive: ['@axe-core/playwright', '@types/vscode'] },
    { ecosystem: 'npm', directory: '/.github/build-tools', time: '09:30', group: 'build-tooling', sensitive: [] },
    { ecosystem: 'github-actions', directory: '/', time: '10:00', group: 'github-actions', sensitive: [] },
  ];
  return updates.map(({ ecosystem, body }, index) => {
    const want = expected[index];
    assert.equal(ecosystem, want.ecosystem);
    assert.equal(scalar(body, 'directory', 4), want.directory);
    assert.equal(scalar(body, 'open-pull-requests-limit', 4), 2);
    assert.deepEqual(scalar(body, 'labels', 4), ['dependencies']);
    assert.match(body, /^    schedule:\n      interval: "weekly"\n      day: "sunday"\n      time: "[^"\n]+"\n      timezone: "Asia\/Shanghai"$/m);
    assert.equal(scalar(body, 'interval', 6), 'weekly');
    assert.equal(scalar(body, 'day', 6), 'sunday');
    assert.equal(scalar(body, 'timezone', 6), 'Asia/Shanghai');
    assert.equal(scalar(body, 'time', 6), want.time);
    assert.match(body, new RegExp(`^    groups:\\n      ${want.group}:\\n`, 'm'));
    assert.equal(scalar(body, 'applies-to', 8), 'version-updates');
    assert.deepEqual(scalar(body, 'patterns', 8), ['*']);
    assert.deepEqual(scalar(body, 'update-types', 8), ['minor', 'patch']);
    const exclusions = want.sensitive.length ? scalar(body, 'exclude-patterns', 8) : [];
    assert.deepEqual(exclusions, want.sensitive);
    if (!want.sensitive.length) assert.doesNotMatch(body, /exclude-patterns:/);
    assert.match(body, /^    commit-message:\n      prefix: "build"\n      include: "scope"$/m);
    // A second mapping could otherwise silently replace the reviewed scope.
    const topKeys = [...body.matchAll(/^ {4}([\w-]+):/gm)].map((m) => m[1]);
    assert.deepEqual(topKeys, ['directory', 'schedule', 'open-pull-requests-limit', 'labels', 'commit-message', 'groups']);
    assert.equal((body.match(/^ {6}[\w-]+:\s*$/gm) ?? []).length, 1, 'one version-only group');
    return { ecosystem, directory: want.directory, exclusions };
  });
}

test('Dependabot covers both npm locks and workflow actions on bounded weekly schedules', () => {
  const source = read('.github/dependabot.yml');
  const scopes = validate(source);
  assert.deepEqual(validate(source.replaceAll('\n', '\r\n')), scopes, 'checkout line endings do not change policy');
  for (const { ecosystem, directory } of scopes) {
    if (ecosystem === 'npm') {
      const prefix = directory === '/' ? '' : `${directory.slice(1)}/`;
      assert.ok(existsSync(new URL(`${prefix}package-lock.json`, root)));
      assert.ok(existsSync(new URL(`${prefix}package.json`, root)));
    }
  }
});

test('ordinary groups leave major and sensitive upgrades individual without suppressing security fixes', () => {
  const source = read('.github/dependabot.yml');
  const scopes = validate(source);
  assert.doesNotMatch(active(source), /applies-to: "security-updates"|skip-changelog/);
  const rootScope = scopes[0];
  const grouped = (name, bump) => ['minor', 'patch'].includes(bump) && !rootScope.exclusions.includes(name);
  assert.equal(grouped('@playwright/test', 'minor'), true);
  assert.equal(grouped('typescript', 'patch'), true);
  assert.equal(grouped('typescript', 'major'), false);
  assert.equal(grouped('@types/node', 'major'), false);
  assert.equal(grouped('@axe-core/playwright', 'minor'), false);
  assert.equal(grouped('@types/vscode', 'minor'), false);
  assert.equal(grouped('@axe-core/playwright', 'patch'), false);
});

test('unsafe schedule, routing, grouping and limit mutations fail the configuration guard', () => {
  const source = read('.github/dependabot.yml');
  for (const [before, after] of [
    ['interval: "weekly"', 'interval: "daily"'],
    ['day: "sunday"', 'day: "monday"'],
    ['timezone: "Asia/Shanghai"', 'timezone: "UTC"'],
    ['open-pull-requests-limit: 2', 'open-pull-requests-limit: 20'],
    ['directory: "/.github/build-tools"', 'directory: "/tools"'],
    ['applies-to: "version-updates"', 'applies-to: "security-updates"'],
    ['update-types: ["minor", "patch"]', 'update-types: ["major", "minor", "patch"]'],
    ['exclude-patterns: ["@axe-core/playwright", "@types/vscode"]', 'exclude-patterns: []'],
    ['labels: ["dependencies"]', 'labels: ["dependencies", "skip-changelog"]'],
    ['    groups:\n', '    ignore: []\n    groups:\n'],
    ['    groups:\n', '    target-branch: "preview"\n    groups:\n'],
    ['    groups:\n', '    allow: []\n    groups:\n'],
  ]) {
    assert.ok(source.includes(before), `missing mutation anchor: ${before}`);
    assert.throws(() => validate(source.replace(before, after)), { code: 'ERR_ASSERTION' }, after);
  }
});

test('dependency PRs retain CI, manual integration and explicit release publication boundaries', () => {
  const ci = active(read('.github/workflows/test.yml'));
  assert.match(ci, /^  pull_request:\s*$/m);
  assert.doesNotMatch(ci, /paths-ignore:|dependabot\[bot\]/);
  const workflows = readdirSync(new URL('.github/workflows/', root)).filter((file) => /\.ya?ml$/.test(file));
  assert.ok(workflows.length > 0);
  for (const file of workflows) {
    const source = active(read(`.github/workflows/${file}`));
    assert.doesNotMatch(source, /gh\s+pr\s+merge|enablePullRequestAutoMerge|mergePullRequest/,
      `${file}: no bot-driven merge workflow`);
  }
  const publish = active(read('.github/workflows/publish.yml'));
  assert.match(publish, /^  release:\n    types: \[published\]$/m);
  assert.match(publish, /^  workflow_dispatch:/m);
  assert.doesNotMatch(publish, /^  (?:push|pull_request|pull_request_target|schedule):/m);
});
