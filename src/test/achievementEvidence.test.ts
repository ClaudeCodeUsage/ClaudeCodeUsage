import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS } from '../achievements';

const proof = require('../achievementEvidence') as any;
const ready = () => Object.fromEntries(proof.ACHIEVEMENT_EVIDENCE_DOMAINS.map((domain: string) => [domain, 'ready']));

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
