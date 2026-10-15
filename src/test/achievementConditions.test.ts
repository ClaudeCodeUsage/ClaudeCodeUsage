import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { achievementConditionFor } from '../achievementConditions';
import { ACHIEVEMENT_COPY, achievementAppearanceCopyFor } from '../i18n';
import type { AchievementId } from '../achievements';

// Check meaning and quantities, not translation snapshots or generated strings.
const markers = {
  en: { task: /task/, child: /subagent/, main: /main session/, model: /recognized models/,
    effort: /tier/, family: /famil(?:y|ies)/, each: /[Ee]ach|Per/, output: /output/, processed: /processed/,
    alias: /aliases/, verified: /[Vv]erified/, duplicate: /deduplicated/, reviewer: /approval reviewers/, qualified: /qualified/ },
  'de-DE': { task: /Aufgabe/, child: /Unteragent/, main: /Hauptsitzung/, model: /erkannte Modelle/,
    effort: /Denkstufe/, family: /[Ff]amilie/, each: /je|Je/, output: /Ausgabe/, processed: /verarbeitete/,
    alias: /Aliasse/, verified: /[Bb]estätigte/, duplicate: /deduplizierte/, reviewer: /Freigabeprüfer/, qualified: /qualifizierte/ },
  'zh-CN': { task: /任务/, child: /子智能体/, main: /主会话/, model: /明确模型/,
    effort: /档/, family: /家族/, each: /每|各/, output: /输出/, processed: /已处理/,
    alias: /别名/, verified: /可确认/, duplicate: /去重/, reviewer: /审批审查器/, qualified: /合格/ },
  'zh-TW': { task: /任務/, child: /子代理/, main: /主工作階段/, model: /明確模型/,
    effort: /檔/, family: /家族/, each: /每|各/, output: /輸出/, processed: /已處理/,
    alias: /別名/, verified: /已確認/, duplicate: /去重/, reviewer: /審批審查器/, qualified: /合格/ },
  ja: { task: /タスク/, child: /子エージェント/, main: /メインセッション/, model: /認識済みモデル/,
    effort: /推論レベル/, family: /系統/, each: /各/, output: /出力/, processed: /処理/,
    alias: /別名/, verified: /確認済み/, duplicate: /重複除去/, reviewer: /承認レビュアー/, qualified: /条件を満たす/ },
  ko: { task: /작업/, child: /하위 에이전트/, main: /주 세션/, model: /인식된 모델/,
    effort: /추론 단계/, family: /계열/, each: /각/, output: /출력/, processed: /처리/,
    alias: /별칭/, verified: /확인된/, duplicate: /중복 제거/, reviewer: /승인 검토자/, qualified: /조건을 충족한/ },
  'pt-BR': { task: /tarefa/, child: /subagente/, main: /sessão principal/, model: /modelos reconhecidos/,
    effort: /níve[li]/, family: /família/, each: /[Cc]ada|Por/, output: /saída/, processed: /processados/,
    alias: /Aliases/, verified: /[Vv]erificad/, duplicate: /deduplicado/, reviewer: /revisores de aprovação/, qualified: /qualificad/ },
  id: { task: /tugas/, child: /subagen/, main: /sesi utama/, model: /model dikenali/,
    effort: /tingkat/, family: /keluarga/, each: /tiap|[Ss]etiap/, output: /output/, processed: /diproses/,
    alias: /Alias/, verified: /[Tt]erverifikasi/, duplicate: /dideduplikasi/, reviewer: /peninjau persetujuan/, qualified: /memenuhi syarat/ },
} as const;

const teamIds = ['agent-standup', 'tiny-ai-company', 'agent-team-gold'] as const;
const conductorIds = ['agent-conductor', 'agent-conductor-silver', 'agent-conductor-gold'] as const;
const participationIds = ['agent-participation-bronze', 'agent-participation-silver', 'agent-participation-gold'] as const;
const modelIds = ['multi-core-human', 'same-root-models-silver', 'same-root-models-gold'] as const;
const multiModelIds = ['model-relay-roots-bronze', 'model-relay-roots-silver', 'model-relay-roots-gold'] as const;
const effortIds = ['effort-explorer', 'effort-breadth-silver', 'effort-spectrum'] as const;
const rainbowIds = ['model-rainbow-bronze', 'model-rainbow', 'model-rainbow-gold'] as const;
const ids = [...teamIds, ...conductorIds, ...participationIds, ...modelIds, ...multiModelIds, ...effortIds, ...rainbowIds];

