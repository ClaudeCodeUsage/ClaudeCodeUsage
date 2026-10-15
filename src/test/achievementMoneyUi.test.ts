import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ACHIEVEMENT_RECORD_FILE, loadAchievementRecords } from '../achievementRecordStore';
import { getAchievementMoneyPricebook, type AchievementMoneyBackend } from '../achievementMoney';
import { claudeAchievementMoneyScopes, codexAchievementMoneyScopes,
  type AchievementMoneyScopes, type ClaudeMoneyModels } from '../achievementMoneyScopes';
import { codexModelSignals } from '../achievements';
import { codexAchievementTokenEvidence } from '../achievementCalendar';
import { I18n } from '../i18n';
import type { UsageData } from '../types';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';

const moneyId = (id: string): boolean => /^(claude|codex)-api-/.test(id);
const model = (input: number, name = 'claude-opus-5-5'): ClaudeMoneyModels => ({
  [name]: { inputTokens: input, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    referenceUsage: { inputTokens: input, outputTokens: 0, cacheReadTokens: 0,
      cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 } },
});
function usage(models: ClaudeMoneyModels, currentCost = 0): UsageData {
  const rows = Object.values(models);
  return { totalInputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
    totalOutputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
    totalCacheReadTokens: rows.reduce((n, r) => n + r.cacheReadTokens, 0),
    totalCacheCreationTokens: rows.reduce((n, r) => n + r.cacheCreationTokens, 0),
    totalCost: currentCost, costBreakdown: { input: currentCost, output: 0, cacheWrite: 0, cacheRead: 0 },
    messageCount: 1, modelBreakdown: Object.fromEntries(Object.entries(models)
      .map(([name, row]) => [name, { ...row, cost: currentCost, count: 1 }])) };
}
function scopes(models: ClaudeMoneyModels, backend: AchievementMoneyBackend = 'anthropic',
  days?: { complete: boolean; rows: { date: string; models: ClaudeMoneyModels }[] },
  asOfDay = '2026-10-05'): AchievementMoneyScopes {
  return claudeAchievementMoneyScopes({ backend, asOfDay, allTimeModels: models, days,
    allSessionModels: [models], sessionsComplete: true });
}
async function settle(host: any): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await Promise.all([host.achievementWrite, host.achievementCalendarWrite,
      host.achievementHourWrite, host.achievementActivityWrite, host.achievementNoticeWrite]);
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}
// Match achievementUi's vscode module mock, but every persistent owner lives
// inside this test's fresh globalStorage directory, including auxiliary proof.
async function owner(run: (host: any, file: string, messages: any[], setEnabled: (value: boolean) => void) => Promise<void>,
  seed: string[] = []): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-money-ui-'));
  const originalLoad = (Module as any)._load;
  const zone = I18n.getTimezone(), language = I18n.getLocale(), currency = I18n.getCurrencyDisplay().code;
  let host: any;
  const state = new Map<string, unknown>([['ccu.achievements.grants.v5', seed],
    ...['structural', 'token', 'bucket', 'manifest', 'calendar', 'calibration']
      .map(name => ['ccu.achievements.' + name + 'Audit.v1', true] as [string, unknown])]);
  (Module as any)._load = function(request: string, parent: unknown, main: boolean) {
    return request === 'vscode' ? { workspace: { workspaceFolders: [] },
      Uri: { file: (fsPath: string) => ({ fsPath }) } } : originalLoad.call(this, request, parent, main);
  };
  try {
    I18n.setLanguage('en'); I18n.setTimezone('UTC'); I18n.setCurrencyDisplay('USD');
    const { UsageWebviewProvider } = require('../webview');
    host = new UsageWebviewProvider({ extensionPath: path.resolve(__dirname, '../..'),
      globalStorageUri: { fsPath: directory }, globalState: {
        get: (key: string) => state.get(key), update: async (key: string, value: unknown) => {
          if (value === undefined) state.delete(key); else state.set(key, value);
        },
      } });
    await settle(host);
    let enabled = true;
    host.settings = { get: (key: string) => key === 'enableAchievements' ? enabled :
      key === 'pricingBackend' ? 'anthropic' : ['enableShareCard', 'showAchievementNotices'].includes(key) };
    const messages: any[] = [];
    host.panel = { visible: true, webview: {
      asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => uri.fsPath }),
      postMessage: async (message: unknown) => { messages.push(message); return true; },
    } };
    host.webviewClientReady = true;
    host.setAchievementWindowFocused(true);
    host.updateWebview = () => undefined;
    host.providerAvailability = { claude: true, codex: false, codexData: false };
    await run(host, path.join(directory, ACHIEVEMENT_RECORD_FILE), messages, value => { enabled = value; });
  } finally {
    if (host) await settle(host);
    (Module as any)._load = originalLoad;
    I18n.setLanguage(language as any); I18n.setTimezone(zone); I18n.setCurrencyDisplay(currency);
    await rm(directory, { recursive: true, force: true });
  }
}
function deliver(host: any, models: ClaudeMoneyModels, money: AchievementMoneyScopes,
  days: { date: string; data: UsageData }[] = [], currentCost = 0): void {
  host.updateData(null, null, null, usage(models, currentCost), [], [], [], undefined,
    null, [], [], [], null, [], [], [], {}, null, days, undefined, 'UTC', money);
  host.achievementResults();
}
function card(host: any, key: string): string {
  const html: string = host.renderAchievementData();
  const found = html.match(new RegExp('<article\\b[^>]*data-achievement-key="' + key + '"[\\s\\S]*?</article>'));
  assert.ok(found, 'missing actual gallery card: ' + key);
  return found[0];
}
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&#36;/g, '$').replace(/\s+/g, ' ').trim();
}
async function moneyRecords(file: string) {
  const saved = await loadAchievementRecords(file);
  assert.ok(saved, 'the actual canonical record store must exist');
  return saved.records.filter(row => moneyId(row.id));
}

