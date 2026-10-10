import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createClaudeUsageIndex, updateClaudeUsageIndex } from '../claudeIncrementalIndex';
import { getAchievementMoneyPricebook } from '../achievementMoney';
import * as moneyPricing from '../achievementMoney';
import { claudeAchievementMoneyScopes, codexAchievementMoneyScopes, codexMoneyEvidenceFromModels } from '../achievementMoneyScopes';
import { accumulateMoneyProof, copyMoneyProof, copyMoneyProofs, cumulativeCrossings, validateMoneyProof } from '../achievementMoneyOrigin';
import { addCodexOriginEvent, addCodexUsageDelta, copyCodexUsageDelta, emptyCodexUsageDelta, finalizeCodexUsageDelta } from '../providers/codex/codexAchievementOrigin';
import { createEmptyCodexIndex, updateCodexIndex } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import type { NormalizedUsageEvent } from '../providers/providerTypes';

const window = { after: Date.parse('2026-10-09T01:00:00Z'), through: Date.parse('2026-10-09T02:00:00Z') };
const SCALE = 10n ** 18n;
function claudeLine(id: string, input = 1, read = 0, creation = 0, ttl = true, model = 'claude-sonnet-4-5', live = true): string {
  return JSON.stringify({ type: 'assistant', requestId: `req-${id}`, timestamp: live ? '2026-10-09T01:30:00Z' : '2026-10-09T00:00:00Z',
    cwd: '/fixture', message: { id: `msg-${id}`, model, content: [], usage: { input_tokens: input, output_tokens: 0,
      cache_read_input_tokens: read, cache_creation_input_tokens: creation,
      ...(ttl ? { cache_creation: { ephemeral_5m_input_tokens: creation, ephemeral_1h_input_tokens: 0 } } : {}) } } }) + '\n';
}
async function claudeFixture(run: (f: { root: string; file: string; baseline: Awaited<ReturnType<typeof updateClaudeUsageIndex>> }) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-money-origin-'));
  try {
    const project = path.join(root, 'projects', '-fixture'); await mkdir(project, { recursive: true });
    const file = path.join(project, 'session.jsonl'); await writeFile(file, claudeLine('base', 1, 0, 0, true, undefined, false));
    const baseline = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: false });
    await run({ root, file, baseline });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('real Claude tail prices only new accepted TTL-complete responses with two frozen backends', async () => {
  await claudeFixture(async ({ root, file, baseline }) => {
    const tail = claudeLine('a', 0, 1) + claudeLine('b', 0, 1) + claudeLine('c', 0, 1) + claudeLine('d', 0, 1)
      + claudeLine('missing-ttl', 999_999, 0, 1, false) + claudeLine('unknown', 999_999, 0, 0, true, 'future-model')
      + claudeLine('high-input', 300_000) + claudeLine('ttl', 0, 0, 2) + claudeLine('a', 0, 1)
      + claudeLine('history', 99_999_999, 0, 0, true, undefined, false);
    await appendFile(file, tail);
    const result = await updateClaudeUsageIndex(baseline.index, root, { analyzeContent: false, achievementUsageWindow: window });
    const money = result.achievementUsageDelta?.money;
    assert.equal(money?.anthropic?.microUsd, 900_008);
    assert.equal(money?.anthropic?.exactMicroUsdUnits, String(900_008_700n * SCALE / 1000n));
    assert.equal(money?.anthropic?.eligibleProcessed, 300_006);
    assert.equal(money?.['aws-bedrock-in-region']?.microUsd, 990_009);
    assert.equal(money?.['aws-bedrock-in-region']?.exactMicroUsdUnits, String(990_009_570n * SCALE / 1000n));
    assert.equal(result.diagnostics.bodyReads, 1); assert.equal(result.diagnostics.bytesRead, Buffer.byteLength(tail));
    assert.equal('money' in result.index, false);
    const warm = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false, achievementUsageWindow: window });
    assert.equal(warm.diagnostics.bodyReads, 0); assert.equal(warm.achievementUsageDelta, undefined);
    await appendFile(file, claudeLine('a', 99_999_999));
    const rewrite = await updateClaudeUsageIndex(warm.index, root, { analyzeContent: false, achievementUsageWindow: window });
    assert.equal(rewrite.achievementUsageDelta, undefined);
    await writeFile(path.join(path.dirname(file), 'import.jsonl'), claudeLine('import', 99_999_999));
    const imported = await updateClaudeUsageIndex(rewrite.index, root, { analyzeContent: false, achievementUsageWindow: window });
    assert.equal(imported.achievementUsageDelta, undefined);
  });
});

