// Seed test for the project's test suite (see issue #25).
//
// Approach: Node's built-in test runner (`node:test` + `node:assert`) against
// the *compiled* output — zero new runtime/dev dependencies. Tests live in
// `src/test/` so `tsc` (rootDir: src) emits them to `out/test/`, then the
// `test` script runs `node --test out/test/*.test.js` — a shell-expanded glob,
// so it works on Node 20 too (node's own glob support only landed in 21).
//
// Only pure, dependency-free modules belong here — anything importing the
// `vscode` API needs the heavier @vscode/test-electron harness instead. This
// one file is intentionally a single illustrative example; follow the same
// pattern to cover aggregation, quota-window handling, and i18n next.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  calculateCostFromTokens,
  calculateCostBreakdown,
  getModelPricing,
  setPricingBackend,
} from '../pricing';

test('calculateCostFromTokens prices a known model from its per-token rates', () => {
  // Opus current tier: $5 / $25 / $6.25 / $0.50 per million in/out/write/read.
  const cost = calculateCostFromTokens(
    {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    },
    'claude-opus-4-8'
  );

  // 5 + 25 + 6.25 + 0.5 = 36.75. Use a tolerance — per-token rates are floats.
  assert.ok(Math.abs(cost - 36.75) < 1e-9, `expected ~36.75, got ${cost}`);
});

test('cache-write pricing bills 1-hour writes at 2x input, 5-minute at 1.25x', () => {
  // Opus current tier: base input $5/MTok, so a 5m write is $6.25/MTok and a
  // 1h write is $10/MTok. Split 1M tokens evenly across the two TTLs.
  const breakdown = calculateCostBreakdown(
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 0,
      cache_creation: {
        ephemeral_1h_input_tokens: 500_000,
        ephemeral_5m_input_tokens: 500_000,
      },
    },
    'claude-opus-4-8'
  );
  // 0.5M * 10 + 0.5M * 6.25 = 5 + 3.125 = 8.125 (vs 6.25 if lumped at 5m).
  assert.ok(Math.abs(breakdown.cacheWrite - 8.125) < 1e-9, `expected ~8.125, got ${breakdown.cacheWrite}`);
});

test('cache-write pricing falls back to the 5-minute rate when no TTL split is present', () => {
  // Backward-compatible: a record with only the flat cache_creation_input_tokens
  // (older logs / proxies) is billed entirely at the 5-minute rate.
  const breakdown = calculateCostBreakdown(
    {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 0,
    },
    'claude-opus-4-8'
  );
  assert.ok(Math.abs(breakdown.cacheWrite - 6.25) < 1e-9, `expected ~6.25, got ${breakdown.cacheWrite}`);
});

test('getModelPricing resolves Opus 5 from the exact table, long-context variant included', () => {
  for (const model of ['claude-opus-5', 'claude-opus-5[1m]']) {
    const pricing = getModelPricing(model);
    assert.ok(pricing, `expected pricing for ${model}, got null`);
    assert.equal(pricing!.input_cost_per_token, 5 / 1_000_000, model);
    assert.equal(pricing!.output_cost_per_token, 25 / 1_000_000, model);
  }
});

test('getModelPricing falls back to the right family for an unknown snapshot', () => {
  // An unreleased Opus snapshot isn't in the exact table; it should still
  // resolve to the current Opus tier ($5/MTok input) rather than a wrong rate.
  const pricing = getModelPricing('claude-opus-4-9-20990101');
  assert.ok(pricing, 'expected a fallback pricing object, got null');
  assert.equal(pricing!.input_cost_per_token, 5 / 1_000_000);
});

test('Fable 5.1 uses its reduced cache-read rate without changing Fable 5 history', () => {
  for (const model of ['claude-fable-5-1', 'claude-mythos-5-1', 'claude-fable-5-1[1m]']) {
    const pricing = getModelPricing(model);
    assert.ok(pricing, `expected pricing for ${model}, got null`);
    assert.equal(pricing!.input_cost_per_token, 10 / 1_000_000, model);
    assert.equal(pricing!.output_cost_per_token, 50 / 1_000_000, model);
    assert.equal(pricing!.cache_creation_input_token_cost, 12.5 / 1_000_000, model);
    assert.equal(pricing!.cache_creation_1h_input_token_cost, 20 / 1_000_000, model);
    assert.equal(pricing!.cache_read_input_token_cost, 0.25 / 1_000_000, model);
  }

  assert.equal(
    getModelPricing('claude-fable-5')!.cache_read_input_token_cost,
    1 / 1_000_000,
    'historical Fable 5 cache reads keep their original price',
  );
});

test('GPT-6 Astra uses official Standard short-context rates', () => {
  for (const model of ['gpt-6-astra', 'openai/gpt-6-astra']) {
    const pricing = getModelPricing(model);
    assert.ok(pricing, `expected pricing for ${model}, got null`);
    assert.equal(pricing!.input_cost_per_token, 10 / 1_000_000, model);
    assert.equal(pricing!.output_cost_per_token, 50 / 1_000_000, model);
    assert.equal(pricing!.cache_creation_input_token_cost, 12.5 / 1_000_000, model);
    assert.equal(pricing!.cache_read_input_token_cost, 1 / 1_000_000, model);
  }
});

