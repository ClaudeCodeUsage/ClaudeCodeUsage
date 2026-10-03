import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import {
  calculateCostBreakdown,
  calculateCostFromTokens,
  getExactModelPricing,
  getModelPricing,
  setPricingBackend,
} from '../pricing';

const usage = {
  input_tokens: 1_000,
  output_tokens: 100,
  cache_creation_input_tokens: 200,
  cache_read_input_tokens: 800,
};

function countWarnings(work: () => void): number {
  let count = 0;
  const original = console.warn;
  console.warn = () => { count += 1; };
  try {
    work();
  } finally {
    console.warn = original;
  }
  return count;
}

test('50k Opus 5.5 records priced by repeated dashboard passes emit no warning', () => {
  setPricingBackend('anthropic');
  const warnings = countWarnings(() => {
    for (let index = 0; index < 50_000; index += 1) {
      calculateCostFromTokens(usage, 'claude-opus-5-5');
      calculateCostBreakdown(usage, 'claude-opus-5-5');
      calculateCostBreakdown(usage, 'claude-opus-5-5[1m]');
    }
  });
  assert.equal(warnings, 0);
});

test('a future unknown model is warned once across repeated pricing passes', () => {
  const warnings = countWarnings(() => {
    for (let index = 0; index < 50_000; index += 1) {
      calculateCostFromTokens(usage, 'claude-opus-99-hotfix-stress');
      calculateCostBreakdown(usage, 'claude-opus-99-hotfix-stress[1m]');
      getModelPricing('claude-opus-99-hotfix-stress');
    }
  });
  assert.equal(warnings, 1);
  assert.equal(getExactModelPricing('claude-opus-99-hotfix-stress'), null);
});

test('Opus 5.5 exact entries use the verified standard and TTL-specific rates', () => {
  for (const model of ['claude-opus-5-5', 'opus-5-5', 'claude-opus-5-5[1m]', 'anthropic/claude-opus-5-5']) {
    const pricing = getExactModelPricing(model);
    assert.ok(pricing, model);
    assert.deepEqual(pricing, {
      input_cost_per_token: 4 / 1_000_000,
      output_cost_per_token: 20 / 1_000_000,
      cache_creation_input_token_cost: 5 / 1_000_000,
      cache_creation_1h_input_token_cost: 8 / 1_000_000,
      cache_read_input_token_cost: 0.2 / 1_000_000,
    });
    const breakdown = calculateCostBreakdown({
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_1h_input_tokens: 500_000, ephemeral_5m_input_tokens: 500_000 },
      cache_read_input_tokens: 1_000_000,
    }, model);
    assert.equal(breakdown.input, 4);
    assert.equal(breakdown.output, 20);
    assert.equal(breakdown.cacheWrite, 6.5);
    assert.equal(breakdown.cacheRead, 0.2);
  }
});

test('Opus 5.5 uses its own Bedrock regional rates without changing Opus 5', () => {
  setPricingBackend('aws-bedrock-in-region');
  try {
    for (const model of ['claude-opus-5-5', 'claude-opus-5-5[1m]', 'us.anthropic.claude-opus-5-5-v1:0']) {
      const pricing = getExactModelPricing(model);
      assert.ok(pricing, model);
      assert.equal(pricing.input_cost_per_token, 4.4 / 1_000_000);
      assert.equal(pricing.output_cost_per_token, 22 / 1_000_000);
      assert.equal(pricing.cache_creation_input_token_cost, 5.5 / 1_000_000);
      assert.equal(pricing.cache_creation_1h_input_token_cost, 8.8 / 1_000_000);
      assert.equal(pricing.cache_read_input_token_cost, 0.22 / 1_000_000);
    }
    assert.equal(getExactModelPricing('claude-opus-5')?.input_cost_per_token, 5.5 / 1_000_000);
  } finally {
    setPricingBackend('anthropic');
  }
});

test('unknown-model warning retention and output are capped for a whole host lifetime', () => {
  // A fresh child models a fresh Extension Host, independently of test order.
  const report = JSON.parse(execFileSync(process.execPath, ['-e', `
    const pricing = require(${JSON.stringify(require.resolve('../pricing'))});
    let count = 0;
    let maxLength = 0;
    let suppression = 0;
    console.warn = (...args) => {
      count += 1;
      const message = args.join(' ');
      maxLength = Math.max(maxLength, message.length);
      if (message.includes('suppressed')) suppression += 1;
    };
    for (let index = 0; index < 100_000; index += 1) {
      pricing.getModelPricing('unknown-model-hotfix-' + index);
    }
    for (let index = 0; index < 50_000; index += 1) {
      pricing.getModelPricing('unknown-model-hotfix-0');
      pricing.getModelPricing('unknown-model-hotfix-' + (100_000 + index));
    }
    const known = pricing.getExactModelPricing('claude-opus-5');
    process.stdout.write(JSON.stringify({ count, maxLength, suppression, known }));
  `], { encoding: 'utf8', timeout: 20_000 }));
  assert.equal(report.count, 129, 'at most 128 model labels plus one suppression summary');
  assert.equal(report.suppression, 1, 'budget is not reset by label churn or refreshes');
  assert.ok(report.maxLength < 320);
  assert.equal(report.known.input_cost_per_token, 5 / 1_000_000);
});

test('oversized and non-model labels are not retained or echoed in pricing diagnostics', () => {
  const report = JSON.parse(execFileSync(process.execPath, ['-e', `
    const { getModelPricing } = require(${JSON.stringify(require.resolve('../pricing'))});
    let count = 0;
    let maxLength = 0;
    let leaked = false;
    console.warn = (...args) => {
      const message = args.join(' ');
      count += 1;
      maxLength = Math.max(maxLength, message.length);
      leaked ||= message.includes('sensitive-fixture') || message.includes('private-fixture') || message.includes('/private');
    };
    for (let index = 0; index < 200; index += 1) {
      getModelPricing('sensitive-fixture-' + 'x'.repeat(100_000) + index);
      getModelPricing('/private/fixture/user/model-' + index);
      getModelPricing('model\\nprivate-fixture-' + index);
    }
    process.stdout.write(JSON.stringify({ count, maxLength, leaked }));
  `], { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 }));
  assert.equal(report.count, 1);
  assert.ok(report.maxLength < 320);
  assert.equal(report.leaked, false);
});