test('money UI: first verified history is quiet, undated, read, and persists its exact reference book across restart', async () => {
  await owner(async (host, file, messages) => {
    const models = model(25_000_000), money = scopes(models);
    deliver(host, models, money); await settle(host);
    const records = await moneyRecords(file);
    assert.ok(records.some(row => row.id === 'claude-api-total-bronze'));
    assert.ok(records.some(row => row.id === 'claude-api-session-silver'));
    for (const row of records) {
      assert.equal(row.origin, 'history'); assert.equal(row.recordedDay, null);
      assert.equal(row.timeZone, null); assert.equal(row.unread, false);
      assert.equal(row.referencePricebook, getAchievementMoneyPricebook('anthropic').version);
    }
    assert.ok(!messages.some(row => row.command === 'achievementUnlockNotice'));
    const { AchievementRecordRepository } = require('../achievementRecordStore');
    const restarted = await new AchievementRecordRepository(file).initialize([]);
    assert.deepEqual(restarted.records.filter((row: any) => moneyId(row.id)), records);
    assert.ok(Buffer.byteLength(await readFile(file, 'utf8')) <= 64 * 1024);
  });
});

test('money UI: a Memento monetary ID without a reference version cannot seed a new award', async () => {
  await owner(async (host, file) => {
    host.achievementResults(); await settle(host);
    assert.deepEqual(await moneyRecords(file), []);
    assert.equal(host.achievementGrants.has('claude-api-total-bronze'), false);
    assert.ok((await loadAchievementRecords(file))?.records.some(row => row.id === 'local-share-export'));
  }, ['claude-api-total-bronze', 'local-share-export']);
});

test('money UI: partial priced proof displays ≥ USD and coverage, with dollar thresholds instead of micro-token targets', async () => {
  await owner(async host => {
    const models = { ...model(25_000_000), ...model(25_000_000, 'unknown-price-model') };
    const money = scopes(models);
    assert.equal(money.cumulative?.status, 'partial'); assert.equal(money.cumulative?.pricingCoverage, 0.5);
    deliver(host, models, money); await settle(host);
    const html = card(host, 'claude-api-total'), text = visibleText(html);
    assert.match(text, /≥\s*(?:US\$|\$)\s*100\b/);
    assert.match(text, /50\s*%/);
    assert.match(text, /(?:US\$|\$)\s*1,?000\b/);
    const rule = html.match(/<li data-achievement-level="claude-api-total-bronze">[\s\S]*?<\/li>/)?.[0];
    assert.ok(rule); assert.match(visibleText(rule), /(?:US\$|\$)\s*100\b/);
    assert.doesNotMatch(visibleText(rule), /tokens|100M|100,000,000/i);
    const stage=html.match(/class="achievement-stage-target" title="([^"]+)"/);
    assert.ok(stage);assert.match(stage[1],/\$200 USD/);
    assert.doesNotMatch(stage[1],/200,000,000/,'display dollars, not microUSD, in the stage tooltip');
    assert.ok(!text.includes(money.pricebookVersion!), 'card uses the shared reference disclosure');
    assert.ok(host.renderAchievementData().includes(money.pricebookVersion!));
  });
});

