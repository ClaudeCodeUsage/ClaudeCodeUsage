// Read-only conversation viewer — renders a ParsedConversation to a full HTML
// document for a VS Code webview. No scripts: collapsibles use <details>, the
// "show thinking / tools" switches are a pure-CSS checkbox toggle, navigation
// uses in-page anchors.
//
// Frontend goal (Carl's asks): a user-friendly CHAT view. By default it shows
// only what he reads — his PROMPTS (accent card) and the model's TEXT answers
// (filled card, Markdown-rendered) — with thinking and tool traffic hidden
// behind toggles. It opens on the last ~10 rounds; earlier ones collapse.

import { ConversationTurn, ParsedConversation } from './conversationLog';
import { renderMarkdown } from './miniMarkdown';

export interface ViewerOptions {
  sessionId: string;
  timezone?: string;
  /** Rounds (prompt → next prompt) shown expanded on open; older ones collapse. */
  recentRounds?: number;
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

/** One turn → its HTML block, styled by kind. `idx` anchors prompts for the nav.
 * `intermediate` marks an assistant answer that isn't the round's final one. */
function renderTurn(t: ConversationTurn, idx: number, timezone?: string, intermediate = false): string {
  const time = fmtTime(t.ts, timezone);
  const timeTag = time ? `<span class="ts">${esc(time)}</span>` : '';
  const trunc = t.truncated ? ' <span class="trunc">… (truncated)</span>' : '';

  if (t.kind === 'prompt') {
    return (
      `<div class="turn prompt" id="p${idx}">` +
      `<div class="who"><span class="tag you">👤 You</span>${timeTag}</div>` +
      `<div class="body promptbody">${esc(t.text)}${trunc}</div>` +
      `</div>`
    );
  }
  if (t.kind === 'text') {
    // Model output is Markdown — render it (renderMarkdown escapes internally).
    const interTag = intermediate ? ' <span class="tag interim">interim</span>' : '';
    return (
      `<div class="turn assistant${intermediate ? ' intermediate' : ''}">` +
      `<div class="who"><span class="tag bot">🤖 ${esc(shortModel(t.model))}</span>${interTag}${timeTag}</div>` +
      `<div class="body md">${renderMarkdown(t.text)}${trunc}</div>` +
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
      `<span class="tag muted">🔧 ${esc(t.toolName || 'tool')}</span>` +
      `<code class="toolarg">${esc(t.text)}${trunc}</code>${timeTag}` +
      `</div>`
    );
  }
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
  const recentRounds = opts.recentRounds ?? 10;

  // Group turns into rounds: a new round begins at each user prompt (anything
  // before the first prompt forms an initial round). Keep the turn + its global
  // index so the round's FINAL answer can be told from its intermediate ones.
  const rounds: { t: ConversationTurn; i: number }[][] = [];
  let cur: { t: ConversationTurn; i: number }[] | null = null;
  parsed.turns.forEach((t, i) => {
    if (t.kind === 'prompt' || !cur) {
      cur = [];
      rounds.push(cur);
    }
    cur.push({ t, i });
  });

  // Within a round, the last assistant-text turn is the "final answer"; earlier
  // text turns are intermediate narration between tool calls.
  const intermediate = new Set<number>();
  for (const r of rounds) {
    const textIdx = r.filter((x) => x.t.kind === 'text').map((x) => x.i);
    for (let k = 0; k < textIdx.length - 1; k++) {
      intermediate.add(textIdx[k]);
    }
  }
  const renderRound = (r: { t: ConversationTurn; i: number }[]): string =>
    r.map(({ t, i }) => renderTurn(t, i, opts.timezone, intermediate.has(i))).join('');

  const recentCount = Math.min(recentRounds, rounds.length);
  const earlier = rounds.slice(0, rounds.length - recentCount);
  const recent = rounds.slice(rounds.length - recentCount);
  const earlierHtml = earlier.length
    ? `<details class="earlier"><summary>▾ Show earlier conversation (${earlier.length} round${earlier.length === 1 ? '' : 's'})</summary>${earlier.map(renderRound).join('\n')}</details>`
    : '';
  const recentHtml = recent.map(renderRound).join('\n');

  // Top nav: each of your prompts, expandable to the full text, with a jump link.
  const promptItems = parsed.turns
    .map((t, i) => (t.kind === 'prompt' ? { i, text: t.text } : null))
    .filter((x): x is { i: number; text: string } => x != null);
  const promptNav = promptItems
    .map((p, n) => {
      const oneLine = p.text.replace(/\s+/g, ' ');
      const short = oneLine.slice(0, 80);
      const needsExpand = oneLine.length > 80;
      const latest = n === promptItems.length - 1 ? '<span class="latest">latest</span>' : '';
      // Jump link sits OUTSIDE the truncating text so it's never clipped; the
      // caret expands the full prompt text.
      return (
        `<details class="navitem">` +
        `<summary><span class="navtext"><b>${n + 1}.</b> ${esc(short)}${needsExpand ? '…' : ''}</span>${latest}` +
        `<a class="jump" href="#p${p.i}">jump ↓</a></summary>` +
        (needsExpand ? `<div class="navfull">${esc(p.text)}</div>` : '') +
        `</details>`
      );
    })
    .join('');

  const range =
    fmtTime(parsed.firstTs, opts.timezone) +
    (parsed.lastTs && parsed.lastTs !== parsed.firstTs ? ' – ' + fmtTime(parsed.lastTs, opts.timezone) : '');
  const shown = parsed.turns.length;
  const more = parsed.totalTurns > shown ? ` · showing last ${shown} of ${parsed.totalTurns}` : '';
  const roundWord = rounds.length === 1 ? 'round' : 'rounds';

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
    margin: 0; padding: 0 0 60px; line-height: 1.55;
  }
  /* Pure-CSS toggles: the checkboxes live before .wrap so their :checked state
     can drive descendant visibility via general-sibling selectors. */
  .toggle-src { position: absolute; opacity: 0; pointer-events: none; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 0 20px; }
  header {
    position: sticky; top: 0; z-index: 5;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 14px 0 10px;
  }
  h1 { font-size: 16px; margin: 0 0 4px; font-weight: 600; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 12px; font-variant-numeric: tabular-nums; }
  .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
  .badge {
    display: inline-block; padding: 4px 10px; border-radius: 10px;
    background: var(--vscode-textBlockQuote-background); border: 1px solid var(--vscode-panel-border);
    color: var(--vscode-descriptionForeground); font-size: 11px;
  }
  .chip {
    cursor: pointer; user-select: none; font-size: 11px; padding: 4px 10px; border-radius: 10px;
    border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground);
    background: transparent;
  }
  .chip:hover { background: var(--vscode-list-hoverBackground); }
  #ccu-thinking:checked ~ .wrap label[for="ccu-thinking"],
  #ccu-tools:checked ~ .wrap label[for="ccu-tools"],
  #ccu-interim:checked ~ .wrap label[for="ccu-interim"] {
    color: var(--vscode-editor-background); background: var(--vscode-textLink-foreground);
    border-color: var(--vscode-textLink-foreground);
  }
  /* Thinking + tools hidden by default → clean chat view; toggles reveal.
     Interim answers are shown by default; the toggle can hide them to leave
     only each round's final answer. */
  #ccu-thinking:not(:checked) ~ .wrap .turn.thinking { display: none; }
  #ccu-tools:not(:checked) ~ .wrap .turn.tool,
  #ccu-tools:not(:checked) ~ .wrap .turn.toolres { display: none; }
  #ccu-interim:not(:checked) ~ .wrap .turn.assistant.intermediate { display: none; }
  .tag.interim { color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); font-weight: 600; }

  nav { margin: 12px 0 4px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; overflow: hidden; }
  .navhead {
    padding: 7px 12px; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background);
  }
  details.navitem { border-top: 1px solid var(--vscode-panel-border); }
  details.navitem > summary {
    cursor: pointer; list-style: none; padding: 7px 12px; font-size: 12px; color: var(--vscode-foreground);
    display: flex; align-items: center; gap: 8px;
  }
  details.navitem > summary::-webkit-details-marker { display: none; }
  details.navitem > summary:hover { background: var(--vscode-list-hoverBackground); }
  .navtext { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  details.navitem b { color: var(--vscode-textLink-foreground); margin-right: 5px; }
  /* Jump link is flex:none so it's ALWAYS visible, never clipped by the text. */
  .navitem .jump { flex: none; color: var(--vscode-textLink-foreground); text-decoration: none; font-size: 11px; }
  .latest {
    flex: none; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px;
    color: var(--vscode-editor-background); background: var(--vscode-textLink-foreground);
  }
  .navfull { padding: 4px 12px 10px 24px; white-space: pre-wrap; color: var(--vscode-descriptionForeground); font-size: 12px; }

  details.earlier { margin: 8px 0; }
  details.earlier > summary {
    cursor: pointer; list-style: none; color: var(--vscode-textLink-foreground); font-size: 12px; padding: 6px 0;
  }
  details.earlier > summary::-webkit-details-marker { display: none; }

  .turn { margin: 13px 0; }
  .who { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
  .tag { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 6px; white-space: nowrap; }
  .tag.you { color: var(--vscode-editor-background); background: var(--vscode-textLink-foreground); }
  .tag.bot { color: var(--vscode-textLink-foreground); background: var(--vscode-textBlockQuote-background); }
  .tag.muted { color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); }
  .ts { color: var(--vscode-descriptionForeground); font-size: 10.5px; margin-left: auto; font-variant-numeric: tabular-nums; }
  .body { word-wrap: break-word; overflow-wrap: anywhere; }
  .trunc { color: var(--vscode-descriptionForeground); font-style: italic; }

  /* USER prompt — accent rail + tint: instantly findable. */
  .turn.prompt {
    border-left: 3px solid var(--vscode-textLink-foreground);
    background: var(--vscode-textBlockQuote-background);
    border-radius: 0 8px 8px 0; padding: 9px 15px; margin: 22px 0 13px; scroll-margin-top: 96px;
  }
  .promptbody { font-weight: 500; white-space: pre-wrap; }

  /* Assistant answer — its OWN filled card, distinct from prompts and from the
     (muted, unfilled) tool traffic. */
  .turn.assistant {
    border: 1px solid var(--vscode-panel-border); border-left: 3px solid var(--vscode-descriptionForeground);
    background: var(--vscode-editorWidget-background, var(--vscode-textBlockQuote-background));
    border-radius: 0 8px 8px 0; padding: 9px 15px;
  }
  /* Rendered Markdown inside an answer. */
  .md p { margin: 0 0 8px; }
  .md p:last-child { margin-bottom: 0; }
  .md h1, .md h2, .md h3, .md h4 { margin: 10px 0 6px; font-size: 13.5px; font-weight: 600; }
  .md ul, .md ol { margin: 4px 0 8px; padding-left: 22px; }
  .md li { margin: 2px 0; }
  .md code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.18)); padding: 1px 5px; border-radius: 4px; }
  .md pre {
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.14)); border: 1px solid var(--vscode-panel-border);
    border-radius: 6px; padding: 10px 12px; overflow-x: auto; margin: 6px 0;
  }
  .md pre code { background: none; padding: 0; font-size: 12px; }
  .md a { color: var(--vscode-textLink-foreground); }
  .md blockquote { margin: 6px 0; padding: 2px 12px; border-left: 3px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
  .md hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 10px 0; }
  .md table { border-collapse: collapse; margin: 8px 0; font-size: 12px; display: block; overflow-x: auto; max-width: 100%; }
  .md th, .md td { border: 1px solid var(--vscode-panel-border); padding: 4px 10px; text-align: left; }
  .md th { background: var(--vscode-textBlockQuote-background); font-weight: 600; }

  /* Thinking + tool_result — quiet; expand on demand. */
  details.turn { border-left: 3px solid transparent; padding-left: 15px; }
  details.turn > summary {
    cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px;
    color: var(--vscode-descriptionForeground); font-size: 12px; padding: 2px 0;
  }
  details.turn > summary::-webkit-details-marker { display: none; }
  details.turn[open] > summary { margin-bottom: 6px; }
  .peek { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; }
  .toolres.err > summary .tag { color: var(--vscode-errorForeground); }

  /* Tool call — compact one-liner. */
  .turn.tool { display: flex; align-items: center; gap: 8px; padding-left: 15px; font-size: 12px; }
  .toolarg {
    font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; color: var(--vscode-descriptionForeground);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
  }
  a:focus-visible, summary:focus-visible, label:focus-visible { outline: 2px solid var(--vscode-focusBorder, var(--vscode-textLink-foreground)); outline-offset: 2px; border-radius: 3px; }
