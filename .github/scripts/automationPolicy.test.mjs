import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CHECKOUT_SHA = 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5';

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
  assert.match(workflow, /@vscode\/vsce@3\.9\.2 publish[\s\S]*?--skip-duplicate/);
  assert.match(workflow, /ovsx@1\.2\.0 publish[\s\S]*?--skip-duplicate/);
  assert.equal((workflow.match(/continue-on-error: true/g) ?? []).length, 3);
  assert.equal((workflow.match(/for attempt in 1 2 3/g) ?? []).length, 2);
  assert.equal((workflow.match(/timeout-minutes: 12/g) ?? []).length, 2);
});

test('release draft gets a post-merge reconciliation pass', () => {
  const workflow = read('.github/workflows/release-drafter.yml');
  assert.match(
    workflow,
    /pull_request_target:\s*\n\s+types: \[[^\]]*closed[^\]]*\]/,
    'the merge-complete event must refresh the draft after the main push race',
  );
  assert.match(
    workflow,
    /if: >-\s*\n\s+github\.event_name != 'pull_request_target' \|\|\s*\n\s+github\.event\.action != 'closed' \|\|\s*\n\s+github\.event\.pull_request\.merged == true/,
    'closing an unmerged PR must not rewrite the release draft',
  );
});

test('maintainer-only mention workflow retains its privileged Claude boundary', () => {
  const privileged = read('.github/workflows/claude.yml');
  assert.match(privileged, /contents: write/);
  assert.match(privileged, /anthropics\/claude-code-action@v1/);
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