test('money UI: positive sub-dollar proof says <$1 and does not unlock the dollar target', async () => {
  await owner(async (host, file) => {
    const models = model(249_999), money = scopes(models); // $0.999996, floor only for display.
    deliver(host, models, money); await settle(host);
    const text = visibleText(card(host, 'claude-api-total'));
    assert.match(text, /<\s*(?:US\$|\$)\s*1\b/);
    assert.match(text, /(?:US\$|\$)\s*100\b/);
    assert.deepEqual(await moneyRecords(file), []);
  });
});

test('money UI: a positive submicro amount is not displayed as a real zero', async () => {
  await owner(async (host, file) => {
    const models = model(1, 'gpt-6-luna'), money = scopes(models);
    assert.equal(money.cumulative?.microUsd, 0);
    assert.equal(money.coverage.cumulative.amountPositive, true);
    deliver(host, models, money); await settle(host);
    assert.match(visibleText(card(host, 'claude-api-total')), /<\s*(?:US\$|\$)\s*1\b/);
    assert.deepEqual(await moneyRecords(file), []);
    deliver(host, {}, scopes({})); await settle(host);
    assert.doesNotMatch(visibleText(card(host, 'claude-api-total')), /<\s*(?:US\$|\$)\s*1\b/);
  });
});

test('money UI: shared reference section preserves current and historical books without repeating card text', async () => {
  await owner(async (host, file) => {
    const models = model(25_000_000);
    deliver(host, models, scopes(models)); await settle(host);
    const earned = (await moneyRecords(file)).find(row => row.id === 'claude-api-total-bronze');
    assert.ok(earned);
    const originalBook = earned.referencePricebook!;
    const currentBook = getAchievementMoneyPricebook('aws-bedrock-in-region').version;
    deliver(host, models, scopes(models, 'aws-bedrock-in-region')); await settle(host);
    const html = card(host, 'claude-api-total');
    assert.doesNotMatch(html, /api-reference-|Baseline reference estimate|Awarded using/);
    assert.match(html, /data-achievement-reference/);
    const all = host.renderAchievementData();
    const reference = all.match(/<section id="achievementMoneyReference"[\s\S]*?<\/section>/)?.[0];
    assert.ok(reference); assert.ok(reference.includes(currentBook));
    assert.equal((reference.match(new RegExp(currentBook, 'g')) ?? []).length, 1);
    const bronze = html.match(/<li data-achievement-level="claude-api-total-bronze">[\s\S]*?<\/li>/)?.[0];
    assert.ok(bronze);
    const earnedReference=reference.match(/<li[^>]*data-earned-reference[^>]*>[\s\S]*?<\/li>/)?.[0];
    assert.ok(earnedReference,'shared earned reference is visible');
    assert.ok(earnedReference.includes(originalBook),'one shared earned reference retains the immutable book');
    assert.ok(!earnedReference.includes(currentBook),'current repricing cannot replace the earned book');
    assert.equal((all.match(/Baseline reference estimate/g) ?? []).length, 1);
    assert.equal((await moneyRecords(file)).find(row => row.id === earned.id)?.referencePricebook, originalBook);
  });
});

