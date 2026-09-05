import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  freshInputPlusOutput,
  processedTokens,
} from '../providers/providerTypes';

test('Codex subsets are not double-counted', () => {
  const tokens = {
    inputTotal: 1_000,
    cachedInput: 800,
    outputTotal: 200,
    reasoningOutput: 120,
  };

  assert.equal(processedTokens(tokens), 1_200);
  assert.equal(freshInputPlusOutput(tokens), 400);
});

test('invalid subset values are clamped without inventing negative usage', () => {
  assert.equal(
    freshInputPlusOutput({
      inputTotal: 10,
      cachedInput: 20,
      outputTotal: 2,
    }),
    2,
  );
});
