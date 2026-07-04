// Read-only conversation viewer — renders a ParsedConversation to a full HTML
// document for a VS Code webview (no scripts: collapsibles use <details>,
// navigation uses in-page anchors). Frontend goal (Carl's ask): make the two
// things that matter easy to spot — the USER's prompts (the star element) and
// the model's substantive TEXT answers — while keeping thinking and tool
// traffic present but quiet (collapsed / muted).

import { ConversationTurn, ParsedConversation } from './conversationLog';

export interface ViewerOptions {
  sessionId: string;
  timezone?: string;
}

function esc(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortModel(model?: string): string {
  if (!model) {
    return 'assistant';
  }
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

function fmtTime(ts: string | undefined, timezone?: string): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || undefined,
    }).format(d);
  } catch {
    return d.toISOString().slice(5, 16).replace('T', ' ');
  }
}

/** One turn → its HTML block, styled by kind. */
function renderTurn(t: ConversationTurn, idx: number, timezone?: string): string {
  const time = fmtTime(t.ts, timezone);
  const timeTag = time ? `<span class="ts">${esc(time)}</span>` : '';
  const trunc = t.truncated ? ' <span class="trunc">… (truncated)</span>' : '';

  if (t.kind === 'prompt') {
    // The star element — anchored so the top nav can jump to it.
    return (
      `<div class="turn prompt" id="p${idx}">` +
      `<div class="who"><span class="tag you">👤 You</span>${timeTag}</div>` +
      `<div class="body promptbody">${esc(t.text)}${trunc}</div>` +
      `</div>`
    );
  }
  if (t.kind === 'text') {
    return (
      `<div class="turn assistant">` +
      `<div class="who"><span class="tag bot">🤖 ${esc(shortModel(t.model))}</span>${timeTag}</div>` +
      `<div class="body">${esc(t.text)}${trunc}</div>` +
      `</div>`
    );
  }
  if (t.kind === 'thinking') {
    const preview = t.text.replace(/\s+/g, ' ').slice(0, 70);
    return (
      `<details class="turn thinking">` +
      `<summary><span class="tag muted">💭 thinking</span> <span class="peek">${esc(preview)}…</span>${timeTag}</summary>` +
      `<div class="body mono">${esc(t.text)}${trunc}</div>` +
      `</details>`
    );
  }
  if (t.kind === 'tool_use') {
    return (
      `<div class="turn tool">` +
      `<span class="tag tool">🔧 ${esc(t.toolName || 'tool')}</span>` +
      `<code class="toolarg">${esc(t.text)}${trunc}</code>${timeTag}` +
      `</div>`
    );
  }
  // tool_result
  const cls = t.isError ? 'toolres err' : 'toolres';
  const preview = t.text.replace(/\s+/g, ' ').slice(0, 60);
  return (
    `<details class="turn ${cls}">` +
    `<summary><span class="tag muted">${t.isError ? '⚠ result' : '↩ result'}</span> <span class="peek">${esc(preview)}…</span>${timeTag}</summary>` +
    `<div class="body mono">${esc(t.text)}${trunc}</div>` +
    `</details>`
  );
}