</style>
</head>
<body>
<input type="checkbox" id="ccu-thinking" class="toggle-src">
<input type="checkbox" id="ccu-tools" class="toggle-src">
<input type="checkbox" id="ccu-interim" class="toggle-src" checked>
<div class="wrap">
  <header>
    <h1>${esc(parsed.title || 'Conversation')}</h1>
    <div class="meta">${esc(range)} · ${parsed.promptCount} prompt${parsed.promptCount === 1 ? '' : 's'} · ${rounds.length} ${roundWord} · ${parsed.totalTurns} turns${esc(more)}</div>
    <div class="controls">
      <span class="badge">📖 Read-only — nothing here is loaded back into the model's context</span>
      <label class="chip" for="ccu-interim" tabindex="0">💬 interim replies</label>
      <label class="chip" for="ccu-thinking" tabindex="0">💭 thinking</label>
      <label class="chip" for="ccu-tools" tabindex="0">🔧 tool activity</label>
    </div>
  </header>
  ${promptNav ? `<nav><div class="navhead">Your prompts — expand or jump</div>${promptNav}</nav>` : ''}
  <main>
    ${earlierHtml}
    ${recentHtml || '<p class="meta">No readable turns in this session log.</p>'}
  </main>
</div>
</body>
</html>`;
}
