import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ClaudeDataLoader } from '../dataLoader';
import { calculateCostBreakdown, getExactModelPricing, getModelPricing, setPricingBackend } from '../pricing';

// Official Standard rates checked 2026-09-30. Never infer exact coverage for
// a new dated ID merely because it contains the same model-family keyword.
const openAiRates = [
  { id: 'gpt-6.1-sol', input: 2, output: 10, write: 2.5, read: 0.1 },
  { id: 'gpt-6-sol', input: 2, output: 10, write: 2.5, read: 0.2 },
  { id: 'gpt-6-luna', input: 0.1, output: 0.5, write: 0.125, read: 0.01 },
];

test('pricing helpers tolerate non-string runtime model values without coercing private content', () => {
  const originalWarn = console.warn;
  let warnings = 0;
  console.warn = () => { warnings += 1; };
  try {
    for (const value of [42, {}, [], true, null, '<unknown>']) {
      assert.equal(getModelPricing(value as unknown as string), null);
      assert.equal(getExactModelPricing(value as unknown as string), null);
    }
    assert.equal(warnings, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test('current GPT-6 Sol/Luna and GPT-6.1 Sol exact IDs use official Standard rates', () => {
  setPricingBackend('anthropic');
  for (const rate of openAiRates) {
    for (const id of [rate.id, `openai/${rate.id}`]) {
      const exact = getExactModelPricing(id);
      assert.ok(exact, id);
      assert.equal(exact.input_cost_per_token, rate.input / 1_000_000, id);
      assert.equal(exact.output_cost_per_token, rate.output / 1_000_000, id);
      assert.equal(exact.cache_creation_input_token_cost, rate.write / 1_000_000, id);
      assert.equal(exact.cache_read_input_token_cost, rate.read / 1_000_000, id);
    }
  }
});

test('GPT-6.1 Sol cache reads do not change historical GPT-6 Sol pricing', () => {
  const tokens = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
  const current = calculateCostBreakdown(tokens, 'gpt-6.1-sol');
  const previous = calculateCostBreakdown(tokens, 'gpt-6-sol');
  assert.deepEqual(current, { input: 2, output: 10, cacheWrite: 0, cacheRead: 0.1 });
  assert.deepEqual(previous, { input: 2, output: 10, cacheWrite: 0, cacheRead: 0.2 });
});

test('Sonnet 5.5 has dedicated Standard and TTL-specific cache prices', () => {
  for (const id of ['claude-sonnet-5-5', 'sonnet-5-5', 'claude-sonnet-5-5[1m]', 'anthropic/claude-sonnet-5-5']) {
    const pricing = getExactModelPricing(id);
    assert.ok(pricing, id);
    assert.deepEqual(pricing, {
      input_cost_per_token: 2 / 1_000_000,
      output_cost_per_token: 10 / 1_000_000,
      cache_creation_input_token_cost: 2.5 / 1_000_000,
      cache_creation_1h_input_token_cost: 4 / 1_000_000,
      cache_read_input_token_cost: 0.2 / 1_000_000,
    });
  }
});

test('Sonnet 5.5 uses the explicit Bedrock regional premium', () => {
  setPricingBackend('aws-bedrock-in-region');
  try {
    for (const id of ['claude-sonnet-5-5', 'us.anthropic.claude-sonnet-5-5-v1:0']) {
      const pricing = getExactModelPricing(id);
      assert.ok(pricing, id);
      assert.equal(pricing.input_cost_per_token, 2.2 / 1_000_000, id);
      assert.equal(pricing.output_cost_per_token, 11 / 1_000_000, id);
      assert.equal(pricing.cache_creation_input_token_cost, 2.75 / 1_000_000, id);
      assert.equal(pricing.cache_creation_1h_input_token_cost, 4.4 / 1_000_000, id);
      assert.equal(pricing.cache_read_input_token_cost, 0.22 / 1_000_000, id);
    }
  } finally {
    setPricingBackend('anthropic');
  }
});

test('new known models emit no pricing warnings across repeated render passes', () => {
  const originalWarn = console.warn;
  let warnings = 0;
  console.warn = () => { warnings += 1; };
  try {
    for (let index = 0; index < 10_000; index += 1) {
      for (const id of [...openAiRates.map(rate => rate.id), 'claude-sonnet-5-5']) {
        getModelPricing(id);
        getExactModelPricing(id);
      }
    }
    assert.equal(warnings, 0);
    assert.equal(getExactModelPricing('gpt-6.1-sol-20990101'), null);
    assert.equal(getExactModelPricing('claude-sonnet-5-5-20990101'), null);
  } finally {
    console.warn = originalWarn;
  }
});

test('known GPT-6 Sol/Luna and GPT-6.1 Sol report a verified 1.05M context', () => {
  for (const rate of openAiRates) {
    const context = ClaudeDataLoader.getCurrentContextInfo([{
      timestamp: new Date().toISOString(),
      message: { model: rate.id, usage: { input_tokens: 100, output_tokens: 10 } },
    }]);
    assert.ok(context, rate.id);
    assert.equal(context.windowTokens, 1_050_000, rate.id);
    assert.equal(context.estimated, false, rate.id);
  }
});

test('object-prototype labels cannot masquerade as known or exact pricing', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    for (const label of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      assert.equal(getExactModelPricing(label), null, label);
      const fallback = getModelPricing(label);
      assert.ok(fallback);
      assert.equal(typeof fallback.input_cost_per_token, 'number', label);
      assert.equal(fallback.input_cost_per_token, 3 / 1_000_000, label);
    }
  } finally {
    console.warn = originalWarn;
  }
});
