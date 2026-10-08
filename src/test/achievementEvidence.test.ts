import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, evaluateAchievements, AchievementFacts } from '../achievements';

const proof = require('../achievementEvidence') as any;
const ready = () => Object.fromEntries(proof.ACHIEVEMENT_EVIDENCE_DOMAINS.map((domain: string) => [domain, 'ready']));

const usageFacts = (volume: number): AchievementFacts => ({
  claudeTokens: volume, codexTokens: 0, activeDays: 0, claudeFamilies: ['sonnet'],
  claudeFamilyTokens: { sonnet: volume }, claudeOutputTokens: 0, claudeCacheReadTokens: 0,
  codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
});
const usageDelta = (processed: number) => ({ provider: 'claude', after: 100, through: 200,
  processed, output: 0, cacheRead: 0, families: { sonnet: processed, opus: 0, haiku: 0, fable: 0 } });

test('Claude usage crossings require new tokens to be sufficient and necessary for each exact tier', () => {
  const before = evaluateAchievements(usageFacts(600_000_000));
  const after = evaluateAchievements(usageFacts(6_600_000_000));
  const ids = proof.claudeTailAchievementCrossings(before, after, usageDelta(6_000_000_000));
  assert.ok(ids.includes('sonnet-main-silver'));
  assert.equal(ids.includes('sonnet-main-gold'), false, 'gold still requires the approved 10B');
  assert.ok(ids.includes('billion-token-club'));
  assert.equal(ids.includes('sonnet-main'), false, 'an already earned tier is never new');
  assert.equal(ids.includes('active-days-bronze'), false);
  assert.deepEqual(proof.claudeTailAchievementCrossings(before, after, usageDelta(1)), [],
    'an unrelated one-token append cannot date the historical import');
  const assistedByHistory = evaluateAchievements(usageFacts(1_000_000_000));
  assert.deepEqual(proof.claudeTailAchievementCrossings(before, assistedByHistory,
    usageDelta(100_000_000)), [], 'new usage alone must cross the old verified baseline');
  const historyAlreadyEnough = evaluateAchievements(usageFacts(1_500_000_000));
  assert.deepEqual(proof.claudeTailAchievementCrossings(before, historyAlreadyEnough,
    usageDelta(400_000_000)), [], 'removing new tokens must remove the new tier');
});

test('Claude usage crossings cannot date other families, calendar, sessions, or Codex awards', () => {
  const before = evaluateAchievements(usageFacts(600_000_000));
  const facts = usageFacts(6_600_000_000);
  facts.claudeFamilyTokens!.opus = 10_000_000_000;
  facts.claudeOutputSessions = 10_000;
  facts.activeDays = 1_000;
  facts.codex.familyProcessedTokens = { astra: 10_000_000_000, sol: 0, luna: 0 };
  const ids = proof.claudeTailAchievementCrossings(before, evaluateAchievements(facts), usageDelta(6_000_000_000));
  assert.ok(ids.includes('sonnet-main-silver'));
  assert.equal(ids.some((id: string) => /opus|days|sessions|astra/.test(id)), false);
});

test('Claude usage crossings follow every approved volume tier without a duplicate threshold table', () => {
  for (const rule of ACHIEVEMENT_DEFINITIONS.filter((row) => row.id.startsWith('sonnet-main'))) {
    const before = evaluateAchievements(usageFacts(rule.target - 1));
    const after = evaluateAchievements(usageFacts(rule.target));
    assert.ok(proof.claudeTailAchievementCrossings(before, after, usageDelta(1)).includes(rule.id), rule.id);
    assert.equal(proof.claudeTailAchievementCrossings(after, after, usageDelta(1)).includes(rule.id), false);
  }
});

