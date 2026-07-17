import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CHECKOUT_SHA = 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5';

function read(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

test('runner attributes the tier whose reply becomes final and posts only commentBody', () => {
  const runner = read('.github/scripts/first-pass.mjs');
  assert.match(runner, /const TRANSPORT = 'anthropic-messages'/);
  assert.match(runner, /resolveGeneratorAttribution\(env\.CCU_BOT_GENERATOR, model, TRANSPORT\)/);
  assert.match(runner, /resolveGeneratorAttribution\(env\.CCU_BOT_GENERATOR_PRO, modelPro, TRANSPORT\)/);
  assert.match(runner, /parseFirstPassResponse/);
  assert.match(runner, /chooseFinalReply/);
  assert.match(runner, /formatAutomatedComment\(reply, \{ kind, generator: finalGenerator \}\)/);
  assert.match(runner, /JSON\.stringify\(\{\s*body:\s*commentBody\s*\}\)/);
  assert.doesNotMatch(runner, /JSON\.stringify\(\{\s*body:\s*reply\s*\}\)/);
  assert.doesNotMatch(runner, /CCU_BOT_TRANSPORT|prompt-injection safe|injection-safe/i);
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

test('automation hardening is appended to the one existing v2.2.1 section', () => {
  const changelog = read('CHANGELOG.md');
  assert.equal((changelog.match(/^## \[2\.2\.1\] — Unreleased$/gm) ?? []).length, 1);
  assert.match(changelog, /truthful per-tier provider attribution/);
  assert.match(changelog, /bounded base-repository file reads/);
});
