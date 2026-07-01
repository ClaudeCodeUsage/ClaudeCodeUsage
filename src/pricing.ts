// Price calculation by model.
//
// This extension primarily tracks Claude Code, but Claude Code can be pointed at
// other providers via a proxy, so pricing for common US / Chinese models is also
// included as a convenience.

import * as https from 'https';

import { ModelPricing } from './types';

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

const MILL = 1_000_000;

// =====================================================================
// Anthropic / Claude pricing
// Verified 2026-05-21 — https://platform.claude.com/docs/en/about-claude/pricing
//
// Cache pricing follows Anthropic's standard multipliers vs base input price:
//   - 5-minute cache write : 1.25x base input  (what Claude Code writes by default)
//   - cache read (hit)     : 0.10x base input
// `cache_creation_input_token_cost` below uses the 5-minute write rate.
// =====================================================================

// Fable 5 / Mythos 5 — frontier tier ($10 / $50), verified 2026-06-09
// https://platform.claude.com/docs/en/about-claude/pricing
const FABLE_5: ModelPricing = {
  input_cost_per_token: 10 / MILL,
  output_cost_per_token: 50 / MILL,
  cache_creation_input_token_cost: 12.5 / MILL,
  cache_read_input_token_cost: 1 / MILL,
};

// Opus 4.5 / 4.6 / 4.7 / 4.8 — current Opus tier ($5 / $25)
const OPUS_CURRENT: ModelPricing = {
  input_cost_per_token: 5 / MILL,
  output_cost_per_token: 25 / MILL,
  cache_creation_input_token_cost: 6.25 / MILL,
  cache_read_input_token_cost: 0.5 / MILL,
};

// Opus 4 / 4.1 — legacy Opus tier ($15 / $75)
const OPUS_LEGACY: ModelPricing = {
  input_cost_per_token: 15 / MILL,
  output_cost_per_token: 75 / MILL,
  cache_creation_input_token_cost: 18.75 / MILL,
  cache_read_input_token_cost: 1.5 / MILL,
};

// Sonnet 3.5 / 4 / 4.5 / 4.6 — Sonnet tier ($3 / $15, <=200K context)
const SONNET: ModelPricing = {
  input_cost_per_token: 3 / MILL,
  output_cost_per_token: 15 / MILL,
  cache_creation_input_token_cost: 3.75 / MILL,
  cache_read_input_token_cost: 0.3 / MILL,
};

// Haiku 4.5 ($1 / $5)
const HAIKU_45: ModelPricing = {
  input_cost_per_token: 1 / MILL,
  output_cost_per_token: 5 / MILL,
  cache_creation_input_token_cost: 1.25 / MILL,
  cache_read_input_token_cost: 0.1 / MILL,
};

// Haiku 3.5 ($0.80 / $4) — retired, kept for historical logs
const HAIKU_35: ModelPricing = {
  input_cost_per_token: 0.8 / MILL,
  output_cost_per_token: 4 / MILL,
  cache_creation_input_token_cost: 1.0 / MILL,
  cache_read_input_token_cost: 0.08 / MILL,
};

/**
 * Build pricing for non-Anthropic providers, which usually only publish an
 * input price, an output price, and an optional discounted "cached input" price.
 * @param inputPerM       Input price per 1M tokens (USD)
 * @param outputPerM      Output price per 1M tokens (USD)
 * @param cachedInputPerM Cached/'cache hit' input price per 1M tokens (USD).
 *                        Defaults to 10% of the input price when omitted.
 */
function priced(inputPerM: number, outputPerM: number, cachedInputPerM?: number): ModelPricing {
  return {
    input_cost_per_token: inputPerM / MILL,
    output_cost_per_token: outputPerM / MILL,
    // These providers do not charge extra to *write* a cache entry — a cache-write
    // token is billed like a normal input token.
    cache_creation_input_token_cost: inputPerM / MILL,
    cache_read_input_token_cost: (cachedInputPerM != null ? cachedInputPerM : inputPerM * 0.1) / MILL,
  };
}

