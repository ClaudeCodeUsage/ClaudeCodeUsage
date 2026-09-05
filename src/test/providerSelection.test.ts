import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module = require('node:module');
import * as path from 'node:path';

import { defaultDashboardProvider } from '../codexView';
import { CODEX_COPY_EN } from '../codexView';
import { I18n } from '../i18n';
import { buildScopedCodexInsights } from '../providers/codex/codexInsights';
import { buildCodexUsageView } from '../providers/codex/codexUsage';
import { ContentAnalysis, ProjectGroup, SessionUsage, SupportedLanguage, UsageData } from '../types';
import { CODEX_WEBVIEW_NOW, codexWebviewFixture } from './codexWebviewFixtures';

function webviewSourceFixture(): string {
  return readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'webview.ts'),
    'utf8',
  );
}

function renderedClasses(html: string): Set<string> {
  const classes = new Set<string>();
  for (const match of html.matchAll(/\bclass=(['"])(.*?)\1/g)) {
    for (const className of match[2].split(/\s+/).filter(Boolean)) {
      classes.add(className);
    }
  }
  return classes;
}

function claudeUsageFixture(): UsageData {
  return {
    totalInputTokens: 1_200,
    totalOutputTokens: 300,
    totalCacheCreationTokens: 200,
    totalCacheReadTokens: 800,
    totalCost: 1.25,
    costBreakdown: { input: 0.3, output: 0.4, cacheWrite: 0.25, cacheRead: 0.3 },
    messageCount: 4,
    modelBreakdown: {
      'claude-sonnet-4-5': {
        inputTokens: 1_200,
        outputTokens: 300,
        cacheCreationTokens: 200,
        cacheReadTokens: 800,
        cost: 1.25,
        count: 4,
      },
    },
  };
}

test('Codex dashboard HTML uses only classes already rendered by the Claude dashboard', () => {
  const originalLoad = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') {
      return { workspace: { workspaceFolders: [] } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { UsageWebviewProvider } = require('../webview') as typeof import('../webview');
    const provider = new UsageWebviewProvider({} as any) as any;
    const usage = claudeUsageFixture();
    const now = new Date(CODEX_WEBVIEW_NOW);
    const session: SessionUsage = {
      sessionId: '11111111-1111-4111-8111-111111111111',
      title: 'Claude dashboard fixture',
      projectName: 'ClaudeCodeUsage',
      projectPath: '/fixture/ClaudeCodeUsage',
      startTime: new Date(now.getTime() - 600_000),
      endTime: now,
      data: usage,
      peakContextTokens: 2_200,
    };
    const project: ProjectGroup = {
      groupName: 'ClaudeCodeUsage',
      groupPath: '/fixture/ClaudeCodeUsage',
      isGitRepo: true,
      projectCount: 1,
      sessionCount: 1,
      firstSeen: session.startTime,
      lastSeen: session.endTime,
      data: usage,
      children: [{
        projectName: session.projectName,
        projectPath: session.projectPath,
        sessionCount: 1,
        firstSeen: session.startTime,
        lastSeen: session.endTime,
        data: usage,
      }],
    };
    const content: ContentAnalysis = {
      categories: [{ key: 'assistantText', estimatedTokens: 300, charCount: 1_200, count: 1 }],
      toolResultBreakdown: [],
      totalEstimatedTokens: 300,
      recentPrompts: [],
      thinkingBySession: {},
      thinkingByDay: {},
      skillUses: [],
    };
    provider.todayData = usage;
    provider.monthData = usage;
    provider.allTimeData = usage;
    provider.hourlyDataForToday = [{ hour: '12:00', data: usage }];
    provider.dailyDataForMonth = [{ date: '2026-07-20', data: usage }];
    provider.dailyDataForAllTime = [{ date: '2026-07', data: usage }];
    provider.sessionBreakdown = [session];
    provider.projectBreakdown = [project];
    provider.contentAnalysis = content;
    provider.providerAvailability = { claude: true, codex: true };
    const codexSnapshot = codexWebviewFixture();
    codexSnapshot.qualityFlags = { 'missing-parent': 1 };
    const codexView = buildCodexUsageView(codexSnapshot, CODEX_WEBVIEW_NOW);
    provider.codexView = codexView;
    provider.codexInsights = buildScopedCodexInsights(codexView);

    provider.currentProvider = 'claude';
    const claudeClasses = renderedClasses(provider.getMainContent());
    provider.currentProvider = 'codex';
    const codexHtml = provider.getMainContent();
    const codexClasses = renderedClasses(codexHtml);
    const codexOnly = [...codexClasses].filter((className) => !claudeClasses.has(className)).sort();

    assert.deepEqual(codexOnly, []);
    const equivalentCostIndex = codexHtml.indexOf('API-equivalent cost');
    const processedIndex = codexHtml.indexOf('Processed');
    assert.ok(equivalentCostIndex >= 0, 'Codex summary shows API-equivalent cost');
    assert.ok(equivalentCostIndex < processedIndex, 'API-equivalent cost is the first summary card');
    assert.match(codexHtml, /\$[\d,.]+/);
    assert.match(codexHtml, /not a bill or subscription charge/);
    assert.match(
      codexHtml,
      /Parent session log missing; conservative usage retained[^<]*1/,
    );
    assert.match(
      codexHtml,
      /Usage index is still being built; current totals are incomplete and indexing will continue automatically[^<]*24\/30/,
    );

    codexSnapshot.coverage.indexedFiles = codexSnapshot.coverage.totalFiles;
    codexSnapshot.coverage.indexedBytes = codexSnapshot.coverage.totalBytes;
    codexSnapshot.coverage.complete = true;
    for (const range of [
      codexSnapshot.coverage.period.last7Days,
      codexSnapshot.coverage.period.last30Days,
      codexSnapshot.coverage.period.allTime,
    ]) {
      range.migratedFiles = range.totalFiles;
      range.migratedBytes = range.totalBytes;
      range.complete = true;
    }
    provider.codexView = buildCodexUsageView(codexSnapshot, CODEX_WEBVIEW_NOW);
    provider.codexInsights = buildScopedCodexInsights(provider.codexView);
    assert.doesNotMatch(
      provider.getMainContent(),
      /Usage index is still being built/,
    );

    codexSnapshot.coverage.identity.ambiguousSessionGroups = 2;
    codexSnapshot.coverage.identity.complete = false;
    provider.codexView = buildCodexUsageView(codexSnapshot, CODEX_WEBVIEW_NOW);
    provider.codexInsights = buildScopedCodexInsights(provider.codexView);
    const ambiguousIdentityHtml = provider.getMainContent();
    assert.doesNotMatch(ambiguousIdentityHtml, /Usage index is still being built/);
    assert.match(
      ambiguousIdentityHtml,
      /Duplicate session identity is ambiguous; both local copies are retained[^<]*2/,
    );
  } finally {
    (Module as any)._load = originalLoad;
  }
});

test('dashboard provider defaults preserve Claude and support Codex-only installs', () => {
  assert.equal(defaultDashboardProvider(true, false), 'claude');
  assert.equal(defaultDashboardProvider(false, true), 'codex');
  assert.equal(defaultDashboardProvider(true, true), 'claude');
  assert.equal(defaultDashboardProvider(false, false), 'claude');
});

test('Codex tab stays visible while its first index is still running', () => {
  const originalLoad = (Module as any)._load;
  const originalLanguage = I18n.getCurrentLanguage();
  I18n.setLanguage('en');
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') {
      return { workspace: { workspaceFolders: [] } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { UsageWebviewProvider } = require('../webview') as typeof import('../webview');
    const provider = new UsageWebviewProvider({} as any) as any;
    provider.todayData = claudeUsageFixture();
    provider.updateProviderData(
      null,
      {} as any,
      {
        claude: true,
        codex: true,
        codexData: false,
        codexLoading: true,
        codexProgress: {
          scannedFiles: 1_566,
          totalFiles: 1_827,
          indexedBytes: 1_024,
          totalBytes: 4_096,
        },
      },
    );
    provider.currentProvider = 'codex';

    const html = provider.getMainContent();
    assert.match(html, /id="provider-tab-codex"/);
    assert.doesNotMatch(html, /id="provider-tab-compare"/);
    assert.match(html, /Indexing is still in progress/);
    assert.match(html, /Indexed log entries[^<]*1,566\/1,827 \(86%\)/);
    assert.doesNotMatch(html, /1\.6K\/1\.8K/);
    assert.match(html, /Indexed storage[^<]*1kB\/4kB/i);
  } finally {
    I18n.setLanguage(originalLanguage);
    (Module as any)._load = originalLoad;
  }
});

test('webview provider changes are allowlisted and kept outside time tabs', () => {
  const source = readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'webview.ts'),
    'utf8',
  );

  assert.match(source, /case 'providerChanged'/);
  assert.match(source, /requested === 'claude'/);
  assert.match(source, /requested === 'codex'/);
  assert.match(source, /requested === 'compare'/);
  assert.match(source, /updateProviderData\(/);
  assert.match(source, /renderProviderTabs\(\)[\s\S]*renderQuotaBanner\(provider\)/);
});

test('Codex settings and charts use the shared dashboard renderers', () => {
  const webview = webviewSourceFixture();
  const settings = readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'settings.ts'),
    'utf8',
  );
  const extension = readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'extension.ts'),
    'utf8',
  );

  assert.match(settings, /key:\s*'codex\.optimization\.enabled'[\s\S]*?default:\s*true/);
  assert.match(webview, /this\.renderSettingsPanel\(provider\)/);
  assert.match(webview, /private renderTodayData\(provider: SettingProvider/);
  assert.match(webview, /private renderSessionData\(provider: SettingProvider/);
  assert.match(webview, /private renderProjectData\(provider: SettingProvider/);
  assert.match(webview, /private renderCompositionChart\([\s\S]*provider: SettingProvider/);
  assert.match(
    webview,
    /snap\.filter\(\(setting\)\s*=>\s*settingAppliesToProvider\(setting, provider\)\)/,
  );
  assert.match(
    settings,
    /export function settingAppliesToProvider[\s\S]*?def\.providers\?\.includes\(provider\)/,
  );
  assert.match(webview, /createCodexLocalizedFormatters\(I18n\.getLocale\(\), I18n\.getTimezone\(\)\)/);
  assert.match(webview, /getProviderNavClientScript\(\)/);
  assert.doesNotMatch(webview, /getCodexClientScript|getCodexViewStyles|renderCodexView/);
  assert.doesNotMatch(webview, /ccu\.codex/);
  assert.match(extension, /codexOptimizationEnabled:/);
  assert.match(extension, /private codexInsights: CodexScopedInsights/);
  assert.match(extension, /buildScopedCodexInsights\(this\.codexView\)/);
  assert.match(extension, /catch \{\s+this\.codexView = null;\s+this\.codexInsights = emptyCodexScopedInsights\(\);\s+this\.codexHasData = false;/);
  assert.match(webview, /private codexInsights: CodexScopedInsights/);
  assert.match(webview, /this\.codexInsights = codexView \? insights : emptyCodexScopedInsights\(\);/);
});

test('shared chart delegation uses the existing Claude metric controls for both providers', () => {
  const source = webviewSourceFixture();
  assert.match(source, /closest\('\.chart-tab\[data-metric\]'\)/);
  assert.match(source, /data-metric="inputTokens">' \+ this\.escapeHtml\(copy\.processed\)/);
  assert.doesNotMatch(source, /data-codex-chart-metric|data-codex-root/);
  assert.doesNotMatch(source, /document\.querySelectorAll\('\.daily-breakdown'\)/);
});

test('provider-aware document shell renders Claude and Codex through one dashboard body', () => {
  const source = webviewSourceFixture();

  assert.match(source, /if \(this\.currentProvider === 'compare'\)/);
  assert.match(source, /const provider: SettingProvider = this\.currentProvider/);
  assert.match(source, /const title = provider === 'codex' \? codexCopy\.title : I18n\.t\.popup\.title/);
  assert.doesNotMatch(source, /codex-document|codex-page|codex-view/);

  assert.match(source, /<nav class="provider-tabs" role="tablist" aria-label="\$\{this\.escapeHtml\(I18n\.t\.popup\.settingsGroupProviders\)\}">/);
  assert.match(source, /id="provider-tab-\$\{provider\}"[^\n]+role="tab"[^\n]+data-provider-target="\$\{provider\}"[^\n]+aria-controls="provider-panel"[^\n]+aria-selected="\$\{selected\}"[^\n]+tabindex="\$\{selected \? '0' : '-1'\}"/);
  assert.match(source, /id="provider-panel" role="tabpanel" aria-labelledby="provider-tab-\$\{this\.currentProvider\}"/);
  assert.match(source, /this\.renderProviderTabs\(\)[\s\S]*id="provider-panel"/);
  assert.doesNotMatch(source, /class="provider-tab[^\n]+onclick="showProvider/);
});

test('Claude dashboard shell markers and provider switching behavior remain intact', () => {
  const source = webviewSourceFixture();

  assert.match(source, /id="refreshNowBtn" class="btn-secondary btn-refresh-now"/);
  assert.match(source, /onclick="showTab\('content'\)" class="btn-secondary">✨/);
  assert.match(source, /onclick="showTab\('settings'\)" class="btn-secondary">⚙/);
  assert.match(source, /function showProvider\(provider, tab\) \{\s*vscode\.postMessage\(\{ command: 'providerChanged', provider: provider, tab: tab \|\| '' \}\);\s*\}/);
  assert.match(source, /renderProviderTabs\(\)[\s\S]*renderQuotaBanner\(provider\)/);
});

test('provider and Codex view copy is complete in every UI locale', () => {
  const languages: SupportedLanguage[] = [
    'en',
    'de-DE',
    'zh-TW',
    'zh-CN',
    'ja',
    'ko',
    'pt-BR',
    'id',
  ];
  const previous = I18n.getCurrentLanguage();
  const tokenTerms: Record<SupportedLanguage, readonly string[]> = {
    en: ['Uncached input', 'Uncached usage', 'Processed', 'Input', 'Cached input', 'Output', 'Reasoning'],
    'zh-CN': ['未缓存输入', '未缓存用量', '已处理', '输入', '缓存输入', '输出', '推理'],
    'zh-TW': ['未快取輸入', '未快取用量', '已處理', '輸入', '快取輸入', '輸出', '推理'],
    ja: ['非キャッシュ入力', '非キャッシュ使用量', '処理済み', '入力', 'キャッシュ入力', '出力', '推論'],
    ko: ['캐시되지 않은 입력', '캐시되지 않은 사용량', '처리됨', '입력', '캐시 입력', '출력', '추론'],
    'pt-BR': ['Entrada sem cache', 'Uso sem cache', 'Processado', 'Entrada', 'Entrada em cache', 'Saída', 'Raciocínio'],
    'de-DE': ['Eingabe ohne Cache', 'Nutzung ohne Cache', 'Verarbeitet', 'Eingabe', 'Gecachte Eingabe', 'Ausgabe', 'Reasoning'],
    id: ['Input tanpa cache', 'Penggunaan tanpa cache', 'Diproses', 'Input', 'Input cache', 'Output', 'Penalaran'],
  };
  const equivalentCostLabels: Record<SupportedLanguage, string> = {
    en: 'API-equivalent cost',
    'de-DE': 'API-äquivalente Kosten',
    'zh-TW': 'API 等效成本',
    'zh-CN': 'API 等效成本',
    ja: 'API 等価コスト',
    ko: 'API 등가 비용',
    'pt-BR': 'Custo equivalente de API',
    id: 'Biaya ekuivalen API',
  };
  try {
    for (const language of languages) {
      I18n.setLanguage(language);
      const providers = I18n.t.providers;
      assert.ok(providers.claude);
      assert.ok(providers.codexBeta);
      assert.ok(providers.compare);
      for (const value of Object.values(providers.codex)) {
        if (typeof value === 'string') {
          assert.notEqual(value.trim(), '', `${language} has empty Codex copy`);
        } else {
          assert.ok([5, 15, 16, 17, 18].includes(Object.keys(value).length));
        }
      }
      assert.deepEqual(
        [
          providers.codex.freshInput,
          providers.codex.fresh,
          providers.codex.processed,
          providers.codex.input,
          providers.codex.cachedInput,
          providers.codex.output,
          providers.codex.reasoning,
        ],
        tokenTerms[language],
      );
      assert.equal(providers.codex.apiEquivalentCost, equivalentCostLabels[language]);
      if (language !== 'en') {
        for (const key of [
          'allTime',
          'behavior',
          'settings',
          'monthly',
          'tokenComposition',
          'freshInput',
          'reasoningSubset',
          'threadRoleComposition',
          'childThreadsPerRootTask',
          'childFreshShare',
          'approvalFreshShare',
          'highEffortFreshShare',
          'processedToFreshRatio',
          'reasoningOutputShare',
          'postPatchToolCallsPerPatchCall',
          'patchCalls',
          'compactions',
          'unnamedSession',
          'unidentifiedProject',
          'parentThread',
          'searchThreads',
          'all',
          'localDirectory',
          'lastActive',
          'expand',
          'usageLimits',
          'resets',
          'credits',
          'unlimited',
          'accountSnapshotLastObserved',
          'sessions',
          'modelsEffort',
          'clearFilters',
          'activeFilters',
        ] as const) {
          assert.notEqual(
            providers.codex[key],
            CODEX_COPY_EN[key],
            `${language} still falls back to English for ${key}`,
          );
        }
        const setting = I18n.settingText('codex.optimization.enabled');
        assert.ok(setting.label?.trim(), `${language} has no optimization setting label`);
        assert.ok(setting.help?.trim(), `${language} has no optimization setting help`);
      }
    }

    const englishVisibleCopy = Object.values(CODEX_COPY_EN)
      .flatMap((value) => typeof value === 'string' ? [value] : Object.values(value))
      .join('\n');
    assert.doesNotMatch(englishVisibleCopy, /\b(?:fresh|new)\b/i);
    const settingsSource = readFileSync(path.resolve(__dirname, '..', '..', 'src', 'settings.ts'), 'utf8');
    assert.match(settingsSource, /key: 'codex\.statusMetric'[\s\S]*?enumValues: \['fresh', 'processed', 'output'\][\s\S]*?enumLabels: \['Uncached', 'Processed', 'Output'\]/);
    assert.match(settingsSource, /help: 'Uncached usage, processed tokens, or output tokens\.'/);
  } finally {
    I18n.setLanguage(previous);
  }
});
