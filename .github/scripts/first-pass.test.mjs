import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createRepoReadSession,
  chooseFinalReply,
  formatFirstPassFallback,
  formatAutomatedComment,
  hasTrustedFirstPass,
  isAllowedRepoPath,
  needsProFirstPass,
  parseFirstPassResponse,
  resolveFirstPassCandidates,
  resolveGeneratorAttribution,
  validateFirstPassEnvironment,
} from './first-pass-lib.mjs';

const ANTHROPIC_MESSAGES = 'anthropic-messages';
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

async function runFallbackScenario(eventKind) {
  const postedComments = [];
  let modelCalls = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/messages') {
      modelCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ content: [] }));
      return;
    }
    if (request.method === 'GET' && request.url?.endsWith('/comments?per_page=100')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('[]');
      return;
    }
    if (request.method === 'POST' && request.url?.endsWith('/comments')) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      postedComments.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).body);
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'ccu-first-pass-'));
  const diffFile = join(fixtureRoot, 'pr.diff');
  writeFileSync(diffFile, 'diff --git a/src/a.ts b/src/a.ts\n+export const value = 1;\n', 'utf8');

  try {
    const child = spawn(process.execPath, ['.github/scripts/first-pass.mjs'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        GH_TOKEN: 'test-github-token',
        GITHUB_API_URL: apiUrl,
        REPO: 'ClaudeCodeUsage/ClaudeCodeUsage',
        EVENT_KIND: eventKind,
        ITEM_NUMBER: eventKind === 'issue' ? '87' : '88',
        ITEM_TITLE: eventKind === 'issue' ? 'High CPU usage' : 'Reduce background work',
        ITEM_BODY: 'Reproduction details and tests are included.',
        DIFF_FILE: eventKind === 'pr' ? diffFile : '',
        ANTHROPIC_API_KEY: 'test-model-key',
        ANTHROPIC_BASE_URL: apiUrl,
        CCU_BOT_MODEL: 'deepseek-v4-flash',
        CCU_BOT_MODEL_PRO: 'deepseek-v4-pro',
        CCU_BOT_GENERATOR: 'deepseek',
        CCU_BOT_GENERATOR_PRO: 'deepseek',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exitCode = await new Promise((accept) => child.on('close', accept));
    return { exitCode, modelCalls, postedComments, stdout, stderr };
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    await new Promise((accept) => server.close(accept));
  }
}

test('shared runner posts a deterministic fallback for issue and PR model failures', async () => {
  for (const eventKind of ['issue', 'pr']) {
    const result = await runFallbackScenario(eventKind);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.modelCalls, 2);
    assert.equal(result.postedComments.length, 1);
    assert.match(
      result.postedComments[0],
      new RegExp(`^🤖 Automated first-pass ${eventKind === 'issue' ? 'reply' : 'review'}`),
    );
    assert.match(result.postedComments[0], /not a maintainer decision/);
  }
});

test('empty cheap replies escalate even when the control says answerable', () => {
  assert.equal(needsProFirstPass({ answerable: true, reply: '' }), true);
  assert.equal(needsProFirstPass({ answerable: true, reply: 'usable' }), false);
  assert.equal(needsProFirstPass({ answerable: false, reply: 'needs source' }), true);
});

test('static fallback is honest, English-first, and names no model provider', () => {
  const english = formatFirstPassFallback({ kind: 'reply', isChinese: false });
  assert.match(english, /Automated first-pass reply/);
  assert.match(english, /did not return a usable analysis/);
  assert.match(english, /Posted automatically by CCU Bot/);
  assert.doesNotMatch(english, /DeepSeek|Claude|OpenAI Codex|Generated (?:with|by)/);

  const bilingual = formatFirstPassFallback({ kind: 'reply', isChinese: true });
  assert.ok(bilingual.indexOf('did not return a usable analysis') < bilingual.indexOf('自动分析服务'));
});

test('only a trusted GitHub Actions author and wrapper marker suppress a duplicate', () => {
  const trustedBody = '🤖 Automated first-pass reply\n\nUseful body';
  assert.equal(hasTrustedFirstPass([
    { user: { login: 'github-actions[bot]' }, body: trustedBody },
  ], 'reply'), true);
  assert.equal(hasTrustedFirstPass([
    { user: { login: 'someone' }, body: trustedBody },
  ], 'reply'), false);
  assert.equal(hasTrustedFirstPass([
    { user: { login: 'github-actions[bot]' }, body: 'ordinary comment' },
  ], 'reply'), false);
});

test('candidate resolution calls the pro tier when the cheap reply is empty', async () => {
  const cheapGenerator = { id: 'cheap' };
  const proGenerator = { id: 'pro' };
  let proCalls = 0;
  const selected = await resolveFirstPassCandidates({
    cheap: async () => ({ reply: '', answerable: true, generator: cheapGenerator }),
    pro: async () => {
      proCalls += 1;
      return { reply: 'grounded pro reply', answerable: true, generator: proGenerator };
    },
  });
  assert.equal(proCalls, 1);
  assert.deepEqual(selected, { reply: 'grounded pro reply', generator: proGenerator });
});