// =====================================================================
// Non-Claude reference pricing (USD per 1M tokens)
// Last checked 2026-05. OpenAI / Gemini / DeepSeek from vendor docs; Chinese
// models converted from published RMB prices at ~7.2 RMB/USD and are approximate
// — treat these as estimates and re-verify before relying on them.
// =====================================================================
const NON_CLAUDE_PRICING: Record<string, ModelPricing> = {
  // --- OpenAI --- https://openai.com/api/pricing/
  'gpt-5.5': priced(5, 30, 0.5),
  'gpt-5.4': priced(2.5, 15, 0.25),
  'gpt-5': priced(1.25, 10, 0.125),
  'gpt-5-mini': priced(0.25, 2, 0.025),
  'gpt-5-nano': priced(0.05, 0.4, 0.005),
  'gpt-4.1': priced(2, 8, 0.5),
  'gpt-4.1-mini': priced(0.4, 1.6, 0.1),
  'gpt-4.1-nano': priced(0.1, 0.4, 0.025),
  'gpt-4o': priced(2.5, 10, 1.25),
  'gpt-4o-mini': priced(0.15, 0.6, 0.075),
  'o3': priced(2, 8, 0.5),
  'o4-mini': priced(1.1, 4.4, 0.275),

  // --- Google Gemini --- https://ai.google.dev/gemini-api/docs/pricing (<=200K tier)
  'gemini-2.5-pro': priced(1.25, 10, 0.125),
  'gemini-2.5-flash': priced(0.3, 2.5, 0.03),
  'gemini-2.5-flash-lite': priced(0.1, 0.4, 0.01),
  'gemini-2.0-flash': priced(0.1, 0.4, 0.025),

  // --- DeepSeek --- https://api-docs.deepseek.com/quick_start/pricing/
  // The `deepseek-chat` alias has pointed to the current V4 Pro tier since
  // 2024-09; `deepseek-reasoner` is the matched reasoner at the same price.
  // Don't lump them in with V4 Flash, which is the cheap tier.
  'deepseek-chat': priced(0.435, 0.87, 0.003625),
  'deepseek-reasoner': priced(0.435, 0.87, 0.003625),
  'deepseek-v4-pro': priced(0.435, 0.87, 0.003625),
  'deepseek-v4-flash': priced(0.14, 0.28, 0.0028),

  // --- Moonshot / Kimi --- prices published in USD by Moonshot
  'kimi-k2.7-code': priced(0.95, 4.0, 0.19),
  'kimi-k2-6': priced(0.95, 4.0, 0.16),
  'kimi-k2-5': priced(0.6, 2.5),
  'kimi-k2': priced(0.6, 2.5),
  'moonshot-v1-128k': priced(0.6, 2.5),

  // --- Zhipu GLM ---
  // GLM-5.x models use official USD pricing from z.ai (the global API channel);
  // older models are approximate, converted from published RMB pricing at ~7.2 RMB/USD.
  // https://docs.z.ai/guides/overview/pricing
  'glm-5.2': priced(1.40, 4.40, 0.26),
  'glm-5.1': priced(1.40, 4.40, 0.26),
  'glm-4.6': priced(0.6, 2.2),
  'glm-4.5': priced(0.6, 2.2),
  'glm-4.5-air': priced(0.2, 1.1),

  // --- MiniMax --- standard list price (launch promo was 50% off)
  // https://platform.minimaxi.com/docs/guides/pricing-paygo
  'minimax-m3': priced(0.60, 2.40, 0.12),

  // --- Xiaomi MiMo --- post price-cut (May 2026) USD equivalent
  'mimo-v2.5-pro': priced(0.435, 0.87, 0.0036),

  // --- Alibaba Qwen ---
  // Qwen 3.5 models use international region USD pricing;
  // older models are approximate, converted from RMB (DashScope, <=32K tier).
  'qwen3.5-flash': priced(0.10, 0.40),
  'qwen3.5-plus': priced(0.40, 2.40),
  'qwen-max': priced(0.35, 1.39),
  'qwen-plus': priced(0.11, 0.67),
  'qwen-turbo': priced(0.042, 0.083),
  'qwen-long': priced(0.069, 0.278),

  // --- Tencent Hy3 --- via OpenRouter (global API channel)
  'hy3-preview': priced(0.063, 0.21, 0.029),

  // --- StepFun / 阶跃星辰 --- global USD pricing via OpenRouter
  'step-3.7-flash': priced(0.20, 1.15, 0.04),
  'step-3.5-flash': priced(0.10, 0.30, 0.02),
};

