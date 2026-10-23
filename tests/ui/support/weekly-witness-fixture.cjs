'use strict';

const assert = require('node:assert/strict');
const { buildCodexWitnessLedger } = require('../../../out/codexWitnessCycles');
const { buildWitnessWeeklyEstimates } = require('../../../out/weeklyEstimate');

// Synthetic request vectors go through the actual witness ledger and estimate
// adapter. No provider home, archive, pricing cache, account or daemon I/O.
exports.weeklyWitnessFixture = (snapshot, now, updated = false) => {
  const day = 86400000, resetAt = now + day;
  const book = { schemaVersion: 1, parserVersion: 4, periodVersion: 1,
    rates: [{ model: 'known', input: .01, cachedInput: .001, output: .02 }] };
  const vector = inputTotal => ({ inputTotal, cachedInput: 0, outputTotal: 0, reasoningOutput: 0 });
  const models = (model, tokens) => ({ [model]: vector(tokens) });
  const row = (model, tokens, segment, from, through, reset, usedPercent, baseline) => ({
    segment, from, through, resetAt: reset, usedPercent, baseline, complete: true,
    byModel: baseline ? {} : models(model, tokens),
    ...(baseline ? { baselineByModel: models(model, tokens) } : {}),
  });
  const first = now - day, next = now - day / 2, through = now - (updated ? 1800000 : 3600000);
  const baseline = updated ? 700 : 800, delta = updated ? 1200 : 900, priced = baseline + delta;
  const unpriced = priced * 9;
  const sources = [
    { rows: [row('known', 1700, 0, first, first, resetAt, 90, false),
      row('known', baseline, 1, next, next, resetAt, 10, true),
      row('known', delta, 1, next, through, resetAt, 40, false)], primaryByModel: models('known', 1700 + priced) },
    { rows: [row('unpriced', 15300, 0, first, first, resetAt, 90, false),
      row('unpriced', 0, 1, next, next, resetAt, 10, true),
      row('unpriced', unpriced, 1, next, through, resetAt, 40, false)], primaryByModel: models('unpriced', 15300 + unpriced) },
  ];
  // Six real reset anchors make the compact chart scroll at 320px. The first
  // two episodes above share a reset anchor, but the 90% → 10% transition
  // proves separate episodes. Only the earlier episode lacks its baseline.
  for (let index = 1; index <= 6; index++) {
    const from = now - index * 7 * day, reset = from + 5 * day;
    sources.push({ rows: [row('known', 800, 0, from, from, reset, 10, true),
      row('known', 900, 0, from, from + day, reset, 40, false)], primaryByModel: models('known', 1700) });
  }
  const ledger = buildCodexWitnessLedger(sources, book, { now, unavailableSources: 3 });
  const entries = buildWitnessWeeklyEstimates(ledger.cycles, {
    now, windowKey: (reset, from) => 'synthetic-witness-' + reset + '-' + from,
  }).map(({ localWindowKey, ...entry }, index) => ({ ...entry, localWindowNumber: index + 1 }));
  assert.equal(entries.length, 8);
  const sameReset = entries.filter(entry => entry.resetAt === resetAt);
  assert.equal(sameReset.length, 2);
  assert.equal(sameReset[0].fullEquivalentUsd, null);
  assert.equal(sameReset[0].usedEquivalentUsd, 17);
  assert.equal(sameReset[1].fullEquivalentUsd, updated ? 40 : 30);
  assert.equal(sameReset[1].usedEquivalentUsd, updated ? 19 : 17);
  assert.equal(sameReset[1].pricingCoverage, .1);
  const projection = { entries, status: 'ready', codexWitnessCoverage: ledger.coverage };
  return {
    snapshot: { ...snapshot, weeklyValueInputs: { observations: [], usage: [],
      codexWitnessCycles: ledger.cycles, codexWitnessCoverage: ledger.coverage } },
    projector: () => provider => provider === 'codex' ? projection : { entries: [], status: 'ready' },
  };
};
