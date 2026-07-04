// Controlled first-pass reply for issues / PRs — still NOT an autonomous agent.
// It uses no agent tools and never runs anything from the issue/PR, so a
// malicious public issue cannot steer it into misusing the token or leaking the
// key (prompt-injection safe). Flow:
//
//   Tier 1  cheap model (CCU_BOT_MODEL, default deepseek-v4-flash) answers from
//           the project docs (+ PR diff). It also returns a <control> signal.
//   Tier 2  if it says it can't answer from the docs, escalate to a stronger
//           model (CCU_BOT_MODEL_PRO, default deepseek-v4-pro) with thinking on,
//           and let it name a few repo source files — WHICH THE SCRIPT reads and
//           validates (no tool call, no traversal, size-capped). It re-answers.
//   Tier 3  if it still can't, its reply politely asks for the missing info /
//           logs and (when fields are missing) suggests the issue template.
//
// Then post ONE comment. The model only ever READS repo-relative text files the
// script hand-picks; it never executes anything.
//
// Env in: GH_TOKEN, REPO (owner/name), EVENT_KIND (issue|pr), ITEM_NUMBER,
// ITEM_TITLE, ITEM_BODY, DIFF_FILE (pr only), ANTHROPIC_API_KEY,
// ANTHROPIC_BASE_URL (third-party OK), CCU_BOT_MODEL, CCU_BOT_MODEL_PRO.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const env = process.env;
const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const model = env.CCU_BOT_MODEL || 'deepseek-v4-flash';
const modelPro = env.CCU_BOT_MODEL_PRO || 'deepseek-v4-pro';
const isPr = env.EVENT_KIND === 'pr';
const num = env.ITEM_NUMBER;
const kind = isPr ? 'review' : 'reply';

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

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

// --- Safe repo-file reader: only repo-relative text files, no traversal ------
const REPO_ROOT = resolve(process.cwd());
const ALLOWED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|txt)$/i;
const readRepoFiles = (wanted) => {
  const out = [];
  let budget = 60000; // total bytes across all requested files
  for (const raw of (wanted || []).slice(0, 6)) {
    const rel = String(raw || '').trim().replace(/^\.?\//, '');
    if (!rel || rel.includes('..') || rel.includes('\0') || !ALLOWED_EXT.test(rel)) {
      continue;
    }
    const abs = resolve(REPO_ROOT, rel);
    if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + sep)) {
      continue; // escaped the repo root
    }
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        continue;
      }
      const body = readFileSync(abs, 'utf8').slice(0, Math.min(16000, budget));
      budget -= body.length;
      out.push(`# ${rel}\n${body}`);
      if (budget <= 0) {
        break;
      }
    } catch {
      /* skip unreadable */
    }
  }
  return out.join('\n\n');
};

// --- System prompt -----------------------------------------------------------
const buildSystem = (final) =>
  [
    'You are the ClaudeCodeUsage repository assistant, replying via Claude Code tooling.',
    "The underlying model may be a third-party Anthropic-format model, so do not claim to be Anthropic's Claude specifically.",
    `Write ONE concise, concrete first-pass ${kind} for the ${isPr ? 'pull request' : 'issue'} below.`,
    isPr
      ? '- Focus on correctness risks, convention/i18n/CHANGELOG gaps, and merge-readiness, grounded in the diff + docs.'
      : '- Identify the request, where in the architecture it relates, and a concrete direction or a specific clarifying question.',
    '- Answer ONLY from the provided material (docs, diff, and any source files supplied). NEVER guess or invent code facts.',
    '- Reply in the SAME language the author wrote in. Be specific; no filler, no AI-flavoured padding.',
    '',
    'Format your reply markdown in this order so a human can skim it:',
    `- First line: "🤖 Automated first-pass ${kind} (via Claude Code)".`,
    '- Then **TL;DR / 结论**: one or two sentences — the answer or the current status.',
    '- Then **分析 / Analysis**: briefly why / what is happening / where it sits.',
    '- Then **建议 / Suggested next step(s)**: a concrete direction, a specific question, or exactly what info is needed.',
    `- Last line, on its own: "_This is model-generated from the repository docs and the ${isPr ? 'PR diff' : 'issue'} — not a final decision. A maintainer reviews everything._"`,
    '',
    final
      ? '- If you STILL cannot determine the answer from everything provided, say so plainly in the TL;DR, then ask for the specific missing information (repro steps, logs, versions, config). If the issue omits obvious details, politely suggest filling out the issue template next time.'
      : '- If the docs/diff are insufficient, you may request source files (see the control block); do not pad the answer with guesses.',
    '',
    'Before the reply, emit exactly one control line and nothing before it:',
    '<control>{"answerable": <true if you can answer concretely from the material provided, false if you need to see source code>, "want_files": [<up to 6 repo-relative source paths that would let you answer>]}</control>',
    'Then the reply, wrapped as:',
    '<reply>',
    '...markdown reply...',
    '</reply>',
  ].join('\n');