// Exact model-id -> pricing map. Both dated snapshots and short aliases are listed
// so direct lookups stay fast; anything not listed is resolved by getModelPricing()'s
// family-aware fallback below.
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude Fable 5 / Mythos 5 (2026-06) — frontier tier
  'claude-fable-5': FABLE_5,
  'claude-mythos-5': FABLE_5,

  // Claude Opus 4.8 / 4.7 / 4.6 — current Opus tier rate, verified 2026-06-09
  // against the official pricing page ($5 / $25 / $6.25 / $0.5 per MTok).
  'claude-opus-4-8': OPUS_CURRENT,
  'claude-opus-4-7': OPUS_CURRENT,
  'claude-opus-4-6': OPUS_CURRENT,

  // Claude Opus 4.5 (2025-11)
  'claude-opus-4-5-20251101': OPUS_CURRENT,
  'claude-opus-4-5': OPUS_CURRENT,

  // Claude Opus 4.1 (2025-08-05)
  'claude-opus-4-1-20250805': OPUS_LEGACY,
  'claude-opus-4-1': OPUS_LEGACY,

  // Claude Opus 4 (2025-05-14)
  'claude-opus-4-20250514': OPUS_LEGACY,

  // Claude Sonnet 5 (same $3 / $15 Sonnet tier). Family inference already maps
  // any "sonnet" model to SONNET, so this is an explicit anchor for clarity.
  'claude-sonnet-5': SONNET,

  // Claude Sonnet 4.6
  'claude-sonnet-4-6': SONNET,

  // Claude Sonnet 4.5 (2025-09-29)
  'claude-sonnet-4-5-20250929': SONNET,
  'claude-sonnet-4-5': SONNET,

  // Claude Sonnet 4 (2025-05-14)
  'claude-sonnet-4-20250514': SONNET,

  // Claude Sonnet 3.5 (2024-10-22)
  'claude-3-5-sonnet-20241022': SONNET,

  // Claude Haiku 4.5 (2025-10)
  'claude-haiku-4-5-20251001': HAIKU_45,
  'claude-haiku-4-5': HAIKU_45,

  // Claude Haiku 3.5 (2024-10-22) — retired
  'claude-3-5-haiku-20241022': HAIKU_35,

  // Common US / Chinese models (see NON_CLAUDE_PRICING above)
  ...NON_CLAUDE_PRICING,
};

// Runtime pricing overrides fetched on demand from LiteLLM's public pricing
// dataset (see fetchLatestPricing). These take precedence over the built-in
// table, letting users pull fresh prices without waiting for an extension update.
const runtimePricingOverrides: Record<string, ModelPricing> = {};
let lastPricingFetch: { time: number; count: number } | null = null;

/**
 * Resolve pricing for an unknown model id by detecting its family.
 *
 * Vendors ship new dated snapshots frequently, so a hardcoded table always lags.
 * Rather than charging every unknown model the wrong rate, map by family to a
 * sensible current model of that family.
 *
 * @returns pricing + a human-readable family label, or null if no family matched
 */
