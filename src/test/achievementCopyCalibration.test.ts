import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { ACHIEVEMENT_COPY, achievementCopyFor } from '../i18n';
import { achievementConditionFor } from '../achievementConditions';
import type { AchievementId } from '../achievements';
import { API_ACHIEVEMENT_DEFINITIONS, API_ACHIEVEMENT_SERIES } from '../achievementMoneyCatalog';
import { isLegacyAchievementId } from '../achievementRuleVersions';
import { LONG_TERM_ACHIEVEMENT_DEFINITIONS } from '../achievementLongTerm';

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

// Detail copy has numeric minima; card units only identify the qualified object.
// Bind quantities to their metric as well as checking scope: swapping processed
// and output amounts must fail even when both numbers and words remain present.
const conditionMarkers = {
  en: { each: /[Ee]ach|Per/, processed: /processed/, output: /output/, and: /\band\b/,
    task: /task/, child: /distinct subagents?/, mainOutput: /main session[^.]*has output/,
    model: /distinct recognized models/, effort: /effort tier/, effortTasks: /tasks with output in that tier/,
    family: /recognized family/, aliases: /aliases count once/, evidence: /[Vv]erified, deduplicated/, excluded: /approval reviewers excluded/ },
  'zh-CN': { each: /每|各/, processed: /已处理/, output: /输出/, and: /且/,
    task: /任务/, child: /不同子智能体/, mainOutput: /主会话有输出/,
    model: /不同明确模型/, effort: /每档/, effortTasks: /仅计入该档有输出的任务/,
    family: /可识别家族/, aliases: /别名不重复计数/, evidence: /可确认、去重/, excluded: /排除审批审查器/ },
  'zh-TW': { each: /每|各/, processed: /已處理/, output: /輸出/, and: /且/,
    task: /任務/, child: /不同子代理/, mainOutput: /主工作階段有輸出/,
    model: /不同明確模型/, effort: /每檔/, effortTasks: /僅計入該檔有輸出的任務/,
    family: /可識別家族/, aliases: /別名不重複計數/, evidence: /已確認、去重/, excluded: /排除審批審查器/ },
  'de-DE': { each: /[Jj]e/, processed: /verarbeitete/, output: /Ausgabe/, and: /\bund\b/,
    task: /Aufgabe/, child: /verschiedene[r]? Unteragent/, mainOutput: /Hauptsitzung hat Ausgabe/,
    model: /verschiedene erkannte Modelle/, effort: /Denkstufe/, effortTasks: /Aufgaben mit Ausgabe in dieser Stufe/,
    family: /erkannter Familie/, aliases: /Aliasse zählen einmal/, evidence: /bestätigte, deduplizierte/, excluded: /Freigabeprüfer ausgeschlossen/ },
  ja: { each: /各/, processed: /処理/, output: /出力/, and: /かつ/,
    task: /タスク/, child: /異なる子エージェント/, mainOutput: /メインセッションも出力あり/,
    model: /異なる認識済みモデル/, effort: /推論レベル/, effortTasks: /そのレベルに出力のあるタスクのみ計上/,
    family: /認識済み系統/, aliases: /別名は重複計上しません/, evidence: /確認済み・重複除去済み/, excluded: /承認レビュアーは除外/ },
  ko: { each: /각/, processed: /처리/, output: /출력/, and: /및/,
    task: /작업/, child: /서로 다른.*하위 에이전트/, mainOutput: /주 세션에도 출력이 있어야/,
    model: /서로 다른 인식된 모델/, effort: /추론 단계/, effortTasks: /해당 단계에 출력이 있는 작업만 집계/,
    family: /인식된 각 계열/, aliases: /별칭은 중복 집계하지 않습니다/, evidence: /확인된 중복 제거/, excluded: /승인 검토자는 제외/ },
  'pt-BR': { each: /[Cc]ada|Por/, processed: /processados/, output: /saída/, and: /\be\b/,
    task: /tarefa/, child: /subagentes? distintos?/, mainOutput: /sessão principal tem saída/,
    model: /modelos reconhecidos distintos/, effort: /nível de esforço/, effortTasks: /apenas tarefas com saída nesse nível/,
    family: /família reconhecida/, aliases: /Aliases[^.]*contam uma vez/, evidence: /verificado e deduplicado/, excluded: /revisores de aprovação excluídos/ },
  id: { each: /[Ss]etiap|tiap/, processed: /diproses/, output: /output/, and: /\bdan\b/,
    task: /tugas/, child: /subagen berbeda/, mainOutput: /sesi utama memiliki output/,
    model: /model dikenali yang berbeda/, effort: /tingkat upaya/, effortTasks: /hanya tugas dengan output pada tingkat itu/,
    family: /keluarga dikenali/, aliases: /Alias[^.]*dihitung sekali/, evidence: /terverifikasi dan dideduplikasi/, excluded: /peninjau persetujuan dikecualikan/ },
} as const;

