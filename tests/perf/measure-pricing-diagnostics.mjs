// Safe reproduction of #122: count console calls instead of forwarding them
// into VS Code. No user history, renderer IPC, network, or credential access.
// npm run compile && node --expose-gc tests/perf/measure-pricing-diagnostics.mjs
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { calculateCostFromTokens, calculateCostBreakdown, getModelPricing } = require('../../out/pricing.js');
const originalWarn = console.warn;
let warnings = 0;
let maxWarningChars = 0;
console.warn = (...args) => {
  warnings += 1;
  maxWarningChars = Math.max(maxWarningChars, args.join(' ').length);
};
const usage = { input_tokens: 1_000, output_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 800 };
const measurements = [];
function measure(label, work) {
  global.gc?.();
  const initial = process.memoryUsage().heapUsed;
  const initialWarnings = warnings;
  const started = performance.now();
  work();
  const elapsedMs = Math.round(performance.now() - started);
  global.gc?.();
  measurements.push({ label, elapsedMs, warnings: warnings - initialWarnings, retainedHeapDeltaBytes: process.memoryUsage().heapUsed - initial });
}
try {
  measure('50k Opus 5.5 records, three pricing passes', () => {
    for (let index = 0; index < 50_000; index += 1) {
      calculateCostFromTokens(usage, 'claude-opus-5-5');
      calculateCostBreakdown(usage, 'claude-opus-5-5');
      calculateCostBreakdown(usage, 'claude-opus-5-5[1m]');
    }
  });
  measure('50k records per new Sol/Luna/Sonnet model, three pricing passes', () => {
    for (const model of ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'claude-sonnet-5-5']) {
      for (let index = 0; index < 50_000; index += 1) {
        calculateCostFromTokens(usage, model);
        calculateCostBreakdown(usage, model);
        getModelPricing(model);
      }
    }
  });
  measure('50k unknown-model records, three pricing passes', () => {
    for (let index = 0; index < 50_000; index += 1) {
      calculateCostFromTokens(usage, 'claude-opus-99-performance-fixture');
      calculateCostBreakdown(usage, 'claude-opus-99-performance-fixture');
      getModelPricing('claude-opus-99-performance-fixture');
    }
  });
  measure('one million distinct future model labels', () => {
    for (let index = 0; index < 1_000_000; index += 1) {
      getModelPricing(`future-model-performance-${index}`);
    }
  });
} finally {
  console.warn = originalWarn;
}
process.stdout.write(`${JSON.stringify({ measurements, maxWarningChars, node: process.version }, null, 2)}\n`);