test('AWS Bedrock mode prices Claude 5 models with in-region rates', () => {
  setPricingBackend('aws-bedrock-in-region');
  try {
    for (const model of [
      'claude-sonnet-5',
      'us.anthropic.claude-sonnet-5-v1:0',
      'claude-sonnet-5[1m]',
    ]) {
      const pricing = getModelPricing(model);
      assert.ok(pricing, `expected Bedrock pricing for ${model}, got null`);
      assert.equal(pricing!.input_cost_per_token, 3.3 / 1_000_000, model);
      assert.equal(pricing!.output_cost_per_token, 16.5 / 1_000_000, model);
      assert.equal(pricing!.cache_creation_input_token_cost, 4.125 / 1_000_000, model);
      assert.equal(pricing!.cache_creation_1h_input_token_cost, 6.6 / 1_000_000, model);
      assert.equal(pricing!.cache_read_input_token_cost, 0.33 / 1_000_000, model);
    }

    const cost = calculateCostFromTokens(
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      },
      'claude-sonnet-5',
    );
    assert.ok(Math.abs(cost - 24.255) < 1e-9, `expected ~24.255, got ${cost}`);
  } finally {
    setPricingBackend('anthropic');
  }
});

test('AWS Bedrock mode prices Claude Opus 4.5-4.8 with in-region rates', () => {
  setPricingBackend('aws-bedrock-in-region');
  try {
    for (const model of [
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'us.anthropic.claude-opus-4-8-v1:0',
    ]) {
      const pricing = getModelPricing(model);
      assert.ok(pricing, `expected Bedrock pricing for ${model}, got null`);
      assert.equal(pricing!.input_cost_per_token, 5.5 / 1_000_000, model);
      assert.equal(pricing!.output_cost_per_token, 27.5 / 1_000_000, model);
      assert.equal(pricing!.cache_creation_input_token_cost, 6.875 / 1_000_000, model);
      assert.equal(pricing!.cache_creation_1h_input_token_cost, 11 / 1_000_000, model);
      assert.equal(pricing!.cache_read_input_token_cost, 0.55 / 1_000_000, model);
    }
  } finally {
    setPricingBackend('anthropic');
  }
});

test('AWS Bedrock mode prices Claude Sonnet 4.5 and 4.6 with in-region rates', () => {
  setPricingBackend('aws-bedrock-in-region');
  try {
    for (const model of [
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-5',
      'us.anthropic.claude-sonnet-4-6-v1:0',
      'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'claude-sonnet-4.5',
      'claude_sonnet_4_5',
    ]) {
      const pricing = getModelPricing(model);
      assert.ok(pricing, `expected Bedrock pricing for ${model}, got null`);
      assert.equal(pricing!.input_cost_per_token, 3.3 / 1_000_000, model);
      assert.equal(pricing!.output_cost_per_token, 16.5 / 1_000_000, model);
      assert.equal(pricing!.cache_creation_input_token_cost, 4.125 / 1_000_000, model);
      assert.equal(pricing!.cache_creation_1h_input_token_cost, 6.6 / 1_000_000, model);
      assert.equal(pricing!.cache_read_input_token_cost, 0.33 / 1_000_000, model);
    }

    const cost = calculateCostFromTokens(
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      },
      'claude-sonnet-4-5-20250929',
    );
    assert.ok(Math.abs(cost - 24.255) < 1e-9, `expected ~24.255, got ${cost}`);
  } finally {
    setPricingBackend('anthropic');
  }
});

test('Claude Sonnet 4.5 switches between direct and Bedrock rates for the same model id', () => {
  const model = 'claude-sonnet-4-5-20250929';

  setPricingBackend('anthropic');
  const direct = getModelPricing(model);
  assert.ok(direct);
  assert.equal(direct.input_cost_per_token, 3 / 1_000_000);
  assert.equal(direct.output_cost_per_token, 15 / 1_000_000);

  setPricingBackend('aws-bedrock-in-region');
  try {
    const bedrock = getModelPricing(model);
    assert.ok(bedrock);
    assert.equal(bedrock.input_cost_per_token, 3.3 / 1_000_000);
    assert.equal(bedrock.output_cost_per_token, 16.5 / 1_000_000);
  } finally {
    setPricingBackend('anthropic');
  }
});

test('an unknown model is reported once, not once per priced record', () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    for (let index = 0; index < 3; index += 1) {
      assert.ok(getModelPricing('claude-opus-99-test-once'));
      assert.ok(getModelPricing('unlabelled-model-test-once'));
    }
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, [
    ['Unknown model: claude-opus-99-test-once, using Opus (current tier) pricing as fallback'],
    ['Unknown model: unlabelled-model-test-once, using Sonnet pricing as fallback'],
  ]);
});