test('Claude usage crossings fail closed for malformed proof, mismatched targets and unsafe sums', () => {
  const before = evaluateAchievements(usageFacts(60_000_000));
  const after = evaluateAchievements(usageFacts(120_000_000));
  for (const delta of [undefined, { ...usageDelta(60_000_000), provider: 'codex' },
    { ...usageDelta(60_000_000), output: -1 }, { ...usageDelta(60_000_000), through: 50 },
    { ...usageDelta(60_000_000), output: 60_000_000, cacheRead: 60_000_000 },
    { ...usageDelta(60_000_000), families: { ...usageDelta(60_000_000).families, opus: 1 } },
    { ...usageDelta(60_000_000), processed: 0.5 }]) {
    assert.deepEqual(proof.claudeTailAchievementCrossings(before, after, delta), []);
  }
  const mismatched = after.map((row) => ({ ...row, target: row.target + 1 }));
  assert.deepEqual(proof.claudeTailAchievementCrossings(before, mismatched, usageDelta(60_000_000)), []);
  const duplicate = [...before, before[0]];
  assert.deepEqual(proof.claudeTailAchievementCrossings(duplicate, after, usageDelta(60_000_000)), []);
  const unsafeBefore = before.map((row) => row.id === 'trillion-token-club'
    ? { ...row, progress: 999_999_999_999 } : row);
  const unsafeAfter = after.map((row) => row.id === 'trillion-token-club'
    ? { ...row, progress: Number.MAX_SAFE_INTEGER } : row);
  assert.equal(proof.claudeTailAchievementCrossings(unsafeBefore, unsafeAfter,
    usageDelta(Number.MAX_SAFE_INTEGER)).includes('trillion-token-club'), false);
});

test('every achievement level has the correct independent evidence domain', () => {
  for (const rule of ACHIEVEMENT_DEFINITIONS) {
    assert.ok(proof.ACHIEVEMENT_EVIDENCE_DOMAINS.includes(proof.achievementEvidenceDomain(rule)), rule.id);
  }
  for (const [id, domain] of Object.entries({
    'astra-regular': 'codex-lineage', 'effort-spectrum': 'codex-lineage',
    'codex-output-bronze': 'codex-tokens', 'astra-days-bronze': 'codex-calendar',
    'sonnet-main': 'claude-usage', 'fable-days-bronze': 'claude-calendar',
    'weekly-volume-bronze': 'combined-calendar', 'billion-token-club': 'combined-usage',
    'output-hours-gold': 'hours', 'local-share-export': 'plugin',
  })) {
    assert.equal(proof.achievementEvidenceDomain(ACHIEVEMENT_DEFINITIONS.find(rule => rule.id === id)), domain);
  }
});

test('pending calendar proof cannot block a quiet lineage baseline or manufacture a calendar notice', () => {
  const baseline = new proof.AchievementNoticeBaseline();
  const states = ready(); states['codex-calendar'] = states['combined-calendar'] = 'pending';
  const before = baseline.accept(states);
  assert.equal(before.has('codex-lineage'), false, 'first history is quiet');
  const later = baseline.accept(states);
  assert.equal(later.has('codex-lineage'), true);
  assert.equal(later.has('combined-calendar'), false);
  states['combined-calendar'] = 'ready';
  assert.equal(baseline.accept(states).has('combined-calendar'), false, 'fresh date backfill is quiet');
  assert.equal(baseline.accept(states).has('combined-calendar'), true);
});

test('proof loss, failure, OFF and source reset require another quiet baseline', () => {
  const baseline = new proof.AchievementNoticeBaseline();
  const states = ready(); baseline.accept(states); baseline.accept(states);
  states['codex-lineage'] = 'stale';
  assert.equal(baseline.accept(states).has('codex-lineage'), false);
  states['codex-lineage'] = 'ready';
  assert.equal(baseline.accept(states).has('codex-lineage'), false, 'recovery is not new work');
  assert.equal(baseline.accept(states).has('codex-lineage'), true);
  baseline.reset();
  assert.equal(baseline.accept(states).size, 0);
  assert.equal(baseline.accept(states).size, proof.ACHIEVEMENT_EVIDENCE_DOMAINS.length);
});

test('provider-scoped retirement leaves unrelated ready domains eligible', () => {
  const baseline = new proof.AchievementNoticeBaseline();
  const states = ready(); baseline.accept(states); baseline.accept(states);
  baseline.reset(['codex-lineage', 'codex-tokens', 'codex-calendar', 'combined-usage', 'combined-calendar', 'hours']);
  const eligible = baseline.accept(states);
  assert.equal(eligible.has('claude-usage'), true);
  assert.equal(eligible.has('claude-calendar'), true);
  assert.equal(eligible.has('plugin'), true);
  assert.equal(eligible.has('codex-lineage'), false);
  assert.equal(eligible.has('hours'), false);
});
