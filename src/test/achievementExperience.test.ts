import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { ACHIEVEMENT_COPY, I18n } from '../i18n';

async function gallery(run: (provider: any) => void): Promise<void> {
  const load = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, main: boolean) {
    return request === 'vscode' ? { workspace: { workspaceFolders: [] }, Uri: { file: (fsPath: string) => ({ fsPath }) } } : load.call(this, request, parent, main);
  };
  const locale = I18n.getLocale();
  try {
    I18n.setLanguage('en');
    const { UsageWebviewProvider } = require('../webview');
    const provider = new UsageWebviewProvider({ extensionPath: '/synthetic' }) as any;
    provider.panel = { webview: { asWebviewUri: (uri: any) => ({ toString: () => '/synthetic/' + uri.fsPath.split('/').at(-1) }) } };
    provider.providerAvailability = { claude: true, codex: true, codexData: true };
    provider.achievementResults = () => ACHIEVEMENT_DEFINITIONS.map(entry => ({ ...entry, progress: 0, unlocked: false }));
    run(provider);
  } finally { I18n.setLanguage(locale as Parameters<typeof I18n.setLanguage>[0]); (Module as any)._load = load; }
}

test('gallery separates series and levels and excludes disabled providers from both denominators', async () => {
  await gallery(provider => {
    const html = provider.renderAchievementData();
    assert.match(html, /0 \/ 46 series/);
    assert.match(html, /0 \/ 124 levels/);
    provider.providerAvailability.claude = false;
    const filtered = provider.renderAchievementData();
    const ids = ACHIEVEMENT_DEFINITIONS.filter(entry => entry.group !== 'claude' && !entry.id.startsWith('dual-provider-'));
    const series = new Set(ids.map(entry => Object.entries(ACHIEVEMENT_SERIES)
      .find(([, levels]) => levels.includes(entry.id))?.[0] ?? entry.id));
    assert.ok(filtered.includes(`0 / ${series.size} series`));
    assert.ok(filtered.includes(`0 / ${ids.length} levels`));
    assert.doesNotMatch(filtered, /data-achievement-id="dual-provider-/);
  });
});

test('high-level cards name their earned milestone, not the introductory threshold', async () => {
  await gallery(provider => {
    provider.achievementGrants = new Set(ACHIEVEMENT_SERIES['cumulative-volume']);
    const html = provider.renderAchievementData();
    const card = html.match(/<article[^>]*data-achievement-series="cumulative-volume"[\s\S]*?<\/article>/)![0];
    assert.match(card, /<h4>1T club<\/h4>/);
    assert.doesNotMatch(card, /<h4>100M club<\/h4>/);
    assert.match(card, /Legendary/);
  });
});

test('all displayed level requirements carry a unit or a qualified condition', async () => {
  await gallery(provider => {
    const html = provider.renderAchievementData();
    const rules = [...html.matchAll(/data-achievement-level="[^"]+"[\s\S]*?<span>([^<]+)<\/span><\/li>/g)];
    assert.equal(rules.length, 124);
    for (const rule of rules) assert.doesNotMatch(rule[1], /^\s*[\d.,]+\s*$/);
  });
});

test('missing and stale proof are not zero progress, while an earned badge remains earned', async () => {
  await gallery(provider => {
    provider.achievementEvidenceStates = { 'codex-calendar': 'pending', 'codex-lineage': 'ready' };
    provider.achievementGrants = new Set(['astra-days-bronze']);
    const card = () => provider.renderAchievementData()
      .match(/<article[^>]*data-achievement-series="astra-days"[\s\S]*?<\/article>/)![0];
    const pending = card();
    assert.match(pending, /data-achievement-earned="true"/);
    assert.match(pending, /data-achievement-proof="pending"/);
    assert.match(pending, /Evidence pending/);
    assert.doesNotMatch(pending, /<progress|0 \/ 30|class="achievement-progress-label"/);
    assert.match(pending, /data-achievement-next="false"/);
    provider.achievementEvidenceStates['codex-calendar'] = 'stale';
    const stale = card();
    assert.match(stale, /data-achievement-earned="true"/);
    assert.match(stale, /data-achievement-proof="stale"/);
    assert.match(stale, /Evidence outdated/);
    assert.doesNotMatch(stale, /<progress/);
  });
});

test('a compact number cannot make unfinished progress look equal to its target', async () => {
  await gallery(provider => {
    provider.achievementGrants = new Set(['hundred-million-club']);
    provider.codexAchievementVolume = () => ({ lowerBound: true });
    provider.achievementResults = () => ACHIEVEMENT_DEFINITIONS.map(entry => ({ ...entry,
      progress: entry.id === 'billion-token-club' ? entry.target - 1 : 0, unlocked: false }));
    const card = provider.renderAchievementData()
      .match(/<article[^>]*data-achievement-series="cumulative-volume"[\s\S]*?<\/article>/)![0];
    assert.match(card, /Next level: ≥/);
    assert.doesNotMatch(card, /≥Next level/);
    assert.doesNotMatch(card, /1\.0B \/ 1\.0B/);
    assert.match(card, /999M \/ 1B/);
    assert.match(card, /summary aria-label="[^\"]*≥/);
  });
});

test('achievement chrome uses integer numbers without repeating introductory prose or tier titles', async () => {
  await gallery(provider => {
    provider.achievementResults = () => ACHIEVEMENT_DEFINITIONS.map(entry => ({ ...entry,
      progress: Math.floor(entry.target * 0.372), unlocked: false }));
    const html = provider.renderAchievementData();
    const labels = [...html.matchAll(/(?:achievement-progress-label[^>]*>|achievement-next-target">)([^<]*)</g)];
    assert.ok(labels.length > 40);
    for (const [, text] of labels) assert.doesNotMatch(text, /\d+[.,]\d+[kMBT]/);
    assert.doesNotMatch(html, /Milestones from indexed local usage/);
    assert.doesNotMatch(html, /class="achievement-state"/);
    const card = html.match(/<article[^>]*data-achievement-series="astra-regular"[\s\S]*?<\/article>/)![0];
    assert.equal((card.match(/Astra regular/g) ?? []).length, 2, 'name and accessible label, not one repeat per tier');
  });
});

test('hour rules stay consecutive and Traditional Chinese uses consistent achievement terminology', () => {
  assert.match(ACHIEVEMENT_COPY['de-DE'].units.hours, /aufeinanderfolgende/);
  assert.match(ACHIEVEMENT_COPY['pt-BR'].units.hours, /consecutivas/);
  assert.doesNotMatch(JSON.stringify(ACHIEVEMENT_COPY['zh-TW']), /實績/);
  for (const copy of Object.values(ACHIEVEMENT_COPY)) assert.doesNotMatch(copy.units.weeklyAverage, /5B/);
});

test('evidence boundaries stay available in a collapsed disclosure, not permanent introductory prose', async () => {
  await gallery(provider => {
    const html = provider.renderAchievementData();
    const evidence = html.match(/<details class="achievement-evidence-note"[\s\S]*?<\/details>/)?.[0];
    assert.ok(evidence);
    assert.match(evidence, /<summary>Evidence details<\/summary>/);
    assert.doesNotMatch(evidence, /<details[^>]*\bopen\b/);
    assert.match(evidence, /first event week/);
    assert.match(evidence, /Deleted\/rotated logs/);
    provider.codexAchievementVolume = () => ({ lowerBound: true });
    assert.match(provider.renderAchievementData(), /≥ Verified lower bound/);
  });
});

test('tier upgrades keep disclosure keys and canonical card order stable', async () => {
  await gallery(provider => {
    const before = provider.renderAchievementData();
    provider.achievementGrants = new Set(['sol-regular', 'sol-regular-silver']);
    const after = provider.renderAchievementData();
    for (const html of [before, after]) assert.match(html, /data-persist="achievement:sol-regular"/);
    const order = (html: string) => [...html.matchAll(/data-achievement-key="([^"]+)"/g)].map(match => match[1]);
    assert.equal(order(before).length, 46);
    assert.deepEqual(order(after), order(before));
    assert.match(after, /data-persist-aliases="achievement:sol-regular achievement:sol-regular-silver achievement:sol-regular-gold"/);
  });
});

test('one compact next target precedes detailed rules for every level', async () => {
  await gallery(provider => {
    const html = provider.renderAchievementData();
    assert.match(html, /class="achievement-next-target"/);
    assert.equal([...html.matchAll(/data-achievement-level="/g)].length, 124);
    assert.match(html, /onclick="openAchievementSettings\(\)"/);
  });
});

test('experience copy exists in all eight languages and does not call live unlocks imported history', () => {
  const keys = ['seriesCount', 'levelCount', 'filterLabel', 'filterAll', 'filterNext', 'filterEarned',
    'filterEmpty', 'settingsTitle', 'shareSelect', 'shareLimit', 'sharePending', 'shareStale', 'shareFailed',
    'shareExportFailed', 'shareSaved', 'shareCancelled', 'shareSaving', 'shareSelectionChanged',
    'shareBack', 'allLevels', 'complete', 'shownCount'];
  for (const copy of Object.values(ACHIEVEMENT_COPY)) {
    for (const key of keys) assert.ok(typeof (copy as any)[key] === 'string' && (copy as any)[key].trim(), key);
  }
  assert.doesNotMatch(ACHIEVEMENT_COPY.en.unlockedBatch, /history/);
});

test('achievement preview captures bytes, rejects mismatched ids/handles, and retains only one artifact', () => {
  const { AchievementSharePreview } = require('../achievementShare');
  const preview = new AchievementSharePreview();
  assert.equal(preview.capture('missing', ['astra-regular']), undefined);
  const first = preview.accept(['astra-regular'], '<svg>first</svg>');
  assert.ok(first.previewId);
  assert.equal(preview.capture(first.previewId, ['astra-regular']), '<svg>first</svg>');
  assert.equal(preview.capture(first.previewId, ['sol-regular']), undefined);
  const captured = preview.capture(first.previewId, ['astra-regular']);
  const second = preview.accept(['sol-regular'], '<svg>second</svg>');
  assert.equal(preview.capture(first.previewId, ['astra-regular']), undefined);
  assert.equal(captured, '<svg>first</svg>', 'save-dialog race keeps the already captured preview');
  assert.equal(preview.capture(second.previewId, ['sol-regular']), '<svg>second</svg>');
  preview.clear();
  assert.equal(preview.capture(second.previewId, ['sol-regular']), undefined);
  assert.equal(preview.accept([], '').previewId, undefined);
});

test('changing the display language retires the old preview before a new save starts', () => {
  const { AchievementSharePreview } = require('../achievementShare');
  const preview = new AchievementSharePreview();
  const first = preview.accept(['astra-regular'], '<svg>English</svg>', 'en');
  assert.equal(preview.read(['astra-regular'], 'zh-CN'), undefined);
  assert.equal(preview.capture(first.previewId, ['astra-regular'], 'zh-CN'), undefined);
  assert.equal(preview.capture(first.previewId, ['astra-regular'], 'en'), '<svg>English</svg>');
});
