import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const parse = (file) => JSON.parse(read(file));

test('release CLIs have an independent, complete lock and never become extension runtime dependencies', () => {
  const manifest = parse('.github/build-tools/package.json');
  const lock = parse('.github/build-tools/package-lock.json');
  const extension = parse('package.json');
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.dependencies, { '@vscode/vsce': '4.0.0', ovsx: '1.3.0' });
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.equal(lock.packages['node_modules/@vscode/vsce'].version, '4.0.0');
  assert.equal(lock.packages['node_modules/ovsx'].version, '1.3.0');
  assert.equal(extension.dependencies, undefined);
  assert.equal(extension.devDependencies['@vscode/vsce'], undefined);
  assert.equal(extension.devDependencies.ovsx, undefined);
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path) continue;
    assert.match(pkg.resolved, /^https:\/\/registry\.npmjs\.org\//, path);
    assert.match(pkg.integrity, /^sha512-/, path);
    assert.doesNotMatch(path, /(?:^|\/)node_modules\/(?:braces|secretlint)$/, 'retired vulnerable CLI chain must not return');
  }
});

test('publishing and recovery execute installed CLIs without npx or fallback downloads', () => {
  const publish = read('.github/workflows/publish.yml');
  const recovery = read('.github/workflows/marketplace-recovery.yml');
  for (const source of [publish, recovery]) {
    assert.doesNotMatch(source, /\bnpx\b/);
    assert.match(source, /npm ci[^\n]*--ignore-scripts/);
    assert.match(source, /npm audit[^\n]*--audit-level=high/);
    assert.doesNotMatch(source, /audit[^\n]*(?:\|\| true|continue-on-error)/);
  }
  assert.match(publish, /"\$CCU_RELEASE_TOOLS\/node_modules\/\.bin\/vsce" package/);
  assert.match(publish, /"\$CCU_RELEASE_TOOLS\/node_modules\/\.bin\/vsce" publish/);
  assert.match(publish, /"\$CCU_RELEASE_TOOLS\/node_modules\/\.bin\/ovsx" publish/);
  assert.match(recovery, /\.github\/build-tools\/node_modules\/\.bin\/vsce show/);
  assert.match(recovery, /\.github\/build-tools\/node_modules\/\.bin\/vsce publish/);
});

function bootstrap() {
  const source = read('.github/workflows/publish.yml');
  const match = source.match(/      - name: Install locked release tools\n([\s\S]*?)(?=\n      - |\n      #)/);
  assert.ok(match, 'historical retry needs a current-workflow tooling bootstrap');
  const run = match[1].match(/        run: \|\n([\s\S]*)/);
  assert.ok(run);
  return run[1].split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');
}

function fixture({ auditFails = false, missingTools = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ccu-release-bootstrap-'));
  const source = join(directory, 'origin');
  const repo = join(directory, 'repo');
  const runner = join(directory, 'runner');
  const bin = join(directory, 'bin');
  for (const path of [source, runner, bin]) mkdirSync(path);
  const gitAt = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  const git = (...args) => gitAt(source, ...args);
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Synthetic Fixture');
  writeFileSync(join(source, 'old-release.txt'), 'synthetic old release without build tools\n');
  git('add', '.'); git('commit', '-qm', 'old release');
  const old = git('rev-parse', 'HEAD');
  git('tag', 'synthetic-old');
  if (!missingTools) {
    mkdirSync(join(source, '.github/build-tools'), { recursive: true });
    for (const file of ['package.json', 'package-lock.json']) {
      writeFileSync(join(source, '.github/build-tools', file), read(`.github/build-tools/${file}`));
    }
    git('add', '.'); git('commit', '-qm', 'current workflow tooling');
  }
  const current = git('rev-parse', 'HEAD');
  gitAt(directory, 'clone', '-q', '--depth=1', '--single-branch', '--branch', 'synthetic-old', `file://${source}`, repo);
  const workflowWasLocal = spawnSync('git', ['cat-file', '-e', current], {cwd:repo, stdio:'ignore'}).status === 0;
  const calls = join(directory, 'npm-calls');
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CCU_TEST_CALLS"\nif [ "$1" = audit ] && [ "$CCU_TEST_AUDIT_FAILS" = true ]; then exit 9; fi\n`);
  chmodSync(join(bin, 'npm'), 0o755);
  const script = bootstrap().replaceAll('${{ github.workflow_sha }}', current);
  const envFile = join(directory, 'env');
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runner, GITHUB_ENV: envFile,
      CCU_TEST_CALLS: calls, CCU_TEST_AUDIT_FAILS: String(auditFails) },
  });
  return { result, repo, runner, envFile, calls, workflowWasLocal, git: (...args) => gitAt(repo, ...args) };
}

test('historical retry fetches a not-yet-local workflow commit and bootstraps exact locks outside the release', () => {
  const f = fixture();
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.workflowWasLocal, false, 'fixture must not prefetch the workflow commit');
  assert.equal(existsSync(join(f.repo, '.github/build-tools')), false);
  assert.equal(f.git('status', '--porcelain'), '');
  const environment = readFileSync(f.envFile, 'utf8');
  const tooling = environment.match(/^CCU_RELEASE_TOOLS=(.+)$/m)?.[1];
  assert.ok(tooling?.startsWith(`${f.runner}/`), environment);
  assert.equal(readFileSync(join(tooling, 'package-lock.json'), 'utf8'), read('.github/build-tools/package-lock.json'));
  const calls = readFileSync(f.calls, 'utf8').trim().split('\n');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^ci .*--ignore-scripts/);
  assert.match(calls[1], /^audit .*--audit-level=high/);
});

test('a security audit failure prevents publication tooling becoming available', () => {
  const f = fixture({ auditFails: true });
  assert.equal(f.result.status, 9, f.result.stderr);
  assert.equal(existsSync(f.envFile), false, 'do not expose tools after a rejected audit');
});

test('missing locks in the trusted workflow revision fail closed without legacy npx fallback', () => {
  const f = fixture({ missingTools: true });
  assert.notEqual(f.result.status, 0);
  assert.equal(existsSync(f.envFile), false);
  assert.equal(existsSync(f.calls), false, 'missing git blobs must stop before npm');
  assert.equal(readdirSync(f.repo).includes('node_modules'), false);
});
