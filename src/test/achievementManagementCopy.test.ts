import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n, ACHIEVEMENT_COPY, achievementAppearanceCopyFor, AchievementManagementCopy } from '../i18n';
import { achievementTitleWithoutRank } from '../achievementTitles';
import { ACHIEVEMENT_DEFINITIONS } from '../achievements';
import { SupportedLanguage } from '../types';

const ranks: Record<SupportedLanguage, string[]> = {
  en: ['Bronze', 'Silver', 'Gold'], 'zh-CN': ['铜', '银', '金'],
  'zh-TW': ['銅', '銀', '金'], 'de-DE': ['Bronze', 'Silber', 'Gold'],
  ja: ['ブロンズ', 'シルバー', 'ゴールド'], ko: ['브론즈', '실버', '골드'],
  'pt-BR': ['Bronze', 'Prata', 'Ouro'], id: ['Perunggu', 'Perak', 'Emas'],
};
const keys = ['expandAll', 'collapseAll', 'recalibrate', 'recalibrating', 'recalibrated',
  'recalibrationFailed', 'recalibratedPartial', 'currentValue', 'verifiedDay', 'firstRecorded', 'unknownDay',
  'dateNote', 'sharedConditions', 'dateUnavailable'].sort() as (keyof AchievementManagementCopy)[];
const dateMarkers: Record<SupportedLanguage, RegExp[]> = {
  en: [/earliest/i, /logs/i, /not.*complete.*account history/i],
  'zh-CN': [/最早/, /日志/, /不.*账户.*完整历史/],
  'zh-TW': [/最早/, /日誌/, /不.*帳戶.*完整歷史/],
  'de-DE': [/früheste/i, /Logs/, /nicht.*vollständige.*Kontoverlauf/],
  ja: [/最も早い/, /ログ/, /アカウント.*完全な履歴.*ではありません/],
  ko: [/가장 이른/, /로그/, /계정.*전체 기록.*아닙니다/],
  'pt-BR': [/mais antiga/, /logs/, /não.*histórico completo.*conta/],
  id: [/paling awal/, /log/, /bukan.*riwayat lengkap akun/],
};
const calibrationMarkers: Record<SupportedLanguage, [RegExp, RegExp]> = {
  en: [/badges are kept/, /new awards still require verified conditions/],
  'zh-CN': [/已获徽章保留/, /新增授奖仍须满足已核验的条件/],
  'zh-TW': [/已獲徽章保留/, /新增授獎仍須滿足已核驗的條件/],
  'de-DE': [/Abzeichen bleiben erhalten/, /neue Auszeichnungen erfordern weiterhin geprüfte Bedingungen/],
  ja: [/獲得済みバッジは保持/, /新しい授与には引き続き条件の検証が必要/],
  ko: [/획득한 배지는 유지/, /새 수여에는 계속 조건 검증이 필요/],
  'pt-BR': [/emblemas obtidos são mantidos/, /novas concessões ainda exigem condições verificadas/],
  id: [/Lencana yang diperoleh tetap disimpan/, /pemberian baru tetap memerlukan syarat yang terverifikasi/],
};

for (const locale of Object.keys(ranks) as SupportedLanguage[]) {
  test(`${locale}: all public achievement ranks use localized metals without old visual labels`, () => {
    const copy = ACHIEVEMENT_COPY[locale];
    assert.deepEqual(copy.levels.slice(0, 3), ranks[locale]);
    assert.deepEqual(Object.keys(copy.titles).sort(), ACHIEVEMENT_DEFINITIONS.map(row => row.id).sort());
    assert.doesNotMatch(JSON.stringify(copy), /Ordinary|·\s*Basis|·\s*Básico|·\s*Dasar|[·・]\s*(?:普通|一般|通常|일반|银色|銀色|金色)/);
    for (const [id, title] of Object.entries(copy.titles)) {
      const rankIndex = ['bronze', 'silver', 'gold', 'platinum', 'legendary'].findIndex(rank => id.endsWith('-' + rank));
      // Some original milestones use a narrative name rather than a rank suffix.
      if (rankIndex < 0 || !/[·・]/u.test(title)) continue;
      const rank = copy.levels[rankIndex];
      assert.ok(title.endsWith(rank), `${id}: ${title}`);
      const name = achievementTitleWithoutRank(title, rank);
      assert.notEqual(name, title, id);
      assert.doesNotMatch(name, /[·・]\s*(?:普通|一般|银色|銀色|金色|铜|銅|银|銀|金)$/u, id);
    }
  });

  test(`${locale}: management getter covers every action and distinguishes evidence dates`, () => {
    const previous = I18n.getLocale() as SupportedLanguage;
    try {
      I18n.setLanguage(locale);
      const copy = I18n.achievementManagement;
      assert.ok(copy, 'management copy must be available independently');
      assert.deepEqual(Object.keys(copy).sort(), keys);
      for (const key of keys) assert.ok(copy[key].trim(), `${locale}/${key}`);
      assert.equal(new Set([copy.recalibrate, copy.recalibrating, copy.recalibrated, copy.recalibrationFailed]).size, 4);
      assert.equal(new Set([copy.verifiedDay, copy.firstRecorded, copy.unknownDay, copy.dateUnavailable]).size, 4);
      for (const marker of dateMarkers[locale]) assert.match(copy.dateNote, marker);
      assert.match(copy.recalibrated, calibrationMarkers[locale][0]);
      assert.match(copy.recalibrationFailed, calibrationMarkers[locale][0]);
      assert.match(copy.recalibrated, calibrationMarkers[locale][1]);
      if (locale !== 'en') {
        I18n.setLanguage('en');
        const english = I18n.achievementManagement;
        for (const key of keys) assert.notEqual(copy[key], english[key], `${locale}/${key}: no English fallback`);
      }
    } finally { I18n.setLanguage(previous); }
  });
}

test('short ranks strip only their matching legacy delimited suffix', () => {
  const aliases: Record<string, string[]> = {
    '铜': ['普通'], '銅': ['一般', '普通'], '银': ['银色'], '銀': ['銀色'], '金': ['金色'],
    Bronze: ['Ordinary', 'Basis', 'Básico'], 'ブロンズ': ['通常'], '브론즈': ['일반'], Perunggu: ['Dasar'],
  };
  for (const [rank, oldNames] of Object.entries(aliases)) for (const old of oldNames) {
    for (const separator of ['·', '・', ' · ', ' ・ ']) {
      assert.equal(achievementTitleWithoutRank(`Name${separator}${old}`, rank), 'Name');
    }
    for (const title of [old, `Name ${old}`, `Name${old}`, `Name · ${old} detail`, ` · ${old}`]) {
      assert.equal(achievementTitleWithoutRank(title, rank), title);
    }
    assert.equal(achievementTitleWithoutRank(`Name · ${old}`, undefined), `Name · ${old}`);
    assert.equal(achievementTitleWithoutRank(`Name · ${old}`, 'Platinum'), `Name · ${old}`);
  }
  assert.equal(achievementTitleWithoutRank('团队·金色', '银'), '团队·金色');
  assert.equal(achievementTitleWithoutRank('团队·银色', '铜'), '团队·银色');
  assert.equal(achievementTitleWithoutRank('Name · constructor', 'constructor'), 'Name');
  assert.equal(achievementTitleWithoutRank('Name', '__proto__'), 'Name');
  assert.equal(achievementAppearanceCopyFor('zh-CN').legacyPins, '旧规则固定项');
  assert.equal(achievementAppearanceCopyFor('zh-TW').legacyPins, '舊規則固定項');
});