test('Claude absent/invalid windows, cold input, duplicates and missing TTL do not grant money', async () => {
  await claudeFixture(async ({ root, file, baseline }) => {
    const original = moneyPricing.priceAchievementModelBucket;
    const originalBook = moneyPricing.getAchievementMoneyPricebook;
    let prices = 0, books = 0;
    Object.defineProperty(moneyPricing, 'priceAchievementModelBucket', { value: (...args: Parameters<typeof original>) => { prices++; return original(...args); }, configurable: true });
    Object.defineProperty(moneyPricing, 'getAchievementMoneyPricebook', { value: (...args: Parameters<typeof originalBook>) => { books++; return originalBook(...args); }, configurable: true });
    try {
      await appendFile(file, claudeLine('off', 50));
      const off = await updateClaudeUsageIndex(baseline.index, root, { analyzeContent: false });
      assert.equal(off.achievementUsageDelta, undefined);
      await appendFile(file, claudeLine('invalid', 50));
      const invalid = await updateClaudeUsageIndex(off.index, root, { analyzeContent: false, achievementUsageWindow: { after: 200, through: 100 } });
      assert.equal(invalid.achievementUsageDelta, undefined);
      assert.equal(prices, 0, 'OFF/no valid accepted window performs zero supplemental pricing');
      assert.equal(books, 0, 'OFF/no valid accepted window performs zero frozen-book queries');
      await appendFile(file, claudeLine('off', 50) + claudeLine('ttl-missing', 50, 0, 1, false));
      const live = await updateClaudeUsageIndex(invalid.index, root, { analyzeContent: false, achievementUsageWindow: window });
      assert.equal(live.achievementUsageDelta?.processed, 51); assert.equal(live.achievementUsageDelta?.money, undefined);
      const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: false, achievementUsageWindow: window });
      assert.equal(cold.achievementUsageDelta, undefined);
      assert.equal(prices, 0, 'TTL-missing and cold records are never priced for live proof');
      assert.equal(books, 0, 'TTL-missing and cold records never query the frozen books for live proof');
    } finally {
      Object.defineProperty(moneyPricing, 'priceAchievementModelBucket', { value: original, configurable: true });
      Object.defineProperty(moneyPricing, 'getAchievementMoneyPricebook', { value: originalBook, configurable: true });
    }
  });
});

function event(model = 'gpt-5-nano', input = 1, cached = 1, output = 0): NormalizedUsageEvent {
  return { provider: 'codex', sourceKind: 'local-jsonl', schemaVariant: 'fixture', timestamp: window.after + 1,
    sessionKey: 'private-fixture', model, tokens: { inputTotal: input, cachedInput: cached, outputTotal: output }, confidence: 'exact', qualityFlags: [] };
}
test('Codex event sum retains submicro amounts, cached subsets and known aliases only', () => {
  const delta = emptyCodexUsageDelta(window);
  for (let i = 0; i < 201; i++) assert.equal(addCodexOriginEvent(delta, event()), true);
  assert.equal(delta.money?.openai?.microUsd, 1);
  assert.equal(delta.money?.openai?.exactMicroUsdUnits, String(1005n * SCALE / 1000n));
  assert.equal(delta.money?.openai?.eligibleProcessed, 201);
  assert.equal(addCodexOriginEvent(delta, event('openai/gpt-6-sol', 10, 4, 2)), true);
  assert.equal(delta.money?.openai?.microUsd, 33);
  assert.equal(delta.money?.openai?.exactMicroUsdUnits, String(33805n * SCALE / 1000n));
  assert.equal(addCodexOriginEvent(delta, event('future-model', 100, 0)), true);
  assert.equal(delta.processed, 313); assert.equal(delta.money?.openai?.eligibleProcessed, 213);
  assert.equal(addCodexOriginEvent(delta, { ...event(), timestamp: window.after }), true);
  assert.equal(delta.processed, 313);
  assert.equal(addCodexOriginEvent(delta, event('gpt-6-sol', 1, 0, 1)), true);
  assert.equal(delta.money?.openai?.eligibleProcessed, 215);
  assert.equal(delta.money?.openai?.microUsd, 45);
  const invalidMoneyEvent = { ...event(), tokens: { ...event().tokens, cacheWriteInput: 1 } };
  assert.equal(addCodexOriginEvent(delta, invalidMoneyEvent), true);
  assert.equal(delta.processed, 316); assert.equal(delta.money?.openai?.eligibleProcessed, 215);
});

