// Controlled first-pass reply for @ccu-bot — ONE model call, then post ONE
// comment. Deliberately NOT an autonomous agent: it uses no tools and never
// runs anything from the issue/PR, so a malicious public issue cannot steer it
// into misusing the token or leaking the key (prompt-injection safe). It only
// reads the project docs (+ PR diff), asks the model once, and comments.
//
// Env in: GH_TOKEN, REPO (owner/name), EVENT_KIND (issue|pr), ITEM_NUMBER,
// ITEM_TITLE, ITEM_BODY, DIFF_FILE (pr only), ANTHROPIC_API_KEY,
// ANTHROPIC_BASE_URL (third-party OK), CCU_BOT_MODEL.

import { readFileSync, existsSync } from 'node:fs';

const env = process.env;
const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const model = env.CCU_BOT_MODEL || 'deepseek-v4-flash';
const isPr = env.EVENT_KIND === 'pr';
const num = env.ITEM_NUMBER;

const readDoc = (path, max = 12000) => {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8').slice(0, max) : '';
  } catch {
    return '';
  }
};
const docs =
  `# ARCHITECTURE.md\n${readDoc('ARCHITECTURE.md')}\n\n` +
  `# CLAUDE.md\n${readDoc('CLAUDE.md')}\n\n` +
  `# CONTRIBUTING.md\n${readDoc('CONTRIBUTING.md')}`;
let diff = '';
if (isPr && env.DIFF_FILE) {
  diff = readDoc(env.DIFF_FILE, 40000);
}

const kind = isPr ? 'review' : 'reply';
const system = [
  'You are the ClaudeCodeUsage repository assistant, replying via Claude Code tooling.',
  'The underlying model may be a third-party Anthropic-format model, so do not claim to be Anthropic\'s Claude specifically.',
  `Write ONE concise, concrete first-pass ${kind} for the ${isPr ? 'pull request' : 'issue'} below.`,
  isPr
    ? '- Cover correctness risks, convention/i18n/CHANGELOG gaps, and merge-readiness, grounded in the diff + docs.'
    : '- Say what you understand the request to be, where in the architecture it relates, and a concrete suggested direction OR a specific clarifying question.',
  `- Answer ONLY from the provided project docs${isPr ? ' and diff' : ''}. If they are insufficient, say exactly what is unclear and ask a specific question — NEVER guess or invent facts about the code.`,
  '- Reply in the SAME language the author wrote in. Be specific and concise; no filler, no AI-flavoured padding.',
  `- Start the comment with: "🤖 Automated first-pass ${kind} (via Claude Code)".`,
  `- End with, on its own line: "_This is model-generated from the repository docs and the ${isPr ? 'PR diff' : 'issue'} — not a final decision. A maintainer reviews everything._"`,
].join('\n');

const userText = isPr
  ? `PR #${num}: ${env.ITEM_TITLE}\n\n${env.ITEM_BODY || '(no description)'}\n\n--- DIFF (truncated) ---\n${diff}\n\n--- PROJECT DOCS ---\n${docs}`
  : `Issue #${num}: ${env.ITEM_TITLE}\n\n${env.ITEM_BODY || '(no body)'}\n\n--- PROJECT DOCS ---\n${docs}`;

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// 1) One model call (Anthropic Messages format; works against a third-party
//    Anthropic-compatible endpoint via ANTHROPIC_BASE_URL).
let reply = '';
try {
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!res.ok) {
    fail(`Model API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();
  reply = (data.content || [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
} catch (e) {
  fail(`Model call failed: ${e.message}`);
}
if (!reply) {
  fail('Empty model reply.');
}

// 2) Post ONE comment via the GitHub API (issues + PRs share this endpoint).
const [owner, repo] = (env.REPO || '/').split('/');
try {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${num}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'ccu-bot',
    },
    body: JSON.stringify({ body: reply }),
  });
  if (!res.ok) {
    fail(`Comment post failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
} catch (e) {
  fail(`Comment post failed: ${e.message}`);
}
console.log(`Posted first-pass ${kind} on #${num}.`);
