// Pure parser for a Claude Code session .jsonl → a display-ready list of turns
// for the read-only conversation viewer. No vscode / fs imports: it takes the
// raw file text and returns plain data, so it is fully unit-testable.
//
// The viewer's whole point (Carl's ask) is to let a human RE-READ a past
// session to jog their memory WITHOUT loading it into the model context — so we
// keep the two things that matter, user PROMPTS and substantive model TEXT,
// front and centre, and de-emphasise the tool-call/tool-result noise.

export type TurnRole = 'user' | 'assistant';
export type TurnKind = 'prompt' | 'text' | 'thinking' | 'tool_use' | 'tool_result';

export interface ConversationTurn {
  role: TurnRole;
  kind: TurnKind;
  /** ISO timestamp of the source line, when present. */
  ts?: string;
  /** Display text (already trimmed; may be truncated — see `truncated`). */
  text: string;
  /** Assistant model id, on assistant turns. */
  model?: string;
  /** Tool name, on `tool_use` turns. */
  toolName?: string;
  /** True if a tool_result carried is_error. */
  isError?: boolean;
  /** True when `text` was cut to `maxCharsPerTurn`. */
  truncated?: boolean;
}

export interface ParsedConversation {
  turns: ConversationTurn[];
  /** Total qualifying turns before any `maxTurns` slice. */
  totalTurns: number;
  /** Total rounds (a round = a user prompt + everything until the next prompt). */
  totalRounds: number;
  /** Number of prompt turns (what the human typed). */
  promptCount: number;
  /** Conversation title (custom > ai > summary), when the log carries one. */
  title?: string;
  /** First / last timestamps seen. */
  firstTs?: string;
  lastTs?: string;
}

export interface ParseOptions {
  /** Keep only the most recent N ROUNDS (a round = a prompt + its replies). This
   * is the right cap for the viewer: capping raw turns starves prompts, because
   * one prompt can be followed by dozens of tool turns. */
  maxRounds?: number;
  /** Safety ceiling on raw turns kept (applied AFTER maxRounds). */
  maxTurns?: number;
  /** Truncate each turn's text to this many chars (default 1200). */
  maxCharsPerTurn?: number;
  /** Include assistant thinking blocks (default true). */
  includeThinking?: boolean;
  /** Include tool_use / tool_result turns (default true; the UI collapses them). */
  includeTools?: boolean;
}

interface Block {
  type?: string;
  text?: unknown;
  thinking?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
  is_error?: unknown;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Flatten a tool_result's content (string, or array of text/blocks) to text. */
function flattenToolResult(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    let out = '';
    for (const b of content) {
      if (typeof b === 'string') {
        out += b;
      } else if (b && typeof b === 'object' && typeof (b as Block).text === 'string') {
        out += (b as { text: string }).text;
      }
    }
    return out;
  }
  return '';
}

/** Compact one-line summary of a tool_use input (so the chip is readable). */
function summarizeInput(input: unknown): string {
  if (input == null) {
    return '';
  }
  if (typeof input === 'string') {
    return input;
  }
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>;
    // Prefer the fields users recognise, in priority order.
    for (const k of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt', 'description']) {
      if (typeof o[k] === 'string' && o[k]) {
        return String(o[k]);
      }
    }
    try {
      return JSON.stringify(o);
    } catch {
      return '';
    }
  }
  return '';
}

function clip(text: string, max: number): { text: string; truncated: boolean } {
  const t = text.replace(/\s+$/g, '');
  if (t.length <= max) {
    return { text: t, truncated: false };
  }
  return { text: t.slice(0, max), truncated: true };
}

/**
 * Parse a whole `.jsonl` session file into ordered display turns.
 * Robust to malformed lines (skipped) and to the two content shapes
 * (string | block[]). Deduplicates by `uuid`. Skips meta / sidechain lines so
 * the reader sees the real conversation, not framework chatter.
 */