test('Codex unknown/old/invalid-price events never inherit earlier priced contributions', () => {
  const delta = emptyCodexUsageDelta(window);
  addCodexOriginEvent(delta, event('gpt-6-sol', 1, 0));
  const first = structuredClone(delta.money);
  assert.equal(emptyCodexUsageDelta(delta).money, undefined, 'empty constructor copies only the accepted window');
  addCodexOriginEvent(delta, event('unknown-large-input', 999_999, 0));
  assert.deepEqual(delta.money, first);
  addCodexOriginEvent(delta, { ...event('gpt-6-sol', 999_999, 0), timestamp: window.after });
  assert.deepEqual(delta.money, first);
  addCodexOriginEvent(delta, { ...event('gpt-6-sol', 999_999, 0), tokens: { inputTotal: 999_999, outputTotal: 0, cacheWriteInput: 1 } });
  assert.deepEqual(delta.money, first);
  assert.equal(copyCodexUsageDelta(delta, { ...window, through: window.through + 1 }), undefined);
});

test('copy and accumulation allowlist optional proof; malformed money never discards Token proof', () => {
  const delta = emptyCodexUsageDelta(window); addCodexOriginEvent(delta, event());
  const proof = delta.money!.openai!;
  assert.deepEqual(copyMoneyProof({ ...proof, rawId: 'private' }, 'codex', 'openai', delta.processed), proof);
  const copied = copyCodexUsageDelta({ ...delta, privatePath: '/private', money: { openai: { ...proof, raw: 'private' }, extra: proof } }, window)!;
  assert.deepEqual(copied, delta); assert.notEqual(copied.money!.openai, proof);
  for (const patch of [{ provider: 'claude' }, { backend: 'anthropic' }, { pricebookVersion: 'forged' },
    { exactMicroUsdUnits: '1'.repeat(65) }, { exactMicroUsdUnits: 'private-id' }, { microUsd: 1 },
    { eligibleProcessed: 2 }, { eligibleProcessed: 0 }, { microUsd: Number.MAX_SAFE_INTEGER + 1 }]) {
    const cleaned = copyCodexUsageDelta({ ...delta, money: { openai: { ...proof, ...patch } } }, window)!;
    assert.equal(cleaned.processed, delta.processed); assert.equal(cleaned.money, undefined);
  }
  const sum = accumulateMoneyProof(proof, proof)!;
  assert.equal(sum.exactMicroUsdUnits, String(10n * SCALE / 1000n)); assert.equal(sum.microUsd, 0);
  assert.equal(sum.eligibleProcessed, 2);
  assert.equal(accumulateMoneyProof(proof, { ...proof, pricebookVersion: 'other' }), undefined);
  assert.equal(copyMoneyProofs([proof], 'codex', 1), undefined);
  assert.equal(copyMoneyProofs({ anthropic: proof }, 'codex', 1), undefined);
  assert.equal(copyMoneyProofs(Object.create({ openai: proof }), 'codex', 1), undefined);
  assert.equal(validateMoneyProof({ ...proof, exactMicroUsdUnits: '-1' }, 'codex', 'openai'), false);
  assert.equal(validateMoneyProof({ ...proof, exactMicroUsdUnits: '01' }, 'codex', 'openai'), false);
  assert.equal(validateMoneyProof({ ...proof, exactMicroUsdUnits: '1e18' }, 'codex', 'openai'), false);
  const max = { ...proof, eligibleProcessed: Number.MAX_SAFE_INTEGER };
  assert.equal(accumulateMoneyProof(max, proof), undefined);
  const maxAmount = { ...proof, eligibleProcessed: Number.MAX_SAFE_INTEGER, microUsd: Number.MAX_SAFE_INTEGER, exactMicroUsdUnits: String(BigInt(Number.MAX_SAFE_INTEGER) * SCALE) };
  assert.equal(accumulateMoneyProof(maxAmount, maxAmount), undefined);
  const invalid = { ...delta, money: { openai: { ...proof, pricebookVersion: 'forged' } } };
  assert.equal(addCodexUsageDelta(delta, invalid), true); assert.equal(delta.processed, 2);
  assert.equal(delta.money?.openai?.eligibleProcessed, 1, 'malformed optional addition cannot poison sound priced subset');
});

