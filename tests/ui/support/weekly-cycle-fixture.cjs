'use strict';

const { withCodexQuotaCycles } = require('../../../out/codexQuotaCycles');

// Public projection fixtures only: no account, provider home, archive or daemon IO.
exports.weeklyCycleFixture = (snapshot, now) => {
  const day = 86_400_000, entries = [];
  let endAt = now + day;
  for (let index = 0; index < 52; index++) {
    const startAt = endAt - (index % 2 ? 10 : 3) * day;
    const early = index === 1, scheduledResetAt = endAt + (early ? 2 * day : 0);
    const observedAt = Math.min(now - 3_600_000, endAt - 3_600_000);
    // The calibration observation can occur much later than the cycle start.
    const id = observedAt - 60_000;
    entries.push({ provider: 'codex', method: 'account-delta-v1', accountNumber: index % 2 + 1,
      sourceKey: 'synthetic-cycle-' + index, windowStart: startAt, resetAt: scheduledResetAt,
      observedAt, estimatedAt: observedAt, usedEquivalentUsd: 17,
      fullEquivalentUsd: 150, unusedEquivalentUsd: 90, utilizationPercent: 40, pricingCoverage: 1, flags: [],
      quotaEpoch: { startedAt: id, resetAnchorAt: scheduledResetAt, startLowerAt: null, reason: 'initial' },
      quotaCycle: { id, startAt, startLowerAt: early ? startAt - 60_000 : startAt,
        endAt, endLowerAt: index === 0 ? null : early ? endAt - 60_000 : endAt,
        closed: index > 0, scheduledResetAt, boundaryUncertain: early } });
    endAt = startAt;
  }
  const first = entries[0];
  entries.push({ ...first, observedAt: first.observedAt + 60_000, estimatedAt: first.estimatedAt + 60_000,
    fullEquivalentUsd: 160, unusedEquivalentUsd: 64, utilizationPercent: 60,
    quotaEpoch: { ...first.quotaEpoch, startedAt: first.observedAt - 30_000 } });
  entries.push(...withCodexQuotaCycles([{ ...entries[51], method: 'series-prefix-v1', accountNumber: undefined,
    quotaEpoch: undefined, quotaCycle: undefined, observedAt: entries[51].observedAt - 1000,
    resetAt: entries[51].resetAt - 1000 }], [], () => undefined, now));
  return { snapshot, projector: () => (provider) => provider === 'codex'
    ? { entries, status: 'ready' } : { entries: [], status: 'ready' } };
};

// Twenty-four days across four UTC weeks with changing reset timestamps and four samples
// per day. These legacy references have no recoverable account/reset episode.
exports.weeklyReferenceFixture = (snapshot, now) => {
  const day = 86_400_000, start = Date.parse('2026-06-22T00:00:00Z'), raw = [];
  for (let index = 0; index < 24 * 4; index++) {
    const observedAt = start + Math.floor(index / 4) * day + (index % 4 + 1) * 3_600_000;
    const resetAt = observedAt + 6 * day + index * 60_000;
    raw.push({ provider: 'codex', method: 'series-prefix-v1', sourceKey: 'synthetic-legacy-' + index,
      windowStart: resetAt - 7 * day, resetAt, observedAt, estimatedAt: observedAt,
      usedEquivalentUsd: 17, fullEquivalentUsd: 100 + index, unusedEquivalentUsd: 40,
      utilizationPercent: 60, pricingCoverage: 1, flags: [] });
  }
  // A newer unusable observation must not suppress the last valid estimate.
  raw.push({ ...raw.at(-1), observedAt: raw.at(-1).observedAt + 60_000,
    fullEquivalentUsd: null, unusedEquivalentUsd: null });
  const entries = withCodexQuotaCycles(raw, [], () => undefined, now);
  return { snapshot, raw, projector: () => (provider) => provider === 'codex'
    ? { entries, status: 'ready' } : { entries: [], status: 'ready' } };
};
