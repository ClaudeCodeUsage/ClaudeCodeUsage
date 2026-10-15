import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { achievementGalleryKey } from '../achievementGallery';
import { ACHIEVEMENT_COPY, I18n } from '../i18n';
import { achievementConditionFor } from '../achievementConditions';

const catalogLevelCount = ACHIEVEMENT_DEFINITIONS.length;
const catalogSeriesCount = new Set(ACHIEVEMENT_DEFINITIONS.map(row => achievementGalleryKey(row.id))).size;

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

test('default gallery folds legacy milestones into their themes without dropping any formal rule', async () => {
  await gallery(provider => {
    const html = provider.renderAchievementData();
    assert.equal((html.match(/data-achievement-key=/g) ?? []).length, catalogSeriesCount);
    assert.doesNotMatch(html, /data-achievement-key="(?:streak-machine|dual-provider-day)"/);
    const ids = [...html.matchAll(/data-achievement-level="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, catalogLevelCount);
    assert.deepEqual(ids.sort(), ACHIEVEMENT_DEFINITIONS.map(row => row.id).sort());
    for (const [theme, milestone] of [['active-day-streak', 'streak-machine'], ['dual-provider-days', 'dual-provider-day']]) {
      const card = html.match(new RegExp(`<article[^>]*data-achievement-key="${theme}"[\\s\\S]*?<\\/article>`))![0];
      assert.match(card, new RegExp(`data-achievement-milestone="${milestone}"`));
      assert.ok(card.includes(`achievement:${milestone}`), 'old disclosure alias still opens the owning theme');
      assert.match(card, new RegExp(`data-achievement-level="${milestone}"`));
      assert.equal((card.match(/achievement-tier-pip(?: complete| next)?"/g) ?? []).length, 3,
        'an old single milestone is not a new tier');
    }
  });
});

test('milestone-only history stays earned and pinned without fabricating tier grants', async () => {
  await gallery(provider => {
    provider.achievementGrants = new Set(['streak-machine', 'dual-provider-day']);
    provider.achievementRecordState = { generation: 1, pins: ['streak-machine', 'dual-provider-day'],
      records: ['streak-machine', 'dual-provider-day'].map((id, index) => ({ id, seq: index + 1,
        origin: 'usage', unread: true, recordedDay: '2026-10-09', timeZone: 'UTC', ruleVersion: 1 })) };
    const before = JSON.stringify(provider.achievementRecordState);
    const html = provider.renderAchievementData();
    const card = html.match(/<article[^>]*data-achievement-key="active-day-streak"[\s\S]*?<\/article>/)![0];
    assert.match(card, /data-achievement-earned="true"/);
    assert.match(card, /data-achievement-pin="streak-machine"[^>]*aria-pressed="true"/);
    assert.match(card, /data-achievement-icon="streak-machine"/);
    assert.doesNotMatch(card, /achievement-tier-pip complete/);
    assert.match(card, /data-achievement-tier=""/, 'an old milestone alone must not wear a formal tier color');
    assert.match(html, /data-achievement-open="active-day-streak"/);
    assert.doesNotMatch(html, /data-achievement-open="streak-machine"|data-achievement-open="dual-provider-day"/);
    assert.equal(JSON.stringify(provider.achievementRecordState), before);
  });
});

test('duplicate legacy theme pins remain individually removable within one default card', async () => {
  await gallery(provider => {
    provider.achievementGrants = new Set(['active-day-streak', 'streak-machine']);
    provider.achievementRecordState = { generation: 1, pins: ['streak-machine', 'active-day-streak'],
      records: [...provider.achievementGrants].map((id, index) => ({ id, seq: index + 1,
        origin: 'history', unread: false, recordedDay: null, timeZone: null, ruleVersion: 1 })) };
    const html = provider.renderAchievementData();
    const card = html.match(/<article[^>]*data-achievement-key="active-day-streak"[\s\S]*?<\/article>/)![0];
    for (const key of provider.achievementRecordState.pins) {
      assert.match(card, new RegExp(`data-achievement-pin="${key}"[^>]*aria-pressed="true"`));
    }
    const overview = html.match(/data-achievement-overview="badges"[\s\S]*?<\/section>/)![0];
    assert.equal((overview.match(/data-achievement-open="active-day-streak"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /id="achievement-hidden-pins-summary"/);
  });
});

test('gallery separates series and levels and excludes disabled providers from both denominators', async () => {
  await gallery(provider => {
    const html = provider.renderAchievementData();
    assert.ok(html.includes(`0 / ${catalogSeriesCount} series`));
    assert.ok(html.includes(`0 / ${catalogLevelCount} levels`));
    provider.providerAvailability.claude = false;
    const filtered = provider.renderAchievementData();
    const ids = ACHIEVEMENT_DEFINITIONS.filter(entry => entry.group !== 'claude' && !entry.id.startsWith('dual-provider-'));
    const series = new Set(ids.map(entry => achievementGalleryKey(entry.id)));
    assert.ok(filtered.includes(`0 / ${series.size} series`));
    assert.ok(filtered.includes(`0 / ${ids.length} levels`));
    assert.doesNotMatch(filtered, /data-achievement-id="dual-provider-/);
  });
});

test('production overview puts representative badges and reachable goals before the unchanged gallery', async () => {
  await gallery(provider => {
    provider.achievementGrants = new Set(['astra-regular']);
    provider.achievementResults = () => ACHIEVEMENT_DEFINITIONS.map(entry => ({ ...entry,
      progress: entry.id.startsWith('astra-regular') ? 600e6 : 0, unlocked: false }));
    const html = provider.renderAchievementData();
    assert.match(html, /data-achievement-overview="badges"/);
    assert.match(html, /data-achievement-overview="next"/);
    assert.ok(html.indexOf('My badges') < html.indexOf('Complete collection'));
    assert.match(html, /data-achievement-open="astra-regular"/);
    assert.equal((html.match(/data-achievement-level=/g) ?? []).length, catalogLevelCount);
    provider.providerAvailability.codex = false;
    assert.doesNotMatch(provider.renderAchievementData(), /data-achievement-open="astra-regular"/);
  });
});

test('production overview does not add or reorder goals during a visit; re-entry can choose afresh', async () => {
  await gallery(provider => {
    let hasOutput = false;
    provider.achievementGrants = new Set(['astra-regular']);
    provider.achievementResults = () => ACHIEVEMENT_DEFINITIONS.map(entry => ({ ...entry,
      progress: entry.id.startsWith('astra-regular') ? 600e6 :
        hasOutput && entry.id.startsWith('codex-output-') ? 400_000 : 0, unlocked: false }));
    const nextKeys = () => [...(provider.renderAchievementData().match(
      /data-achievement-overview="next"[\s\S]*?<\/section>/)?.[0] ?? '').matchAll(/data-achievement-open="([^"]+)"/g)]
      .map(match => match[1]);
    assert.deepEqual(nextKeys(), ['astra-regular']);
    hasOutput = true;
    assert.deepEqual(nextKeys(), ['astra-regular']);
    provider.achievementOverviewSelection = undefined;
    assert.ok(nextKeys().includes('codex-output'));
    provider.achievementEvidenceStates = { 'codex-tokens': 'stale' };
    assert.deepEqual(nextKeys(), ['astra-regular']);
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

test('a retained Legendary award never substitutes its old target for current verified progress', async () => {
  await gallery(provider => {
    provider.providerAvailability={claude:true,codex:false,codexData:false};
    provider.achievementGrants=new Set(['sonnet-main-legendary']);
    provider.achievementResults=()=>ACHIEVEMENT_DEFINITIONS.map(rule=>({...rule,
      progress:rule.id.startsWith('sonnet-main')?100_000_000:0,unlocked:false}));
    const card=provider.renderAchievementData().match(/<article[^>]*data-achievement-key="sonnet-main"[\s\S]*?<\/article>/)[0];
    assert.match(card,/data-achievement-tier="legendary"/);
    assert.match(card,/achievement-current-value[^>]*>Current value: 100M/,'saved qualification is not the current retained subtotal');
    assert.doesNotMatch(card,/50B \/ 50B/);
  });
});

test('all displayed level requirements carry a unit or a qualified condition', async () => {
  await gallery(provider => {
    const html = provider.renderAchievementData();
    const rules = [...html.matchAll(/<li[^>]*data-achievement-level="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)];
    assert.equal(rules.length, ACHIEVEMENT_DEFINITIONS.length);
    assert.deepEqual(rules.map(([, id]) => id).sort(), ACHIEVEMENT_DEFINITIONS.map(row => row.id).sort());
    const articles=[...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(row=>row[0]);
    for (const [, id, body] of rules) {
      const parent=articles.find(article=>article.includes('data-achievement-level="'+id+'"'))!;
      const common=parent.match(/achievement-common-conditions[^>]*>([^<]*)<\/p>/)?.[1]??'';
      const requirement = body.match(/<span(?: class="achievement-level-value")?>([^<]+)<\/span>/)?.[1];
      assert.ok(requirement, `${id}: missing level requirement`);
      assert.ok(!/^\s*[\d.,]+\s*$/.test(requirement)||/\S/.test(common),id+': unit may be shared, never absent');
      const condition = achievementConditionFor('en', id);
      if (condition) {
        const detail = body.match(/<small>([^<]+)<\/small>/)?.[1]??common;
        assert.ok(detail, `${id}: missing joint condition`);
        assert.doesNotMatch(detail, /^\s*[\d.,]+\s*$/, id);
        assert.ok(detail.includes(condition.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;')), id+': complete joint condition');
      }
    }
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
    provider.achievementGrants = new Set(ACHIEVEMENT_SERIES['astra-days']);
    const finished = card().split('</summary>')[0];
    assert.match(finished, /class="achievement-next-target">Evidence outdated/,
      'completed historical tiers still show current proof status without opening');
  });
});

test('a long Token ladder exposes current progress and a display-only stage without opening its rules', async () => {
  await gallery(provider => {
    // This test injects exact evaluated family progress, rather than an
    // unverified index. Its presentation bound must describe that fixture.
    provider.codexAchievementVolume = () => ({ processed: 600_000_000, lowerBound: false });
    provider.achievementGrants = new Set(['astra-regular']);
    provider.achievementResults = () => ACHIEVEMENT_DEFINITIONS.map(entry => ({ ...entry,
      progress: entry.id.startsWith('astra-regular') ? 600_000_000 : 0, unlocked: false }));
    const read = () => provider.renderAchievementData()
      .match(/<article[^>]*data-achievement-series="astra-regular"[\s\S]*?<\/article>/)![0];
    const summary = read().split('</summary>')[0];
    assert.match(summary, /class="achievement-current-progress"[^>]*>600M \/ 5B/);
    assert.match(summary, /class="achievement-stage-target"[^>]*>Next stage · 1B/);
    assert.doesNotMatch(summary, /data-achievement-id="[^"]*stage/);
    provider.codexAchievementVolume = () => ({ processed: 600_000_000, lowerBound: true });
    assert.match(read().split('</summary>')[0], /class="achievement-current-progress"[^>]*>≥600M \/ 5B/);
    provider.achievementEvidenceStates = { 'codex-lineage': 'pending' };
    const pending = read().split('</summary>')[0];
    assert.doesNotMatch(pending, /class="achievement-current-progress"|class="achievement-stage-target"/);
    assert.match(pending, /Evidence pending/);
    assert.equal((provider.renderAchievementData().match(/data-achievement-level=/g) ?? []).length, catalogLevelCount);
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
    assert.match(card, /summary[^>]* aria-label="[^\"]*≥/);
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
    assert.match(evidence, /<summary>[\s\S]*aria-hidden="true"[\s\S]*Evidence details<\/summary>/);
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
    assert.equal(order(before).length, catalogSeriesCount);
    assert.deepEqual(order(after), order(before));
    assert.match(after, /data-persist-aliases="achievement:sol-regular achievement:sol-regular-silver achievement:sol-regular-gold"/);
  });
});

test('one compact next target precedes detailed rules for every level', async () => {
  await gallery(provider => {
    const html = provider.renderAchievementData();
    assert.match(html, /class="achievement-next-target"/);
    assert.equal([...html.matchAll(/data-achievement-level="/g)].length, catalogLevelCount);
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
