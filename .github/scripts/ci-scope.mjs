import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDocs = new Set([
  'README.md', ...['en', 'de-DE', 'zh-CN', 'zh-TW', 'ja', 'ko', 'pt-BR', 'id'].map(locale => `README-${locale}.md`),
  'AGENTS.md', 'AGENTS.zh-CN.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  'LOCAL-DATA.md', 'LOCAL-DATA.zh-CN.md', 'ARCHITECTURE.md', 'ARCHITECTURE-zh-CN.md',
]);
const shaPattern = /^[a-f0-9]{40}$/;
const validSha = value => typeof value === 'string' && shaPattern.test(value) && !/^0+$/.test(value);

function documentationPath(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f\\]/.test(value)) return false;
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return false;
  return rootDocs.has(value) || (parts[0] === 'docs' && parts.length > 1 && value.endsWith('.md'));
}

// True is the safe default: unknown paths, modes, statuses and empty diffs run UI.
export function classifyEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return true;
  return !entries.every(entry => entry && documentationPath(entry.path) &&
    ['A', 'M', 'D'].includes(entry.status) &&
    ['100644', '000000'].includes(entry.oldMode) && ['100644', '000000'].includes(entry.newMode) &&
    (entry.status === 'A' ? entry.oldMode === '000000' && entry.newMode === '100644' :
      entry.status === 'D' ? entry.oldMode === '100644' && entry.newMode === '000000' :
        entry.oldMode === '100644' && entry.newMode === '100644'));
}

export function parseRawDiff(raw) {
  if (typeof raw !== 'string' || !raw || !raw.endsWith('\0')) throw new Error('Unverified diff');
  const fields = raw.split('\0');
  fields.pop();
  if (fields.length % 2 !== 0) throw new Error('Incomplete raw diff');
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const match = /^:(\d{6}) (\d{6}) [a-f0-9]{40} [a-f0-9]{40} ([AMD])$/.exec(fields[index]);
    if (!match || !fields[index + 1]) throw new Error('Unexpected raw diff');
    entries.push({ path: fields[index + 1], oldMode: match[1], newMode: match[2], status: match[3] });
  }
  return entries;
}

export function classifyRepository({ cwd = process.cwd(), eventName, event, sha }) {
  const full = reason => ({ uiRequired: true, reason });
  try {
    if (!validSha(sha)) return full('unverified-checkout');
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (git('rev-parse', 'HEAD').trim() !== sha) return full('checkout-mismatch');
    let base;
    if (eventName === 'pull_request') {
      base = event?.pull_request?.base?.sha;
      const head = event?.pull_request?.head?.sha;
      if (!validSha(base) || !validSha(head)) return full('unverified-pr-range');
      git('merge-base', '--is-ancestor', head, sha);
    } else if (eventName === 'push') {
      // A docs-only successor may cancel an unfinished runtime push under the
      // same main concurrency group. Never replace that coverage with an exemption.
      return full('push-full-verification');
    } else return full('unrecognized-event');
    // Compare the actual tested tree, not only the PR head or latest single commit.
    // --no-renames exposes both old and new paths, preventing a runtime→docs rename exemption.
    const entries = parseRawDiff(git('diff', '--raw', '-z', '--no-renames', '--no-abbrev', base, sha, '--'));
    const uiRequired = classifyEntries(entries);
    return { uiRequired, reason: uiRequired ? 'full-verification' : 'verified-documentation-only' };
  } catch { return full('unverified-diff'); }
}

export function gatePasses(scopeResult, uiRequired, shardResult) {
  return scopeResult === 'success' && ((uiRequired === 'true' && shardResult === 'success') ||
    (uiRequired === 'false' && shardResult === 'skipped'));
}

function main() {
  if (process.argv.length === 3 && process.argv[2] === '--gate') {
    const passed = gatePasses(process.env.SCOPE_RESULT, process.env.UI_REQUIRED, process.env.SHARDS_RESULT);
    console.log(passed ? 'UI gate satisfied by the verified scope and expected shard result.' : 'UI gate failed closed.');
    process.exitCode = passed ? 0 : 1;
    return;
  }
  if (process.argv.length !== 2) throw new Error('Unsupported scope arguments');
  let result;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    result = classifyRepository({ eventName: process.env.GITHUB_EVENT_NAME, event, sha: process.env.GITHUB_SHA });
  } catch { result = { uiRequired: true, reason: 'unverified-event' }; }
  console.log(`UI required: ${result.uiRequired}; ${result.reason}`);
  if (!process.env.GITHUB_OUTPUT) throw new Error('Missing output channel');
  appendFileSync(process.env.GITHUB_OUTPUT, `ui_required=${result.uiRequired}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