test('worker money proof rejects economically impossible amounts without invalidating native Tokens', () => {
  const delta = emptyCodexUsageDelta(window); addCodexOriginEvent(delta, event('gpt-6-sol', 1, 0));
  const impossible = { ...delta.money!.openai!, microUsd: 100_000_000,
    exactMicroUsdUnits: String(100_000_000n * SCALE), eligibleProcessed: 1 };
  assert.equal(validateMoneyProof(impossible, 'codex', 'openai'), false);
  const copied = copyCodexUsageDelta({ ...delta, money: { openai: impossible } }, window)!;
  assert.equal(copied.processed, 1); assert.equal(copied.output, 0); assert.equal(copied.money, undefined);
  assert.deepEqual(copied.families, delta.families);
  for (const [provider, backend, maxRate] of [
    ['claude', 'anthropic', 75n], ['claude', 'aws-bedrock-in-region', 50n], ['codex', 'openai', 50n],
  ] as const) {
    const maximum = { provider, backend, pricebookVersion: getAchievementMoneyPricebook(backend).version,
      eligibleProcessed: 3, microUsd: Number(maxRate * 3n), exactMicroUsdUnits: String(maxRate * 3n * SCALE) };
    assert.equal(validateMoneyProof(maximum, provider, backend), true, 'conservative maximum is inclusive');
    assert.equal(validateMoneyProof({ ...maximum, exactMicroUsdUnits: String(maxRate * 3n * SCALE + 1n) }, provider, backend), false,
      'even one exact unit over the ceiling fails despite identical integer microUSD');
    assert.equal(copyMoneyProof({ ...maximum, ...impossible, provider, backend,
      pricebookVersion: maximum.pricebookVersion }, provider, backend), undefined);
  }
});

test('cumulative crossings require exact same-book sufficient and necessary additions only', () => {
  // Keep synthetic historical counters large enough to support the amount;
  // the independently tested live addition remains exactly half a microUSD.
  const evidence = (units: bigint) => ({ ...codexMoneyEvidenceFromModels({ 'gpt-6-sol': { inputTotal: 50_000_001, outputTotal: 0 } }, 'openai'),
    microUsd: Number(units / SCALE), exactMicroUsdUnits: String(units) });
  const scopes = (units: bigint) => ({ provider: 'codex', backend: 'openai', pricebookVersion: getAchievementMoneyPricebook('openai').version,
    cumulative: evidence(units), coverage: { cumulative: { status: 'complete' }, completedMondayWeekPeak: { status: 'scopepending' }, maxSessionTask: { status: 'invalid' } } } as any);
  const target = 100_000_000n * SCALE;
  const proof = { provider: 'codex', backend: 'openai', pricebookVersion: getAchievementMoneyPricebook('openai').version,
    microUsd: 0, exactMicroUsdUnits: String(SCALE / 2n), eligibleProcessed: 1 } as const;
  const before = scopes(target - SCALE / 2n), after = scopes(target);
  assert.deepEqual(cumulativeCrossings(before, after, { openai: proof }), ['codex-api-total-bronze']);
  assert.deepEqual(cumulativeCrossings(before, scopes(target + SCALE), { openai: proof }), [], 'historic import alone can suffice');
  assert.deepEqual(cumulativeCrossings(scopes(target - SCALE), after, { openai: proof }), [], 'live delta alone is insufficient');
  assert.deepEqual(cumulativeCrossings(before, { ...after, pricebookVersion: 'changed' }, { openai: proof }), []);
  assert.deepEqual(cumulativeCrossings(before, after, { openai: { ...proof, provider: 'claude' } } as any), []);
  assert.deepEqual(cumulativeCrossings({ ...before, coverage: { ...before.coverage, cumulative: { status: 'invalid' } } }, after, { openai: proof }), []);
  assert.deepEqual(cumulativeCrossings(scopes(target), scopes(target + SCALE), { openai: proof }), [], 'already historical attainment stays historical');
  assert.deepEqual(cumulativeCrossings(before, { ...after, cumulative: { ...after.cumulative, microUsd: 0 } }, { openai: proof }), []);
  assert.deepEqual(cumulativeCrossings(before, { ...after, backend: 'anthropic' }, { openai: proof }), []);
});

