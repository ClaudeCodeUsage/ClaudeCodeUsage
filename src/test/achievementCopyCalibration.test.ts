import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { ACHIEVEMENT_COPY, achievementCopyFor } from '../i18n';

// Semantic markers rather than whole-string snapshots: concise translations may
// change, but the qualification and evidence boundaries must remain visible.
const localeMarkers = {
  en: { closed: /closed/, output: /positive output/, each: /each/, monday: /Monday/,
    zero: /zero weeks/, first: /first event week/, retention: /deleted\/rotated logs/i, gaps: /gaps/ },
  'zh-CN': { closed: /已结束/, output: /正输出/, each: /各|每/, monday: /周一/,
    zero: /零用量周/, first: /首条事件所在周/, retention: /删除或轮转的日志/, gaps: /缺口/ },
  'zh-TW': { closed: /已結束/, output: /正輸出/, each: /各|每/, monday: /週一/,
    zero: /零用量週/, first: /首筆事件所在週/, retention: /刪除或輪替的日誌/, gaps: /缺口/ },
  'de-DE': { closed: /abgeschlossen/, output: /positiver Ausgabe/, each: /je|jeder/, monday: /Montag/,
    zero: /Nullwochen/, first: /erste Ereigniswoche/, retention: /gelöschte\/rotierte Logs/i, gaps: /Lücken/ },
  ja: { closed: /終了済み/, output: /正の出力/, each: /各|それぞれ/, monday: /月曜/,
    zero: /ゼロ使用週/, first: /最初のイベント週/, retention: /削除・ローテーションされたログ/, gaps: /欠落/ },
  ko: { closed: /종료된/, output: /양의 출력/, each: /각|매일/, monday: /월요일/,
    zero: /사용량 0인 주/, first: /첫 이벤트 주/, retention: /삭제·순환된 로그/, gaps: /누락/ },
  'pt-BR': { closed: /encerrad/, output: /saída positiva/, each: /cada/, monday: /segunda-feira/,
    zero: /semanas zeradas/, first: /primeira semana com evento/, retention: /logs apagados\/rotacionados/i, gaps: /lacunas/ },
  id: { closed: /berakhir/, output: /keluaran positif/, each: /masing-masing|setiap/, monday: /Senin/,
    zero: /pekan nol/, first: /pekan event pertama/, retention: /log dihapus\/dirotasi/i, gaps: /celah/ },
} as const;

const million = /1M\+|100\s*万|100萬|100만\+|1 milhão\+|1 juta\+/;
const halfMillion = /500K\+|50\s*万|50萬|50만\+|500 mil\+|500 ribu\+/;

test('copy covers exactly eight public locales, 124 rules and 46 gallery items', () => {
  assert.deepEqual(Object.keys(ACHIEVEMENT_COPY).sort(), Object.keys(localeMarkers).sort());
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 124);
  const collapsedRules = Object.values(ACHIEVEMENT_SERIES).reduce((sum, ids) => sum + ids.length - 1, 0);
  assert.equal(ACHIEVEMENT_DEFINITIONS.length - collapsedRules, 46);
  assert.equal(achievementCopyFor('unsupported'), ACHIEVEMENT_COPY.en);
});

