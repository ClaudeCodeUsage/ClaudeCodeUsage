// Controlled, comment-only first pass for new issues and external pull requests.
// Public text remains untrusted: this fixed runner has no agent tools, executes
// no contributor code, reads only validated base-repository text, and posts at
// most one comment. Model output can still be wrong and is never authoritative.

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
  createRepoReadSession,
  formatAutomatedComment,
  formatFirstPassFallback,
  hasTrustedFirstPass,
  parseFirstPassResponse,
  resolveFirstPassCandidates,
  resolveGeneratorAttribution,
  validateFirstPassEnvironment,
} from './first-pass-lib.mjs';

const TRANSPORT = 'anthropic-messages';
const REPO_ROOT = resolve(process.cwd());
const env = process.env;
const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const githubApi = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const model = env.CCU_BOT_MODEL || 'deepseek-v4-flash';
const modelPro = env.CCU_BOT_MODEL_PRO || 'deepseek-v4-pro';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let preflight;
let cheapGenerator;
let proGenerator;
try {
  preflight = validateFirstPassEnvironment(env);
  cheapGenerator = resolveGeneratorAttribution(env.CCU_BOT_GENERATOR, model, TRANSPORT);
  proGenerator = resolveGeneratorAttribution(env.CCU_BOT_GENERATOR_PRO, modelPro, TRANSPORT);
} catch (error) {
  fail(`Invalid first-pass configuration: ${error.message}`);
}

const { isPr, itemNumber: num, owner, repo } = preflight;
const kind = isPr ? 'review' : 'reply';
const repoReader = createRepoReadSession({ repoRoot: REPO_ROOT });
const docs = repoReader.read([
  'AGENTS.md', // rendered in the prompt as "# AGENTS.md"
  'ARCHITECTURE.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
]).text;

function readBoundedFixedFile(path, maxBytes) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (!fstatSync(descriptor).isFile()) return '';
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(descriptor, buffer, 0, maxBytes, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let end = bytes.length; end >= Math.max(0, bytes.length - 4); end -= 1) {
      try {
        return decoder.decode(bytes.subarray(0, end));
      } catch {
        // Backtrack if the byte cap split the final UTF-8 code point.
      }
    }
    return '';
  } catch {
    return '';
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The caller fails closed on an empty result.
      }
    }
  }
}

let diff = '';
if (isPr) {
  diff = readBoundedFixedFile(preflight.diffFile, 40_000).trim();
  if (!diff) fail('Pull request diff is missing or empty');
}

const buildSystem = (final) => [
  'You are the ClaudeCodeUsage repository assistant.',
  `Write one concise, concrete first-pass ${kind} for the ${isPr ? 'pull request' : 'issue'} below.`,
  isPr
    ? '- Focus on correctness risks, convention/i18n/CHANGELOG gaps, and merge-readiness grounded in the diff and supplied base-repository text.'
    : '- Identify the request, where it relates to the architecture, and a concrete direction or a specific clarifying question.',
  '- Answer only from the supplied material. Never invent code facts.',
  '- Reply in English by default. Only when the author wrote in Chinese, reply bilingually with English first and a Chinese translation under each section. Never reply in Chinese only. Be specific and concise.',
  '- Return body markdown only inside <reply>; code will add the trusted header and attribution.',
  '- Use English headings: **TL;DR**, **Analysis**, and **Suggested next step(s)** when they help scanning. For a Chinese author, add the translated body under each English section.',
  final
    ? '- If the answer is still unknown, say so and request the exact missing reproduction details, logs, versions, or configuration.'
    : '- If more base-repository source is required, request only the smallest relevant allowlisted files in the control block.',
  '',
  'Before the reply, emit exactly one control line and nothing before it:',
  '<control>{"answerable": <true if the supplied material is enough, false if source files are required>, "want_files": [<up to 6 repo-relative paths>]}</control>',
  '<reply>',
  '...body markdown...',
  '</reply>',
].join('\n');
const buildUser = (extraFiles) =>
  (isPr
    ? `PR #${num}: ${env.ITEM_TITLE}\n\n${env.ITEM_BODY || '(no description)'}\n\n--- DIFF (truncated) ---\n${diff}`
    : `Issue #${num}: ${env.ITEM_TITLE}\n\n${env.ITEM_BODY || '(no body)'}`) +
  `\n\n--- PROJECT DOCS ---\n${docs}` +
  (extraFiles ? `\n\n--- REPO SOURCE FILES (read-only) ---\n${extraFiles}` : '');

async function askModel(useModel, system, userText, think = false) {
  const body = {
    model: useModel,
    max_tokens: 1400,
    system,
    messages: [{ role: 'user', content: userText }],
  };
  if (think) body.thinking = { type: 'enabled', budget_tokens: 6000 };

  let response = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok && think) {
    const errorText = await response.text();
    if (/think|budget|adaptive|reason/i.test(errorText)) {
      delete body.thinking;
      response = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } else {
      throw new Error(`Model API error ${response.status}: ${errorText.slice(0, 500)}`);
    }
  }
  if (!response.ok) {
    throw new Error(`Model API error ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const data = await response.json();
  return (data.content || [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
}

const commentsUrl = `${githubApi}/repos/${owner}/${repo}/issues/${num}/comments`;
const githubHeaders = {
  authorization: `Bearer ${env.GH_TOKEN}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
  'user-agent': 'ccu-bot',
};

try {
  const response = await fetch(`${commentsUrl}?per_page=100`, { headers: githubHeaders });
  if (!response.ok) {
    fail(`Comment lookup failed ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  if (hasTrustedFirstPass(await response.json(), kind)) {
    console.log(`First-pass ${kind} already exists on #${num}; skipping duplicate.`);
    process.exit(0);
  }
} catch (error) {
  fail(`Comment lookup failed: ${error.message}`);
}

const selected = await resolveFirstPassCandidates({
  cheap: async () => ({
    ...parseFirstPassResponse(await askModel(model, buildSystem(false), buildUser(''))),
    generator: cheapGenerator,
  }),
  pro: async (cheapCandidate) => {
    const extra = repoReader.read(cheapCandidate?.want_files || []).text;
    return {
      ...parseFirstPassResponse(
        await askModel(modelPro, buildSystem(true), buildUser(extra), true),
      ),
      generator: proGenerator,
    };
  },
});

let commentBody;
if (selected) {
  try {
    commentBody = formatAutomatedComment(selected.reply, {
      kind,
      generator: selected.generator,
    });
  } catch (error) {
    fail(`First-pass formatting failed: ${error.message}`);
  }
} else {
  const authorWroteInChinese = /[\u3400-\u9fff]/u.test(
    `${env.ITEM_TITLE || ''}\n${env.ITEM_BODY || ''}`,
  );
  commentBody = formatFirstPassFallback({ kind, isChinese: authorWroteInChinese });
  console.warn(`Both model tiers failed to return a usable first-pass ${kind}; posting fallback.`);
}

try {
  const response = await fetch(commentsUrl, {
    method: 'POST',
    headers: githubHeaders,
    body: JSON.stringify({ body: commentBody }),
  });
  if (!response.ok) {
    fail(`Comment post failed ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
} catch (error) {
  fail(`Comment post failed: ${error.message}`);
}
console.log(`Posted first-pass ${kind} on #${num}.`);
