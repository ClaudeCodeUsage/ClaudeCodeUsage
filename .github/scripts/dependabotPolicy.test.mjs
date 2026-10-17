import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const active = (source) => source.replaceAll('\r\n', '\n').split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
const batch = 'weekly-dependencies';

// Fail-closed guard for this deliberately constrained block-style YAML,
// not a general YAML parser or proof that GitHub has run the update job.
function scalar(body, key, indentation) {
  const matches = [...body.matchAll(new RegExp('^ {' + indentation + '}' + key + ': (.+)$', 'gm'))];
  assert.equal(matches.length, 1, 'one ' + key);
  return JSON.parse(matches[0][1]);
}

function validate(source) {
  source = active(source);
  assert.doesNotMatch(source, /\t|[&*][A-Za-z_]|<<:/, 'no aliases, merges or tabs');
  assert.doesNotMatch(source, /^\s*(?:ignore|allow|target-branch|registries|insecure-external-code-execution|exclude-paths|exclude-patterns|update-types|applies-to|groups|open-pull-requests-limit|cooldown):/m,
    'do not split the ordinary batch, suppress security fixes or add unverified limit policies');
  const split = source.split(/^updates:\n/m);
  assert.equal(split.length, 2, 'one updates section');
  const header = split[0];
  assert.match(header, /^version: 2\nmulti-ecosystem-groups:\n/);
  assert.deepEqual([...header.matchAll(/^  ([\w-]+):/gm)].map(m => m[1]), [batch], 'one consolidated group');
  assert.deepEqual([...header.matchAll(/^ {4}([\w-]+):/gm)].map(m => m[1]), ['schedule', 'labels', 'commit-message']);
  assert.match(header, /^    schedule:\n      interval: "weekly"\n      day: "sunday"\n      time: "09:00"\n      timezone: "Asia\/Shanghai"$/m);
  assert.equal(scalar(header, 'interval', 6), 'weekly');
  assert.equal(scalar(header, 'day', 6), 'sunday');
  assert.equal(scalar(header, 'time', 6), '09:00');
  assert.equal(scalar(header, 'timezone', 6), 'Asia/Shanghai');
  assert.deepEqual(scalar(header, 'labels', 4), ['dependencies']);
  assert.match(header, /^    commit-message:\n      prefix: "build"\n      include: "scope"$/m);

  const body = split[1];
  const matches = [...body.matchAll(/^  - package-ecosystem: "([^"]+)"\n([\s\S]*?)(?=^  - package-ecosystem:|(?![\s\S]))/gm)];
  assert.equal(matches.length, 3, 'root npm, build-tool npm and GitHub Actions');
  assert.equal(matches.map(m => m[0]).join(''), body, 'no unrecognized top-level sections');
  const expected = [['npm', '/'], ['npm', '/.github/build-tools'], ['github-actions', '/']];
  return matches.map(([, ecosystem, entry], i) => {
    const directory = scalar(entry, 'directory', 4);
    assert.deepEqual([ecosystem, directory], expected[i]);
    assert.deepEqual([...entry.matchAll(/^ {4}([\w-]+):/gm)].map(m => m[1]), ['directory', 'patterns', 'multi-ecosystem-group']);
    assert.deepEqual(scalar(entry, 'patterns', 4), ['*'], 'all ordinary proposals, including major/sensitive tools, share the batch');
    assert.equal(scalar(entry, 'multi-ecosystem-group', 4), batch);
    return { ecosystem, directory, batch };
  });
}

test('all three dependency scopes join one Sunday multi-ecosystem batch', () => {
  const source = read('.github/dependabot.yml');
  const scopes = validate(source);
  assert.deepEqual(validate(source.replaceAll('\n', '\r\n')), scopes);
  for (const { ecosystem, directory } of scopes) {
    if (ecosystem !== 'npm') continue;
    const prefix = directory === '/' ? '' : directory.slice(1) + '/';
    assert.ok(existsSync(new URL(prefix + 'package.json', root)));
    assert.ok(existsSync(new URL(prefix + 'package-lock.json', root)));
  }
});

test('batching leaves compatibility review and independent security updates intact', () => {
  const source = read('.github/dependabot.yml');
  const scopes = validate(source);
  assert.deepEqual([...new Set(scopes.map(s => s.batch))], [batch]);
  assert.doesNotMatch(active(source), /security-updates|skip-changelog|exclude-patterns:|update-types:/);
  assert.equal((active(source).match(/^    patterns: \["\*"\]$/gm) ?? []).length, 3);
  // Coverage is configuration-level only: no simulated resolver or live-job claim.
  const guidance = read('CONTRIBUTING.md');
  assert.match(guidance, /single weekly ordinary version-update PR/);
  assert.match(guidance, /一个每周普通版本升级 PR/);
  assert.match(guidance, /security updates remain independent/);
  assert.match(guidance, /existing individual PRs/);
});

test('schedule, scope, split-batch and security-suppression mutations are rejected', () => {
  const source = read('.github/dependabot.yml');
  for (const [before, after] of [
    ['interval: "weekly"', 'interval: "daily"'],
    ['day: "sunday"', 'day: "monday"'],
    ['time: "09:00"', 'time: "09:30"'],
    ['timezone: "Asia/Shanghai"', 'timezone: "UTC"'],
    ['directory: "/.github/build-tools"', 'directory: "/tools"'],
    ['package-ecosystem: "github-actions"', 'package-ecosystem: "npm"'],
    ['patterns: ["*"]', 'patterns: ["typescript"]'],
    ['multi-ecosystem-group: "weekly-dependencies"', 'multi-ecosystem-group: "another-batch"'],
    ['labels: ["dependencies"]', 'labels: ["dependencies", "skip-changelog"]'],
    ['    patterns: ["*"]\n', '    ignore: []\n    patterns: ["*"]\n'],
    ['    patterns: ["*"]\n', '    allow: []\n    patterns: ["*"]\n'],
    ['    patterns: ["*"]\n', '    groups: {}\n    patterns: ["*"]\n'],
    ['    patterns: ["*"]\n', '    schedule:\n      interval: "daily"\n    patterns: ["*"]\n'],
    ['    labels: ["dependencies"]\n', '    open-pull-requests-limit: 1\n    labels: ["dependencies"]\n'],
    ['    labels: ["dependencies"]\n', '    target-branch: "preview"\n    labels: ["dependencies"]\n'],
  ]) {
    assert.ok(source.includes(before), 'mutation anchor: ' + before);
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
