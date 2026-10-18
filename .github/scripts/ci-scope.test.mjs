import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { classifyEntries, parseRawDiff, classifyRepository, gatePasses } from './ci-scope.mjs';

const entry = (path, overrides = {}) => ({ path, oldMode: '100644', newMode: '100644', status: 'M', ...overrides });

test('only explicit documentation paths qualify; mixed and unknown changes require UI', () => {
  for (const name of ['README.md', 'README-zh-CN.md', 'AGENTS.md', 'AGENTS.zh-CN.md',
    'CLAUDE.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LOCAL-DATA.zh-CN.md', 'ARCHITECTURE-zh-CN.md',
    'docs/guide.md']) assert.equal(classifyEntries([entry(name)]), false, name);
  for (const name of ['src/webview.ts', 'src/README.md', 'tests/ui/example.spec.mjs', 'package.json',
    'package-lock.json', '.github/workflows/test.yml', '.github/scripts/ci-scope.mjs',
    'images/card.png', 'docs/run.mjs', 'docs/fixture.json', 'out/extension.js', 'OTHER.md',
    'docs/../src/x.md', '/README.md', 'docs//guide.md', 'docs/a\nb.md', 'docs/a\\b.md']) {
    assert.equal(classifyEntries([entry(name)]), true, name);
    assert.equal(classifyEntries([entry('README.md'), entry(name)]), true, name);
  }
  assert.equal(classifyEntries([]), true);
  for (const mode of ['120000', '160000', '100755', 'garbage']) {
    assert.equal(classifyEntries([entry('README.md', { newMode: mode })]), true);
    assert.equal(classifyEntries([entry('README.md', { oldMode: mode })]), true);
  }
  assert.equal(classifyEntries([entry('README.md', { status: 'R100' })]), true);
  assert.equal(classifyEntries([entry('README.md', { oldMode: '000000', status: 'A' })]), false);
  assert.equal(classifyEntries([entry('README.md', { newMode: '000000', status: 'D' })]), false);
});

test('NUL raw parser rejects malformed records instead of treating them as documentation', () => {
  const sha = 'a'.repeat(40);
  const raw = `:100644 100644 ${sha} ${sha} M\0README.md\0`;
  assert.deepEqual(parseRawDiff(raw), [entry('README.md')]);
  for (const bad of ['', raw.slice(0, -1), `${raw}junk\0`,
    raw.replace(' M\0', ' R100\0'), raw.replace('README.md', ''), raw.replace(sha, 'z'.repeat(40))]) {
    assert.throws(() => parseRawDiff(bad));
  }
});

test('stable gate fails closed on every unrecognized, failed, cancelled or missing dependency', () => {
  const values = ['success', 'failure', 'cancelled', 'skipped', '', 'unknown'];
  for (const scope of values) for (const required of ['true', 'false', '', 'TRUE']) for (const shards of values) {
    assert.equal(gatePasses(scope, required, shards), scope === 'success' &&
      ((required === 'true' && shards === 'success') || (required === 'false' && shards === 'skipped')),
    `${scope}/${required}/${shards}`);
  }
});

test('real Git classification includes both renamed paths, modes and the actual checkout delta', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccu-ci-scope-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => { git('add', '-A'); git('-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const prRange = (base, sha) => ({ cwd: dir, eventName: 'pull_request', sha,
    event: { pull_request: { base: { sha: base }, head: { sha } } } });
  try {
    git('init', '-q');
    writeFileSync(path.join(dir, 'README.md'), 'initial\n');
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src/main.js'), 'initial\n');
    const base = commit();
    writeFileSync(path.join(dir, 'README.md'), 'changed\n');
    const docs = commit();
    const opts = { cwd: dir, eventName: 'push', event: { before: base, after: docs }, sha: docs };
    assert.equal(classifyRepository(opts).uiRequired, true,
      'a docs-only main push must not cancel and replace preceding runtime UI with a docs exemption');
    assert.equal(classifyRepository(prRange(base, docs)).uiRequired, false);
    assert.equal(classifyRepository({ ...opts, sha: base }).uiRequired, true, 'checkout SHA mismatch');
    git('mv', 'src/main.js', 'docs.md');
    const rename = commit();
    assert.equal(classifyRepository(prRange(docs, rename)).uiRequired, true);
    git('rm', 'README.md'); symlinkSync('docs.md', path.join(dir, 'README.md'));
    const link = commit();
    assert.equal(classifyRepository(prRange(rename, link)).uiRequired, true);
    // A newer tested checkout contains source changes even if an earlier PR head was docs-only.
    writeFileSync(path.join(dir, 'src/new.js'), 'runtime\n');
    const mixed = commit();
    assert.equal(classifyRepository({ ...opts, sha: mixed, eventName: 'pull_request', event: {
      pull_request: { base: { sha: base }, head: { sha: docs } },
    } }).uiRequired, true);
    for (const change of [{ eventName: 'workflow_dispatch' }, { event: {} }, { sha: 'bad' },
      { event: { before: '0'.repeat(40), after: mixed } }, { cwd: path.join(dir, 'missing') }]) {
      assert.equal(classifyRepository({ ...prRange(base, mixed), ...change }).uiRequired, true);
    }
    assert.equal(classifyRepository(prRange(mixed, mixed)).uiRequired, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gate CLI returns nonzero instead of swallowing missing dependencies', () => {
  const script = new URL('./ci-scope.mjs', import.meta.url);
  for (const [scope, required, shards, expected] of [
    ['success', 'false', 'skipped', 0], ['success', 'true', 'success', 0],
    ['success', 'true', 'skipped', 1], ['', 'false', 'skipped', 1], ['success', 'false', 'failure', 1],
  ]) {
    const child = spawnSync(process.execPath, [script.pathname, '--gate'], { encoding: 'utf8',
      env: { ...process.env, SCOPE_RESULT: scope, UI_REQUIRED: required, SHARDS_RESULT: shards } });
    assert.equal(child.status, expected);
  }
});
