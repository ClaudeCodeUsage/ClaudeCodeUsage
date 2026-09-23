import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';

test('auto language follows the editor locale for every supported family', () => {
  const previous = I18n.getCurrentLanguage();
  try {
    for (const [editorLocale, expected] of [
      ['de-CH', 'de-DE'],
      ['pt-BR', 'pt-BR'],
      ['zh-HK', 'zh-TW'],
      ['zh-CN', 'zh-CN'],
      ['ja-JP', 'ja'],
      ['ko-KR', 'ko'],
      ['id-ID', 'id'],
      ['en-US', 'en'],
    ] as const) {
      I18n.setLanguage('auto', editorLocale);
      assert.equal(I18n.getCurrentLanguage(), expected, editorLocale);
    }
  } finally {
    I18n.setLanguage(previous);
  }
});
