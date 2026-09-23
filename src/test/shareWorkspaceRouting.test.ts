import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

const source = (file: string): string => fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', file),
  'utf8',
);

test('legacy public share commands enter the matching preview-first workspace presentation', () => {
  const extension = source('extension.ts');
  const start = extension.indexOf('private setupCommands');
  const end = extension.indexOf('private buildQuotaScopeOptions', start);
  assert.ok(start >= 0 && end > start, 'command setup must remain discoverable');
  const commands = extension.slice(start, end);

  const routes = [
    ['claudeCodeUsage.exportShareCard', 'claudeShareCard'],
    ['claudeCodeUsage.exportHeatmap', 'claudeHeatmap'],
    ['claudeCodeUsage.publishHeatmapToGitHub', 'claudeHeatmap'],
  ] as const;
  for (const [command, presentation] of routes) {
    const registration = commands.indexOf(`registerCommand('${command}'`);
    assert.ok(registration >= 0, `${command} remains public`);
    const nextRegistration = commands.indexOf('registerCommand(', registration + 1);
    const handler = commands.slice(
      registration,
      nextRegistration >= 0 ? nextRegistration : commands.length,
    );
    assert.match(
      handler,
      new RegExp(`showSharingWorkspace\\('${presentation}'\\)`),
      `${command} should route to ${presentation}`,
    );
  }
});

test('sharing has one visible on-off control while the old heatmap preference remains compatibility-only', () => {
  const settings = source('settings.ts');
  const block = (key: string): string => {
    const start = settings.indexOf(`key: '${key}'`);
    const end = settings.indexOf('\n  },', start);
    assert.ok(start >= 0 && end > start, `${key} setting remains catalogued`);
    return settings.slice(start, end);
  };
  const sharing = block('enableShareCard');
  const legacyHeatmap = block('showHeatmap');

  assert.match(sharing, /default: true/);
  assert.doesNotMatch(sharing, /visible: false/);
  assert.match(legacyHeatmap, /visible: false/);

  const webview = source('webview.ts');
  assert.match(
    webview,
    /message\.key === 'enableShareCard'[\s\S]*?this\.sharingWorkspaceRequested = false/,
    'turning off the one visible switch must dismiss a command-opened workspace',
  );
});

test('the old Claude panels no longer render beside the unified workspace', () => {
  const webview = source('webview.ts');
  const start = webview.indexOf('private renderAllTimeData');
  const end = webview.indexOf('private weeklyValuePoints', start);
  assert.ok(start >= 0 && end > start, 'All-time renderer must remain discoverable');
  const allTime = webview.slice(start, end);

  assert.doesNotMatch(allTime, /setting<boolean>\('showHeatmap'/);
  assert.doesNotMatch(allTime, /renderShareCardPanel\(\) \+ heatmapPanel/);
  assert.match(allTime, /renderSharingWorkspace/);
});

test('Share Card preview and local export have no GitHub identity or network path', () => {
  const webview = source('webview.ts');
  const start = webview.indexOf("case 'buildShareCard'");
  const end = webview.indexOf("case 'setDashboardAutoRefresh'", start);
  assert.ok(start >= 0 && end > start, 'Share Card request handlers must remain discoverable');
  const localArtifactHandlers = webview.slice(start, end);

  assert.doesNotMatch(
    localArtifactHandlers,
    /getGithubIdentity|authentication|getSession|httpsGet|api\.github\.com|message\.(?:avatar|username)/i,
  );
  assert.doesNotMatch(webview, /import \* as https from ['"]https['"]/);
  assert.doesNotMatch(webview, /private async getGithubIdentity|private httpsGet/);
});

test('the in-workspace sharing reset routes through the existing host request and client ACK protocol', () => {
  const webview = source('webview.ts');
  const start = webview.indexOf('function resetCombinedHeatmapPreferences');
  const end = webview.indexOf('\nfunction refresh()', start);
  assert.ok(start >= 0 && end > start, 'direct sharing reset must remain discoverable');
  const reset = webview.slice(start, end);

  assert.match(reset, /runLocalDataAction\(['"]reset-sharing-preferences['"]\)/);
  assert.doesNotMatch(reset, /ccuResetLocalStorageKeys|ccuResetSessionStorageKeys/);
  assert.doesNotMatch(reset, /command:\s*['"]resetCombinedHeatmapPreferences['"]/);
  assert.doesNotMatch(webview, /case ['"]resetCombinedHeatmapPreferences['"]/);
});

test('Share Card drafts keep raw project paths and session IDs memory-only', () => {
  const webview = source('webview.ts');
  const start = webview.indexOf('var __ccuShareCardDraft');
  const end = webview.indexOf('\nfunction scApplyDefaultControls', start);
  assert.ok(start >= 0 && end > start, 'Share Card draft policy must remain discoverable');
  const draft = webview.slice(start, end);

  assert.match(draft, /var __ccuShareCardDraft = null/);
  assert.match(draft, /scope: 'all'/);
  assert.match(draft, /JSON\.stringify\(scPersistentDraftConfig\(cfg\)\)/);
  assert.match(draft, /__ccuShareCardDraft = scReadConfig\(\)/);
  assert.doesNotMatch(
    draft,
    /localStorage\.setItem\([^\n]*JSON\.stringify\(scReadConfig\(\)\)/,
  );
});