type Locale = keyof typeof localeMarkers;

function assertMinimum(text: string, quantity: string): void {
  assert.match(text, new RegExp(`≥\\s*${quantity}(?![\\dA-Za-z])`));
}

function assertMetricMinimum(locale: Locale, text: string, quantity: string, metric: RegExp): void {
  const minimum = `≥\\s*${quantity}(?![\\dA-Za-z])`;
  const quantityFirst = ['en', 'de-DE', 'pt-BR', 'id'].includes(locale);
  assert.match(text, new RegExp(quantityFirst
    ? `${minimum}[^≥.;；。]*${metric.source}`
    : `${metric.source}\\s*${minimum}`), `${quantity} must qualify ${metric.source}`);
}

function assertTokenPair(locale: Locale, text: string, processed: string, output: string): void {
  const markers = conditionMarkers[locale];
  assertMetricMinimum(locale, text, processed, markers.processed);
  assertMetricMinimum(locale, text, output, markers.output);
  assert.match(text.slice(text.indexOf(processed) + processed.length, text.indexOf(output)), markers.and,
    'processed and output minima must be conjunctive');
}

const modelExperienceMarkers = {
  en: [/Models in one task/, /Multi-model tasks/, /same-session/],
  'zh-CN': [/同任务模型/, /多模型任务/, /同会话/],
  'zh-TW': [/同任務模型/, /多模型任務/, /同會話/],
  'de-DE': [/Modelle je Aufgabe/, /Mehrmodell-Aufgaben/, /gemeinsame Sitzung/],
  ja: [/同一タスクのモデル/, /複数モデルのタスク/, /同一セッション/],
  ko: [/한 작업의 모델/, /다중 모델 작업/, /같은 세션/],
  'pt-BR': [/Modelos por tarefa/, /Tarefas multimodelo/, /mesma sessão/],
  id: [/Model dalam satu tugas/, /Tugas multimodel/, /sesi yang sama/],
} as const;

test('copy covers exactly eight public locales and the current rule and artwork identities', () => {
  assert.deepEqual(Object.keys(ACHIEVEMENT_COPY).sort(), Object.keys(localeMarkers).sort());
  const legacyIds = ACHIEVEMENT_DEFINITIONS.filter(row => isLegacyAchievementId(row.id)).map(row => row.id);
  const moneyIds = API_ACHIEVEMENT_DEFINITIONS.map(row => row.id);
  assert.equal(legacyIds.length, 124, 'the V1 allowlist stays frozen');
  assert.equal(moneyIds.length, 24);
  assert.deepEqual(ACHIEVEMENT_DEFINITIONS.map(row => row.id).sort(),
    [...legacyIds, ...moneyIds, ...LONG_TERM_ACHIEVEMENT_DEFINITIONS.map(row=>row.id)].sort());
  const seriesFor = new Map(Object.entries(ACHIEVEMENT_SERIES).flatMap(([key, ids]) => ids.map(id => [id, key] as const)));
  const artworkKeys = new Set(ACHIEVEMENT_DEFINITIONS.map(row => seriesFor.get(row.id) ?? row.id));
  const legacyArtworkKeys = new Set(legacyIds.map(id => seriesFor.get(id) ?? id));
  assert.equal(Object.keys(API_ACHIEVEMENT_SERIES).length, 6);
  assert.equal(legacyArtworkKeys.size, 46);
  assert.deepEqual([...artworkKeys].sort(), [...legacyArtworkKeys, ...Object.keys(API_ACHIEVEMENT_SERIES)].sort());
  assert.equal(achievementCopyFor('unsupported'), ACHIEVEMENT_COPY.en);
});