test('candidate resolution returns null instead of throwing when both tiers fail', async () => {
  let proCalls = 0;
  const selected = await resolveFirstPassCandidates({
    cheap: async () => { throw new Error('temporary cheap failure'); },
    pro: async () => {
      proCalls += 1;
      return { reply: '', answerable: true, generator: { id: 'pro' } };
    },
  });
  assert.equal(proCalls, 1);
  assert.equal(selected, null);
});

test('current transport truthfully supports DeepSeek and Claude per tier', () => {
  const cheap = resolveGeneratorAttribution(undefined, 'deepseek-v4-flash', ANTHROPIC_MESSAGES);
  const pro = resolveGeneratorAttribution('claude', 'claude-sonnet-4-5', ANTHROPIC_MESSAGES);
  assert.equal(cheap.id, 'deepseek');
  assert.equal(pro.id, 'claude');

  assert.match(
    formatAutomatedComment('cheap body', { kind: 'reply', generator: cheap }),
    /Generated by \[DeepSeek\]\(https:\/\/www\.deepseek\.com\/\)/,
  );
  assert.match(
    formatAutomatedComment('pro body', { kind: 'review', generator: pro }),
    /Generated by \[Claude\]\(https:\/\/www\.anthropic\.com\/claude\)/,
  );
});

test('a configured provider must match that tier model', () => {
  assert.throws(
    () => resolveGeneratorAttribution('deepseek', 'claude-sonnet-4-5', ANTHROPIC_MESSAGES),
    /does not match configured generator deepseek/,
  );
  assert.throws(
    () => resolveGeneratorAttribution(undefined, 'third-party-mystery-model', ANTHROPIC_MESSAGES),
    /Cannot infer generator/,
  );
});

test('Codex automatic attribution fails closed on the current transport', () => {
  assert.throws(
    () => resolveGeneratorAttribution('codex', 'gpt-5.3-codex', ANTHROPIC_MESSAGES),
    /requires transport openai-responses-codex/,
  );
});

test('future Codex attribution requires its trusted transport contract', () => {
  const future = resolveGeneratorAttribution(
    'codex',
    'gpt-5.3-codex',
    'openai-responses-codex',
  );
  assert.equal(future.id, 'codex');
  assert.match(future.automaticFooter, /Generated by \[OpenAI Codex\]/);
});

test('trusted wrapper strips spoofed markdown variants and appends one exact suffix', () => {
  const generator = resolveGeneratorAttribution(undefined, 'deepseek-v4-flash', ANTHROPIC_MESSAGES);
  const untrusted = [
    '> 🤖 AUTOMATED FIRST-PASS REVIEW (via Claude Code)',
    '',
    'Useful body',
    '',
    '- 🤖 Generated with [OpenAI Codex](https://evil.invalid/codex)',
    '```md',
    '🤖 generated BY DeepSeek as an automated first pass',
    '```',
    '1. This is model-generated — not a maintainer decision.',
  ].join('\n');
  const comment = formatAutomatedComment(untrusted, { kind: 'review', generator });
  const suffix = [
    '---',
    '🤖 Generated by [DeepSeek](https://www.deepseek.com/) as an automated first pass — not a maintainer decision.',
  ].join('\n');

  assert.match(comment, /Useful body/);
  assert.equal(comment.endsWith(suffix), true);
  assert.equal((comment.match(/Generated\s+(?:with|by)/giu) ?? []).length, 1);
  assert.equal((comment.match(/Automated first-pass review/giu) ?? []).length, 1);
  assert.doesNotMatch(comment, /evil\.invalid|Claude Code|OpenAI Codex/iu);
});

test('preflight rejects missing credentials and ungrounded PRs', () => {
  const base = {
    GH_TOKEN: 'github-token', REPO: 'ClaudeCodeUsage/ClaudeCodeUsage',
    EVENT_KIND: 'issue', ITEM_NUMBER: '70', ANTHROPIC_API_KEY: 'model-key',
  };
  assert.equal(validateFirstPassEnvironment(base).isPr, false);
  assert.throws(
    () => validateFirstPassEnvironment({ ...base, ANTHROPIC_API_KEY: '' }),
    /Missing required environment variables: ANTHROPIC_API_KEY/,
  );
  assert.throws(
    () => validateFirstPassEnvironment({ ...base, EVENT_KIND: 'pr' }),
    /DIFF_FILE is required for pull requests/,
  );
});

test('only explicit root docs/config and src are readable', () => {
  for (const allowed of [
    'AGENTS.md', 'ARCHITECTURE.md', 'CLAUDE.md', 'CONTRIBUTING.md',
    'CHANGELOG.md', 'package.json', 'tsconfig.json', 'src/dataLoader.ts',
  ]) assert.equal(isAllowedRepoPath(allowed), true, allowed);

  for (const denied of [
    '../outside.md', '/etc/passwd', 'C:\\Users\\person\\auth.json',
    '.env', '.env.local', '.github/workflows/publish.yml',
    '.claude/.credentials.json', 'docs/private.md', 'test/fixture.json',
    'src/.env.production', 'src/nested/oauth.json',
    'src/nested/credentials.json', 'src/nested/secrets.json',
    'src/nested/private.pem', 'src/nested/token.txt', 'src/code.bin',
  ]) assert.equal(isAllowedRepoPath(denied), false, denied);
});

