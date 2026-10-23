import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projectWeeklyEstimateChart } from '../weeklyEstimateChart';
import { I18n } from '../i18n';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';
import { buildWitnessWeeklyEstimates } from '../weeklyEstimate';
import type { CodexWitnessCycle } from '../codexWitnessCycles';
import { copyCodexWitnessCycle } from '../codexWitnessCycles';
import type { SupportedLanguage } from '../types';

const loader = require('node:module'), original = loader._load;
loader._load = function(name: string, ...args: unknown[]) { return name === 'vscode' ? {} : original.call(this, name, ...args); };
let Provider: typeof import('../webview').UsageWebviewProvider;
try { Provider = require('../webview').UsageWebviewProvider; } finally { loader._load = original; }
const D = 86400000, N = Date.parse('2026-10-23T12:00Z'), R = N + D;
function entry(capacity: number | null = null, extra: Partial<CodexWitnessCycle> = {}): LocalWeeklyEstimate {
  const witness: CodexWitnessCycle = { schemaVersion: 1,
    pricebook: { schemaVersion: 1, parserVersion: 4, periodVersion: 1, rates: [{ model: 'known', input: .01, cachedInput: .001, output: .02 }] },
    requestedThrough: N, cycleStartAt: null, cycleStartLowerAt: null, cycleEndAt: R, cycleEndLowerAt: R, closed: false,
    resetAt: R, from: N - D, through: N - 1000, percentFrom: 10, percentThrough: 40,
    knownUsd: 17, deltaUsd: 9, knownTokens: 100, unpricedTokens: 900, pricingCoverage: .1,
    referenceCapacityUsd: capacity, partial: true, sources: 2, segments: 2, baselineMissing: capacity === null,
    counterConflict: false, unavailableSources: 3, ...extra };
  assert.ok(copyCodexWitnessCycle(witness), 'fixture is valid retained witness evidence');
  const [result] = buildWitnessWeeklyEstimates([witness], { now: N, windowKey: (reset, from) => 'fixture-' + reset + '-' + from });
  assert.ok(result);
  return result;
}
function owner(entries: LocalWeeklyEstimate[]): any {
  const p: any = Object.create(Provider.prototype);
  p.setting = (_key: string, fallback: unknown) => fallback;
  p.weeklyValueInputs = () => ({ observations: [], usage: [] });
  p.weeklyEstimateProjector = () => ({ entries, status: 'ready' });
  return p;
}
test('legacy pending cycles retain their existing inferred-use legend',()=>{
 const clock=Date.now;Date.now=()=>N;
 try{
  const legacy:LocalWeeklyEstimate={...entry(),method:'legacy-prefix-ratio',witnessCycle:undefined};
  const html=owner([legacy]).renderWeeklyValuePanel('codex');
  const legend=html.match(/<div class="stack-legend">([\s\S]*?)<\/div>/)?.[1]??'';
  assert.ok(legend.includes(I18n.t.weeklyValue.inferredUsed));
  assert.ok(legend.includes(I18n.t.weeklyValue.estimateUnused));
 }finally{Date.now=clock;}
});

test('witness without F projects known priced usage, never a fabricated zero or calendar fallback', () => {
  const e = entry(), before = JSON.stringify(e);
  const [p] = projectWeeklyEstimateChart('codex', [], [e], { now: N });
  assert.equal(p.usedEquivalentUsd, 17);
  assert.equal(p.usageAvailable, true);
  assert.equal(p.fullEquivalentUsd, null);
  assert.equal(p.unusedEquivalentUsd, null);
  assert.equal(p.quotaCycle?.id, e.witnessCycle!.from);
  assert.equal(p.quotaCycle?.fallbackDays, undefined);
  assert.deepEqual((p as typeof p & { witnessCycle?: CodexWitnessCycle }).witnessCycle, e.witnessCycle);
  assert.equal(JSON.stringify(e), before);
});

test('conditional F keeps inferred stack distinct from observed U despite low coverage', () => {
  const e = entry(30), [p] = projectWeeklyEstimateChart('codex', [], [e], { now: N });
  assert.equal(p.fullEquivalentUsd, 30);
  assert.equal(p.usedEquivalentUsd, 12);
  assert.equal(p.unusedEquivalentUsd, 18);
  assert.equal((p as typeof p & { witnessCycle?: CodexWitnessCycle }).witnessCycle?.knownUsd, 17);
  assert.equal(p.pricingCoverage, .1);
});