for (const locale of Object.keys(localeMarkers) as Array<keyof typeof localeMarkers>) {
  const copy = ACHIEVEMENT_COPY[locale];
  const markers = localeMarkers[locale];

  test(`${locale}: tier titles use the existing localized Ordinary/Silver/Gold labels`, () => {
    assert.equal(achievementCopyFor(locale), copy);
    assert.deepEqual(Object.keys(copy.titles).sort(), ACHIEVEMENT_DEFINITIONS.map(({ id }) => id).sort());
    for (const { id } of ACHIEVEMENT_DEFINITIONS) {
      const title = copy.titles[id];
      assert.doesNotMatch(title, /\bI{1,3}$/u, id);
      const tier = /-(bronze|silver|gold)$/.exec(id)?.[1];
      // Streaks have descriptive day-count names rather than numbered titles.
      if (!tier || id.startsWith('active-day-streak')) continue;
      const index = ['bronze', 'silver', 'gold'].indexOf(tier);
      assert.ok(title.endsWith(copy.levels[index]), `${id}: ${title}`);
    }
  });

  test(`${locale}: all model days, including Fable, have one qualified closed-day unit`, () => {
    assert.match(copy.units.qualifiedDays, markers.closed);
    assert.match(copy.units.qualifiedDays, markers.output);
    assert.match(copy.units.qualifiedDays, million);
    assert.match(copy.units.qualifiedDays, markers.each);
    assert.doesNotMatch(copy.units.days, million, 'ordinary active days keep their separate meaning');
  });

  test(`${locale}: family breadth includes exact Fable and three-family days qualify each family`, () => {
    assert.match(copy.units.families, /7/);
    assert.match(copy.units.families, /Fable 5\/5\.1/);
    assert.match(copy.units.families, halfMillion);
    assert.match(copy.units.families, markers.each);
    const threeFamilyDay = copy.units.threeFamilyDay;
    assert.ok(threeFamilyDay, 'a localized unit is needed for the single-day award');
    assert.match(threeFamilyDay, /3/);
    assert.match(threeFamilyDay, /7/);
    assert.match(threeFamilyDay, /Fable 5\/5\.1/);
    assert.match(threeFamilyDay, markers.closed);
    assert.match(threeFamilyDay, million);
    assert.match(threeFamilyDay, markers.output);
    assert.match(threeFamilyDay, markers.each);
    assert.doesNotMatch(threeFamilyDay, /100K|10万|10萬|10만/);
  });

  test(`${locale}: active weeks require four individually qualified days`, () => {
    assert.match(copy.units.weeks, /4\+/);
    assert.match(copy.units.weeks, markers.closed);
    assert.match(copy.units.weeks, markers.each);
    assert.match(copy.units.weeks, million);
    assert.match(copy.units.weeks, markers.output);
    assert.match(copy.units.weeks, markers.monday);
  });

  test(`${locale}: peak four-week mean includes zero weeks, divides by four and has a 5B Gold target`, () => {
    assert.match(copy.units.weeklyAverage, markers.closed);
    assert.match(copy.units.weeklyAverage, markers.monday);
    assert.match(copy.units.weeklyAverage, markers.zero);
    assert.match(copy.units.weeklyAverage, /÷\s*4/);
    // The shared unit belongs to all three tiers; baking Gold/5B into it made
    // Ordinary (500M) and Silver (2B) requirements contradictory. The renderer
    // prepends each rule's actual target and its own localized tier title.
    assert.doesNotMatch(copy.units.weeklyAverage, /5B/);
    assert.equal(ACHIEVEMENT_DEFINITIONS.find(entry => entry.id === 'weekly-average-gold')!.target, 5_000_000_000);
    assert.ok(copy.titles['weekly-average-gold'].endsWith(copy.levels[2]));
    assert.doesNotMatch(copy.units.weeklyAverage, /10B|complete|vollständig|完整|完全|완전|complet|lengkap/i);
  });

  test(`${locale}: retained-log limits and first-event-week exclusion never promise complete observation`, () => {
    assert.match(copy.lowerBoundNote, /≥/);
    assert.match(copy.lowerBoundNote, markers.first);
    assert.match(copy.lowerBoundNote, markers.retention);
    assert.match(copy.lowerBoundNote, markers.gaps);
    assert.doesNotMatch(copy.lowerBoundNote, /complete observations|完整观测|完整觀測|完全な観測|완전한 관측/i);
    const publicCopy = JSON.stringify(copy);
    assert.doesNotMatch(publicCopy, /coming soon|planned|future plan|计划推出|規劃推出|近日公開|출시 예정|planejado|direncanakan/i);
  });
}