test('repo reader shares stable-dedup, byte budgets and symlink denial for the run', (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ccu-reader-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'ccu-reader-outside-'));
  t.after(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  });

  mkdirSync(join(repoRoot, 'src', 'real-dir'), { recursive: true });
  for (const name of ['AGENTS.md', 'ARCHITECTURE.md', 'CLAUDE.md', 'CONTRIBUTING.md']) {
    writeFileSync(join(repoRoot, name), `${name}\n`, 'utf8');
  }
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    writeFileSync(join(repoRoot, 'src', `${name}.txt`), `${name}-body\n`, 'utf8');
  }
  writeFileSync(join(repoRoot, 'src', 'huge.txt'), 'x'.repeat(20_000), 'utf8');
  writeFileSync(join(repoRoot, 'src', 'unicode.txt'), '中文🙂'.repeat(8_000), 'utf8');
  writeFileSync(join(repoRoot, 'src', 'real-dir', 'inside.txt'), 'inside regular', 'utf8');
  writeFileSync(join(outsideRoot, 'secret.txt'), 'outside secret', 'utf8');
  symlinkSync(join(outsideRoot, 'secret.txt'), join(repoRoot, 'src', 'link.txt'));
  symlinkSync(outsideRoot, join(repoRoot, 'src', 'external-dir'));
  symlinkSync(join(repoRoot, 'src', 'real-dir'), join(repoRoot, 'src', 'internal-link'));

  const ordering = createRepoReadSession({ repoRoot });
  const ordered = ordering.read([
    'src/a.txt', 'src/a.txt', 'src/b.txt', 'src/c.txt', 'src/d.txt',
    'src/e.txt', 'src/f.txt', 'src/g.txt', 'src/link.txt',
  ]);
  assert.deepEqual(
    ordered.files.map((file) => file.path),
    ['src/a.txt', 'src/b.txt', 'src/c.txt', 'src/d.txt', 'src/e.txt', 'src/f.txt'],
  );

  const capped = createRepoReadSession({ repoRoot });
  const result = capped.read([
    'src/huge.txt', 'src/unicode.txt', 'src/a.txt', 'src/b.txt',
    'src/c.txt', 'src/d.txt', 'src/link.txt',
    'src/external-dir/secret.txt', 'src/internal-link/inside.txt',
    'src/nested/oauth.json', '../outside.md',
  ]);
  assert.ok(result.files.every((file) => file.bytes <= 16_000));
  assert.ok(result.totalBytes <= 60_000);
  assert.equal(result.files.find((file) => file.path === 'src/huge.txt')?.bytes, 16_000);
  assert.equal(result.files.some((file) => file.text.endsWith('\uFFFD')), false);
  assert.equal(result.text.includes('outside secret'), false);
  assert.equal(result.files.some((file) => /link|oauth|outside/.test(file.path)), false);

  const perRun = createRepoReadSession({ repoRoot });
  const grounding = perRun.read(['AGENTS.md', 'ARCHITECTURE.md', 'CLAUDE.md', 'CONTRIBUTING.md']);
  const requested = perRun.read([
    'AGENTS.md',
    'src/a.txt', 'src/b.txt', 'src/c.txt', 'src/d.txt', 'src/e.txt', 'src/f.txt',
  ]);
  assert.equal(grounding.files.length, 4);
  assert.ok(requested.files.length <= 2);
  assert.ok(perRun.snapshot().filesRead <= 6);
  assert.ok(perRun.snapshot().totalBytes <= 60_000);
});

test('empty tagged pro reply preserves the cheap body and attribution', () => {
  const cheap = resolveGeneratorAttribution('deepseek', 'deepseek-v4-flash', 'anthropic-messages');
  const pro = resolveGeneratorAttribution('claude', 'claude-sonnet-4-6', 'anthropic-messages');
  const parsedPro = parseFirstPassResponse('<control>{"answerable":true}</control><reply>   </reply>');
  assert.equal(parsedPro.reply, '');
  const selected = chooseFinalReply({ reply: 'cheap body', generator: cheap }, {
    reply: parsedPro.reply,
    generator: pro,
  });
  assert.equal(selected.reply, 'cheap body');
  assert.equal(selected.generator.id, 'deepseek');
});

test('no non-empty tier can never reach the GitHub formatter', () => {
  const cheap = resolveGeneratorAttribution('deepseek', 'deepseek-v4-flash', 'anthropic-messages');
  assert.throws(
    () => chooseFinalReply({ reply: '  ', generator: cheap }),
    /No non-empty model reply/,
  );
});