const buildUser = (extraFiles) =>
  (isPr
    ? `PR #${num}: ${env.ITEM_TITLE}\n\n${env.ITEM_BODY || '(no description)'}\n\n--- DIFF (truncated) ---\n${diff}`
    : `Issue #${num}: ${env.ITEM_TITLE}\n\n${env.ITEM_BODY || '(no body)'}`) +
  `\n\n--- PROJECT DOCS ---\n${docs}` +
  (extraFiles ? `\n\n--- REPO SOURCE FILES (read-only) ---\n${extraFiles}` : '');

// --- One model call (Anthropic Messages format; third-party-compatible) ------
const askModel = async (useModel, system, userText, think) => {
  const body = {
    model: useModel,
    max_tokens: 1400,
    system,
    messages: [{ role: 'user', content: userText }],
  };
  if (think) {
    body.thinking = { type: 'enabled', budget_tokens: 6000 };
  }
  let res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok && think) {
    // Endpoint may not accept the thinking param — retry once without it.
    const errTxt = await res.text();
    if (/think|budget|adaptive|reason/i.test(errTxt)) {
      delete body.thinking;
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } else {
      fail(`Model API error ${res.status}: ${errTxt.slice(0, 500)}`);
    }
  }
  if (!res.ok) {
    fail(`Model API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
};

const tag = (text, name) => {
  const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1].trim() : null;
};
const parse = (raw) => {
  const replyBody = tag(raw, 'reply') || raw.replace(/<control>[\s\S]*?<\/control>/i, '').trim();
  let control = { answerable: true, want_files: [] };
  const ctl = tag(raw, 'control');
  if (ctl) {
    try {
      const j = JSON.parse(ctl);
      control = {
        answerable: j.answerable !== false,
        want_files: Array.isArray(j.want_files) ? j.want_files : [],
      };
    } catch {
      /* keep default (treat as answerable → no escalation) */
    }
  }
  return { reply: replyBody, ...control };
};

let reply = '';
try {
  // Tier 1: cheap model, docs only.
  const first = parse(await askModel(model, buildSystem(false), buildUser('')));
  reply = first.reply;

  // Tier 2/3: escalate to the stronger model with thinking + the source files
  // it named (read & validated by the script), and take its final reply.
  if (!first.answerable) {
    const extra = readRepoFiles(first.want_files);
    const second = parse(await askModel(modelPro, buildSystem(true), buildUser(extra), true));
    if (second.reply) {
      reply = second.reply;
    }
  }
} catch (e) {
  fail(`Model call failed: ${e.message}`);
}
if (!reply) {
  // A blank reply is a soft no-op, not a failure: posting nothing is fine, and
  // we don't want a red ✗ check on the PR/issue just because the model returned
  // no text (e.g. a huge or self-referential diff).
  console.warn('Empty model reply — nothing to post.');
  process.exit(0);
}

// Post ONE comment via the GitHub API (issues + PRs share this endpoint).
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