export function renderConversationViewer(parsed: ParsedConversation, opts: ViewerOptions): string {
  const turnsHtml = parsed.turns.map((t, i) => renderTurn(t, i, opts.timezone)).join('\n');

  // Top nav: jump straight to each of your prompts (re-reading what you asked
  // is the main use case).
  const promptNav = parsed.turns
    .map((t, i) => (t.kind === 'prompt' ? { i, text: t.text } : null))
    .filter((x): x is { i: number; text: string } => x != null)
    .map((p, n) => `<a href="#p${p.i}" class="navitem"><b>${n + 1}.</b> ${esc(p.text.replace(/\s+/g, ' ').slice(0, 80))}</a>`)
    .join('');

  const range =
    fmtTime(parsed.firstTs, opts.timezone) +
    (parsed.lastTs && parsed.lastTs !== parsed.firstTs ? ' – ' + fmtTime(parsed.lastTs, opts.timezone) : '');
  const shown = parsed.turns.length;
  const more = parsed.totalTurns > shown ? ` · showing last ${shown} of ${parsed.totalTurns}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 0 0 60px;
    line-height: 1.55;
  }
  .wrap { max-width: 860px; margin: 0 auto; padding: 0 20px; }
  header {
    position: sticky; top: 0; z-index: 5;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 14px 0 10px;
  }
  h1 { font-size: 16px; margin: 0 0 4px; font-weight: 600; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .badge {
    display: inline-block; margin-top: 8px; padding: 3px 9px; border-radius: 10px;
    background: var(--vscode-textBlockQuote-background);
    border: 1px solid var(--vscode-panel-border);
    color: var(--vscode-descriptionForeground); font-size: 11px;
  }
  nav {
    margin: 12px 0 4px; border: 1px solid var(--vscode-panel-border);
    border-radius: 8px; overflow: hidden;
  }
  nav > .navhead {
    padding: 7px 12px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
    text-transform: uppercase; color: var(--vscode-descriptionForeground);
    background: var(--vscode-textBlockQuote-background);
  }
  .navitem {
    display: block; padding: 6px 12px; font-size: 12px;
    color: var(--vscode-foreground); text-decoration: none;
    border-top: 1px solid var(--vscode-panel-border);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .navitem b { color: var(--vscode-textLink-foreground); margin-right: 4px; }
  .navitem:hover { background: var(--vscode-list-hoverBackground); }

  .turn { margin: 12px 0; }
  .who { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .tag { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 6px; white-space: nowrap; }
  .tag.you { color: var(--vscode-editor-background); background: var(--vscode-textLink-foreground); }
  .tag.bot { color: var(--vscode-textLink-foreground); background: var(--vscode-textBlockQuote-background); }
  .tag.muted, .tag.tool { color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); }
  .ts { color: var(--vscode-descriptionForeground); font-size: 10.5px; margin-left: auto; }
  .body { white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere; }
  .trunc { color: var(--vscode-descriptionForeground); font-style: italic; }

  /* USER prompt — the star: strong accent rail + tint, so it's instantly findable. */
  .turn.prompt {
    border-left: 3px solid var(--vscode-textLink-foreground);
    background: var(--vscode-textBlockQuote-background);
    border-radius: 0 8px 8px 0; padding: 8px 14px; margin: 20px 0 12px;
  }
  .promptbody { font-weight: 500; }

  /* Assistant substantive text — readable card. */
  .turn.assistant { padding: 2px 2px 2px 14px; border-left: 3px solid var(--vscode-panel-border); }

  /* Thinking + tool_result — present but quiet; expand on demand. */
  details.turn { border-left: 3px solid transparent; padding-left: 14px; }
  details.turn > summary {
    cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px;
    color: var(--vscode-descriptionForeground); font-size: 12px; padding: 2px 0;
  }
  details.turn > summary::-webkit-details-marker { display: none; }
  details.turn[open] > summary { margin-bottom: 6px; }
  .peek { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; color: var(--vscode-descriptionForeground); }
  .toolres.err > summary .tag { color: var(--vscode-errorForeground); }

  /* Tool call — compact one-liner. */
  .turn.tool { display: flex; align-items: center; gap: 8px; padding-left: 14px; font-size: 12px; }
  .toolarg {
    font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px;
    color: var(--vscode-descriptionForeground);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(parsed.title || 'Conversation')}</h1>
    <div class="meta">${esc(range)} · ${parsed.promptCount} prompt${parsed.promptCount === 1 ? '' : 's'} · ${parsed.totalTurns} turns${esc(more)}</div>
    <span class="badge">📖 Read-only — nothing here is loaded back into the model's context</span>
  </header>
  ${promptNav ? `<nav><div class="navhead">Your prompts — jump to one</div>${promptNav}</nav>` : ''}
  <main>
    ${turnsHtml || '<p class="meta">No readable turns in this session log.</p>'}
  </main>
</div>
</body>
</html>`;
}
