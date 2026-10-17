import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const json = (path) => JSON.parse(read(path));
const ownedWorkflows = ['test', 'claude', 'issue-first-pass', 'pr-first-pass', 'release-drafter'];
const pins = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'], // v7.0.1
  ['actions/setup-node', '949feb2413d6458794dcd2491c4babbbce0c15c1'], // v7.1.0
  ['anthropics/claude-code-action', 'f27be6b65a4652f08a2ba3cff79114829b588967'], // v1.0.252
  // v7 separates autolabeling; retain the compatible v6 release until migration.
  ['release-drafter/release-drafter', '6a93d829887aa2e0748befe2e808c66c0ec6e4c7'], // v6.4.0
]);
const workflow = (name) => read(`.github/workflows/${name}.yml`);
const active = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

// The repository uses block-style jobs/steps. Keep extraction dependency-free;
// missing or reformatted sections fail explicitly instead of passing vacuously.
function job(source, id) {
  const match = active(source).match(new RegExp(`^  ${id}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `missing job ${id}`);
  return match[1];
}

function steps(source) {
  return source.split(/^      - /m).slice(1);
}

function runStep(source, command) {
  const matches = steps(source).filter((step) => step.split('\n').some((line) =>
    line.trim().replace(/^run:\s*/, '') === command));
  assert.equal(matches.length, 1, `expected exactly one step running ${command}`);
  assert.doesNotMatch(matches[0], /^\s*(?:continue-on-error|if):/m, `${command} must be unconditional and fail closed`);
  return source.indexOf(matches[0]);
}

for (const name of ownedWorkflows) {
  test(`${name}: every action uses a reviewed immutable commit`, () => {
    const uses = [...active(workflow(name)).matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)[^\n]*$/gm)];
    assert.ok(uses.length > 0, `${name} must contain action steps`);
    for (const [, ref] of uses) {
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, `mutable action ref: ${ref}`);
      const [action, sha] = ref.split('@');
      assert.equal(sha, pins.get(action), `unreviewed action or pin: ${ref}`);
    }
  });
}

test('CI keeps the existing required checks and package dependencies', () => {
  const ci = workflow('test');
  assert.match(job(ci, 'test'), /^    name: Node Tests$/m);
  assert.match(job(ci, 'ui'), /^    name: UI Test$/m);
  assert.match(job(ci, 'package'), /^    name: Release Package$/m);
  assert.match(job(ci, 'package'), /^    needs: \[test, ui\]$/m);
  assert.match(job(ci, 'ui'), /^    needs: \[ui_shards\]$/m);
  assert.match(job(ci, 'ui'), /^    if: always\(\)$/m);
  assert.match(job(ci, 'ui'), /test '\$\{\{ needs\.ui_shards\.result \}\}' = 'success'/);
  assert.deepEqual([...active(ci).matchAll(/^  ([\w-]+):\n    name:/gm)].map((m) => m[1]),
    ['test', 'ui_shards', 'ui', 'package']);
});

test('Node 24 is primary and Node 22 retains the focused native Zstd guard', () => {
  const ci = workflow('test');
  for (const id of ['test', 'ui_shards', 'package']) {
    const block = job(ci, id);
    const versions = [...block.matchAll(/^\s+node-version: '([^']+)'$/gm)].map((m) => m[1]);
    assert.deepEqual(versions, id === 'test' ? ['24', '22'] : ['24'], `${id} Node versions`);
  }
  const block = job(ci, 'test');
  const testsAt = runStep(block, 'npm test');
  assert.ok(block.indexOf("node-version: '22'") > testsAt, 'run the full suite on Node 24 first');
  assert.match(block, /if \(!require\('\.\/out\/providers\/codex\/codexZstd'\)\.supportsCodexZstd\(\)\) throw new Error/);
  runStep(block, 'node --test out/test/codexZstd.test.js out/test/codexManifest.test.js out/test/codexCompressed*.test.js');
});

test('every root CI install uses its lock without lifecycle scripts', () => {
  const ci = workflow('test');
  for (const id of ['test', 'ui_shards', 'package']) {
    const block = job(ci, id);
    runStep(block, 'npm ci --ignore-scripts');
    assert.doesNotMatch(block, /\bnpm install\b/);
    for (const line of block.split('\n').filter((line) => /\bnpm ci\b/.test(line))) {
      assert.match(line, /--ignore-scripts(?:\s|$)/);
    }
  }
});

test('Node Tests audits both lock graphs at high severity and fails closed', () => {
  const block = job(workflow('test'), 'test');
  const rootInstall = runStep(block, 'npm ci --ignore-scripts');
  const toolInstall = runStep(block, 'npm ci --prefix .github/build-tools --ignore-scripts');
  const rootAudit = runStep(block, 'npm audit --audit-level=high --ignore-scripts');
  const toolAudit = runStep(block, 'npm audit --prefix .github/build-tools --audit-level=high --ignore-scripts');
  const testsAt = runStep(block, 'npm test');
  assert.ok(rootInstall < rootAudit && toolInstall < toolAudit, 'audit the installed lock graphs');
  assert.ok(rootAudit < testsAt && toolAudit < testsAt, 'audits are part of the existing Node Tests gate');
  assert.doesNotMatch(block, /^\s*continue-on-error:/m);
  assert.doesNotMatch(block, /--(?:omit[= ]dev|production)|\|\|\s*(?:true|:)/);
});

test('CI packages through the separately installed locked VSCE binary', () => {
  const block = job(workflow('test'), 'package');
  const installAt = runStep(block, 'npm ci --prefix .github/build-tools --ignore-scripts');
  const compileAt = runStep(block, 'npm run compile');
  const packageAt = runStep(block, '.github/build-tools/node_modules/.bin/vsce package --out /tmp/claude-code-usage-ci.vsix');
  const verifyAt = runStep(block, 'node .github/scripts/verify-vsix.mjs /tmp/claude-code-usage-ci.vsix');
  assert.ok(installAt < packageAt && compileAt < packageAt && packageAt < verifyAt);
  assert.doesNotMatch(active(workflow('test')), /\bnpx\b|\bnpm exec\b/);
});

test('packaging tools have a separate exact lock and no extension runtime dependencies', () => {
  const manifest = json('.github/build-tools/package.json');
  const lock = json('.github/build-tools/package-lock.json');
  assert.equal(manifest.private, true);
  for (const [name, version] of Object.entries({ '@vscode/vsce': '4.0.0', ovsx: '1.3.0' })) {
    assert.equal(manifest.dependencies?.[name] ?? manifest.devDependencies?.[name], version);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
    assert.match(lock.packages[`node_modules/${name}`].integrity, /^sha512-/);
  }
  const extension = json('package.json');
  assert.deepEqual(extension.dependencies ?? {}, {});
  assert.equal(extension.devDependencies['@vscode/vsce'], undefined);
  assert.equal(extension.devDependencies.ovsx, undefined);
});

test('canonical Playwright image matches the exact root package and lock', () => {
  const version = json('package.json').devDependencies['@playwright/test'];
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(json('package-lock.json').packages['node_modules/@playwright/test'].version, version);
  const block = job(workflow('test'), 'ui_shards');
  const image = block.match(/^\s+image: (\S+)$/m)?.[1];
  assert.equal(image?.split('@')[0], `mcr.microsoft.com/playwright:v${version}-noble`);
  assert.match(image, /@sha256:[a-f0-9]{64}$/, 'the canonical image must be immutable');
  assert.match(block, /^\s+PLAYWRIGHT_BROWSERS_PATH: \/ms-playwright$/m);
});

test('action updates preserve comment-only and maintainer security boundaries', () => {
  for (const name of ['issue-first-pass', 'pr-first-pass']) {
    const source = active(workflow(name));
    assert.match(source, /contents: read/);
    assert.doesNotMatch(source, /contents: write|allow-unsafe-pr-checkout|pull_request\.head|\bnpm (?:ci|install)\b/);
    assert.match(source, /vars\.AUTOMATION_ENABLED == 'true'/);
    assert.match(source, /user\.type != 'Bot'/);
    assert.match(source, /run: node \.github\/scripts\/first-pass\.mjs/);
  }
  const mention = active(workflow('claude'));
  assert.match(mention, /vars\.AUTOMATION_ENABLED == 'true'/);
  assert.equal((mention.match(/OWNER","MEMBER","COLLABORATOR/g) ?? []).length, 4);
  assert.match(mention, /claude_args: "--max-turns 12"/);
  assert.match(mention, /ANTHROPIC_BASE_URL: \$\{\{ vars\.ANTHROPIC_BASE_URL \}\}/);
  assert.match(mention, /anthropic_api_key: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  const drafter = active(workflow('release-drafter'));
  assert.match(drafter, /types: \[opened, reopened, synchronize, closed\]/);
  assert.match(drafter, /github\.event\.pull_request\.merged == true/);
  assert.doesNotMatch(drafter, /publish:\s*true|uses: actions\/checkout/);
});
