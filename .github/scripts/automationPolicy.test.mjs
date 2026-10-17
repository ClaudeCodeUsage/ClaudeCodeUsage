import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CHECKOUT_SHA = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';

function read(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

test('runner attributes the selected tier and posts only the trusted comment body', () => {
  const runner = read('.github/scripts/first-pass.mjs');
  assert.match(runner, /const TRANSPORT = 'anthropic-messages'/);
  assert.match(runner, /resolveGeneratorAttribution\(env\.CCU_BOT_GENERATOR, model, TRANSPORT\)/);
  assert.match(runner, /resolveGeneratorAttribution\(env\.CCU_BOT_GENERATOR_PRO, modelPro, TRANSPORT\)/);
  assert.match(runner, /parseFirstPassResponse/);
  assert.match(runner, /resolveFirstPassCandidates/);
  assert.match(runner, /formatAutomatedComment\(selected\.reply, \{/);
  assert.match(runner, /generator: selected\.generator/);
  assert.match(runner, /JSON\.stringify\(\{\s*body:\s*commentBody\s*\}\)/);
  assert.doesNotMatch(runner, /JSON\.stringify\(\{\s*body:\s*reply\s*\}\)/);
  assert.doesNotMatch(runner, /CCU_BOT_TRANSPORT|prompt-injection safe|injection-safe/i);
});

test('issue and PR opened events both use the hardened shared runner', () => {
  const issue = read('.github/workflows/issue-first-pass.yml');
  const pr = read('.github/workflows/pr-first-pass.yml');
  assert.match(issue, /issues:\s*\n\s+types: \[opened\]/);
  assert.match(pr, /pull_request_target:\s*\n\s+types: \[opened\]/);
  for (const workflow of [issue, pr]) {
    assert.match(workflow, /run: node \.github\/scripts\/first-pass\.mjs/);
  }
});

test('runner uses one bounded reader for AGENTS grounding and requested source', () => {
  const runner = read('.github/scripts/first-pass.mjs');
  assert.match(runner, /# AGENTS\.md/);
  assert.equal((runner.match(/createRepoReadSession\(/g) ?? []).length, 1);
  assert.ok((runner.match(/repoReader\.read\(/g) ?? []).length >= 2);
  assert.doesNotMatch(runner, /const ALLOWED_EXT|const readRepoFiles/);
});

test('automatic first pass defaults to English and is bilingual only for Chinese authors', () => {
  const runner = read('.github/scripts/first-pass.mjs');
  assert.match(runner, /Reply in English by default/i);
  assert.match(runner, /author wrote in Chinese/i);
  assert.match(runner, /English first/i);
  assert.doesNotMatch(runner, /Reply in the same language as the author/i);
  assert.doesNotMatch(runner, /\*\*TL;DR \/ 结论\*\*/);
});

test('comment-only workflows configure cheap and pro independently', () => {
  for (const workflow of [
    read('.github/workflows/issue-first-pass.yml'),
    read('.github/workflows/pr-first-pass.yml'),
  ]) {
    assert.match(workflow, /CCU_BOT_GENERATOR:/);
    assert.match(workflow, /CCU_BOT_GENERATOR_PRO:/);
    assert.match(workflow, /contents: read/);
    assert.doesNotMatch(workflow, /contents: write/);
    assert.doesNotMatch(workflow, /CCU_BOT_TRANSPORT/);
    assert.match(workflow, new RegExp(CHECKOUT_SHA));
  }
});

test('PR diff is required and public text is not overclaimed as injection safe', () => {
  const pr = read('.github/workflows/pr-first-pass.yml');
  const issue = read('.github/workflows/issue-first-pass.yml');
  assert.match(pr, /gh pr diff[^\n]+> \/tmp\/pr\.diff\n\s+test -s \/tmp\/pr\.diff/);
  assert.doesNotMatch(pr, /\|\| true/);
  assert.doesNotMatch(`${pr}\n${issue}`, /prompt-injection safe|injection-safe/i);
});

test('manual publish retries require a release tag and can target one registry', () => {
  const workflow = read('.github/workflows/publish.yml');
  assert.match(workflow, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+tag:/);
  assert.match(workflow, /tag:\s*\n(?:\s+[^\n]+\n)*?\s+required: true/);
  assert.match(workflow, /description: Existing release tag to retry; it must pass the current package policy/);
  assert.doesNotMatch(workflow, /for example, v2\.2\.1/);
  assert.match(workflow, /RELEASE_TAG:.*github\.event\.release\.tag_name.*inputs\.tag/);
  assert.match(workflow, /uses: actions\/checkout@[a-f0-9]+[\s\S]*?ref: refs\/tags\/\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /git rev-parse "refs\/tags\/\$RELEASE_TAG\^\{commit\}"/);
  assert.match(workflow, /if: github\.event_name == 'release' \|\| inputs\.publish_vscode/);
  assert.match(workflow, /if: github\.event_name == 'release' \|\| inputs\.publish_open_vsx/);
  assert.match(workflow, /name: Verify release tag checkout[\s\S]*?Invalid release tag/);
  assert.match(
    workflow,
    /name: Checkout current release verification policy[\s\S]*?ref: \$\{\{ github\.workflow_sha \}\}[\s\S]*?path: \.release-policy[\s\S]*?sparse-checkout: \.github\/scripts[\s\S]*?persist-credentials: false/,
    'legacy release tags must use the current workflow verification policy',
  );
  assert.match(
    workflow,
    /node \.release-policy\/\.github\/scripts\/verify-vsix\.mjs claude-code-usage\.vsix "\$\{RELEASE_TAG#v\}"/,
  );
  assert.doesNotMatch(
    workflow,
    /run: node \.github\/scripts\/verify-vsix\.mjs claude-code-usage\.vsix/,
    'manual retries cannot depend on a verifier present in the historical tag',
  );
});

test('release delivery retries safely and does not let one registry block the other sinks', () => {
  const workflow = read('.github/workflows/publish.yml');
  const restoreAt = workflow.indexOf('name: Restore verified .vsix for a manual retry');
  const packageAt = workflow.indexOf('name: Package .vsix');
  const policyAt = workflow.indexOf('name: Checkout current release verification policy');
  const verifyAt = workflow.indexOf('name: Verify .vsix');
  const attachAt = workflow.indexOf('name: Attach .vsix to the GitHub Release');
  const vscodeAt = workflow.indexOf('name: Publish to VS Code Marketplace');
  const openVsxAt = workflow.indexOf('name: Publish to Open VSX Registry');
  const resultAt = workflow.indexOf('name: Verify release delivery outcomes');

  assert.ok(restoreAt >= 0 && verifyAt > restoreAt, 'manual retries must restore the canonical release asset first');
  assert.ok(
    packageAt >= 0 && policyAt > packageAt && verifyAt > policyAt,
    'verification policy must be checked out only after packaging and before verification',
  );
  assert.ok(attachAt > verifyAt, 'verified VSIX must be attached');
  assert.ok(vscodeAt > attachAt && openVsxAt > attachAt, 'release attachment must not depend on either registry');
  assert.ok(resultAt > vscodeAt && resultAt > openVsxAt, 'registry failures must be reconciled after both attempts');
  assert.match(workflow, /ASSET_NAME="\$\(gh release view "\$RELEASE_TAG" --json assets --jq/);
  assert.match(workflow, /if \[\[ "\$ASSET_NAME" == "claude-code-usage\.vsix" \]\]/);
  assert.match(workflow, /gh release download "\$RELEASE_TAG"[\s\S]*?claude-code-usage\.vsix/);
  assert.doesNotMatch(workflow, /if gh release download/);
  assert.equal((workflow.match(/steps\.restore_package\.outputs\.restored != 'true'/g) ?? []).length, 4);
  assert.match(workflow, /tag_name: \$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(workflow, /\/\.bin\/vsce" publish[\s\S]*?--skip-duplicate/);
  assert.match(workflow, /\/\.bin\/ovsx" publish[\s\S]*?--skip-duplicate/);
  assert.equal((workflow.match(/continue-on-error: true/g) ?? []).length, 3);
  assert.equal((workflow.match(/for attempt in 1 2 3/g) ?? []).length, 2);
  assert.equal((workflow.match(/timeout-minutes: 12/g) ?? []).length, 2);
});

test('Marketplace recovery reconciles the newest stable release without rebuilding it', () => {
  const publish = read('.github/workflows/publish.yml');
  const recovery = read('.github/workflows/marketplace-recovery.yml');

  assert.match(publish, /concurrency:\s*\n\s+group: extension-registry-delivery/);
  assert.match(recovery, /schedule:[\s\S]*?- cron: '37 \* \* \* \*'/);
  assert.match(recovery, /workflow_dispatch:/);
  assert.match(recovery, /permissions:\s*\n\s+contents: read/);
  assert.match(recovery, /concurrency:\s*\n\s+group: extension-registry-delivery/);
  assert.match(recovery, /releases\/latest/);
  assert.match(recovery, /gh release download[\s\S]*?claude-code-usage\.vsix/);
  assert.match(recovery, /verify-vsix\.mjs[\s\S]*?steps\.release\.outputs\.version/);
  assert.doesNotMatch(recovery, /npm run compile|\/\.bin\/vsce package/);
  assert.match(recovery, /npm ci --prefix \.github\/build-tools --ignore-scripts/);
  assert.match(recovery, /\/\.bin\/vsce show GrowthJack\.claude-code-usage --json/);
  assert.match(recovery, /Microsoft\.VisualStudio\.Services\.VsixSha256/);
  assert.match(recovery, /sha256sum claude-code-usage\.vsix/);
  assert.match(recovery, /steps\.probe\.outputs\.needed == 'true'/);
  assert.match(recovery, /\/\.bin\/vsce publish[\s\S]*?--skip-duplicate/);
  assert.match(recovery, /continue-on-error: true/);
  assert.match(recovery, /recovery will retry next hour/i);
});

function releaseRouting(source) {
  const workflow = source.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  assert.match(workflow, /^on:\n  push:\n    branches: \[main\]\n  pull_request_target:\n    branches: \[main\]\n    types: \[opened, reopened, synchronize, edited, closed\]\n\npermissions:/m);
  return ['autolabel', 'update_release_draft'].map(id => {
    const expression = workflow.match(new RegExp(`^  ${id}:\\n    if: >-\\n((?:      [^\\n]+\\n)+)`, 'm'))?.[1];
    assert.ok(expression, `missing condition for ${id}`);
    // Only this workflow's boolean/equality subset is evaluated, not arbitrary
    // Actions expressions. Fixtures use strings/booleans, avoiding coercion differences.
    const remainder = expression.replace(/github\.(?:event_name|ref|event\.action|event\.pull_request\.(?:merged|base\.ref))\b/g, '')
      .replace(/'[^'\n]*'|\btrue\b|\bfalse\b|==|!=|&&|\|\||[\s()]/g, '');
    assert.equal(remainder, '', 'unsupported condition syntax');
    return github => runInNewContext(expression, { github }, { timeout: 100 });
  });
}

function assertReleaseRouting(source) {
  const conditions = releaseRouting(source);
  const check = (event_name, action, merged, base, ref, expected) => {
    const github = { event_name, ref, event: { action, pull_request: { merged, base: { ref: base } } } };
    assert.deepEqual(conditions.map(condition => condition(github)), expected,
      `${event_name}/${action}/${merged}/${base}/${ref}`);
  };
  check('push', '', false, '', 'refs/heads/main', [false, true]);
  check('push', '', false, '', 'refs/heads/feature', [false, false]);
  check('push', '', false, '', 'refs/tags/v1.0.0', [false, false]);
  for (const event of ['pull_request_target', 'pull_request', 'workflow_dispatch']) {
    for (const base of ['main', 'feature']) {
      for (const action of ['opened', 'reopened', 'synchronize', 'edited', 'labeled', 'closed']) {
        for (const merged of [false, true]) {
          const allowed = event === 'pull_request_target' && base === 'main';
          check(event, action, merged, base, 'refs/heads/main', [
            allowed && ['opened', 'reopened', 'synchronize', 'edited'].includes(action),
            allowed && action === 'closed' && merged,
          ]);
        }
      }
    }
  }
  // Real push payloads do not contain a pull_request; conditions must short-circuit.
  assert.deepEqual(conditions.map(condition => condition({ event_name: 'push', ref: 'refs/heads/main', event: {} })), [false, true]);
}

test('v7 labels only active main-target PR events and drafts only main pushes or merged closures', () => {
  assertReleaseRouting(read('.github/workflows/release-drafter.yml'));
});

test('release routing rejects unmerged closure, wrong-target and broad-event regressions', () => {
  const source = read('.github/workflows/release-drafter.yml');
  for (const [before, after] of [
    ['github.event.pull_request.merged == true', 'true'],
    ["github.event.pull_request.base.ref == 'main'", 'true'],
    ["github.event.action == 'opened'", 'true'],
    ["github.ref == 'refs/heads/main'", 'true'],
  ]) {
    assert.ok(source.includes(before), `mutation anchor: ${before}`);
    assert.throws(() => assertReleaseRouting(source.replaceAll(before, after)), { code: 'ERR_ASSERTION' });
  }
});

test('maintainer-only mention workflow retains its privileged Claude boundary', () => {
  const privileged = read('.github/workflows/claude.yml');
  assert.match(privileged, /contents: write/);
  assert.match(privileged, /anthropics\/claude-code-action@[a-f0-9]{40}/);
  assert.match(privileged, /OWNER","MEMBER","COLLABORATOR/);
});

test('CONTRIBUTING distinguishes current automatic, reviewed Codex, and privileged agent text', () => {
  const contributing = read('CONTRIBUTING.md');
  assert.match(contributing, /### Controlled automatic first pass/);
  assert.match(contributing, /DeepSeek or Claude/);
  assert.match(contributing, /Codex automatic attribution is not enabled in v2\.2\.1/);
  assert.match(contributing, /Generated with \[OpenAI Codex\]/);
  assert.match(contributing, /### Maintainer-only mention agent/);
  assert.match(contributing, /does not migrate this privileged workflow to Codex/);
});

test('released v2.2.1 retains its automation hardening notes in one section', () => {
  const changelog = read('CHANGELOG.md');
  assert.equal((changelog.match(/^## \[2\.2\.1\] — 2026-07-18$/gm) ?? []).length, 1);
  assert.match(changelog, /truthful per-tier provider attribution/);
  assert.match(changelog, /bounded base-repository file reads/);
});