function inferPricingByFamily(modelName: string): { pricing: ModelPricing; family: string } | null {
  const name = modelName.toLowerCase();

  // --- Anthropic / Claude ---
  if (name.includes('fable') || name.includes('mythos')) {
    return { pricing: FABLE_5, family: 'Fable 5 (frontier tier)' };
  }
  if (name.includes('haiku')) {
    if (name.includes('haiku-3') || name.includes('-3-5-haiku') || name.includes('-3-haiku')) {
      return { pricing: HAIKU_35, family: 'Haiku 3.5' };
    }
    return { pricing: HAIKU_45, family: 'Haiku 4.5' };
  }
  if (name.includes('opus')) {
    // Legacy Opus (4 / 4.1) is always in the exact map, so an unknown opus is
    // almost certainly a new-tier model.
    return { pricing: OPUS_CURRENT, family: 'Opus (current tier)' };
  }
  if (name.includes('sonnet')) {
    return { pricing: SONNET, family: 'Sonnet' };
  }

  // --- Other providers ---
  if (name.includes('gpt') || /(^|[^a-z])o[1-9]([^a-z]|$)/.test(name)) {
    return { pricing: NON_CLAUDE_PRICING['gpt-5'], family: 'OpenAI GPT' };
  }
  if (name.includes('gemini')) {
    return { pricing: NON_CLAUDE_PRICING['gemini-2.5-flash'], family: 'Google Gemini' };
  }
  if (name.includes('deepseek')) {
    return { pricing: NON_CLAUDE_PRICING['deepseek-chat'], family: 'DeepSeek' };
  }
  if (name.includes('minimax')) {
    return { pricing: NON_CLAUDE_PRICING['minimax-m3'], family: 'MiniMax' };
  }
  if (name.includes('mimo')) {
    return { pricing: NON_CLAUDE_PRICING['mimo-v2.5-pro'], family: 'Xiaomi MiMo' };
  }
  if (name.includes('kimi') || name.includes('moonshot')) {
    return { pricing: NON_CLAUDE_PRICING['kimi-k2-6'], family: 'Moonshot Kimi' };
  }
  if (name.includes('glm')) {
    return { pricing: NON_CLAUDE_PRICING['glm-4.6'], family: 'Zhipu GLM' };
  }
  if (name.includes('qwen') || name.includes('tongyi')) {
    return { pricing: NON_CLAUDE_PRICING['qwen-plus'], family: 'Alibaba Qwen' };
  }
  if (name.includes('hy3')) {
    return { pricing: NON_CLAUDE_PRICING['hy3-preview'], family: 'Tencent Hy3' };
  }
  if (name.startsWith('step-') || name.includes('/step-')) {
    return { pricing: NON_CLAUDE_PRICING['step-3.7-flash'], family: 'StepFun' };
  }

  return null;
}

/**
 * Get pricing information for a model
 * @param modelName Model name
 * @returns Pricing information, or null if not found
 */
export function getModelPricing(modelName: string | undefined): ModelPricing | null {
  if (!modelName) {
    return null;
  }

  // Strip a trailing bracket suffix like "[1m]" (long-context variant marker
  // used in Claude Code model settings, e.g. "claude-fable-5[1m]"). 1M-context
  // variants are billed at standard per-token rates, so the base model's
  // pricing applies.
  modelName = modelName.replace(/\[[^\]]*\]\s*$/, '');

  // Try different variation matches (similar to ccusage logic)
  const variations = [modelName, `anthropic/${modelName}`, `claude-3-5-${modelName}`, `claude-3-${modelName}`, `claude-${modelName}`];

  // Runtime overrides (fetched from LiteLLM) take precedence over the built-in table.
  for (const variation of variations) {
    if (runtimePricingOverrides[variation]) {
      return runtimePricingOverrides[variation];
    }
  }

  // Built-in table.
  for (const variation of variations) {
    if (MODEL_PRICING[variation]) {
      return MODEL_PRICING[variation];
    }
  }

  // Family-aware fallback for unrecognised (typically newer) snapshots.
  const inferred = inferPricingByFamily(modelName);
  if (inferred) {
    console.warn(`Unknown model: ${modelName}, using ${inferred.family} pricing as fallback`);
    return inferred.pricing;
  }

  // Truly unknown model (no family keyword) — fall back to Sonnet, the most common default.
  console.warn(`Unknown model: ${modelName}, using Sonnet pricing as fallback`);
  return SONNET;
}

/**
 * Calculate cost from given token usage and pricing
 * @param tokens Token usage
 * @param pricing Pricing information
 * @returns Total cost (USD)
 */
