// Optional "usage advice" feature: sends a usage summary (and, optionally, a
// sample of the developer's own prompts) to a model and returns advice on how
// to use Claude Code more effectively.
//
// Transport (v2.1 Phase 9): three backends behind one entry point —
//   1. 'subscription' — reuse Claude Code's own OAuth session (the same token
//      the quota indicator reads) to call Anthropic's Messages API with a cheap
//      model (haiku) — zero API key, works out of the box. Verified 2026-06-13:
//      Bearer <oauth> + `anthropic-beta: oauth-2025-04-20` → 200.
//   2. 'api' + apiFormat 'anthropic' (the default for a configured key) —
//      x-api-key against /v1/messages.
//   3. 'api' + apiFormat 'openai' — the OpenAI chat-completions shape
//      (DeepSeek etc.), kept for compatibility.
// Anthropic is the default shape across the extension; OpenAI is opt-in.

import { HttpResponse, requestViaCurl, requestViaFetch } from './httpClient';

export type AdviceBackend = 'subscription' | 'api';
export type AdviceFormat = 'anthropic' | 'openai';

export interface AdviceOptions {
  // Transport selection. Defaults (when omitted) keep the pre-2.1 behaviour:
  // backend 'api' + format 'openai'.
  backend?: AdviceBackend;
  apiFormat?: AdviceFormat;
  // backend 'api':
  apiKey: string;
  apiUrl: string;
  model: string;
  // backend 'subscription': the cheap model to spend a little quota on, plus a
  // provider for a valid OAuth access token (ClaudeApiClient.getAccessToken).
  subscriptionModel?: string;
  getSubscriptionToken?: () => Promise<string | null>;
  // The usage digest sent as the user turn (built by adviceSummary.ts).
  summary: string;
  // Localised name of the user's UI language, e.g. "简体中文 (Simplified Chinese)".
  language: string;
  // '', 'high' or 'max' — passed as reasoning_effort for OpenAI-format models.
  reasoningEffort?: string;
  // Free-text background about the user/project; when set, the reply ends with
  // a "Personalised for this project" section calibrated against it.
  userContext?: string;
  // Abort the request after this long (reasoning models can take minutes).
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const ADVICE_MAX_TOKENS = 16_000;

function buildSystemPrompt(language: string, userContext?: string): string {
  let prompt =
    'You are a coaching advisor that helps a developer use the Claude Code AI ' +
    'coding agent more effectively. You are given a breakdown of their usage and ' +
    'a sample of their actual prompts. Your PRIMARY goal: advise how to write ' +
    'clearer, more complete and more precise instructions so tasks are completed ' +
    'correctly and efficiently — point at concrete weaknesses in the sample ' +
    'prompts and show better rewrites. SECONDARY goal: where it does not hurt ' +
    'clarity, suggest ways to reduce token consumption. Be concrete and ' +
    'actionable, use short sections and bullet points. ';
  const ctx = (userContext || '').trim();
  if (ctx !== '') {
    prompt +=
      'The user provided this background about themself and the project: ' +
      `"${ctx.slice(0, 1000)}". End your reply with a final section titled ` +
      '"Personalised for this project" that calibrates the advice against this ' +
      'background instead of generic best practice. ';
  }
  prompt +=
    `IMPORTANT: write your entire reply in ${language}, regardless of the ` +
    'language(s) used in the sample prompts.';
  return prompt;
}

/** Normalise an OpenAI-compatible chat endpoint URL. */
function normalizeOpenAiUrl(url: string): string {
  let u = (url || '').trim().replace(/\/+$/, '');
  if (u === '') {
    return 'https://api.deepseek.com/chat/completions';
  }
  if (/api\.deepseek\.com\/v1(\/chat\/completions)?$/.test(u)) {
    u = u.replace('/v1', '');
  }
  if (!u.endsWith('/chat/completions')) {
    u = `${u}/chat/completions`;
  }
  return u;
}

/** Normalise an Anthropic Messages endpoint URL. */
function normalizeAnthropicUrl(url: string): string {
  const u = (url || '').trim().replace(/\/+$/, '');
  if (u === '' || /api\.anthropic\.com$/.test(u) || /chat\/completions$/.test(u)) {
    return 'https://api.anthropic.com/v1/messages';
  }
  return u.endsWith('/v1/messages') ? u : `${u}/v1/messages`;
}

/** Send a request with the Phase-0 timeout / retry / curl-fallback policy. */
async function send(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<HttpResponse> {
  const reqOpts = { method: 'POST', headers, body };
  const curl = (): Promise<HttpResponse> =>
    requestViaCurl(url, { ...reqOpts, timeoutSec: Math.ceil(timeoutMs / 1000) });
  try {
    const r = await requestViaFetch(url, { ...reqOpts, timeoutMs });
    // Anthropic's edge fingerprints Node's TLS ClientHello and answers 403
    // "Request not allowed"; curl gets through (same gate the quota client hits).
    if (r.status === 403 && r.body.includes('Request not allowed')) {
      return curl();
    }
    return r;
  } catch {
    try {
      return await requestViaFetch(url, { ...reqOpts, timeoutMs });
    } catch {
      return curl();
    }
  }
}

/**
 * Send one system+user turn to whichever backend is configured and return the
 * assistant text. Shared by the advice feature and the Usage Optimizer.
 */
export async function callModel(
  systemPrompt: string,
  userContent: string,
  options: AdviceOptions
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backend: AdviceBackend = options.backend ?? 'api';
  const format: AdviceFormat = options.apiFormat ?? 'openai';

  // --- Anthropic Messages shape (subscription, or api+anthropic) ---
  if (backend === 'subscription' || format === 'anthropic') {
    let headers: Record<string, string>;
    let model: string;
    let url = normalizeAnthropicUrl(options.apiUrl);
    if (backend === 'subscription') {
      const token = options.getSubscriptionToken ? await options.getSubscriptionToken() : null;
      if (!token) {
        throw new Error(
          'No Claude subscription session found — sign in to Claude Code, or configure an API key.'
        );
      }
      url = 'https://api.anthropic.com/v1/messages';
      model = options.subscriptionModel || 'claude-haiku-4-5';
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      };
    } else {
      model = options.model;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
      };
    }
    const body = JSON.stringify({
      model,
      max_tokens: ADVICE_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    const response = await send(url, headers, body, timeoutMs);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`API ${response.status}: ${response.body.slice(0, 300)}`);
    }
    let data: { content?: { type?: string; text?: string }[] };
    try {
      data = JSON.parse(response.body);
    } catch {
      throw new Error(`The API returned a non-JSON response: ${response.body.slice(0, 200)}`);
    }
    const text = (data.content || [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    if (!text.trim()) {
      throw new Error('The model returned an empty response.');
    }
    return text;
  }

  // --- OpenAI chat-completions shape (api + openai) ---
  const body: Record<string, unknown> = {
    model: options.model,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };
  if (options.reasoningEffort && options.reasoningEffort.trim() !== '') {
    body.reasoning_effort = options.reasoningEffort.trim();
    body.thinking = { type: 'enabled' };
  }
  const url = normalizeOpenAiUrl(options.apiUrl);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.apiKey}`,
  };
  const response = await send(url, headers, JSON.stringify(body), timeoutMs);
  if (response.status < 200 || response.status >= 300) {
    const hint =
      response.status === 404
        ? ' (check advice.apiUrl — for DeepSeek it is https://api.deepseek.com/chat/completions)'
        : '';
    throw new Error(`API ${response.status}${hint}: ${response.body.slice(0, 300)}`);
  }
  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = JSON.parse(response.body);
  } catch {
    throw new Error(`The API returned a non-JSON response: ${response.body.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content || content.trim() === '') {
    throw new Error('The model returned an empty response.');
  }
  return content;
}

/**
 * Request usage advice. Returns the advice text (markdown).
 */
export async function getUsageAdvice(options: AdviceOptions): Promise<string> {
  const systemPrompt = buildSystemPrompt(options.language || 'English', options.userContext);
  return callModel(systemPrompt, options.summary, options);
}

// === Usage Optimizer (Phase 9c) ===
// The optimizer turns a rough pasted request into one tight, paste-ready prompt
// plus a settings recommendation. The system prompt and the reply parser are
// pure functions here (no VS Code dependency) so they can be unit-tested; the
// VS Code glue (consent modal, config, webview round-trip) lives in extension.ts.

export interface OptimizerLenses {
  resolve: boolean; // flag ambiguous references
  distil: boolean; // condense long pasted material
  aesthetic: boolean; // suggest a style direction
}

/** Build the optimizer system prompt for the given language + enabled lenses.
 * `availableModels` is the set of models the user actually uses (Claude ones
 * already reduced to family names) — the recommendation is constrained to these
 * so it never names a model the user doesn't have or a stale version a
 * third-party model wouldn't know about. */
export function buildOptimizerSystemPrompt(
  language: string,
  lenses: OptimizerLenses,
  availableModels: string[] = []
): string {
  const extra: string[] = [];
  if (lenses.resolve) {
    extra.push(
      'Flag every ambiguous reference (e.g. "this", "the file", "that bug", "as before") ' +
        'and either ask the user to pin it down or state a clearly-marked assumption.'
    );
  }
  if (lenses.distil) {
    extra.push(
      'If the draft pastes long material (logs, stack traces, code, docs), condense it to ' +
        'only the part Claude needs and reference the rest rather than repeating it verbatim.'
    );
  }
  if (lenses.aesthetic) {
    extra.push(
      'Where the task is UI / visual / writing, propose one concrete style or aesthetic ' +
        'direction so the result is not generic.'
    );
  }
  return (
    'You are a prompt engineer for the Claude Code CLI coding agent. The user pastes a ' +
    'rough request they intend to hand to Claude Code. Rewrite it into ONE tight, ' +
    'paste-ready prompt Claude Code can act on directly: clear goal, concrete scope, ' +
    'explicit constraints and acceptance criteria, no filler. Preserve the user’s intent ' +
    'and every specific detail; never invent requirements. ' +
    extra.join(' ') +
    (extra.length > 0 ? ' ' : '') +
    'CRITICAL: write the rewritten prompt as PLAIN TEXT — no Markdown at all (no **bold**, ' +
    'no #headings, no backticks, no bullet characters), so it pastes cleanly into a ' +
    'terminal. Use short paragraphs or hyphen lines if structure helps. ' +
    'Then recommend run settings for THIS task. ' +
    (availableModels.length > 0
      ? 'For the model, choose ONLY from the models the user actually uses: ' +
        availableModels.join(', ') +
        '. Refer to Claude models by family only (haiku / sonnet / opus / fable) — ' +
        'never a version number. Pick the cheaper option for mechanical edits, the ' +
        'strongest for ambiguous or design-heavy work. '
      : 'Refer to Claude models by family only (haiku / sonnet / opus / fable), never a ' +
        'version number; pick the cheaper for mechanical edits, the strongest for ambiguous work. ') +
    'Format the settings as EXACTLY three lines, each "Label: value — reason":\n' +
    'Effort: <low|medium|high|max|ultracode> — <short reason>\n' +
    'Thinking: <on|off> — <short reason>\n' +
    'Model: <model> — <short reason>\n' +
    '("max" is the highest single-run effort; "ultracode" means split the task ' +
    'across multiple sub-agents — suggest it only for large, parallelisable work.) ' +
    'Keep the labels (Effort / Thinking / Model) AND the value tokens (e.g. high, ' +
    'max, ultracode, on, opus) in English; write only the reason in the target language. ' +
    'Output EXACTLY this shape and nothing else:\n' +
    '===PROMPT===\n<the rewritten prompt, plain text>\n===SETTINGS===\n<the three settings lines>\n' +
    `Write the prompt and the reasons in ${language}.`
  );
}

/** Split the optimizer reply on the ===PROMPT=== / ===SETTINGS=== markers. */
export function parseOptimizerOutput(raw: string): { prompt: string; settings: string } {
  const text = (raw || '').trim();
  const promptIdx = text.indexOf('===PROMPT===');
  const settingsIdx = text.indexOf('===SETTINGS===');
  if (promptIdx === -1 || settingsIdx === -1 || settingsIdx < promptIdx) {
    // Marker-free or malformed: surface the whole thing as the prompt so the
    // user still gets a usable result.
    return { prompt: text, settings: '' };
  }
  const prompt = text.slice(promptIdx + '===PROMPT==='.length, settingsIdx).trim();
  const settings = text.slice(settingsIdx + '===SETTINGS==='.length).trim();
  return { prompt, settings };
}