export function parseConversation(jsonlText: string, opts: ParseOptions = {}): ParsedConversation {
  const maxChars = opts.maxCharsPerTurn ?? 1200;
  const includeThinking = opts.includeThinking !== false;
  const includeTools = opts.includeTools !== false;

  const all: ConversationTurn[] = [];
  const seen = new Set<string>();
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let summary: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;

  const lines = jsonlText.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    // Titles ride on their own line types.
    if (parsed.type === 'custom-title' && typeof parsed.customTitle === 'string') {
      customTitle = parsed.customTitle;
      continue;
    }
    if (parsed.type === 'ai-title' && typeof parsed.aiTitle === 'string') {
      aiTitle = parsed.aiTitle;
      continue;
    }
    if (parsed.type === 'summary' && typeof parsed.summary === 'string') {
      summary = parsed.summary;
      continue;
    }

    // Real conversation only — drop framework/meta and sub-agent sidechains.
    if (parsed.isMeta === true || parsed.isSidechain === true) {
      continue;
    }
    const uuid = typeof parsed.uuid === 'string' ? parsed.uuid : '';
    if (uuid) {
      if (seen.has(uuid)) {
        continue;
      }
      seen.add(uuid);
    }

    const message = parsed.message as { role?: unknown; content?: unknown; model?: unknown } | undefined;
    if (!message || typeof message !== 'object') {
      continue;
    }
    const role = (message.role || parsed.type) as string;
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }
    const ts = typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined;
    if (ts) {
      if (!firstTs) {
        firstTs = ts;
      }
      lastTs = ts;
    }
    const model = asText(message.model) || undefined;
    const content = message.content;

    const push = (t: ConversationTurn): void => {
      if (!t.text && t.kind !== 'tool_use') {
        return;
      }
      all.push(t);
    };

    if (typeof content === 'string') {
      if (content.trim()) {
        const { text, truncated } = clip(content, maxChars);
        push({ role: role as TurnRole, kind: role === 'user' ? 'prompt' : 'text', ts, text, model, truncated });
      }
      continue;
    }
    if (!Array.isArray(content)) {
      continue;
    }
    for (const b of content as Block[]) {
      if (!b || typeof b !== 'object') {
        continue;
      }
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        const { text, truncated } = clip(b.text, maxChars);
        push({ role: role as TurnRole, kind: role === 'user' ? 'prompt' : 'text', ts, text, model, truncated });
      } else if (b.type === 'thinking' && includeThinking && typeof b.thinking === 'string' && b.thinking.trim()) {
        const { text, truncated } = clip(b.thinking, maxChars);
        push({ role: 'assistant', kind: 'thinking', ts, text, model, truncated });
      } else if (b.type === 'tool_use' && includeTools) {
        const { text, truncated } = clip(summarizeInput(b.input), maxChars);
        push({ role: 'assistant', kind: 'tool_use', ts, text, model, toolName: asText(b.name) || 'tool', truncated });
      } else if (b.type === 'tool_result' && includeTools) {
        const { text, truncated } = clip(flattenToolResult(b.content), maxChars);
        if (text) {
          push({ role: 'user', kind: 'tool_result', ts, text, isError: b.is_error === true, truncated });
        }
      }
    }
  }

  const totalTurns = all.length;
  const promptCount = all.filter((t) => t.kind === 'prompt').length;

  // Round starts: each prompt begins a round; any leading non-prompt turns form
  // an initial round. Capping by ROUNDS (not raw turns) is what keeps prompts
  // from being starved when a single prompt is followed by dozens of tool turns.
  const roundStarts: number[] = [];
  all.forEach((t, idx) => {
    if (t.kind === 'prompt') {
      roundStarts.push(idx);
    } else if (roundStarts.length === 0) {
      roundStarts.push(idx);
    }
  });
  const totalRounds = roundStarts.length;

  let turns = all;
  if (opts.maxRounds && roundStarts.length > opts.maxRounds) {
    turns = all.slice(roundStarts[roundStarts.length - opts.maxRounds]);
  }
  if (opts.maxTurns && turns.length > opts.maxTurns) {
    turns = turns.slice(turns.length - opts.maxTurns);
  }

  return {
    turns,
    totalTurns,
    totalRounds,
    promptCount,
    title: customTitle || aiTitle || summary,
    firstTs,
    lastTs,
  };
}
