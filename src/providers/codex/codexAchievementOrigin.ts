import type { NormalizedUsageEvent } from '../providerTypes';
import type { CodexFileAggregate, CodexFileContribution, CodexIndexV3 } from './codexIndex';
import { codexModelFamily, normalizeCodexAchievementModel } from '../../achievementModels';
import { validAchievementTokenVector, verifiedCodexAchievementFiles } from '../../codexAchievementProof';
import { classifyCodexSessionDuplicates } from './codexDedup';
import { getAchievementMoneyPricebook, priceAchievementModelBucket } from '../../achievementMoney';
import { codexMoneyEvidenceFromModels } from '../../achievementMoneyScopes';
import { accumulateMoneyProof, copyMoneyProofs, type AchievementMoneyProofs } from '../../achievementMoneyOrigin';

export interface CodexAchievementUsageWindow { after: number; through: number }
/** Runtime-only numeric lower bound; never part of an index/checkpoint. */
export interface CodexAchievementUsageDelta extends CodexAchievementUsageWindow {
  provider: 'codex'; processed: number; output: number; cacheRead: number;
  families: Record<'astra' | 'sol' | 'luna', number>;
  money?: AchievementMoneyProofs;
}
const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export function copyCodexUsageWindow(value: unknown): CodexAchievementUsageWindow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { after, through } = value as CodexAchievementUsageWindow;
  return count(after) && count(through) && after < through && through <= 8.64e15
    ? { after, through } : undefined;
}
export function emptyCodexUsageDelta(window: CodexAchievementUsageWindow): CodexAchievementUsageDelta {
  return { provider: 'codex', after: window.after, through: window.through, processed: 0, output: 0, cacheRead: 0,
    families: { astra: 0, sol: 0, luna: 0 } };
}
/** Rebuild allowlisted fields at every worker boundary; no arbitrary extras. */
export function copyCodexUsageDelta(value: unknown, window: CodexAchievementUsageWindow | undefined): CodexAchievementUsageDelta | undefined {
  if (!copyCodexUsageWindow(window) || !window || !value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as CodexAchievementUsageDelta;
  if (row.provider !== 'codex' || row.after !== window.after || row.through !== window.through ||
      !count(row.processed) || !count(row.output) || !count(row.cacheRead) ||
      !count(row.output + row.cacheRead) || row.output + row.cacheRead > row.processed ||
      !row.families || typeof row.families !== 'object' || Array.isArray(row.families)) return undefined;
  const families = { astra: row.families.astra, sol: row.families.sol, luna: row.families.luna };
  if (!Object.values(families).every(count) || !count(families.astra + families.sol + families.luna) ||
      families.astra + families.sol + families.luna > row.processed) return undefined;
  const money = copyMoneyProofs(row.money, 'codex', row.processed);
  return { provider: 'codex', after: window.after, through: window.through,
    processed: row.processed, output: row.output, cacheRead: row.cacheRead, families,
    ...(money ? { money } : {}) };
}
export function addCodexUsageDelta(target: CodexAchievementUsageDelta, addition: CodexAchievementUsageDelta): boolean {
  const old = copyCodexUsageDelta(target, target), incoming = copyCodexUsageDelta(addition, target);
  if (!old || !incoming) return false;
  const next = { ...old, processed: old.processed + incoming.processed,
    output: old.output + incoming.output, cacheRead: old.cacheRead + incoming.cacheRead,
    families: { astra: old.families.astra + incoming.families.astra,
      sol: old.families.sol + incoming.families.sol, luna: old.families.luna + incoming.families.luna } };
  const proof = incoming.money?.openai
    ? accumulateMoneyProof(old.money?.openai, incoming.money.openai) : old.money?.openai;
  delete next.money;
  if (proof) next.money = { openai: proof };
  if (!copyCodexUsageDelta(next, target)) return false;
  delete target.money;
  Object.assign(target, next); return true;
}
/** Called only for events emitted by the established main tail parser. */
export function addCodexOriginEvent(target: CodexAchievementUsageDelta, event: NormalizedUsageEvent): boolean {
  if (event.timestamp <= target.after || event.timestamp > target.through) return true;
  if (!count(event.timestamp) || !validAchievementTokenVector(event.tokens)) return false;
  const addition = emptyCodexUsageDelta(target);
  addition.processed = event.tokens.inputTotal + event.tokens.outputTotal;
  addition.output = event.tokens.outputTotal;
  addition.cacheRead = event.tokens.cachedInput ?? 0;
  const model = event.model && normalizeCodexAchievementModel(event.model);
  const family = model ? codexModelFamily(model) : null;
  if (family) addition.families[family] = addition.processed;
  if (event.provider === 'codex') {
    // Unknown aliases and non-native cache buckets remain an excluded subset.
    // Invalid optional pricing must never suppress a sound native Token event.
    try {
      const priced = priceAchievementModelBucket({ provider: 'codex', model: event.model, tokens: event.tokens }, 'openai');
      if (priced.reason === null && priced.microUsd !== null && priced.pricedTokens > 0) addition.money = { openai: {
        provider: 'codex', backend: 'openai', pricebookVersion: getAchievementMoneyPricebook('openai').version,
        exactMicroUsdUnits: priced.exactMicroUsdUnits, microUsd: priced.microUsd, eligibleProcessed: priced.pricedTokens,
      } };
    } catch { /* native Token proof remains usable */ }
  }
  return addCodexUsageDelta(target, addition);
}
function stableContribution(row: CodexFileContribution): boolean {
  return (row.compression !== 'zstd' || row.compressionVerified === true) &&
    row.offset === row.size && !row.discardingOversizedLine && row.identityChecked === true &&
    row.parserState.schemaVersion === 4 && row.parserState.identityLocked === true &&
    !row.lineageReconciliation && !!row.lineage && row.lineage.appliedPrefixEvents === row.lineage.desiredPrefixEvents &&
    !row.qualityFlags.some(flag => ['stale-file', 'stale-reset-required', 'oversized-jsonl-line',
      'invalid-event-timestamp', 'counter-regression', 'component-delta-clamped', 'invalid-token-count',
      'invalid-session-meta', 'identity-conflict'].includes(flag));
}
/** Full base coverage, independent of globally incomplete calendar/identity proof. */
export function codexOriginBaselineReady(index: CodexIndexV3): boolean {
  return index.coverage.complete && index.coverage.indexedFiles === index.coverage.totalFiles &&
    Object.keys(index.files).length === index.coverage.totalFiles &&
    Object.values(index.files).every(row => (row.compression !== 'zstd' || row.compressionVerified === true) &&
      row.offset === row.size && !row.discardingOversizedLine);
}
function trustedContributions(index: CodexIndexV3): Set<CodexFileContribution> {
  const keys = classifyCodexSessionDuplicates(index.files).canonicalFileKeys;
  const rows = [...keys].map(key => index.files[key]);
  const verified = new Set(verifiedCodexAchievementFiles(rows.map(row => row.aggregate)));
  const stable = rows.filter(row => verified.has(row.aggregate) && stableContribution(row));
  // Removing an unsettled ancestor also excludes its descendants.
  const sound = new Set(verifiedCodexAchievementFiles(stable.map(row => row.aggregate)));
  return new Set(stable.filter(row => sound.has(row.aggregate)));
}
function aggregateVolume(aggregate: CodexFileAggregate, window: CodexAchievementUsageWindow): CodexAchievementUsageDelta {
  const volume = emptyCodexUsageDelta(window);
  volume.processed = aggregate.total.inputTotal + aggregate.total.outputTotal;
  volume.output = aggregate.total.outputTotal;
  volume.cacheRead = aggregate.total.cachedInput ?? 0;
  for (const [label, tokens] of Object.entries(aggregate.byModel)) {
    const model = normalizeCodexAchievementModel(label);
    const family = model ? codexModelFamily(model) : null;
    if (family) volume.families[family] += tokens.inputTotal + tokens.outputTotal;
  }
  return volume;
}
/** The coordinator admits only unchanged physical ownership and settled prefixes. */
export function finalizeCodexUsageDelta(previous: CodexIndexV3, current: CodexIndexV3,
  candidates: ReadonlyMap<string, CodexAchievementUsageDelta>, window: CodexAchievementUsageWindow | undefined,
): CodexAchievementUsageDelta | undefined {
  if (!window || !candidates.size || !codexOriginBaselineReady(previous) || !codexOriginBaselineReady(current) ||
      previous.coverage.period.timeZone !== current.coverage.period.timeZone) return undefined;
  const before = trustedContributions(previous), after = trustedContributions(current);
  const total = emptyCodexUsageDelta(window);
  for (const [key, raw] of candidates) {
    const old = previous.files[key], next = current.files[key];
    const delta = copyCodexUsageDelta(raw, window);
    if (!delta || !old || !next || !before.has(old) || !after.has(next) ||
        !(old.dev! > 0 && old.ino! > 0) || old.dev !== next.dev || old.ino !== next.ino ||
        old.aggregate.session.sessionKey !== next.aggregate.session.sessionKey ||
        old.aggregate.session.parentSessionKey !== next.aggregate.session.parentSessionKey ||
        old.lineage!.appliedPrefixEvents !== next.lineage!.appliedPrefixEvents) continue;
    const oldVolume = aggregateVolume(old.aggregate, window), newVolume = aggregateVolume(next.aggregate, window);
    if (!copyCodexUsageDelta(oldVolume, window) || !copyCodexUsageDelta(newVolume, window)) continue;
    if ((['processed', 'output', 'cacheRead'] as const).some(field =>
      newVolume[field] - oldVolume[field] < delta[field]) ||
      (['astra', 'sol', 'luna'] as const).some(family =>
        newVolume.families[family] - oldVolume.families[family] < delta.families[family])) continue;
    if (delta.money?.openai) {
      // Price ONLY the affected admitted candidate's already materialized model
      // aggregates. Same frozen book on both sides; exact units, never a sum of
      // per-event floors. Reconciliation failure removes only this money subset.
      const oldMoney = codexMoneyEvidenceFromModels(old.aggregate.byModel, 'openai');
      const newMoney = codexMoneyEvidenceFromModels(next.aggregate.byModel, 'openai');
      const proof = delta.money.openai;
      if (oldMoney.status === 'invalid' || newMoney.status === 'invalid' ||
          oldMoney.pricebookVersion !== proof.pricebookVersion || newMoney.pricebookVersion !== proof.pricebookVersion ||
          newMoney.pricedTokens! - oldMoney.pricedTokens! < proof.eligibleProcessed ||
          BigInt(newMoney.exactMicroUsdUnits!) - BigInt(oldMoney.exactMicroUsdUnits!) < BigInt(proof.exactMicroUsdUnits)) delete delta.money;
    }
    if (!addCodexUsageDelta(total, delta)) return undefined;
  }
  return total.processed > 0 ? total : undefined;
}