// These quantities are the independent supplement §4 contract. In particular,
// 500K is valid silver effort output, but never the rainbow processed minimum.
function minimum(text: string, quantity: string): void {
  assert.match(text, new RegExp(`≥\\s*${quantity}(?![\\dA-Za-z])`));
}

test('condition API follows locale fallback and leaves unrelated achievements undefined', () => {
  assert.equal(new Set(ids).size, 21);
  for (const id of ids) assert.equal(achievementConditionFor('unsupported', id), achievementConditionFor('en', id));
  for (const locale of [...Object.keys(markers), 'unsupported', 'constructor', '__proto__']) {
    for (const id of ['cache-wizard', 'three-family-day'] as const) {
      assert.equal(achievementConditionFor(locale, id), undefined);
    }
    assert.equal(achievementConditionFor(locale, 'constructor' as AchievementId), undefined);
    assert.equal(achievementConditionFor(locale, 'toString' as AchievementId), undefined);
  }
});

test('root task description explains shared counting and never equates usage with completed work', () => {
  for(const locale of Object.keys(markers)){
    const bronze=achievementConditionFor(locale,'root-portfolio-bronze');
    assert.ok(bronze&&bronze.length>40);
    for(const id of ['root-portfolio-silver','root-portfolio-gold'] as const)
      assert.equal(achievementConditionFor(locale,id),bronze);
  }
  const chinese=achievementConditionFor('zh-CN','root-portfolio-bronze')!;
  assert.match(chinese,/已识别模型用量/);assert.match(chinese,/只计一次/);assert.match(chinese,/不表示任务完成/);
  assert.equal(achievementConditionFor('unsupported','root-portfolio-bronze'),achievementConditionFor('en','root-portfolio-bronze'));
});

test('appearance helper covers eight locales with nonempty controls and the six-pin placeholder', () => {
  const english = achievementAppearanceCopyFor('en');
  assert.equal(Object.keys(english).length, 15);
  for (const locale of Object.keys(markers)) {
    const copy = achievementAppearanceCopyFor(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort());
    for (const value of Object.values(copy)) assert.ok(value.trim());
    assert.match(copy.selectedCount, /\{count\}\/6/);
    if (locale !== 'en') assert.notEqual(copy, english);
  }
  for (const locale of ['unsupported', 'constructor', '__proto__']) {
    assert.equal(achievementAppearanceCopyFor(locale), english);
  }
});