export function calculateCostFromPricing(tokens: TokenUsage, pricing: ModelPricing): number {
  let cost = 0;

  // Input tokens cost
  if (pricing.input_cost_per_token != null) {
    cost += tokens.input_tokens * pricing.input_cost_per_token;
  }

  // Output tokens cost
  if (pricing.output_cost_per_token != null) {
    cost += tokens.output_tokens * pricing.output_cost_per_token;
  }

  // Cache creation tokens cost
  if (tokens.cache_creation_input_tokens != null && pricing.cache_creation_input_token_cost != null) {
    cost += tokens.cache_creation_input_tokens * pricing.cache_creation_input_token_cost;
  }

  // Cache read tokens cost
  if (tokens.cache_read_input_tokens != null && pricing.cache_read_input_token_cost != null) {
    cost += tokens.cache_read_input_tokens * pricing.cache_read_input_token_cost;
  }

  return cost;
}

/**
 * Calculate total cost of model usage
 * @param tokens Token usage
 * @param modelName Model name
 * @returns Total cost (USD), returns 0 if pricing not found
 */
export function calculateCostFromTokens(tokens: TokenUsage, modelName: string | undefined): number {
  const pricing = getModelPricing(modelName);

  if (!pricing) {
    return 0;
  }

  return calculateCostFromPricing(tokens, pricing);
}

/**
 * Break a model's cost down by token type (input / output / cache write / cache read).
 * The four components sum to the same total as calculateCostFromTokens.
 */
export function calculateCostBreakdown(
  tokens: TokenUsage,
  modelName: string | undefined
): { input: number; output: number; cacheWrite: number; cacheRead: number } {
  const pricing = getModelPricing(modelName);
  if (!pricing) {
    return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  }
  return {
    input: tokens.input_tokens * (pricing.input_cost_per_token || 0),
    output: tokens.output_tokens * (pricing.output_cost_per_token || 0),
    cacheWrite: (tokens.cache_creation_input_tokens || 0) * (pricing.cache_creation_input_token_cost || 0),
    cacheRead: (tokens.cache_read_input_tokens || 0) * (pricing.cache_read_input_token_cost || 0),
  };
}

/**
 * Per-million-token rates for a model, intended for display in the UI so users
 * can sanity-check the figures behind a cost.
 * @returns rates in USD per 1M tokens, or null if the model is unknown
 */
export function getModelRatesPerMillion(
  modelName: string | undefined
): { input: number; output: number; cacheWrite: number; cacheRead: number } | null {
  const pricing = getModelPricing(modelName);
  if (!pricing) {
    return null;
  }
  return {
    input: (pricing.input_cost_per_token || 0) * MILL,
    output: (pricing.output_cost_per_token || 0) * MILL,
    cacheWrite: (pricing.cache_creation_input_token_cost || 0) * MILL,
    cacheRead: (pricing.cache_read_input_token_cost || 0) * MILL,
  };
}

/** Metadata about the most recent successful fetchLatestPricing() call. */
export function getPricingLastFetched(): { time: number; count: number } | null {
  return lastPricingFetch;
}

const LITELLM_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/**
 * Fetch the latest model prices from LiteLLM's public pricing dataset and apply
 * them as runtime overrides. The dataset uses the same per-token fields as
 * ModelPricing, so entries map directly. Overrides live in memory for the
 * current session only.
 * @returns the number of models updated
 */
export function fetchLatestPricing(): Promise<{ updated: number }> {
  return new Promise((resolve, reject) => {
    const request = https.get(LITELLM_PRICING_URL, { timeout: 15000 }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          const json = JSON.parse(body) as Record<string, unknown>;
          let updated = 0;

          for (const [name, raw] of Object.entries(json)) {
            if (raw == null || typeof raw !== 'object') {
              continue;
            }
            const info = raw as Record<string, unknown>;
            if (typeof info.input_cost_per_token !== 'number') {
              continue;
            }
            runtimePricingOverrides[name] = {
              input_cost_per_token: info.input_cost_per_token,
              output_cost_per_token:
                typeof info.output_cost_per_token === 'number' ? info.output_cost_per_token : undefined,
              cache_creation_input_token_cost:
                typeof info.cache_creation_input_token_cost === 'number' ? info.cache_creation_input_token_cost : undefined,
              cache_read_input_token_cost:
                typeof info.cache_read_input_token_cost === 'number' ? info.cache_read_input_token_cost : undefined,
            };
            updated++;
          }

          lastPricingFetch = { time: Date.now(), count: updated };
          resolve({ updated });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('Request timed out'));
    });
    request.on('error', reject);
  });
}