test('zero witnessed priced usage stays numeric while capacity and unpriced amounts remain unknown', () => {
  const e = entry(null, { knownUsd: 0, deltaUsd: 0, knownTokens: 0, pricingCoverage: 0 });
  const [p] = projectWeeklyEstimateChart('codex', [], [e], { now: N });
  assert.equal(p.usedEquivalentUsd, 0);
  assert.equal(p.usageAvailable, true);
  assert.equal(p.fullEquivalentUsd, null);
  assert.equal(p.unusedEquivalentUsd, null);
});

test('witness details use the actual endpoint, not the requested later observation time', () => {
  const language = I18n.getCurrentLanguage(), clock = Date.now; Date.now = () => N;
  try {
    I18n.setLanguage('en');
    const e = entry(null, { through: N - D / 8 }), p = owner([e]);
    const html = p.renderWeeklyValuePanel('codex');
    assert.ok(html.includes(p.cycleDate(e.witnessCycle!.through)));
    assert.ok(!html.includes(p.cycleDate(e.witnessCycle!.requestedThrough)));
    assert.ok(!html.includes(I18n.t.weeklyValue.estimateBoundarySplit));
  } finally { Date.now = clock; I18n.setLanguage(language); }
});

test('witness evidence expansion identity survives a shifted first endpoint within the same reset episode', () => {
  const clock = Date.now; Date.now = () => N;
  try {
    const keys = [];
    for (const start of [null, N - D / 2]) {
      const from = start ?? N - D;
      const before = entry(30, { from, cycleStartAt: start, cycleStartLowerAt: start });
      const after = entry(30, { from: from + 1000, cycleStartAt: start, cycleStartLowerAt: start });
      const key = (e: LocalWeeklyEstimate) => owner([e]).renderWeeklyValuePanel('codex')
        .match(/data-persist="(quota-evidence-codex-[^"]+)"/)?.[1];
      assert.ok(key(before));
      assert.equal(key(after), key(before), 'compaction does not close the same episode disclosure');
      keys.push(key(before));
    }
    assert.notEqual(keys[0], keys[1], 'distinct same-reset episodes retain separate disclosure keys');
  } finally { Date.now = clock; }
});

test('declared witness projection replaces obsolete forward calibration status without assigning USD to the official account', () => {
  const language = I18n.getCurrentLanguage(), clock = Date.now; Date.now = () => N;
  try { for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'] as SupportedLanguage[]) {
    I18n.setLanguage(locale);
    for (const capacity of [null, 30]) {
      const p = owner([]);
      p.setting = (key: string, fallback: unknown) => key === 'codex.officialQuota.enabled' ? true : fallback;
      const html = p.renderOfficialWeeklyQuota('codex', { status: 'ready', entries: [entry(capacity)], activeAccountNumber: 2,
        codexWitnessCoverage: { unplacedSources: 1, unlocatedPrimaryUsd: 5, unlocatedUnpricedTokens: 20, rejectedSources: 3 },
        officialQuota: { status: 'ready', accountNumber: 2, resetAt: R, observedAt: N, usedPercent: 40,
          calibration: { state: 'source-unavailable', deltaPercent: 0, intervals: 0 } } });
      assert.ok(!html.includes(I18n.t.weeklyValue.calibrationSourceUnavailable), locale);
      assert.ok(!html.includes(I18n.t.weeklyValue.calibrationCalibrated), locale);
      assert.ok(html.includes(I18n.t.weeklyValue.officialQuotaTitle), locale);
      assert.ok(html.includes(I18n.t.weeklyValue.localAmountUnattributed), locale);
      assert.ok(html.includes(I18n.t.weeklyValue.observedPricedUsage), locale);
      assert.ok(html.includes(I18n.t.weeklyValue.pricingCoverage), locale);
      assert.match(html, /data-witness-status/);
      const official = html.split('</p>')[0];
      assert.ok(!official.includes(I18n.formatCurrency(17).replace(/^≈/, '')), 'local USD is separate from official quota');
    }
  } } finally { Date.now = clock; I18n.setLanguage(language); }
});