for (const locale of Object.keys(localeMarkers) as Array<keyof typeof localeMarkers>) {
  const copy = ACHIEVEMENT_COPY[locale];
  const markers = localeMarkers[locale];
  const qualification = conditionMarkers[locale];
  const condition = (id: AchievementId): string => {
    const text = achievementConditionFor(locale, id);
    assert.ok(text, `${locale}/${id}: localized conditions are required`);
    if (locale !== 'en') assert.notEqual(text, achievementConditionFor('en', id), 'no silent English fallback');
    for (const marker of [qualification.each, qualification.evidence, qualification.excluded]) {
      assert.match(text, marker, id);
    }
    return text;
  };
  const cardTarget = (id: AchievementId, expected: number): void => {
    assert.equal(ACHIEVEMENT_DEFINITIONS.find(entry => entry.id === id)?.target, expected,
      `${id}: count targets stay separate from qualification minima`);
  };

  test(`${locale}: model breadth and repeated experience titles do not invent sequential relay`, () => {
    const [breadth, repeated, sameSession] = modelExperienceMarkers[locale];
    for (const id of ['multi-core-human', 'same-root-models-silver', 'same-root-models-gold'] as const) {
      assert.match(copy.titles[id], breadth, id);
    }
    for (const id of ['model-relay-roots-bronze', 'model-relay-roots-silver', 'model-relay-roots-gold'] as const) {
      assert.match(copy.titles[id], repeated, id);
    }
    assert.match(copy.titles['fable-relay'], sameSession);
    assert.doesNotMatch([copy.titles['multi-core-human'], copy.titles['fable-relay'],
      copy.titles['model-relay-roots-bronze']].join(' '), /relay|接力|Staffel|Modellwechsel|revezamento|estafet|bergantian/i);
  });

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

  test(`${locale}: rainbow detail qualifies each family at 10M processed AND 20K output; family-day rules remain separate`, () => {
    for (const [id, target] of [['model-rainbow-bronze', 2], ['model-rainbow', 5], ['model-rainbow-gold', 7]] as const) {
      const text = condition(id);
      cardTarget(id, target);
      assert.match(text, qualification.family);
      assert.match(text, /Fable 5\/5\.1/);
      assert.match(text, qualification.aliases);
      assertTokenPair(locale, text, '10M', '20K');
      assert.doesNotMatch(text, /500K|50\s*[万萬]|50만|500\s*(?:mil|ribu)/, 'old processed minimum must not survive in detail');
    }
    assert.doesNotMatch(copy.units.families, /\d/, 'compact units do not repeat pool size or token minima');
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

  test(`${locale}: team and participation details retain per-child output, distinct members and main output`, () => {
    for (const [id, target, members, output] of [
      ['agent-standup', 5, 3, '5K'], ['tiny-ai-company', 20, 5, '10K'], ['agent-team-gold', 50, 8, '20K'],
      ['agent-conductor', 10, 3, '5K'], ['agent-conductor-silver', 50, 3, '5K'], ['agent-conductor-gold', 200, 3, '5K'],
    ] as const) {
      const text = condition(id);
      cardTarget(id, target);
      assertMinimum(text, String(members));
      assertMetricMinimum(locale, text, output, qualification.output);
      for (const marker of [qualification.task, qualification.child, qualification.mainOutput]) assert.match(text, marker, id);
    }
    for (const [id, target] of [
      ['agent-participation-bronze', 25], ['agent-participation-silver', 250], ['agent-participation-gold', 2_500],
    ] as const) {
      const text = condition(id);
      cardTarget(id, target);
      assert.match(text, qualification.child);
      assertMetricMinimum(locale, text, '5K', qualification.output);
    }
  });

  test(`${locale}: same-task models use tier-aligned output and normalized distinct models, not task targets as model counts`, () => {
    for (const [id, target, models, output] of [
      ['multi-core-human', 3, 2, '10K'], ['same-root-models-silver', 10, 3, '20K'], ['same-root-models-gold', 30, 4, '50K'],
      ['model-relay-roots-bronze', 10, 2, '10K'], ['model-relay-roots-silver', 100, 2, '10K'], ['model-relay-roots-gold', 1_000, 2, '10K'],
    ] as const) {
      const text = condition(id);
      cardTarget(id, target);
      assertMinimum(text, String(models));
      assertMetricMinimum(locale, text, output, qualification.output);
      for (const marker of [qualification.task, qualification.model, qualification.aliases]) assert.match(text, marker, id);
      assert.doesNotMatch(text, new RegExp(`\\b${target}\\b(?!K)`), 'task repetition target is already displayed');
    }
  });

  test(`${locale}: each effort tier needs its own processed/output minima and distinct output-bearing tasks`, () => {
    for (const [id, target, processed, output, tasks] of [
      ['effort-explorer', 4, '100M', '100K', 5],
      ['effort-breadth-silver', 5, '500M', '500K', 10],
      ['effort-spectrum', 6, '2B', '2M', 30],
    ] as const) {
      const text = condition(id);
      cardTarget(id, target);
      assertTokenPair(locale, text, processed, output);
      assertMinimum(text, String(tasks));
      assert.match(text, qualification.effort);
      assert.match(text, qualification.effortTasks, 'task breadth must have output in that same effort tier');
      assert.doesNotMatch(text, /(?<!\d)10M\b/, 'retire the old effort minimum without banning valid silver 500K output');
      assert.doesNotMatch(text, new RegExp(`\\b${target}\\b`), 'qualified tier target stays on the card');
    }
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
    const detail = copy.lowerBoundDetails;
    assert.match(copy.lowerBoundNote, /≥/);
    assert.ok(copy.evidenceTitle.trim(), 'the optional evidence disclosure needs a localized label');
    assert.equal(typeof detail, 'string');
    assert.match(detail, markers.first);
    assert.match(detail, markers.retention);
    assert.match(detail, markers.gaps);
    assert.doesNotMatch(detail, /complete observations|完整观测|完整觀測|完全な観測|완전한 관측/i);
    const publicCopy = JSON.stringify(copy);
    assert.doesNotMatch(publicCopy, /coming soon|planned|future plan|计划推出|規劃推出|近日公開|출시 예정|planejado|direncanakan/i);
  });
}
