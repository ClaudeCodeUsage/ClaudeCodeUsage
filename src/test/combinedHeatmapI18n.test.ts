import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  I18n,
  SHARING_WORKSPACE_TRANSLATIONS,
  SharingWorkspaceTranslations,
} from '../i18n';
import { SupportedLanguage } from '../types';

const LOCALES: SupportedLanguage[] = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
const NON_ENGLISH = LOCALES.filter((locale) => locale !== 'en');
const WEBVIEW_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'webview.ts'),
  'utf8',
);

function combinedCopyFields(): string[] {
  const start = WEBVIEW_SOURCE.indexOf('interface CombinedHeatmapUiCopy {');
  const end = WEBVIEW_SOURCE.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'CombinedHeatmapUiCopy interface must exist');
  const fields = [...WEBVIEW_SOURCE.slice(start, end).matchAll(/^\s+(\w+): string;$/gm)]
    .map((match) => match[1]);
  assert.equal(fields.length, 38, 'the combined presentation copy contract changed; update locale coverage');
  return fields;
}

function combinedCopyFunction(): string {
  const start = WEBVIEW_SOURCE.indexOf('function combinedHeatmapUiCopy(');
  const end = WEBVIEW_SOURCE.indexOf('\nexport class UsageWebviewProvider', start);
  assert.ok(start >= 0 && end > start, 'combinedHeatmapUiCopy must exist');
  return WEBVIEW_SOURCE.slice(start, end);
}

function combinedLocaleBranch(locale: SupportedLanguage): string | undefined {
  const source = combinedCopyFunction();
  const markerStart = source.indexOf(`if (locale === '${locale}')`);
  if (markerStart < 0) return undefined;
  const objectStart = source.indexOf('return {', markerStart);
  const objectEnd = source.indexOf('\n    };', objectStart);
  assert.ok(objectStart >= 0 && objectEnd > objectStart, `${locale}: locale object must be parseable`);
  return source.slice(objectStart, objectEnd);
}

test('every non-English locale retains complete combined-presentation copy', () => {
  const translatedFields = combinedCopyFields().filter((field) => !field.startsWith('intensity'));
  const missing: string[] = [];
  for (const locale of NON_ENGLISH) {
    const branch = combinedLocaleBranch(locale);
    if (!branch) {
      missing.push(`${locale}:branch`);
      continue;
    }
    for (const field of translatedFields) {
      if (!new RegExp(`\\b${field}:`).test(branch)) missing.push(`${locale}:${field}`);
    }
  }
  assert.deepEqual(missing, [], `missing combined-presentation translations: ${missing.join(', ')}`);
});

test('every locale owns complete active sharing-workspace copy', () => {
  const englishFields = Object.keys(
    SHARING_WORKSPACE_TRANSLATIONS.en,
  ) as (keyof SharingWorkspaceTranslations)[];
  assert.ok(englishFields.length >= 40, 'the unified sharing workspace copy contract is unexpectedly small');

  for (const locale of LOCALES) {
    const copy = SHARING_WORKSPACE_TRANSLATIONS[locale];
    assert.deepEqual(
      Object.keys(copy).sort(),
      [...englishFields].sort(),
      `${locale}: sharing copy fields`,
    );
    for (const field of englishFields) {
      assert.ok(copy[field].trim().length > 0, `${locale}:${field}`);
    }
  }
});

test('I18n exposes the selected locale sharing-workspace copy without fallback', () => {
  for (const locale of LOCALES) {
    I18n.setLanguage(locale);
    assert.strictEqual(I18n.sharingWorkspace, SHARING_WORKSPACE_TRANSLATIONS[locale]);
  }
});