test('declared coverage with no placed witness reports unlocated usage rather than an unavailable local source', () => {
  const language = I18n.getCurrentLanguage(), clock = Date.now; Date.now = () => N;
  try {
    I18n.setLanguage('en'); const p = owner([]);
    p.setting = (key: string, fallback: unknown) => key === 'codex.officialQuota.enabled' ? true : fallback;
    const html = p.renderOfficialWeeklyQuota('codex', { status: 'ready', entries: [],
      codexWitnessCoverage: { unplacedSources: 1, unlocatedPrimaryUsd: 5, unlocatedUnpricedTokens: 20, rejectedSources: 3 },
      officialQuota: { status: 'ready', accountNumber: 2, resetAt: R, observedAt: N, usedPercent: 40,
        calibration: { state: 'source-unavailable', deltaPercent: 0, intervals: 0 } } });
    assert.doesNotMatch(html, /Local usage source unavailable|Collecting samples|Paired calibration available/);
    assert.match(html, /Priced usage outside located cycles: \$5\.00/);
    assert.match(html, /Unpriced tokens outside located cycles: 20/);
    assert.match(html, /Excluded sources: 3/);
  } finally { Date.now = clock; I18n.setLanguage(language); }
});

test('same-reset witness episodes have one bar and row each; no extra local usage chart', () => {
  const language = I18n.getCurrentLanguage(), clock = Date.now; Date.now = () => N;
  try {
    I18n.setLanguage('en');
    const a = entry(null, { through: N - D * .75, cycleEndAt: N - D / 2, cycleEndLowerAt: N - D / 2, closed: true });
    const b = entry(30, { from: N - D / 2, cycleStartAt: N - D / 2, cycleStartLowerAt: N - D / 2 });
    const html = owner([a, b, { ...b }]).renderWeeklyValuePanel('codex');
    assert.equal((html.match(/class="stack-bar"/g) ?? []).length, 2);
    assert.equal((html.match(/data-codex-cycle-summary-row/g) ?? []).length, 2);
    assert.equal((html.match(/data-codex-cycle-chart/g) ?? []).length, 1);
    assert.doesNotMatch(html, /data-cycle-pending|data-weekly-actual-chart|weekly-value-details|data-cycle-monetary-pending/);
    assert.match(html, /Observed priced usage/);
    assert.match(html, /Inferred used \(estimate\): \$12\.00/);
    assert.match(html, /Observed priced usage: \$17\.00/);
    assert.match(html, /Priced interval change: \$9\.00/);
    assert.match(html, /Unpriced tokens: 900/);
    assert.match(html, /Excluded sources: 3/);
    assert.match(html, /Priced coverage: 10%/);
    assert.match(html, /Request witness · conditional reference estimate/);
    assert.match(html, /height:68\.00px/); // Observed 17 / capacity-axis 30 * 120.
    assert.match(html, /height:48\.00px/); // Inferred 12 / 30 * 120.
    assert.equal((html.match(/<td class="cost-cell">\$17\.00<\/td>/g) ?? []).length, 2);
    const keys = [...html.matchAll(/data-persist="(quota-evidence-codex-[^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(keys).size, 2);
  } finally { Date.now = clock; I18n.setLanguage(language); }
});

test('witness amount and diagnostics remain visible for unidentified accounts in eight locales', () => {
  const language = I18n.getCurrentLanguage(), clock = Date.now; Date.now = () => N;
  try { for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'] as SupportedLanguage[]) {
    I18n.setLanguage(locale);
    const html = owner([entry()]).renderWeeklyValuePanel('codex');
    assert.ok(html.includes(I18n.t.weeklyValue.accountUnassigned), locale);
    assert.ok(html.includes(I18n.t.weeklyValue.pricingCoverage), locale);
    assert.ok(html.includes(I18n.t.weeklyValue.evidenceIncomplete), locale);
    for (const key of ['observedPricedUsage', 'witnessDelta', 'witnessMethod', 'witnessUnpricedTokens',
      'witnessExcludedSources', 'witnessBaselineMissing', 'witnessNote'] as const) {
      assert.ok(I18n.t.weeklyValue[key].trim(), locale + '.' + key);
      assert.ok(html.includes(I18n.t.weeklyValue[key]), locale + '.' + key);
    }
    assert.ok(html.includes(I18n.formatCurrency(17).replace(/^≈/, '')), locale);
    assert.match(html, /data-witness-known-usage/);
    assert.match(html, /data-witness-delta/);
    assert.match(html, /data-witness-unpriced-tokens/);
    assert.match(html, /data-witness-excluded-sources/);
    assert.doesNotMatch(html, /data-cycle-pending/);
    const bar = html.match(/class="stack-bar"[^>]+title="([^"]+)"/)?.[1];
    assert.ok(bar?.includes(I18n.t.weeklyValue.observedPricedUsage));
    assert.ok(!bar?.includes(I18n.t.weeklyValue.inferredUsed));
  } } finally { Date.now = clock; I18n.setLanguage(language); }
});