for (const locale of Object.keys(markers) as Array<keyof typeof markers>) {
  const m = markers[locale];
  const condition = (id: AchievementId): string => {
    const value = achievementConditionFor(locale, id);
    assert.ok(value, `${locale}/${id}: missing localized condition`);
    assert.ok(value.trim(), `${locale}/${id}: empty localized condition`);
    if (locale !== 'en') assert.notEqual(value, achievementConditionFor('en', id), 'no hidden English fallback');
    return value;
  };

  test(`${locale}: all 21 conditions preserve verified output and reviewer exclusions`, () => {
    for (const id of ids) {
      const text = condition(id);
      for (const marker of [m.output, m.verified, m.duplicate, m.reviewer]) assert.match(text, marker, id);
      assert.doesNotMatch(text, /simultaneous|completed tasks|成果价值|成果價值|同时在线|同時在線/i);
    }
  });

  test(`${locale}: team tiers describe per-child output and main output, never repeat task targets`, () => {
    for (let tier = 0; tier < 3; tier++) {
      const text = condition(teamIds[tier]);
      minimum(text, ['3', '5', '8'][tier]);
      minimum(text, ['5K', '10K', '20K'][tier]);
      for (const marker of [m.task, m.child, m.main, m.each]) assert.match(text, marker);
      assert.doesNotMatch(text, new RegExp(`\\b${[5, 20, 50][tier]}\\b(?!K)`), 'target belongs to the card');
    }
    for (const id of conductorIds) assert.equal(condition(id), condition(teamIds[0]));
    for (const id of participationIds) {
      minimum(condition(id), '5K');
      assert.match(condition(id), m.child);
      assert.match(condition(id), m.each);
    }
  });

  test(`${locale}: same-task model counts are qualification minima, aliases do not multiply them`, () => {
    for (let tier = 0; tier < 3; tier++) {
      const text = condition(modelIds[tier]);
      minimum(text, ['2', '3', '4'][tier]);
      minimum(text, ['10K', '20K', '50K'][tier]);
      for (const marker of [m.task, m.model, m.each, m.alias]) assert.match(text, marker);
      assert.doesNotMatch(text, new RegExp(`\\b${[3, 10, 30][tier]}\\b(?!K)`), 'do not repeat the task target as model count');
    }
    for (const id of multiModelIds) assert.equal(condition(id), condition(modelIds[0]));
  });

  test(`${locale}: effort combines processed, output and output-bearing task breadth in each tier`, () => {
    for (let tier = 0; tier < 3; tier++) {
      const text = condition(effortIds[tier]);
      for (const quantity of [['100M', '100K', '5'], ['500M', '500K', '10'], ['2B', '2M', '30']][tier]) minimum(text, quantity);
      for (const marker of [m.effort, m.each, m.processed, m.output, m.task]) assert.match(text, marker);
      assert.doesNotMatch(text, /(?<!\d)10M\b/, 'retire the old effort minimum');
      assert.doesNotMatch(text, new RegExp(`\\b${[4, 5, 6][tier]}\\b`), 'tier-count target already displayed');
    }
  });

  test(`${locale}: rainbow requires processed AND output for each recognized family`, () => {
    for (const id of rainbowIds) {
      const text = condition(id);
      minimum(text, '10M');
      minimum(text, '20K');
      for (const marker of [m.family, m.each, m.processed, m.output, m.alias]) assert.match(text, marker);
      assert.match(text, /Fable 5\/5\.1/);
      assert.doesNotMatch(text, /500K|50\s*[万萬]|50만|500\s*(?:mil|ribu)/, 'retire the old family minimum');
    }
  });

  test(`${locale}: compact units count qualified objects, team titles form one series, pin limit is six`, () => {
    const copy = ACHIEVEMENT_COPY[locale];
    for (const key of ['agents', 'models', 'agentRoots'] as const) assert.match(copy.units[key], m.task);
    assert.match(copy.units.childSessions, m.child);
    assert.match(copy.units.efforts, m.effort);
    assert.match(copy.units.families, m.family);
    for (const key of ['agents', 'models', 'agentRoots', 'childSessions', 'efforts', 'families'] as const) {
      assert.match(copy.units[key], m.qualified, key);
      assert.doesNotMatch(copy.units[key], /\d/, 'qualification amounts belong to conditions');
    }
    const rootUnits={en:/root tasks/,'de-DE':/Hauptaufgaben/,'zh-CN':/独立主任务/,'zh-TW':/獨立主任務/,
      ja:/メインタスク/,ko:/주 작업/,'pt-BR':/tarefas raiz/,id:/tugas utama/};
    assert.match(copy.units.roots, rootUnits[locale], 'count independent root tasks, not completed tasks or all child sessions');
    assert.doesNotMatch(copy.units.roots, m.qualified, 'do not apply team/model qualification to root portfolio');
    const stems = teamIds.map((id, tier) => {
      assert.ok(copy.titles[id].endsWith(copy.levels[tier]), id);
      return copy.titles[id].slice(0, -copy.levels[tier].length).trim();
    });
    assert.equal(new Set(stems).size, 1, 'one team series, differentiated by levels');
    assert.match(copy.pinLimit, /6/);
    assert.doesNotMatch(copy.pinLimit, /3/);
  });
}
