export type CodexModelFamily = 'astra' | 'sol' | 'luna';
export type ClaudeModelFamily = 'sonnet' | 'opus' | 'haiku';

// Union of the existing Fable and Bedrock-pricing prefix contracts. This is
// label recognition, not proof of routing or actual upstream availability.
const CLAUDE_PREFIX = '(?:(?:global|us|eu|jp|apac|in)\\.anthropic\\.)?';
const FABLE_MODEL_ID = new RegExp(`^${CLAUDE_PREFIX}claude-(?:fable|mythos)-5(?:-1)?(?:\\[1m\\])?$`, 'i');
const CLAUDE_OTHER_MODEL_ID = new RegExp(`^${CLAUDE_PREFIX}claude-(?:3-\\d-)?(sonnet|opus|haiku)(?:-\\d(?:-\\d)?(?:-\\d{8})?|-\\d{8})(?:\\[1m\\])?(?:-v\\d+:\\d+)?$`, 'i');

/** Dashboard pricing fallback is deliberately not an achievement proof. */
export function claudeAchievementFamily(model: string): ClaudeModelFamily | 'fable' | null {
  const name = model.trim();
  if (FABLE_MODEL_ID.test(name)) return 'fable';
  const match = CLAUDE_OTHER_MODEL_ID.exec(name);
  return match ? match[1].toLowerCase() as ClaudeModelFamily : null;
}

/** Preserve the public family classifier; callers separately admit full IDs. */
export function codexModelFamily(model: string): CodexModelFamily | null {
  const match = /^gpt-\d+(?:\.\d+)?-(astra|sol|luna)(?:-|$)/i.exec(model.trim());
  return match ? match[1].toLowerCase() as CodexModelFamily : null;
}

// Retain the old explicitly admitted non-family models and their native
// openai/ aliases, independently of monetary rates or pricebook revisions.
const LEGACY_CODEX_MODELS = new Set([
  'gpt-5.5', 'gpt-5.4', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini',
]);
// New generations of named families may be unpriced. Arbitrary trailing
// words (custom/proxy/etc.) and unnamed families are never admitted. Keep a
// snapshot suffix in its identity; do not guess that it is the base model.
const CODEX_NAMED_MODEL = /^gpt-\d+(?:\.\d+)?-(?:astra|sol|luna|terra)(?:-(?:\d{8}|\d{4}-\d{2}-\d{2}))?$/;

/** Strict recorded labels, not a claim that a remote model really exists. */
export function normalizeCodexAchievementModel(label: string): string | null {
  const name = label.trim().toLowerCase();
  const model = name.startsWith('openai/') ? name.slice('openai/'.length) : name;
  return LEGACY_CODEX_MODELS.has(model) || CODEX_NAMED_MODEL.test(model) ? model : null;
}