test('money UI: full cumulative pricing with missing date proof leaves only the week pending', async () => {
  await owner(async (host, file) => {
    const models = model(25_000_000), money = scopes(models);
    assert.equal(money.cumulative?.status, 'complete');
    assert.equal(money.coverage.completedMondayWeekPeak.status, 'scopepending');
    deliver(host, models, money); await settle(host);
    const records = await moneyRecords(file);
    assert.ok(records.some(row => row.id === 'claude-api-total-bronze'));
    assert.ok(!records.some(row => row.id.startsWith('claude-api-week-')));
    const html = card(host, 'claude-api-week');
    assert.match(visibleText(html), /pending|verif/i);
    assert.doesNotMatch(html, /<progress\b/, 'unknown week must not masquerade as a verified zero progress bar');
  });
});

test('money UI: independent complete Monday-week proof awards only after Sunday has ended', async () => {
  await owner(async (host, file, messages) => {
    const models = model(25_000_000), days = { complete: true, rows: [{ date: '2026-10-04', models }] };
    deliver(host, models, scopes(models, 'anthropic', days, '2026-10-04'),
      [{ date: '2026-10-04', data: usage(models) }]);
    await settle(host);
    assert.ok(!(await moneyRecords(file)).some(row => row.id.startsWith('claude-api-week-')));
    const completed = scopes(models, 'anthropic', days, '2026-10-05');
    assert.equal(completed.completedMondayWeekPeak, 100_000_000);
    deliver(host, models, completed, [{ date: '2026-10-04', data: usage(models) }]);
    await settle(host);
    const weekly = (await moneyRecords(file)).find(row => row.id === 'claude-api-week-bronze');
    assert.ok(weekly); assert.equal(weekly.origin, 'history'); assert.equal(weekly.recordedDay, null);
    assert.equal(weekly.unread, false);
    assert.ok(!messages.some(row => row.command === 'achievementUnlockNotice'));
  });
});

test('money UI: backend repricing and current-price-only growth reconcile without usage provenance or notices', async () => {
  await owner(async (host, file, messages) => {
    const models = model(24_000_000);
    deliver(host, models, scopes(models), [], 96); await settle(host);
    assert.ok(!(await moneyRecords(file)).some(row => row.id === 'claude-api-total-bronze'));
    deliver(host, models, scopes(models), [], 999_999); await settle(host);
    assert.ok(!(await moneyRecords(file)).some(row => row.id === 'claude-api-total-bronze'),
      'dashboard price overrides do not become frozen achievement proof');
    deliver(host, models, scopes(models, 'aws-bedrock-in-region')); await settle(host);
    const total = (await moneyRecords(file)).find(row => row.id === 'claude-api-total-bronze');
    assert.ok(total); assert.equal(total.referencePricebook, getAchievementMoneyPricebook('aws-bedrock-in-region').version);
    assert.equal(total.origin, 'history'); assert.equal(total.recordedDay, null); assert.equal(total.unread, false);
    assert.ok(!messages.some(row => row.command === 'achievementUnlockNotice'));
    assert.equal(host.usageAchievementReceipts.size, 0);
  });
});

for (const retirement of ['backend', 'clear', 'off', 'source', 'no-longer-qualifies'] as const) {
  test('money UI: queued history save rechecks ' + retirement + ' before persisting the old basis', async () => {
    await owner(async (host, file, messages, setEnabled) => {
      deliver(host, model(1), scopes(model(1))); await settle(host);
      const gate = deferred(); host.achievementWrite = gate.promise;
      const models = model(25_000_000);
      deliver(host, models, scopes(models));
      assert.ok(host.pendingAchievementGrants.has('claude-api-total-bronze'), 'exercise an actually queued money write');
      let clear: Promise<void> | undefined;
      try {
        if (retirement === 'backend') deliver(host, models, scopes(models, 'aws-bedrock-in-region'));
        if (retirement === 'clear') clear = host.clearAchievementGrants();
        if (retirement === 'off') { setEnabled(false); host.achievementResults(); }
        if (retirement === 'source') host.invalidateAchievementEvidence('claude');
        if (retirement === 'no-longer-qualifies') deliver(host, model(1), scopes(model(1)));
      } finally { gate.resolve(); }
      await clear; await settle(host);
      assert.deepEqual(await moneyRecords(file), []);
      assert.ok(!host.achievementGrants.has('claude-api-total-bronze'));
      assert.ok(!messages.some(row => row.command === 'achievementUnlockNotice'));
      if (retirement === 'backend') {
        deliver(host, models, scopes(models, 'aws-bedrock-in-region')); await settle(host);
        assert.equal((await moneyRecords(file)).find(row => row.id === 'claude-api-total-bronze')?.referencePricebook,
          getAchievementMoneyPricebook('aws-bedrock-in-region').version);
      }
    });
  });
}