test('real Claude cumulative crossing consumes the selected frozen backend and never week/session amounts', async () => {
  await claudeFixture(async ({ root, file, baseline }) => {
    await appendFile(file, claudeLine('threshold-history', 33_333_332, 0, 0, true, undefined, false));
    const before = await updateClaudeUsageIndex(baseline.index, root, { analyzeContent: false });
    await appendFile(file, claudeLine('live-threshold', 1));
    const after = await updateClaudeUsageIndex(before.index, root, { analyzeContent: false, achievementUsageWindow: window });
    const scope = (index: typeof after.index, backend: 'anthropic' | 'aws-bedrock-in-region') => claudeAchievementMoneyScopes({
      backend, asOfDay: '2026-10-09', allTimeModels: index.aggregates.allTime.modelBreakdown });
    assert.deepEqual(cumulativeCrossings(scope(before.index, 'anthropic'), scope(after.index, 'anthropic'), after.achievementUsageDelta?.money), ['claude-api-total-bronze']);
    assert.deepEqual(cumulativeCrossings(scope(before.index, 'aws-bedrock-in-region'), scope(after.index, 'aws-bedrock-in-region'), after.achievementUsageDelta?.money), []);
    assert.deepEqual(cumulativeCrossings(scope(before.index, 'anthropic'), scope(after.index, 'aws-bedrock-in-region'), after.achievementUsageDelta?.money), []);
  });
});

test('real Codex tail reconciles affected priced aggregates, including APR; price mismatch only withholds money', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-money-'));
  const salt = 'money-origin-test';
  try {
    const sessions = path.join(root, 'sessions'); await mkdir(sessions);
    const log = path.join(sessions, 'usage.jsonl');
    const context = JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-sol' } }) + '\n';
    const token = (input: number, time: string) => JSON.stringify({ type: 'event_msg', timestamp: time,
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 0 },
        last_token_usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 0 } } } }) + '\n';
    await writeFile(log, JSON.stringify({ type: 'session_meta', payload: { id: 'root', cwd: '/fixture' } }) + '\n' + context + token(1, '2026-10-09T00:00:00Z'));
    const opts = { salt, timeZone: 'UTC', now: () => window.through, achievementUsageWindow: window };
    let baseline = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(root, salt), opts);
    for (let i = 0; baseline.migration.pending && i < 6; i++) baseline = await updateCodexIndex(baseline.index, await scanCodexManifest(root, salt), opts);
    await appendFile(log, token(2, '2026-10-09T01:30:00Z'));
    const live = await updateCodexIndex(baseline.index, await scanCodexManifest(root, salt), opts);
    assert.equal(live.achievementUsageDelta?.money?.openai?.microUsd, 2);
    assert.equal(live.bodyReads, 1);
    assert.equal(JSON.stringify(live.index).includes('exactMicroUsdUnits'), false);
    const key = Object.keys(live.index.files)[0];
    const raw = live.achievementUsageDelta!;
    const candidates = new Map([[key, raw]]);
    const tampered = { ...raw, money: { openai: { ...raw.money!.openai!, microUsd: 3, exactMicroUsdUnits: String(3n * SCALE) } } };
    const withheld = finalizeCodexUsageDelta(baseline.index, live.index, new Map([[key, tampered]]), window)!;
    assert.equal(withheld.processed, 1); assert.equal(withheld.money, undefined);
    const modified = structuredClone(live.index);
    modified.files[key].aggregate.byModel = { 'unknown-model': modified.files[key].aggregate.total };
    assert.equal(finalizeCodexUsageDelta(baseline.index, modified, candidates, window)?.money, undefined);
    const warm = await updateCodexIndex(live.index, await scanCodexManifest(root, salt), opts);
    assert.equal(warm.bodyReads, 0); assert.equal(warm.achievementUsageDelta, undefined);
    // A sound approval reviewer belongs to the existing cumulative census.
    const apr = structuredClone(live.index);
    const child = structuredClone(apr.files[key]);
    child.fileKey = 'apr'; child.ino! += 1;
    child.aggregate.session = { ...child.aggregate.session, sessionKey: 'apr', parentSessionKey: apr.files[key].aggregate.session.sessionKey, role: 'approval-reviewer' };
    apr.files.apr = child;
    apr.coverage.totalFiles++; apr.coverage.indexedFiles++;
    const oldApr = structuredClone(apr);
    oldApr.files.apr.aggregate.total.inputTotal--;
    oldApr.files.apr.aggregate.byModel['gpt-6-sol'].inputTotal--;
    assert.equal(finalizeCodexUsageDelta(oldApr, apr, new Map([['apr', raw]]), window)?.money?.openai?.microUsd, 2);
    assert.equal(codexAchievementMoneyScopes({ files: Object.values(apr.files).map(f => f.aggregate), complete: true, backend: 'openai', asOfDay: '2026-10-09' }).coverage.verifiedFiles, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
