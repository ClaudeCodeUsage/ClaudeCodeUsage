// Localization coverage for the quota strings. A missing locale here fails
// silently at runtime (settingText returns {} and the settings panel quietly
// falls back to English), so the gap is only ever visible in a test.
//
// settings.ts imports vscode and so cannot be loaded under plain node:test.
// The catalog keys are therefore read out of its source text, which keeps this
// a repository-invariant check rather than a behaviour test of SettingsStore.

import * as fs from 'fs';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import { SupportedLanguage } from '../types';

// Every UI locale the repository policy requires.
const LOCALES: SupportedLanguage[] = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
// English lives in the settings catalog itself, not the per-locale override table.
const TRANSLATED = LOCALES.filter((l) => l !== 'en');

/** Setting keys declared in the SETTINGS catalog, read from source. */
function catalogKeys(): string[] {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'settings.ts'), 'utf8');
  const catalog = src.slice(src.indexOf('export const SETTINGS'), src.indexOf('export class SettingsStore'));
  const keys = [...catalog.matchAll(/^\s{4}key: '([^']+)',$/gm)].map((m) => m[1]);
  assert.ok(keys.length > 20, `expected to parse the settings catalog, got ${keys.length} keys`);
  return keys;
}

function withLanguage<T>(lang: SupportedLanguage, fn: () => T): T {
  const previous = I18n.getCurrentLanguage();
  I18n.setLanguage(lang);
  try {
    return fn();
  } finally {
    I18n.setLanguage(previous);
  }
}

test('the quota tooltip strings exist in every UI locale', () => {
  for (const lang of LOCALES) {
    withLanguage(lang, () => {
      const t = I18n.t.popup;
      for (const key of ['quota5h', 'quotaWeekly', 'quotaAllModels', 'quotaScoped', 'quotaCredits'] as const) {
        assert.equal(typeof t[key], 'string', `${lang}: popup.${key} must be a string`);
        assert.ok(t[key].length > 0, `${lang}: popup.${key} must not be empty`);
      }
    });
  }
});

test('showScopedWeekly is translated in every non-English locale', () => {
  for (const lang of TRANSLATED) {
    withLanguage(lang, () => {
      const text = I18n.settingText('showScopedWeekly');
      assert.ok(text.label, `${lang}: showScopedWeekly needs a label`);
      assert.ok(text.help, `${lang}: showScopedWeekly needs help text`);
    });
  }
});

test('the retired showOpusWeekly key is gone from the catalog and the locales', () => {
  // Its stored value still migrates (SettingsStore.migrateScopedWeekly); what
  // must not survive is a second, dead entry in the settings panel.
  assert.equal(catalogKeys().includes('showOpusWeekly'), false);
  for (const lang of TRANSLATED) {
    withLanguage(lang, () => {
      assert.deepEqual(I18n.settingText('showOpusWeekly'), {}, `${lang}: showOpusWeekly should be untranslated`);
    });
  }
});

test('every settings-catalog key has a label in every non-English locale', () => {
  // The invariant the quota rename could have broken repo-wide: renaming a key
  // without touching SETTINGS_I18N leaves that row silently English.
  const keys = catalogKeys();
  const missing: string[] = [];
  for (const lang of TRANSLATED) {
    withLanguage(lang, () => {
      for (const key of keys) {
        if (!I18n.settingText(key).label) {
          missing.push(`${lang}:${key}`);
        }
      }
    });
  }
  assert.deepEqual(missing, [], `untranslated setting labels: ${missing.join(', ')}`);
});