test('money UI: source revocation invalidates money proof even while old dashboard amounts remain visible', async () => {
  await owner(async host => {
    const models = model(25_000_000), money = scopes(models);
    deliver(host, models, money); await settle(host);
    host.invalidateAchievementEvidence('claude');
    const results = host.achievementResults();
    assert.ok(results.filter((row: any) => moneyId(row.id)).every((row: any) => !row.unlocked));
    assert.equal(host.achievementMoneyFacts.claude, undefined);
    assert.equal(host.claudeAchievementMoney, money, 'stale display object is retained but cannot authorize awards');
  });
});

test('money UI: Codex canonical OpenAI proof unlocks total/task but cannot replace missing independent day proof', async () => {
  await owner(async (host, file) => {
    const tokens = { inputTotal: 50_000_000, outputTotal: 0, cachedInput: 0 };
    const files: CodexFileAggregate[] = [{ session: { sessionKey: 'fixture-root', role: 'root' },
      total: tokens, byModel: { 'gpt-6.1-sol': tokens }, byDay: {}, byEffort: {},
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } }];
    const signals = { ...codexModelSignals(files), tokenEvidence: codexAchievementTokenEvidence(files, true),
      money: codexAchievementMoneyScopes({ files, complete: true, backend: 'openai', asOfDay: '2026-10-05' }) };
    const view = { currentManifestVerified: true, coverage: { complete: true, identity: { complete: true } },
      allTime: { total: { processed: 50_000_000 }, models: [] }, allTimeDaily: [], limits: [],
      periodCoverage: { timeZone: 'UTC', allTime: { complete: false }, last30Days: { complete: false } },
      hourlyCoverage: { complete: false, timeZone: 'UTC' }, last30DaysHourlyByDay: {},
      outputHourProof: { complete: false, hours: [], backfillableFiles: 1 } };
    host.updateProviderData(view, {}, { claude: false, codex: true, codexData: true }, signals);
    host.achievementResults(); await settle(host);
    const records = await moneyRecords(file);
    assert.ok(records.some(row => row.id === 'codex-api-total-bronze'));
    assert.ok(records.some(row => row.id === 'codex-api-task-silver'));
    assert.ok(!records.some(row => row.id.startsWith('codex-api-week-')));
    assert.ok(records.every(row => row.referencePricebook === getAchievementMoneyPricebook('openai').version));
    assert.match(visibleText(card(host, 'codex-api-week')), /pending|verif/i);
  });
});

test('money UI: exported SVG contains only explicitly selected money ranks and public USD thresholds', async () => {
  await owner(async (host, file) => {
    const models = model(30_864_198), money = scopes(models); // $123.456792 is private, threshold is $100.
    deliver(host, models, money, [], 876_543.21); await settle(host);
    assert.ok((await moneyRecords(file)).some(row => row.id === 'claude-api-total-bronze'));
    assert.equal(host.achievementShareSvg(undefined), '', 'no selection, no public badges');
    const svg: string = host.achievementShareSvg(['claude-api-total-bronze', 'claude-api-total-gold', 'unknown']);
    assert.deepEqual([...svg.matchAll(/data-achievement-share-badge="([^"]+)"/g)].map(row => row[1]),
      ['claude-api-total-bronze']);
    const text = visibleText(svg);
    assert.match(text, /Bronze/);
    assert.doesNotMatch(svg, /123\.456792|123456792|876543\.21|2026-10-05|referencePricebook|pricingBackend|cacheWrite5m/);
    assert.ok(!svg.includes(money.pricebookVersion!));
    const more = model(45_864_198);
    deliver(host, more, scopes(more), [], 1_234_567); await settle(host);
    assert.equal(host.achievementShareSvg(['claude-api-total-bronze']), svg,
      'actual amount/current prices cannot alter the same selected public badge artifact');
    assert.match(text, /(?:US\$|\$)\s*100\b/);
  });
});
