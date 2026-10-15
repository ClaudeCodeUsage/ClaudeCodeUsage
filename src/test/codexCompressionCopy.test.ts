import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import type { SupportedLanguage } from '../types';

const meanings: Record<SupportedLanguage, readonly RegExp[]> = {
  en: [/runtime.*does not support.*compressed Codex logs/i, /update VS Code/i, /last verified data.*retained/i],
  'de-DE': [/Laufzeit.*unterstützt keine komprimierten Codex-Protokolle/, /Aktualisieren Sie VS Code/, /zuletzt geprüften Daten bleiben erhalten/],
  'zh-CN': [/当前 VS Code 运行环境不支持.*压缩日志/, /请更新 VS Code/, /保留上次.*验证.*数据/],
  'zh-TW': [/目前 VS Code 執行環境不支援.*壓縮日誌/, /請更新 VS Code/, /保留上次.*驗證.*資料/],
  ja: [/実行環境.*圧縮.*ログ.*対応していません/, /VS Code を更新/, /前回.*検証済みデータ.*保持/],
  ko: [/실행 환경.*압축.*로그.*지원하지 않습니다/, /VS Code를 업데이트/, /마지막으로 검증된 데이터.*유지/],
  'pt-BR': [/ambiente de execução.*não suporta logs compactados/i, /Atualize o VS Code/, /últimos dados verificados.*mantidos/],
  id: [/runtime.*tidak mendukung log Codex terkompresi/i, /Perbarui VS Code/, /Data terakhir yang terverifikasi.*dipertahankan/],
};

for (const locale of Object.keys(meanings) as SupportedLanguage[]) {
  test(`${locale}: compression notice identifies the host limitation, update action and retained data`, () => {
    const previous = I18n.getCurrentLanguage();
    try {
      I18n.setLanguage(locale);
      const copy = I18n.codexCompressionRuntimeUnsupported;
      assert.equal(typeof copy, 'string');
      assert.ok(copy.trim(), 'notice must not be empty');
      assert.match(copy, /VS Code/);
      assert.match(copy, /Codex/);
      for (const meaning of meanings[locale]) assert.match(copy, meaning);
      assert.doesNotMatch(copy, /\bnode(?:\.js)?\b|\d+\.\d+|npm|nvm|brew/i,
        'describe host capability without suggesting a system Node upgrade or a version cutoff');
      assert.doesNotMatch(copy, /[\r\n]|<[^>]+>/, 'one plain notice, without UI markup');
      assert.doesNotMatch(copy, /\/Users\/|\/home\/|[A-Z]:\\|~\/|\$\{?|\.codex|auth\.json|credential|api[_ -]?key|access[_ -]?token|bearer\s|sk-[a-z0-9]/i,
        'notice must not expose private paths, credentials or dynamic placeholders');
    } finally {
      I18n.setLanguage(previous);
    }
  });
}

test('all eight compression notices have independent localized copy', () => {
  const previous = I18n.getCurrentLanguage();
  try {
    const copies = Object.keys(meanings).map(locale => {
      I18n.setLanguage(locale as SupportedLanguage);
      return I18n.codexCompressionRuntimeUnsupported;
    });
    assert.equal(copies.length, 8);
    assert.equal(new Set(copies).size, 8, 'no shared fallback text');
  } finally {
    I18n.setLanguage(previous);
  }
});
