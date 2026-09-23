import * as vscode from 'vscode';
import { ClaudeDataLoader } from './dataLoader';
import { I18n } from './i18n';
import { getModelRatesPerMillion } from './pricing';
import {
  SETTINGS,
  SettingsStore,
  SettingProvider,
  SettingView,
  settingAppliesToProvider,
} from './settings';
import { buildResumeCommand, isUsableCwd, isValidSessionId, isUnderDir } from './sessionResume';
import { renderHeatmapSvg } from './heatmapSvg';
import {
  CombinedHeatmapRange,
  claudeDailyPointsFromUsage,
  codexDailyPointsFromUsage,
  combinedHeatmapFilename,
  combinedHeatmapMarkdown,
  mergeCombinedDailyUsage,
  normalizeCombinedHeatmapRange,
  sanitizeCombinedHeatmapTitle,
  selectCombinedHeatmapWindow,
} from './combinedHeatmap';
import {
  normalizeCombinedHeatmapAccent,
  normalizeCombinedHeatmapIntensityMode,
  normalizeCombinedHeatmapPalette,
  renderCombinedHeatmapSvg,
} from './combinedHeatmapSvg';
import { DEFAULT_SECTIONS, ShareSections, buildShareCardData, shareCardFilename } from './shareCard';
import { renderShareCardSvg, ShareCardTheme } from './shareCardSvg';
import {
  SharingCommandIntentLedger,
  SharingTemplate,
} from './sharingCommandIntent';
import { parseConversation } from './conversationLog';
import { renderConversationViewer } from './conversationViewerHtml';
import { formatUsageDate, shortUsageDate } from './usageDateLabels';
import { normalizeQuotaWindows } from './quotaWindows';
import {
  CUSTOM_QUOTA_STATUS_TEMPLATE,
  FIVE_HOUR_QUOTA_STATUS_TEMPLATE,
  WEEKLY_QUOTA_STATUS_TEMPLATE,
} from './quotaFormat';
import {
  buildWeeklyValueTimeline,
  claudeWeeklyEquivalentUsage,
  EquivalentCostBreakdown,
  equivalentUsageFromProviderTokens,
  summarizeEquivalentUsage,
  WeeklyQuotaObservation,
  WeeklyValuePoint,
} from './weeklyValue';
import {
  defaultDashboardProvider,
} from './codexView';
import {
  CodexScopedInsights,
  emptyCodexScopedInsights,
} from './providers/codex/codexInsights';
import {
  CodexDailyUsageView,
  CodexMetricTotals,
  CodexHourlyUsageView,
  CodexProjectUsageView,
  CodexThreadUsageView,
  CodexUsageScopeView,
  CodexUsageView,
  tokenComposition,
} from './providers/codex/codexUsage';
import { createCodexLocalizedFormatters } from './codexFormat';
import { getProviderNavClientScript } from './providerNavClient';
import { getDashboardRefreshClientScript } from './dashboardRefreshClient';
import { getChartAccessibilityClientScript } from './chartAccessibilityClient';
import {
  ProjectUsageMatrixSnapshot,
  projectHeatmap,
  projectTrend,
} from './projectUsageMatrix';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import {
  AdviceEffectivenessProvider,
  AdviceEffectivenessProviderState,
  AdviceEffectivenessProviderStates,
  PreparedAdviceSnapshot,
  prepareAdviceSnapshot,
} from './adviceEffectiveness/integration';
import type { PreparedAiInvocation } from './adviceEffectiveness/preparedRequest';
import { previewAiInvocation } from './adviceEffectiveness/preparedRequest';
import type {
  StructuredAdviceRequestResult,
} from './adviceEffectiveness/remoteAdvice';
import type { StructuredAdviceReferences } from './adviceEffectiveness/structuredOutput';
import { AdviceRecommendation, createAdviceContract } from './adviceEffectiveness/contract';
import type { PreparedOptimizerResult } from './optimizerRequest';
import type { BackgroundWorkReason } from './backgroundWorkState';
import {
  AdviceLocalState,
  AdviceLocalStateStorage,
  StoredComparablePair,
  appendAdviceComparisonResult,
  appendStoredComparablePair,
  createClearedAdviceLocalState,
  createClosedAdviceLocalState,
  loadAndMigrateAdviceLocalState,
  adviceRecommendationSnoozedUntil,
  ADVICE_SNOOZE_DURATION_MS,
  ADVICE_LOCAL_STATE_KEY,
  resumeAdviceRecommendation,
  saveAdviceLocalState,
  snoozeAdviceRecommendation,
  upsertAdviceLocalFeedback,
} from './adviceEffectiveness/versionedPersistence';
import {
  CODEX_COMPARISON_MEASUREMENT_PROFILE_VERSION,
  CODEX_LOCAL_RECOMMENDATION_VERSION,
  CodexComparableTaskProjection,
  buildAppliedComparablePairs,
  isComparableCodexRecommendationId,
} from './adviceEffectiveness/comparisonProduction';
import { buildAdviceComparisonResultEnvelope } from './adviceEffectiveness/comparisonResult';
import {
  AttributionScope,
  BranchUsage,
  CostlyMessage,
  ClaudeApiUsageResponse,
  ContentAnalysis,
  ProjectGroup,
  ProjectUsage,
  SessionData,
  SessionUsage,
  UsageAttribution,
  UsageData,
  WorkflowUsage,
} from './types';
import {
  dayKeyInZone,
  formatHourLabel,
  resolveTimeZone,
  rollingDayKeys,
  rollingDayKeysFromDayKey,
} from './dateKeys';
import { clockHourKeys, completeDisplayRange } from './displayRange';
import {
  LocalDataAction,
  LocalDataActionResult,
  LocalDataClientAction,
  LocalDataClientSummary,
  LocalDataInventory,
  approximateJsonBytes,
  finiteTimestampRange,
  isLocalDataAction,
} from './localDataControls';

interface CodexRenderProgress {
  scannedFiles: number;
  totalFiles: number;
  indexedBytes: number;
  totalBytes: number;
  reason?: BackgroundWorkReason;
}

const OPTIMIZER_FEEDBACK_RECOMMENDATION_ID = 'recommendation-optimizer-result-v1';
const LIVE_PATCH_PANEL_START = '<!-- ccu-live-panel:start -->';
const LIVE_PATCH_PANEL_END = '<!-- ccu-live-panel:end -->';
const LIVE_PATCH_HOURS_START = '/* ccu-live-hours:start */';
const LIVE_PATCH_HOURS_END = '/* ccu-live-hours:end */';

function emptyDisplayUsageData(): UsageData {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCost: 0,
    costBreakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    messageCount: 0,
    modelBreakdown: {},
  };
}

function emptyCodexHourlyDisplayRow(hour: string): CodexHourlyUsageView {
  const total: CodexMetricTotals = {
    processed: 0,
    fresh: 0,
    input: 0,
    cachedInput: 0,
    output: 0,
    reasoning: 0,
  };
  return {
    hour,
    label: formatHourLabel(hour),
    total,
    apiEquivalent: {
      equivalentUsd: 0,
      freshInputUsd: 0,
      cachedInputUsd: 0,
      outputUsd: 0,
      pricedTokens: 0,
      totalTokens: 0,
      pricingCoverage: 0,
    },
    threads: 0,
  };
}

function claudeHourlyDisplayDto(
  rowsByDay: Record<string, { hour: string; data: UsageData }[]>,
): Record<string, Array<{ hour: string; data: Omit<UsageData, 'modelBreakdown'> }>> {
  const projected: Record<
    string,
    Array<{ hour: string; data: Omit<UsageData, 'modelBreakdown'> }>
  > = {};
  for (const [day, rows] of Object.entries(rowsByDay)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    projected[day] = rows.flatMap(({ hour, data }) => {
      if (!/^(?:[01]\d|2[0-3]):00$/.test(hour)) return [];
      return [{
        hour,
        data: {
          totalInputTokens: data.totalInputTokens,
          totalOutputTokens: data.totalOutputTokens,
          totalCacheCreationTokens: data.totalCacheCreationTokens,
          totalCacheReadTokens: data.totalCacheReadTokens,
          totalCost: data.totalCost,
          costBreakdown: { ...data.costBreakdown },
          messageCount: data.messageCount,
        },
      }];
    });
  }
  return projected;
}

function inlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

interface DashboardLivePatch {
  provider: 'claude' | 'codex';
  tab: string;
  panelHtml: string;
  structureKey: string;
  claudeLast30HoursByDay: ReturnType<typeof claudeHourlyDisplayDto>;
  adviceSnapshotIds: Partial<Record<AdviceEffectivenessProvider, string>>;
}

interface PendingDashboardLivePatch extends DashboardLivePatch {
  documentHtml: string;
  revision: number;
}

function markedContent(source: string, startMarker: string, endMarker: string): string | undefined {
  const start = source.indexOf(startMarker);
  if (start < 0) return undefined;
  const contentStart = start + startMarker.length;
  const end = source.indexOf(endMarker, contentStart);
  return end < 0 ? undefined : source.slice(contentStart, end);
}

function replaceMarkedContent(
  source: string,
  startMarker: string,
  endMarker: string,
  replacement: string,
): string | undefined {
  const start = source.indexOf(startMarker);
  if (start < 0) return undefined;
  const contentStart = start + startMarker.length;
  const end = source.indexOf(endMarker, contentStart);
  if (end < 0) return undefined;
  return source.slice(0, contentStart) + replacement + source.slice(end);
}

interface LocalDataUiCopy {
  title: string;
  intro: string;
  inventory: string;
  refresh: string;
  category: string;
  location: string;
  schema: string;
  sizeCount: string;
  dateRange: string;
  network: string;
  clearability: string;
  actions: string;
  rebuildIndex: string;
  quotaScope: string;
  clearQuota: string;
  clearAdvice: string;
  resetUi: string;
  resetSharing: string;
  clearByok: string;
  clearAll: string;
  loading: string;
  unavailable: string;
  bytes: string;
  items: string;
  sourceExclusions: string;
}

function localDataUiCopy(locale: string): LocalDataUiCopy {
  if (locale === 'zh-CN') {
    return {
      title: '本地数据与隐私控制',
      intro: '清单只显示类别、非敏感位置类型和汇总元数据；不会显示路径、账号指纹、设置值或日志内容。',
      inventory: '本地数据清单',
      refresh: '刷新清单',
      category: '类别',
      location: '位置类型',
      schema: 'Schema',
      sizeCount: '约占用 / 数量',
      dateRange: '最早 / 最新',
      network: '可能的网络交互',
      clearability: '清除方式',
      actions: '安全清除与重建',
      rebuildIndex: '重建 Codex 索引…',
      quotaScope: '额度历史范围',
      clearQuota: '清除所选额度历史…',
      clearAdvice: '清除建议数据…',
      resetUi: '重置界面状态…',
      resetSharing: '重置分享偏好…',
      clearByok: '清除 BYOK 密钥…',
      clearAll: '清除全部插件派生数据…',
      loading: '正在读取不含敏感值的本地清单…',
      unavailable: '暂时无法读取本地数据清单。',
      bytes: '字节',
      items: '项',
      sourceExclusions: '始终排除：',
    };
  }
  return {
    title: 'Local data and privacy controls',
    intro: 'The inventory exposes categories, non-sensitive location classes, and aggregate metadata only—never paths, account fingerprints, setting values, or log content.',
    inventory: 'Local data inventory',
    refresh: 'Refresh inventory',
    category: 'Category',
    location: 'Location class',
    schema: 'Schema',
    sizeCount: 'Approx. size / count',
    dateRange: 'Oldest / newest',
    network: 'Possible network interaction',
    clearability: 'Clearing route',
    actions: 'Safe clearing and rebuild',
    rebuildIndex: 'Rebuild Codex index…',
    quotaScope: 'Quota-history scope',
    clearQuota: 'Clear selected quota history…',
    clearAdvice: 'Clear advice data…',
    resetUi: 'Reset UI state…',
    resetSharing: 'Reset sharing preferences…',
    clearByok: 'Clear BYOK secret…',
    clearAll: 'Clear all extension-derived data…',
    loading: 'Reading a value-free local inventory…',
    unavailable: 'The local data inventory is temporarily unavailable.',
    bytes: 'bytes',
    items: 'items',
    sourceExclusions: 'Always excluded:',
  };
}

export type { SharingTemplate } from './sharingCommandIntent';

interface CombinedHeatmapUiCopy {
  eyebrow: string;
  panelTitle: string;
  description: string;
  previewLabel: string;
  privateBadge: string;
  settingsLabel: string;
  defaultTitle: string;
  titleLabel: string;
  rangeLabel: string;
  last30: string;
  last90: string;
  year: string;
  intensityLabel: string;
  intensityQuantile: string;
  intensityLogarithmic: string;
  intensityLinear: string;
  paletteLabel: string;
  academicViolet: string;
  claudeOrange: string;
  codexBlue: string;
  githubGreen: string;
  customPalette: string;
  customAccent: string;
  privacyToggle: string;
  privacyIncludes: string;
  privacyExcludes: string;
  updatePreview: string;
  exportSvg: string;
  copyMarkdown: string;
  resetSharing: string;
  resetComplete: string;
  resetFailed: string;
  markdownLabel: string;
  noData: string;
  activityDisclaimer: string;
  combinedLabel: string;
  processedTokensLabel: string;
  svgFooterNote: string;
}

function combinedHeatmapIntensityUiCopy(locale: string): Pick<
  CombinedHeatmapUiCopy,
  'intensityLabel' | 'intensityQuantile' | 'intensityLogarithmic' | 'intensityLinear'
> {
  const copy: Record<string, [string, string, string, string]> = {
    en: ['Intensity scale', 'Quantile', 'Logarithmic', 'Linear'],
    'de-DE': ['Intensitätsskala', 'Quantil', 'Logarithmisch', 'Linear'],
    'zh-TW': ['色階映射', '分位數', '對數', '線性'],
    'zh-CN': ['色阶映射', '分位数', '对数', '线性'],
    ja: ['強度スケール', '分位数', '対数', '線形'],
    ko: ['강도 스케일', '분위수', '로그', '선형'],
    'pt-BR': ['Escala de intensidade', 'Quantil', 'Logarítmica', 'Linear'],
    id: ['Skala intensitas', 'Kuantil', 'Logaritmik', 'Linear'],
  };
  const [intensityLabel, intensityQuantile, intensityLogarithmic, intensityLinear] = copy[locale] ?? copy.en;
  return { intensityLabel, intensityQuantile, intensityLogarithmic, intensityLinear };
}

function combinedHeatmapUiCopy(locale: string): CombinedHeatmapUiCopy {
  const intensity = combinedHeatmapIntensityUiCopy(locale);
  if (locale === 'zh-CN') {
    return {
      ...intensity,
      eyebrow: '分享工作台',
      panelTitle: '综合活动热力图与分享卡',
      description: '按本地自然日合并 Claude 与 Codex 的已处理 Token 活动量；默认强度不是成本。',
      previewLabel: '实时预览',
      privateBadge: '仅含隐私安全的日汇总',
      settingsLabel: '卡片设置',
      defaultTitle: 'Claude + Codex 本地活动',
      titleLabel: '分享标题',
      rangeLabel: '时间范围',
      last30: '最近 30 天',
      last90: '最近 90 天',
      year: '最近一年',
      paletteLabel: '热力图配色',
      academicViolet: '学术紫',
      claudeOrange: 'Claude 橙',
      codexBlue: 'Codex 蓝',
      githubGreen: 'GitHub 绿',
      customPalette: '自定义',
      customAccent: '自定义主色',
      privacyToggle: '显示隐私预览',
      privacyIncludes: '导出包含：自定义标题、日期范围，以及 Claude、Codex 和综合的每日已处理 Token 汇总。',
      privacyExcludes: '明确排除：账号、项目、线程标题、本地路径和日志内容。',
      updatePreview: '更新预览',
      exportSvg: '导出 SVG…',
      copyMarkdown: '复制 Markdown',
      resetSharing: '重置分享偏好',
      resetComplete: '分享偏好已重置。',
      resetFailed: '无法完全重置分享偏好。',
      markdownLabel: 'README / Markdown 引用片段',
      noData: '所选时间范围内尚无本地活动。',
      activityDisclaimer: '综合 Token 仅表示本地活动量，不代表生产率、订阅账单或两个 provider 的能力等价。',
      combinedLabel: '综合',
      processedTokensLabel: '已处理 Token',
      svgFooterNote: '本地活动量 · 不代表生产率、账单或 provider 能力等价',
    };
  }
  if (locale === 'zh-TW') {
    return {
      ...intensity,
      eyebrow: '分享工作台',
      panelTitle: '綜合活動熱力圖與分享卡',
      description: '依本機自然日合併 Claude 與 Codex 的已處理 Token 活動量；預設強度不是成本。',
      previewLabel: '即時預覽',
      privateBadge: '僅含隱私安全的每日彙總',
      settingsLabel: '卡片設定',
      defaultTitle: 'Claude + Codex 本機活動',
      titleLabel: '分享標題',
      rangeLabel: '時間範圍',
      last30: '最近 30 天',
      last90: '最近 90 天',
      year: '最近一年',
      paletteLabel: '熱力圖配色',
      academicViolet: '學術紫',
      claudeOrange: 'Claude 橙',
      codexBlue: 'Codex 藍',
      githubGreen: 'GitHub 綠',
      customPalette: '自訂',
      customAccent: '自訂主色',
      privacyToggle: '顯示隱私預覽',
      privacyIncludes: '匯出包含：自訂標題、日期範圍，以及 Claude、Codex 和綜合的每日已處理 Token 彙總。',
      privacyExcludes: '明確排除：帳號、專案、執行緒標題、本機路徑和記錄內容。',
      updatePreview: '更新預覽',
      exportSvg: '匯出 SVG…',
      copyMarkdown: '複製 Markdown',
      resetSharing: '重設分享偏好',
      resetComplete: '分享偏好已重設。',
      resetFailed: '無法完全重設分享偏好。',
      markdownLabel: 'README / Markdown 引用片段',
      noData: '所選時間範圍內尚無本機活動。',
      activityDisclaimer: '綜合 Token 僅表示本機活動量，不代表生產力、訂閱帳單或兩個 provider 的能力等價。',
      combinedLabel: '綜合',
      processedTokensLabel: '已處理 Token',
      svgFooterNote: '本機活動量 · 不代表生產力、帳單或 provider 能力等價',
    };
  }
  if (locale === 'de-DE') {
    return {
      ...intensity,
      eyebrow: 'Freigabe-Arbeitsbereich',
      panelTitle: 'Kombinierte Aktivitäts-Heatmap und Freigabekarte',
      description: 'Fasst die verarbeitete Token-Aktivität von Claude und Codex nach lokalem Kalendertag zusammen. Die Kosten sind nicht die Standardintensität.',
      previewLabel: 'Live-Vorschau',
      privateBadge: 'Nur datenschutzsichere Tagesaggregate',
      settingsLabel: 'Karteneinstellungen',
      defaultTitle: 'Claude + Codex lokale Aktivität',
      titleLabel: 'Freigabetitel',
      rangeLabel: 'Zeitraum',
      last30: 'Letzte 30 Tage',
      last90: 'Letzte 90 Tage',
      year: 'Letztes Jahr',
      paletteLabel: 'Heatmap-Farben',
      academicViolet: 'Akademisches Violett',
      claudeOrange: 'Claude Orange',
      codexBlue: 'Codex Blau',
      githubGreen: 'GitHub Grün',
      customPalette: 'Benutzerdefiniert',
      customAccent: 'Benutzerdefinierter Akzent',
      privacyToggle: 'Datenschutzvorschau anzeigen',
      privacyIncludes: 'Export enthält: den benutzerdefinierten Titel, den Zeitraum sowie die täglichen Claude-, Codex- und kombinierten Gesamtsummen der verarbeiteten Token.',
      privacyExcludes: 'Ausdrücklich ausgeschlossen: Konten, Projekte, Thread-Titel, lokale Pfade und Protokollinhalte.',
      updatePreview: 'Vorschau aktualisieren',
      exportSvg: 'SVG exportieren…',
      copyMarkdown: 'Markdown kopieren',
      resetSharing: 'Freigabeeinstellungen zurücksetzen',
      resetComplete: 'Freigabeeinstellungen wurden zurückgesetzt.',
      resetFailed: 'Die Freigabeeinstellungen konnten nicht vollständig zurückgesetzt werden.',
      markdownLabel: 'README-/Markdown-Ausschnitt',
      noData: 'Im ausgewählten Zeitraum sind noch keine lokalen Aktivitätsdaten verfügbar.',
      activityDisclaimer: 'Kombinierte Token beschreiben das lokale Aktivitätsvolumen, nicht Produktivität, Abonnementkosten oder die Gleichwertigkeit der Anbieterfähigkeiten.',
      combinedLabel: 'Kombiniert',
      processedTokensLabel: 'verarbeitete Token',
      svgFooterNote: 'Lokales Aktivitätsvolumen · nicht Produktivität, Abrechnung oder Anbieter-Gleichwertigkeit',
    };
  }
  if (locale === 'ja') {
    return {
      ...intensity,
      eyebrow: '共有ワークスペース',
      panelTitle: '統合アクティビティヒートマップと共有カード',
      description: 'Claude と Codex の処理済みトークン活動をローカルの暦日単位で統合します。既定の強度はコストではありません。',
      previewLabel: 'ライブプレビュー',
      privateBadge: 'プライバシーに配慮した日次集計のみ',
      settingsLabel: 'カード設定',
      defaultTitle: 'Claude + Codex のローカルアクティビティ',
      titleLabel: '共有タイトル',
      rangeLabel: '期間',
      last30: '過去30日間',
      last90: '過去90日間',
      year: '過去1年間',
      paletteLabel: 'ヒートマップの配色',
      academicViolet: 'アカデミックバイオレット',
      claudeOrange: 'Claude オレンジ',
      codexBlue: 'Codex ブルー',
      githubGreen: 'GitHub グリーン',
      customPalette: 'カスタム',
      customAccent: 'カスタムアクセントカラー',
      privacyToggle: 'プライバシープレビューを表示',
      privacyIncludes: 'エクスポートに含まれるもの: カスタムタイトル、期間、Claude・Codex・統合の日次処理済みトークン合計。',
      privacyExcludes: '明示的に除外されるもの: アカウント、プロジェクト、スレッドタイトル、ローカルパス、ログ内容。',
      updatePreview: 'プレビューを更新',
      exportSvg: 'SVG をエクスポート…',
      copyMarkdown: 'Markdown をコピー',
      resetSharing: '共有設定をリセット',
      resetComplete: '共有設定をリセットしました。',
      resetFailed: '共有設定を完全にリセットできませんでした。',
      markdownLabel: 'README / Markdown スニペット',
      noData: '選択した期間にはまだローカルアクティビティがありません。',
      activityDisclaimer: '統合トークンはローカルの活動量を示すものであり、生産性、サブスクリプション料金、プロバイダー間の能力の等価性を表すものではありません。',
      combinedLabel: '統合',
      processedTokensLabel: '処理済みトークン',
      svgFooterNote: 'ローカルの活動量 · 生産性、請求額、プロバイダー間の等価性を表すものではありません',
    };
  }
  if (locale === 'ko') {
    return {
      ...intensity,
      eyebrow: '공유 작업 공간',
      panelTitle: '통합 활동 히트맵과 공유 카드',
      description: 'Claude와 Codex의 처리된 토큰 활동을 로컬 달력 날짜 기준으로 통합합니다. 기본 강도는 비용이 아닙니다.',
      previewLabel: '실시간 미리보기',
      privateBadge: '개인정보를 보호하는 일별 집계만',
      settingsLabel: '카드 설정',
      defaultTitle: 'Claude + Codex 로컬 활동',
      titleLabel: '공유 제목',
      rangeLabel: '기간',
      last30: '최근 30일',
      last90: '최근 90일',
      year: '최근 1년',
      paletteLabel: '히트맵 색상',
      academicViolet: '아카데믹 바이올렛',
      claudeOrange: 'Claude 오렌지',
      codexBlue: 'Codex 블루',
      githubGreen: 'GitHub 그린',
      customPalette: '사용자 지정',
      customAccent: '사용자 지정 강조색',
      privacyToggle: '개인정보 미리보기 표시',
      privacyIncludes: '내보내기에 포함되는 항목: 사용자 지정 제목, 기간, Claude·Codex·통합 일별 처리된 토큰 합계.',
      privacyExcludes: '명시적으로 제외되는 항목: 계정, 프로젝트, 스레드 제목, 로컬 경로, 로그 내용.',
      updatePreview: '미리보기 업데이트',
      exportSvg: 'SVG 내보내기…',
      copyMarkdown: 'Markdown 복사',
      resetSharing: '공유 환경설정 재설정',
      resetComplete: '공유 환경설정이 재설정되었습니다.',
      resetFailed: '공유 환경설정을 완전히 재설정하지 못했습니다.',
      markdownLabel: 'README / Markdown 스니펫',
      noData: '선택한 기간에는 아직 로컬 활동 데이터가 없습니다.',
      activityDisclaimer: '통합 토큰은 로컬 활동량을 나타낼 뿐, 생산성이나 구독 결제액, 공급자 간 성능 등가성을 의미하지 않습니다.',
      combinedLabel: '통합',
      processedTokensLabel: '처리된 토큰',
      svgFooterNote: '로컬 활동량 · 생산성, 청구액, 공급자 등가성을 의미하지 않음',
    };
  }
  if (locale === 'pt-BR') {
    return {
      ...intensity,
      eyebrow: 'Espaço de compartilhamento',
      panelTitle: 'Mapa de calor de atividade combinado e cartão de compartilhamento',
      description: 'Combina a atividade de tokens processados do Claude e do Codex por dia do calendário local. O custo não é a intensidade padrão.',
      previewLabel: 'Prévia em tempo real',
      privateBadge: 'Somente agregados diários que preservam a privacidade',
      settingsLabel: 'Configurações do cartão',
      defaultTitle: 'Atividade local do Claude + Codex',
      titleLabel: 'Título do compartilhamento',
      rangeLabel: 'Intervalo de datas',
      last30: 'Últimos 30 dias',
      last90: 'Últimos 90 dias',
      year: 'Último ano',
      paletteLabel: 'Cores do mapa de calor',
      academicViolet: 'Violeta Acadêmico',
      claudeOrange: 'Claude Laranja',
      codexBlue: 'Codex Azul',
      githubGreen: 'GitHub Verde',
      customPalette: 'Personalizado',
      customAccent: 'Cor de destaque personalizada',
      privacyToggle: 'Mostrar prévia de privacidade',
      privacyIncludes: 'A exportação inclui: o título personalizado, o intervalo de datas e os totais diários agregados de tokens processados do Claude, do Codex e combinados.',
      privacyExcludes: 'Explicitamente excluído: contas, projetos, títulos de threads, caminhos locais e conteúdo de logs.',
      updatePreview: 'Atualizar prévia',
      exportSvg: 'Exportar SVG…',
      copyMarkdown: 'Copiar Markdown',
      resetSharing: 'Redefinir preferências de compartilhamento',
      resetComplete: 'Preferências de compartilhamento redefinidas.',
      resetFailed: 'Não foi possível redefinir totalmente as preferências de compartilhamento.',
      markdownLabel: 'Trecho de README / Markdown',
      noData: 'Ainda não há atividade local disponível no intervalo selecionado.',
      activityDisclaimer: 'Os tokens combinados descrevem o volume de atividade local, não produtividade, cobrança da assinatura ou equivalência de capacidade entre provedores.',
      combinedLabel: 'Combinado',
      processedTokensLabel: 'tokens processados',
      svgFooterNote: 'Volume de atividade local · não produtividade, cobrança ou equivalência entre provedores',
    };
  }
  if (locale === 'id') {
    return {
      ...intensity,
      eyebrow: 'Ruang kerja berbagi',
      panelTitle: 'Heatmap aktivitas gabungan dan kartu berbagi',
      description: 'Menggabungkan aktivitas token yang diproses oleh Claude dan Codex berdasarkan hari kalender lokal. Biaya bukan intensitas default.',
      previewLabel: 'Pratinjau langsung',
      privateBadge: 'Hanya agregat harian yang aman bagi privasi',
      settingsLabel: 'Pengaturan kartu',
      defaultTitle: 'Aktivitas lokal Claude + Codex',
      titleLabel: 'Judul berbagi',
      rangeLabel: 'Rentang tanggal',
      last30: '30 hari terakhir',
      last90: '90 hari terakhir',
      year: '1 tahun terakhir',
      paletteLabel: 'Warna heatmap',
      academicViolet: 'Violet Akademik',
      claudeOrange: 'Claude Oranye',
      codexBlue: 'Codex Biru',
      githubGreen: 'GitHub Hijau',
      customPalette: 'Kustom',
      customAccent: 'Aksen kustom',
      privacyToggle: 'Tampilkan pratinjau privasi',
      privacyIncludes: 'Ekspor mencakup: judul kustom, rentang tanggal, dan total harian token yang diproses (Claude, Codex, dan gabungan).',
      privacyExcludes: 'Secara eksplisit dikecualikan: akun, proyek, judul thread, jalur lokal, dan konten log.',
      updatePreview: 'Perbarui pratinjau',
      exportSvg: 'Ekspor SVG…',
      copyMarkdown: 'Salin Markdown',
      resetSharing: 'Atur ulang preferensi berbagi',
      resetComplete: 'Preferensi berbagi telah diatur ulang.',
      resetFailed: 'Preferensi berbagi tidak dapat diatur ulang sepenuhnya.',
      markdownLabel: 'Cuplikan README / Markdown',
      noData: 'Belum ada aktivitas lokal yang tersedia dalam rentang yang dipilih.',
      activityDisclaimer: 'Token gabungan menggambarkan volume aktivitas lokal, bukan produktivitas, tagihan langganan, atau kesetaraan kemampuan antar-provider.',
      combinedLabel: 'Gabungan',
      processedTokensLabel: 'token yang diproses',
      svgFooterNote: 'Volume aktivitas lokal · bukan produktivitas, tagihan, atau kesetaraan provider',
    };
  }
  return {
    ...intensity,
    eyebrow: 'Share studio',
    panelTitle: 'Combined activity heatmap and share card',
    description: 'Combines Claude and Codex processed-token activity by local calendar day. Cost is not the default intensity.',
    previewLabel: 'Live preview',
    privateBadge: 'Privacy-safe daily aggregates only',
    settingsLabel: 'Card settings',
    defaultTitle: 'Claude + Codex local activity',
    titleLabel: 'Share title',
    rangeLabel: 'Date range',
    last30: 'Last 30 days',
    last90: 'Last 90 days',
    year: 'Last year',
    paletteLabel: 'Heatmap colors',
    academicViolet: 'Academic Violet',
    claudeOrange: 'Claude Orange',
    codexBlue: 'Codex Blue',
    githubGreen: 'GitHub Green',
    customPalette: 'Custom',
    customAccent: 'Custom accent',
    privacyToggle: 'Show privacy preview',
    privacyIncludes: 'Export includes: the custom title, date range, and daily aggregate Claude, Codex, and combined processed-token totals.',
    privacyExcludes: 'Explicitly excluded: accounts, projects, thread titles, local paths, and log content.',
    updatePreview: 'Update preview',
    exportSvg: 'Export SVG…',
    copyMarkdown: 'Copy Markdown',
    resetSharing: 'Reset sharing preferences',
    resetComplete: 'Sharing preferences reset.',
    resetFailed: 'Could not fully reset sharing preferences.',
    markdownLabel: 'README / Markdown snippet',
    noData: 'No local activity is available in the selected range yet.',
    activityDisclaimer: 'Combined tokens describe local activity volume, not productivity, subscription billing, or provider capability equivalence.',
    combinedLabel: 'Combined',
    processedTokensLabel: 'processed tokens',
    svgFooterNote: 'Local activity volume · not productivity, billing, or provider equivalence',
  };
}

interface ProjectMatrixUiCopy {
  title: string;
  description: string;
  rangeLabel: string;
  viewLabel: string;
  last30: string;
  last90: string;
  heatmap: string;
  trend: string;
  completeCoverage: string;
  partialCoverage: string;
  noCoverage: string;
  project: string;
  activeDays: string;
  otherProjects: string;
  showMore: string;
  showLess: string;
  matrixAria: string;
  trendAria: string;
}

function projectMatrixUiCopy(locale: string): ProjectMatrixUiCopy {
  const copies: Record<string, ProjectMatrixUiCopy> = {
    en: {
      title: 'Project activity',
      description: 'One indexed project × calendar-day source powers both views. Token activity only; not cost or subscription quota.',
      rangeLabel: 'Range',
      viewLabel: 'View',
      last30: '30 days',
      last90: '90 days',
      heatmap: 'Heatmap',
      trend: 'Trend',
      completeCoverage: 'Complete coverage',
      partialCoverage: 'Indexed subtotal · partial coverage',
      noCoverage: 'No indexed coverage',
      project: 'Project',
      activeDays: 'active days',
      otherProjects: 'Other projects',
      showMore: 'Show more projects',
      showLess: 'Show fewer projects',
      matrixAria: 'Project activity heatmap',
      trendAria: 'Daily project activity stacked trend',
    },
    'de-DE': {
      title: 'Projektaktivität',
      description: 'Eine indexierte Projekt-×-Kalendertag-Quelle speist beide Ansichten. Nur Token-Aktivität; keine Kosten oder Abokontingente.',
      rangeLabel: 'Zeitraum',
      viewLabel: 'Ansicht',
      last30: '30 Tage',
      last90: '90 Tage',
      heatmap: 'Heatmap',
      trend: 'Verlauf',
      completeCoverage: 'Vollständige Abdeckung',
      partialCoverage: 'Indexierte Zwischensumme · teilweise Abdeckung',
      noCoverage: 'Keine indexierte Abdeckung',
      project: 'Projekt',
      activeDays: 'aktive Tage',
      otherProjects: 'Weitere Projekte',
      showMore: 'Mehr Projekte anzeigen',
      showLess: 'Weniger Projekte anzeigen',
      matrixAria: 'Heatmap der Projektaktivität',
      trendAria: 'Gestapelter Tagesverlauf der Projektaktivität',
    },
    'zh-TW': {
      title: '專案活動',
      description: '兩種檢視共用同一份已索引的「專案 × 本機日期」資料。僅表示 Token 活動，不是成本或訂閱額度。',
      rangeLabel: '範圍',
      viewLabel: '檢視',
      last30: '30 天',
      last90: '90 天',
      heatmap: '熱力圖',
      trend: '趨勢',
      completeCoverage: '涵蓋完整',
      partialCoverage: '已索引小計 · 涵蓋不完整',
      noCoverage: '沒有已索引涵蓋資料',
      project: '專案',
      activeDays: '個活躍日',
      otherProjects: '其他專案',
      showMore: '顯示更多專案',
      showLess: '收起專案',
      matrixAria: '專案活動熱力圖',
      trendAria: '每日專案活動堆疊趨勢',
    },
    'zh-CN': {
      title: '项目活动',
      description: '两种视图共用同一份已索引的“项目 × 本地日期”数据。仅表示 Token 活动，不是成本或订阅额度。',
      rangeLabel: '范围',
      viewLabel: '视图',
      last30: '30 天',
      last90: '90 天',
      heatmap: '热力图',
      trend: '趋势',
      completeCoverage: '覆盖完整',
      partialCoverage: '已索引小计 · 覆盖不完整',
      noCoverage: '没有已索引覆盖数据',
      project: '项目',
      activeDays: '个活跃日',
      otherProjects: '其他项目',
      showMore: '显示更多项目',
      showLess: '收起项目',
      matrixAria: '项目活动热力图',
      trendAria: '每日项目活动堆叠趋势',
    },
    ja: {
      title: 'プロジェクト活動',
      description: '両方の表示は、同じ索引済み「プロジェクト × ローカル日付」データを使用します。Token 活動のみで、費用や契約枠ではありません。',
      rangeLabel: '期間',
      viewLabel: '表示',
      last30: '30 日',
      last90: '90 日',
      heatmap: 'ヒートマップ',
      trend: '推移',
      completeCoverage: '完全なカバレッジ',
      partialCoverage: '索引済み小計 · 一部カバレッジ',
      noCoverage: '索引済みデータなし',
      project: 'プロジェクト',
      activeDays: '活動日',
      otherProjects: 'その他のプロジェクト',
      showMore: 'さらに表示',
      showLess: '表示を減らす',
      matrixAria: 'プロジェクト活動ヒートマップ',
      trendAria: '日別プロジェクト活動の積み上げ推移',
    },
    ko: {
      title: '프로젝트 활동',
      description: '두 보기는 동일한 인덱싱된 프로젝트 × 현지 날짜 데이터를 사용합니다. Token 활동일 뿐 비용이나 구독 한도가 아닙니다.',
      rangeLabel: '기간',
      viewLabel: '보기',
      last30: '30일',
      last90: '90일',
      heatmap: '히트맵',
      trend: '추세',
      completeCoverage: '전체 범위',
      partialCoverage: '인덱싱 소계 · 일부 범위',
      noCoverage: '인덱싱된 범위 없음',
      project: '프로젝트',
      activeDays: '활동 일수',
      otherProjects: '기타 프로젝트',
      showMore: '프로젝트 더 보기',
      showLess: '프로젝트 접기',
      matrixAria: '프로젝트 활동 히트맵',
      trendAria: '일별 프로젝트 활동 누적 추세',
    },
    'pt-BR': {
      title: 'Atividade por projeto',
      description: 'As duas visualizações usam a mesma fonte indexada de projeto × dia local. Apenas atividade de Tokens; não representa custo nem cota da assinatura.',
      rangeLabel: 'Período',
      viewLabel: 'Visualização',
      last30: '30 dias',
      last90: '90 dias',
      heatmap: 'Mapa de calor',
      trend: 'Tendência',
      completeCoverage: 'Cobertura completa',
      partialCoverage: 'Subtotal indexado · cobertura parcial',
      noCoverage: 'Sem cobertura indexada',
      project: 'Projeto',
      activeDays: 'dias ativos',
      otherProjects: 'Outros projetos',
      showMore: 'Mostrar mais projetos',
      showLess: 'Mostrar menos projetos',
      matrixAria: 'Mapa de calor da atividade por projeto',
      trendAria: 'Tendência diária empilhada da atividade por projeto',
    },
    id: {
      title: 'Aktivitas proyek',
      description: 'Kedua tampilan memakai sumber terindeks proyek × hari lokal yang sama. Hanya aktivitas Token; bukan biaya atau kuota langganan.',
      rangeLabel: 'Rentang',
      viewLabel: 'Tampilan',
      last30: '30 hari',
      last90: '90 hari',
      heatmap: 'Peta panas',
      trend: 'Tren',
      completeCoverage: 'Cakupan lengkap',
      partialCoverage: 'Subtotal terindeks · cakupan sebagian',
      noCoverage: 'Tidak ada cakupan terindeks',
      project: 'Proyek',
      activeDays: 'hari aktif',
      otherProjects: 'Proyek lainnya',
      showMore: 'Tampilkan lebih banyak proyek',
      showLess: 'Tampilkan lebih sedikit proyek',
      matrixAria: 'Peta panas aktivitas proyek',
      trendAria: 'Tren bertumpuk aktivitas proyek harian',
    },
  };
  return copies[locale] ?? copies.en;
}

export class UsageWebviewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private webviewClientReady = false;
  private dashboardLivePatchRevision = 0;
  private pendingDashboardLivePatch: PendingDashboardLivePatch | undefined;
  private scheduledDashboardLivePatch: PendingDashboardLivePatch | undefined;
  private dashboardLivePatchSendScheduled = false;
  private lastLivePatchStructureKey: string | undefined;
  private compareSnapshotRenderKey: string | undefined;
  private compareSnapshotUpdatedAt = 0;
  private currentSessionData: SessionData | null = null;
  private todayData: UsageData | null = null;
  private rolling30DayData: UsageData | null = null;
  private allTimeData: UsageData | null = null;
  private dailyDataForRolling30Days: { date: string; data: UsageData }[] = [];
  private dailyDataForAllTime: { date: string; data: UsageData }[] = [];
  private dailyDataForEveryDay: { date: string; data: UsageData }[] = [];
  private hourlyDataForToday: { hour: string; data: UsageData }[] = [];
  private hourlyDataForRolling30DaysByDay: Record<
    string,
    { hour: string; data: UsageData }[]
  > = {};
  private isLoading: boolean = false;
  private error: string | null = null;
  private dataDirectory: string | null = null;
  private currentTab: string = 'today';
  private currentProvider: 'claude' | 'codex' | 'compare' = 'claude';
  private sharingTemplate: SharingTemplate = 'combinedHeatmap';
  private sharingWorkspaceRequested = false;
  private readonly sharingCommandIntents = new SharingCommandIntentLedger();
  private codexView: CodexUsageView | null = null;
  private codexInsights: CodexScopedInsights = emptyCodexScopedInsights();
  private providerAvailability = { claude: false, codex: false, codexData: false };
  private codexLoading = false;
  private codexProgress: CodexRenderProgress | null = null;
  private providerSelectionInitialized = false;
  private configuredDateTimeFormatter?: {
    configuredTimeZone: string;
    formatter: Intl.DateTimeFormat;
  };
  private allRecords: any[] = [];
  private sessionBreakdown: SessionUsage[] = [];
  private projectBreakdown: ProjectGroup[] = [];
  private claudeProjectUsageMatrix: ProjectUsageMatrixSnapshot | null = null;
  private contentAnalysis: ContentAnalysis | null = null;
  private branchBreakdown: BranchUsage[] = [];
  private workflowBreakdown: WorkflowUsage[] = [];
  private costliestMessages: CostlyMessage[] = [];
  // Cache the (slow-moving) cache analyses so they recompute at most weekly, not
  // every render — Carl: a weekly refresh is plenty for these estimates.
  private analysisCache?: {
    at: number;
    ttl: ReturnType<typeof ClaudeDataLoader.estimateCacheTtl>;
    churn: ReturnType<typeof ClaudeDataLoader.estimateCacheChurnCost>;
    byModel: ReturnType<typeof ClaudeDataLoader.cacheStatsByModel>;
    rightsizing: ReturnType<typeof ClaudeDataLoader.modelRightsizing>;
    health: ReturnType<typeof ClaudeDataLoader.sessionHealth>;
    hours: ReturnType<typeof ClaudeDataLoader.activeHours>;
    skillRoi: ReturnType<typeof ClaudeDataLoader.skillRoi>;
  };
  // One reusable conversation-viewer panel: each "view" click re-reads the file
  // and refreshes this panel rather than piling up new tabs.
  private conversationPanel?: vscode.WebviewPanel;
  // Reuse expensive local previews only while their data and display context
  // remain unchanged. Config is retained independently from a generated SVG.
  private shareCardPreviewCache?: {
    records: any[]; day: string; timeZone: string; locale: string; themeKind?: number; svg: string;
  };
  private claudeHeatmapPreviewCache?: {
    dailyRows: { date: string; data: UsageData }[];
    day: string;
    timeZone: string;
    locale: string;
    svg: string;
  };
  private claudeDailyUsageCache?: {
    dailyRows: { date: string; data: UsageData }[];
    timeZone: string;
    daily: ReturnType<typeof ClaudeDataLoader.getDailyUsageMap>;
  };
  private lastShareCardConfig?: {
    range: string;
    scope: string;
    sections: Record<string, boolean>;
    fullNumbers: boolean;
    theme: string;
  };
  private readonly localDataClientActionRequests = new Map<
    string,
    { resolve: (ok: boolean) => void; timeout: NodeJS.Timeout }
  >();
  // Real quota utilisation (pushed asynchronously) for the workflow quota
  // guard banner; dismissal lasts for the lifetime of this window.
  private usageLimits: ClaudeApiUsageResponse | null = null;
  private claudeWeeklyQuotaHistory: WeeklyQuotaObservation[] = [];
  private quotaWarnDismissed: boolean = false;
  // Extension-host hooks make the optimizer use the same prepare -> preview ->
  // explicit send boundary as advice, without exposing keys to the webview.
  public onPrepareOptimizerInvocation?: (
    draft: string,
    options: { resolve: boolean; distil: boolean; aesthetic: boolean },
    sourceRevision: string,
    consentGeneration: number,
  ) => Promise<{ prepared?: PreparedAiInvocation; error?: string }>;
  public onSendOptimizerInvocation?: (
    prepared: PreparedAiInvocation,
    expectedSourceRevision: string,
    expectedConsentGeneration: number,
  ) => Promise<PreparedOptimizerResult>;
  /** Extension-host hooks keep API configuration and keys out of the webview. */
  public onPrepareAdviceInvocation?: (
    snapshot: PreparedAdviceSnapshot,
    sourceRevision: string,
    consentGeneration: number,
  ) => PreparedAiInvocation;
  public onSendAdviceInvocation?: (
    prepared: PreparedAiInvocation,
    references: StructuredAdviceReferences,
    expectedSourceRevision: string,
    expectedConsentGeneration: number,
  ) => Promise<StructuredAdviceRequestResult>;
  public onAiSurfaceClosed?: () => void;
  public onAdviceDataCleared?: () => Promise<void>;
  public onAdviceConsentWithdrawn?: () => Promise<void>;
  public onRequestLocalDataInventory?: (
    client: LocalDataClientSummary,
  ) => Promise<LocalDataInventory>;
  public onRunLocalDataAction?: (
    action: LocalDataAction,
    quotaScopeToken?: string,
  ) => Promise<LocalDataActionResult>;
  public onExportClaudeHeatmap?: () => void | Promise<void>;
  public onPublishClaudeHeatmap?: () => void | Promise<void>;
  public onLocalDataClientReady?: () => void;
  // Shared settings store + a callback to let extension.ts re-apply config when
  // the user edits a setting in the dashboard's ⚙ Settings tab. Both are set by
  // extension.ts right after construction.
  public settings?: SettingsStore;
  public onSettingsChanged?: (key?: string) => void;
  // Last Usage Optimizer interaction (draft + lens choices + result). Persisted
  // here so an auto-refresh re-render of the webview doesn't wipe a result the
  // user is still reading — renderOptimizerCard restores it from this.
  private optimizerState: {
    draft: string;
    resolve: boolean;
    distil: boolean;
    aesthetic: boolean;
    prompt?: string;
    settings?: string;
    error?: string;
    snapshotId?: string;
    previewBody?: string;
    previewSha256?: string;
    previewBytes?: number;
    /** Random opaque run ID; never derived from the draft or model output. */
    adviceId?: string;
  } | null = null;
  private preparedOptimizerRequests = new Map<
    string,
    {
      prepared: PreparedAiInvocation;
      draft: string;
      sourceRevision: string;
      consentGeneration: number;
    }
  >();
  private optimizerConsentGeneration = 0;
  /**
   * Experimental v2.3.1 state. Raw prompt samples never enter rendered HTML:
   * they stay in the provider state until one explicit sealed-snapshot request.
   */
  private adviceEffectivenessStates: AdviceEffectivenessProviderStates = {};
  private preparedAdviceSnapshots = new Map<
    string,
    {
      provider: AdviceEffectivenessProvider;
      snapshot: PreparedAdviceSnapshot;
      invocation: PreparedAiInvocation;
      sourceRevision: string;
      consentGeneration: number;
      references: StructuredAdviceReferences;
    }
  >();
  private adviceConsentGeneration = 0;
  private adviceConsentWritesPending = 0;
  private adviceLocalState: AdviceLocalState = createClosedAdviceLocalState();
  private adviceLocalStateStatus: 'loading' | 'ready' | 'degraded' = 'loading';
  private adviceLocalStateGeneration = 0;
  private adviceLocalStateWrite: Promise<void> = Promise.resolve();
  private adviceComparisonProductionRevision = '';

  constructor(private context: vscode.ExtensionContext) {
    const storage = this.adviceStateStorage();
    if (!storage) {
      this.adviceLocalStateStatus = 'degraded';
      return;
    }
    void loadAndMigrateAdviceLocalState(storage).then((loaded) => {
      this.adviceLocalState = loaded.value;
      this.adviceLocalStateStatus = loaded.ok ? 'ready' : 'degraded';
      this.scheduleAdviceComparisonProduction();
      if (this.panel) {
        this.updateWebview();
      }
    }).catch(() => {
      this.adviceLocalState = createClosedAdviceLocalState();
      this.adviceLocalStateStatus = 'degraded';
      if (this.panel) {
        this.updateWebview();
      }
    });
  }

  /** Read a moved/core setting through the shared store, with a fallback. */
  private setting<T>(key: string, fallback: T): T {
    return this.settings ? this.settings.get<T>(key) : fallback;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  private adviceStateStorage(): AdviceLocalStateStorage | undefined {
    const state = (this.context as Partial<vscode.ExtensionContext>).globalState;
    if (!state || typeof state.get !== 'function' || typeof state.update !== 'function') {
      return undefined;
    }
    return state;
  }

  private adviceExperimentEnabled(): boolean {
    return this.setting<boolean>('advice.effectiveness.enabled', false);
  }

  /**
   * Serialize every persisted advice mutation through one writer. The mutation
   * is derived from the latest committed state only when its turn starts, so a
   * delayed consent, feedback, comparison, or clear write cannot resurrect an
   * older snapshot over a newer user decision.
   */
  private enqueueAdviceLocalStateWrite(
    mutate: (current: AdviceLocalState) => AdviceLocalState | undefined,
  ): Promise<
    | { ok: true; changed: boolean; value: AdviceLocalState }
    | { ok: false }
  > {
    const operation = this.adviceLocalStateWrite.then(async () => {
      const storage = this.adviceStateStorage();
      if (!storage || this.adviceLocalStateStatus !== 'ready') {
        return { ok: false as const };
      }
      let next: AdviceLocalState | undefined;
      try {
        next = mutate(this.adviceLocalState);
      } catch {
        return { ok: false as const };
      }
      if (!next) {
        return { ok: true as const, changed: false, value: this.adviceLocalState };
      }
      const saved = await saveAdviceLocalState(storage, next);
      if (!saved.ok) {
        this.adviceLocalStateStatus = 'degraded';
        return { ok: false as const };
      }
      this.adviceLocalState = saved.value;
      return { ok: true as const, changed: true, value: saved.value };
    });
    this.adviceLocalStateWrite = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private adviceProviderState(value: unknown): AdviceEffectivenessProviderState | undefined {
    if (!this.adviceExperimentEnabled() || (value !== 'claude' && value !== 'codex')) {
      return undefined;
    }
    return this.adviceEffectivenessStates[value];
  }

  private postAdviceMessage(message: Record<string, unknown>): void {
    void this.panel?.webview.postMessage(message);
  }

  private clearPreparedAdviceSnapshots(provider?: AdviceEffectivenessProvider): void {
    if (!provider) {
      this.preparedAdviceSnapshots.clear();
      return;
    }
    for (const [snapshotId, value] of this.preparedAdviceSnapshots) {
      if (value.provider === provider) {
        this.preparedAdviceSnapshots.delete(snapshotId);
      }
    }
  }

  /**
   * Only the extension host can decide whether a sealed preview is still
   * authorized. The webview receives opaque IDs for the currently valid
   * previews and must discard any captured DOM content that is not listed.
   */
  private activeAdviceSnapshotIds(): Partial<Record<AdviceEffectivenessProvider, string>> {
    const active: Partial<Record<AdviceEffectivenessProvider, string>> = {};
    const ambiguous = new Set<AdviceEffectivenessProvider>();
    if (
      this.adviceLocalStateStatus !== 'ready' ||
      this.adviceConsentWritesPending > 0 ||
      this.adviceLocalState.aggregateConsent !== 'explicit'
    ) {
      return active;
    }
    for (const [snapshotId, stored] of this.preparedAdviceSnapshots) {
      const providerState = this.adviceProviderState(stored.provider);
      if (
        !providerState ||
        stored.provider !== providerState.provider ||
        stored.sourceRevision !== this.adviceSourceRevision(providerState) ||
        stored.consentGeneration !== this.adviceConsentGeneration ||
        (stored.snapshot.preview.promptSampleCount > 0 &&
          this.adviceLocalState.promptSampleConsent !== 'explicit')
      ) {
        continue;
      }
      // More than one valid snapshot for one provider violates the sealing
      // invariant. Fail closed instead of choosing one by insertion order.
      if (ambiguous.has(stored.provider)) {
        continue;
      }
      if (active[stored.provider] !== undefined) {
        delete active[stored.provider];
        ambiguous.add(stored.provider);
        continue;
      }
      active[stored.provider] = snapshotId;
    }
    return active;
  }

  /** Opaque content revision; no path/session/title is retained or exposed. */
  private adviceSourceRevision(state: AdviceEffectivenessProviderState): string {
    const safeShape = {
      provider: state.provider,
      aggregate: state.aggregate,
      observations: state.contract.observations.map((item) => ({
        id: item.id,
        metric: item.metric,
        value: item.value,
        unit: item.unit,
        method: item.method,
        sourceId: item.sourceId,
      })),
      evidence: state.contract.evidence.map((item) => ({
        id: item.id,
        observationIds: item.observationIds,
        strength: item.strength,
      })),
      sourceQuality: state.contract.provenance.sources.map((source) => ({
        id: source.id,
        confidence: source.confidence,
        qualityFlags: source.qualityFlags,
        window: source.window,
      })),
      // Prompt text remains host-only. Its digest merely invalidates a preview
      // if the separately consented sample set changes before send.
      promptSampleDigest: createHash('sha256')
        // JSON preserves both array boundaries and embedded control characters.
        // A delimiter alone is ambiguous because prompt text may contain it.
        .update(JSON.stringify(state.promptSamples.map((sample) => sample.text)), 'utf8')
        .digest('hex'),
      userContextDigest: createHash('sha256')
        // JSON preserves lone surrogates. Hashing the raw UTF-8 bytes would
        // replace them with U+FFFD and could seal two different request bodies
        // under the same revision.
        .update(JSON.stringify(state.userContext ?? ''), 'utf8')
        .digest('hex'),
    };
    return `advice-${createHash('sha256')
      .update(JSON.stringify(safeShape), 'utf8')
      .digest('hex')}`;
  }

  private async handleAdviceConsentMessage(message: Record<string, unknown>): Promise<void> {
    const providerState = this.adviceProviderState(message.provider);
    const aggregateConsent = message.aggregateConsent;
    const promptSampleConsent = message.promptSampleConsent;
    const stateGeneration = this.adviceLocalStateGeneration;
    if (
      !providerState ||
      providerState.provider !== 'claude' ||
      !providerState.remotePreviewEligible ||
      !providerState.aggregate ||
      (aggregateConsent !== 'explicit' && aggregateConsent !== 'not-granted') ||
      (promptSampleConsent !== 'explicit' && promptSampleConsent !== 'not-granted') ||
      (promptSampleConsent === 'explicit' && aggregateConsent !== 'explicit') ||
      (promptSampleConsent === 'explicit' &&
        providerState.promptSamples.length === 0 &&
        !providerState.userContext?.trim()) ||
      this.adviceLocalStateStatus !== 'ready' ||
      !this.adviceStateStorage()
    ) {
      this.postAdviceMessage({ command: 'adviceConsentResult', ok: false, provider: message.provider });
      return;
    }
    const withdrawn =
      (this.adviceLocalState.aggregateConsent === 'explicit' && aggregateConsent === 'not-granted') ||
      (this.adviceLocalState.promptSampleConsent === 'explicit' && promptSampleConsent === 'not-granted');
    // Revocation takes effect on receipt, not after a potentially slow disk write.
    // A counter also covers overlapping consent changes in the shared writer queue.
    this.adviceConsentWritesPending += 1;
    this.adviceConsentGeneration += 1;
    this.clearPreparedAdviceSnapshots(providerState.provider);
    const cancellation = withdrawn
      ? Promise.resolve().then(() => this.onAdviceConsentWithdrawn?.()).then(() => true, () => false)
      : Promise.resolve(true);
    try {
      const saved = await this.enqueueAdviceLocalStateWrite((current) => {
        if (stateGeneration !== this.adviceLocalStateGeneration) return undefined;
        return {
          ...current,
          featureMode: 'enabled',
          aggregateConsent,
          promptSampleConsent,
        };
      });
      const cancelled = await cancellation;
      if (!cancelled) this.adviceLocalStateStatus = 'degraded';
      if (!saved.ok || !saved.changed || !cancelled) {
        this.postAdviceMessage({ command: 'adviceConsentResult', ok: false, provider: message.provider });
        return;
      }
      this.postAdviceMessage({
        command: 'adviceConsentResult',
        ok: true,
        provider: providerState.provider,
        aggregateConsent: saved.value.aggregateConsent,
        promptSampleConsent: saved.value.promptSampleConsent,
      });
    } finally {
      this.adviceConsentWritesPending -= 1;
    }
  }

  private handlePrepareAdviceSnapshotMessage(message: Record<string, unknown>): void {
    const providerState = this.adviceProviderState(message.provider);
    if (!providerState) {
      this.postAdviceMessage({ command: 'adviceSnapshotResult', ok: false, provider: message.provider });
      return;
    }
    const aggregate = message.aggregateConsent;
    const promptSamples = message.promptSampleConsent;
    if (
      (aggregate !== 'explicit' && aggregate !== 'not-granted') ||
      (promptSamples !== 'explicit' && promptSamples !== 'not-granted') ||
      this.adviceLocalStateStatus !== 'ready' ||
      this.adviceConsentWritesPending > 0 ||
      aggregate !== this.adviceLocalState.aggregateConsent ||
      (promptSamples === 'explicit' && this.adviceLocalState.promptSampleConsent !== 'explicit')
    ) {
      this.postAdviceMessage({ command: 'adviceSnapshotResult', ok: false, provider: providerState.provider });
      return;
    }
    const result = prepareAdviceSnapshot(providerState, {
      aggregate,
      promptSamples,
    });
    if (!result.ok) {
      this.postAdviceMessage({
        command: 'adviceSnapshotResult',
        ok: false,
        provider: providerState.provider,
        reason: result.reason,
      });
      return;
    }
    let invocation: PreparedAiInvocation;
    const sourceRevision = this.adviceSourceRevision(providerState);
    try {
      if (!this.onPrepareAdviceInvocation) {
        throw new Error('AI preparation is unavailable');
      }
      invocation = this.onPrepareAdviceInvocation(
        result.value,
        sourceRevision,
        this.adviceConsentGeneration,
      );
    } catch {
      this.postAdviceMessage({
        command: 'adviceSnapshotResult',
        ok: false,
        provider: providerState.provider,
        reason: 'invalid-evidence',
      });
      return;
    }
    const preview = previewAiInvocation(invocation);
    this.clearPreparedAdviceSnapshots(providerState.provider);
    const snapshotId = `snapshot-${randomBytes(12).toString('hex')}`;
    this.preparedAdviceSnapshots.set(snapshotId, {
      provider: providerState.provider,
      snapshot: result.value,
      invocation,
      sourceRevision,
      consentGeneration: this.adviceConsentGeneration,
      references: {
        observationIds: providerState.contract.observations.map((item) => item.id),
        evidenceIds: providerState.contract.evidence.map((item) => item.id),
      },
    });
    this.postAdviceMessage({
      command: 'adviceSnapshotResult',
      ok: true,
      snapshotId,
      provider: providerState.provider,
      contentType: preview.contentType,
      dataMode: preview.dataMode,
      promptSampleCount: result.value.preview.promptSampleCount,
      utf8Bytes: preview.utf8Bytes,
      sha256: preview.sha256,
      body: preview.body,
    });
  }

  private async handleSendAdviceSnapshotMessage(message: Record<string, unknown>): Promise<void> {
    const snapshotId = message.snapshotId;
    const providerState = this.adviceProviderState(message.provider);
    const stored = typeof snapshotId === 'string'
      ? this.preparedAdviceSnapshots.get(snapshotId)
      : undefined;
    if (
      !providerState ||
      !stored ||
      this.adviceLocalStateStatus !== 'ready' ||
      this.adviceConsentWritesPending > 0 ||
      this.adviceLocalState.aggregateConsent !== 'explicit' ||
      stored.provider !== providerState.provider ||
      stored.sourceRevision !== this.adviceSourceRevision(providerState) ||
      stored.consentGeneration !== this.adviceConsentGeneration ||
      !this.onSendAdviceInvocation
    ) {
      this.postAdviceMessage({
        command: 'adviceSendResult',
        ok: false,
        provider: message.provider,
        reason: 'stale-preview',
      });
      return;
    }
    const result = await this.onSendAdviceInvocation(
      stored.invocation,
      stored.references,
      stored.sourceRevision,
      stored.consentGeneration,
    );
    if (
      this.preparedAdviceSnapshots.get(snapshotId as string) !== stored ||
      stored.sourceRevision !== this.adviceSourceRevision(providerState) ||
      stored.consentGeneration !== this.adviceConsentGeneration
    ) {
      this.postAdviceMessage({
        command: 'adviceSendResult',
        ok: false,
        provider: providerState.provider,
        reason: 'stale-preview',
      });
      return;
    }
    if (!result.ok) {
      this.postAdviceMessage({
        command: 'adviceSendResult',
        ok: false,
        provider: providerState.provider,
        reason: result.code,
      });
      return;
    }
    const next = createAdviceContract({
      adviceId: providerState.contract.adviceId,
      observations: providerState.contract.observations,
      evidence: providerState.contract.evidence,
      recommendations: result.value.recommendations,
      privacy: {
        dataMode: stored.invocation.dataMode === 'aggregates-with-prompt-samples'
          ? 'aggregates-with-prompt-samples'
          : stored.invocation.dataMode === 'aggregates-with-personalization'
            ? 'aggregates-with-personalization'
            : 'aggregates-only',
        promptSampleConsent: stored.invocation.dataMode === 'aggregates-only'
          ? 'not-granted'
          : 'explicit',
        promptSampleCount: stored.snapshot.prepared.promptSampleCount,
        feedbackStorage: 'local-only',
      },
      provenance: {
        ...providerState.contract.provenance,
        generatedBy: { kind: 'remote-model' },
        generatedAt: new Date().toISOString(),
      },
    });
    if (!next.ok) {
      this.postAdviceMessage({
        command: 'adviceSendResult',
        ok: false,
        provider: providerState.provider,
        reason: 'invalid-schema',
      });
      return;
    }
    providerState.contract = next.value;
    this.preparedAdviceSnapshots.delete(snapshotId as string);
    this.postAdviceMessage({
      command: 'adviceSendResult',
      ok: true,
      provider: providerState.provider,
      recommendationCount: next.value.recommendations.length,
    });
    this.updateWebview();
  }

  public async clearAdviceLocalData(): Promise<boolean> {
    const storage = this.adviceStateStorage();
    if (!storage) {
      return false;
    }
    // The command-palette path has no browser click that can synchronously
    // revoke a preview. Cancel browser-side digest validation before the first
    // durable-storage await, then perform the host-side invalidation below.
    this.postAdviceMessage({ command: 'advicePreviewsInvalidated' });
    this.adviceLocalStateGeneration += 1;
    this.adviceConsentGeneration += 1;
    this.clearPreparedAdviceSnapshots();
    this.adviceComparisonProductionRevision = '';
    const write = this.adviceLocalStateWrite.then(async () => {
      const cleared = createClearedAdviceLocalState();
      try {
        // Removing the current key is the user-visible privacy guarantee. The
        // in-memory enabled/closed surface remains usable until reload, while a
        // later mutation must queue after this removal before recreating state.
        await storage.update(ADVICE_LOCAL_STATE_KEY, undefined);
        this.adviceLocalState = cleared;
        this.adviceLocalStateStatus = 'ready';
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });
    this.adviceLocalStateWrite = write.then(() => undefined, () => undefined);
    const cancelled = Promise.resolve(this.onAdviceDataCleared?.()).catch(() => undefined);
    const saved = await write;
    await cancelled;
    if (!saved.ok) {
      return false;
    }
    this.updateWebview();
    return true;
  }

  public adviceLocalDataInventorySummary(): {
    approximateBytes: number | null;
    itemCount: number;
    oldestAt: number | null;
    newestAt: number | null;
  } {
    const state = this.adviceLocalState;
    const timestamps = [
      ...state.feedback.flatMap((item) => [item.updatedAtEpochMs, item.appliedAtEpochMs]),
      ...state.suppression.flatMap((item) => [item.updatedAtEpochMs, item.snoozedUntilEpochMs]),
      ...state.comparablePairs.map((item) => item.recordedAtEpochMs),
      ...state.comparisonResults.map((item) => item.recordedAtEpochMs),
    ];
    const range = finiteTimestampRange(timestamps);
    return {
      approximateBytes: approximateJsonBytes(state),
      itemCount:
        state.feedback.length +
        state.suppression.length +
        state.comparablePairs.length +
        state.comparisonResults.length,
      ...range,
    };
  }

  public requestLocalDataInventoryRefresh(): void {
    this.panel?.webview.postMessage({ command: 'requestLocalDataInventoryClient' });
  }

  private settleLocalDataClientAction(requestId: string, ok: boolean): void {
    const pending = this.localDataClientActionRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.localDataClientActionRequests.delete(requestId);
    pending.resolve(ok);
  }

  /**
   * Apply Webview-owned deletion with an acknowledgement. Host-side success is
   * not reported until the live panel confirms its exact allowlists ran.
   */
  public requestClientLocalDataAction(action: LocalDataClientAction): Promise<boolean> {
    const panel = this.panel;
    if (!panel) return Promise.resolve(false);
    const requestId = randomBytes(12).toString('hex');
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(
        () => this.settleLocalDataClientAction(requestId, false),
        2_000,
      );
      this.localDataClientActionRequests.set(requestId, { resolve, timeout });
      void Promise.resolve(panel.webview.postMessage({
        command: 'localDataClientAction',
        action,
        requestId,
      })).then((delivered) => {
        if (!delivered) this.settleLocalDataClientAction(requestId, false);
      }).catch(() => this.settleLocalDataClientAction(requestId, false));
    });
  }

  public clearSharingRuntimeState(): void {
    this.invalidateSharingCaches();
    this.lastShareCardConfig = undefined;
    this.sharingTemplate = 'combinedHeatmap';
    this.sharingWorkspaceRequested = false;
    // Reset clears any live command without rewinding its sequence. A later
    // command therefore cannot collide with a command already seen by this
    // provider's Webview.
    this.sharingCommandIntents.clearPending();
  }

  /** Pricing or display changes invalidate derived previews but not the user's
   * chosen share-card range, scope, sections, or theme. */
  public invalidateShareCardPreview(): void {
    this.invalidateSharingCaches();
  }

  private invalidateSharingCaches(): void {
    this.shareCardPreviewCache = undefined;
    this.claudeHeatmapPreviewCache = undefined;
    this.claudeDailyUsageCache = undefined;
  }

  private async handleClearAdviceLocalDataMessage(): Promise<void> {
    const ok = await this.clearAdviceLocalData();
    this.postAdviceMessage({ command: 'adviceClearResult', ok });
  }

  private async handleAdviceFeedbackMessage(message: Record<string, unknown>): Promise<void> {
    const optimizerTarget =
      message.provider === 'optimizer' &&
      this.setting<boolean>('advice.optimizer.enabled', false) &&
      typeof this.optimizerState?.adviceId === 'string' &&
      this.optimizerState.adviceId === message.adviceId &&
      message.recommendationId === OPTIMIZER_FEEDBACK_RECOMMENDATION_ID &&
      typeof this.optimizerState.prompt === 'string' &&
      this.optimizerState.prompt.length > 0;
    const providerState = optimizerTarget
      ? undefined
      : this.adviceProviderState(message.provider);
    const stateGeneration = this.adviceLocalStateGeneration;
    const adviceId = message.adviceId;
    const recommendationId = message.recommendationId;
    const kind = message.kind;
    const recommendation = providerState?.contract.recommendations.find(
      (candidate) => candidate.id === recommendationId,
    );
    const targetAdviceId = optimizerTarget
      ? this.optimizerState!.adviceId as string
      : providerState?.contract.adviceId;
    const targetRecommendationId = optimizerTarget
      ? OPTIMIZER_FEEDBACK_RECOMMENDATION_ID
      : recommendation?.id;
    const responseIdentity =
      typeof targetAdviceId === 'string' &&
      typeof targetRecommendationId === 'string' &&
      targetAdviceId === adviceId &&
      targetRecommendationId === recommendationId
        ? { adviceId: targetAdviceId, recommendationId: targetRecommendationId }
        : {};
    if (
      (!optimizerTarget && !providerState) ||
      targetAdviceId !== adviceId ||
      targetRecommendationId !== recommendationId ||
      (kind !== 'helpful' && kind !== 'not-helpful' && kind !== 'applied') ||
      this.adviceLocalStateStatus !== 'ready' ||
      !this.adviceStateStorage()
    ) {
      this.postAdviceMessage({
        command: 'adviceFeedbackResult',
        ok: false,
        provider: message.provider,
        ...responseIdentity,
      });
      return;
    }
    const updatedAtEpochMs = Date.now();
    let mutationAccepted = true;
    const saved = await this.enqueueAdviceLocalStateWrite((current) => {
      if (stateGeneration !== this.adviceLocalStateGeneration) return undefined;
      const changed = upsertAdviceLocalFeedback(current, {
        adviceId: targetAdviceId as string,
        recommendationId: targetRecommendationId as string,
        kind,
        updatedAtEpochMs,
      });
      if (!changed.ok) {
        mutationAccepted = false;
        return undefined;
      }
      const changedFeedback = changed.value.feedback.find(
        (item) => item.adviceId === adviceId && item.recommendationId === recommendationId,
      );
      return kind === 'applied' && changedFeedback?.applied !== 'applied'
        ? {
            ...changed.value,
            featureMode: 'enabled' as const,
            comparablePairs: changed.value.comparablePairs.filter(
              (pair) => pair.adviceId !== adviceId || pair.recommendationId !== recommendationId,
            ),
            comparisonResults: changed.value.comparisonResults.filter(
              (result) => result.recommendationId !== recommendationId,
            ),
          }
        : { ...changed.value, featureMode: 'enabled' as const };
    });
    if (!saved.ok) {
      this.postAdviceMessage({
        command: 'adviceFeedbackResult',
        ok: false,
        provider: message.provider,
        ...responseIdentity,
      });
      return;
    }
    if (!saved.changed || !mutationAccepted) {
      this.postAdviceMessage({
        command: 'adviceFeedbackResult',
        ok: false,
        provider: message.provider,
        ...responseIdentity,
      });
      return;
    }
    if (kind === 'applied' && !optimizerTarget) {
      this.adviceComparisonProductionRevision = '';
      this.scheduleAdviceComparisonProduction();
    }
    const feedback = saved.value.feedback.find(
      (item) => item.adviceId === adviceId && item.recommendationId === recommendationId,
    );
    this.postAdviceMessage({
      command: 'adviceFeedbackResult',
      ok: true,
      provider: message.provider,
      adviceId,
      recommendationId,
      rating: feedback?.rating ?? 'unrated',
      applied: feedback?.applied ?? 'not-applied',
    });
  }

  private async handleAdviceSnoozeMessage(message: Record<string, unknown>): Promise<void> {
    const optimizerTarget =
      message.provider === 'optimizer' &&
      this.setting<boolean>('advice.optimizer.enabled', false) &&
      typeof this.optimizerState?.adviceId === 'string' &&
      this.optimizerState.adviceId === message.adviceId &&
      message.recommendationId === OPTIMIZER_FEEDBACK_RECOMMENDATION_ID;
    const providerState = optimizerTarget ? undefined : this.adviceProviderState(message.provider);
    const adviceId = message.adviceId;
    const recommendationId = message.recommendationId;
    const targetAdviceId = optimizerTarget ? this.optimizerState!.adviceId : providerState?.contract.adviceId;
    const targetRecommendationId = optimizerTarget
      ? OPTIMIZER_FEEDBACK_RECOMMENDATION_ID
      : providerState?.contract.recommendations.find((item) => item.id === recommendationId)?.id;
    const valid =
      (optimizerTarget || Boolean(providerState)) &&
      typeof adviceId === 'string' &&
      typeof recommendationId === 'string' &&
      targetAdviceId === adviceId &&
      targetRecommendationId === recommendationId &&
      this.adviceLocalStateStatus === 'ready' &&
      Boolean(this.adviceStateStorage());
    const response = { command: 'adviceSnoozeResult', provider: message.provider, adviceId, recommendationId };
    if (!valid) {
      this.postAdviceMessage({ ...response, ok: false });
      return;
    }
    const stateGeneration = this.adviceLocalStateGeneration;
    const now = Date.now();
    const resume = message.mode === 'resume';
    let mutationAccepted = true;
    const saved = await this.enqueueAdviceLocalStateWrite((current) => {
      if (stateGeneration !== this.adviceLocalStateGeneration) return undefined;
      const changed = resume
        ? resumeAdviceRecommendation(current, {
            provider: optimizerTarget ? 'optimizer' : message.provider as 'claude' | 'codex',
            surface: optimizerTarget ? 'optimizer' : 'advice',
            recommendationId: targetRecommendationId as string,
          })
        : snoozeAdviceRecommendation(current, {
            provider: optimizerTarget ? 'optimizer' : message.provider as 'claude' | 'codex',
            surface: optimizerTarget ? 'optimizer' : 'advice',
            recommendationId: targetRecommendationId as string,
            updatedAtEpochMs: now,
            snoozedUntilEpochMs: now + ADVICE_SNOOZE_DURATION_MS,
          });
      if (!changed.ok) {
        mutationAccepted = false;
        return undefined;
      }
      return { ...changed.value, featureMode: 'enabled' as const };
    });
    if (!saved.ok || !saved.changed || !mutationAccepted) {
      this.postAdviceMessage({ ...response, ok: false });
      return;
    }
    const until = adviceRecommendationSnoozedUntil(saved.value, {
      provider: optimizerTarget ? 'optimizer' : message.provider as 'claude' | 'codex',
      surface: optimizerTarget ? 'optimizer' : 'advice',
      recommendationId: targetRecommendationId as string,
      nowEpochMs: now,
    });
    this.postAdviceMessage({ ...response, ok: true, snoozedUntilEpochMs: until });
    this.updateWebview();
  }

  private async handlePrepareOptimizerMessage(message: Record<string, unknown>): Promise<void> {
    if (!this.setting<boolean>('advice.optimizer.enabled', false)) {
      this.discardPreparedOptimizer();
      this.postAdviceMessage({ command: 'optimizePreviewResult', ok: false, error: I18n.t.popup.adviceEffectiveness.strictOutputRejected });
      return;
    }
    const draft = typeof message.draft === 'string' ? message.draft : '';
    const options = {
      resolve: message.resolve === true,
      distil: message.distil === true,
      aesthetic: message.aesthetic === true,
    };
    // An explicit rerun is an active user decision: it re-opens the stable
    // optimizer recommendation scope without changing its independent feedback.
    if (this.adviceLocalStateStatus === 'ready' && this.adviceStateStorage()) {
      await this.enqueueAdviceLocalStateWrite((current) => {
        const resumed = resumeAdviceRecommendation(current, {
          provider: 'optimizer',
          surface: 'optimizer',
          recommendationId: OPTIMIZER_FEEDBACK_RECOMMENDATION_ID,
        });
        return resumed.ok ? resumed.value : undefined;
      });
    }
    this.optimizerConsentGeneration += 1;
    this.preparedOptimizerRequests.clear();
    const sourceRevision = `optimizer-${createHash('sha256')
      .update(JSON.stringify({ draft, options }), 'utf8')
      .digest('hex')}`;
    const consentGeneration = this.optimizerConsentGeneration;
    const baseState = { draft, ...options };
    if (!this.onPrepareOptimizerInvocation) {
      this.optimizerState = { ...baseState, error: 'Optimizer is not available.' };
      this.postAdviceMessage({ command: 'optimizePreviewResult', ok: false, error: 'Optimizer is not available.' });
      return;
    }
    const result = await this.onPrepareOptimizerInvocation(
      draft,
      options,
      sourceRevision,
      consentGeneration,
    );
    if (consentGeneration !== this.optimizerConsentGeneration) {
      this.postAdviceMessage({ command: 'optimizePreviewResult', ok: false, error: I18n.t.popup.adviceEffectiveness.strictOutputRejected });
      return;
    }
    if (!result.prepared) {
      this.optimizerState = { ...baseState, error: result.error ?? '' };
      this.postAdviceMessage({ command: 'optimizePreviewResult', ok: false, error: result.error ?? '' });
      return;
    }
    const preview = previewAiInvocation(result.prepared);
    const snapshotId = `optimizer-${randomBytes(12).toString('hex')}`;
    this.preparedOptimizerRequests.set(snapshotId, {
      prepared: result.prepared,
      draft,
      sourceRevision,
      consentGeneration,
    });
    this.optimizerState = {
      ...baseState,
      snapshotId,
      previewBody: preview.body,
      previewSha256: preview.sha256,
      previewBytes: preview.utf8Bytes,
    };
    this.postAdviceMessage({
      command: 'optimizePreviewResult',
      ok: true,
      snapshotId,
      contentType: preview.contentType,
      dataMode: preview.dataMode,
      body: preview.body,
      sha256: preview.sha256,
      utf8Bytes: preview.utf8Bytes,
    });
  }

  private async handleSendOptimizerMessage(message: Record<string, unknown>): Promise<void> {
    if (!this.setting<boolean>('advice.optimizer.enabled', false)) {
      this.discardPreparedOptimizer();
      this.postAdviceMessage({ command: 'optimizeResult', error: I18n.t.popup.adviceEffectiveness.strictOutputRejected });
      return;
    }
    const snapshotId = typeof message.snapshotId === 'string' ? message.snapshotId : '';
    const stored = this.preparedOptimizerRequests.get(snapshotId);
    if (
      !stored ||
      !this.onSendOptimizerInvocation ||
      stored.consentGeneration !== this.optimizerConsentGeneration ||
      message.draft !== stored.draft
    ) {
      this.postAdviceMessage({ command: 'optimizeResult', error: I18n.t.popup.adviceEffectiveness.strictOutputRejected });
      return;
    }
    const result = await this.onSendOptimizerInvocation(
      stored.prepared,
      stored.sourceRevision,
      stored.consentGeneration,
    );
    if (
      this.preparedOptimizerRequests.get(snapshotId) !== stored ||
      stored.consentGeneration !== this.optimizerConsentGeneration
    ) {
      this.postAdviceMessage({ command: 'optimizeResult', error: I18n.t.popup.adviceEffectiveness.strictOutputRejected });
      return;
    }
    this.preparedOptimizerRequests.delete(snapshotId);
    if (!result.ok) {
      const error = I18n.t.popup.adviceEffectiveness.strictOutputRejected;
      this.optimizerState = this.optimizerState
        ? { ...this.optimizerState, error }
        : null;
      this.postAdviceMessage({ command: 'optimizeResult', error });
      return;
    }
    this.optimizerState = this.optimizerState
      ? {
          draft: this.optimizerState.draft,
          resolve: this.optimizerState.resolve,
          distil: this.optimizerState.distil,
          aesthetic: this.optimizerState.aesthetic,
          prompt: result.value.prompt,
          settings: result.value.settings,
          adviceId: `advice-optimizer-${randomBytes(12).toString('hex')}`,
        }
      : null;
    this.postAdviceMessage({
      command: 'optimizeResult',
      ...result.value,
      adviceId: this.optimizerState?.adviceId,
      recommendationId: OPTIMIZER_FEEDBACK_RECOMMENDATION_ID,
    });
  }

  private discardPreparedOptimizer(): void {
    this.optimizerConsentGeneration += 1;
    this.preparedOptimizerRequests.clear();
    if (this.optimizerState) {
      const { draft, resolve, distil, aesthetic } = this.optimizerState;
      this.optimizerState = { draft, resolve, distil, aesthetic };
    }
  }

  show(tab?: string): void {
    if (tab) {
      this.currentTab = tab;
      if (tab === 'settings' && this.currentProvider === 'compare') {
        this.currentProvider = this.providerAvailability.claude ? 'claude' : 'codex';
      }
    }
    if (this.panel) {
      this.panel.reveal();
      this.updateWebview();
      return;
    }

    this.panel = vscode.window.createWebviewPanel('claudeCodeUsage', I18n.t.popup.title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.webviewClientReady = false;
      this.pendingDashboardLivePatch = undefined;
      this.scheduledDashboardLivePatch = undefined;
      this.lastLivePatchStructureKey = undefined;
      for (const requestId of [...this.localDataClientActionRequests.keys()]) {
        this.settleLocalDataClientAction(requestId, false);
      }
      this.clearPreparedAdviceSnapshots();
      this.discardPreparedOptimizer();
      this.onAiSurfaceClosed?.();
      // Force a fresh render into the next panel (the lastHtml guard must not
      // suppress the first paint after the panel was closed and reopened).
      this.lastHtml = '';
    });

    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'refresh':
          vscode.commands.executeCommand('claudeCodeUsage.refresh');
          break;
        case 'openSettings':
          vscode.commands.executeCommand('claudeCodeUsage.openSettings');
          break;
        case 'refreshPricing':
          vscode.commands.executeCommand('claudeCodeUsage.refreshPricing');
          break;
        case 'getAdvice':
          vscode.commands.executeCommand('claudeCodeUsage.getAdvice');
          break;
        case 'updateAdviceConsent':
          await this.handleAdviceConsentMessage(message as Record<string, unknown>);
          break;
        case 'prepareAdviceSnapshot':
          this.handlePrepareAdviceSnapshotMessage(message as Record<string, unknown>);
          break;
        case 'sendAdviceSnapshot':
          await this.handleSendAdviceSnapshotMessage(message as Record<string, unknown>);
          break;
        case 'discardAdviceSnapshot': {
          const provider = message.provider;
          if (provider === 'claude' || provider === 'codex') {
            this.clearPreparedAdviceSnapshots(provider);
          }
          break;
        }
        case 'recordAdviceFeedback':
          await this.handleAdviceFeedbackMessage(message as Record<string, unknown>);
          break;
        case 'snoozeAdvice':
          await this.handleAdviceSnoozeMessage(message as Record<string, unknown>);
          break;
        case 'clearAdviceLocalData':
          await this.handleClearAdviceLocalDataMessage();
          break;
        case 'localDataClientReady':
          this.webviewClientReady = true;
          this.onLocalDataClientReady?.();
          break;
        case 'dashboardDataPatchAck': {
          const pending = this.pendingDashboardLivePatch;
          if (
            pending &&
            Number.isSafeInteger(message.revision) &&
            message.revision === pending.revision
          ) {
            if (message.ok === true) {
              this.pendingDashboardLivePatch = undefined;
            } else {
              this.replaceDocumentAfterPatchFailure(pending);
            }
          }
          break;
        }
        case 'sharingTemplateCommandAck': {
          if (Number.isSafeInteger(message.revision)) {
            this.sharingCommandIntents.acknowledge(message.revision);
          }
          break;
        }
        case 'requestLocalDataInventory': {
          const summary = message.clientSummary as Partial<LocalDataClientSummary> | undefined;
          const clientSummary: LocalDataClientSummary = {
            uiPreferenceKeys: Number.isInteger(summary?.uiPreferenceKeys) &&
              Number(summary?.uiPreferenceKeys) >= 0
              ? Number(summary?.uiPreferenceKeys)
              : 0,
            webviewStateFields: Number.isInteger(summary?.webviewStateFields) &&
              Number(summary?.webviewStateFields) >= 0
              ? Number(summary?.webviewStateFields)
              : 0,
            sharingPreferenceKeys: Number.isInteger(summary?.sharingPreferenceKeys) &&
              Number(summary?.sharingPreferenceKeys) >= 0
              ? Number(summary?.sharingPreferenceKeys)
              : 0,
          };
          try {
            const inventory = await this.onRequestLocalDataInventory?.(clientSummary);
            this.panel?.webview.postMessage({
              command: 'localDataInventoryResult',
              ok: inventory !== undefined,
              inventory,
            });
          } catch {
            this.panel?.webview.postMessage({
              command: 'localDataInventoryResult',
              ok: false,
            });
          }
          break;
        }
        case 'runLocalDataAction': {
          if (!isLocalDataAction(message.action) || !this.onRunLocalDataAction) {
            this.panel?.webview.postMessage({
              command: 'localDataActionResult',
              result: { ok: false, message: 'Unsupported local-data action.' },
            });
            break;
          }
          const token = typeof message.quotaScopeToken === 'string'
            ? message.quotaScopeToken
            : undefined;
          try {
            const result = await this.onRunLocalDataAction(message.action, token);
            this.panel?.webview.postMessage({
              command: 'localDataActionResult',
              result,
            });
          } catch {
            this.panel?.webview.postMessage({
              command: 'localDataActionResult',
              result: { ok: false, message: 'The local-data action could not be completed.' },
            });
          }
          break;
        }
        case 'localDataClientActionAck': {
          if (typeof message.requestId === 'string') {
            this.settleLocalDataClientAction(
              message.requestId,
              message.ok === true,
            );
          }
          break;
        }
        case 'exportHeatmap':
          await this.onExportClaudeHeatmap?.();
          break;
        case 'publishHeatmap':
          await this.onPublishClaudeHeatmap?.();
          break;
        case 'sharingTemplateChanged':
          if (
            message.template === 'combinedHeatmap' ||
            message.template === 'claudeShareCard' ||
            message.template === 'claudeHeatmap'
          ) {
            if (this.sharingTemplate !== message.template) {
              this.sharingTemplate = message.template;
              this.updateWebview();
            }
          }
          break;
        case 'previewCombinedHeatmap': {
          if (!this.panel) {
            break;
          }
          try {
            const artifact = this.buildCombinedHeatmapArtifact(
              message.range,
              message.title,
              message.palette,
              message.customAccent,
              message.intensityMode,
            );
            this.panel.webview.postMessage({
              command: 'combinedHeatmapResult',
              svg: artifact.svg,
              markdown: artifact.markdown,
              filename: artifact.filename,
              hasData: artifact.hasData,
            });
          } catch (error) {
            this.panel.webview.postMessage({
              command: 'combinedHeatmapResult',
              error: error instanceof Error ? error.message : String(error),
            });
          }
          break;
        }
        case 'exportCombinedHeatmap': {
          const copy = combinedHeatmapUiCopy(I18n.getLocale());
          let artifact: ReturnType<UsageWebviewProvider['buildCombinedHeatmapArtifact']>;
          try {
            artifact = this.buildCombinedHeatmapArtifact(
              message.range,
              message.title,
              message.palette,
              message.customAccent,
              message.intensityMode,
            );
          } catch (error) {
            vscode.window.showErrorMessage(`Combined heatmap export failed: ${error instanceof Error ? error.message : String(error)}`);
            break;
          }
          if (!artifact.hasData) {
            vscode.window.showWarningMessage(copy.noData);
            break;
          }
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(os.homedir(), artifact.filename)),
            filters: { 'SVG image': ['svg'] },
            saveLabel: copy.exportSvg.replace('…', ''),
          });
          if (!uri) {
            break;
          }
          try {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(artifact.svg, 'utf8'));
            vscode.window.showInformationMessage(`Combined activity SVG exported: ${path.basename(uri.fsPath)}`);
          } catch (error) {
            vscode.window.showErrorMessage(`Combined heatmap export failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          break;
        }
        case 'copyCombinedHeatmapMarkdown': {
          try {
            const artifact = this.buildCombinedHeatmapArtifact(
              message.range,
              message.title,
              message.palette,
              message.customAccent,
              message.intensityMode,
            );
            await vscode.env.clipboard.writeText(artifact.markdown);
            this.panel?.webview.postMessage({ command: 'combinedHeatmapMarkdownCopied', ok: true });
          } catch (error) {
            this.panel?.webview.postMessage({
              command: 'combinedHeatmapMarkdownCopied',
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          break;
        }
        case 'buildShareCard': {
          // Preview is a pure local render using only the indexed usage data.
          if (this.panel && this.allRecords && this.allRecords.length > 0) {
            try {
              const range = String(message.range || 'last30');
              const scope = String(message.scope || 'all');
              const sections = (message.sections || {}) as Record<string, boolean>;
              const theme = (message.theme as ShareCardTheme) || 'claudeClassic';
              const svg = this.buildShareCardSvgFor(range, scope, sections as Partial<ShareSections>, {
                fullNumbers: !!message.fullNumbers,
                theme,
              });
              // Remember it so a re-render restores the preview + picks.
              this.shareCardPreviewCache = {
                records: this.allRecords,
                day: dayKeyInZone(new Date(), I18n.getTimezone()),
                timeZone: I18n.getTimezone(),
                locale: I18n.getLocale(),
                themeKind: vscode.window.activeColorTheme?.kind,
                svg,
              };
              this.lastShareCardConfig = {
                range,
                scope,
                sections,
                fullNumbers: !!message.fullNumbers,
                theme,
              };
              this.panel.webview.postMessage({ command: 'shareCardResult', svg });
            } catch (e) {
              this.panel.webview.postMessage({ command: 'shareCardResult', error: (e as Error).message });
            }
          }
          break;
        }
        case 'exportShareCard': {
          // Local export uses only already-indexed usage and the chosen config.
          if (!this.allRecords || this.allRecords.length === 0) {
            vscode.window.showWarningMessage(I18n.t.popup.noDataMessage);
            break;
          }
          const range = String(message.range || 'last30');
          const svg = this.buildShareCardSvgFor(range, String(message.scope || 'all'), (message.sections || {}) as Partial<ShareSections>, {
            fullNumbers: !!message.fullNumbers,
            theme: (message.theme as ShareCardTheme) || 'claudeClassic',
          });
          const defaultName = shareCardFilename(range).replace(/\.png$/, '.svg');
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(os.homedir(), defaultName)),
            filters: { 'SVG image': ['svg'] },
            saveLabel: 'Export share card',
          });
          if (!uri) {
            break;
          }
          try {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(svg, 'utf8'));
            const open = 'Open';
            const pick = await vscode.window.showInformationMessage('Usage share card exported.', open);
            if (pick === open) {
              await vscode.commands.executeCommand('vscode.open', uri);
            }
          } catch (e) {
            vscode.window.showErrorMessage(`Share card export failed: ${(e as Error).message}`);
          }
          break;
        }
        case 'setDashboardAutoRefresh':
          // Persist the in-dashboard toggle so it survives reload. Lives in the
          // dashboard-managed store now (no longer in VS Code Settings).
          await this.settings?.set('dashboardAutoRefresh', !!message.value);
          break;
        case 'tabChanged':
          this.currentTab = message.tab;
          break;
        case 'providerChanged': {
          const requested = String(message.provider ?? '');
          const allowed =
            (requested === 'claude' &&
              (this.providerAvailability.claude || message.tab === 'settings')) ||
            (requested === 'codex' && this.providerAvailability.codex) ||
            (requested === 'compare' &&
              this.providerAvailability.claude &&
              this.providerAvailability.codexData);
          if (allowed) {
            this.currentProvider = requested as 'claude' | 'codex' | 'compare';
            const sharedTabs = ['today', 'month', 'all', 'sessions', 'projects', 'content', 'settings'];
            const allowedTabs = requested === 'claude'
              ? [...sharedTabs, 'branches', 'workflows']
              : sharedTabs;
            if (typeof message.tab === 'string' && allowedTabs.includes(message.tab)) {
              this.currentTab = message.tab;
            } else if (requested === 'codex' && !allowedTabs.includes(this.currentTab)) {
              this.currentTab = 'today';
            }
            this.updateWebview();
          }
          break;
        }
        case 'resumeSession': {
          // Resume a past session via the official extension, or a terminal fallback.
          const sessionId = message.sessionId;
          if (!isValidSessionId(sessionId)) {
            vscode.window.showWarningMessage(I18n.t.popup.resumeInvalid);
            break;
          }
          const rawCwd = typeof message.cwd === 'string' ? message.cwd : '';
          const cwd = isUsableCwd(rawCwd) ? rawCwd : undefined;
          // The official in-tab view only opens sessions from this project; others
          // go via terminal. A session whose log had no cwd carries the dash-
          // encoded folder name (e.g. "-Users-ozn-dev-ccp"), so match that too.
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          const sameProject = !!ws && (isUnderDir(rawCwd, ws) || rawCwd === ws.replace(/[/\\]/g, '-'));
          const official = vscode.extensions.getExtension('anthropic.claude-code');
          if (official && sameProject) {
            try {
              if (!official.isActive) { await official.activate(); }
              await vscode.commands.executeCommand('claude-vscode.editor.open', sessionId);
              break;
            } catch {
              // Fall back to the terminal if the command shape changed.
            }
          }
          const term = vscode.window.createTerminal({ name: 'Claude Resume', cwd });
          term.show();
          term.sendText(buildResumeCommand(sessionId) as string);
          break;
        }
        case 'deleteSession': {
          // Delete a session's log (modal confirm, routed to OS trash).
          const sessionId = message.sessionId;
          if (!isValidSessionId(sessionId)) {
            vscode.window.showWarningMessage(I18n.t.popup.resumeInvalid);
            break;
          }
          const name = String(message.title || sessionId);
          const yes = I18n.t.popup.deleteSessionYes;
          const pick = await vscode.window.showWarningMessage(
            I18n.t.popup.deleteSessionConfirm.replace('{name}', name),
            { modal: true, detail: I18n.t.popup.deleteSessionDetail },
            yes
          );
          if (pick !== yes) { break; }
          const { ClaudeDataLoader } = await import('./dataLoader');
          const targets = await ClaudeDataLoader.findSessionFiles(sessionId, this.dataDirectory);
          let deleted = 0;
          for (const f of targets) {
            try {
              await vscode.workspace.fs.delete(vscode.Uri.file(f), { recursive: true, useTrash: true });
              deleted++;
            } catch { /* skip what we can't remove */ }
          }
          // Always force a fresh reload so the row drops — whether files were
          // removed now or it was already gone (stale row from an earlier
          // delete). refresh -> refreshData(true) re-reads disk regardless of
          // mtimes, so the session disappears either way.
          vscode.commands.executeCommand('claudeCodeUsage.refresh');
          if (deleted > 0) {
            vscode.window.showInformationMessage(I18n.t.popup.deleteSessionDone.replace('{name}', name));
          } else {
            vscode.window.showWarningMessage(I18n.t.popup.deleteSessionNotFound);
          }
          break;
        }
        case 'viewConversation': {
          // Read-only: read the session .jsonl, parse it, open a viewer panel.
          const sessionId = message.sessionId;
          if (!isValidSessionId(sessionId)) {
            vscode.window.showWarningMessage(I18n.t.popup.resumeInvalid);
            break;
          }
          await this.openConversationViewer(sessionId, String(message.title || sessionId));
          break;
        }
        case 'updateSetting':
          if (this.settings && typeof message.key === 'string') {
            await this.settings.set(message.key, message.value);
            if (
              message.key === 'enableShareCard' &&
              this.settings.get<boolean>('enableShareCard') === false
            ) {
              this.sharingWorkspaceRequested = false;
            }
            // Re-apply config. Pass the key so status-bar-only toggles skip the
            // dashboard reload (which flickers); globalState changes don't fire
            // onDidChangeConfiguration, so this callback is the only signal.
            this.onSettingsChanged?.(message.key);
          }
          break;
        case 'resetSetting':
          if (this.settings && typeof message.key === 'string') {
            await this.settings.reset(message.key);
            // Reset re-renders fully so the control visually reverts to default.
            this.onSettingsChanged?.();
          }
          break;
        case 'resetAllSettings':
          if (this.settings) {
            const requested = Array.isArray(message.keys)
              ? new Set(message.keys.filter((key: unknown) => typeof key === 'string'))
              : null;
            for (const d of SETTINGS) {
              if (requested && !requested.has(d.key)) {
                continue;
              }
              await this.settings.reset(d.key);
            }
            this.onSettingsChanged?.();
          }
          break;
        case 'dismissQuotaWarn':
          this.quotaWarnDismissed = true;
          this.updateWebview();
          break;
        case 'optimizePrompt': {
          if (!this.panel) {
            break;
          }
          await this.handlePrepareOptimizerMessage(message as Record<string, unknown>);
          break;
        }
        case 'sendOptimizerRequest': {
          await this.handleSendOptimizerMessage(message as Record<string, unknown>);
          break;
        }
        case 'discardOptimizerRequest': {
          this.discardPreparedOptimizer();
          break;
        }
        case 'getAttribution': {
          // Recompute the attribution panel for a new scope (Day / Week /
          // Month / one session / one project) and push the rendered HTML.
          if (this.panel && message.scope) {
            const attr = ClaudeDataLoader.getUsageAttribution(
              this.allRecords,
              this.contentAnalysis,
              message.scope as AttributionScope
            );
            this.panel.webview.postMessage({
              command: 'attributionResponse',
              html: this.renderAttributionPanel(attr),
            });
          }
          break;
        }
        case 'getDailyData': {
          const monthString = typeof message.month === 'string' ? message.month : '';
          const requestedProvider = message.provider === 'codex' || message.provider === 'claude'
            ? message.provider
            : '';
          // Claude's materialized all-time month rows use YYYY-MM-01, while
          // Codex rows use YYYY-MM. Keep the response key unchanged so the
          // matching detail row can consume it after the host round-trip.
          const validMonth = requestedProvider === 'claude'
            ? /^\d{4}-\d{2}(?:-01)?$/.test(monthString)
            : /^\d{4}-\d{2}$/.test(monthString);
          if (!validMonth || !this.panel || requestedProvider !== this.currentProvider) {
            break;
          }
          if (requestedProvider === 'codex') {
            const dailyRows = (this.codexView?.allTimeDaily ?? [])
              .filter((row) => row.day.startsWith(monthString + '-'))
              .sort((left, right) => left.day.localeCompare(right.day));
            await this.panel.webview.postMessage({
              command: 'dailyDataResponse',
              provider: 'codex',
              month: monthString,
              html: this.renderCodexMonthDailyDetail(monthString, dailyRows),
            });
            break;
          }
          const monthKey = monthString.slice(0, 7);
          const dailyData = this.dailyDataForEveryDay
            .filter((row) => row.date.startsWith(`${monthKey}-`))
            .sort((left, right) => left.date.localeCompare(right.date));
          await this.panel.webview.postMessage({
            command: 'dailyDataResponse',
            provider: 'claude',
            month: monthString,
            data: dailyData,
          });
          break;
        }
      }
    });

    this.updateWebview();
  }

  /** Compatibility commands enter the same preview-first workspace instead of
   * bypassing it with an immediate picker or network flow. */
  public showSharingWorkspace(template: SharingTemplate): void {
    if (!this.allRecords || this.allRecords.length === 0) {
      void vscode.window.showWarningMessage(I18n.t.popup.noDataMessage);
      return;
    }
    this.sharingTemplate = template;
    this.sharingWorkspaceRequested = true;
    this.sharingCommandIntents.issue(template);
    this.currentTab = 'all';
    this.currentProvider = this.providerAvailability.claude && this.providerAvailability.codexData
      ? 'compare'
      : 'claude';
    this.show();
  }

  updateData(
    sessionData: SessionData | null,
    todayData: UsageData | null,
    rolling30DayData: UsageData | null,
    allTimeData: UsageData | null,
    dailyDataForRolling30Days: { date: string; data: UsageData }[] = [],
    dailyDataForAllTime: { date: string; data: UsageData }[] = [],
    hourlyDataForToday: { hour: string; data: UsageData }[] = [],
    error?: string,
    dataDirectory?: string | null,
    allRecords?: any[],
    sessionBreakdown: SessionUsage[] = [],
    projectBreakdown: ProjectGroup[] = [],
    contentAnalysis: ContentAnalysis | null = null,
    branchBreakdown: BranchUsage[] = [],
    workflowBreakdown: WorkflowUsage[] = [],
    costliestMessages: CostlyMessage[] = [],
    hourlyDataForRolling30DaysByDay: Record<
      string,
      { hour: string; data: UsageData }[]
    > = {},
    projectUsageMatrix: ProjectUsageMatrixSnapshot | null = null,
    dailyDataForEveryDay: { date: string; data: UsageData }[] = [],
  ): void {
    this.currentSessionData = sessionData;
    this.todayData = todayData;
    this.rolling30DayData = rolling30DayData;
    this.allTimeData = allTimeData;
    this.dailyDataForRolling30Days = dailyDataForRolling30Days;
    this.dailyDataForAllTime = dailyDataForAllTime;
    if (this.dailyDataForEveryDay !== dailyDataForEveryDay) {
      this.invalidateSharingCaches();
    }
    this.dailyDataForEveryDay = dailyDataForEveryDay;
    this.hourlyDataForToday = hourlyDataForToday;
    this.hourlyDataForRolling30DaysByDay = hourlyDataForRolling30DaysByDay;
    this.error = error || null;
    this.dataDirectory = dataDirectory || null;
    this.isLoading = false;
    if (allRecords) {
      if (this.allRecords !== allRecords) {
        this.invalidateSharingCaches();
      }
      this.allRecords = allRecords;
    }
    this.sessionBreakdown = sessionBreakdown;
    this.projectBreakdown = projectBreakdown;
    this.claudeProjectUsageMatrix = projectUsageMatrix;
    this.contentAnalysis = contentAnalysis;
    this.branchBreakdown = branchBreakdown;
    this.workflowBreakdown = workflowBreakdown;
    this.costliestMessages = costliestMessages;
    this.providerAvailability.claude = Boolean(
      sessionData || todayData || rolling30DayData || allTimeData,
    );

    if (this.panel) {
      this.updateWebview();
    }
  }

  updateProviderData(
    codexView: CodexUsageView | null,
    insights: CodexScopedInsights,
    providerAvailability: {
      claude: boolean;
      codex: boolean;
      codexData?: boolean;
      codexLoading?: boolean;
      codexProgress?: CodexRenderProgress | null;
    },
  ): void {
    this.codexView = codexView;
    this.codexInsights = codexView ? insights : emptyCodexScopedInsights();
    this.codexLoading = providerAvailability.codexLoading ?? false;
    this.codexProgress = providerAvailability.codexProgress ?? null;
    this.providerAvailability = {
      claude: providerAvailability.claude,
      codex: providerAvailability.codex,
      codexData: providerAvailability.codexData ?? providerAvailability.codex,
    };
    this.scheduleAdviceComparisonProduction();
    if (!this.providerSelectionInitialized) {
      this.currentProvider = defaultDashboardProvider(
        providerAvailability.claude,
        providerAvailability.codex,
      );
      this.providerSelectionInitialized = true;
    } else if (
      (this.currentProvider === 'claude' && !providerAvailability.claude) ||
      (this.currentProvider === 'codex' && !providerAvailability.codex) ||
      (this.currentProvider === 'compare' &&
        (!providerAvailability.claude || !this.providerAvailability.codexData))
    ) {
      this.currentProvider = defaultDashboardProvider(
        providerAvailability.claude,
        providerAvailability.codex,
      );
    }
    if (this.panel) {
      this.updateWebview();
    }
  }

  updateCodexProgress(progress: CodexRenderProgress): void {
    this.codexProgress = progress;
    if (this.panel && this.currentProvider === 'codex') {
      void this.panel.webview.postMessage({
        command: 'codexIndexProgress',
        text: this.codexProgressText(progress),
      });
    }
  }

  /**
   * Receive privacy-reviewed provider contracts from the extension host. This
   * deliberately does not trigger a render: syncProviderUi immediately follows
   * it with updateProviderData, so one data refresh still produces one paint.
   */
  updateAdviceEffectivenessData(states: AdviceEffectivenessProviderStates): void {
    for (const provider of ['claude', 'codex'] as const) {
      const previous = this.adviceEffectivenessStates[provider];
      const next = states[provider];
      if (!previous || !next) {
        this.clearPreparedAdviceSnapshots(provider);
        continue;
      }
      const unchanged =
        this.adviceSourceRevision(previous) === this.adviceSourceRevision(next);
      if (!unchanged) {
        this.clearPreparedAdviceSnapshots(provider);
        continue;
      }
      // Keep a strictly parsed remote recommendation across ordinary refreshes
      // of the same materialized source revision. Evidence remains host-owned.
      if (previous.contract.provenance.generatedBy.kind === 'remote-model') {
        next.contract = previous.contract;
      }
    }
    this.adviceEffectivenessStates = states;
  }

  invalidatePreparedAiRequests(): void {
    this.adviceConsentGeneration += 1;
    this.clearPreparedAdviceSnapshots();
    this.discardPreparedOptimizer();
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
    if (this.panel) {
      this.updateWebview();
    }
  }

  /** Receive quota utilisation (decoupled from local data; see extension.ts). */
  updateQuota(usageLimits: ClaudeApiUsageResponse | null): void {
    if (!usageLimits) {
      return;
    }
    const changed = JSON.stringify(usageLimits) !== JSON.stringify(this.usageLimits);
    this.usageLimits = usageLimits;
    // Re-render only on change so the cheap quota poll doesn't redraw the
    // dashboard (and reset scroll position) every tick.
    if (changed && this.panel && !this.isLoading) {
      this.updateWebview();
    }
  }

  /** Sanitized weekly quota observations, persisted per Claude profile by the
   * extension host. No OAuth data or account identity enters the webview. */
  updateWeeklyQuotaHistory(history: WeeklyQuotaObservation[]): void {
    const changed = JSON.stringify(history) !== JSON.stringify(this.claudeWeeklyQuotaHistory);
    this.claudeWeeklyQuotaHistory = history.map((item) => ({ ...item }));
    if (changed && this.panel && !this.isLoading) {
      this.updateWebview();
    }
  }

  /** Quota-guard banner: warns before starting a workflow run on a nearly
   * exhausted 5-hour window. Threshold via workflowQuotaWarnPercent (0 = off);
   * dismissible per window-session. Status bar stays untouched. */
  private renderQuotaBanner(provider: SettingProvider = 'claude'): string {
    if (provider === 'codex') {
      return '';
    }
    if (this.quotaWarnDismissed) {
      return '';
    }
    const warnPercent = this.setting<number>('workflowQuotaWarnPercent', 50);
    // Via the normalizer, so this keeps working on either payload generation.
    const session = normalizeQuotaWindows(this.usageLimits).find((w) => w.kind === 'session');
    if (!warnPercent || warnPercent <= 0 || !session) {
      return '';
    }
    // An already-reset window means a fresh quota — never warn on stale data.
    const resetsAt = Date.parse(session.resetsAt);
    if (!isNaN(resetsAt) && resetsAt <= Date.now()) {
      return '';
    }
    const remaining = Math.max(0, Math.round(100 - session.utilization));
    if (remaining >= warnPercent) {
      return '';
    }
    const text = I18n.t.popup.quotaWarnBanner.replace('{remaining}', String(remaining));
    return (
      '<div class="quota-banner">' +
      '<span class="quota-banner-text">⚠ ' + this.escapeHtml(text) + '</span>' +
      '<button class="quota-banner-dismiss" title="' + this.escapeHtml(I18n.t.popup.dismiss) +
      '" onclick="dismissQuotaWarn()">✕</button>' +
      '</div>'
    );
  }

  // Last HTML pushed to the webview. Assigning panel.webview.html triggers a
  // full reload (re-parse + re-run the inline script + reset scroll), which is
  // the heaviest recurring cost during active sessions. Skip it when the render
  // is byte-identical — nothing visible would change anyway.
  private lastHtml: string = '';

  private dashboardLivePatchFor(html: string): DashboardLivePatch | undefined {
    if (this.currentProvider === 'compare') return undefined;
    const panelHtml = markedContent(html, LIVE_PATCH_PANEL_START, LIVE_PATCH_PANEL_END);
    if (panelHtml === undefined) return undefined;
    const panelNeutral = replaceMarkedContent(
      html,
      LIVE_PATCH_PANEL_START,
      LIVE_PATCH_PANEL_END,
      '<provider-panel-data>',
    );
    if (panelNeutral === undefined) return undefined;
    const structureHtml = replaceMarkedContent(
      panelNeutral,
      LIVE_PATCH_HOURS_START,
      LIVE_PATCH_HOURS_END,
      '<claude-hour-data>',
    );
    if (structureHtml === undefined) return undefined;
    return {
      provider: this.currentProvider,
      tab: this.currentTab,
      panelHtml,
      structureKey: createHash('sha256').update(structureHtml, 'utf8').digest('hex'),
      claudeLast30HoursByDay: claudeHourlyDisplayDto(
        this.hourlyDataForRolling30DaysByDay,
      ),
      adviceSnapshotIds: this.activeAdviceSnapshotIds(),
    };
  }

  private replaceDocumentAfterPatchFailure(pending: PendingDashboardLivePatch): void {
    if (!this.panel || this.pendingDashboardLivePatch?.revision !== pending.revision) return;
    const fallback = this.scheduledDashboardLivePatch ?? pending;
    this.pendingDashboardLivePatch = undefined;
    this.scheduledDashboardLivePatch = undefined;
    this.webviewClientReady = false;
    this.lastHtml = fallback.documentHtml;
    this.lastLivePatchStructureKey = fallback.structureKey;
    this.panel.webview.html = fallback.documentHtml;
  }

  private scheduleDashboardLivePatch(pending: PendingDashboardLivePatch): void {
    this.scheduledDashboardLivePatch = pending;
    if (this.dashboardLivePatchSendScheduled) return;
    this.dashboardLivePatchSendScheduled = true;
    queueMicrotask(() => {
      this.dashboardLivePatchSendScheduled = false;
      const latest = this.scheduledDashboardLivePatch;
      this.scheduledDashboardLivePatch = undefined;
      if (
        !latest ||
        !this.panel ||
        !this.webviewClientReady ||
        this.lastHtml !== latest.documentHtml
      ) {
        return;
      }
      const panel = this.panel;
      this.pendingDashboardLivePatch = latest;
      void Promise.resolve(panel.webview.postMessage({
        command: 'dashboardDataPatch',
        provider: latest.provider,
        tab: latest.tab,
        revision: latest.revision,
        html: latest.panelHtml,
        claudeLast30HoursByDay: latest.claudeLast30HoursByDay,
        adviceSnapshotIds: latest.adviceSnapshotIds,
      })).then((delivered) => {
        if (delivered === false) {
          this.replaceDocumentAfterPatchFailure(latest);
        }
      }, () => {
        this.replaceDocumentAfterPatchFailure(latest);
      });
    });
  }

  private updateWebview(): void {
    if (!this.panel) return;
    const html = this.getWebviewContent();
    if (html === this.lastHtml) {
      return;
    }
    const nextPatch = this.dashboardLivePatchFor(html);
    if (
      this.webviewClientReady &&
      nextPatch &&
      nextPatch.structureKey === this.lastLivePatchStructureKey
    ) {
      const pending: PendingDashboardLivePatch = {
        ...nextPatch,
        documentHtml: html,
        revision: ++this.dashboardLivePatchRevision,
      };
      this.lastHtml = html;
      this.lastLivePatchStructureKey = nextPatch.structureKey;
      this.scheduleDashboardLivePatch(pending);
      return;
    }
    this.pendingDashboardLivePatch = undefined;
    this.scheduledDashboardLivePatch = undefined;
    this.webviewClientReady = false;
    this.lastHtml = html;
    this.lastLivePatchStructureKey = nextPatch?.structureKey;
    this.panel.webview.html = html;
  }

  private getWebviewContent(): string {
    // Data/privacy controls must remain reachable even when neither provider
    // has logs yet or a refresh is in progress.
    if (this.currentTab === 'settings' && this.currentProvider !== 'compare') {
      return this.getMainContent();
    }
    if (this.isLoading) {
      return this.getLoadingContent();
    }

    if (this.error && !this.providerAvailability.codex) {
      return this.getErrorContent();
    }

    if (
      !this.currentSessionData &&
      !this.todayData &&
      !this.rolling30DayData &&
      !this.providerAvailability.codex
    ) {
      return this.getNoDataContent();
    }

    return this.getMainContent();
  }

  private getLoadingContent(): string {
    return `
      <!DOCTYPE html>
      <html lang="${this.escapeHtml(I18n.getLocale())}">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
        <title>${I18n.t.popup.title}</title>
        <style>${this.getStyles()}</style>
      </head>
      <body>
        <div class="container">
          <div class="loading" role="status" aria-live="polite">
            <div class="spinner"></div>
            <p>${I18n.t.statusBar.loading}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getErrorContent(): string {
    return `
      <!DOCTYPE html>
      <html lang="${this.escapeHtml(I18n.getLocale())}">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
        <title>${I18n.t.popup.title}</title>
        <style>${this.getStyles()}</style>
      </head>
      <body>
        <div class="container">
          <div class="error" role="alert">
            <h2>${I18n.t.statusBar.error}</h2>
            <p>${this.error}</p>
            <button onclick="refresh()">${I18n.t.popup.refresh}</button>
          </div>
        </div>
        <script>${this.getScript()}</script>
      </body>
      </html>
    `;
  }

  private getNoDataContent(): string {
    return `
      <!DOCTYPE html>
      <html lang="${this.escapeHtml(I18n.getLocale())}">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
        <title>${I18n.t.popup.title}</title>
        <style>${this.getStyles()}</style>
      </head>
      <body>
        <div class="container">
          <div class="no-data" role="status" aria-live="polite">
            <h2>${I18n.t.statusBar.noData}</h2>
            <p>${I18n.t.popup.noDataMessage}</p>
            <div class="actions">
              <button onclick="refresh()">${I18n.t.popup.refresh}</button>
              <button onclick="openSettings()">${I18n.t.popup.settings}</button>
            </div>
          </div>
        </div>
        <script>${this.getScript()}</script>
      </body>
      </html>
    `;
  }

  private renderProviderTabs(): string {
    const button = (
      provider: 'claude' | 'codex' | 'compare',
      label: string,
    ): string => {
      const selected = this.currentProvider === provider;
      return `<button id="provider-tab-${provider}" class="provider-tab ${selected ? 'active' : ''}" role="tab" data-provider-target="${provider}" aria-controls="provider-panel" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}">${this.escapeHtml(label)}</button>`;
    };
    let html = `<nav class="provider-tabs" role="tablist" aria-label="${this.escapeHtml(I18n.t.popup.settingsGroupProviders)}">`;
    const labels = I18n.t.providers;
    if (this.providerAvailability.claude) {
      html += button('claude', labels.claude);
    }
    if (this.providerAvailability.codex) {
      html += button('codex', labels.codexBeta);
    }
    if (this.providerAvailability.claude && this.providerAvailability.codexData) {
      html += button('compare', labels.compare);
    }
    return html + '</nav>';
  }

  private buildCombinedHeatmapArtifact(
    rangeInput: unknown,
    titleInput: unknown,
    paletteInput: unknown = 'academicViolet',
    customAccentInput: unknown = '#4f2f87',
    intensityModeInput: unknown = 'quantile',
  ): {
    range: CombinedHeatmapRange;
    title: string;
    endDateISO: string;
    filename: string;
    markdown: string;
    svg: string;
    hasData: boolean;
  } {
    const copy = combinedHeatmapUiCopy(I18n.getLocale());
    const range = normalizeCombinedHeatmapRange(rangeInput);
    const title = sanitizeCombinedHeatmapTitle(titleInput, copy.defaultTitle);
    const palette = normalizeCombinedHeatmapPalette(paletteInput);
    const customAccent = normalizeCombinedHeatmapAccent(customAccentInput);
    const intensityMode = normalizeCombinedHeatmapIntensityMode(intensityModeInput);
    const timeZone = I18n.getTimezone();
    const endDateISO = dayKeyInZone(new Date(), timeZone);
    if (!endDateISO) {
      throw new Error('Could not resolve the configured timezone date.');
    }
    const claudeDaily = this.getClaudeDailyUsageMap(timeZone);
    const daily = mergeCombinedDailyUsage(
      claudeDailyPointsFromUsage(claudeDaily),
      codexDailyPointsFromUsage(this.codexView?.daily ?? []),
    );
    const selected = selectCombinedHeatmapWindow(daily, range, endDateISO);
    const filename = combinedHeatmapFilename(range, endDateISO);
    return {
      range,
      title,
      endDateISO,
      filename,
      markdown: combinedHeatmapMarkdown(filename, title),
      svg: renderCombinedHeatmapSvg(daily, {
        range,
        endDateISO,
        title,
        locale: I18n.getLocale(),
        palette,
        customAccent,
        intensityMode,
        labels: {
          combined: copy.combinedLabel,
          processedTokens: copy.processedTokensLabel,
          footerNote: copy.svgFooterNote,
        },
      }),
      hasData: selected.totals.combinedProcessed > 0,
    };
  }

  private renderSharingWorkspace(): string {
    const copy = combinedHeatmapUiCopy(I18n.getLocale());
    const workspaceCopy = I18n.sharingWorkspace;
    const combinedAvailable = this.providerAvailability.claude && this.providerAvailability.codexData;
    const selected: SharingTemplate = this.sharingTemplate === 'combinedHeatmap' && !combinedAvailable
      ? 'claudeShareCard'
      : this.sharingTemplate;
    this.sharingTemplate = selected;
    const selectedOption = (template: SharingTemplate): string => template === selected ? ' selected' : '';
    const presentationState = (template: SharingTemplate): string =>
      ' data-sharing-presentation="' + template + '"' + (template === selected ? '' : ' hidden');
    const artifact = selected === 'combinedHeatmap'
      ? this.buildCombinedHeatmapArtifact('year', copy.defaultTitle)
      : undefined;
    const preview = artifact
      ? (artifact.hasData
          ? artifact.svg
          : '<p class="table-hint">' + this.escapeHtml(copy.noData) + '</p>')
      : '';
    const paletteChoice = (
      value: string,
      label: string,
      colors: string[],
      checked = false,
    ): string => '<label class="combined-palette-choice">' +
      '<input type="radio" name="combinedHeatmapPalette" value="' + value + '"' + (checked ? ' checked' : '') +
      ' onchange="toggleCombinedCustomAccent()">' +
      '<span class="combined-palette-swatch" aria-hidden="true">' +
      colors.map((color) => '<i style="background:' + color + '"></i>').join('') + '</span>' +
      '<span>' + this.escapeHtml(label) + '</span></label>';
    const palettes =
      paletteChoice('academicViolet', copy.academicViolet, ['#eee8f8', '#bca5e6', '#8668c7', '#4f2f87'], true) +
      paletteChoice('claudeOrange', copy.claudeOrange, ['#fff1e8', '#fadcc9', '#e07d4f', '#c85a2b']) +
      paletteChoice('codexBlue', copy.codexBlue, ['#eff6ff', '#93c5fd', '#3b82f6', '#1d4ed8']) +
      paletteChoice('githubGreen', copy.githubGreen, ['#dafbe1', '#6fdd8b', '#2da44e', '#116329']) +
      paletteChoice('custom', copy.customPalette, ['#eee8f8', '#bca5e6', '#8668c7', '#4f2f87']);
    const combinedPresentation = artifact ? '<section class="sharing-presentation combined-sharing-presentation"' +
      presentationState('combinedHeatmap') + ' aria-labelledby="combinedPresentationHeading">' +
      '<h3 id="combinedPresentationHeading" class="sharing-presentation-title">' +
      this.escapeHtml(workspaceCopy.combinedPresentation) + '</h3>' +
      '<p class="sharing-presentation-description">' +
      this.escapeHtml(workspaceCopy.combinedPresentationDescription) + '</p>' +
      '<div class="combined-share-layout">' +
      '<div class="combined-preview-column">' +
      '<div class="combined-preview-toolbar"><strong>' + this.escapeHtml(copy.previewLabel) + '</strong>' +
      '<span id="combinedHeatmapStatus" role="status" aria-live="polite"></span></div>' +
      '<div id="combinedHeatmapPreview" class="heatmap-svg combined-heatmap-preview" role="region" tabindex="0" aria-label="' + this.escapeHtml(copy.previewLabel) + '">' + preview + '</div>' +
      '<p class="combined-activity-disclaimer">' + this.escapeHtml(copy.activityDisclaimer) + '</p>' +
      '</div>' +
      '<div class="combined-config-card sharing-controls-panel" aria-label="' + this.escapeHtml(copy.settingsLabel) + '">' +
      '<h4>' + this.escapeHtml(copy.settingsLabel) + '</h4>' +
      '<div class="combined-heatmap-controls">' +
      '<label class="sc-field" for="combinedHeatmapTitle"><span>' + this.escapeHtml(copy.titleLabel) + '</span>' +
      '<input type="text" id="combinedHeatmapTitle" maxlength="80" value="' + this.escapeHtml(artifact.title) + '" data-default-value="' + this.escapeHtml(artifact.title) + '"></label>' +
      '<label class="sc-field" for="combinedHeatmapRange"><span>' + this.escapeHtml(copy.rangeLabel) + '</span>' +
      '<select id="combinedHeatmapRange" data-default-value="year">' +
      '<option value="30d">' + this.escapeHtml(copy.last30) + '</option>' +
      '<option value="90d">' + this.escapeHtml(copy.last90) + '</option>' +
      '<option value="year" selected>' + this.escapeHtml(copy.year) + '</option>' +
      '</select></label>' +
      '<label class="sc-field" for="combinedHeatmapIntensityMode"><span>' + this.escapeHtml(copy.intensityLabel) + '</span>' +
      '<select id="combinedHeatmapIntensityMode" data-default-value="quantile">' +
      '<option value="quantile" selected>' + this.escapeHtml(copy.intensityQuantile) + '</option>' +
      '<option value="logarithmic">' + this.escapeHtml(copy.intensityLogarithmic) + '</option>' +
      '<option value="linear">' + this.escapeHtml(copy.intensityLinear) + '</option>' +
      '</select></label></div>' +
      '<fieldset class="combined-palette-fieldset"><legend>' + this.escapeHtml(copy.paletteLabel) + '</legend>' +
      '<div class="combined-palette-options">' + palettes + '</div>' +
      '<label class="combined-custom-accent" for="combinedHeatmapCustomAccent"><span>' + this.escapeHtml(copy.customAccent) + '</span>' +
      '<input type="color" id="combinedHeatmapCustomAccent" value="#4f2f87" disabled></label></fieldset>' +
      '<label class="sc-check combined-privacy-toggle"><input type="checkbox" id="combinedHeatmapPrivacy" checked onchange="toggleCombinedHeatmapPrivacy(true)"> ' +
      this.escapeHtml(copy.privacyToggle) + '</label>' +
      '<div id="combinedHeatmapPrivacyPreview" class="combined-privacy-preview" role="note">' +
      '<p>✓ ' + this.escapeHtml(copy.privacyIncludes) + '</p>' +
      '<p>✓ ' + this.escapeHtml(copy.privacyExcludes) + '</p></div>' +
      '<div class="share-actions combined-share-actions">' +
      '<button class="btn-primary btn-small" onclick="generateCombinedHeatmapPreview()">' + this.escapeHtml(copy.updatePreview) + '</button>' +
      '<button class="btn-secondary btn-small" onclick="exportCombinedHeatmap()">' + this.escapeHtml(copy.exportSvg) + '</button>' +
      '<button class="btn-secondary btn-small" onclick="copyCombinedHeatmapMarkdown()">' + this.escapeHtml(copy.copyMarkdown) + '</button>' +
      '<button class="btn-secondary btn-small" onclick="resetCombinedHeatmapPreferences()">' + this.escapeHtml(copy.resetSharing) + '</button></div>' +
      '</div></div>' +
      '<details class="combined-output-panel"><summary>' + this.escapeHtml(copy.markdownLabel) + '</summary>' +
      '<textarea id="combinedHeatmapMarkdown" class="combined-markdown" rows="2" readonly aria-label="' + this.escapeHtml(copy.markdownLabel) + '">' + this.escapeHtml(artifact.markdown) + '</textarea>' +
      '</details></section>' : this.renderSharingPresentationPlaceholder(
        'combinedHeatmap',
        workspaceCopy.combinedPresentation,
        workspaceCopy.combinedPresentationDescription,
      );

    const combinedOption = '<option value="combinedHeatmap"' +
      selectedOption('combinedHeatmap') + (combinedAvailable ? '' : ' disabled') + '>' +
      this.escapeHtml(workspaceCopy.combinedPresentation +
        (combinedAvailable ? '' : ' — ' + workspaceCopy.combinedUnavailable)) + '</option>';

    return '<section class="heatmap-panel combined-heatmap-panel sharing-workspace" aria-labelledby="sharingWorkspaceHeading">' +
      '<header class="combined-share-header"><div>' +
      '<span class="combined-share-eyebrow">' + this.escapeHtml(workspaceCopy.eyebrow) + '</span>' +
      '<h2 id="sharingWorkspaceHeading">' + this.escapeHtml(workspaceCopy.panelTitle) + '</h2>' +
      '<p>' + this.escapeHtml(workspaceCopy.description) + '</p></div>' +
      '<span class="combined-private-badge">◆ ' + this.escapeHtml(workspaceCopy.privacyBadge) + '</span></header>' +
      '<label class="sc-field sharing-template-field" for="sharingTemplate"><span>' +
      this.escapeHtml(workspaceCopy.presentationLabel) + '</span>' +
      '<select id="sharingTemplate" onchange="selectSharingTemplate(this.value, true)">' +
      combinedOption +
      '<option value="claudeShareCard"' + selectedOption('claudeShareCard') + '>' +
      this.escapeHtml(workspaceCopy.claudeCardPresentation) + '</option>' +
      '<option value="claudeHeatmap"' + selectedOption('claudeHeatmap') + '>' +
      this.escapeHtml(workspaceCopy.claudeHeatmapPresentation) + '</option></select></label>' +
      '<div class="sharing-preview-stage">' + combinedPresentation +
      (selected === 'claudeShareCard'
        ? this.renderShareCardPanel(selected)
        : this.renderSharingPresentationPlaceholder(
            'claudeShareCard',
            workspaceCopy.claudeCardPresentation,
            workspaceCopy.claudeCardPresentationDescription,
          )) +
      (selected === 'claudeHeatmap'
        ? this.renderClaudeHeatmapPresentation(selected)
        : this.renderSharingPresentationPlaceholder(
            'claudeHeatmap',
            workspaceCopy.claudeHeatmapPresentation,
            workspaceCopy.claudeHeatmapPresentationDescription,
          )) + '</div>' +
      '</section>';
  }

  private renderSharingPresentationPlaceholder(
    template: SharingTemplate,
    title: string,
    description: string,
  ): string {
    return '<section class="sharing-presentation sharing-presentation-placeholder"' +
      ' data-sharing-presentation="' + template + '" hidden>' +
      '<h3 class="sharing-presentation-title">' + this.escapeHtml(title) + '</h3>' +
      '<p class="sharing-presentation-description">' + this.escapeHtml(description) + '</p>' +
      '<p class="table-hint" role="status">' + this.escapeHtml(I18n.t.statusBar.loading) + '</p>' +
      '</section>';
  }

  private renderCodexCompare(): string {
    const claude = this.allTimeData;
    const formatters = createCodexLocalizedFormatters(
      I18n.getLocale(),
      I18n.getTimezone(),
    );
    const codexAllTime = this.codexView?.allTime.total;
    const codexTotals = {
      input: codexAllTime?.input ?? 0,
      output: codexAllTime?.output ?? 0,
      cache: codexAllTime?.cachedInput ?? 0,
    };
    const copy = I18n.t.providers.codex;
    const card = (
      label: string,
      accounting: string,
      input: number,
      cache: number,
      output: number,
    ): string =>
      '<article class="summary-item"><h3>' + this.escapeHtml(label) + '</h3>' +
      '<p class="model-details">' + this.escapeHtml(accounting) + '</p>' +
      '<div class="model-details model-details-stacked">' +
      '<span><span class="model-stat-label">' + this.escapeHtml(copy.input) + '</span><strong>' + I18n.formatNumber(input) + '</strong></span>' +
      '<span><span class="model-stat-label">' + this.escapeHtml(copy.cachedInput) + '</span><strong>' + I18n.formatNumber(cache) + '</strong></span>' +
      '<span><span class="model-stat-label">' + this.escapeHtml(copy.output) + '</span><strong>' + I18n.formatNumber(output) + '</strong></span>' +
      '</div></article>';
    const sharingWorkspace = (this.setting<boolean>('enableShareCard', true) || this.sharingWorkspaceRequested)
      ? this.renderSharingWorkspace()
      : '';
    const summaryGrid = '<div class="summary-grid">' +
      card(
        I18n.t.providers.claude,
        copy.claudeTokenAccounting,
        claude?.totalInputTokens ?? 0,
        (claude?.totalCacheCreationTokens ?? 0) + (claude?.totalCacheReadTokens ?? 0),
        claude?.totalOutputTokens ?? 0,
      ) +
      card(
        I18n.t.providers.codexBeta,
        copy.codexTokenAccounting,
        codexTotals.input,
        codexTotals.cache,
        codexTotals.output,
      ) +
      '</div>';
    const weeklyPanels = this.renderWeeklyValuePanel('claude') +
      this.renderWeeklyValuePanel('codex');
    const renderKey = createHash('sha256')
      .update(sharingWorkspace + summaryGrid + weeklyPanels, 'utf8')
      .digest('hex');
    if (renderKey !== this.compareSnapshotRenderKey) {
      this.compareSnapshotRenderKey = renderKey;
      this.compareSnapshotUpdatedAt = Date.now();
    }
    return sharingWorkspace +
      '<section class="usage-summary">' +
      '<p class="model-details"><strong>' + this.escapeHtml(copy.indexedAllTime) + '</strong> · ' +
      this.escapeHtml(copy.updatedAt) + ': ' +
      this.escapeHtml(formatters.formatDateTime(this.compareSnapshotUpdatedAt)) + '</p>' +
      summaryGrid + '</section>' + weeklyPanels;
  }

  private getAlternateProviderContent(): string {
    const title = I18n.t.providers.codex.compareTitle;
    return `
      <!DOCTYPE html>
      <html lang="${this.escapeHtml(I18n.getLocale())}">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
        <title>${this.escapeHtml(title)}</title>
        <style>${this.getStyles()}</style>
      </head>
      <body class="${this.setting<boolean>('dashboardAutoRefresh', true) ? '' : 'auto-off'}">
        <div class="container">
          <header><h1>${this.escapeHtml(title)}</h1><div class="actions"><button onclick="refresh()" class="btn-secondary">↻ ${this.escapeHtml(I18n.t.popup.refresh)}</button></div></header>
          ${this.renderProviderTabs()}
          <div id="provider-panel" role="tabpanel" aria-labelledby="provider-tab-${this.currentProvider}">
            ${this.renderCodexCompare()}
          </div>
        </div>
        <script>${this.getScript()}</script>
      </body>
      </html>`;
  }

  private getMainContent(): string {
    if (this.currentProvider === 'compare') {
      return this.getAlternateProviderContent();
    }
    const provider: SettingProvider = this.currentProvider;
    const codexCopy = I18n.t.providers.codex;
    // Pre-resolve I18n values to avoid template literal issues
    const title = provider === 'codex' ? codexCopy.title : I18n.t.popup.title;
    const refresh = I18n.t.popup.refresh;
    const settings = I18n.t.popup.settings;
    // Keep the navigation familiar across providers. Codex still renders the
    // provider-native "Recent task" heading and aggregation inside this tab.
    const today = I18n.t.popup.today;
    const middleRangeLabel = provider === 'codex' ? codexCopy.last30Days : I18n.t.popup.last30days;
    const allTime = provider === 'codex' ? codexCopy.allTime : I18n.t.popup.allTime;
    const sessions = provider === 'codex' ? codexCopy.sessions : I18n.t.popup.sessions;
    const projects = provider === 'codex' ? codexCopy.projects : I18n.t.popup.projects;
    const contentTab = provider === 'codex' ? codexCopy.recommendations : I18n.t.popup.contentAnalysis;
    const branchesTab = I18n.t.popup.branches;
    const workflowsTab = I18n.t.popup.workflows;
    const settingsTab = I18n.t.popup.settingsTab;

    const todayActive = this.currentTab === 'today' ? 'active' : '';
    const rolling30Active = this.currentTab === 'month' ? 'active' : '';
    const allActive = this.currentTab === 'all' ? 'active' : '';
    const sessionsActive = this.currentTab === 'sessions' ? 'active' : '';
    const projectsActive = this.currentTab === 'projects' ? 'active' : '';
    const contentActive = this.currentTab === 'content' ? 'active' : '';
    const branchesActive = this.currentTab === 'branches' ? 'active' : '';
    const workflowsActive = this.currentTab === 'workflows' ? 'active' : '';
    const settingsActive = this.currentTab === 'settings' ? 'active' : '';

    const dashboardTab = (name: string, label: string, active: string): string => {
      const selected = active === 'active';
      return '<button id="tab-' + name + '" class="tab ' + active +
        '" role="tab" data-dashboard-tab="' + name + '" aria-controls="' + name +
        '" aria-selected="' + selected + '" tabindex="' + (selected ? '0' : '-1') +
        '" onclick="showTab(\'' + name + '\')">' + this.escapeHtml(label) + '</button>';
    };
    const dashboardPanel = (name: string, active: string, content: string): string =>
      '<div id="' + name + '" class="tab-content ' + active + '" role="tabpanel" ' +
      'aria-labelledby="tab-' + name + '"' + (active === 'active' ? '' : ' hidden') + '>' +
      content + '</div>';

    // The Content tab is hidden when content analysis is disabled via
    // claudeCodeUsage.enableContentAnalysis (the analyser returned null).
    const contentEnabled = provider === 'codex'
      ? Boolean(this.codexView && this.setting<boolean>('codex.optimization.enabled', true))
      : this.contentAnalysis !== null;
    const contentTabButton = contentEnabled
      ? dashboardTab('content', contentTab, contentActive)
      : '';
    const contentTabContent = contentEnabled
      ? dashboardPanel(
          'content',
          contentActive,
          this.renderContentData(provider) +
            (provider === 'claude'
              ? this.renderCacheWarmth() + this.renderInsights() + this.renderCostliestMessages()
              : ''),
        )
      : '';

    return (
      `
      <!DOCTYPE html>
      <html lang="${this.escapeHtml(I18n.getLocale())}">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
        <title>` +
      title +
      `</title>
        <style>` +
      this.getStyles() +
      `</style>
      </head>
      <body class="${this.setting<boolean>('dashboardAutoRefresh', true) ? '' : 'auto-off'}">
        <div class="container">
          <header>
            <h1>` +
      title +
      `</h1>
            <div class="actions">
              <button onclick="refresh()" id="refreshNowBtn" class="btn-secondary btn-refresh-now" title="${this.escapeHtml(
                I18n.t.popup.refresh
              )}">↻ ` +
      refresh +
      `</button>
              ` +
      (provider === 'claude' && contentEnabled
        ? `<button onclick="showTab('content')" class="btn-secondary">✨ ${this.escapeHtml(contentTab)}</button>`
        : '') +
      `
              <button onclick="showTab('settings')" class="btn-secondary">⚙ ` +
      settings +
      `</button>
            </div>
          </header>` +
      this.renderProviderTabs() +
      `<div id="provider-panel" role="tabpanel" aria-labelledby="provider-tab-${this.currentProvider}">` +
      LIVE_PATCH_PANEL_START +
      this.renderQuotaBanner(provider) +
      `
          <div class="tabs" role="tablist" aria-label="${this.escapeHtml(title)}">
            ` + dashboardTab('today', today, todayActive) +
      dashboardTab('month', middleRangeLabel, rolling30Active) +
      dashboardTab('all', allTime, allActive) +
      dashboardTab('sessions', sessions, sessionsActive) +
      dashboardTab('projects', projects, projectsActive) +
      contentTabButton +
      (provider === 'claude'
        ? dashboardTab('branches', branchesTab, branchesActive) +
          dashboardTab('workflows', workflowsTab, workflowsActive)
        : '') +
      dashboardTab('settings', settingsTab, settingsActive) + `
          </div>

          ` + dashboardPanel('today', todayActive, this.renderTodayData(provider)) +
      dashboardPanel('month', rolling30Active, this.renderMonthData(provider)) +
      dashboardPanel('all', allActive, this.renderAllTimeData(provider)) +
      dashboardPanel('sessions', sessionsActive, this.renderSessionData(provider)) +
      dashboardPanel('projects', projectsActive, this.renderProjectData(provider)) +
      contentTabContent +
      (provider === 'claude'
        ? dashboardPanel('branches', branchesActive, this.renderBranchData()) +
          dashboardPanel('workflows', workflowsActive, this.renderWorkflowData())
        : '') +
      dashboardPanel('settings', settingsActive, this.renderSettingsPanel(provider)) +
      LIVE_PATCH_PANEL_END + `
        </div>
        </div>
        <script>` +
      this.getScript() +
      `</script>
      </body>
      </html>
    `
    );
  }

  /**
   * The ⚙ Settings tab: every setting, grouped, editable in place. Core
   * settings (language / dataDirectory) still write to VS Code config; secrets
   * go to SecretStorage and the rest use the dashboard-managed store. Setting
   * labels/help are English (technical); group headers + chrome are localised.
   */
  private renderSettingsPanel(provider: SettingProvider): string {
    const t = I18n.t.popup;
    const snap: SettingView[] = this.settings ? this.settings.snapshot() : [];
    const visible = snap.filter((setting) =>
      setting.visible !== false && settingAppliesToProvider(setting, provider),
    );
    const groups: { key: string; label: string }[] = [
      { key: 'general', label: t.settingsGroupGeneral },
      { key: 'providers', label: t.settingsGroupProviders },
      { key: 'features', label: t.settingsGroupFeatures },
      { key: 'statusBar', label: t.settingsGroupStatusBar },
      { key: 'data', label: t.settingsGroupData },
      { key: 'advice', label: t.settingsGroupAdvice },
    ];
    let html = '<div class="settings-panel">';
    html += '<p class="table-hint">' + t.settingsIntro + '</p>';
    html +=
      '<div class="settings-toolbar">' +
      '<button class="btn-secondary btn-small" onclick="resetAllSettings(' +
      this.escapeHtml(JSON.stringify(visible.map((setting) => setting.key))) +
      ')">' +
      t.settingsResetAll +
      '</button></div>';
    for (const g of groups) {
      const items = visible.filter((s) => s.group === g.key);
      if (items.length === 0) {
        continue;
      }
      html += '<div class="settings-group"><h3>' + this.escapeHtml(g.label) + '</h3>';
      for (const it of items) {
        html += this.renderSettingRow(it);
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  private renderLocalDataControls(): string {
    const copy = localDataUiCopy(I18n.getLocale());
    const esc = (value: string): string => this.escapeHtml(value);
    return (
      '<section class="settings-group local-data-controls" aria-labelledby="localDataTitle">' +
      '<h3 id="localDataTitle">' + esc(copy.title) + '</h3>' +
      '<p class="table-hint">' + esc(copy.intro) + '</p>' +
      '<div class="local-data-heading"><h4>' + esc(copy.inventory) + '</h4>' +
      '<button class="btn-secondary btn-small" type="button" onclick="requestLocalDataInventory()">' +
      esc(copy.refresh) + '</button></div>' +
      '<div class="table-wrap local-data-table-wrap" role="region" tabindex="0" aria-label="' +
      esc(copy.inventory) + '"><table class="data-table local-data-table">' +
      '<thead><tr><th>' + esc(copy.category) + '</th><th>' + esc(copy.location) + '</th>' +
      '<th>' + esc(copy.schema) + '</th><th>' + esc(copy.sizeCount) + '</th>' +
      '<th>' + esc(copy.dateRange) + '</th><th>' + esc(copy.network) + '</th>' +
      '<th>' + esc(copy.clearability) + '</th></tr></thead>' +
      '<tbody id="localDataInventoryBody"><tr><td colspan="7" class="table-hint">' +
      esc(copy.loading) + '</td></tr></tbody></table></div>' +
      '<p id="localDataExclusions" class="table-hint"></p>' +
      '<div class="local-data-heading"><h4>' + esc(copy.actions) + '</h4></div>' +
      '<div class="local-data-actions" role="group" aria-label="' + esc(copy.actions) + '">' +
      '<button class="btn-secondary btn-small" type="button" onclick="runLocalDataAction(\'rebuild-codex-index\')">' + esc(copy.rebuildIndex) + '</button>' +
      '<label class="local-data-scope-label" for="localDataQuotaScope">' + esc(copy.quotaScope) + '</label>' +
      '<select id="localDataQuotaScope" aria-label="' + esc(copy.quotaScope) + '"></select>' +
      '<button class="btn-secondary btn-small" type="button" onclick="runLocalDataAction(\'clear-quota-history\')">' + esc(copy.clearQuota) + '</button>' +
      '<button class="btn-secondary btn-small" type="button" onclick="runLocalDataAction(\'clear-advice-data\')">' + esc(copy.clearAdvice) + '</button>' +
      '<button class="btn-secondary btn-small" type="button" onclick="runLocalDataAction(\'reset-ui-state\')">' + esc(copy.resetUi) + '</button>' +
      '<button class="btn-secondary btn-small" type="button" onclick="runLocalDataAction(\'reset-sharing-preferences\')">' + esc(copy.resetSharing) + '</button>' +
      '<button class="btn-secondary btn-small" type="button" onclick="runLocalDataAction(\'clear-byok-secret\')">' + esc(copy.clearByok) + '</button>' +
      '<button class="btn-secondary btn-small local-data-danger" type="button" onclick="runLocalDataAction(\'clear-all-derived-data\')">' + esc(copy.clearAll) + '</button>' +
      '</div><p id="localDataActionStatus" class="table-hint" role="status" aria-live="polite"></p>' +
      '</section>'
    );
  }

  /** One row in the settings panel: label + help + the right input control. The
   * label / help follow the plugin language (I18n.settingText), falling back to
   * the catalog English for the English UI. */
  private renderQuotaFormatSettingRow(it: SettingView): string {
    const esc = (value: string): string => this.escapeHtml(value);
    const copy = I18n.t.popup;
    const tr = I18n.settingText(it.key);
    const label = tr.label ?? it.label;
    const detailedHelp = tr.help ?? it.help ?? '';
    const id = 'set_statusBarQuotaFormat';
    const presetId = `${id}_preset`;
    const raw = String(it.value);
    const selected = raw === '' || raw === FIVE_HOUR_QUOTA_STATUS_TEMPLATE ||
      raw === WEEKLY_QUOTA_STATUS_TEMPLATE ? raw : 'custom';
    const option = (value: string, text: string): string =>
      '<option value="' + esc(value) + '"' + (selected === value ? ' selected' : '') +
      '>' + esc(text) + '</option>';
    const options = option('', copy.quotaFormatBuiltIn) +
      option(FIVE_HOUR_QUOTA_STATUS_TEMPLATE, copy.quotaFormatFiveHour) +
      option(WEEKLY_QUOTA_STATUS_TEMPLATE, copy.quotaFormatWeekly) +
      option('custom', copy.quotaFormatCustom);
    const custom = selected === 'custom';
    return '<div class="set-row"><div class="set-label"><label for="' + presetId + '">' +
      esc(label) + '</label><div class="set-help">' + esc(copy.quotaFormatShortHelp) + '</div></div>' +
      '<div class="set-control quota-format-control"><select id="' + presetId + '"' +
      ' data-default-template="' + esc(CUSTOM_QUOTA_STATUS_TEMPLATE) + '"' +
      ' onchange="setQuotaFormatPreset(this)">' + options + '</select>' +
      '<div id="' + id + '_custom" class="quota-format-custom"' + (custom ? '' : ' hidden') + '>' +
      '<input type="text" id="' + id + '" value="' + esc(custom ? raw : '') + '"' +
      ' maxlength="' + (it.maxLength ?? 120) + '"' +
      ' aria-label="' + esc(label + ' — ' + copy.quotaFormatCustom) + '"' +
      ' aria-describedby="' + id + '_help"' +
      ' onchange="setQuotaFormatCustom(this)">' +
      '<div id="' + id + '_help" class="set-help">' + esc(detailedHelp) + '</div>' +
      '</div></div></div>';
  }

  private renderSettingRow(it: SettingView): string {
    if (it.key === 'statusBarQuotaFormat') {
      return this.renderQuotaFormatSettingRow(it);
    }
    const esc = (s: string): string => this.escapeHtml(s);
    const tr = I18n.settingText(it.key);
    const label = tr.label ?? it.label;
    const help = tr.help !== undefined ? tr.help : it.help;
    const id = 'set_' + it.key.replace(/[^a-zA-Z0-9]/g, '_');
    const onCh = (type: string): string =>
      ` onchange="setSetting('${it.key}', ${
        type === 'boolean' ? 'this.checked' : 'this.value'
      }, '${type}')"`;
    let control = '';
    if (it.type === 'boolean') {
      control =
        '<label class="set-switch"><input type="checkbox" id="' +
        id +
        '"' +
        (it.value ? ' checked' : '') +
        onCh('boolean') +
        '><span class="set-slider"></span></label>';
    } else if (it.type === 'enum') {
      const cur = String(it.value);
      const option = (v: string, lbl: string): string =>
        '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(lbl) + '</option>';
      let opts = '';
      // Keep a previously-stored value selectable even if it's not in the list.
      const known = new Set(it.enumValues || []);
      if (cur && !known.has(cur)) {
        opts += option(cur, cur + ' (current)');
      }
      if (it.enumGroups && it.enumGroups.length > 0) {
        // Grouped <optgroup> rendering (e.g. timezone: Common / All zones).
        opts += it.enumGroups
          .map(
            (g) =>
              '<optgroup label="' + esc(g.label) + '">' +
              g.values.map((v, i) => option(v, g.labels[i] || (v === '' ? '(default)' : v))).join('') +
              '</optgroup>'
          )
          .join('');
      } else {
        const values = it.enumValues || [];
        const labels = it.enumLabels || [];
        opts += values.map((v, i) => option(v, labels[i] || (v === '' ? '(default)' : v))).join('');
      }
      control = '<select id="' + id + '"' + onCh('string') + '>' + opts + '</select>';
    } else if (it.type === 'number') {
      control =
        '<input type="number" id="' +
        id +
        '" value="' +
        esc(String(it.value)) +
        '"' +
        (it.min !== undefined ? ' min="' + it.min + '"' : '') +
        (it.max !== undefined ? ' max="' + it.max + '"' : '') +
        (it.step !== undefined ? ' step="' + it.step + '"' : '') +
        onCh('number') +
        '>';
    } else if (it.multiline) {
      control =
        '<textarea id="' + id + '" rows="2"' + onCh('string') + '>' + esc(String(it.value)) + '</textarea>';
    } else {
      control =
        '<input type="' +
        (it.secret ? 'password' : 'text') +
        '" id="' +
        id +
        '" value="' +
        esc(String(it.value)) +
        '"' +
        (it.maxLength !== undefined ? ' maxlength="' + it.maxLength + '"' : '') +
        (it.secret
          ? ' autocomplete="new-password" placeholder="' + (it.configured ? '••••••••' : '') + '"'
          : '') +
        onCh('string') +
        '>';
    }
    const helpHtml = help ? '<div class="set-help">' + esc(help) + '</div>' : '';
    return (
      '<div class="set-row"><div class="set-label"><label for="' +
      id +
      '">' +
      esc(label) +
      '</label>' +
      helpHtml +
      '</div><div class="set-control">' +
      control +
      '</div></div>'
    );
  }

  private renderTodayData(provider: SettingProvider = 'claude'): string {
    if (provider === 'codex') {
      const view = this.codexView;
      const copy = I18n.t.providers.codex;
      if (!view) {
        return this.renderCodexEmptyState();
      }
      const formatters = createCodexLocalizedFormatters(I18n.getLocale(), I18n.getTimezone());
      let identity = '';
      if (view.lastTaskIdentity) {
        const task = view.lastTaskIdentity;
        identity = '<div class="model-breakdown"><div class="section-header"><h3>' +
          this.escapeHtml(copy.lastTask) + '</h3></div><div class="model-list"><div class="model-item">' +
          '<div class="model-header"><span class="model-name">' +
          this.escapeHtml(task.title ?? copy.unnamedSession) + '</span></div>' +
          '<div class="model-details model-details-stacked">' +
          '<span><span class="model-stat-label">' + this.escapeHtml(copy.projectLabel) + '</span><strong>' +
          this.escapeHtml(task.projectName ?? copy.unidentifiedProject) + '</strong></span>' +
          '<span><span class="model-stat-label">' + this.escapeHtml(copy.lastObserved) + '</span><strong>' +
          this.escapeHtml(formatters.formatDateTime(task.lastActiveAt)) + '</strong></span>' +
          (task.projectDirectoryName && task.projectDirectoryName !== task.projectName
            ? '<span><span class="model-stat-label">' + this.escapeHtml(copy.localDirectory) + '</span><strong>' +
              this.escapeHtml(task.projectDirectoryName) + '</strong></span>'
            : '') +
          '</div></div></div></div>';
      }
      const limits = view.limits.length > 0
        ? '<div class="usage-summary"><div class="section-header"><h3>' + this.escapeHtml(copy.usageLimits) +
          '</h3></div><p class="model-details">' + this.escapeHtml(copy.accountSnapshotLastObserved) +
          '</p><div class="summary-grid">' + view.limits.map((limit) => {
            const label = limit.limitName ?? (limit.windowMinutes === 300
              ? copy.fiveHourWindow
              : limit.windowMinutes === 10_080 ? copy.weeklyWindow : copy.usageLimits);
            const value = limit.state === 'unlimited'
              ? copy.unlimited
              : limit.state === 'missing'
                ? copy.limitMissing
                : `${I18n.formatNumber(limit.usedPercent ?? 0)}% ${copy.used} · ` +
                  `${I18n.formatNumber(limit.remainingPercent ?? Math.max(0, 100 - (limit.usedPercent ?? 0)))}% ${copy.remaining}`;
            const reset = limit.resetsAt && limit.state === 'current'
              ? '<div class="model-details">' + this.escapeHtml(copy.resets) + ': ' +
                this.escapeHtml(formatters.formatDateTime(limit.resetsAt)) + ' · ' +
                this.escapeHtml(formatters.formatRelativeTime(limit.resetsAt, Date.now())) + '</div>'
              : '';
            const observed = limit.observedAt
              ? '<div class="model-details">' + this.escapeHtml(copy.lastObserved) + ': ' +
                this.escapeHtml(formatters.formatDateTime(limit.observedAt)) + ' · ' +
                this.escapeHtml(copy.localLogNotLive) + '</div>'
              : '';
            return '<div class="summary-item"><div class="label">' + this.escapeHtml(label) +
              '</div><div class="value">' + this.escapeHtml(value) + '</div>' + reset + observed + '</div>';
          }).join('') + '</div></div>'
        : '';
      const qualityFlags = view.qualityFlags.length > 0
        ? '<ul class="model-details">' + view.qualityFlags.map(({ flag, count }) => {
            const label = copy.qualityFlagLabels[flag as keyof typeof copy.qualityFlagLabels] ??
              copy.qualityFlagUnknown;
            const detail = flag === 'index-backfill-incomplete'
              ? I18n.formatNumber(view.coverage.indexedFiles) + '/' +
                I18n.formatNumber(view.coverage.totalFiles)
              : I18n.formatNumber(count);
            return '<li>' + this.escapeHtml(label) + ' · ' + detail + '</li>';
          }).join('') + '</ul>'
        : '';
      const coverage = '<details class="model-item"><summary>' + this.escapeHtml(copy.coverage) +
        ' · ' + this.escapeHtml(copy.quality) + '</summary><p class="model-details">' +
        this.escapeHtml(copy.indexedLogEntries) + ': ' + I18n.formatNumber(view.coverage.indexedFiles) + '/' +
        I18n.formatNumber(view.coverage.totalFiles) + ' · ' + this.escapeHtml(copy.indexedStorage) + ': ' +
        this.escapeHtml(formatters.formatBytes(view.coverage.indexedBytes)) + '/' +
        this.escapeHtml(formatters.formatBytes(view.coverage.totalBytes)) + ' · ' +
        this.escapeHtml(view.coverage.complete ? copy.complete : copy.partial) + '</p>' +
        qualityFlags + '</details>';
      return this.renderUsageData(null, provider, view.today) +
        this.renderCodexTodayHourly(view) + identity + limits + coverage;
    }
    if (!this.todayData) {
      return '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>';
    }

    const todayHasActivity = this.todayData.messageCount > 0 ||
      this.todayData.totalInputTokens > 0 ||
      this.todayData.totalOutputTokens > 0 ||
      this.todayData.totalCacheCreationTokens > 0 ||
      this.todayData.totalCacheReadTokens > 0;
    const latestActivityDate = this.dailyDataForRolling30Days.reduce<string | undefined>(
      (latest, row) => latest === undefined || row.date > latest ? row.date : latest,
      undefined,
    );
    const emptyRangeHint = todayHasActivity
      ? ''
      : '<p class="table-hint range-empty-hint"><strong>' +
        this.escapeHtml(I18n.t.popup.today) + ':</strong> 0' +
        (latestActivityDate
          ? ' · ' + this.escapeHtml(I18n.t.popup.lastActive) + ': ' +
            this.escapeHtml(this.formatDate(latestActivityDate))
          : '') + '</p>';
    const todaySummary = emptyRangeHint + this.renderUsageData(this.todayData, provider) +
      this.renderTodayInsights(provider);
    const hourlyDisplayRows = completeDisplayRange(
      clockHourKeys().map(formatHourLabel),
      this.hourlyDataForToday,
      (row) => row.hour,
      (hour) => ({ hour, data: emptyDisplayUsageData() }),
    ).map(({ value }) => value);

    let hourlyBreakdown = '';
    if (hourlyDisplayRows.length > 0) {
      const cost = I18n.t.popup.cost;
      const inputTokens = I18n.t.popup.inputTokens;
      const outputTokens = I18n.t.popup.outputTokens;
      const cacheCreation = I18n.t.popup.cacheCreation;
      const cacheRead = I18n.t.popup.cacheRead;
      const messages = I18n.t.popup.messages;

      let hourlyRows = '';
      hourlyDisplayRows.forEach(({ hour, data }) => {
        hourlyRows +=
          '<tr data-hour="' + this.escapeHtml(hour) + '">' +
          '<td class="date-cell">' +
          hour +
          '</td>' +
          '<td class="cost-cell">' +
          I18n.formatCurrency(data.totalCost) +
          '</td>' +
          '<td class="number-cell">' +
          I18n.formatNumber(data.totalInputTokens) +
          '</td>' +
          '<td class="number-cell">' +
          I18n.formatNumber(data.totalOutputTokens) +
          '</td>' +
          '<td class="number-cell">' +
          I18n.formatNumber(data.totalCacheCreationTokens) +
          '</td>' +
          '<td class="number-cell">' +
          I18n.formatNumber(data.totalCacheReadTokens) +
          '</td>' +
          '<td class="number-cell">' +
          I18n.formatNumber(data.messageCount) +
          '</td>' +
          '</tr>';
      });

      hourlyBreakdown =
        '<div class="daily-breakdown" data-hourly-overview>' +
        '<h3>' +
        I18n.t.popup.hourlyBreakdown +
        '</h3>' +
        '<div class="chart-tabs">' +
        '<button class="chart-tab active" data-metric="cost">' +
        cost +
        '</button>' +
        '<button class="chart-tab" data-metric="inputTokens">' +
        inputTokens +
        '</button>' +
        '<button class="chart-tab" data-metric="outputTokens">' +
        outputTokens +
        '</button>' +
        '<button class="chart-tab" data-metric="cacheCreation">' +
        cacheCreation +
        '</button>' +
        '<button class="chart-tab" data-metric="cacheRead">' +
        cacheRead +
        '</button>' +
        '<button class="chart-tab" data-metric="messages">' +
        messages +
        '</button>' +
        '</div>' +
        this.renderHourlyChart(hourlyDisplayRows) +
        '<p class="chart-selection-detail" id="claude-today-hour-selection-detail" ' +
        'data-hour-selection-detail role="status" aria-live="polite" hidden></p>' +
        this.renderCompositionChart(
          hourlyDisplayRows
            .map((h) => ({ label: h.hour, data: h.data })),
          provider,
        ) +
        '<div class="daily-table-container" tabindex="0">' +
        '<table class="daily-table">' +
        '<thead>' +
        '<tr>' +
        '<th>' +
        I18n.t.popup.hour +
        '</th>' +
        '<th>' +
        cost +
        '</th>' +
        '<th>' +
        inputTokens +
        '</th>' +
        '<th>' +
        outputTokens +
        '</th>' +
        '<th>' +
        cacheCreation +
        '</th>' +
        '<th>' +
        cacheRead +
        '</th>' +
        '<th>' +
        messages +
        '</th>' +
        '</tr>' +
        '</thead>' +
        '<tbody>' +
        hourlyRows +
        '</tbody>' +
        '</table>' +
        '</div>' +
        '</div>';
    }

    return todaySummary + hourlyBreakdown;
  }

  private renderCodexTodayHourly(view: CodexUsageView): string {
    const rows = view.todayCoverage.complete
      ? completeDisplayRange(
          clockHourKeys(),
          view.todayHourly,
          (row) => row.hour,
          emptyCodexHourlyDisplayRow,
        ).map(({ value }) => value)
      : view.todayHourly;
    return this.renderCodexHourlyBreakdown(
      rows,
      view.todayCoverage,
    );
  }

  private renderCodexHourlyBreakdown(
    rows: CodexHourlyUsageView[],
    coverage: {
      indexedFiles: number;
      totalFiles: number;
      complete: boolean;
    },
    day?: string,
  ): string {
    if (rows.length === 0 && coverage.complete && !day) {
      return '';
    }
    const copy = I18n.t.providers.codex;
    const partial = coverage.complete
      ? ''
      : '<p class="model-details">' + this.escapeHtml(copy.indexedLogEntries) + ': ' +
        I18n.formatNumber(coverage.indexedFiles) + '/' + I18n.formatNumber(coverage.totalFiles) +
        ' · ' + this.escapeHtml(copy.partial) + '</p>';
    const tabs = '<div class="chart-tabs">' +
      '<button class="chart-tab active" data-metric="cost">' + this.escapeHtml(copy.apiEquivalentCost) + '</button>' +
      '<button class="chart-tab" data-metric="inputTokens">' + this.escapeHtml(copy.processed) + '</button>' +
      '<button class="chart-tab" data-metric="outputTokens">' + this.escapeHtml(copy.fresh) + '</button>' +
      '<button class="chart-tab" data-metric="cacheCreation">' + this.escapeHtml(copy.output) + '</button>' +
      '<button class="chart-tab" data-metric="cacheRead">' + this.escapeHtml(copy.reasoning) + '</button>' +
      '<button class="chart-tab" data-metric="messages">' + this.escapeHtml(copy.threads) + '</button>' +
      '</div>';
    const chart = rows.length > 0
      ? '<div class="chart-content"' + (day ? '' : ' id="codexTodayHourlyChart"') + '>' +
        this.renderCodexHourlyChart(rows) + '</div>' +
        (day ? '' : '<p class="chart-selection-detail" id="codex-today-hour-selection-detail" ' +
          'data-hour-selection-detail role="status" aria-live="polite" hidden></p>') +
        this.renderCompositionChart(
          rows.map((row) => ({ label: row.label, data: row.total })),
          'codex',
        )
      : '<div class="no-chart-data">' + this.escapeHtml(copy.noDailyData) + '</div>';
    const table = rows.length > 0
      ? '<div class="daily-table-container" tabindex="0"><table class="daily-table"><thead><tr>' +
        '<th>' + this.escapeHtml(I18n.t.popup.hour) + '</th>' +
        '<th>' + this.escapeHtml(copy.apiEquivalentCost) + '</th>' +
        '<th>' + this.escapeHtml(copy.processed) + '</th><th>' + this.escapeHtml(copy.fresh) + '</th>' +
        '<th>' + this.escapeHtml(copy.input) + '</th><th>' + this.escapeHtml(copy.cachedInput) + '</th>' +
        '<th>' + this.escapeHtml(copy.output) + '</th><th>' + this.escapeHtml(copy.reasoning) + '</th>' +
        '<th>' + this.escapeHtml(copy.threads) + '</th></tr></thead><tbody>' +
        rows.map((row) =>
          '<tr data-hour="' + this.escapeHtml(row.hour) + '"><td class="date-cell">' +
          this.escapeHtml(row.label) + '</td>' +
          '<td class="cost-cell" title="' + this.escapeHtml(this.codexCostHelp(row.apiEquivalent)) + '">' +
          this.codexCostLabel(row.apiEquivalent, row.total.processed) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(row.total.processed) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(row.total.fresh) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(row.total.input) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(row.total.cachedInput) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(row.total.output) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(row.total.reasoning) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(row.threads) + '</td></tr>',
        ).join('') + '</tbody></table></div>'
      : '';
    const heading = day
      ? '<h4>' + this.escapeHtml(this.formatDate(day)) + ' · ' +
        this.escapeHtml(I18n.t.popup.hourlyBreakdown) + '</h4>'
      : '<h3>' + this.escapeHtml(I18n.t.popup.hourlyBreakdown) + '</h3>';
    return '<div class="' + (day ? 'hourly-breakdown' : 'daily-breakdown') +
      '" data-codex-time-series' + (day
        ? ' data-codex-materialized-hours="true" data-date="' + this.escapeHtml(day) + '"'
        : ' data-codex-today-hourly data-hourly-overview') + '>' +
      heading + partial + tabs + chart + table + '</div>';
  }

  /** Opt-in (showEfficiency) efficiency chips appended to a usage summary:
   * cost per message (exact: cost ÷ messages) and realised cache savings
   * (cacheRead tokens × the input−cacheRead price gap, per model). Off by
   * default — not everyone wants cost-efficiency framing. */
  private renderEfficiencyChips(data: UsageData): string {
    if (!this.setting<boolean>('showEfficiency', false) || !data || data.messageCount <= 0) {
      return '';
    }
    const costPerMsg = data.totalCost / data.messageCount;
    const totalTokens =
      data.totalInputTokens + data.totalOutputTokens + data.totalCacheCreationTokens + data.totalCacheReadTokens;
    const tokensPerMsg = totalTokens / data.messageCount;
    let savings = 0;
    for (const [model, mb] of Object.entries(data.modelBreakdown)) {
      if (mb.cacheReadTokens > 0) {
        const r = getModelRatesPerMillion(model);
        if (r) {
          savings += (mb.cacheReadTokens * Math.max(0, r.input - r.cacheRead)) / 1_000_000;
        }
      }
    }
    const chip = (label: string, value: string, title: string): string =>
      '<span class="eff-chip" title="' + this.escapeHtml(title) + '"><span class="eff-label">' + label +
      '</span><span class="eff-value">' + value + '</span></span>';
    let chips = chip('Cost / message', I18n.formatCurrency(costPerMsg), 'Total cost ÷ messages you sent');
    chips += chip('Tokens / message', I18n.formatNumber(Math.round(tokensPerMsg)), 'All tokens (in + out + cache) ÷ messages you sent');
    if (savings > 0) {
      chips += chip('Cache savings', I18n.formatCurrency(savings), 'What cache reads saved vs. paying full input price');
    }
    return '<div class="eff-chips">' + chips + '</div>';
  }

  private renderCodexIndexedSubtotal(indexedSubtotal?: boolean): string {
    if (!indexedSubtotal && !(this.codexLoading && this.codexProgress)) {
      return '';
    }
    const copy = I18n.t.providers.codex;
    const coverage = this.codexView?.coverage;
    const progress: CodexRenderProgress | null =
      this.codexLoading && this.codexProgress
        ? this.codexProgress
        : coverage
          ? {
              scannedFiles: coverage.indexedFiles,
              totalFiles: coverage.totalFiles,
              indexedBytes: coverage.indexedBytes,
              totalBytes: coverage.totalBytes,
            }
          : null;
    const details = progress
      ? ' · <span data-codex-index-progress-text>' +
        this.renderCodexProgressText(progress) + '</span>'
      : '';
    const subtotal = indexedSubtotal
      ? '<strong>' + this.escapeHtml(copy.indexedSubtotal) + '</strong> · '
      : '';
    return '<p class="model-details">' + subtotal +
      this.escapeHtml(copy.indexingInProgress) + details + '</p>';
  }

  private renderCodexEmptyState(): string {
    const copy = I18n.t.providers.codex;
    const message = this.codexLoading
      ? copy.indexingInProgress
      : copy.noRecentTask;
    const progress = this.codexLoading && this.codexProgress
      ? '<p class="model-details"><span data-codex-index-progress-text>' +
        this.renderCodexProgressText(this.codexProgress) + '</span></p>'
      : '';
    return '<div class="no-data"><p>' + this.escapeHtml(message) + '</p>' +
      progress + '</div>';
  }

  private renderCodexProgressText(progress: CodexRenderProgress): string {
    return this.escapeHtml(this.codexProgressText(progress));
  }

  private codexProgressText(progress: CodexRenderProgress): string {
    const copy = I18n.t.providers.codex;
    const exactCount = new Intl.NumberFormat(I18n.getLocale(), {
      maximumFractionDigits: 0,
    });
    const completedPercent = progress.totalFiles > 0
      ? Math.min(
          100,
          Math.max(0, Math.round(
            progress.scannedFiles / progress.totalFiles * 100,
          )),
        )
      : 0;
    const formatters = createCodexLocalizedFormatters(
      I18n.getLocale(),
      I18n.getTimezone(),
    );
    const reason = progress.reason
      ? copy.indexingReasons[progress.reason] + ' · '
      : '';
    return reason + copy.indexedLogEntries + ': ' +
      exactCount.format(progress.scannedFiles) + '/' +
      exactCount.format(progress.totalFiles) +
      (progress.totalFiles > 0 ? ' (' + completedPercent + '%)' : '') + ' · ' +
      copy.indexedStorage + ': ' +
      formatters.formatBytes(progress.indexedBytes) + '/' +
      formatters.formatBytes(progress.totalBytes);
  }

  private renderUsageData(
    data: UsageData | null,
    provider: SettingProvider = 'claude',
    codexScope: CodexUsageScopeView | null = null,
  ): string {
    if (provider === 'codex') {
      const scope = codexScope;
      if (!scope) {
        return this.renderCodexEmptyState();
      }
      const copy = I18n.t.providers.codex;
      const metric = (label: string, value: number | string): string =>
        '<div class="summary-item"><div class="label">' + this.escapeHtml(label) +
        '</div><div class="value">' + this.escapeHtml(
          typeof value === 'number' ? I18n.formatNumber(value) : value,
        ) + '</div></div>';
      const equivalentRows = scope.models.map((row) =>
        equivalentUsageFromProviderTokens(0, row.key, {
          inputTotal: row.totals.input,
          cachedInput: row.totals.cachedInput,
          outputTotal: row.totals.output,
          reasoningOutput: row.totals.reasoning,
        }),
      );
      const equivalent = summarizeEquivalentUsage(
        equivalentRows,
        scope.total.processed,
      );
      const pricingCoverageFormatter = new Intl.NumberFormat(I18n.getLocale(), {
        style: 'percent',
        maximumFractionDigits: 0,
      });
      const pricingCoverage = pricingCoverageFormatter.format(equivalent.pricingCoverage);
      const equivalentHelp = copy.apiEquivalentCostHelp.replace(
        '{coverage}',
        pricingCoverage,
      );
      const equivalentCost = equivalent.pricedTokens > 0
        ? I18n.formatCurrency(equivalent.equivalentUsd)
        : '—';
      const equivalentCostMetric =
        '<div class="summary-item" title="' + this.escapeHtml(equivalentHelp) + '">' +
        '<div class="label">' + this.escapeHtml(copy.apiEquivalentCost) + '</div>' +
        '<div class="value cost">' + this.escapeHtml(equivalentCost) + '</div></div>';
      const composition = tokenComposition(scope.total);
      const compositionTotal = composition.freshInput + composition.cachedInput + composition.output;
      const width = (value: number): string =>
        (compositionTotal > 0 ? (value / compositionTotal) * 100 : 0).toFixed(2) + '%';
      const legend = (className: string, label: string, value: number): string =>
        '<span class="legend-item"><span class="legend-dot ' + className + '"></span>' +
        this.escapeHtml(label) + ' ' + I18n.formatNumber(value) + '</span>';
      const compositionHtml = '<div class="cost-composition"><div class="cost-comp-head">' +
        '<span>' + this.escapeHtml(copy.tokenComposition) + '</span>' +
        '<strong>' + this.escapeHtml(copy.fresh) + ' ' +
        I18n.formatNumber(composition.uncachedUsage) + '</strong></div><div class="cost-comp-bar">' +
        '<div class="cost-comp-seg seg-input" style="width:' + width(composition.freshInput) + '"></div>' +
        '<div class="cost-comp-seg seg-cache-read" style="width:' + width(composition.cachedInput) + '"></div>' +
        '<div class="cost-comp-seg seg-output" style="width:' + width(composition.output) + '"></div>' +
        '</div><div class="cost-comp-legend">' +
        legend('seg-input', copy.freshInput, composition.freshInput) +
        legend('seg-cache-read', copy.cachedInput, composition.cachedInput) +
        legend('seg-output', copy.output, composition.output) +
        '</div><p class="model-details">' + this.escapeHtml(copy.reasoning) + ' ' +
        I18n.formatNumber(composition.reasoningWithinOutput) + ' · ' +
        this.escapeHtml(copy.reasoningSubset) + '</p></div>';
      const dimension = (
        title: string,
        rows: Array<{ key: string; totals: CodexMetricTotals }>,
        showEquivalentPrice: boolean,
      ): string => {
        if (rows.length === 0) {
          return '';
        }
        return '<div class="model-breakdown"><div class="section-header"><h3>' +
          this.escapeHtml(title) + '</h3></div><div class="model-list">' + rows.map((row, index) => {
          let headline: string;
          if (showEquivalentPrice) {
            const rowEquivalent = summarizeEquivalentUsage([
              equivalentUsageFromProviderTokens(0, row.key, {
                inputTotal: row.totals.input,
                cachedInput: row.totals.cachedInput,
                outputTotal: row.totals.output,
                reasoningOutput: row.totals.reasoning,
              }),
            ], row.totals.processed);
            const rowCoverage = pricingCoverageFormatter.format(rowEquivalent.pricingCoverage);
            const rowHelp = copy.apiEquivalentCostHelp.replace('{coverage}', rowCoverage);
            headline = '<span class="model-metric model-cost" title="' +
              this.escapeHtml(rowHelp) + '">' +
              this.escapeHtml(rowEquivalent.pricedTokens > 0
                ? I18n.formatCurrency(rowEquivalent.equivalentUsd)
                : '—') + '</span>';
          } else {
            headline = '<span class="model-metric">' + I18n.formatNumber(row.totals.fresh) + ' ' +
              this.escapeHtml(copy.fresh) + '</span>';
          }
          return '<details class="model-item"' + (index === 0 ? ' open' : '') + '><summary class="model-header">' +
            '<span class="model-name">' + this.escapeHtml(row.key) + '</span>' + headline + '</summary>' +
            '<div class="model-details model-details-stacked">' +
            '<span><span class="model-stat-label">' + this.escapeHtml(copy.processed) + '</span><strong>' +
            I18n.formatNumber(row.totals.processed) + '</strong></span>' +
            '<span><span class="model-stat-label">' + this.escapeHtml(copy.fresh) + '</span><strong>' +
            I18n.formatNumber(row.totals.fresh) + '</strong></span>' +
            '<span><span class="model-stat-label">' + this.escapeHtml(copy.output) + '</span><strong>' +
            I18n.formatNumber(row.totals.output) + '</strong></span>' +
            '<span><span class="model-stat-label">' + this.escapeHtml(copy.reasoning) + '</span><strong>' +
            I18n.formatNumber(row.totals.reasoning) + '</strong></span></div></details>';
        }).join('') + '</div></div>';
      };
      return '<div class="usage-summary">' +
        this.renderCodexIndexedSubtotal(scope.indexedSubtotal) +
        '<div class="summary-grid">' +
        equivalentCostMetric +
        metric(copy.processed, scope.total.processed) +
        metric(copy.fresh, scope.total.fresh) +
        metric(copy.input, scope.total.input) +
        metric(copy.cachedInput, scope.total.cachedInput) +
        metric(
          I18n.t.popup.cacheHitRate,
          this.formatPercent(scope.total.input > 0 ? scope.cacheShare : null),
        ) +
        metric(copy.output, scope.total.output) +
        metric(copy.reasoning, scope.total.reasoning) +
        '</div>' + compositionHtml + '</div>' +
        dimension(copy.models, scope.models, true) + dimension(copy.efforts, scope.efforts, false);
    }
    if (!data) {
      return '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>';
    }

    const cost = I18n.t.popup.cost;
    const messages = I18n.t.popup.messages;
    const inputTokens = I18n.t.popup.inputTokens;
    const outputTokens = I18n.t.popup.outputTokens;
    const cacheCreation = I18n.t.popup.cacheCreation;
    const cacheRead = I18n.t.popup.cacheRead;
    const modelBreakdown = I18n.t.popup.modelBreakdown;
    const pricing = I18n.t.popup.pricing;
    const refreshPricing = I18n.t.popup.refreshPricing;

    // Cache hit rate: share of input-side tokens served cheaply from cache.
    const inputSideTokens = data.totalInputTokens + data.totalCacheCreationTokens + data.totalCacheReadTokens;
    const cacheHitRate = inputSideTokens > 0 ? (data.totalCacheReadTokens / inputSideTokens) * 100 : 0;

    // Cost composition: how each token type contributes to the total cost.
    const cb = data.costBreakdown;
    const costTotal = cb.input + cb.output + cb.cacheWrite + cb.cacheRead;
    const cpct = (v: number): number => (costTotal > 0 ? (v / costTotal) * 100 : 0);
    const compSeg = (cls: string, v: number): string =>
      '<div class="cost-comp-seg ' + cls + '" style="width: ' + cpct(v).toFixed(2) + '%;"></div>';
    const compItem = (cls: string, label: string, v: number): string =>
      '<span class="legend-item"><span class="legend-dot ' + cls + '"></span>' +
      label + ' ' + I18n.formatCurrency(v) + ' (' + cpct(v).toFixed(0) + '%)</span>';
    const costComposition =
      costTotal > 0
        ? '<div class="cost-composition">' +
          '<div class="cost-comp-head">' + I18n.t.popup.costComposition + '</div>' +
          '<div class="cost-comp-bar">' +
          compSeg('seg-input', cb.input) +
          compSeg('seg-output', cb.output) +
          compSeg('seg-cache-creation', cb.cacheWrite) +
          compSeg('seg-cache-read', cb.cacheRead) +
          '</div>' +
          '<div class="cost-comp-legend">' +
          compItem('seg-input', inputTokens, cb.input) +
          compItem('seg-output', outputTokens, cb.output) +
          compItem('seg-cache-creation', cacheCreation, cb.cacheWrite) +
          compItem('seg-cache-read', cacheRead, cb.cacheRead) +
          '</div>' +
          '</div>'
        : '';

    let html =
      '<div class="usage-summary">' +
      '<div class="summary-grid">' +
      '<div class="summary-item">' +
      '<div class="label">' +
      cost +
      '</div>' +
      '<div class="value cost">' +
      I18n.formatCurrency(data.totalCost) +
      '</div>' +
      '</div>' +
      '<div class="summary-item">' +
      '<div class="label">' +
      messages +
      '</div>' +
      '<div class="value">' +
      I18n.formatNumber(data.messageCount) +
      '</div>' +
      '</div>' +
      '<div class="summary-item">' +
      '<div class="label">' +
      inputTokens +
      '</div>' +
      '<div class="value">' +
      I18n.formatNumber(data.totalInputTokens) +
      '</div>' +
      '</div>' +
      '<div class="summary-item">' +
      '<div class="label">' +
      outputTokens +
      '</div>' +
      '<div class="value">' +
      I18n.formatNumber(data.totalOutputTokens) +
      '</div>' +
      '</div>' +
      '<div class="summary-item">' +
      '<div class="label">' +
      cacheCreation +
      '</div>' +
      '<div class="value">' +
      I18n.formatNumber(data.totalCacheCreationTokens) +
      '</div>' +
      '</div>' +
      '<div class="summary-item">' +
      '<div class="label">' +
      cacheRead +
      '</div>' +
      '<div class="value">' +
      I18n.formatNumber(data.totalCacheReadTokens) +
      '</div>' +
      '</div>' +
      '<div class="summary-item">' +
      '<div class="label">' +
      I18n.t.popup.cacheHitRate +
      '</div>' +
      '<div class="value">' +
      cacheHitRate.toFixed(0) +
      '%</div>' +
      '</div>' +
      '</div>' +
      costComposition +
      '</div>';

    if (Object.keys(data.modelBreakdown).length > 0) {
      // Sort models by cost descending so the most expensive model is on top.
      // Default state: only the top model is open; the rest collapse to one
      // line — keeps low-cost noise from pushing the dashboard long.
      const sortedModels = Object.entries(data.modelBreakdown).sort(
        ([, a], [, b]) => b.cost - a.cost
      );

      html +=
        '<div class="model-breakdown">' +
        '<div class="section-header">' +
        '<h3>' +
        modelBreakdown +
        '</h3>' +
        '<button class="btn-secondary btn-small" onclick="refreshPricing()" title="' +
        this.escapeHtml(refreshPricing) +
        '">⟳ ' +
        refreshPricing +
        '</button>' +
        '</div>' +
        '<div class="model-list">';

      sortedModels.forEach(([model, modelData], index) => {
        const rates = getModelRatesPerMillion(model);
        const pricingLine = rates
          ? '<div class="model-pricing">' +
            pricing +
            ' (/1M): ' +
            inputTokens +
            ' ' +
            this.formatRate(rates.input) +
            ' · ' +
            outputTokens +
            ' ' +
            this.formatRate(rates.output) +
            ' · ' +
            cacheCreation +
            ' ' +
            this.formatRate(rates.cacheWrite) +
            ' · ' +
            cacheRead +
            ' ' +
            this.formatRate(rates.cacheRead) +
            '</div>'
          : '';

        // Per-model cache hit rate, same formula as the summary card.
        const modelInputSide =
          modelData.inputTokens + modelData.cacheCreationTokens + modelData.cacheReadTokens;
        const modelHitRate =
          modelInputSide > 0 ? (modelData.cacheReadTokens / modelInputSide) * 100 : 0;

        // <details open> on index 0 only; subsequent models collapse so the
        // user only sees N model rows by default.
        const openAttr = index === 0 ? ' open' : '';
        html +=
          '<details class="model-item"' +
          openAttr +
          '>' +
          '<summary class="model-header">' +
          '<span class="model-name">' +
          this.escapeHtml(model) +
          '</span>' +
          '<span class="model-metric model-cost">' +
          I18n.formatCurrency(modelData.cost) +
          '</span>' +
          '</summary>' +
          '<div class="model-details model-details-stacked">' +
          '<span><span class="model-stat-label">' + inputTokens + ':</span>' +
          ' ' + I18n.formatNumber(modelData.inputTokens) + '</span>' +
          '<span><span class="model-stat-label">' + outputTokens + ':</span>' +
          ' ' + I18n.formatNumber(modelData.outputTokens) + '</span>' +
          '<span><span class="model-stat-label">' + cacheCreation + ':</span>' +
          ' ' + I18n.formatNumber(modelData.cacheCreationTokens) + '</span>' +
          '<span><span class="model-stat-label">' + cacheRead + ':</span>' +
          ' ' + I18n.formatNumber(modelData.cacheReadTokens) + '</span>' +
          '<span><span class="model-stat-label">' + I18n.t.popup.cacheHitRate + ':</span>' +
          ' ' + modelHitRate.toFixed(0) + '%</span>' +
          '<span><span class="model-stat-label">' + messages + ':</span>' +
          ' ' + I18n.formatNumber(modelData.count) + '</span>' +
          '</div>' +
          pricingLine +
          '</details>';
      });

      html += '</div></div>';
    }

    html += this.renderEfficiencyChips(data);
    return html;
  }

  private renderMonthData(provider: SettingProvider = 'claude'): string {
    if (provider === 'codex') {
      const view = this.codexView;
      const copy = I18n.t.providers.codex;
      if (!view) {
        return this.renderCodexEmptyState();
      }
      const rows = view.last30DaysDaily;
      const breakdown = rows.length === 0
        ? '<div class="no-data"><p>' + this.escapeHtml(copy.noDailyData) + '</p></div>'
        : '<div class="daily-breakdown" data-codex-time-series data-codex-last30-daily data-last30-daily><h3>' + this.escapeHtml(copy.daily) + '</h3>' +
          '<div class="chart-tabs">' +
          '<button class="chart-tab active" data-metric="cost">' + this.escapeHtml(copy.apiEquivalentCost) + '</button>' +
          '<button class="chart-tab" data-metric="inputTokens">' + this.escapeHtml(copy.processed) + '</button>' +
          '<button class="chart-tab" data-metric="outputTokens">' + this.escapeHtml(copy.fresh) + '</button>' +
          '<button class="chart-tab" data-metric="cacheCreation">' + this.escapeHtml(copy.output) + '</button>' +
          '<button class="chart-tab" data-metric="cacheRead">' + this.escapeHtml(copy.reasoning) + '</button>' +
          '<button class="chart-tab" data-metric="messages">' + this.escapeHtml(copy.threads) + '</button>' +
          '</div><div class="chart-content" id="dailyChart">' + this.renderDailyChart(provider) + '</div>' +
          this.renderCompositionChart(rows.map((row) => ({ label: row.day, data: row.total })), provider) +
          '<div class="daily-table-container" tabindex="0"><table class="daily-table"><thead><tr>' +
          '<th>' + this.escapeHtml(copy.date) + '</th><th>' + this.escapeHtml(copy.apiEquivalentCost) + '</th>' +
          '<th>' + this.escapeHtml(copy.processed) + '</th>' +
          '<th>' + this.escapeHtml(copy.fresh) + '</th><th>' + this.escapeHtml(copy.input) + '</th>' +
          '<th>' + this.escapeHtml(copy.cachedInput) + '</th><th>' + this.escapeHtml(copy.output) + '</th>' +
          '<th>' + this.escapeHtml(copy.reasoning) + '</th><th>' + this.escapeHtml(copy.threads) + '</th>' +
          '<th></th></tr></thead><tbody>' + rows.map((row) => {
            const hourly = view.last30DaysHourlyByDay[row.day];
            const canExpand = hourly !== undefined;
            const dayCoverage = view.hourlyCoverage.days[row.day] ?? view.hourlyCoverage;
            const day = this.escapeHtml(row.day);
            const detailButton = canExpand
              ? '<button class="detail-button" data-codex-hourly-toggle data-date="' + day + '" ' +
                'onclick="toggleCodexHourlyDetail(\'' + day + '\', this)" aria-expanded="false" ' +
                'aria-controls="codex-hourly-detail-' + day + '" title="' +
                this.escapeHtml(I18n.t.popup.hourlyBreakdown) + '">' +
                '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">' +
                '<path class="expand-icon" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>' +
                '</svg></button>'
              : '';
            const detailRow = canExpand
              ? '<tr class="hourly-detail-row" data-codex-hourly-detail-row data-date="' + day +
                '" style="display: none;"><td colspan="10"><div class="hourly-detail-container" ' +
                'id="codex-hourly-detail-' + day + '" data-loaded="true">' +
                this.renderCodexHourlyBreakdown(hourly, dayCoverage, row.day) +
                '</div></td></tr>'
              : '';
            return '<tr class="daily-row" data-date="' + day + '"><td class="date-cell">' + day + '</td>' +
            '<td class="cost-cell" title="' + this.escapeHtml(this.codexCostHelp(row.apiEquivalent)) + '">' +
            this.codexCostLabel(row.apiEquivalent, row.total.processed) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.processed) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.fresh) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.input) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.cachedInput) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.output) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.reasoning) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.threads) + '</td>' +
            '<td class="detail-cell">' + detailButton + '</td></tr>' + detailRow;
          }).join('') + '</tbody></table></div></div>';
      return this.renderUsageData(null, provider, view.last30Days) + breakdown;
    }
    if (!this.rolling30DayData) {
      return `<div class="no-data"><p>${I18n.t.popup.noDataMessage}</p></div>`;
    }

    const rolling30Summary = this.renderUsageData(this.rolling30DayData, provider);
    const dailyDisplayRows = completeDisplayRange(
      rollingDayKeys(Date.now(), I18n.getTimezone(), 30),
      this.dailyDataForRolling30Days,
      (row) => row.date,
      (date) => ({ date, data: emptyDisplayUsageData() }),
    );
    const expandableDays = new Set(
      dailyDisplayRows
        .filter((row) => row.observed && Object.prototype.hasOwnProperty.call(
          this.hourlyDataForRolling30DaysByDay,
          row.key,
        ))
        .map((row) => row.key),
    );

    const dailyBreakdown =
      dailyDisplayRows.length > 0
        ? `
      <div class="daily-breakdown" data-claude-last30-daily data-last30-daily>
        <h3>${I18n.t.popup.dailyBreakdown}</h3>

        <!-- Chart Tabs -->
        <div class="chart-tabs">
          <button class="chart-tab active" data-metric="cost">${I18n.t.popup.cost}</button>
          <button class="chart-tab" data-metric="inputTokens">${I18n.t.popup.inputTokens}</button>
          <button class="chart-tab" data-metric="outputTokens">${I18n.t.popup.outputTokens}</button>
          <button class="chart-tab" data-metric="cacheCreation">${I18n.t.popup.cacheCreation}</button>
          <button class="chart-tab" data-metric="cacheRead">${I18n.t.popup.cacheRead}</button>
          <button class="chart-tab" data-metric="messages">${I18n.t.popup.messages}</button>
        </div>

        <!-- Chart Container (hc-wrap is self-contained: Y-axis + gridlines + scroll) -->
        <div class="chart-content" id="dailyChart">
          ${this.renderDailyChart(
            provider,
            dailyDisplayRows.map(({ value }) => value),
            expandableDays,
          )}
        </div>

        ${this.renderCompositionChart(
          dailyDisplayRows.map(({ value: row }) => ({
            label: this.getShortDate(row.date),
            data: row.data,
          })),
          provider,
        )}

        <div class="daily-table-container" tabindex="0">
          <table class="daily-table">
            <thead>
              <tr>
                <th>${I18n.t.popup.date}</th>
                <th>${I18n.t.popup.cost}</th>
                <th>${I18n.t.popup.inputTokens}</th>
                <th>${I18n.t.popup.outputTokens}</th>
                <th>${I18n.t.popup.cacheCreation}</th>
                <th>${I18n.t.popup.cacheRead}</th>
                <th>${I18n.t.popup.cacheHitRate}</th>
                <th>${I18n.t.popup.messages}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${dailyDisplayRows
                .map(
                  ({ value: { date, data }, observed }) => `
                <tr class="daily-row" data-date="${date}">
                  <td class="date-cell">${this.formatDate(date)}</td>
                  <td class="cost-cell">${I18n.formatCurrency(data.totalCost)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalInputTokens)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalOutputTokens)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalCacheCreationTokens)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalCacheReadTokens)}</td>
                  <td class="number-cell">${this.formatPercent(this.cacheHitRate(data))}</td>
                  <td class="number-cell">${I18n.formatNumber(data.messageCount)}</td>
                  <td class="detail-cell">
                    ${expandableDays.has(date) ? `<button class="detail-button" onclick="toggleHourlyDetail('${date}')"
                      aria-expanded="false" aria-controls="hourly-detail-${date}"
                      title="${this.escapeHtml(I18n.t.popup.hourlyBreakdown)}">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
                        <path class="expand-icon" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
                      </svg>
                    </button>` : ''}
                  </td>
                </tr>
                ${expandableDays.has(date) ? `<tr class="hourly-detail-row" data-date="${date}" style="display: none;">
                  <td colspan="9">
                    <div class="hourly-detail-container" id="hourly-detail-${date}">
                      <div class="loading-indicator">${this.escapeHtml(I18n.t.statusBar.loading)}</div>
                    </div>
                  </td>
                </tr>` : ''}
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
        : '';

    return rolling30Summary + dailyBreakdown;
  }

  private renderCodexMonthDailyDetail(
    month: string,
    rows: CodexDailyUsageView[],
  ): string {
    const view = this.codexView;
    const copy = I18n.t.providers.codex;
    if (!view || rows.length === 0) {
      return '<div class="no-data"><p>' + this.escapeHtml(copy.noDailyData) + '</p></div>';
    }
    const chartRows = rows.map((row) => ({
      date: row.day,
      data: { total: row.total, apiEquivalent: row.apiEquivalent, threads: row.threads },
    }));
    const partial = view.allTime.indexedSubtotal
      ? '<p class="model-details">' + this.escapeHtml(copy.partial) + '</p>'
      : '';
    const tableRows = rows.map((row) => {
      const hourly = view.last30DaysHourlyByDay[row.day];
      const canExpand = hourly !== undefined;
      const dayCoverage = view.hourlyCoverage.days[row.day] ?? view.hourlyCoverage;
      const day = this.escapeHtml(row.day);
      const detailId = 'codex-alltime-hourly-detail-' + day;
      const detailButton = canExpand
        ? '<button class="detail-button" data-codex-hourly-toggle data-date="' + day + '" ' +
          'onclick="toggleCodexHourlyDetail(\'' + day + '\', this)" aria-expanded="false" ' +
          'aria-controls="' + detailId + '" title="' +
          this.escapeHtml(I18n.t.popup.hourlyBreakdown) + '">' +
          '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">' +
          '<path class="expand-icon" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>' +
          '</svg></button>'
        : '';
      const detailRow = canExpand
        ? '<tr class="hourly-detail-row" data-codex-hourly-detail-row data-date="' + day +
          '" style="display: none;"><td colspan="10"><div class="hourly-detail-container" ' +
          'id="' + detailId + '" data-loaded="true">' +
          this.renderCodexHourlyBreakdown(hourly, dayCoverage, row.day) +
          '</div></td></tr>'
        : '';
      return '<tr class="daily-row" data-date="' + day + '"><td class="date-cell">' +
        this.escapeHtml(this.formatDate(row.day)) + '</td>' +
        '<td class="cost-cell" title="' + this.escapeHtml(this.codexCostHelp(row.apiEquivalent)) + '">' +
        this.codexCostLabel(row.apiEquivalent, row.total.processed) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(row.total.processed) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(row.total.fresh) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(row.total.input) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(row.total.cachedInput) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(row.total.output) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(row.total.reasoning) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(row.threads) + '</td>' +
        '<td class="detail-cell">' + detailButton + '</td></tr>' + detailRow;
    }).join('');
    return '<div class="daily-breakdown" data-codex-time-series data-codex-alltime-daily ' +
      'data-month="' + this.escapeHtml(month) + '"><h4>' +
      this.escapeHtml(this.formatDate(month, true) + ' · ' + I18n.t.popup.dailyBreakdown) + '</h4>' +
      partial + '<div class="chart-tabs">' +
      '<button class="chart-tab active" data-metric="cost">' + this.escapeHtml(copy.apiEquivalentCost) + '</button>' +
      '<button class="chart-tab" data-metric="inputTokens">' + this.escapeHtml(copy.processed) + '</button>' +
      '<button class="chart-tab" data-metric="outputTokens">' + this.escapeHtml(copy.fresh) + '</button>' +
      '<button class="chart-tab" data-metric="cacheCreation">' + this.escapeHtml(copy.output) + '</button>' +
      '<button class="chart-tab" data-metric="cacheRead">' + this.escapeHtml(copy.reasoning) + '</button>' +
      '<button class="chart-tab" data-metric="messages">' + this.escapeHtml(copy.threads) + '</button>' +
      '</div><div class="chart-content" id="codex-daily-chart-' + this.escapeHtml(month) + '">' +
      this.renderMainCostChart(chartRows, false, 'codex') + '</div>' +
      this.renderCompositionChart(rows.map((row) => ({
        label: this.getShortDate(row.day),
        data: row.total,
        key: Object.prototype.hasOwnProperty.call(view.last30DaysHourlyByDay, row.day)
          ? row.day
          : undefined,
      })), 'codex', 'codex-hour') +
      '<div class="daily-table-container" tabindex="0"><table class="daily-table"><thead><tr>' +
      '<th>' + this.escapeHtml(copy.date) + '</th><th>' + this.escapeHtml(copy.apiEquivalentCost) + '</th>' +
      '<th>' + this.escapeHtml(copy.processed) + '</th><th>' + this.escapeHtml(copy.fresh) + '</th>' +
      '<th>' + this.escapeHtml(copy.input) + '</th><th>' + this.escapeHtml(copy.cachedInput) + '</th>' +
      '<th>' + this.escapeHtml(copy.output) + '</th><th>' + this.escapeHtml(copy.reasoning) + '</th>' +
      '<th>' + this.escapeHtml(copy.threads) + '</th><th></th></tr></thead><tbody>' + tableRows +
      '</tbody></table></div></div>';
  }

  private renderAllTimeData(provider: SettingProvider = 'claude'): string {
    if (provider === 'codex') {
      const view = this.codexView;
      const copy = I18n.t.providers.codex;
      if (!view) {
        return this.renderCodexEmptyState();
      }
      const rows = view.monthly;
      const breakdown = rows.length === 0
        ? '<div class="no-data"><p>' + this.escapeHtml(copy.noMonthlyData) + '</p></div>'
        : '<div class="daily-breakdown" data-codex-time-series><h3>' + this.escapeHtml(copy.monthly) + '</h3>' +
          '<div class="chart-tabs">' +
          '<button class="chart-tab active" data-metric="cost">' + this.escapeHtml(copy.apiEquivalentCost) + '</button>' +
          '<button class="chart-tab" data-metric="inputTokens">' + this.escapeHtml(copy.processed) + '</button>' +
          '<button class="chart-tab" data-metric="outputTokens">' + this.escapeHtml(copy.fresh) + '</button>' +
          '<button class="chart-tab" data-metric="cacheCreation">' + this.escapeHtml(copy.output) + '</button>' +
          '<button class="chart-tab" data-metric="cacheRead">' + this.escapeHtml(copy.reasoning) + '</button>' +
          '<button class="chart-tab" data-metric="messages">' + this.escapeHtml(copy.threads) + '</button>' +
          '</div><div class="chart-content" id="allTimeChart">' + this.renderAllTimeChart(provider) + '</div>' +
          this.renderCompositionChart(
            rows.map((row) => ({ label: row.period, data: row.total, key: row.period })),
            provider,
          ) +
          '<div class="daily-table-container" tabindex="0"><table class="daily-table"><thead><tr>' +
          '<th>' + this.escapeHtml(copy.date) + '</th><th>' + this.escapeHtml(copy.apiEquivalentCost) + '</th>' +
          '<th>' + this.escapeHtml(copy.processed) + '</th>' +
          '<th>' + this.escapeHtml(copy.fresh) + '</th><th>' + this.escapeHtml(copy.input) + '</th>' +
          '<th>' + this.escapeHtml(copy.cachedInput) + '</th><th>' + this.escapeHtml(copy.output) + '</th>' +
          '<th>' + this.escapeHtml(copy.reasoning) + '</th><th>' + this.escapeHtml(copy.threads) + '</th><th></th>' +
          '</tr></thead><tbody>' + rows.map((row) => {
            const month = this.escapeHtml(row.period);
            return '<tr class="daily-row" data-date="' + month + '"><td class="date-cell">' + month + '</td>' +
            '<td class="cost-cell" title="' + this.escapeHtml(this.codexCostHelp(row.apiEquivalent)) + '">' +
            this.codexCostLabel(row.apiEquivalent, row.total.processed) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.processed) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.fresh) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.input) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.cachedInput) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.output) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.total.reasoning) + '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(row.threads) + '</td>' +
            '<td class="detail-cell"><button class="detail-button" onclick="toggleMonthlyDetail(\'' + month + '\')" ' +
            'aria-expanded="false" aria-controls="monthly-detail-' + month + '" title="' +
            this.escapeHtml(I18n.t.popup.dailyBreakdown) + '">' +
            '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">' +
            '<path class="expand-icon" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>' +
            '</svg></button></td></tr>' +
            '<tr class="monthly-detail-row" data-date="' + month + '" style="display: none;">' +
            '<td colspan="10"><div class="monthly-detail-container" id="monthly-detail-' + month + '">' +
            '<div class="loading-indicator">' + this.escapeHtml(I18n.t.statusBar.loading) + '</div>' +
            '</div></td></tr>';
          }).join('') + '</tbody></table></div></div>';
      return this.renderUsageData(null, provider, view.allTime) +
        this.renderWeeklyValuePanel(provider) + breakdown;
    }
    if (!this.allTimeData) {
      return `<div class="no-data"><p>${I18n.t.popup.noDataMessage}</p></div>`;
    }

    const allTimeSummary = this.renderUsageData(this.allTimeData, provider);

    // With both providers available, sharing has one home in Compare. A
    // Claude-only installation receives the exact same workspace here.
    const sharingWorkspace =
      !this.providerAvailability.codexData &&
      (this.setting<boolean>('enableShareCard', true) || this.sharingWorkspaceRequested)
        ? this.renderSharingWorkspace()
        : '';

    const dailyBreakdown =
      this.dailyDataForAllTime.length > 0
        ? `
      <div class="daily-breakdown">
        <h3>${I18n.t.popup.monthlyBreakdown}</h3>

        <!-- Chart Tabs -->
        <div class="chart-tabs">
          <button class="chart-tab active" data-metric="cost">${I18n.t.popup.cost}</button>
          <button class="chart-tab" data-metric="inputTokens">${I18n.t.popup.inputTokens}</button>
          <button class="chart-tab" data-metric="outputTokens">${I18n.t.popup.outputTokens}</button>
          <button class="chart-tab" data-metric="cacheCreation">${I18n.t.popup.cacheCreation}</button>
          <button class="chart-tab" data-metric="cacheRead">${I18n.t.popup.cacheRead}</button>
          <button class="chart-tab" data-metric="messages">${I18n.t.popup.messages}</button>
        </div>

        <!-- Chart Container (hc-wrap is self-contained: Y-axis + gridlines + scroll) -->
        <div class="chart-content" id="allTimeChart">
          ${this.renderAllTimeChart(provider)}
        </div>

        ${this.renderCompositionChart(
          [...this.dailyDataForAllTime]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((d) => ({ label: this.getShortDate(d.date, true), data: d.data, key: d.date })),
          provider,
        )}

        <div class="daily-table-container" tabindex="0">
          <table class="daily-table">
            <thead>
              <tr>
                <th>${I18n.t.popup.date}</th>
                <th>${I18n.t.popup.cost}</th>
                <th>${I18n.t.popup.inputTokens}</th>
                <th>${I18n.t.popup.outputTokens}</th>
                <th>${I18n.t.popup.cacheCreation}</th>
                <th>${I18n.t.popup.cacheRead}</th>
                <th>${I18n.t.popup.cacheHitRate}</th>
                <th>${I18n.t.popup.messages}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${this.dailyDataForAllTime
                .map(
                  ({ date, data }) => `
                <tr class="daily-row" data-date="${date}">
                  <td class="date-cell">${this.formatDate(date, true)}</td>
                  <td class="cost-cell">${I18n.formatCurrency(data.totalCost)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalInputTokens)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalOutputTokens)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalCacheCreationTokens)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalCacheReadTokens)}</td>
                  <td class="number-cell">${this.formatPercent(this.cacheHitRate(data))}</td>
                  <td class="number-cell">${I18n.formatNumber(data.messageCount)}</td>
                  <td class="detail-cell">
                    <button class="detail-button" onclick="toggleMonthlyDetail('${date}')"
                      aria-expanded="false" aria-controls="monthly-detail-${date}"
                      title="${this.escapeHtml(I18n.t.popup.dailyBreakdown)}">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
                        <path class="expand-icon" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
                      </svg>
                    </button>
                  </td>
                </tr>
                <tr class="monthly-detail-row" data-date="${date}" style="display: none;">
                  <td colspan="9">
                    <div class="monthly-detail-container" id="monthly-detail-${date}">
                      <div class="loading-indicator">${this.escapeHtml(I18n.t.statusBar.loading)}</div>
                    </div>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
        : '';

    return allTimeSummary + this.renderWeeklyValuePanel(provider) +
      sharingWorkspace + dailyBreakdown;
  }

  private weeklyValuePoints(provider: SettingProvider): WeeklyValuePoint[] {
    const now = Date.now();
    const inputs = provider === 'codex'
      ? this.codexView?.weeklyValueInputs
      : {
          observations: this.claudeWeeklyQuotaHistory,
          usage: claudeWeeklyEquivalentUsage(this.allRecords),
        };
    if (!inputs) {
      return [];
    }
    return buildWeeklyValueTimeline(provider, inputs, { now });
  }

  /** Shared reset-aligned allowance-value renderer for Claude and Codex. The
   * chart deliberately reuses the dashboard's existing stacked-bar classes:
   * blue is observed use, green is the inferred unused share. */
  private renderWeeklyValuePanel(provider: SettingProvider): string {
    if (!this.setting<boolean>('showWeeklyEquivalentValue', true)) {
      return '';
    }
    const copy = I18n.t.weeklyValue;
    const points = this.weeklyValuePoints(provider);
    const providerLabel = provider === 'codex'
      ? I18n.t.providers.codexBeta
      : I18n.t.providers.claude;
    const heading = this.escapeHtml(`${copy.title} · ${providerLabel}`);
    const notes = [
      copy.description,
      copy.historyFromLogs,
      ...(points.some((point) => point.basis === 'calendar-usage')
        ? [copy.calendarFallback]
        : []),
      ...(provider === 'codex' ? [copy.multiAccount] : []),
      ...(provider === 'codex' && points.some((point) => point.boundaryUncertain)
        ? [copy.boundaryApproximation]
        : []),
      ...(provider === 'codex' && this.codexView && !this.codexView.periodCoverage.allTime.complete
        ? [copy.indexedSubtotal]
        : []),
    ].map((line) => this.escapeHtml(line)).join('<br>');
    if (points.length === 0) {
      return '<div class="daily-breakdown"><div class="section-header"><h3>' +
        heading + '</h3></div><p class="table-hint">' + notes + '</p>' +
        '<div class="no-data"><p>' + this.escapeHtml(copy.noData) + '</p></div></div>';
    }

    const dateLabel = (value: number, short = false, dateOnly = false): string => {
      try {
        return new Intl.DateTimeFormat(I18n.getLocale(), {
          ...(short
            ? { month: 'short' as const, day: 'numeric' as const }
            : dateOnly
              ? {
                  year: 'numeric' as const,
                  month: 'short' as const,
                  day: 'numeric' as const,
                }
              : {
                year: 'numeric' as const,
                month: 'short' as const,
                day: 'numeric' as const,
                hour: '2-digit' as const,
                minute: '2-digit' as const,
              }),
          timeZone: I18n.getTimezone(),
        }).format(new Date(value));
      } catch {
        return new Date(value).toISOString().slice(0, 10);
      }
    };
    const periodLabel = (point: WeeklyValuePoint, short = false): string => {
      if (point.current) {
        if (short) {
          return copy.currentPeriodShort;
        }
        const range = dateLabel(point.windowStart, false, true) + ' – ' +
          dateLabel(point.resetAt - 1, false, true);
        return point.basis === 'quota-observation'
          ? `${copy.currentPeriod} · ${range} (${copy.resetsAt} ${dateLabel(point.resetAt)})`
          : `${copy.currentPeriod} · ${range}`;
      }
      return dateLabel(point.windowStart, short, true) + ' – ' +
        dateLabel(point.resetAt - 1, short, true);
    };
    const confidenceLabel = (point: WeeklyValuePoint): string => {
      if (point.boundaryUncertain) {
        return point.fullEquivalentUsd === null
          ? `${copy.usageOnly} · ${copy.boundaryApproximate}`
          : `${copy.low} · ${copy.boundaryApproximate}`;
      }
      switch (point.confidence) {
        case 'high': return copy.high;
        case 'medium': return copy.medium;
        case 'low': return copy.low;
        default: return copy.usageOnly;
      }
    };
    const chartPoints = points.slice(0, 8).reverse();
    const maxValue = Math.max(
      1,
      ...chartPoints.map((point) =>
        point.unusedEquivalentUsd !== null && point.fullEquivalentUsd !== null
          ? point.fullEquivalentUsd
          : point.usedEquivalentUsd,
      ),
    );
    const maxHeight = 120;
    const bars = chartPoints.map((point) => {
      const total = point.unusedEquivalentUsd !== null && point.fullEquivalentUsd !== null
        ? Math.max(point.usedEquivalentUsd, point.fullEquivalentUsd)
        : point.usedEquivalentUsd;
      const barHeight = total > 0 ? (total / maxValue) * maxHeight : 0;
      const usedHeight = total > 0
        ? Math.min(barHeight, (point.usedEquivalentUsd / total) * barHeight)
        : 0;
      const unusedHeight = Math.max(0, barHeight - usedHeight);
      const usedLabel = point.usageAvailable === false
        ? '—'
        : I18n.formatCurrency(point.usedEquivalentUsd);
      const title = `${periodLabel(point)} · ${copy.usedValue}: ${usedLabel}`;
      return '<div class="hc-col"><div class="stack-bar" title="' +
        this.escapeHtml(title) + '">' +
        '<div class="stack-seg seg-input" style="height:' + usedHeight.toFixed(2) + 'px"></div>' +
        (point.unusedEquivalentUsd !== null
          ? '<div class="stack-seg seg-cache-read" style="height:' + unusedHeight.toFixed(2) + 'px"></div>'
          : '') +
        '</div></div>';
    }).join('');
    const xlabels = chartPoints.map((point) =>
      '<div class="hc-xlabel">' + this.escapeHtml(periodLabel(point, true)) + '</div>',
    ).join('');
    const legend = (cls: string, label: string): string =>
      '<span class="legend-item"><span class="legend-dot ' + cls + '"></span>' +
      this.escapeHtml(label) + '</span>';
    const chart = '<div class="composition-chart"><div class="stack-legend">' +
      legend('seg-input', copy.usedValue) +
      (chartPoints.some((point) => point.unusedEquivalentUsd !== null)
        ? legend('seg-cache-read', copy.unusedValue)
        : '') +
      '</div><div class="hc-wrap"><div class="hc-yaxis"><span class="hc-yval">' +
      I18n.formatCurrency(maxValue) + '</span><span class="hc-yval">' +
      I18n.formatCurrency(maxValue / 2) + '</span><span class="hc-yval">' +
      I18n.formatCurrency(0) + '</span></div>' +
      '<div class="hc-main"><div class="hc-scroll" tabindex="0"><div class="hc-plot">' +
      '<div class="hc-grid hc-grid-top"></div><div class="hc-grid hc-grid-mid"></div>' +
      '<div class="hc-bars">' + bars + '</div></div><div class="hc-xlabels">' +
      xlabels + '</div></div></div></div></div>';
    const dash = '—';
    const tableRows = points.map((point) =>
      '<tr><td class="date-cell">' + this.escapeHtml(periodLabel(point)) + '</td>' +
      '<td class="cost-cell">' +
      (point.usageAvailable === false ? dash : I18n.formatCurrency(point.usedEquivalentUsd)) + '</td>' +
      '<td class="number-cell">' +
      (point.utilizationPercent === null ? dash : this.formatPercent(point.utilizationPercent / 100)) + '</td>' +
      '<td class="cost-cell">' +
      (point.fullEquivalentUsd === null ? dash : I18n.formatCurrency(point.fullEquivalentUsd)) + '</td>' +
      '<td class="cost-cell">' +
      (point.unusedEquivalentUsd === null ? dash : I18n.formatCurrency(point.unusedEquivalentUsd)) + '</td>' +
      '<td>' + this.escapeHtml(confidenceLabel(point)) + '</td>' +
      '<td class="number-cell">' + this.formatPercent(point.pricingCoverage) + '</td></tr>',
    ).join('');
    return '<div class="daily-breakdown"><div class="section-header"><h3>' + heading +
      '</h3></div><p class="table-hint">' + notes + '</p>' + chart +
      '<details class="weekly-value-details"><summary>' + this.escapeHtml(copy.periodDetails) +
      '</summary><div class="daily-table-container" tabindex="0"><table class="daily-table"><thead><tr>' +
      '<th>' + this.escapeHtml(copy.period) + '</th><th>' + this.escapeHtml(copy.usedValue) + '</th>' +
      '<th>' + this.escapeHtml(copy.utilization) + '</th><th>' + this.escapeHtml(copy.fullValue) + '</th>' +
      '<th>' + this.escapeHtml(copy.unusedValue) + '</th><th>' + this.escapeHtml(copy.confidence) + '</th>' +
      '<th>' + this.escapeHtml(copy.pricingCoverage) + '</th></tr></thead><tbody>' +
      tableRows + '</tbody></table></div></details></div>';
  }

  /** Claude's legacy Share Card remains a provider-truthful presentation inside
   * the one sharing workspace. Its complete preview precedes every control. */
  private renderShareCardPanel(selected: SharingTemplate): string {
    const esc = (s: string): string => this.escapeHtml(s);
    const copy = I18n.sharingWorkspace;
    const combinedCopy = combinedHeatmapUiCopy(I18n.getLocale());

    // Range: grouped like the scope dropdown — rolling presets vs. a specific
    // calendar month (last 12), so the two kinds are visually distinct.
    const now = new Date();
    const monthOpts: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString(I18n.getLocale(), { month: 'long', year: 'numeric' });
      monthOpts.push(`<option value="month:${key}">${esc(label)}${i === 1 ? ' (' + esc(copy.lastMonthSuffix) + ')' : ''}</option>`);
    }
    // Rehydrate the last config so an auto-refresh re-render doesn't wipe the
    // user's picks or their generated preview (Carl: refresh shouldn't blow away
    // human-operated output). Default range is the last 30 days.
    const cfg = this.lastShareCardConfig;
    const curRange = cfg?.range || 'last30';
    const curScope = cfg?.scope || 'all';
    const secOn = (key: string, dflt: boolean): boolean => (cfg?.sections?.[key] ?? dflt);
    const sel = (v: string, cur: string): string => (v === cur ? ' selected' : '');

    const rangeSelect =
      '<select id="scRange">' +
      '<optgroup label="' + esc(copy.rangeRollingGroup) + '">' +
      '<option value="last30"' + sel('last30', curRange) + '>' + esc(combinedCopy.last30) + '</option>' +
      '<option value="week"' + sel('week', curRange) + '>' + esc(copy.last7) + '</option>' +
      '<option value="month"' + sel('month', curRange) + '>' + esc(copy.thisMonth) + '</option>' +
      '<option value="year"' + sel('year', curRange) + '>' + esc(copy.last12Months) + '</option>' +
      '<option value="today"' + sel('today', curRange) + '>' + esc(copy.todayHourly) + '</option>' +
      '</optgroup>' +
      '<optgroup label="' + esc(copy.rangeSpecificMonthGroup) + '">' +
      monthOpts.map((o) => o.replace('>', sel(o.match(/value="([^"]+)"/)?.[1] || '', curRange) + '>')).join('') +
      '</optgroup>' +
      '</select>';

    // Scope: overall / by project / by session (top few by cost).
    const projectOpts = (this.projectBreakdown || [])
      .map((g) => `<option value="project:${esc(g.groupPath)}"${sel('project:' + g.groupPath, curScope)}>${esc(g.groupName)}</option>`)
      .join('');
    const sessionOpts = (this.sessionBreakdown || [])
      .slice()
      .sort((a, b) => b.data.totalCost - a.data.totalCost)
      .slice(0, 20)
      .map((s) => `<option value="session:${esc(s.sessionId)}"${sel('session:' + s.sessionId, curScope)}>${esc((s.title || s.sessionId).slice(0, 48))}</option>`)
      .join('');
    const scopeSelect =
      '<select id="scScope">' +
      '<optgroup label="' + esc(copy.scopeAllGroup) + '"><option value="all"' + sel('all', curScope) + '>' + esc(copy.overall) + '</option></optgroup>' +
      (projectOpts ? '<optgroup label="' + esc(copy.byProject) + '">' + projectOpts + '</optgroup>' : '') +
      (sessionOpts ? '<optgroup label="' + esc(copy.bySession) + '">' + sessionOpts + '</optgroup>' : '') +
      '</select>';

    // Section toggles. Default ON: cost, cache-hit, model (+ the token hero,
    // rhythm, badge). Optional: sessions, messages, composition, project.
    const check = (key: string, label: string, dflt: boolean): string =>
      '<label class="sc-check"><input type="checkbox" class="sc-sec" data-sec="' + key + '"' +
      (secOn(key, dflt) ? ' checked' : '') + '> ' + esc(label) + '</label>';
    const toggles =
      check('totalTokens', copy.totalTokens, true) +
      check('estimatedCost', copy.estimatedCost, true) +
      check('cacheEfficiency', copy.cacheHitRate, true) +
      check('topModel', copy.topModel, true) +
      check('sessions', copy.sessionCount, true) +
      check('tokenComposition', copy.tokenMix, true) +
      check('rhythm', copy.dailyPulse, true) +
      check('badge', copy.badge, true) +
      check('messages', copy.messageCount, false) +
      check('projectName', copy.projectName, false);
    const fullChecked = cfg?.fullNumbers ? ' checked' : '';
    const curTheme = cfg?.theme || 'claudeClassic';
    const themeSelect =
      '<select id="scTheme">' +
      '<option value="claudeClassic"' + sel('claudeClassic', curTheme) + '>' + esc(copy.claudeClassic) + '</option>' +
      '<option value="claudeCream"' + sel('claudeCream', curTheme) + '>' + esc(copy.claudeCream) + '</option>' +
      '<option value="auroraDark"' + sel('auroraDark', curTheme) + '>' + esc(copy.auroraDark) + '</option>' +
      '<option value="auto"' + sel('auto', curTheme) + '>' + esc(copy.autoTheme) + '</option>' +
      '</select>';

    const sections: Record<string, boolean> = {
      totalTokens: secOn('totalTokens', true),
      estimatedCost: secOn('estimatedCost', true),
      cacheEfficiency: secOn('cacheEfficiency', true),
      topModel: secOn('topModel', true),
      sessions: secOn('sessions', true),
      tokenComposition: secOn('tokenComposition', true),
      rhythm: secOn('rhythm', true),
      badge: secOn('badge', true),
      messages: secOn('messages', false),
      projectName: secOn('projectName', false),
    };
    const day = dayKeyInZone(now, I18n.getTimezone());
    const cachedPreview = this.shareCardPreviewCache;
    let preview = cachedPreview?.records === this.allRecords &&
      cachedPreview.day === day && cachedPreview.timeZone === I18n.getTimezone() &&
      cachedPreview.locale === I18n.getLocale() &&
      cachedPreview.themeKind === vscode.window.activeColorTheme?.kind
      ? cachedPreview.svg : undefined;
    if (!preview) {
      try {
        preview = this.buildShareCardSvgFor(curRange, curScope, sections, {
          fullNumbers: cfg?.fullNumbers,
          theme: curTheme as ShareCardTheme,
        });
        this.shareCardPreviewCache = {
          records: this.allRecords,
          day,
          timeZone: I18n.getTimezone(),
          locale: I18n.getLocale(),
          themeKind: vscode.window.activeColorTheme?.kind,
          svg: preview,
        };
      } catch {
        preview = '<p class="table-hint">' + esc(copy.previewPending) + '</p>';
      }
    }

    return (
      '<section class="sharing-presentation claude-share-card-presentation" data-sharing-presentation="claudeShareCard"' +
      (selected === 'claudeShareCard' ? '' : ' hidden') + ' aria-labelledby="claudeShareCardHeading">' +
      '<h3 id="claudeShareCardHeading" class="sharing-presentation-title">' + esc(copy.claudeCardPresentation) + '</h3>' +
      '<p class="sharing-presentation-description">' + esc(copy.claudeCardPresentationDescription) + '</p>' +
      '<div class="combined-preview-toolbar"><strong>' + esc(combinedCopy.previewLabel) + '</strong></div>' +
      '<div class="share-preview sharing-artifact-preview" id="scPreview" role="region" tabindex="0" aria-label="' +
      esc(copy.claudeCardPresentation + ' · ' + combinedCopy.previewLabel) + '">' + preview + '</div>' +
      '<div class="sc-config sharing-controls-panel" aria-label="' + esc(combinedCopy.settingsLabel) + '">' +
      '<h4>' + esc(combinedCopy.settingsLabel) + '</h4>' +
      '<div class="sc-grid">' +
      '<label class="sc-field"><span>' + esc(combinedCopy.rangeLabel) + '</span>' + rangeSelect + '</label>' +
      '<label class="sc-field"><span>' + esc(copy.scopeLabel) + '</span>' + scopeSelect + '</label>' +
      '<label class="sc-field"><span>' + esc(copy.themeLabel) + '</span>' + themeSelect + '</label>' +
      '</div>' +
      '<fieldset class="sc-checks"><legend class="sr-only">' + esc(copy.cardContentsLabel) + '</legend>' + toggles +
      '<label class="sc-check" title="' + esc(copy.fullNumbersHelp) + '"><input type="checkbox" id="scFull"' + fullChecked + '> ' + esc(copy.fullNumbers) + '</label>' +
      '</fieldset>' +
      '<div class="share-actions">' +
      '<button class="btn-primary btn-small" onclick="generateShareCard()">' + esc(combinedCopy.updatePreview) + '</button>' +
      '<button class="btn-secondary btn-small" onclick="exportShareCardConfigured()">' + esc(combinedCopy.exportSvg) + '</button>' +
      '</div></div></section>'
    );
  }

  private renderClaudeHeatmapPresentation(selected: SharingTemplate): string {
    const copy = I18n.sharingWorkspace;
    const combinedCopy = combinedHeatmapUiCopy(I18n.getLocale());
    const day = dayKeyInZone(new Date(), I18n.getTimezone());
    const cachedPreview = this.claudeHeatmapPreviewCache;
    let svg = cachedPreview?.dailyRows === this.dailyDataForEveryDay &&
      cachedPreview.day === day && cachedPreview.timeZone === I18n.getTimezone() &&
      cachedPreview.locale === I18n.getLocale()
      ? cachedPreview.svg : undefined;
    if (!svg) {
      const daily = this.getClaudeDailyUsageMap(I18n.getTimezone());
      svg = renderHeatmapSvg(daily, {
        endDateISO: dayKeyInZone(new Date(), I18n.getTimezone()),
        locale: I18n.getLocale(),
      });
      this.claudeHeatmapPreviewCache = {
        dailyRows: this.dailyDataForEveryDay,
        day,
        timeZone: I18n.getTimezone(),
        locale: I18n.getLocale(),
        svg,
      };
    }
    return '<section class="sharing-presentation claude-heatmap-presentation" data-sharing-presentation="claudeHeatmap"' +
      (selected === 'claudeHeatmap' ? '' : ' hidden') + ' aria-labelledby="claudeHeatmapHeading">' +
      '<h3 id="claudeHeatmapHeading" class="sharing-presentation-title">' + this.escapeHtml(copy.claudeHeatmapPresentation) + '</h3>' +
      '<p class="sharing-presentation-description">' + this.escapeHtml(copy.claudeHeatmapPresentationDescription) + '</p>' +
      '<div class="combined-preview-toolbar"><strong>' + this.escapeHtml(combinedCopy.previewLabel) + '</strong></div>' +
      '<div id="claudeHeatmapPreview" class="heatmap-svg combined-heatmap-preview sharing-artifact-preview" role="region" tabindex="0" aria-label="' +
      this.escapeHtml(copy.claudeHeatmapPresentation + ' · ' + combinedCopy.previewLabel) + '">' + svg + '</div>' +
      '<p class="combined-activity-disclaimer">' + this.escapeHtml(copy.claudeHeatmapDisclaimer) + '</p>' +
      '<div class="sharing-controls-panel claude-heatmap-actions" aria-label="' + this.escapeHtml(combinedCopy.settingsLabel) + '">' +
      '<div class="share-actions">' +
      '<button class="btn-secondary btn-small" onclick="exportHeatmap()">' + this.escapeHtml(combinedCopy.exportSvg) + '</button>' +
      '<button class="btn-secondary btn-small" onclick="publishHeatmap()">' + this.escapeHtml(copy.publishGitHub) + '</button>' +
      '</div></div></section>';
  }

  /** The Compare and Claude heatmaps consume the same per-day projection.
   * Share it across Webview renders; a changed record array is invalidated by
   * updateData, and the timezone remains part of the cache identity. */
  private getClaudeDailyUsageMap(timeZone: string): ReturnType<typeof ClaudeDataLoader.getDailyUsageMap> {
    const cached = this.claudeDailyUsageCache;
    if (cached?.dailyRows === this.dailyDataForEveryDay && cached.timeZone === timeZone) {
      return cached.daily;
    }
    const daily = Object.fromEntries(this.dailyDataForEveryDay.map(({ date, data }) => [
      date,
      {
        tokens: data.totalInputTokens + data.totalOutputTokens +
          data.totalCacheCreationTokens + data.totalCacheReadTokens,
        cost: data.totalCost,
        // The unified sharing surfaces currently render token activity only.
        // Do not invent a distinct-session count from message aggregates.
        sessions: 0,
      },
    ]));
    this.claudeDailyUsageCache = {
      dailyRows: this.dailyDataForEveryDay,
      timeZone,
      daily,
    };
    return daily;
  }

  /** Build the share-card SVG from already-indexed local usage. Shared by the
   * preview (postMessage back) and local export paths. */
  private buildShareCardSvgFor(
    range: string,
    scope: string,
    sections: Partial<ShareSections>,
    opts: { avatarDataUri?: string; username?: string; fullNumbers?: boolean; theme?: ShareCardTheme } = {}
  ): string {
    const input = ClaudeDataLoader.buildShareInput(this.allRecords, range, scope);
    const merged: ShareSections = { ...DEFAULT_SECTIONS, ...sections };
    const kind = vscode.window.activeColorTheme?.kind;
    const isDark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
    // Landscape only for now (other sizes need per-size tuning — a later patch).
    return renderShareCardSvg(buildShareCardData(input, merged), {
      ...opts,
      isDark,
      lang: I18n.getLocale(),
      formatCurrency: (amountUsd) => I18n.formatCurrency(amountUsd),
    });
  }

  private renderSessionData(provider: SettingProvider = 'claude'): string {
    if (provider === 'codex') {
      const copy = I18n.t.providers.codex;
      const sessions = this.codexView?.recentThreads ?? [];
      const subtotal = this.renderCodexIndexedSubtotal(
        this.codexView?.allTime.indexedSubtotal,
      );
      if (sessions.length === 0) {
        return subtotal + '<div class="no-data"><p>' + this.escapeHtml(copy.noThreadData) + '</p></div>';
      }
      const formatters = createCodexLocalizedFormatters(I18n.getLocale(), I18n.getTimezone());
      const role = (value: CodexThreadUsageView['role']): string => {
        if (value === 'root') return copy.rootRole;
        if (value === 'subagent') return copy.childRole;
        if (value === 'approval-reviewer') return copy.approvalReviewerRole;
        return copy.unknownRole;
      };
      const models = [...new Set(sessions.flatMap((session) => session.models))].sort();
      const filterBar = '<div class="sess-filters"><div class="sess-filter" data-group="range">' +
        '<button class="sess-filter-btn active" data-range="all" onclick="sessionRange(this)">' + this.escapeHtml(copy.all) + '</button>' +
        '<button class="sess-filter-btn" data-range="7" onclick="sessionRange(this)">' + this.escapeHtml(copy.last7Days) + '</button>' +
        '<button class="sess-filter-btn" data-range="30" onclick="sessionRange(this)">' + this.escapeHtml(copy.last30Days) + '</button>' +
        '</div>' + (models.length > 0
          ? '<select class="sess-model-select" title="' + this.escapeHtml(copy.models) +
            '" aria-label="' + this.escapeHtml(copy.models) + '" onchange="sessionModel(this)">' +
            '<option value="all">' + this.escapeHtml(copy.all + ' ' + copy.models) + '</option>' +
            models.map((model) => '<option value="' + this.escapeHtml(model.toLowerCase()) + '">' + this.escapeHtml(model) + '</option>').join('') +
            '</select>'
          : '') + '</div>';
      const rows = sessions.map((session) => {
        const title = session.title ?? session.agentNickname ?? copy.unnamedSession;
        const project = session.projectName ?? copy.unidentifiedProject;
        const model = session.models.join(', ') || copy.unavailable;
        const effort = session.efforts.join(', ') || copy.unavailable;
        const detailId = 'session-detail-' + session.viewKey;
        const detail = (label: string, value: string): string =>
          '<span data-session-detail-item><span class="model-stat-label">' + this.escapeHtml(label) +
          '</span><strong title="' + this.escapeHtml(value) + '">' + this.escapeHtml(value) + '</strong></span>';
        const mainRow = '<tr class="sort-row" data-session-row data-sort-time="' + session.observedAt + '" ' +
          'data-day-key="' + this.escapeHtml(this.configuredDateTimeParts(new Date(session.observedAt)).dayKey) + '" ' +
          'data-sort-session="' + this.escapeHtml(title.toLowerCase()) + '" ' +
          'data-sort-project="' + this.escapeHtml(project.toLowerCase()) + '" ' +
          'data-sort-role="' + this.escapeHtml(session.role) + '" ' +
          'data-sort-processed="' + session.total.processed + '" data-sort-fresh="' + session.total.fresh + '" ' +
          'data-sort-output="' + session.total.output + '" data-sort-reasoning="' + session.total.reasoning + '" ' +
          'data-sort-duration="' + session.durationMs + '" data-models="' +
          this.escapeHtml(session.models.join('|').toLowerCase()) + '">' +
          '<td class="date-cell">' + this.escapeHtml(formatters.formatDateTime(session.observedAt)) + '</td>' +
          '<td class="name-cell"><div class="model-header" data-session-thread-layout>' +
          '<button class="session-action" data-session-detail-toggle type="button" aria-expanded="false" aria-controls="' +
          this.escapeHtml(detailId) + '" title="' + this.escapeHtml(copy.expand) +
          '" onclick="toggleSessionDetails(this)">▶</button><div class="model-details" data-session-thread-copy>' +
          '<div class="model-name" data-session-thread-title title="' + this.escapeHtml(title) + '">' + this.escapeHtml(title) + '</div>' +
          '<div class="model-details" data-session-thread-role>' + this.escapeHtml(role(session.role)) + '</div></div></div></td>' +
          '<td class="project-cell"><div class="project-name" title="' +
          this.escapeHtml(project) + '">' + this.escapeHtml(project) + '</div></td>' +
          '<td data-session-model title="' + this.escapeHtml(model) + '">' + this.escapeHtml(model) + '</td>' +
          '<td data-session-effort title="' + this.escapeHtml(effort) + '">' + this.escapeHtml(effort) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(session.total.processed) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(session.total.output) + '</td>' +
          '<td class="number-cell">' + this.escapeHtml(formatters.formatDuration(session.durationMs)) + '</td></tr>';
        const detailRow = '<tr data-sort-child data-session-detail id="' + this.escapeHtml(detailId) +
          '" data-expanded="false" style="display:none"><td colspan="8"><div class="model-details" data-session-detail-grid>' +
          detail(copy.parentThread, session.parentTitle ?? copy.unavailable) +
          detail(copy.input, I18n.formatNumber(session.total.input)) +
          detail(copy.freshInput, I18n.formatNumber(Math.max(0, session.total.input - session.total.cachedInput))) +
          detail(copy.cachedInput, I18n.formatNumber(session.total.cachedInput)) +
          detail(copy.fresh, I18n.formatNumber(session.total.fresh)) +
          detail(copy.reasoning, I18n.formatNumber(session.total.reasoning)) +
          '</div></td></tr>';
        return mainRow + detailRow;
      }).join('');
      const th = (key: string, label: string, title?: string): string =>
        '<th class="sortable" data-sortkey="' + key + '"' +
        (title ? ' title="' + this.escapeHtml(title) + '"' : '') + '>' + this.escapeHtml(label) + '</th>';
      return subtotal + '<div class="daily-breakdown"><h3>' + this.escapeHtml(copy.sessions) + '</h3>' +
        '<p class="table-hint">' + this.escapeHtml(I18n.t.popup.sortHint) + '</p>' + filterBar +
        '<div class="session-list" id="sessionList"><div class="daily-table-container" tabindex="0">' +
        '<table class="daily-table sortable-table" data-provider-session-table>' +
        '<colgroup><col style="width:14%"><col style="width:22%"><col style="width:16%"><col style="width:12%">' +
        '<col style="width:8%"><col style="width:9%"><col style="width:8%"><col style="width:11%"></colgroup><thead><tr>' +
        th('time', copy.lastActive) + th('session', copy.threadLabel) + th('project', copy.projectLabel) +
        '<th>' + this.escapeHtml(copy.model) + '</th><th>' + this.escapeHtml(copy.efforts) + '</th>' +
        th('processed', copy.processed) + th('output', copy.output) +
        th('duration', copy.duration, copy.observedSessionDuration) +
        '</tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
    }
    if (!this.sessionBreakdown || this.sessionBreakdown.length === 0) {
      return '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>';
    }

    const t = I18n.t.popup;

    // Thinking share per session is only available while content analysis is
    // enabled; the column collapses to "-" otherwise (estimate, see hint).
    const thinkingMap = this.contentAnalysis ? this.contentAnalysis.thinkingBySession : null;

    // Mark sessions outside the current workspace so the list can default to "this project".
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    let currentCount = 0;

    // The delete action touches local Claude Code history files, so it's
    // Resume + delete both ACT on the user's Claude Code (reopen / trash a log),
    // so they share one opt-in that's off by default — at odds with read-only.
    const showActions = this.setting<boolean>('enableSessionActions', false);
    // Read-only conversation viewer — on by default (it only reads local logs).
    const showViewer = this.setting<boolean>('showConversationViewer', true);
    // Active (hands-on) time per session — idle-capped, so it's not the raw
    // first→last span. Computed once for the whole table.
    const activeMap = ClaudeDataLoader.activeDurationBySession(this.allRecords);
    let rows = '';
    // Distinct short model names across all sessions → the model filter dropdown.
    const modelSet = new Set<string>();
    this.sessionBreakdown.forEach((s) => {
      const d = s.data;
      const foreign = workspacePath
        ? !(isUnderDir(s.projectPath, workspacePath) || s.projectPath === workspacePath.replace(/[/\\]/g, '-'))
        : false;
      if (!foreign) { currentCount++; }
      // Conversation title (the name `claude --resume` shows); falls back to a
      // short session id so same-project rows stay distinguishable either way.
      const fullName = s.title || s.sessionId;
      const displayName = fullName.length > 40 ? fullName.slice(0, 40) + '…' : fullName;
      const ts = thinkingMap ? thinkingMap[s.sessionId] : undefined;
      const thinkingShare = ts && ts.assistantTotal > 0 ? ts.thinking / ts.assistantTotal : null;
      // Models that omit their raw reasoning (Fable 5 / Opus 4.8) log empty
      // thinking text, so the estimate reads ~0 even though thinking was on.
      const thinkingHidden = !!(ts && ts.hiddenThinking);
      // Calibrated absolute (Phase 8): thinking share × the session's EXACT
      // output tokens = a billing-anchored "real thinking tokens" figure.
      const realThinkingTokens =
        thinkingShare !== null ? Math.round(thinkingShare * d.totalOutputTokens) : null;
      // Tooltip: calibrated token figure + (for heavy sessions) the effort hint
      // + a note when part/all of the thinking is hidden by the model.
      const thinkingTitle = [
        realThinkingTokens !== null && realThinkingTokens > 0
          ? '~' + I18n.formatNumber(realThinkingTokens) + ' ' + t.thinkingTokensCalibrated
          : '',
        thinkingShare !== null && thinkingShare > 0.6 ? t.effortHint : '',
        thinkingHidden ? t.thinkingHidden : '',
      ].filter((x) => x).join(' · ');
      // Cell text: a measurable share wins; else "hidden" when the model hid it;
      // else "-". A "*" marks a partial measurement when some turns were hidden.
      const thinkingCell =
        thinkingShare !== null && thinkingShare > 0
          ? this.formatPercent(thinkingShare) + (thinkingHidden ? '*' : '') + (thinkingShare > 0.6 ? ' ⚠' : '')
          : thinkingHidden
            ? t.thinkingHiddenShort
            : '-';
      // Distinct short model names for this session → the model filter matches on these.
      const rowModels = [...new Set(Object.keys(d.modelBreakdown || {}).map((m) => this.shortModelName(m)))];
      rowModels.forEach((m) => modelSet.add(m));
      rows +=
        '<tr class="sort-row' + (foreign ? ' session-foreign' : '') + '"' +
        ' data-sort-time="' + s.startTime.getTime() + '"' +
        ' data-day-key="' + this.escapeHtml(this.configuredDateTimeParts(s.startTime).dayKey) + '"' +
        ' data-models="' + this.escapeHtml(rowModels.join('|').toLowerCase()) + '"' +
        ' data-sort-session="' + this.escapeHtml(fullName.toLowerCase()) + '"' +
        ' data-sort-project="' + this.escapeHtml((s.projectName || '').toLowerCase()) + '"' +
        ' data-sort-context="' + s.peakContextTokens + '"' +
        ' data-sort-thinking="' + (thinkingShare ?? -1) + '"' +
        ' data-sort-duration="' + (s.endTime.getTime() - s.startTime.getTime()) + '"' +
        ' data-sort-active="' + (activeMap[s.sessionId] || 0) + '"' +
        this.usageSortAttrs(d) +
        '>' +
        '<td class="date-cell" title="' + this.escapeHtml(s.sessionId) + '">' +
        this.escapeHtml(this.formatDateTime(s.startTime)) +
        '</td>' +
        '<td class="name-cell" title="' + this.escapeHtml(fullName + ' (' + s.sessionId + ')') + '">' +
        this.escapeHtml(displayName) +
        '</td>' +
        this.renderProjectCell(s.projectName, s.projectPath) +
        '<td class="cost-cell">' + I18n.formatCurrency(d.totalCost) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalInputTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalOutputTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalCacheCreationTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalCacheReadTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(s.peakContextTokens) + '</td>' +
        '<td class="number-cell"' + (thinkingTitle ? ' title="' + this.escapeHtml(thinkingTitle) + '"' : '') + '>' +
        this.escapeHtml(thinkingCell) +
        '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.messageCount) + '</td>' +
        '<td class="number-cell" title="' + this.escapeHtml(t.activeDurationHelp) + '">' +
        this.escapeHtml(this.formatDurationMs(activeMap[s.sessionId] || 0)) +
        '</td>' +
        '<td class="number-cell">' + this.escapeHtml(this.formatDuration(s.startTime, s.endTime)) + '</td>' +
        // Copy id / resume / delete actions; id re-validated host-side.
        '<td class="actions-cell">' +
        '<button class="session-action" title="' + this.escapeHtml(t.copySessionId) +
        '" data-session-id="' + this.escapeHtml(s.sessionId) + '" onclick="copySession(this)">⧉</button>' +
        (showViewer
          ? '<button class="session-action" title="' + this.escapeHtml(t.viewConversation) +
            '" data-session-id="' + this.escapeHtml(s.sessionId) +
            '" data-title="' + this.escapeHtml(fullName) + '" onclick="viewConversation(this)">👁</button>'
          : '') +
        (showActions
          ? '<button class="session-action" title="' + this.escapeHtml(t.resumeSession) +
            '" data-session-id="' + this.escapeHtml(s.sessionId) +
            '" data-cwd="' + this.escapeHtml(s.projectPath || '') + '" onclick="resumeSession(this)">▶</button>'
          : '') +
        (showActions
          ? '<button class="session-action session-delete" title="' + this.escapeHtml(t.deleteSession) +
            '" data-session-id="' + this.escapeHtml(s.sessionId) +
            '" data-title="' + this.escapeHtml(fullName) + '" onclick="deleteSession(this)">🗑</button>'
          : '') +
        '</td>' +
        '</tr>';
    });

    const th = (key: string, label: string): string =>
      '<th class="sortable" data-sortkey="' + key + '">' + label + '</th>';

    // Filter bar above the table: time range · project · model. All three narrow the
    // list client-side; the list now defaults to ALL sessions and ALL projects.
    const total = this.sessionBreakdown.length;
    const foreignCount = total - currentCount;
    const showToggle = !!workspacePath && currentCount > 0 && foreignCount > 0;
    const modelOptions = [...modelSet]
      .sort()
      .map((m) => '<option value="' + this.escapeHtml(m.toLowerCase()) + '">' + this.escapeHtml(m) + '</option>')
      .join('');
    const filterBar =
      '<div class="sess-filters">' +
      '<div class="sess-filter" data-group="range">' +
        '<button class="sess-filter-btn active" data-range="all" onclick="sessionRange(this)">' + this.escapeHtml(t.sessionFilterAll) + '</button>' +
        '<button class="sess-filter-btn" data-range="today" onclick="sessionRange(this)">' + this.escapeHtml(t.sessionRangeToday) + '</button>' +
        '<button class="sess-filter-btn" data-range="7" onclick="sessionRange(this)">' + this.escapeHtml(t.sessionRange7d) + '</button>' +
        '<button class="sess-filter-btn" data-range="30" onclick="sessionRange(this)">' + this.escapeHtml(t.sessionRange30d) + '</button>' +
      '</div>' +
      (showToggle
        ? '<div class="sess-filter" data-group="project">' +
          '<button class="sess-filter-btn" data-mode="current" onclick="sessionFilter(this)">' + this.escapeHtml(t.sessionFilterCurrent) + ' (' + currentCount + ')</button>' +
          '<button class="sess-filter-btn active" data-mode="all" onclick="sessionFilter(this)">' + this.escapeHtml(t.sessionFilterAll) + ' (' + total + ')</button>' +
          '</div>'
        : '') +
      (modelOptions
        ? '<select class="sess-model-select" title="' + this.escapeHtml(t.sessionModelAll) + '" onchange="sessionModel(this)">' +
          '<option value="all">' + this.escapeHtml(t.sessionModelAll) + '</option>' +
          modelOptions +
          '</select>'
        : '') +
      '</div>';

    return (
      '<div class="daily-breakdown">' +
      '<h3>' + t.sessionBreakdown + '</h3>' +
      '<p class="table-hint">' + t.sortHint + '</p>' +
      filterBar +
      '<div class="session-list" id="sessionList">' +
      '<div class="daily-table-container" tabindex="0">' +
      '<table class="daily-table sortable-table">' +
      '<thead><tr>' +
      th('time', t.startTime) +
      th('session', t.sessionTitle) +
      th('project', t.project) +
      th('cost', t.cost) +
      th('input', t.inputTokens) +
      th('output', t.outputTokens) +
      th('cachecreate', t.cacheCreation) +
      th('cacheread', t.cacheRead) +
      th('context', t.peakContext) +
      th('thinking', t.thinkingShare) +
      th('messages', t.messages) +
      '<th class="sortable" data-sortkey="active" title="' + this.escapeHtml(t.activeDurationHelp) + '">' + t.activeDuration + '</th>' +
      th('duration', t.duration) +
      '<th>' + t.sessionActions + '</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>' +
      '</div>' +
      '<p class="table-hint">' + t.thinkingShare + ': ' + t.estimatedNote + '</p>' +
      '</div>'
    );
  }

  private formatAdviceSnoozeDate(value: number): string {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString(I18n.getLocale(), I18n.dateFormatOptions());
  }

  /** Reading-friendly date/time: "Today HH:MM", "Yesterday HH:MM", "MM-DD HH:MM" or "YYYY-MM-DD". */
  private formatDateTime(date: Date, now: Date = new Date()): string {
    if (!date || isNaN(date.getTime()) || date.getTime() === 0) {
      return '-';
    }
    const { dayKey, hm } = this.configuredDateTimeParts(date);
    const todayKey = this.configuredDateTimeParts(now).dayKey;
    const [yesterdayKey] = rollingDayKeysFromDayKey(todayKey, 2);

    if (dayKey === todayKey) {
      return I18n.t.popup.today + ' ' + hm;
    }
    if (dayKey === yesterdayKey) {
      return I18n.t.popup.yesterday + ' ' + hm;
    }
    if (dayKey.slice(0, 4) === todayKey.slice(0, 4)) {
      return dayKey.slice(5) + ' ' + hm;
    }
    return dayKey;
  }

  private configuredDateTimeParts(date: Date): { dayKey: string; hm: string } {
    if (!date || isNaN(date.getTime())) {
      return { dayKey: '', hm: '' };
    }
    const configuredTimeZone = I18n.getTimezone();
    if (!this.configuredDateTimeFormatter ||
        this.configuredDateTimeFormatter.configuredTimeZone !== configuredTimeZone) {
      this.configuredDateTimeFormatter = {
        configuredTimeZone,
        formatter: new Intl.DateTimeFormat('en-CA', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
          timeZone: resolveTimeZone(configuredTimeZone),
        }),
      };
    }
    const parts = this.configuredDateTimeFormatter.formatter.formatToParts(date);
    const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    const year = value('year');
    const month = value('month');
    const day = value('day');
    const hour = value('hour');
    const minute = value('minute');
    return {
      dayKey: year && month && day ? `${year}-${month}-${day}` : '',
      hm: hour && minute ? `${hour}:${minute}` : '',
    };
  }

  /** USD per-1M-token rate, trimmed of trailing zeros for compact display. */
  private formatRate(n: number): string {
    return '$' + parseFloat(n.toFixed(4)).toString();
  }

  /** data-sort-* attributes for the token/cost columns shared by both tables. */
  private usageSortAttrs(d: UsageData): string {
    return (
      ' data-sort-cost="' + d.totalCost +
      '" data-sort-input="' + d.totalInputTokens +
      '" data-sort-output="' + d.totalOutputTokens +
      '" data-sort-cachecreate="' + d.totalCacheCreationTokens +
      '" data-sort-cacheread="' + d.totalCacheReadTokens +
      '" data-sort-messages="' + d.messageCount + '"'
    );
  }

  /** Open a read-only viewer for a past conversation. Reads the session's
   * .jsonl fresh, parses it, and (re)uses a single viewer panel — nothing is
   * loaded back into any model context (that's the whole point vs. resume).
   * Reads on every click, so an ongoing session shows its latest turns. */
  private async openConversationViewer(sessionId: string, title: string): Promise<void> {
    const files = await ClaudeDataLoader.findSessionFiles(sessionId, this.dataDirectory);
    // Prefer the main session file (basename === sessionId.jsonl); else the
    // largest match. Sub-agent side files can share the id but aren't the chat.
    const main =
      files.find((f) => path.basename(f).toLowerCase() === sessionId.toLowerCase() + '.jsonl') || files[0];
    if (!main) {
      vscode.window.showWarningMessage(I18n.t.popup.deleteSessionNotFound);
      return;
    }
    let text = '';
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(main));
      text = Buffer.from(bytes).toString('utf8');
    } catch {
      vscode.window.showWarningMessage(I18n.t.popup.deleteSessionNotFound);
      return;
    }
    // Cap by ROUNDS (prompts), not raw turns — a single prompt can be followed
    // by dozens of tool turns, so a raw-turn cap starves the prompt list. Keep
    // the last 10 rounds (all rendered flat + all in the nav), with a raw-turn
    // safety ceiling so a pathological round can't bloat the DOM.
    const parsed = parseConversation(text, { maxRounds: 10, maxTurns: 2500, maxCharsPerTurn: 4000 });
    const panelTitle = (parsed.title || title || sessionId).slice(0, 60);
    const html = renderConversationViewer(parsed, { sessionId, timezone: I18n.getTimezone() });
    // Reuse the single viewer panel (refresh it) if it's still open; else make one.
    if (this.conversationPanel) {
      this.conversationPanel.title = panelTitle;
      this.conversationPanel.webview.html = html;
      this.conversationPanel.reveal(vscode.ViewColumn.Active, false);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'ccuConversation',
        panelTitle,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: false, retainContextWhenHidden: false }
      );
      panel.onDidDispose(() => {
        this.conversationPanel = undefined;
      });
      panel.webview.html = html;
      this.conversationPanel = panel;
    }
  }

  private formatDuration(start: Date, end: Date): string {
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      return '-';
    }
    const ms = end.getTime() - start.getTime();
    if (ms <= 0) {
      return '<1m';
    }
    const totalMinutes = Math.round(ms / 60000);
    if (totalMinutes < 1) {
      return '<1m';
    }
    if (totalMinutes < 60) {
      return totalMinutes + 'm';
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? hours + 'h ' + minutes + 'm' : hours + 'h';
  }

  /** Same formatting as formatDuration but from a raw millisecond span. */
  private formatDurationMs(ms: number): string {
    if (!(ms > 0)) {
      return '<1m';
    }
    return this.formatDuration(new Date(0), new Date(ms));
  }

  /** A table cell showing the project's friendly name with its full path beneath. */
  private renderProjectCell(name: string, fullPath: string): string {
    const safeName = this.escapeHtml(name || 'unknown');
    return '<td class="project-cell"><div class="project-name">' + safeName + '</div>' + this.projectPathLine(fullPath || '') + '</td>';
  }

  /** A project directory line with a small copy-to-clipboard icon. */
  private projectPathLine(fullPath: string, indent: number = 0): string {
    if (!fullPath) { return ''; }
    const safe = this.escapeHtml(fullPath);
    const pad = '&nbsp;'.repeat(indent);
    return '<div class="project-path" title="' + safe + '">' +
      '<span class="project-path-text">' + pad + safe + '</span>' +
      '<button class="copy-path" data-path="' + safe + '" title="' +
      this.escapeHtml(I18n.t.popup.copyPath) + '" onclick="copyPath(this, event)">⧉</button>' +
      '</div>';
  }

  private projectMatrixCoverageLabel(
    coverage: ProjectUsageMatrixSnapshot['coverage'],
    copy: ProjectMatrixUiCopy,
  ): string {
    if (coverage === 'complete') return copy.completeCoverage;
    if (coverage === 'partial') return copy.partialCoverage;
    return copy.noCoverage;
  }

  private renderProjectMatrixHeatmap(
    snapshot: ProjectUsageMatrixSnapshot,
    range: 30 | 90,
    copy: ProjectMatrixUiCopy,
  ): string {
    const rows = projectHeatmap(snapshot, range, 40);
    const headerDays = (rows[0]?.cells ?? []).map((cell, index, cells) => {
      const monthChanged = index === 0 || cells[index - 1].day.slice(0, 7) !== cell.day.slice(0, 7);
      const label = monthChanged ? this.getShortDate(cell.day) : cell.day.slice(8);
      return '<th scope="col" title="' + this.escapeHtml(this.formatDate(cell.day)) + '">' +
        this.escapeHtml(label) + '</th>';
    }).join('');
    const body = rows.map((row, index) => {
      const name = row.projectName || copy.project;
      const meta = I18n.formatNumber(row.totalTokens) + ' Token · ' +
        I18n.formatNumber(row.activeDays) + ' ' + copy.activeDays;
      const cells = row.cells.map((cell) => {
        const coverage = this.projectMatrixCoverageLabel(cell.coverage, copy);
        const title = name + ' · ' + this.formatDate(cell.day) + ' · ' +
          I18n.formatNumber(cell.tokens) + ' Token · ' + coverage;
        return '<td class="project-matrix-cell project-matrix-level-' + cell.bucket + '" ' +
          'data-day="' + this.escapeHtml(cell.day) + '" data-tokens="' + cell.tokens + '" ' +
          'title="' + this.escapeHtml(title) + '" aria-label="' + this.escapeHtml(title) + '"></td>';
      }).join('');
      return '<tr class="project-matrix-row"' +
        (index >= 12 ? ' data-project-matrix-extra="true" hidden' : '') + '>' +
        '<th scope="row" class="project-matrix-project"><span>' + this.escapeHtml(name) + '</span>' +
        '<small>' + this.escapeHtml(meta) + '</small></th>' + cells + '</tr>';
    }).join('');
    return '<div class="project-matrix-scroll" tabindex="0" role="region" aria-label="' +
      this.escapeHtml(copy.matrixAria + ' · ' + (range === 90 ? copy.last90 : copy.last30)) + '">' +
      '<table class="project-matrix-grid"><thead><tr><th scope="col" class="project-matrix-project">' +
      this.escapeHtml(copy.project) + '</th>' + headerDays + '</tr></thead><tbody>' + body +
      '</tbody></table></div>';
  }

  private renderProjectMatrixTrend(
    snapshot: ProjectUsageMatrixSnapshot,
    range: 30 | 90,
    copy: ProjectMatrixUiCopy,
  ): string {
    const series = projectTrend(snapshot, range, 6);
    const names = series.map((item) => item.other ? copy.otherProjects : (item.projectName || copy.project));
    const dayTotals = (series[0]?.values ?? []).map((_, dayIndex) =>
      series.reduce((sum, item) => sum + item.values[dayIndex].tokens, 0));
    const maxDay = Math.max(1, ...dayTotals);
    const legend = series.map((item, index) =>
      '<span class="project-matrix-trend-series"><i class="project-matrix-series-' + index +
      '" aria-hidden="true"></i><span>' + this.escapeHtml(names[index]) + '</span><strong>' +
      this.escapeHtml(I18n.formatNumber(item.totalTokens)) + '</strong></span>').join('');
    const columns = (series[0]?.values ?? []).map((value, dayIndex, values) => {
      const total = dayTotals[dayIndex];
      const coverage = this.projectMatrixCoverageLabel(value.coverage, copy);
      const totalTitle = this.formatDate(value.day) + ' · ' + I18n.formatNumber(total) +
        ' Token · ' + coverage;
      const segments = series.map((item, seriesIndex) => {
        const point = item.values[dayIndex];
        if (!(point.tokens > 0)) return '';
        const title = names[seriesIndex] + ' · ' + this.formatDate(point.day) + ' · ' +
          I18n.formatNumber(point.tokens) + ' Token · ' +
          this.projectMatrixCoverageLabel(point.coverage, copy);
        return '<span class="project-matrix-trend-segment project-matrix-series-' + seriesIndex + '" ' +
          'style="height:' + ((point.tokens / maxDay) * 100).toFixed(4) + '%" ' +
          'title="' + this.escapeHtml(title) + '" aria-label="' + this.escapeHtml(title) + '"></span>';
      }).join('');
      const showLabel = dayIndex === 0 || dayIndex === values.length - 1 || dayIndex % 7 === 0;
      return '<div class="project-matrix-trend-col" title="' + this.escapeHtml(totalTitle) + '">' +
        '<div class="project-matrix-trend-stack">' + segments + '</div>' +
        '<span class="project-matrix-trend-date">' +
        (showLabel ? this.escapeHtml(this.getShortDate(value.day)) : '') + '</span></div>';
    }).join('');
    return '<div class="project-matrix-trend-legend">' + legend + '</div>' +
      '<div class="project-matrix-trend-scroll" tabindex="0" role="img" aria-label="' +
      this.escapeHtml(copy.trendAria + ' · ' + (range === 90 ? copy.last90 : copy.last30)) + '">' +
      '<div class="project-matrix-trend-bars project-matrix-trend-' + range + '">' + columns + '</div></div>';
  }

  private renderProjectUsageMatrix(provider: SettingProvider): string {
    if (!this.setting<boolean>('showProjectUsageMatrix', true)) return '';
    const snapshot = provider === 'codex'
      ? this.codexView?.projectUsageMatrix
      : this.claudeProjectUsageMatrix;
    if (!snapshot || snapshot.points.length === 0) return '';
    const copy = projectMatrixUiCopy(I18n.getLocale());
    const coverage = this.projectMatrixCoverageLabel(snapshot.coverage, copy);
    const rangePanel = (range: 30 | 90): string =>
      '<div class="project-matrix-range" data-project-matrix-range-panel="' + range + '"' +
      (range === 90 ? ' hidden' : '') + '>' +
      '<div class="project-matrix-view" data-project-matrix-heatmap>' +
      this.renderProjectMatrixHeatmap(snapshot, range, copy) + '</div>' +
      '<div class="project-matrix-view" data-project-matrix-trend hidden>' +
      this.renderProjectMatrixTrend(snapshot, range, copy) + '</div></div>';
    const hasExtraRows = Math.max(
      projectHeatmap(snapshot, 30, 40).length,
      projectHeatmap(snapshot, 90, 40).length,
    ) > 12;
    return '<section class="project-matrix" data-project-matrix="' + provider + '">' +
      '<div class="project-matrix-head"><div><h3>' + this.escapeHtml(copy.title) + '</h3>' +
      '<p>' + this.escapeHtml(copy.description) + '</p></div>' +
      '<span class="project-matrix-coverage project-matrix-coverage-' + snapshot.coverage + '">' +
      this.escapeHtml(coverage) + '</span></div>' +
      '<div class="project-matrix-toolbar">' +
      '<div class="project-matrix-control" role="group" aria-label="' + this.escapeHtml(copy.rangeLabel) + '">' +
      '<span>' + this.escapeHtml(copy.rangeLabel) + '</span>' +
      '<button class="project-matrix-option active" data-project-matrix-range="30" aria-pressed="true">' +
      this.escapeHtml(copy.last30) + '</button>' +
      '<button class="project-matrix-option" data-project-matrix-range="90" aria-pressed="false">' +
      this.escapeHtml(copy.last90) + '</button></div>' +
      '<div class="project-matrix-control" role="group" aria-label="' + this.escapeHtml(copy.viewLabel) + '">' +
      '<span>' + this.escapeHtml(copy.viewLabel) + '</span>' +
      '<button class="project-matrix-option active" data-project-matrix-view="heatmap" aria-pressed="true">' +
      this.escapeHtml(copy.heatmap) + '</button>' +
      '<button class="project-matrix-option" data-project-matrix-view="trend" aria-pressed="false">' +
      this.escapeHtml(copy.trend) + '</button></div></div>' +
      rangePanel(30) + rangePanel(90) +
      (hasExtraRows
        ? '<button class="project-matrix-expand" data-project-matrix-expand aria-expanded="false" ' +
          'data-show-more="' + this.escapeHtml(copy.showMore) + '" data-show-less="' +
          this.escapeHtml(copy.showLess) + '">' + this.escapeHtml(copy.showMore) + '</button>'
        : '') + '</section>';
  }

  private renderProjectData(provider: SettingProvider = 'claude'): string {
    const matrix = this.renderProjectUsageMatrix(provider);
    if (provider === 'codex') {
      const copy = I18n.t.providers.codex;
      const projects = this.codexView?.projects ?? [];
      const subtotal = this.renderCodexIndexedSubtotal(
        this.codexView?.allTime.indexedSubtotal,
      );
      if (projects.length === 0) {
        return subtotal + matrix + this.renderCodexEmptyState();
      }
      const formatters = createCodexLocalizedFormatters(I18n.getLocale(), I18n.getTimezone());
      const rows = projects.map((project: CodexProjectUsageView) => {
        const name = project.name ?? copy.unidentifiedProject;
        const directory = project.directoryName && project.directoryName !== project.name
          ? '<div class="project-path"><span class="project-path-text">' +
            this.escapeHtml(project.directoryName) + '</span></div>'
          : '';
        return '<tr class="sort-row" data-sort-name="' + this.escapeHtml(name.toLowerCase()) + '" ' +
          'data-sort-sessions="' + project.threadCount + '" data-sort-lastactive="' + project.lastActiveAt + '" ' +
          'data-sort-processed="' + project.scope.total.processed + '" data-sort-fresh="' + project.scope.total.fresh + '" ' +
          'data-sort-output="' + project.scope.total.output + '" data-sort-reasoning="' + project.scope.total.reasoning + '">' +
          '<td class="project-cell"><div class="project-name">' + this.escapeHtml(name) + '</div>' + directory + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(project.threadCount) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(project.scope.total.processed) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(project.scope.total.fresh) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(project.scope.total.cachedInput) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(project.scope.total.output) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(project.scope.total.reasoning) + '</td>' +
          '<td class="date-cell">' + this.escapeHtml(formatters.formatDateTime(project.lastActiveAt)) + '</td></tr>';
      }).join('');
      const th = (key: string, label: string): string =>
        '<th class="sortable" data-sortkey="' + key + '">' + this.escapeHtml(label) + '</th>';
      return subtotal + matrix + '<div class="daily-breakdown"><h3>' + this.escapeHtml(copy.projects) + '</h3>' +
        '<p class="table-hint">' + this.escapeHtml(I18n.t.popup.sortHint) + '</p>' +
        '<div class="daily-table-container" tabindex="0"><table class="daily-table sortable-table"><thead><tr>' +
        th('name', copy.projectLabel) + th('sessions', copy.threads) + th('processed', copy.processed) +
        th('fresh', copy.fresh) + '<th>' + this.escapeHtml(copy.cachedInput) + '</th>' +
        th('output', copy.output) + th('reasoning', copy.reasoning) + th('lastactive', copy.lastActive) +
        '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }
    if (!this.projectBreakdown || this.projectBreakdown.length === 0) {
      return matrix + '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>';
    }

    const t = I18n.t.popup;
    // Opt-in efficiency column (cost per message), gated like the Today chips.
    const showEff = this.setting<boolean>('showEfficiency', false);
    const effCell = (d: UsageData): string =>
      showEff
        ? '<td class="number-cell">' +
          (d.messageCount > 0 ? I18n.formatCurrency(d.totalCost / d.messageCount) : '—') +
          '</td>'
        : '';

    const usageCells = (d: UsageData): string =>
      '<td class="cost-cell">' + I18n.formatCurrency(d.totalCost) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.totalInputTokens) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.totalOutputTokens) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.totalCacheCreationTokens) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.totalCacheReadTokens) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.messageCount) + '</td>' +
      effCell(d);

    let rows = '';
    this.projectBreakdown.forEach((group, idx) => {
      const groupId = 'pg' + idx;
      const sortAttrs =
        ' data-sort-name="' + this.escapeHtml(group.groupName.toLowerCase()) + '"' +
        ' data-sort-sessions="' + group.sessionCount + '"' +
        ' data-sort-lastactive="' + group.lastSeen.getTime() + '"' +
        this.usageSortAttrs(group.data);

      if (group.children.length <= 1) {
        // A single project — render as one plain, sortable row.
        const only = group.children[0];
        const name = only ? only.projectName : group.groupName;
        const path = only ? only.projectPath : group.groupPath;
        rows +=
          '<tr class="sort-row"' + sortAttrs + '>' +
          this.renderProjectCell(name, path) +
          '<td class="number-cell">' + I18n.formatNumber(group.sessionCount) + '</td>' +
          usageCells(group.data) +
          '<td class="date-cell">' + this.escapeHtml(this.formatDateTime(group.lastSeen)) + '</td>' +
          '</tr>';
      } else {
        // Several projects under one folder — an expandable group row.
        rows +=
          '<tr class="sort-row project-group-row" data-group="' + groupId + '"' + sortAttrs + '>' +
          '<td class="project-cell">' +
          '<div class="project-name">' +
          '<span class="group-toggle" onclick="toggleProjectGroup(\'' + groupId + '\')">▶</span> ' +
          (group.isGitRepo ? '<span class="git-badge">git</span> ' : '') +
          this.escapeHtml(group.groupName) +
          ' <span class="group-count">(' + group.projectCount + ')</span>' +
          '</div>' +
          this.projectPathLine(group.groupPath) +
          '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(group.sessionCount) + '</td>' +
          usageCells(group.data) +
          '<td class="date-cell">' + this.escapeHtml(this.formatDateTime(group.lastSeen)) + '</td>' +
          '</tr>';
        group.children.forEach((child) => {
          rows +=
            '<tr class="sort-child project-child-row" data-group="' + groupId + '" style="display:none;">' +
            '<td class="project-cell project-child-cell">' +
            '<div class="project-name">&nbsp;&nbsp;' + this.escapeHtml(child.projectName) + '</div>' +
            this.projectPathLine(child.projectPath, 2) +
            '</td>' +
            '<td class="number-cell">' + I18n.formatNumber(child.sessionCount) + '</td>' +
            usageCells(child.data) +
            '<td class="date-cell">' + this.escapeHtml(this.formatDateTime(child.lastSeen)) + '</td>' +
            '</tr>';
        });
      }
    });

    const th = (key: string, label: string): string =>
      '<th class="sortable" data-sortkey="' + key + '">' + label + '</th>';

    return (
      matrix + '<div class="daily-breakdown">' +
      '<h3>' + t.projectBreakdown + '</h3>' +
      '<p class="table-hint">' + t.sortHint + '</p>' +
      '<div class="daily-table-container" tabindex="0">' +
      '<table class="daily-table sortable-table">' +
      '<thead><tr>' +
      th('name', t.project) +
      th('sessions', t.sessions) +
      th('cost', t.cost) +
      th('input', t.inputTokens) +
      th('output', t.outputTokens) +
      th('cachecreate', t.cacheCreation) +
      th('cacheread', t.cacheRead) +
      th('messages', t.messages) +
      (showEff ? '<th title="Total cost ÷ messages">Cost/msg</th>' : '') +
      th('lastactive', t.lastActive) +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>' +
      '</div>'
    );
  }

  private renderBranchData(): string {
    if (!this.branchBreakdown || this.branchBreakdown.length === 0) {
      return '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>';
    }

    const t = I18n.t.popup;

    let rows = '';
    this.branchBreakdown.forEach((b) => {
      const d = b.data;
      rows +=
        '<tr class="sort-row"' +
        ' data-sort-branch="' + this.escapeHtml(b.branch.toLowerCase()) + '"' +
        ' data-sort-project="' + this.escapeHtml((b.projectName || '').toLowerCase()) + '"' +
        ' data-sort-sessions="' + b.sessionCount + '"' +
        ' data-sort-lastactive="' + b.lastSeen.getTime() + '"' +
        this.usageSortAttrs(d) +
        '>' +
        '<td class="date-cell" title="' + this.escapeHtml(b.projectPath) + '">' + this.escapeHtml(b.branch) + '</td>' +
        '<td>' + this.escapeHtml(b.projectName) + '</td>' +
        '<td class="cost-cell">' + I18n.formatCurrency(d.totalCost) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalInputTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalOutputTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalCacheCreationTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalCacheReadTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.messageCount) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(b.sessionCount) + '</td>' +
        '<td class="date-cell">' + this.escapeHtml(this.formatDateTime(b.lastSeen)) + '</td>' +
        '</tr>';
    });

    const th = (key: string, label: string): string =>
      '<th class="sortable" data-sortkey="' + key + '">' + label + '</th>';

    return (
      '<div class="daily-breakdown">' +
      '<h3>' + t.branchBreakdown + '</h3>' +
      '<p class="table-hint">' + t.sortHint + '</p>' +
      '<div class="daily-table-container" tabindex="0">' +
      '<table class="daily-table sortable-table">' +
      '<thead><tr>' +
      th('branch', t.branch) +
      th('project', t.project) +
      th('cost', t.cost) +
      th('input', t.inputTokens) +
      th('output', t.outputTokens) +
      th('cachecreate', t.cacheCreation) +
      th('cacheread', t.cacheRead) +
      th('messages', t.messages) +
      th('sessions', t.sessions) +
      th('lastactive', t.lastActive) +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>' +
      '</div>'
    );
  }

  /**
   * "Usage tracking" card for the Today tab: today's notable usage
   * characteristics (≥5% only), in the same horizontal-bar style as the
   * content analysis. Only exact, cost-weighted shares are shown — the
   * text-length thinking estimate is deliberately excluded here (it lives on
   * the Sessions tab, clearly marked as an estimate). Hidden on light days.
   */
  private renderTodayInsights(provider: SettingProvider = 'claude'): string {
    if (provider === 'codex') {
      return '';
    }
    const t = I18n.t.popup;
    const rows: string[] = [];
    const barRow = (label: string, share: number, colorClass: string, tooltip: string): string =>
      '<div class="cbar-row" title="' + this.escapeHtml(tooltip) + '">' +
      '<div class="cbar-label">' + this.escapeHtml(label) + '</div>' +
      '<div class="cbar-track"><div class="cbar-fill ' + colorClass + '" style="width: ' +
      (share * 100).toFixed(1) + '%;"></div></div>' +
      '<div class="cbar-pct">' + this.formatPercent(share) + '</div>' +
      '</div>';

    // Today's usage characteristics, ≥5% only (full sentence in the tooltip).
    // All cost-weighted from exact usage — no estimates in this card.
    if (this.allRecords && this.allRecords.length > 0) {
      const attr = ClaudeDataLoader.getUsageAttribution(this.allRecords, this.contentAnalysis, { kind: 'day' });
      if (attr.totalCost > 0) {
        const add = (share: number, short: string, sentence: string, hint: string, color: string): void => {
          if (share < 0.05) {
            return;
          }
          const tooltip = sentence.replace('{pct}', String(Math.round(share * 100))) + ' — ' + hint;
          rows.push(barRow(short, share, color, tooltip));
        };
        const c = attr.characteristics;
        add(c.largeContext, t.attrLargeContextShort, t.attrLargeContext, t.attrLargeContextHint, 'cf-1');
        add(c.longSessions, t.attrLongSessionsShort, t.attrLongSessions, t.attrLongSessionsHint, 'cf-2');
        add(c.subagentHeavy, t.attrSubagentHeavyShort, t.attrSubagentHeavy, t.attrSubagentHeavyHint, 'cf-3');
        add(c.workflows, t.attrWorkflowsShort, t.attrWorkflows, t.attrWorkflowsHint, 'cf-5');
        if (attr.skills.length > 0) {
          add(attr.skills[0].share, attr.skills[0].key, t.attrSkillChar.replace('{name}', attr.skills[0].key), t.attrSkillCharHint, 'cf-1');
        }
      }
    }

    if (rows.length === 0) {
      return '';
    }
    return (
      '<div class="daily-breakdown">' +
      '<div class="section-header"><h3>' + t.attribution + '</h3>' +
      '<span class="section-header-right"><span class="cbar-total">→ ' +
      this.escapeHtml(t.attrTodayPointer) + '</span></span></div>' +
      '<div class="cbar-list">' + rows.join('') + '</div>' +
      '</div>'
    );
  }

  /** Cache hit rate of input-side tokens: cacheRead / (input + cacheWrite + cacheRead). */
  private cacheHitRate(d: UsageData): number | null {
    const denominator = d.totalInputTokens + d.totalCacheCreationTokens + d.totalCacheReadTokens;
    return denominator > 0 ? d.totalCacheReadTokens / denominator : null;
  }

  private formatPercent(value: number | null): string {
    return value === null ? '-' : (value * 100).toFixed(value >= 0.1 ? 0 : 1) + '%';
  }

  /** Compact model label: "claude-sonnet-4-5-20250929[1m]" → "sonnet-4-5". */
  private shortModelName(model: string): string {
    return model
      .replace(/^claude-/, '')
      .replace(/\[1m\]$/, '')
      .replace(/-20\d{6}$/, '');
  }

  /** Distinct models in a usage aggregate, most expensive first, shortened. */
  private modelList(d: UsageData): { short: string; full: string } {
    const sorted = Object.entries(d.modelBreakdown)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .map(([model]) => model);
    return {
      short: sorted.map((m) => this.shortModelName(m)).join(', '),
      full: sorted.join(', '),
    };
  }

  /**
   * "Workflows" tab: one row per dynamic-workflow run (ultracode dispatch),
   * expandable to its per-agent breakdown. The cache hit rate is the headline
   * diagnostic — it tells whether the provider reuses the prompt cache across
   * a workflow's agents (see the hint line / V2.1-WORKFLOW-SPEC §Phase 2).
   */
  private renderWorkflowData(now: Date = new Date()): string {
    if (!this.workflowBreakdown || this.workflowBreakdown.length === 0) {
      return '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>';
    }

    const t = I18n.t.popup;

    // The middle dashboard scope is Today plus the preceding 29 configured-zone
    // civil dates. Match that exact range and classify runs by their displayed
    // start time so the numerator and rolling-30-day denominator reconcile.
    const timeZone = I18n.getTimezone();
    const rollingDays = new Set(rollingDayKeys(now.getTime(), timeZone, 30));
    const recentWorkflows = this.workflowBreakdown.filter(
      (w) => rollingDays.has(this.configuredDateTimeParts(w.startTime).dayKey)
    );
    const rollingWorkflowCost = recentWorkflows.reduce(
      (sum, w) => sum + w.data.totalCost + (w.orchestration ? w.orchestration.totalCost : 0),
      0
    );
    const rollingTotalCost = this.rolling30DayData ? this.rolling30DayData.totalCost : 0;
    const rollingShare = rollingTotalCost > 0 ? rollingWorkflowCost / rollingTotalCost : null;
    const summaryStrip =
      '<p class="table-hint">' +
      t.workflowsLast30Days + ': ' + recentWorkflows.length +
      ' · ' + I18n.formatCurrency(rollingWorkflowCost) +
      (rollingShare !== null ? ' · ' + this.formatPercent(rollingShare) + ' ' + t.workflowLast30DaysCostShare : '') +
      '</p>';

    let rows = '';
    this.workflowBreakdown.forEach((w, idx) => {
      const groupId = 'wf' + idx;
      // Headline row = sub-agents + main-session orchestration (Phase 7c), so a
      // native-Claude run whose Opus/Fable work lived in the main thread shows
      // its true cost and models; the drill-down splits the two back out.
      const d = this.mergeUsage(w.data, w.orchestration);
      const models = this.modelList(d);
      // Badge: "workflow" (a wf_ run dir) vs "subagents (ad-hoc)" (a plain
      // Task-tool fan-out). Effort level isn't in the logs — see the hint line.
      const badge = w.isAdHoc
        ? ' <span class="git-badge">' + t.adhocBadge + '</span>'
        : ' <span class="git-badge">' + t.workflowModeBadge + '</span>';
      rows +=
        '<tr class="sort-row project-group-row" data-group="' + groupId + '"' +
        ' data-sort-time="' + w.startTime.getTime() + '"' +
        ' data-sort-name="' + this.escapeHtml(w.name.toLowerCase()) + '"' +
        ' data-sort-project="' + this.escapeHtml((w.projectName || '').toLowerCase()) + '"' +
        ' data-sort-model="' + this.escapeHtml(models.short.toLowerCase()) + '"' +
        ' data-sort-agents="' + w.agentCount + '"' +
        ' data-sort-cachehit="' + (this.cacheHitRate(d) ?? -1) + '"' +
        ' data-sort-duration="' + (w.endTime.getTime() - w.startTime.getTime()) + '"' +
        this.usageSortAttrs(d) +
        '>' +
        '<td class="date-cell">' + this.escapeHtml(this.formatDateTime(w.startTime)) + '</td>' +
        '<td class="name-cell" title="' + this.escapeHtml(w.workflowId) + '">' +
        '<span class="group-toggle" onclick="toggleProjectGroup(\'' + groupId + '\')">▶</span> ' +
        this.escapeHtml(w.name) + badge +
        '</td>' +
        '<td>' + this.escapeHtml(w.projectName) + '</td>' +
        '<td title="' + this.escapeHtml(models.full) + '">' + this.escapeHtml(models.short) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(w.agentCount) + '</td>' +
        '<td class="cost-cell">' + I18n.formatCurrency(d.totalCost) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalInputTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalOutputTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalCacheCreationTokens) + '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.totalCacheReadTokens) + '</td>' +
        '<td class="number-cell">' + this.formatPercent(this.cacheHitRate(d)) + '</td>' +
        '<td class="number-cell">' + this.escapeHtml(this.formatDuration(w.startTime, w.endTime)) + '</td>' +
        '</tr>';

      // Orchestration drill-down row (Phase 7c): the main-session spend that
      // bracketed this run — usually where the expensive native-Claude models
      // are. Rendered as a pinned child row that splits out of the headline.
      if (w.orchestration) {
        const o = w.orchestration;
        const oModels = this.modelList(o);
        rows +=
          '<tr class="sort-child project-child-row" data-group="' + groupId + '" style="display:none;">' +
          '<td class="date-cell"></td>' +
          '<td class="name-cell project-child-cell">⚙ ' + this.escapeHtml(t.orchestration) + '</td>' +
          '<td></td>' +
          '<td title="' + this.escapeHtml(oModels.full) + '">' + this.escapeHtml(oModels.short) + '</td>' +
          '<td></td>' +
          '<td class="cost-cell">' + I18n.formatCurrency(o.totalCost) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(o.totalInputTokens) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(o.totalOutputTokens) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(o.totalCacheCreationTokens) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(o.totalCacheReadTokens) + '</td>' +
          '<td class="number-cell">' + this.formatPercent(this.cacheHitRate(o)) + '</td>' +
          '<td class="number-cell"></td>' +
          '</tr>';
      }

      // Workflow agents often share a long boilerplate preamble; hoist the
      // common prefix into one pinned row so each agent row shows only what
      // differs. Tooltips keep the full task text.
      const tasks = w.agents.map((a) => a.task).filter((task): task is string => !!task);
      let commonPrefix = '';
      if (tasks.length >= 2) {
        commonPrefix = tasks.reduce((prefix, task) => {
          let i = 0;
          const max = Math.min(prefix.length, task.length);
          while (i < max && prefix[i] === task[i]) {
            i++;
          }
          return prefix.slice(0, i);
        });
        // Cut back to a word boundary; only worth hoisting when substantial.
        const boundary = commonPrefix.lastIndexOf(' ');
        if (boundary > 0) {
          commonPrefix = commonPrefix.slice(0, boundary);
        }
        if (commonPrefix.length < 30) {
          commonPrefix = '';
        }
      }
      if (commonPrefix) {
        const display = commonPrefix.length > 160 ? commonPrefix.slice(0, 160) + '…' : commonPrefix;
        rows +=
          '<tr class="sort-child project-child-row" data-group="' + groupId + '" style="display:none;">' +
          '<td colspan="12" class="wf-common-task" title="' + this.escapeHtml(commonPrefix) + '">' +
          '📌 ' + this.escapeHtml(t.commonTaskPrefix) + ': ' + this.escapeHtml(display) +
          '</td>' +
          '</tr>';
      }

      w.agents.forEach((agent) => {
        const ad = agent.data;
        const agentModels = this.modelList(ad);
        const shortId = agent.agentId.replace(/^agent-/, '').slice(0, 12);
        // Label the agent by the part of its task that differs from the
        // hoisted common prefix; the opaque hex id moves to the second line.
        let diff = agent.task || '';
        if (commonPrefix && diff.startsWith(commonPrefix)) {
          diff = diff.slice(commonPrefix.length).replace(/^[\s,.;:·—-]+/, '');
        }
        const taskLabel = diff ? (diff.length > 70 ? diff.slice(0, 70) + '…' : diff) : shortId;
        const nameCell = agent.task
          ? '<div class="project-name">' + this.escapeHtml(taskLabel) + '</div>' +
            '<div class="project-path">' + this.escapeHtml(shortId) + '</div>'
          : this.escapeHtml(shortId);
        rows +=
          '<tr class="sort-child project-child-row" data-group="' + groupId + '" style="display:none;">' +
          '<td class="date-cell">' + this.escapeHtml(this.formatDateTime(agent.startTime)) + '</td>' +
          '<td class="name-cell project-child-cell" title="' +
          this.escapeHtml(agent.task ? agent.task + ' (' + agent.agentId + ')' : agent.agentId) +
          '">' +
          nameCell +
          '</td>' +
          '<td></td>' +
          '<td title="' + this.escapeHtml(agentModels.full) + '">' + this.escapeHtml(agentModels.short) + '</td>' +
          '<td class="cost-cell">' + I18n.formatCurrency(ad.totalCost) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(ad.totalInputTokens) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(ad.totalOutputTokens) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(ad.totalCacheCreationTokens) + '</td>' +
          '<td class="number-cell">' + I18n.formatNumber(ad.totalCacheReadTokens) + '</td>' +
          '<td class="number-cell">' + this.formatPercent(this.cacheHitRate(ad)) + '</td>' +
          '<td class="number-cell">' + this.escapeHtml(this.formatDuration(agent.startTime, agent.endTime)) + '</td>' +
          '</tr>';
      });
    });

    const th = (key: string, label: string): string =>
      '<th class="sortable" data-sortkey="' + key + '">' + label + '</th>';

    return (
      '<div class="daily-breakdown">' +
      '<h3>' + t.workflowBreakdown + '</h3>' +
      summaryStrip +
      '<p class="table-hint">' + t.sortHint + '</p>' +
      '<div class="daily-table-container" tabindex="0">' +
      '<table class="daily-table sortable-table">' +
      '<thead><tr>' +
      th('time', t.startTime) +
      th('name', t.workflowName) +
      th('project', t.project) +
      th('model', t.model) +
      th('agents', t.agents) +
      th('cost', t.cost) +
      th('input', t.inputTokens) +
      th('output', t.outputTokens) +
      th('cachecreate', t.cacheCreation) +
      th('cacheread', t.cacheRead) +
      th('cachehit', t.cacheHitRate) +
      th('duration', t.duration) +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>' +
      '<p class="table-hint">' + t.workflowModeHint + '</p>' +
      '<p class="table-hint">' + t.workflowNativeHint + '</p>' +
      '<p class="table-hint">' + t.workflowCacheHint + '</p>' +
      '</div>'
    );
  }

  /** Sum two UsageData (run sub-agents + main-session orchestration), merging
   * the per-model breakdowns. Used for the Workflows headline row (Phase 7c). */
  private mergeUsage(a: UsageData, b?: UsageData): UsageData {
    if (!b) {
      return a;
    }
    const merged: UsageData = {
      totalInputTokens: a.totalInputTokens + b.totalInputTokens,
      totalOutputTokens: a.totalOutputTokens + b.totalOutputTokens,
      totalCacheCreationTokens: a.totalCacheCreationTokens + b.totalCacheCreationTokens,
      totalCacheReadTokens: a.totalCacheReadTokens + b.totalCacheReadTokens,
      totalCost: a.totalCost + b.totalCost,
      costBreakdown: {
        input: a.costBreakdown.input + b.costBreakdown.input,
        output: a.costBreakdown.output + b.costBreakdown.output,
        cacheWrite: a.costBreakdown.cacheWrite + b.costBreakdown.cacheWrite,
        cacheRead: a.costBreakdown.cacheRead + b.costBreakdown.cacheRead,
      },
      messageCount: a.messageCount + b.messageCount,
      modelBreakdown: {},
    };
    for (const src of [a.modelBreakdown, b.modelBreakdown]) {
      for (const [m, md] of Object.entries(src)) {
        const e = merged.modelBreakdown[m] || {
          inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0, count: 0,
        };
        e.inputTokens += md.inputTokens;
        e.outputTokens += md.outputTokens;
        e.cacheCreationTokens += md.cacheCreationTokens;
        e.cacheReadTokens += md.cacheReadTokens;
        e.cost += md.cost;
        e.count += md.count;
        merged.modelBreakdown[m] = e;
      }
    }
    return merged;
  }

  /** Inner panel of the usage-attribution section: disclaimer, the
   * characteristic lines (independent signals, not a breakdown) and the
   * Skills / Subagents / Plugins / Models tables. Re-rendered per scope. */
  private renderAttributionPanel(attr: UsageAttribution): string {
    const t = I18n.t.popup;
    if (attr.totalCost <= 0) {
      return '<p class="table-hint">' + t.noDataMessage + '</p>';
    }
    const pct = (share: number): string => String(Math.round(share * 100));

    let html = '<p class="table-hint">' + t.attrDisclaimer + '</p>';

    const charLine = (share: number, template: string, hint: string, name?: string): string => {
      if (share < 0.01) {
        return '';
      }
      let text = template.replace('{pct}', pct(share));
      if (name !== undefined) {
        text = text.replace('{name}', name);
      }
      return (
        '<div class="attr-char">' + this.escapeHtml(text) +
        '<div class="attr-hint">' + this.escapeHtml(hint) + '</div></div>'
      );
    };
    const c = attr.characteristics;
    html += charLine(c.largeContext, t.attrLargeContext, t.attrLargeContextHint);
    html += charLine(c.longSessions, t.attrLongSessions, t.attrLongSessionsHint);
    html += charLine(c.subagentHeavy, t.attrSubagentHeavy, t.attrSubagentHeavyHint);
    html += charLine(c.workflows, t.attrWorkflows, t.attrWorkflowsHint);
    // Official parity: the top skill / plugin get their own characteristic
    // line once they contribute a noticeable share.
    if (attr.skills.length > 0 && attr.skills[0].share >= 0.1) {
      html += charLine(attr.skills[0].share, t.attrSkillChar, t.attrSkillCharHint, attr.skills[0].key);
    }
    if (attr.plugins.length > 0 && attr.plugins[0].share >= 0.1) {
      html += charLine(attr.plugins[0].share, t.attrPluginChar, t.attrPluginCharHint, attr.plugins[0].key);
    }

    // Sub-tables in the same horizontal-bar style as the content analysis
    // (bar width relative to the group's max; percentage is of scope usage).
    const group = (
      title: string,
      entries: { key: string; share: number; count: number; estTokens?: number }[],
      colorClass: string
    ): string => {
      if (entries.length === 0) {
        return '';
      }
      const top = entries.slice(0, 8);
      const maxShare = Math.max(...top.map((e) => e.share), 0.0001);
      let rows = '';
      top.forEach((e) => {
        const tooltip =
          e.key + ' · ' + t.count + ': ' + I18n.formatNumber(e.count) +
          (e.estTokens !== undefined ? ' · ' + t.estTokens + ': ~' + I18n.formatNumber(e.estTokens) : '');
        rows +=
          '<div class="cbar-row" title="' + this.escapeHtml(tooltip) + '">' +
          '<div class="cbar-label">' + this.escapeHtml(e.key) + '</div>' +
          '<div class="cbar-track"><div class="cbar-fill ' + colorClass + '" style="width: ' +
          ((e.share / maxShare) * 100).toFixed(1) + '%;"></div></div>' +
          '<div class="cbar-val">×' + I18n.formatNumber(e.count) + '</div>' +
          '<div class="cbar-pct">' + this.formatPercent(e.share) + '</div>' +
          '</div>';
      });
      return '<h4 class="cbar-subhead">' + this.escapeHtml(title) + '</h4><div class="cbar-list">' + rows + '</div>';
    };
    html +=
      group(t.attrSkills, attr.skills, 'cf-1') +
      group(t.attrSubagents, attr.subagents, 'cf-2') +
      group(t.attrPlugins, attr.plugins, 'cf-3') +
      (attr.models.length > 1 ? group(t.attrModels, attr.models, 'cf-5') : '');
    return html;
  }

  /** Usage-attribution section for the Content tab: scope selector (Day /
   * Week / Month / one session / one project) + the panel, default Week. */
  private renderAttributionSection(): string {
    const t = I18n.t.popup;
    if (!this.allRecords || this.allRecords.length === 0) {
      return '';
    }
    const weekAttr = ClaudeDataLoader.getUsageAttribution(this.allRecords, this.contentAnalysis, { kind: 'week' });

    const sessionOptions = this.sessionBreakdown
      .slice(0, 30)
      .map((s) => {
        const label = (s.title || s.sessionId).slice(0, 50);
        return '<option value="' + this.escapeHtml(s.sessionId) + '">' + this.escapeHtml(label) + '</option>';
      })
      .join('');
    const projectOptions = this.projectBreakdown
      .map(
        (g) =>
          '<option value="' + this.escapeHtml(g.groupPath) + '">' + this.escapeHtml(g.groupName) + '</option>'
      )
      .join('');

    const tab = (kind: string, label: string, active: boolean): string =>
      '<button class="attr-tab' + (active ? ' active' : '') + '" data-kind="' + kind +
      '" onclick="attrSetScope(\'' + kind + '\')">' + label + '</button>';

    return (
      '<div class="daily-breakdown">' +
      '<div class="section-header"><h3>' + t.attribution + '</h3>' +
      '<span class="section-header-right attr-controls">' +
      '<select id="attrTargetSession" onchange="requestAttribution()" style="display:none">' + sessionOptions + '</select>' +
      '<select id="attrTargetProject" onchange="requestAttribution()" style="display:none">' + projectOptions + '</select>' +
      tab('day', t.scopeDay, false) +
      tab('week', t.scopeWeek, true) +
      tab('month', t.scopeMonth, false) +
      tab('session', t.sessionTitle, false) +
      tab('project', t.project, false) +
      '</span></div>' +
      '<div id="attrPanel">' + this.renderAttributionPanel(weekAttr) + '</div>' +
      '</div>'
    );
  }

  private codexComparisonModelFamily(model: string): 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other' {
    const value = model.toLowerCase();
    if (value.includes('opus')) return 'opus';
    if (value.includes('sonnet')) return 'sonnet';
    if (value.includes('haiku')) return 'haiku';
    if (value.includes('fable')) return 'fable';
    return 'other';
  }

  private codexComparisonEffort(
    effort: string,
  ): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'unknown' {
    const value = effort.toLowerCase();
    return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' ||
      value === 'max' || value === 'ultra'
      ? value
      : 'unknown';
  }

  /**
   * Project the existing bounded Codex view into numeric task aggregates. The
   * rootTaskViewKey is used transiently only to join already-materialized child
   * rows; it has no destination in the returned or persisted representation.
   */
  private codexComparableTaskProjections(): CodexComparableTaskProjection[] {
    const view = this.codexView;
    if (!view) return [];
    interface Group {
      hasRoot: boolean;
      observedAtEpochMs: number;
      processed: number;
      fresh: number;
      childFresh: number;
      approvalReviewerFresh: number;
      patchCalls: number;
      toolCalls: number;
      postPatchToolCalls: number;
      taskCompleteCount: number;
      modelFamilies: Set<'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'>;
      efforts: Set<'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'unknown'>;
    }
    const groups = new Map<string, Group>();
    for (const thread of view.recentThreads.slice(0, 1_000)) {
      const current = groups.get(thread.rootTaskViewKey) ?? {
        hasRoot: false,
        observedAtEpochMs: 0,
        processed: 0,
        fresh: 0,
        childFresh: 0,
        approvalReviewerFresh: 0,
        patchCalls: 0,
        toolCalls: 0,
        postPatchToolCalls: 0,
        taskCompleteCount: 0,
        modelFamilies: new Set<'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'>(),
        efforts: new Set<'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'unknown'>(),
      };
      current.hasRoot ||= thread.role === 'root';
      current.observedAtEpochMs = Math.max(current.observedAtEpochMs, thread.observedAt);
      current.processed += Math.max(0, thread.total.processed);
      current.fresh += Math.max(0, thread.total.fresh);
      if (thread.role === 'subagent') current.childFresh += Math.max(0, thread.total.fresh);
      if (thread.role === 'approval-reviewer') {
        current.approvalReviewerFresh += Math.max(0, thread.total.fresh);
      }
      current.patchCalls += Math.max(0, thread.structural.patchCalls);
      current.toolCalls += Math.max(0, thread.structural.toolCalls);
      current.postPatchToolCalls += Math.max(0, thread.structural.postPatchToolCalls);
      current.taskCompleteCount += Math.max(0, thread.structural.taskCompleteCount);
      for (const model of thread.models) {
        current.modelFamilies.add(this.codexComparisonModelFamily(model));
      }
      for (const effort of thread.efforts) {
        current.efforts.add(this.codexComparisonEffort(effort));
      }
      groups.set(thread.rootTaskViewKey, current);
    }
    const qualityFlags = view.qualityFlags.map((item) => item.flag);
    return [...groups.values()]
      .filter((group) => group.hasRoot)
      .map((group) => ({
        observedAtEpochMs: group.observedAtEpochMs,
        total: { processed: group.processed, fresh: group.fresh },
        structural: {
          patchCalls: group.patchCalls,
          toolCalls: group.toolCalls,
          postPatchToolCalls: group.postPatchToolCalls,
          taskCompleteCount: group.taskCompleteCount,
        },
        childFreshShare: group.fresh > 0 ? group.childFresh / group.fresh : 0,
        approvalReviewerFreshShare:
          group.fresh > 0 ? group.approvalReviewerFresh / group.fresh : 0,
        modelFamilies: [...group.modelFamilies].sort(),
        efforts: [...group.efforts].sort(),
        coverage: {
          complete: view.coverage.complete,
          identityComplete: view.coverage.identity.complete,
          qualityFlags: [...qualityFlags],
        },
      }))
      .sort((left, right) => left.observedAtEpochMs - right.observedAtEpochMs);
  }

  private adviceComparablePairSampleKey(pair: StoredComparablePair): string {
    return JSON.stringify({
      recommendationId: pair.recommendationId,
      recommendationVersion: pair.recommendationVersion,
      context: pair.context,
      metric: pair.metric,
      quality: pair.quality,
      evidence: pair.evidence,
      recordedAtEpochMs: pair.recordedAtEpochMs,
    });
  }

  private adviceComparablePairCohortKey(pair: StoredComparablePair): string {
    return JSON.stringify({
      context: pair.context,
      metric: {
        name: pair.metric.name,
        unit: pair.metric.unit,
        direction: pair.metric.direction,
      },
    });
  }

  /** Pure state projection used by the production writer and focused tests. */
  private materializeAdviceComparisonState(
    _now: number = Date.now(),
    baseState: AdviceLocalState = this.adviceLocalState,
  ): AdviceLocalState {
    const providerState = this.adviceEffectivenessStates.codex;
    if (
      !this.adviceExperimentEnabled() ||
      !providerState ||
      !this.codexView ||
      this.adviceLocalStateStatus !== 'ready'
    ) {
      return baseState;
    }
    const tasks = this.codexComparableTaskProjections();
    let next = baseState;
    for (const recommendation of providerState.contract.recommendations) {
      if (!isComparableCodexRecommendationId(recommendation.id)) continue;
      const applied = [...next.feedback]
        .filter(
          (item) =>
            item.applied === 'applied' &&
            item.recommendationId === recommendation.id &&
            item.adviceId.startsWith('advice-codex-'),
        )
        .sort(
          (left, right) =>
            (right.appliedAtEpochMs ?? right.updatedAtEpochMs) -
              (left.appliedAtEpochMs ?? left.updatedAtEpochMs) ||
            right.adviceId.localeCompare(left.adviceId),
        )[0];
      if (!applied) continue;
      const built = buildAppliedComparablePairs({
        adviceId: applied.adviceId,
        recommendationId: recommendation.id,
        recommendationVersion: CODEX_LOCAL_RECOMMENDATION_VERSION,
        appliedAtEpochMs: applied.appliedAtEpochMs ?? applied.updatedAtEpochMs,
        tasks,
      });
      if (!built.ok) continue;
      const existingSamples = new Set(
        next.comparablePairs.map((pair) => this.adviceComparablePairSampleKey(pair)),
      );
      for (const pair of built.pairs) {
        const sampleKey = this.adviceComparablePairSampleKey(pair);
        if (existingSamples.has(sampleKey)) continue;
        const appended = appendStoredComparablePair(next, pair);
        if (!appended.ok) continue;
        next = appended.value;
        existingSamples.add(sampleKey);
      }

      const criterion = recommendation.successCriteria.find(
        (item) =>
          item.target.kind === 'relative-change' &&
          item.direction === 'decrease' &&
          item.qualityGuardrail.rubricId === 'task-quality-rubric-v1',
      );
      if (!criterion) continue;
      const lineage = next.comparablePairs.filter(
        (pair) =>
          pair.context.provider === 'codex' &&
          pair.recommendationId === recommendation.id &&
          pair.recommendationVersion === CODEX_LOCAL_RECOMMENDATION_VERSION &&
          pair.context.measurementProfileVersion === CODEX_COMPARISON_MEASUREMENT_PROFILE_VERSION,
      );
      const cohorts = new Map<string, StoredComparablePair[]>();
      for (const pair of lineage) {
        const key = this.adviceComparablePairCohortKey(pair);
        const cohort = cohorts.get(key) ?? [];
        cohort.push(pair);
        cohorts.set(key, cohort);
      }
      for (const pairs of cohorts.values()) {
        const first = pairs[0];
        const frozen = buildAdviceComparisonResultEnvelope({
          provider: 'codex',
          recommendationId: recommendation.id,
          recommendationVersion: CODEX_LOCAL_RECOMMENDATION_VERSION,
          measurementProfileVersion: CODEX_COMPARISON_MEASUREMENT_PROFILE_VERSION,
          cohort: {
            scope: first.context.scope,
            taskKind: first.context.taskKind,
            complexityBand: first.context.complexityBand,
            modelFamily: first.context.modelFamily,
            effort: first.context.effort,
            metricDefinitionVersion: first.context.metricDefinitionVersion,
            qualityRubricId: first.context.qualityRubricId,
            metric: {
              name: first.metric.name,
              unit: first.metric.unit,
              direction: first.metric.direction,
            },
          },
          guardrail: {
            minComparablePairs: criterion.minimumComparableTasks,
            minRelativeImprovement: criterion.target.value,
            minAfterQualityScore: criterion.qualityGuardrail.minimumScore,
            maxMeanQualityRegression: criterion.qualityGuardrail.maximumRegression,
            allowedQualityFlags: [],
            qualityRubricId: criterion.qualityGuardrail.rubricId,
          },
          pairs,
          recordedAtEpochMs: Math.max(...pairs.map((pair) => pair.recordedAtEpochMs)),
        });
        if (
          !frozen.ok ||
          next.comparisonResults.some(
            (result) => result.comparisonId === frozen.value.comparisonId,
          )
        ) {
          continue;
        }
        const appended = appendAdviceComparisonResult(next, frozen.value);
        if (appended.ok) next = appended.value;
      }
    }
    return next;
  }

  private currentAdviceComparisonProductionRevision(): string {
    const view = this.codexView;
    const safe = {
      enabled: this.adviceExperimentEnabled(),
      stateStatus: this.adviceLocalStateStatus,
      applied: this.adviceLocalState.feedback
        .filter((item) => item.applied === 'applied')
        .map((item) => ({
          adviceId: item.adviceId,
          recommendationId: item.recommendationId,
          appliedAtEpochMs: item.appliedAtEpochMs ?? item.updatedAtEpochMs,
        })),
      comparablePairCount: this.adviceLocalState.comparablePairs.length,
      comparisonResultCount: this.adviceLocalState.comparisonResults.length,
      codex: view
        ? {
            indexedFiles: view.coverage.indexedFiles,
            indexedBytes: view.coverage.indexedBytes,
            complete: view.coverage.complete,
            identityComplete: view.coverage.identity.complete,
            totalThreadCount: view.totalThreadCount,
            lastActiveAt: view.lastTaskIdentity?.lastActiveAt ?? 0,
            lastTaskTotal: view.lastTask?.total,
            lastTaskStructural: view.lastTask?.structural,
            qualityFlags: view.qualityFlags,
          }
        : null,
    };
    return createHash('sha256').update(JSON.stringify(safe), 'utf8').digest('hex');
  }

  private scheduleAdviceComparisonProduction(): void {
    if (
      !this.adviceExperimentEnabled() ||
      this.adviceLocalStateStatus !== 'ready' ||
      !this.codexView ||
      !this.adviceStateStorage()
    ) {
      return;
    }
    const revision = this.currentAdviceComparisonProductionRevision();
    if (revision === this.adviceComparisonProductionRevision) return;
    this.adviceComparisonProductionRevision = revision;
    void this.enqueueAdviceLocalStateWrite((current) => {
      const next = this.materializeAdviceComparisonState(Date.now(), current);
      if (
        next.comparablePairs.length === current.comparablePairs.length &&
        next.comparisonResults.length === current.comparisonResults.length
      ) {
        return undefined;
      }
      return next;
    })
      .then((saved) => {
        if (!saved.ok) {
          if (this.adviceComparisonProductionRevision === revision) {
            this.adviceComparisonProductionRevision = '';
          }
          return;
        }
        this.adviceComparisonProductionRevision =
          this.currentAdviceComparisonProductionRevision();
        if (saved.changed && this.panel) this.updateWebview();
      })
      .catch(() => {
        if (this.adviceComparisonProductionRevision === revision) {
          this.adviceComparisonProductionRevision = '';
        }
      });
  }

  private adviceComparison(
    state: AdviceEffectivenessProviderState,
    recommendationId: string | undefined,
  ): {
    status:
      | 'evidence-insufficient'
      | 'quality-guardrail-failed'
      | 'improved'
      | 'no-demonstrated-improvement';
    comparablePairs: number;
    minimumComparablePairs: number;
  } {
    const minimumComparablePairs = state.contract.recommendations
      .find((item) => item.id === recommendationId)
      ?.successCriteria[0]?.minimumComparableTasks ?? 5;
    if (!recommendationId) {
      return { status: 'evidence-insufficient', comparablePairs: 0, minimumComparablePairs };
    }
    const recommendationVersion = state.provider === 'codex' &&
      isComparableCodexRecommendationId(recommendationId)
      ? CODEX_LOCAL_RECOMMENDATION_VERSION
      : undefined;
    const frozen = this.adviceLocalState.comparisonResults
      .filter(
        (item) =>
          item.provider === state.provider &&
          item.recommendationId === recommendationId &&
          (!recommendationVersion || item.recommendationVersion === recommendationVersion),
      )
      .sort(
        (left, right) =>
          right.sample.pairCount - left.sample.pairCount ||
          right.recordedAtEpochMs - left.recordedAtEpochMs ||
          right.comparisonId.localeCompare(left.comparisonId),
      )[0];
    if (frozen) {
      return {
        status: frozen.result.status,
        comparablePairs: frozen.sample.pairCount,
        minimumComparablePairs: frozen.guardrail.minComparablePairs,
      };
    }
    const comparablePairs = this.adviceLocalState.comparablePairs.filter(
      (pair) =>
        pair.context.provider === state.provider &&
        pair.recommendationId === recommendationId &&
        (!recommendationVersion || pair.recommendationVersion === recommendationVersion),
    ).length;
    return { status: 'evidence-insufficient', comparablePairs, minimumComparablePairs };
  }

  /**
   * Hidden v2.3.1 candidate surface. It extends the existing Advice /
   * Recommendations cards instead of creating a third experience. Machine
   * summaries and prompt samples are intentionally never rendered here.
   */
  private renderAdviceEffectivenessBody(provider: AdviceEffectivenessProvider): string {
    if (!this.adviceExperimentEnabled()) {
      return '';
    }
    const t = I18n.t.popup.adviceEffectiveness;
    const state = this.adviceEffectivenessStates[provider];
    const html = (value: string): string => this.escapeHtml(value);
    const replace = (template: string, key: string, value: string): string =>
      template.replace(`{${key}}`, value);
    const percent = (value: number): string =>
      `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
    const contract = state?.contract;
    const recommendations = contract?.recommendations ?? [];
    const observations: string[] = [];
    let limitationText = t.qualityGuardrailPending;

    if (state && provider === 'claude') {
      const byMetric = new Map(state.contract.observations.map((item) => [item.metric, item]));
      const longSession = byMetric.get('long-session-share');
      const largeContext = byMetric.get('large-context-share');
      const framework = byMetric.get('framework-overhead-share');
      if (longSession && typeof longSession.value === 'number') {
        observations.push(replace(t.longSessionSignal, 'share', percent(longSession.value)));
      }
      if (largeContext && typeof largeContext.value === 'number') {
        observations.push(replace(t.largeContextSignal, 'share', percent(largeContext.value)));
      }
      if (framework && typeof framework.value === 'number') {
        observations.push(replace(t.frameworkOverheadSignal, 'share', percent(framework.value)));
      }
      limitationText = `${t.elapsedTimeProxy} ${t.qualityGuardrailPending}`;
    } else if (state && provider === 'codex') {
      const copy = I18n.t.providers.codex;
      for (const recommendation of recommendations) {
        const kind = recommendation.id.replace('recommendation-codex-', '') as
          keyof typeof copy.insightObservations;
        if (Object.prototype.hasOwnProperty.call(copy.insightObservations, kind)) {
          const observation = copy.insightObservations[kind];
          if (!observations.includes(observation)) observations.push(observation);
        }
      }
      limitationText = `${copy.structuralProxy} ${t.qualityGuardrailPending}`;
    }
    if (observations.length === 0) {
      observations.push(t.noEvidenceAdvice);
    }

    const evidenceText = state
      ? `${t.source}: ${provider === 'claude' ? 'Claude' : 'Codex'} · ${t.evidence}: ${state.contract.evidence.length}`
      : t.noEvidenceAdvice;
    const bodyId = `advice-effectiveness-${provider}`;
    const step = (index: number, label: string, content: string): string =>
      '<li><span class="advice-step-marker" aria-hidden="true">' + index + '</span>' +
      '<div><strong>' + html(label) + '</strong><p>' + content + '</p></div></li>';
    const feedbackFor = (recommendation: AdviceRecommendation, suppressed = false): string => {
      if (!state) return '';
      const feedback = this.adviceLocalState.feedback.find(
        (item) =>
          item.adviceId === state.contract.adviceId &&
          item.recommendationId === recommendation.id,
      );
      const snoozedUntil = adviceRecommendationSnoozedUntil(this.adviceLocalState, {
        provider,
        surface: 'advice',
        recommendationId: recommendation.id,
        nowEpochMs: Date.now(),
      });
      const disabled = this.adviceLocalStateStatus !== 'ready' ? ' disabled' : '';
      const button = (
        kind: 'helpful' | 'not-helpful' | 'applied',
        label: string,
        selected: boolean,
      ): string =>
        '<button type="button" class="advice-feedback-button' + (selected ? ' is-selected' : '') + '"' +
        ' data-advice-action="feedback" data-provider="' + provider + '"' +
        ' data-advice-id="' + html(state.contract.adviceId) + '"' +
        ' data-recommendation-id="' + html(recommendation.id) + '"' +
        ' data-feedback-kind="' + kind + '" aria-pressed="' + String(selected) + '"' + disabled + '>' +
        '<span aria-hidden="true">' + (selected ? '✓' : '○') + '</span> ' + html(label) + '</button>';
      return (
        '<div class="advice-feedback-section">' +
        '<h5>' + html(t.feedbackTitle) + '</h5>' +
        '<div class="advice-feedback-group" role="group" aria-label="' + html(t.feedbackTitle) + '">' +
        (suppressed ? '' :
          button('helpful', t.helpful, feedback?.rating === 'helpful') +
          button('not-helpful', t.notHelpful, feedback?.rating === 'not-helpful') +
          button('applied', t.applied, feedback?.applied === 'applied')) +
        '<button type="button" class="advice-feedback-button" data-advice-action="snooze"' +
        ' data-provider="' + provider + '" data-advice-id="' + html(state.contract.adviceId) +
        '" data-recommendation-id="' + html(recommendation.id) + '" data-snooze-mode="' +
        (snoozedUntil ? 'resume' : 'snooze') + '"' + disabled + '>' +
        html(snoozedUntil ? t.resume : t.snooze) + '</button>' +
        '</div>' +
        '<p class="advice-local-note">' + html(t.feedbackLocalOnly) + '</p>' +
        (snoozedUntil
          ? '<p class="advice-local-note">' + html(t.snoozedUntil.replace('{date}', this.formatAdviceSnoozeDate(snoozedUntil))) + '</p>'
          : '') +
        '<p class="advice-inline-status" data-advice-feedback-status="' + provider + '"' +
        ' data-advice-id="' + html(state.contract.adviceId) + '"' +
        ' data-recommendation-id="' + html(recommendation.id) + '" aria-live="polite"></p>' +
        '</div>'
      );
    };
    const recommendationCopy = (
      recommendation: AdviceRecommendation,
    ): { recommendation: string; action: string } => {
      if (provider === 'claude') {
        return { recommendation: t.clearBoundaryRecommendation, action: t.clearBoundaryAction };
      }
      const copy = I18n.t.providers.codex;
      const kind = recommendation.id.replace('recommendation-codex-', '') as keyof typeof copy.insightTips;
      return {
        recommendation: t.codexLocalRecommendation,
        action: Object.prototype.hasOwnProperty.call(copy.insightTips, kind)
          ? copy.insightTips[kind]
          : t.noEvidenceAdvice,
      };
    };
    const activeRecommendations = state
      ? recommendations.filter((recommendation) => !adviceRecommendationSnoozedUntil(this.adviceLocalState, {
          provider,
          surface: 'advice',
          recommendationId: recommendation.id,
          nowEpochMs: Date.now(),
        }))
      : [];
    const suppressedRecommendations = state
      ? recommendations.filter((recommendation) => !activeRecommendations.includes(recommendation))
      : [];
    const recommendationHtml = state && activeRecommendations.length > 0
      ? activeRecommendations.map((recommendation) => {
          const copy = recommendationCopy(recommendation);
          const comparison = this.adviceComparison(state, recommendation.id);
          const resultText = comparison.status === 'quality-guardrail-failed'
            ? t.qualityGuardrailFailed
            : comparison.status === 'improved'
              ? t.improved
              : comparison.status === 'no-demonstrated-improvement'
                ? t.noDemonstratedImprovement
                : t.insufficientEvidence;
          const pairText = replace(
            t.comparablePairs,
            'count',
            String(comparison.comparablePairs),
          );
          const minimumText = replace(
            t.minimumComparablePairs,
            'minimum',
            String(comparison.minimumComparablePairs),
          );
          return (
            '<div class="advice-recommendation-boundary" data-advice-recommendation="' +
            html(recommendation.id) + '">' +
            '<ol class="advice-spine" aria-label="' + html(t.spineLabel) + '">' +
            step(3, t.recommendation, html(copy.recommendation)) +
            step(4, t.action, html(copy.action)) +
            step(
              5,
              t.result,
              html(resultText) + '<br><span class="advice-step-caveat">' +
                html(pairText + ' · ' + minimumText) + '</span>',
            ) +
            '</ol>' + feedbackFor(recommendation) + '</div>'
          );
        }).join('') + suppressedRecommendations.map((recommendation) => {
          const until = adviceRecommendationSnoozedUntil(this.adviceLocalState, {
            provider,
            surface: 'advice',
            recommendationId: recommendation.id,
            nowEpochMs: Date.now(),
          });
          return '<details class="advice-recommendation-snoozed" data-advice-recommendation="' +
            html(recommendation.id) + '"><summary>' + html(t.snoozedUntil.replace(
              '{date}',
              until ? this.formatAdviceSnoozeDate(until) : '',
            )) + '</summary>' + feedbackFor(recommendation, true) + '</details>';
        }).join('')
      : state && suppressedRecommendations.length > 0
        ? suppressedRecommendations.map((recommendation) => {
            const until = adviceRecommendationSnoozedUntil(this.adviceLocalState, {
              provider,
              surface: 'advice',
              recommendationId: recommendation.id,
              nowEpochMs: Date.now(),
            });
            return '<details class="advice-recommendation-snoozed" data-advice-recommendation="' +
              html(recommendation.id) + '"><summary>' + html(t.snoozedUntil.replace(
                '{date}',
                until ? this.formatAdviceSnoozeDate(until) : '',
              )) + '</summary>' + feedbackFor(recommendation, true) + '</details>';
          }).join('')
      : '<ol class="advice-spine" aria-label="' + html(t.spineLabel) + '">' +
        step(3, t.recommendation, html(t.noEvidenceAdvice)) +
        step(4, t.action, html(t.noEvidenceAdvice)) +
        step(5, t.result, html(t.insufficientEvidence)) +
        '</ol>';

    let payloadHtml = '<p class="advice-local-note">' + html(t.codexPreviewUnavailable) + '</p>';
    if (state?.provider === 'claude' && state.remotePreviewEligible && state.aggregate) {
      const ready = this.adviceLocalStateStatus === 'ready';
      const aggregateChecked = ready && this.adviceLocalState.aggregateConsent === 'explicit';
      const promptAvailable = state.promptSamples.length > 0 || Boolean(state.userContext?.trim());
      const promptChecked =
        aggregateChecked && promptAvailable && this.adviceLocalState.promptSampleConsent === 'explicit';
      const aggregateDisabled = ready ? '' : ' disabled';
      const promptDisabled = ready && aggregateChecked && promptAvailable ? '' : ' disabled';
      const previewDisabled = ready && aggregateChecked ? '' : ' disabled';
      payloadHtml =
        '<div class="advice-payload-section">' +
        '<h5>' + html(t.payloadTitle) + '</h5>' +
        '<p class="advice-local-note">' + html(t.payloadDescription) + '</p>' +
        '<fieldset class="advice-consent" data-advice-consent="' + provider + '">' +
        '<legend>' + html(t.payloadTitle) + '</legend>' +
        '<label><input type="checkbox" data-advice-consent-kind="aggregate" data-provider="' + provider + '"' +
        (aggregateChecked ? ' checked' : '') + aggregateDisabled + '> <span><strong>' +
        html(t.aggregateConsentLabel) + '</strong><small>' + html(t.aggregateConsentHelp) + '</small></span></label>' +
        '<label><input type="checkbox" data-advice-consent-kind="prompt" data-provider="' + provider + '"' +
        ' data-prompt-available="' + String(promptAvailable) + '"' +
        (promptChecked ? ' checked' : '') + promptDisabled + '> <span><strong>' +
        html(t.promptConsentLabel) + '</strong><small>' +
        html(t.promptConsentHelp + ' ' + replace(
          t.promptWindowHelp,
          'days',
          String(state.aggregate.windowDays),
        )) + '</small></span></label>' +
        '</fieldset>' +
        '<div class="advice-payload-actions"><button type="button" class="btn-secondary btn-small"' +
        ' data-advice-action="preview" data-provider="' + provider + '"' + previewDisabled + '>' +
        html(t.previewPayload) + '</button><span>' + html(t.noNetworkTransport) + '</span></div>' +
        '<p class="advice-inline-status" data-advice-consent-status="' + provider + '" aria-live="polite"></p>' +
        '<details class="advice-payload-preview" data-advice-preview="' + provider + '" hidden>' +
        '<summary><span>' + html(t.payloadTitle) + '</span><span class="advice-seal-stamp">SHA-256</span></summary>' +
        '<div class="advice-payload-meta" aria-live="polite">' +
        '<span data-advice-preview-content-type></span><span data-advice-preview-mode></span><span data-advice-preview-bytes></span>' +
        '<span data-advice-preview-count></span><code data-advice-preview-digest></code></div>' +
        '<pre tabindex="0" data-advice-preview-body aria-label="' + html(t.payloadTitle) + '"></pre>' +
        '<div class="advice-payload-actions"><button type="button" class="btn-primary btn-small"' +
        ' data-advice-action="send" data-provider="' + provider + '" disabled>' +
        html(t.sendPreparedRequest) + '</button></div>' +
        '</details></div>';
    }

    return (
      '<section class="advice-effectiveness-body" data-advice-provider="' + provider + '" aria-labelledby="' + bodyId + '">' +
      '<div class="advice-effectiveness-heading"><h4 id="' + bodyId + '">' + html(t.title) +
      ' <span class="exp-pill">v2.3.1</span></h4><p>' + html(t.description) + '</p></div>' +
      '<p class="advice-candidate-note">' + html(t.candidateNotice) + '</p>' +
      '<ol class="advice-spine" aria-label="' + html(t.spineLabel) + '">' +
      step(1, t.observation, observations.map((item) => html(item)).join('<br>')) +
      step(2, t.evidence, html(evidenceText) + '<br><span class="advice-step-caveat">' + html(limitationText) + '</span>') +
      '</ol>' +
      recommendationHtml + payloadHtml +
      '<div class="advice-local-data-actions"><button type="button" class="btn-secondary btn-small"' +
      ' data-advice-action="clear" data-provider="' + provider + '">' +
      html(t.clearLocalData) + '</button></div>' +
      '</section>'
    );
  }

  /**
   * Prominent "AI advice" card at the top of the Content tab (Phase 9a). The
   * advice button used to live in the content-analysis header; this gives it a
   * proper home with a one-line explanation of what gets sent.
   */
  private renderAdviceCard(): string {
    const t = I18n.t.popup;
    return (
      '<div class="action-card">' +
      '<div class="action-card-head">' +
      '<span class="action-icon">✨</span>' +
      '<div class="action-card-titles">' +
      '<h3>' + t.adviceCardTitle + '</h3>' +
      '<p class="action-card-desc">' + t.adviceCardDesc + '</p>' +
      '</div>' +
      '<button class="btn-primary" onclick="getAdvice()">' + t.getAdvice + '</button>' +
      '</div>' +
      this.renderAdviceEffectivenessBody('claude') +
      '</div>'
    );
  }

  /**
   * Usage Optimizer card (Phase 9c). Default OFF — until the user opts in via
   * settings it shows only a description + an "enable" button. When enabled it
   * exposes a textarea + toggles; preparation and explicit sending run through
   * the same sealed-request hooks as advice. The result skeleton is baked
   * in (hidden) so the webview JS only fills text — no labels passed to JS.
   */
  private renderOptimizerCard(): string {
    const t = I18n.t.popup;
    const ai = t.adviceEffectiveness;
    const enabled = this.setting<boolean>('advice.optimizer.enabled', false);
    // Shared header: icon badge + title (with an "experimental" pill) + purpose.
    const head = (action: string): string =>
      '<div class="action-card-head">' +
      '<span class="action-icon">🛠</span>' +
      '<div class="action-card-titles">' +
      '<h3>' + t.optimizerTitle +
      ' <span class="exp-pill">' + t.experimentalBadge + '</span></h3>' +
      '<p class="action-card-desc">' + t.optimizerDesc + '</p>' +
      '</div>' +
      action +
      '</div>';

    if (!enabled) {
      return (
        '<div class="action-card" data-advice-provider="optimizer">' +
        head(
          '<button class="btn-secondary btn-small" onclick="showTab(\'settings\')">' +
            t.optimizerEnableBtn +
            '</button>'
        ) +
        '</div>'
      );
    }
    // Restore the last interaction so an auto-refresh re-render doesn't wipe it.
    const st = this.optimizerState;
    const ck = (b?: boolean): string => (b ? ' checked' : '');
    const draftVal = st ? this.escapeHtml(st.draft) : '';
    const hasResult = !!(st && (st.prompt || st.settings));
    const hasErr = !!(st && st.error);
    const hasPreview = !!(
      st && st.snapshotId && st.previewBody && st.previewSha256 && st.previewBytes !== undefined
    );
    const optimizerAdviceId = st?.adviceId ?? '';
    const optimizerFeedback = optimizerAdviceId
      ? this.adviceLocalState.feedback.find(
          (item) =>
            item.adviceId === optimizerAdviceId &&
            item.recommendationId === OPTIMIZER_FEEDBACK_RECOMMENDATION_ID,
        )
      : undefined;
    const optimizerSnoozedUntil = optimizerAdviceId
      ? adviceRecommendationSnoozedUntil(this.adviceLocalState, {
          provider: 'optimizer',
          surface: 'optimizer',
          recommendationId: OPTIMIZER_FEEDBACK_RECOMMENDATION_ID,
          nowEpochMs: Date.now(),
        })
      : null;
    const feedbackDisabled =
      !optimizerAdviceId || this.adviceLocalStateStatus !== 'ready' ? ' disabled' : '';
    const feedbackButton = (
      kind: 'helpful' | 'not-helpful' | 'applied',
      label: string,
      selected: boolean,
    ): string =>
      '<button type="button" class="advice-feedback-button' + (selected ? ' is-selected' : '') + '"' +
      ' data-advice-action="feedback" data-provider="optimizer"' +
      ' data-advice-id="' + this.escapeHtml(optimizerAdviceId) + '"' +
      ' data-recommendation-id="' + OPTIMIZER_FEEDBACK_RECOMMENDATION_ID + '"' +
      ' data-feedback-kind="' + kind + '" aria-pressed="' + String(selected) + '"' +
      feedbackDisabled + '><span aria-hidden="true">' + (selected ? '✓' : '○') +
      '</span> ' + this.escapeHtml(label) + '</button>';
    const optimizerFeedbackHtml =
      '<div id="optFeedback" class="advice-feedback-section" style="display:' +
      (hasResult && optimizerAdviceId ? '' : 'none') + '">' +
      '<h5>' + this.escapeHtml(ai.feedbackTitle) + '</h5>' +
      '<div class="advice-feedback-group" role="group" aria-label="' +
      this.escapeHtml(ai.feedbackTitle) + '">' +
      feedbackButton('helpful', ai.helpful, optimizerFeedback?.rating === 'helpful') +
      feedbackButton('not-helpful', ai.notHelpful, optimizerFeedback?.rating === 'not-helpful') +
      feedbackButton('applied', ai.applied, optimizerFeedback?.applied === 'applied') +
      '<button type="button" class="advice-feedback-button" data-advice-action="snooze" data-provider="optimizer"' +
      ' data-advice-id="' + this.escapeHtml(optimizerAdviceId) + '" data-recommendation-id="' +
      OPTIMIZER_FEEDBACK_RECOMMENDATION_ID + '" data-snooze-mode="' +
      (optimizerSnoozedUntil ? 'resume' : 'snooze') + '"' + feedbackDisabled + '>' +
      this.escapeHtml(optimizerSnoozedUntil ? ai.resume : ai.snooze) + '</button>' +
      '</div><p class="advice-local-note">' + this.escapeHtml(ai.feedbackLocalOnly) + '</p>' +
      (optimizerSnoozedUntil
        ? '<p class="advice-local-note">' + this.escapeHtml(ai.snoozedUntil.replace('{date}', this.formatAdviceSnoozeDate(optimizerSnoozedUntil))) + '</p>'
        : '') +
      '<p class="advice-inline-status" data-advice-feedback-status="optimizer"' +
      ' data-advice-id="' + this.escapeHtml(optimizerAdviceId) + '"' +
      ' data-recommendation-id="' + OPTIMIZER_FEEDBACK_RECOMMENDATION_ID +
      '" aria-live="polite"></p></div>';
    const optimizerSnoozedHtml = optimizerSnoozedUntil && optimizerAdviceId
      ? '<div class="advice-recommendation-snoozed" role="status">' +
        '<p class="advice-local-note">' + this.escapeHtml(ai.snoozedUntil.replace(
          '{date}',
          this.formatAdviceSnoozeDate(optimizerSnoozedUntil),
        )) + '</p>' +
        '<button type="button" class="advice-feedback-button" data-advice-action="snooze" data-provider="optimizer"' +
        ' data-advice-id="' + this.escapeHtml(optimizerAdviceId) + '" data-recommendation-id="' +
        OPTIMIZER_FEEDBACK_RECOMMENDATION_ID + '" data-snooze-mode="resume"' + feedbackDisabled + '>' +
        this.escapeHtml(ai.resume) + '</button></div>'
      : '';
    const optimizerResultHtml = optimizerSnoozedUntil
      ? ''
      : '<div id="optResult" class="opt-result" style="display:' + (hasResult ? '' : 'none') + '">' +
        '<h4 class="opt-subhead">' + t.optimizerPromptHeading + '</h4>' +
        '<div class="opt-output"><pre id="optPrompt">' +
        (st && st.prompt ? this.escapeHtml(st.prompt) : '') + '</pre>' +
        '<button class="opt-copy" data-copy="' + this.escapeHtml(t.optimizerCopy) +
        '" data-copied="' + this.escapeHtml(t.optimizerCopied) +
        '" title="' + this.escapeHtml(t.optimizerCopy) + '" onclick="copyOptPrompt(this)">' +
        '<span class="opt-copy-ico">⧉</span><span class="opt-copy-lbl">' +
        this.escapeHtml(t.optimizerCopy) + '</span></button></div>' +
        '<h4 class="opt-subhead">' + t.optimizerSettingsHeading + '</h4>' +
        '<div id="optSettings" class="opt-settings" data-raw="' +
        (st && st.settings ? this.escapeHtml(st.settings) : '') + '">' +
        (st && st.settings ? this.escapeHtml(st.settings) : '') + '</div>' +
        optimizerFeedbackHtml + '</div>';
    const optimizerPreviewHtml = optimizerSnoozedUntil
      ? ''
      : '<details id="optPreview" class="advice-payload-preview"' + (hasPreview ? ' open' : '') +
        ' style="display:' + (hasPreview ? '' : 'none') + '" data-snapshot-id="' +
        (hasPreview ? this.escapeHtml(st!.snapshotId as string) : '') + '">' +
        '<summary><span>' + this.escapeHtml(ai.payloadTitle) +
        '</span><span class="advice-seal-stamp">SHA-256</span></summary>' +
        '<div class="advice-payload-meta"><span id="optPreviewBytes">' +
        (hasPreview ? this.escapeHtml(ai.payloadBytes.replace('{bytes}', String(st!.previewBytes))) : '') +
        '</span><code id="optPreviewDigest">' +
        (hasPreview ? this.escapeHtml(`SHA-256 ${st!.previewSha256}`) : '') +
        '</code></div><pre id="optPreviewBody" tabindex="0">' +
        (hasPreview ? this.escapeHtml(st!.previewBody as string) : '') +
        '</pre><div class="advice-payload-actions"><button type="button" class="btn-primary btn-small"' +
        ' id="optSendBtn" onclick="sendOptimizer()"' + (hasPreview ? '' : ' disabled') + '>' +
        this.escapeHtml(ai.sendPreparedRequest) +
        '</button><span>' + this.escapeHtml(ai.noNetworkTransport) + '</span></div></details>';
    const lens = (id: string, label: string, hint: string, on?: boolean): string =>
      '<label title="' + this.escapeHtml(hint) + '"><input type="checkbox" id="' + id + '"' +
      ck(on) + '> ' + this.escapeHtml(label) + '</label>';
    return (
      '<div class="action-card" data-advice-provider="optimizer">' +
      head('') +
      optimizerSnoozedHtml +
      '<p class="action-card-howto">' + t.optimizerHowto + '</p>' +
      '<textarea id="optDraft" class="opt-input" rows="4" placeholder="' +
      this.escapeHtml(t.optimizerPlaceholder) + '">' + draftVal + '</textarea>' +
      '<div class="opt-controls">' +
      lens('optResolve', t.optimizerResolve, t.optimizerResolveHint, st?.resolve) +
      lens('optDistil', t.optimizerDistil, t.optimizerDistilHint, st?.distil) +
      lens('optAesthetic', t.optimizerAesthetic, t.optimizerAestheticHint, st?.aesthetic) +
      '<button class="btn-primary" id="optRunBtn" data-run="' +
      this.escapeHtml(ai.previewPayload) + '" data-running="' +
      this.escapeHtml(t.optimizerRunning) + '" onclick="runOptimizer()">' +
      ai.previewPayload + '</button>' +
      '</div>' +
      '<div id="optError" class="opt-error" style="display:' + (hasErr ? '' : 'none') + '">' +
      (hasErr ? this.escapeHtml(st!.error as string) : '') + '</div>' +
      optimizerPreviewHtml +
      optimizerResultHtml +
      '</div>'
    );
  }

  /**
   * "Content" tab: an estimated breakdown of which conversation content consumes
   * tokens (your prompts vs. tool results vs. assistant output), to help spot
   * habits worth optimising. Token figures are estimated from text length.
   */
  /** Opt-in (showEfficiency) "top 10 costliest messages" panel for the Content
   * tab. Ranks single assistant turns by cost; each row expands (native
   * <details>) to the prompt that triggered it, its token breakdown, model and
   * skill — so an expensive turn can be understood, in the same spirit as the
   * AI advice and optimizer cards that live alongside it. */
  /** Opt-in (showInsights) "Experimental insights" section on the Content tab.
   * Our own heuristic estimates from the local logs — labelled as estimates,
   * off by default, no prompts. First card: the cache-churn bill. Styled to the
   * plugin's existing card language (theme vars), with a small "estimate" tag
   * as the honest signature. */
  /** The cache analyses, recomputed at most once a week (they move slowly). */
  private getAnalysis(): NonNullable<UsageWebviewProvider['analysisCache']> {
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    if (!this.analysisCache || Date.now() - this.analysisCache.at > WEEK) {
      this.analysisCache = {
        at: Date.now(),
        ttl: ClaudeDataLoader.estimateCacheTtl(this.allRecords),
        churn: ClaudeDataLoader.estimateCacheChurnCost(this.allRecords, 30),
        byModel: ClaudeDataLoader.cacheStatsByModel(this.allRecords, 30),
        rightsizing: ClaudeDataLoader.modelRightsizing(this.allRecords, 30),
        health: ClaudeDataLoader.sessionHealth(this.allRecords, 30),
        hours: ClaudeDataLoader.activeHours(this.allRecords, 30, I18n.getTimezone()),
        skillRoi: ClaudeDataLoader.skillRoi(this.allRecords, 30),
      };
    }
    return this.analysisCache;
  }

  private renderInsights(): string {
    if (!this.setting<boolean>('showInsights', false) || !this.allRecords || this.allRecords.length === 0) {
      return '';
    }
    const cards: string[] = [];
    const analysis = this.getAnalysis();
    const money = (n: number): string => I18n.formatCurrency(n);

    // Cache-churn bill (缓存损耗账单).
    const churn = analysis.churn;
    if (churn && churn.wastedUsd >= 0.5) {
      cards.push(
        '<div class="insight-card">' +
          '<div class="insight-head"><span class="insight-title">Cache-churn bill</span>' +
          '<span class="insight-tag">estimate · last 30 days</span></div>' +
          '<div class="insight-hero">' + money(churn.wastedUsd) + '</div>' +
          '<div class="insight-sub">wasted re-writing cache a warm cache would have served cheaply</div>' +
          '<div class="insight-split">' +
          '<span class="insight-pill"><b>' + money(churn.idleUsd) + '</b> · idle gaps · ' + churn.idleCount + '×</span>' +
          '<span class="insight-pill"><b>' + money(churn.switchUsd) + '</b> · model switches · ' + churn.switchCount + '×</span>' +
          '</div>' +
          '<div class="insight-tip">💡 Most is recoverable — keep momentum inside the ~60-min warm window and batch same-model work.</div>' +
          '<div class="insight-note">A switch can still be worth it if the other model is cheaper per token; this counts only the churn cost.</div>' +
          '</div>'
      );
    }

    // Cache TTL by model / provider — how long each model's cache stays warm
    // (the durable, cross-user-comparable signal; it drifts over time). Bar and
    // number are the SAME metric (TTL) so there's no ambiguity; hit rate and
    // volume ride along as secondary. (Provider is the family's nominal vendor;
    // the serving endpoint isn't logged — a true cross-provider comparison needs
    // pooled cross-user data, reserved via dataContribution.ts.)
    const byModel = analysis.byModel;
    const withTtl = byModel.filter((s) => s.ttlMin != null);
    if (byModel.length >= 2 && withTtl.length >= 1) {
      const maxTtl = Math.max(...withTtl.map((s) => s.ttlMin as number), 60);
      const rows = byModel
        .map((s) => {
          const ttl = s.ttlMin;
          const w = ttl != null ? Math.max(4, Math.round((ttl / maxTtl) * 100)) : 0;
          const ttlLabel = ttl != null ? '~' + ttl + ' min' : '—';
          const sub = Math.round(s.hitRate * 100) + '% hit · ' + I18n.formatNumber(s.tokens) + ' tok';
          return (
            '<div class="cbm-row" title="' + this.escapeHtml(s.provider + ' · warm ' + ttlLabel + ' · ' + Math.round(s.hitRate * 100) + '% cache hit · ' + I18n.formatNumber(s.tokens) + ' tokens · ' + s.turns + ' turns') + '">' +
            '<div class="cbm-label">' + this.escapeHtml(this.shortModelName(s.model)) +
            '<span class="cbm-provider">' + this.escapeHtml(s.provider) + '</span></div>' +
            '<div class="cbm-mid"><div class="cbm-track"><div class="cbm-fill" style="width:' + w + '%"></div></div>' +
            '<div class="cbm-sub">' + this.escapeHtml(sub) + '</div></div>' +
            '<div class="cbm-pct">' + this.escapeHtml(ttlLabel) + '</div>' +
            '</div>'
          );
        })
        .join('');
      cards.push(
        '<div class="insight-card">' +
          '<div class="insight-head"><span class="insight-title">Cache warmth by model</span>' +
          '<span class="insight-tag">last 30 days</span></div>' +
          '<div class="insight-sub">how long each model keeps your cache warm (bar &amp; number = estimated warm window; hit rate + volume below)</div>' +
          '<div class="cbm-list">' + rows + '</div>' +
          '<div class="insight-tip">💡 A shorter warm window means that model re-writes cache sooner after an idle gap — keep momentum tighter on it, or lean on the longer-lived model for stop-start work.</div>' +
          '<div class="insight-note">Warm window is inferred from idle-gap hit rates; “—” means too few gaps to estimate yet. The serving provider isn\'t logged, so provider is nominal.</div>' +
          '</div>'
      );
    }

    // Model right-sizing (C5) is DEFERRED, not rendered. Carl's call: output size
    // is a weak proxy for task difficulty, and "use a cheaper model for simple
    // tasks" isn't an insight users lack — in practice they habitually stay on
    // the top model and just tack a simple task onto a long one. A worthwhile
    // version needs a real judgement of each task's "difficulty", which means
    // sampling prompt text through the (opt-in, user-key) AI-advice API — and
    // that upload must be clearly labelled. `modelRightsizing` stays in
    // dataLoader as dormant scaffolding for that v2. (analysis.rightsizing is
    // still computed weekly but intentionally not shown.)
    void analysis.rightsizing;

    // Session health: big one-shot turns → a nudge toward more checkpoints.
    const health = analysis.health;
    if (health) {
      const bigK = Math.round(health.biggestOut / 1000);
      cards.push(
        '<div class="insight-card">' +
          '<div class="insight-head"><span class="insight-title">Big one-shot turns</span>' +
          '<span class="insight-tag">last 30 days</span></div>' +
          '<div class="insight-hero">' + Math.round(health.jumboSharePct) + '%</div>' +
          '<div class="insight-sub">of your output came from ' + health.jumboCount + ' single turns over 4k tokens each (largest ≈ ' + bigK + 'k)</div>' +
          '<div class="insight-tip">💡 Big one-shot generations are costlier and slower to review, and a wrong direction is caught late. More, smaller checkpoints keep review cheap and catch mistakes early — reserve the big one-shots for when you genuinely can\'t monitor the run.</div>' +
          '<div class="insight-note">A large single turn is sometimes exactly right (a whole file, a long doc); this is a habit signal, not a verdict.</div>' +
          '</div>'
      );
    }

    // Active hours: when in the day you actually drive work (24h sparkline).
    const hrs = analysis.hours;
    if (hrs) {
      const max = Math.max(...hrs.hours, 1);
      const pk = hrs.peakStart;
      const hh = (h: number): string => String(((h % 24) + 24) % 24).padStart(2, '0') + ':00';
      const bars = hrs.hours
        .map((v, h) => {
          const inPeak = (((h - pk) % 24) + 24) % 24 < 4;
          const height = Math.max(2, Math.round((v / max) * 100));
          return (
            '<div class="hr-col" title="' + hh(h) + ' · ' + I18n.formatNumber(v) + ' tokens">' +
            '<div class="hr-bar' + (inPeak ? ' pk' : '') + '" style="height:' + height + '%"></div>' +
            (h % 6 === 0 ? '<div class="hr-lab">' + String(h).padStart(2, '0') + '</div>' : '<div class="hr-lab"></div>') +
            '</div>'
          );
        })
        .join('');
      cards.push(
        '<div class="insight-card">' +
          '<div class="insight-head"><span class="insight-title">Your active hours</span>' +
          '<span class="insight-tag">last 30 days</span></div>' +
          '<div class="insight-hero">' + hh(pk) + '–' + hh(pk + 4) + '</div>' +
          '<div class="insight-sub">your busiest 4-hour window — ' + Math.round(hrs.peakShare) + '% of your work happens then (bars = tokens per hour of day, your timezone)</div>' +
          '<div class="hr-spark">' + bars + '</div>' +
          '<div class="insight-tip">💡 Protect that window for the heavy work, and try to keep a task inside one warm session there — momentum in your peak hours is where the cache stays hot and review is sharpest.</div>' +
          '</div>'
      );
    }

    // Skill ROI: output returned per $ spent, per skill/plugin. Bar AND the
    // right-hand number are the SAME metric (out tokens per $) so they line up;
    // cost + turns ride along as secondary. Sorted by ROI so the bars rank.
    const roi = (analysis.skillRoi || []).slice().sort((a, b) => b.outPerUsd - a.outPerUsd);
    if (roi.length >= 2) {
      const maxRoi = Math.max(...roi.map((s) => s.outPerUsd), 1);
      const rows = roi
        .map((s) => {
          const short = s.name.includes(':') ? s.name.slice(s.name.indexOf(':') + 1) : s.name;
          const roiLabel = I18n.formatNumber(Math.round(s.outPerUsd)); // output tokens per $
          const w = Math.max(4, Math.round((s.outPerUsd / maxRoi) * 100));
          return (
            '<div class="cbm-row" title="' + this.escapeHtml(s.name + ' · ' + s.kind + ' · ' + roiLabel + ' output tokens per $ · ' + money(s.costUsd) + ' · ' + s.turns + ' turns') + '">' +
            '<div class="cbm-label">' + this.escapeHtml(short) +
            '<span class="cbm-provider">' + s.kind + '</span></div>' +
            '<div class="cbm-mid"><div class="cbm-track"><div class="cbm-fill" style="width:' + w + '%"></div></div>' +
            '<div class="cbm-sub">' + this.escapeHtml(money(s.costUsd) + ' · ' + s.turns + ' turns') + '</div></div>' +
            '<div class="cbm-pct" title="output tokens per $">' + roiLabel + '<span class="cbm-unit">/$</span></div>' +
            '</div>'
          );
        })
        .join('');
      cards.push(
        '<div class="insight-card">' +
          '<div class="insight-head"><span class="insight-title">Skill ROI</span>' +
          '<span class="insight-tag">last 30 days</span></div>' +
          '<div class="insight-sub">output tokens returned per $ spent while each skill / plugin was active (bar &amp; number = out tokens per $; cost + turns below)</div>' +
          '<div class="cbm-list">' + rows + '</div>' +
          '<div class="insight-tip">💡 A low out-tokens/$ skill is burning context for little output — worth invoking deliberately, or trimming what it loads. A high one is a lean win you can lean on.</div>' +
          '<div class="insight-note">Only turns Claude Code tagged with a skill/plugin (≥2.1) are counted; cost is attributed to the active skill and output isn\'t "value", so treat it as a proxy.</div>' +
          '</div>'
      );
    }

    if (cards.length === 0) {
      return '';
    }
    return (
      '<div class="insights-panel"><h3>Experimental insights</h3>' +
      '<p class="table-hint">Our own estimates from your local logs — heuristics, not standardized metrics (hence opt-in + labelled). No prompts leave your machine.</p>' +
      cards.join('') +
      '</div>'
    );
  }

  /** Opt-in (showEfficiency) "cache warmth" insight: an estimate of how long the
   * prompt cache stays warm while idle, measured from the user's own turns.
   * Aggregate only (no prompts) — so it rides on the efficiency toggle. */
  private renderCacheWarmth(): string {
    if (!this.setting<boolean>('showEfficiency', false) || !this.allRecords || this.allRecords.length === 0) {
      return '';
    }
    const est = this.getAnalysis().ttl; // recomputed at most weekly
    if (!est) {
      return '';
    }
    return (
      '<div class="costly-panel"><h3>Cache warmth</h3>' +
      '<p class="table-hint">Estimated from ' + I18n.formatNumber(est.sampleN) +
      ' of your same-model turns — the cache TTL is platform-side and can vary, so this is a measurement, not a guarantee.</p>' +
      '<div class="cache-warmth">Your prompt cache appears to stay warm for about <strong>' + est.estimateMin +
      ' min</strong> of idle; the hit rate drops off after ~' + est.coldFromMin +
      ' min. Keep a complex task moving within that window to avoid re-paying for cold-cache rewrites.</div>' +
      '</div>'
    );
  }

  private renderCostliestMessages(): string {
    // Own opt-in (separate from showEfficiency) because it displays your prompt
    // text — a privacy step above the aggregate efficiency chips.
    if (!this.setting<boolean>('showCostliestMessages', false)) {
      return '';
    }
    const top = this.costliestMessages || [];
    if (top.length === 0) {
      return '';
    }
    const t = I18n.t.popup;
    const detailRow = (label: string, value: string): string =>
      '<div class="costly-kv"><span>' + label + '</span><span>' + value + '</span></div>';
    // Bold row for the two signals that explain a costly turn.
    const detailRowBold = (label: string, value: string): string =>
      '<div class="costly-kv costly-kv-strong"><span>' + label + '</span><span>' + value + '</span></div>';
    // Human gap since the previous turn; "New conversation" for a session's first.
    const fmtGap = (ms: number | undefined): string => {
      if (ms === undefined) {
        return 'New conversation';
      }
      const m = Math.round(ms / 60000);
      if (m < 60) {
        return m + 'm';
      }
      const h = Math.floor(m / 60);
      return h < 24 ? h + 'h ' + (m % 60) + 'm' : (h / 24).toFixed(1) + 'd';
    };
    // Which token type drove the cost? Names the reason a turn was expensive so
    // the prompt alone isn't the only signal Carl has to go on.
    const driverOf = (m: CostlyMessage): string => {
      const parts: { key: string; v: number }[] = [
        { key: 'cache writes (miss)', v: m.costCacheWrite },
        { key: 'output', v: m.costOutput },
        { key: 'uncached input', v: m.costInput },
        { key: 'cache reads', v: m.costCacheRead },
      ];
      parts.sort((a, b) => b.v - a.v);
      const share = m.cost > 0 ? Math.round((parts[0].v / m.cost) * 100) : 0;
      return `${parts[0].key} (${share}% of cost)`;
    };
    let rows = '';
    top.forEach((m, i) => {
      const tokens = m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens;
      const inputSide = m.inputTokens + m.cacheCreationTokens + m.cacheReadTokens;
      const hitRate = inputSide > 0 ? m.cacheReadTokens / inputSide : 0;
      const promptText = m.prompt && m.prompt.trim() ? m.prompt.trim() : '(no prompt captured)';
      const promptShort = promptText.length > 80 ? promptText.slice(0, 80) + '…' : promptText;
      const truncated = !!(m.prompt && m.prompt.length >= 4000);
      const skillLabel = m.skill ? (m.plugin ? m.skill + ' · ' + m.plugin : m.skill) : '—';
      // Cost split — the key to telling a cache miss from a long answer.
      const costSplit =
        'write ' + I18n.formatCurrency(m.costCacheWrite) +
        ' · read ' + I18n.formatCurrency(m.costCacheRead) +
        ' · out ' + I18n.formatCurrency(m.costOutput) +
        ' · in ' + I18n.formatCurrency(m.costInput);
      rows +=
        '<details class="costly-row" data-persist="costly-' + i + '"><summary>' +
        '<span class="costly-rank">' + (i + 1) + '</span>' +
        '<span class="costly-name" title="' + this.escapeHtml(promptText) + '">' + this.escapeHtml(promptShort) + '</span>' +
        '<span class="costly-cost">' + I18n.formatCurrency(m.cost) + '</span>' +
        '</summary><div class="costly-detail">' +
        (m.prompt
          ? '<div class="costly-prompt">' + this.escapeHtml(promptText) + (truncated ? '\n… (truncated)' : '') + '</div>'
          : '') +
        detailRow('Main cost driver', this.escapeHtml(driverOf(m))) +
        detailRowBold('Cache-hit rate', this.formatPercent(hitRate)) +
        detailRowBold('Time since last turn', this.escapeHtml(fmtGap(m.gapMs)) +
          (m.gapMs !== undefined && m.gapMs > 5 * 60000 ? ' ⚠ past cache TTL' : '')) +
        // Name the likely cache-miss cause when the hit rate is low.
        (hitRate < 0.2 && m.prevModel && m.prevModel !== m.model
          ? detailRowBold('Likely cause', 'model switch (' + this.escapeHtml(this.shortModelName(m.prevModel)) + ' → ' + this.escapeHtml(this.shortModelName(m.model)) + ') flushed the cache')
          : hitRate < 0.2 && m.gapMs !== undefined && m.gapMs > 5 * 60000
            ? detailRowBold('Likely cause', 'idle ' + this.escapeHtml(fmtGap(m.gapMs)) + ' — cache went cold')
            : '') +
        detailRow('Cost split', this.escapeHtml(costSplit)) +
        detailRow(t.model, this.escapeHtml(m.model)) +
        detailRow('Skill', this.escapeHtml(skillLabel)) +
        detailRow(t.totalTokens, I18n.formatNumber(tokens)) +
        detailRow(t.inputTokens, I18n.formatNumber(m.inputTokens)) +
        detailRow(t.outputTokens, I18n.formatNumber(m.outputTokens)) +
        detailRow(t.cacheCreation, I18n.formatNumber(m.cacheCreationTokens)) +
        detailRow(t.cacheRead, I18n.formatNumber(m.cacheReadTokens)) +
        detailRow(t.project, this.escapeHtml(m.projectName || '—')) +
        '</div></details>';
    });
    return (
      '<div class="costly-panel"><h3>Top 10 costliest messages</h3>' +
      '<p class="table-hint">Single responses ranked by cost. Expand for the prompt and a cost split — a high "cache writes (miss)" share means the context was re-sent uncached, not that the answer was long.</p>' +
      rows +
      '</div>'
    );
  }

  private renderContentData(provider: SettingProvider = 'claude'): string {
    if (provider === 'codex') {
      const view = this.codexView;
      const copy = I18n.t.providers.codex;
      if (!view) {
        return this.renderCodexEmptyState();
      }
      const behavior = view.behaviorScopes.last30Days;
      const percent = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
      const metric = (label: string, value: string): string =>
        '<div class="summary-item"><div class="label">' + this.escapeHtml(label) +
        '</div><div class="value">' + this.escapeHtml(value) + '</div></div>';
      const behaviorSummary = '<div class="usage-summary"><div class="summary-grid">' +
        metric(copy.childThreadsPerRootTask, behavior.childThreadsPerRootTask.toFixed(1)) +
        metric(copy.childFreshShare, percent(behavior.childFreshShare)) +
        metric(copy.approvalFreshShare, percent(behavior.approvalReviewerFreshShare)) +
        metric(copy.highEffortFreshShare, percent(behavior.highEffortFreshShare)) +
        metric(copy.processedToFreshRatio, behavior.processedToFreshRatio.toFixed(1) + '×') +
        metric(copy.reasoningOutputShare, percent(behavior.reasoningOutputShare)) +
        metric(copy.postPatchToolCallsPerPatchCall, behavior.postPatchToolCallsPerPatchCall.toFixed(1)) +
        metric(copy.compactions, I18n.formatNumber(behavior.compactCount)) +
        '</div></div>';
      const insights = this.codexInsights.last30Days;
      const insightHtml = insights.length === 0
        ? '<div class="model-item"><p class="table-hint">' + this.escapeHtml(copy.recommendationEmpty) + '</p></div>'
        : '<div class="model-list">' + insights.map((insight) => {
            const evidence = Object.entries(insight.evidence).map(([key, value]) => {
              const label = copy.insightEvidenceLabels[key as keyof typeof copy.insightEvidenceLabels] ?? key;
              const formattedValue = typeof value === 'number' ? I18n.formatNumber(value) : String(value);
              return '<span><span class="model-stat-label">' + this.escapeHtml(label) + '</span><strong>' +
                this.escapeHtml(formattedValue) + '</strong></span>';
            }).join('');
            return '<div class="model-item"><div class="model-header"><span class="model-name">' +
              this.escapeHtml(copy.insightTitles[insight.kind]) + '</span></div>' +
              '<p class="model-details"><strong>' + this.escapeHtml(copy.insightObservation) + ':</strong> ' +
              this.escapeHtml(copy.insightObservations[insight.kind]) + '</p>' +
              '<div class="model-details model-details-stacked">' + evidence + '</div>' +
              '<p class="model-details"><strong>' + this.escapeHtml(copy.insightConditionalAction) + ':</strong> ' +
              this.escapeHtml(copy.insightTips[insight.kind]) + '</p></div>';
          }).join('') + '</div>';
      const partial = view.periodCoverage.last30Days.complete
        ? ''
        : '<p class="table-hint">' + this.escapeHtml(copy.recommendationPartial) + '</p>';
      return '<div class="action-card"><div class="action-card-head"><span class="action-icon">✨</span>' +
        '<div class="action-card-titles"><h3>' + this.escapeHtml(copy.optimization) + '</h3>' +
        '<p class="action-card-desc">' + this.escapeHtml(copy.structuralProxy) + '</p></div></div>' +
        this.renderAdviceEffectivenessBody('codex') + '</div>' +
        '<div class="daily-breakdown"><div class="section-header"><h3>' +
        this.escapeHtml(copy.behavior + ' · ' + copy.last30Days) + '</h3></div>' +
        partial + behaviorSummary + insightHtml + '</div>';
    }
    const t = I18n.t.popup;
    const topCards = this.renderAdviceCard() + this.renderOptimizerCard();
    const analysis = this.contentAnalysis;
    if (!analysis || analysis.categories.length === 0 || analysis.totalEstimatedTokens === 0) {
      return topCards + (this.renderAttributionSection() ||
        '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>');
    }

    // Calibration (Phase 8): scale the text-length category estimates to the
    // EXACT billed totals — assistant-side categories to real output tokens,
    // input-side to real (input + cache-creation). Within-side relative shares
    // stay as estimated; the cross-side ratio (e.g. tool-results vs assistant
    // output) is corrected to billing reality. Toggle: analysis.calibrate.
    const calibrateOn = this.setting<boolean>('analysis.calibrate', true);
    const cal = calibrateOn && analysis.calibration ? analysis.calibration : null;
    const ASSISTANT_CATS = new Set(['assistantText', 'assistantThinking', 'toolCalls']);
    const INPUT_CATS = new Set(['userPrompts', 'toolResults']);
    let estAssistant = 0;
    let estInput = 0;
    analysis.categories.forEach((c) => {
      if (ASSISTANT_CATS.has(c.key)) {
        estAssistant += c.estimatedTokens;
      } else if (INPUT_CATS.has(c.key)) {
        estInput += c.estimatedTokens;
      }
    });
    const factorFor = (key: string): number => {
      if (!cal) {
        return 1;
      }
      if (ASSISTANT_CATS.has(key)) {
        return estAssistant > 0 ? cal.realOutputTokens / estAssistant : 1;
      }
      if (INPUT_CATS.has(key)) {
        return estInput > 0 ? cal.realInputSideTokens / estInput : 1;
      }
      return 1;
    };
    const tokensFor = (key: string, estTokens: number): number => Math.round(estTokens * factorFor(key));
    const total = cal
      ? analysis.categories.reduce((sum, c) => sum + tokensFor(c.key, c.estimatedTokens), 0)
      : analysis.totalEstimatedTokens;

    const catLabel = (key: string): string => {
      switch (key) {
        case 'userPrompts':
          return t.catUserPrompts;
        case 'assistantText':
          return t.catAssistantText;
        case 'assistantThinking':
          return t.catAssistantThinking;
        case 'toolCalls':
          return t.catToolCalls;
        case 'toolResults':
          return t.catToolResults;
        default:
          return key;
      }
    };
    const catColor: Record<string, string> = {
      userPrompts: 'cf-1',
      assistantText: 'cf-2',
      assistantThinking: 'cf-3',
      toolCalls: 'cf-4',
      toolResults: 'cf-5',
    };

    const barRow = (label: string, tokens: number, barMax: number, colorClass: string): string => {
      const pct = total > 0 ? (tokens / total) * 100 : 0;
      const width = barMax > 0 ? (tokens / barMax) * 100 : 0;
      return (
        '<div class="cbar-row">' +
        '<div class="cbar-label" title="' + this.escapeHtml(label) + '">' + this.escapeHtml(label) + '</div>' +
        '<div class="cbar-track"><div class="cbar-fill ' + colorClass + '" style="width: ' + width.toFixed(1) + '%;"></div></div>' +
        '<div class="cbar-val">' + I18n.formatNumber(tokens) + '</div>' +
        '<div class="cbar-pct">' + pct.toFixed(1) + '%</div>' +
        '</div>'
      );
    };

    const catTokens = analysis.categories.map((c) => tokensFor(c.key, c.estimatedTokens));
    const maxCat = Math.max(...catTokens, 1);
    let catRows = '';
    analysis.categories.forEach((c, i) => {
      catRows += barRow(catLabel(c.key), catTokens[i], maxCat, catColor[c.key] || 'cf-1');
    });

    let toolSection = '';
    if (analysis.toolResultBreakdown.length > 0) {
      // Tool results are input-side; scale by the same factor as toolResults.
      const toolTokens = analysis.toolResultBreakdown.map((s) => tokensFor('toolResults', s.estimatedTokens));
      const maxTool = Math.max(...toolTokens, 1);
      let toolRows = '';
      analysis.toolResultBreakdown.forEach((s, i) => {
        toolRows += barRow(s.key, toolTokens[i], maxTool, 'cf-4');
      });
      toolSection = '<h4 class="cbar-subhead">' + t.byTool + '</h4><div class="cbar-list">' + toolRows + '</div>';
    }

    // Calibrated figures are exact-anchored; estimates are text-length only.
    const totalLabel = cal ? t.calibratedTokens : t.estTokens;
    const totalPrefix = cal ? '' : '~';
    const noteLine = cal ? t.calibratedNote : t.estimatedNote;

    return (
      topCards +
      this.renderAttributionSection() +
      '<div class="daily-breakdown">' +
      '<div class="section-header"><h3>' + t.contentAnalysis + '</h3>' +
      '<span class="section-header-right">' +
      '<span class="cbar-total">' + totalLabel + ': ' + totalPrefix + I18n.formatNumber(total) + '</span>' +
      '</span></div>' +
      '<p class="table-hint">' + t.last30days + ' · ' + noteLine + '</p>' +
      '<div class="cbar-list">' + catRows + '</div>' +
      toolSection +
      '</div>'
    );
  }

  /**
   * Static stacked-bar chart breaking each period into input / cache-read /
   * cache-write / output tokens — a finer view than the single-metric chart.
   */
  private renderCompositionChart(
    items: { label: string; data: UsageData | CodexMetricTotals; key?: string }[],
    provider: SettingProvider = 'claude',
    drilldown: 'month' | 'codex-hour' | 'none' = items.some((item) => item.key)
      ? 'month'
      : 'none',
  ): string {
    if (!items || items.length === 0) {
      return '';
    }

    const t = I18n.t.popup;
    const codexCopy = I18n.t.providers.codex;
    const maxHeight = 120;
    const values = items.map((item) => {
      if (provider === 'codex') {
        const composition = tokenComposition(item.data as CodexMetricTotals);
        return {
          input: composition.freshInput,
          cacheRead: composition.cachedInput,
          cacheCreation: 0,
          output: composition.output,
        };
      }
      const data = item.data as UsageData;
      return {
        input: data.totalInputTokens,
        cacheRead: data.totalCacheReadTokens,
        cacheCreation: data.totalCacheCreationTokens,
        output: data.totalOutputTokens,
      };
    });
    const totals = values.map((value) => value.input + value.cacheRead + value.cacheCreation + value.output);
    const maxTotal = Math.max(...totals, 1);

    let bars = '';
    items.forEach((it, idx) => {
      const d = values[idx];
      const total = totals[idx];
      const barHeight = (total / maxTotal) * maxHeight;
      const seg = (value: number, cls: string, label: string): string => {
        const h = total > 0 ? (value / total) * barHeight : 0;
        return (
          '<div class="stack-seg ' +
          cls +
          '" style="height: ' +
          h +
          'px;" title="' +
          this.escapeHtml(label) +
          ': ' +
          I18n.formatNumber(value) +
          '"></div>'
        );
      };
      // In the all-time view each bar is a month (it.key = its date); make it
      // click-to-expand that month's per-day composition (reuses the table's
      // month-detail round-trip).
      const controls = drilldown === 'codex-hour'
        ? 'codex-alltime-hourly-detail-'
        : 'monthly-detail-';
      const action = drilldown === 'codex-hour'
        ? 'toggleCodexHourlyDetail(\'' + it.key + '\', this)'
        : 'toggleMonthlyDetail(\'' + it.key + '\')';
      const colOpen = drilldown !== 'none' && it.key
        ? '<div class="hc-col hc-col-clickable" data-date="' + this.escapeHtml(it.key) +
          '" role="button" tabindex="0" aria-expanded="false" aria-controls="' + controls +
          this.escapeHtml(it.key) + '" onclick="' + action + '" title="' +
          this.escapeHtml(it.label) + ' — ' + I18n.formatNumber(total) + '">'
        : '<div class="hc-col">';
      bars +=
        colOpen +
        '<div class="stack-bar" title="' +
        this.escapeHtml(it.label) +
        ': ' +
        I18n.formatNumber(total) +
        '">' +
        seg(d.input, 'seg-input', provider === 'codex' ? codexCopy.freshInput : t.inputTokens) +
        seg(d.cacheRead, 'seg-cache-read', provider === 'codex' ? codexCopy.cachedInput : t.cacheRead) +
        (provider === 'claude' ? seg(d.cacheCreation, 'seg-cache-creation', t.cacheCreation) : '') +
        seg(d.output, 'seg-output', provider === 'codex' ? codexCopy.output : t.outputTokens) +
        '</div>' +
        '</div>';
    });

    const xlabels = items.map((it) => '<div class="hc-xlabel">' + this.escapeHtml(it.label) + '</div>').join('');

    const dot = (cls: string, label: string): string =>
      '<span class="legend-item"><span class="legend-dot ' + cls + '"></span>' + label + '</span>';

    return (
      '<div class="composition-chart">' +
      '<h4>' +
      (provider === 'codex' ? codexCopy.tokenComposition : t.tokenComposition) +
      '</h4>' +
      '<div class="stack-legend">' +
      dot('seg-input', provider === 'codex' ? codexCopy.freshInput : t.inputTokens) +
      dot('seg-cache-read', provider === 'codex' ? codexCopy.cachedInput : t.cacheRead) +
      (provider === 'claude' ? dot('seg-cache-creation', t.cacheCreation) : '') +
      dot('seg-output', provider === 'codex' ? codexCopy.output : t.outputTokens) +
      '</div>' +
      '<div class="hc-wrap">' +
      '<div class="hc-yaxis">' +
      '<span class="hc-yval">' + I18n.formatNumber(maxTotal) + '</span>' +
      '<span class="hc-yval">' + I18n.formatNumber(Math.round(maxTotal / 2)) + '</span>' +
      '<span class="hc-yval">0</span>' +
      '</div>' +
      '<div class="hc-main"><div class="hc-scroll" tabindex="0">' +
      '<div class="hc-plot">' +
      '<div class="hc-grid hc-grid-top"></div>' +
      '<div class="hc-grid hc-grid-mid"></div>' +
      '<div class="hc-bars">' +
      bars +
      '</div>' +
      '</div>' +
      '<div class="hc-xlabels">' +
      xlabels +
      '</div>' +
      '</div></div>' +
      '</div>' +
      '</div>'
    );
  }

  private renderDailyChart(
    provider: SettingProvider = 'claude',
    claudeRows: { date: string; data: UsageData }[] = this.dailyDataForRolling30Days,
    claudeInteractiveDays?: ReadonlySet<string>,
  ): string {
    if (provider === 'codex') {
      const rows = this.codexView?.last30DaysDaily ?? [];
      return this.renderMainCostChart(
        rows.map((row) => ({
          date: row.day,
          data: { total: row.total, apiEquivalent: row.apiEquivalent, threads: row.threads },
        })),
        false,
        provider,
      );
    }
    const sortedData = [...claudeRows].sort((a, b) => a.date.localeCompare(b.date));
    return this.renderMainCostChart(sortedData, false, provider, claudeInteractiveDays);
  }

  private renderAllTimeChart(provider: SettingProvider = 'claude'): string {
    if (provider === 'codex') {
      const rows = this.codexView?.monthly ?? [];
      return this.renderMainCostChart(
        rows.map((row) => ({
          date: row.period,
          data: { total: row.total, apiEquivalent: row.apiEquivalent, threads: row.threads },
        })),
        true,
        provider,
      );
    }
    const sortedData = [...this.dailyDataForAllTime].sort((a, b) => a.date.localeCompare(b.date));
    return this.renderMainCostChart(sortedData, true, provider);
  }

  /**
   * Daily / monthly time-series chart. Default (cost) metric renders each bar
   * as a stacked cost-composition (input / output / cache-write / cache-read,
   * same colours as the summary's Cost Composition). A Y-axis and two dashed
   * reference lines give scale; the metric switcher re-renders bars in place
   * (stacked for cost, single-colour for token/message metrics).
   *
   * Bars carry the cost breakdown as data attributes so updateMainChart can
   * rebuild the stack on the client without another round-trip. Drill-down is
   * preserved by making the cost segments pointer-events:none so clicks reach
   * the parent .chart-bar.clickable.
   */
  /** Stacked cost segments for one bar (input / cache-read / cache-write /
   * output), heights proportional to each component's share of the bar's
   * cost. Order + colours match renderCompositionChart. Shared by the daily /
   * monthly and today-hourly cost charts. */
  private costStackHtml(data: UsageData, barHeight: number): string {
    const t = I18n.t.popup;
    const cb = data.costBreakdown;
    const total = cb.input + cb.output + cb.cacheWrite + cb.cacheRead;
    const seg = (value: number, cls: string, label: string): string => {
      const h = total > 0 ? (value / total) * barHeight : 0;
      return (
        '<div class="stack-seg ' + cls + '" style="height: ' + h + 'px;" title="' +
        this.escapeHtml(label) + ': ' + I18n.formatCurrency(value) + '"></div>'
      );
    };
    return (
      seg(cb.input, 'seg-input', t.inputTokens) +
      seg(cb.cacheRead, 'seg-cache-read', t.cacheRead) +
      seg(cb.cacheWrite, 'seg-cache-creation', t.cacheCreation) +
      seg(cb.output, 'seg-output', t.outputTokens)
    );
  }

  private codexCostStackHtml(cost: EquivalentCostBreakdown, barHeight: number): string {
    const copy = I18n.t.providers.codex;
    const total = cost.freshInputUsd + cost.cachedInputUsd + cost.outputUsd;
    const seg = (value: number, cls: string, label: string): string => {
      const height = total > 0 ? (value / total) * barHeight : 0;
      return '<div class="stack-seg ' + cls + '" style="height: ' + height + 'px;" title="' +
        this.escapeHtml(label) + ': ' + I18n.formatCurrency(value) + '"></div>';
    };
    return seg(cost.freshInputUsd, 'seg-input', copy.freshInput) +
      seg(cost.cachedInputUsd, 'seg-cache-read', copy.cachedInput) +
      seg(cost.outputUsd, 'seg-output', copy.output);
  }

  private codexCostHelp(cost: EquivalentCostBreakdown): string {
    const coverage = new Intl.NumberFormat(I18n.getLocale(), {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(cost.pricingCoverage);
    return I18n.t.providers.codex.apiEquivalentCostHelp.replace('{coverage}', coverage);
  }

  private codexCostLabel(cost: EquivalentCostBreakdown, processedTokens: number): string {
    return cost.pricedTokens > 0 || processedTokens === 0
      ? I18n.formatCurrency(cost.equivalentUsd)
      : '—';
  }

  private renderMainCostChart(
    sortedData: Array<{
      date: string;
      data: UsageData | {
        total: CodexMetricTotals;
        apiEquivalent: EquivalentCostBreakdown;
        threads: number;
      };
    }>,
    monthly = false,
    provider: SettingProvider = 'claude',
    claudeInteractiveDays?: ReadonlySet<string>,
  ): string {
    if (sortedData.length === 0) {
      const message = provider === 'codex'
        ? I18n.t.providers.codex.noDailyData
        : I18n.t.statusBar.noData;
      return '<div class="no-chart-data" role="status">' + this.escapeHtml(message) + '</div>';
    }
    if (provider === 'codex') {
      const rows = sortedData as Array<{
        date: string;
        data: {
          total: CodexMetricTotals;
          apiEquivalent: EquivalentCostBreakdown;
          threads: number;
        };
      }>;
      const maxCost = Math.max(...rows.map((row) => row.data.apiEquivalent.equivalentUsd), 0);
      const hasUsage = rows.some((row) => row.data.total.processed > 0);
      const hasPricedCost = rows.some((row) => row.data.apiEquivalent.pricedTokens > 0);
      const costAxisLabel = (value: number): string =>
        hasPricedCost || !hasUsage ? I18n.formatCurrency(value) : '—';
      const maxHeight = 120;
      const bars = rows.map(({ date, data }) => {
        const cost = data.apiEquivalent;
        const height = maxCost > 0 ? (cost.equivalentUsd / maxCost) * maxHeight : 2;
        const costLabel = this.codexCostLabel(cost, data.total.processed);
        const hasHourlyDetail = !monthly && Object.prototype.hasOwnProperty.call(
          this.codexView?.last30DaysHourlyByDay ?? {},
          date,
        );
        const clickable = monthly || hasHourlyDetail;
        return '<div class="hc-col" data-date="' + this.escapeHtml(date) + '">' +
          '<div class="hc-barval">' + costLabel + '</div>' +
          '<div class="chart-bar cost-bar cost-stacked' + (clickable ? ' clickable' : '') +
          '" style="height:' + height + 'px" ' +
          'data-cost="' + cost.equivalentUsd + '" data-priced-tokens="' + cost.pricedTokens + '" ' +
          'data-has-usage="' + (data.total.processed > 0 ? 'true' : 'false') + '" ' +
          'data-input="' + data.total.processed + '" data-output="' + data.total.fresh + '" ' +
          'data-cache-creation="' + data.total.output + '" data-cache-read="' + data.total.reasoning + '" ' +
          'data-messages="' + data.threads + '" ' +
          'data-cost-input="' + cost.freshInputUsd + '" data-cost-output="' + cost.outputUsd + '" ' +
          'data-cost-cachewrite="0" data-cost-cacheread="' + cost.cachedInputUsd + '" ' +
          'data-cost-help="' + this.escapeHtml(this.codexCostHelp(cost)) + '" ' +
          'title="' + this.escapeHtml(date + ': ' + costLabel + ' · ' + this.codexCostHelp(cost)) + '">' +
          this.codexCostStackHtml(cost, height) + '</div></div>';
      }).join('');
      const xlabels = rows.map(({ date }) =>
        '<div class="hc-xlabel">' + this.escapeHtml(monthly ? this.getShortDate(date, true) : this.getShortDate(date)) + '</div>',
      ).join('');
      return '<div class="hc-wrap"><div class="hc-yaxis">' +
        '<span class="hc-yval">' + costAxisLabel(maxCost) + '</span>' +
        '<span class="hc-yval">' + costAxisLabel(maxCost / 2) + '</span>' +
        '<span class="hc-yval">' + costAxisLabel(0) + '</span></div><div class="hc-main"><div class="hc-scroll" tabindex="0">' +
        '<div class="hc-plot"><div class="hc-grid hc-grid-top"></div><div class="hc-grid hc-grid-mid"></div>' +
        '<div class="hc-bars">' + bars + '</div></div><div class="hc-xlabels">' + xlabels +
        '</div></div></div></div>';
    }
    const claudeRows = sortedData as { date: string; data: UsageData }[];
    const maxCost = Math.max(...claudeRows.map((d) => d.data.totalCost), 0);
    const maxHeight = 120;

    const costStack = (data: UsageData, barHeight: number): string => this.costStackHtml(data, barHeight);

    const bars = claudeRows
      .map(({ date, data }) => {
        const barHeight = maxCost > 0 ? (data.totalCost / maxCost) * maxHeight : 0;
        const cb = data.costBreakdown;
        const clickable = monthly || claudeInteractiveDays === undefined || claudeInteractiveDays.has(date);
        return (
          '<div class="hc-col" data-date="' + date + '">' +
          '<div class="hc-barval">' + I18n.formatCurrency(data.totalCost) + '</div>' +
          '<div class="chart-bar cost-bar cost-stacked' + (clickable ? ' clickable' : '') +
          '" style="height: ' + barHeight + 'px;" ' +
          'data-cost="' + data.totalCost + '" ' +
          'data-input="' + data.totalInputTokens + '" ' +
          'data-output="' + data.totalOutputTokens + '" ' +
          'data-cache-creation="' + data.totalCacheCreationTokens + '" ' +
          'data-cache-read="' + data.totalCacheReadTokens + '" ' +
          'data-messages="' + data.messageCount + '" ' +
          'data-cost-input="' + cb.input + '" ' +
          'data-cost-output="' + cb.output + '" ' +
          'data-cost-cachewrite="' + cb.cacheWrite + '" ' +
          'data-cost-cacheread="' + cb.cacheRead + '" ' +
          'title="' + this.escapeHtml(this.formatDate(date, monthly)) + ': ' + I18n.formatCurrency(data.totalCost) + '">' +
          costStack(data, barHeight) +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    const xlabels = claudeRows
      .map(({ date }) => '<div class="hc-xlabel">' + this.getShortDate(date, monthly) + '</div>')
      .join('');

    return (
      '<div class="hc-wrap">' +
      '<div class="hc-yaxis">' +
      '<span class="hc-yval">' + I18n.formatCurrency(maxCost) + '</span>' +
      '<span class="hc-yval">' + I18n.formatCurrency(maxCost / 2) + '</span>' +
      '<span class="hc-yval">' + I18n.formatCurrency(0) + '</span>' +
      '</div>' +
      '<div class="hc-main"><div class="hc-scroll" tabindex="0">' +
      '<div class="hc-plot">' +
      '<div class="hc-grid hc-grid-top"></div>' +
      '<div class="hc-grid hc-grid-mid"></div>' +
      '<div class="hc-bars">' + bars + '</div>' +
      '</div>' +
      '<div class="hc-xlabels">' + xlabels + '</div>' +
      '</div></div>' +
      '</div>'
    );
  }

  /**
   * Today's hourly chart. Unlike the other charts it has a Y-axis, two dashed
   * reference lines and a value label on top of every non-zero bar, so figures
   * stay readable without filling quiet hours with repeated zeroes.
   */
  private renderCodexHourlyChart(rows: CodexHourlyUsageView[]): string {
    if (rows.length === 0) {
      return '<div class="no-chart-data" role="status">' +
        this.escapeHtml(I18n.t.providers.codex.noDailyData) + '</div>';
    }
    const maxCost = Math.max(...rows.map((row) => row.apiEquivalent.equivalentUsd), 0);
    const hasUsage = rows.some((row) => row.total.processed > 0);
    const hasPricedCost = rows.some((row) => row.apiEquivalent.pricedTokens > 0);
    const costAxisLabel = (value: number): string =>
      hasPricedCost || !hasUsage ? I18n.formatCurrency(value) : '—';
    const maxHeight = 120;
    const bars = rows.map((row) => {
      const cost = row.apiEquivalent;
      const height = maxCost > 0 ? (cost.equivalentUsd / maxCost) * maxHeight : 2;
      const costLabel = this.codexCostLabel(cost, row.total.processed);
      const visibleCostLabel = cost.equivalentUsd === 0 && row.total.processed === 0
        ? ''
        : costLabel;
      return '<div class="hc-col" data-hour="' + this.escapeHtml(row.hour) + '">' +
        '<div class="hc-barval">' + visibleCostLabel + '</div>' +
        '<div class="chart-bar cost-bar cost-stacked" style="height:' + height + 'px" ' +
        'data-cost="' + cost.equivalentUsd + '" data-priced-tokens="' + cost.pricedTokens + '" ' +
        'data-has-usage="' + (row.total.processed > 0 ? 'true' : 'false') + '" ' +
        'data-input="' + row.total.processed + '" data-output="' + row.total.fresh + '" ' +
        'data-cache-creation="' + row.total.output + '" data-cache-read="' + row.total.reasoning + '" ' +
        'data-messages="' + row.threads + '" ' +
        'data-cost-input="' + cost.freshInputUsd + '" data-cost-output="' + cost.outputUsd + '" ' +
        'data-cost-cachewrite="0" data-cost-cacheread="' + cost.cachedInputUsd + '" ' +
        'data-cost-help="' + this.escapeHtml(this.codexCostHelp(cost)) + '" ' +
        'title="' + this.escapeHtml(costLabel + ' · ' + this.codexCostHelp(cost)) + '">' +
        this.codexCostStackHtml(cost, height) + '</div></div>';
    }).join('');
    const labels = rows.map((row) =>
      '<div class="hc-xlabel">' + this.escapeHtml(row.label) + '</div>'
    ).join('');
    return '<div class="hc-wrap"><div class="hc-yaxis">' +
      '<span class="hc-yval">' + costAxisLabel(maxCost) + '</span>' +
      '<span class="hc-yval">' + costAxisLabel(maxCost / 2) + '</span>' +
      '<span class="hc-yval">' + costAxisLabel(0) + '</span></div>' +
      '<div class="hc-main"><div class="hc-scroll" tabindex="0">' +
      '<div class="hc-plot"><div class="hc-grid hc-grid-top"></div>' +
      '<div class="hc-grid hc-grid-mid"></div><div class="hc-bars">' + bars + '</div></div>' +
      '<div class="hc-xlabels">' + labels + '</div></div></div></div>';
  }

  private renderHourlyChart(
    hourlyRows: { hour: string; data: UsageData }[] = this.hourlyDataForToday,
  ): string {
    if (hourlyRows.length === 0) {
      return '<div class="no-chart-data" role="status">' +
        this.escapeHtml(I18n.t.statusBar.noData) + '</div>';
    }

    const sortedData = [...hourlyRows].sort((a, b) => a.hour.localeCompare(b.hour));
    const maxCost = Math.max(...sortedData.map((d) => d.data.totalCost), 0);
    const maxHeight = 120; // Plot height in pixels — kept in sync with updateMainChart.

    const bars = sortedData
      .map(({ hour, data }) => {
        const height = maxCost > 0 ? (data.totalCost / maxCost) * maxHeight : 0;
        const cb = data.costBreakdown;
        return (
          '<div class="hc-col" data-hour="' + hour + '">' +
          '<div class="hc-barval">' +
          (data.totalCost === 0 ? '' : I18n.formatCurrency(data.totalCost)) +
          '</div>' +
          '<div class="chart-bar cost-bar cost-stacked" style="height: ' + height + 'px;" ' +
          'data-cost="' + data.totalCost + '" ' +
          'data-input="' + data.totalInputTokens + '" ' +
          'data-output="' + data.totalOutputTokens + '" ' +
          'data-cache-creation="' + data.totalCacheCreationTokens + '" ' +
          'data-cache-read="' + data.totalCacheReadTokens + '" ' +
          'data-messages="' + data.messageCount + '" ' +
          'data-cost-input="' + cb.input + '" ' +
          'data-cost-output="' + cb.output + '" ' +
          'data-cost-cachewrite="' + cb.cacheWrite + '" ' +
          'data-cost-cacheread="' + cb.cacheRead + '" ' +
          'title="' + I18n.formatCurrency(data.totalCost) + '">' +
          this.costStackHtml(data, height) +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    const xlabels = sortedData.map(({ hour }) => '<div class="hc-xlabel">' + hour + '</div>').join('');

    return (
      '<div class="hc-wrap">' +
      '<div class="hc-yaxis">' +
      '<span class="hc-yval">' + I18n.formatCurrency(maxCost) + '</span>' +
      '<span class="hc-yval">' + I18n.formatCurrency(maxCost / 2) + '</span>' +
      '<span class="hc-yval">' + I18n.formatCurrency(0) + '</span>' +
      '</div>' +
      '<div class="hc-main">' +
      '<div class="hc-scroll" tabindex="0">' +
      '<div class="hc-plot" id="hourlyChart">' +
      '<div class="hc-grid hc-grid-top"></div>' +
      '<div class="hc-grid hc-grid-mid"></div>' +
      '<div class="hc-bars">' + bars + '</div>' +
      '</div>' +
      '<div class="hc-xlabels">' + xlabels + '</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  private getShortDate(dateString: string, monthly = false): string {
    return shortUsageDate(dateString, monthly);
  }

  private formatDate(dateString: string, monthly = false): string {
    return formatUsageDate(dateString, I18n.getLocale(), I18n.dateFormatOptions(), monthly);
  }

  private getStyles(): string {
    return `
      :root {
        color-scheme: light dark;
        --ccu-space-1: 4px;
        --ccu-space-2: 8px;
        --ccu-space-3: 12px;
        --ccu-space-4: 16px;
        --ccu-space-5: 20px;
        --ccu-space-6: 24px;
        --ccu-radius-control: 4px;
        --ccu-radius-panel: 8px;
        --ccu-radius-lg: 12px;
        --ccu-border: var(--vscode-panel-border, rgba(127, 127, 127, 0.35));
        /* Description text must retain 4.5:1 in both Light+ and Dark+. Some
           input/editor-widget surfaces are deliberately more contrasted than
           ordinary text, so use the editor canvas and let the shared border
           carry the raised-card hierarchy. */
        --ccu-surface-raised: var(--vscode-editor-background);
        --ccu-surface-subtle: var(--vscode-editorWidget-background, var(--vscode-input-background));
        --ccu-surface-muted: var(--vscode-editorWidget-background, var(--vscode-input-background));
        /* Dashboard figures follow VS Code's UI typography. The prior editor
           monospace override made dense cards and tables feel visually foreign;
           true code/Markdown fields opt into the editor font directly. */
        --ccu-data-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        --ccu-focus: var(--vscode-focusBorder, #007fd4);
      }

      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
        margin: 0;
        padding: var(--ccu-space-4);
      }

      .container {
        /* Widen for big monitors; fluid below the cap. */
        max-width: 1600px;
        margin: 0 auto;
      }

      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--ccu-space-4);
        margin-bottom: var(--ccu-space-4);
        border-bottom: 1px solid var(--ccu-border);
        padding-bottom: var(--ccu-space-4);
      }


      h1 {
        margin: 0;
        font-size: 20px;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--ccu-space-2);
      }

      button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: var(--ccu-radius-control);
        padding: var(--ccu-space-2) var(--ccu-space-3);
        cursor: pointer;
        font-size: 12px;
      }

      button:focus-visible,
      summary:focus-visible,
      input:focus-visible,
      select:focus-visible,
      textarea:focus-visible,
      [tabindex="0"]:focus-visible {
        outline: 2px solid var(--ccu-focus);
        outline-offset: 2px;
      }

      button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .btn-secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }

      .btn-secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }

      .btn-primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        font-weight: 600;
      }
      .btn-primary:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .btn-primary:disabled {
        opacity: 0.6;
        cursor: default;
      }

      /* AI advice + Usage Optimizer "action cards" lead the Content tab. They
         share one treatment — an accent rail + an icon badge — so they read as
         the two tools, distinct from the data panels below, while staying quiet
         and on-theme. The rail is the single signature element. */
      .action-card {
        position: relative;
        border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.25));
        border-radius: 8px;
        padding: 13px 16px 13px 18px;
        margin-bottom: 14px;
        background: var(--vscode-editor-background);
      }
      .action-card::before {
        content: "";
        position: absolute;
        left: 0;
        top: 12px;
        bottom: 12px;
        width: 3px;
        border-radius: 0 3px 3px 0;
        background: var(--vscode-textLink-foreground, var(--vscode-button-background));
      }
      .action-card-head {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .action-icon {
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        border-radius: 8px;
        background: var(--vscode-badge-background);
      }
      .action-card-titles {
        flex: 1;
        min-width: 0;
      }
      .action-card-titles h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.2px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .action-card-desc {
        margin: 3px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--vscode-descriptionForeground);
      }
      .action-card-howto {
        margin: 12px 0 8px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--vscode-descriptionForeground);
      }
      .action-card-head .btn-primary,
      .action-card-head .btn-secondary {
        flex: 0 0 auto;
        align-self: center;
        white-space: nowrap;
      }
      .exp-pill {
        font-size: 9.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        padding: 1px 6px;
        border-radius: 999px;
        color: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.4));
      }
      .opt-input {
        width: 100%;
        box-sizing: border-box;
        resize: vertical;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px;
        padding: 6px 8px;
        margin: 4px 0 8px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
        border-radius: 4px;
      }
      .opt-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }
      .opt-controls label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
      }
      .opt-controls #optRunBtn {
        margin-left: auto;
      }
      .opt-error {
        color: var(--vscode-errorForeground);
        font-size: 12px;
        margin: 4px 0;
      }
      .opt-subhead {
        margin: 10px 0 4px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .opt-output {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      /* The optimised prompt is meant to be copied verbatim — keep it monospace. */
      .opt-output pre {
        flex: 1;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px;
        padding: 8px;
        margin: 0;
        background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.1));
        border-radius: 4px;
      }
      /* Floating "copy" button on the optimised-prompt block. */
      .opt-output { position: relative; }
      .opt-copy {
        position: absolute;
        top: 6px;
        right: 6px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        padding: 3px 8px;
        border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.35));
        border-radius: 5px;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-editor-background);
        cursor: pointer;
        opacity: 0.85;
      }
      .opt-copy:hover {
        opacity: 1;
        color: var(--vscode-foreground);
        border-color: var(--vscode-focusBorder, var(--vscode-button-background));
      }
      .opt-copy.copied {
        color: var(--vscode-testing-iconPassed, #2ea043);
        border-color: var(--vscode-testing-iconPassed, #2ea043);
      }
      .opt-copy-ico { font-size: 12px; line-height: 1; }
      /* The settings recommendation is read, not copied — render each line as a
         "Label  [value chip]  reason" row so the key choice stands out. */
      .opt-settings {
        font-size: 12px;
        padding: 8px 10px;
        margin: 0;
        color: var(--vscode-foreground);
        background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.06));
        border-left: 2px solid var(--vscode-textLink-foreground, var(--vscode-button-background));
        border-radius: 0 4px 4px 0;
      }
      .opt-set-row {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 8px;
        padding: 3px 0;
      }
      .opt-set-row + .opt-set-row {
        border-top: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.12));
      }
      .opt-set-key {
        flex: 0 0 auto;
        min-width: 64px;
        color: var(--vscode-descriptionForeground);
      }
      .opt-set-val {
        flex: 0 0 auto;
        font-weight: 600;
        padding: 1px 8px;
        border-radius: 999px;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
      }
      .opt-set-rest {
        flex: 1 1 auto;
        min-width: 120px;
        color: var(--vscode-descriptionForeground);
      }

      /* ⚙ Settings tab */
      .settings-panel { max-width: 780px; }
      .settings-toolbar { margin: 4px 0 14px; }
      .settings-group { margin-bottom: 18px; }
      .settings-group h3 {
        margin: 0 0 8px;
        padding-bottom: 4px;
        font-size: 13px;
        border-bottom: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.2));
      }
      .set-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 7px 0;
      }
      .set-label { flex: 1; min-width: 0; }
      .set-label label { font-size: 13px; }
      .set-help {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 2px;
      }
      .set-control { flex: 0 0 auto; display: flex; align-items: center; }
      .set-control input[type="text"],
      .set-control input[type="password"],
      .set-control input[type="number"],
      .set-control select,
      .set-control textarea {
        font-family: inherit;
        font-size: 12px;
        padding: 4px 6px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
        border-radius: 4px;
        min-width: 230px;
      }
      .set-control input[type="number"] { min-width: 96px; width: 96px; }
      .set-control textarea { resize: vertical; min-width: 260px; }
      .quota-format-control { flex-direction: column; align-items: stretch; gap: 6px; }
      .quota-format-custom[hidden] { display: none; }
      .quota-format-custom input { width: 100%; box-sizing: border-box; }
      .set-switch { position: relative; display: inline-block; width: 40px; height: 22px; }
      .set-switch input { opacity: 0; width: 0; height: 0; }
      .set-slider {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, rgba(127, 127, 127, 0.4));
        border-radius: 22px;
        transition: 0.15s;
      }
      .set-slider:before {
        content: "";
        position: absolute;
        height: 16px;
        width: 16px;
        left: 2px;
        bottom: 2px;
        background: var(--vscode-descriptionForeground);
        border-radius: 50%;
        transition: 0.15s;
      }
      .set-switch input:checked + .set-slider {
        background: var(--vscode-testing-iconPassed, #2ea043);
      }
      .set-switch input:checked + .set-slider:before {
        transform: translateX(18px);
        background: #fff;
      }
      .local-data-controls { margin-top: 26px; }
      .local-data-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 12px 0 8px;
      }
      .local-data-heading h4 { margin: 0; font-size: 12px; }
      .local-data-table-wrap { max-width: 100%; overflow-x: auto; }
      .local-data-table { min-width: 920px; }
      .local-data-table td { vertical-align: top; font-size: 11px; }
      .local-data-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .local-data-actions select {
        max-width: 260px;
        min-width: 180px;
        color: var(--vscode-dropdown-foreground);
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border, var(--ccu-border));
        border-radius: 4px;
        padding: 4px 6px;
      }
      .local-data-scope-label { font-size: 11px; color: var(--vscode-descriptionForeground); }
      .local-data-danger {
        color: var(--vscode-errorForeground);
        border-color: var(--vscode-errorForeground);
      }
      @media (max-width: 520px) {
        .set-row { flex-direction: column; gap: 6px; }
        .set-control, .set-control input, .set-control select, .set-control textarea { width: 100%; }
        .local-data-actions { align-items: stretch; flex-direction: column; }
        .local-data-actions > * { width: 100%; max-width: none; }
      }

      /* Manual refresh is also the explicit accelerated Codex catch-up path. */
      .btn-refresh-now {
        display: inline-block;
      }

      /* Session row action buttons. */
      .actions-cell {
        white-space: nowrap;
        text-align: center;
      }
      .session-action {
        background: none;
        border: 1px solid var(--vscode-panel-border);
        color: var(--vscode-foreground);
        border-radius: 4px;
        cursor: pointer;
        padding: 1px 6px;
        margin: 0 1px;
        font-size: 12px;
        line-height: 1.4;
      }
      .session-action:hover {
        background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
      }
      .session-action.copied {
        color: var(--vscode-charts-green, #4caf50);
        border-color: var(--vscode-charts-green, #4caf50);
      }
      .session-delete:hover {
        color: var(--vscode-errorForeground, #f44336);
        border-color: var(--vscode-errorForeground, #f44336);
      }

      /* Sessions filter bar: time range · project · model. */
      .sess-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin: 0 0 10px;
      }
      .sess-filter {
        display: flex;
        gap: 6px;
      }
      .sess-filter-btn {
        background: none;
        border: 1px solid var(--vscode-panel-border);
        color: var(--vscode-foreground);
        border-radius: 4px;
        cursor: pointer;
        padding: 2px 10px;
        font-size: 12px;
      }
      .sess-filter-btn.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-button-background);
      }
      .sess-model-select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 12px;
      }

      /* iOS-style auto-refresh toggle. The label/switch sit next to the other
         buttons in the header actions row. Slider colour mirrors the
         status-bar success colour so on/off state reads at a glance. */
      .auto-refresh-switch {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
      }
      .auto-refresh-label {
        white-space: nowrap;
      }
      .switch {
        position: relative;
        display: inline-block;
        width: 32px;
        height: 18px;
      }
      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
        position: absolute;
      }
      .slider {
        position: absolute;
        cursor: pointer;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: var(--vscode-input-background, #888);
        border: 1px solid var(--vscode-input-border, #555);
        transition: background-color 0.2s, border-color 0.2s;
        border-radius: 18px;
      }
      .slider::before {
        position: absolute;
        content: "";
        height: 12px;
        width: 12px;
        left: 2px;
        top: 2px;
        background-color: #fff;
        transition: transform 0.2s;
        border-radius: 50%;
        box-shadow: 0 1px 2px rgba(0,0,0,0.25);
      }
      .switch input:checked + .slider {
        background-color: #34c759; /* iOS green when on */
        border-color: #34c759;
      }
      .switch input:checked + .slider::before {
        transform: translateX(14px);
      }
      .switch input:focus + .slider {
        box-shadow: 0 0 0 2px var(--vscode-focusBorder);
      }

      .tabs {
        display: flex;
        gap: var(--ccu-space-1);
        max-width: 100%;
        margin-bottom: var(--ccu-space-5);
        border-bottom: 1px solid var(--ccu-border);
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-inline: contain;
        scrollbar-width: thin;
      }

      .tab {
        flex: 0 0 auto;
        background: transparent;
        border: none;
        padding: var(--ccu-space-2) var(--ccu-space-4);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        white-space: nowrap;
        /* Explicit foreground colour — otherwise the inherited button
           foreground (white) becomes invisible on light themes. (Fixes
           upstream issue #11.) */
        color: var(--vscode-foreground);
      }

      .tab.active {
        background: transparent;
        border-bottom-color: var(--vscode-focusBorder);
        color: var(--vscode-foreground);
        font-weight: 600;
      }

      .tab-content {
        display: none;
      }

      .tab-content.active {
        display: block;
      }

      .usage-summary {
        margin-bottom: var(--ccu-space-6);
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: var(--ccu-space-3);
      }

      .summary-item {
        display: flex;
        min-height: 68px;
        flex-direction: column;
        justify-content: center;
        text-align: left;
        padding: var(--ccu-space-3) 14px;
        background: var(--ccu-surface-raised);
        border-radius: var(--ccu-radius-panel);
        border: 1px solid var(--ccu-border);
      }

      .summary-item .label {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
      }

      .summary-item .value {
        font-size: 18px;
        font-weight: bold;
        font-family: var(--ccu-data-font);
        font-variant-numeric: tabular-nums;
      }

      .summary-item .value.cost {
        color: var(--vscode-charts-green);
      }

      .project-matrix {
        min-width: 0;
        margin-top: var(--ccu-space-5);
        padding: var(--ccu-space-4) 0 var(--ccu-space-5);
        border-top: 1px solid var(--ccu-border);
        border-bottom: 1px solid var(--ccu-border);
      }
      .project-matrix-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--ccu-space-4);
      }
      .project-matrix-head > div { min-width: 0; }
      .project-matrix-head h3 {
        margin: 0 0 var(--ccu-space-1);
        font-size: 16px;
      }
      .project-matrix-head p {
        max-width: 760px;
        margin: 0;
        color: var(--vscode-descriptionForeground);
        line-height: 1.5;
      }
      .project-matrix-coverage {
        flex: 0 0 auto;
        padding: 2px 8px;
        border: 1px solid var(--ccu-border);
        border-radius: 999px;
        color: var(--vscode-foreground);
        font-size: 10px;
        font-weight: 600;
        white-space: nowrap;
      }
      .project-matrix-coverage-complete { border-color: var(--vscode-charts-green); }
      .project-matrix-coverage-partial { border-color: var(--vscode-charts-yellow); }
      .project-matrix-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: var(--ccu-space-3) var(--ccu-space-5);
        margin: var(--ccu-space-4) 0 var(--ccu-space-3);
      }
      .project-matrix-control {
        display: inline-flex;
        align-items: center;
        gap: var(--ccu-space-1);
      }
      .project-matrix-control > span {
        margin-right: var(--ccu-space-1);
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }
      .project-matrix-option {
        padding: 4px 9px;
        border: 1px solid var(--ccu-border);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        font-size: 11px;
      }
      .project-matrix-option:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .project-matrix-option.active {
        border-color: var(--ccu-focus);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .project-matrix-range[hidden],
      .project-matrix-view[hidden],
      .project-matrix-row[hidden] { display: none; }
      .project-matrix-scroll,
      .project-matrix-trend-scroll {
        max-width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-inline: contain;
        scrollbar-width: thin;
        touch-action: pan-x pan-y;
        contain: layout paint;
      }
      .project-matrix-scroll {
        padding: 0 0 var(--ccu-space-2);
      }
      .project-matrix-grid {
        width: max-content;
        border-collapse: separate;
        border-spacing: 3px;
        font-size: 10px;
      }
      .project-matrix-grid th {
        height: 18px;
        padding: 0;
        background: var(--vscode-editor-background);
        color: var(--vscode-descriptionForeground);
        font-weight: 500;
        text-align: center;
        white-space: nowrap;
      }
      .project-matrix-grid .project-matrix-project {
        position: sticky;
        left: 0;
        z-index: 2;
        box-sizing: border-box;
        width: 180px;
        max-width: 180px;
        padding: 3px 12px 3px 0;
        border-right: 1px solid var(--ccu-border);
        background: var(--vscode-editor-background);
        color: var(--vscode-foreground);
        text-align: left;
      }
      .project-matrix-project > span,
      .project-matrix-project > small {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .project-matrix-project > span { font-size: 11px; font-weight: 600; }
      .project-matrix-project > small {
        margin-top: 2px;
        color: var(--vscode-descriptionForeground);
        font-size: 9px;
        font-weight: 400;
        font-variant-numeric: tabular-nums;
      }
      .project-matrix-cell {
        box-sizing: border-box;
        width: 14px;
        min-width: 14px;
        height: 14px;
        border: 1px solid var(--ccu-border);
        border-radius: 2px;
        background: var(--vscode-input-background);
      }
      .project-matrix-level-1,
      .project-matrix-level-2,
      .project-matrix-level-3,
      .project-matrix-level-4 {
        border-color: transparent;
        background: var(--vscode-charts-blue);
      }
      .project-matrix-level-1 { opacity: 0.28; }
      .project-matrix-level-2 { opacity: 0.48; }
      .project-matrix-level-3 { opacity: 0.72; }
      .project-matrix-level-4 { opacity: 1; }
      .project-matrix-cell:hover {
        outline: 1px solid var(--ccu-focus);
        outline-offset: 1px;
        opacity: 1;
      }
      .project-matrix-trend-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        margin: 2px 0 var(--ccu-space-3);
      }
      .project-matrix-trend-series {
        display: inline-grid;
        grid-template-columns: 8px minmax(0, auto) auto;
        align-items: center;
        gap: 5px;
        min-width: 0;
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
      }
      .project-matrix-trend-series i {
        width: 8px;
        height: 8px;
        border-radius: 2px;
      }
      .project-matrix-trend-series strong {
        color: var(--vscode-foreground);
        font-variant-numeric: tabular-nums;
      }
      .project-matrix-trend-bars {
        display: flex;
        align-items: flex-end;
        gap: 3px;
        width: max-content;
        min-width: 100%;
        height: 190px;
        padding: var(--ccu-space-2) 2px 0;
        border-top: 1px solid var(--ccu-border);
        border-bottom: 1px solid var(--ccu-border);
      }
      .project-matrix-trend-col {
        display: flex;
        flex: 1 0 16px;
        width: 16px;
        min-width: 16px;
        height: 100%;
        flex-direction: column;
        justify-content: flex-end;
      }
      .project-matrix-trend-90 .project-matrix-trend-col { flex-basis: 12px; width: 12px; min-width: 12px; }
      .project-matrix-trend-stack {
        display: flex;
        height: 160px;
        flex-direction: column-reverse;
        justify-content: flex-start;
      }
      .project-matrix-trend-segment {
        display: block;
        min-height: 1px;
      }
      .project-matrix-series-0 { background: var(--vscode-charts-blue); }
      .project-matrix-series-1 { background: var(--vscode-charts-green); }
      .project-matrix-series-2 { background: var(--vscode-charts-yellow); }
      .project-matrix-series-3 { background: var(--vscode-charts-purple); }
      .project-matrix-series-4 { background: var(--vscode-charts-red); }
      .project-matrix-series-5 { background: var(--vscode-charts-orange); }
      .project-matrix-trend-date {
        display: block;
        height: 22px;
        padding-top: 4px;
        color: var(--vscode-descriptionForeground);
        font-size: 9px;
        line-height: 10px;
        white-space: nowrap;
      }
      .project-matrix-expand {
        margin-top: var(--ccu-space-3);
        padding: 4px 0;
        border: none;
        background: transparent;
        color: var(--vscode-textLink-foreground);
        font-weight: 600;
      }
      .project-matrix-expand:hover {
        background: transparent;
        text-decoration: underline;
      }

      .model-breakdown, .daily-breakdown {
        margin-top: 24px;
      }

      .model-breakdown h3, .daily-breakdown h3 {
        margin-bottom: 16px;
        font-size: 16px;
      }

      .model-list {
        display: flex;
        flex-direction: column;
        gap: var(--ccu-space-3);
      }

      .model-item {
        padding: var(--ccu-space-3);
        background: var(--ccu-surface-raised);
        border-radius: 6px;
        border: 1px solid var(--ccu-border);
      }

      /* <details>/<summary> reset: remove the default triangle, position our own */
      details.model-item > summary {
        list-style: none;
        cursor: pointer;
      }
      details.model-item > summary::-webkit-details-marker { display: none; }
      details.model-item > summary::before {
        content: '▸';
        display: inline-block;
        margin-right: 6px;
        color: var(--vscode-descriptionForeground);
        transition: transform 0.15s ease;
      }
      details.model-item[open] > summary::before {
        transform: rotate(90deg);
      }

      .model-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 0;
      }
      details.model-item[open] > .model-header {
        margin-bottom: var(--ccu-space-2);
      }
      /* Model name sits flush against the disclosure triangle on the left;
         the cost is pushed to the far right by margin-left:auto. Avoids the
         "name centred in the middle" effect that flex space-between gives
         when the triangle ::before becomes a third flex child. */
      .model-name {
        flex: 0 1 auto;
        text-align: left;
      }

      .model-name {
        font-weight: bold;
        color: var(--vscode-symbolIcon-functionForeground);
      }

      .model-metric {
        font-weight: bold;
        color: var(--vscode-foreground);
        margin-left: auto;
        font-family: var(--ccu-data-font);
        font-variant-numeric: tabular-nums;
      }

      .model-cost {
        color: var(--vscode-charts-green);
      }

      .model-details {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      /* Stack token stats one per line — fixed layout that does not reshuffle
         when the window is resized. Each row is "label  value" left-aligned. */
      .model-details-stacked {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 4px;
      }

      .model-details-stacked > span {
        display: flex;
        justify-content: space-between;
        padding: 2px 0;
        border-bottom: 1px dashed var(--vscode-input-border);
      }
      .model-details-stacked > span:last-child {
        border-bottom: none;
      }

      .model-stat-label {
        color: var(--vscode-descriptionForeground);
        opacity: 1;
      }

      .chart-tabs {
        display: flex;
        gap: var(--ccu-space-1);
        margin-bottom: var(--ccu-space-4);
        flex-wrap: wrap;
      }

      .chart-tab {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid var(--ccu-border);
        border-radius: var(--ccu-radius-control);
        padding: 6px 12px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .chart-tab:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }

      .chart-tab.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-focusBorder);
      }

      .chart-container {
        background: var(--ccu-surface-subtle);
        border: 1px solid var(--ccu-border);
        border-radius: var(--ccu-radius-panel);
        padding: var(--ccu-space-4);
        margin-bottom: 20px;
        height: 180px;
        overflow-x: auto;
      }

      .chart-content {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: end;
        justify-content: center;
      }

      .chart-content > .hc-wrap {
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }

      .chart-bars {
        display: flex;
        align-items: end;
        gap: 4px;
        min-width: fit-content;
        height: 100%;
        padding: 0 8px;
      }

      .chart-bar-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        min-width: 40px;
        height: 100%;
        position: relative;
        padding-bottom: 20px;
      }

      .chart-bar {
        width: 24px;
        min-height: 2px;
        border-radius: 2px 2px 0 0;
        transition: all 0.3s ease;
        margin-bottom: 8px;
      }

      .chart-bar.clickable {
        cursor: pointer;
      }

      .chart-bar[data-hour-selection-control] {
        cursor: pointer;
      }

      .chart-bar.clickable:hover,
      .chart-bar[data-hour-selection-control]:hover {
        opacity: 0.8;
        transform: scaleY(1.05);
      }

      .chart-bar.selected {
        border: 2px solid var(--vscode-focusBorder);
        box-shadow: 0 0 4px var(--vscode-focusBorder);
      }

      .chart-selection-detail {
        margin: var(--ccu-space-2) 0 0;
        padding-left: var(--ccu-space-2);
        border-left: 2px solid var(--ccu-focus);
        color: var(--vscode-descriptionForeground);
        font-variant-numeric: tabular-nums;
      }

      .daily-table tr.chart-selection-row > td {
        background: var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12));
      }

      .daily-table tr.chart-selection-row > td:first-child {
        box-shadow: inset 2px 0 0 var(--ccu-focus);
      }

      .cost-bar {
        background: linear-gradient(to top, var(--vscode-charts-green), var(--vscode-charts-blue));
      }

      .input-bar {
        background: linear-gradient(to top, var(--vscode-charts-blue), var(--vscode-charts-purple));
      }

      .output-bar {
        background: linear-gradient(to top, var(--vscode-charts-yellow), var(--vscode-charts-red));
      }

      .cache-creation-bar {
        /* NB: VS Code has no --vscode-charts-pink; without a fallback the whole
           gradient is invalid and the bar renders transparent (invisible). */
        background: linear-gradient(to top, var(--vscode-charts-purple), var(--vscode-charts-pink, #d16ba5));
      }

      .cache-read-bar {
        background: linear-gradient(to top, var(--vscode-charts-yellow), var(--vscode-charts-green));
      }

      .messages-bar {
        background: var(--vscode-charts-foreground);
      }

      .chart-label {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        text-align: center;
        word-break: break-all;
        line-height: 12px;
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 100%;
      }

      .no-chart-data {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }

      .daily-table-container {
        overflow-x: auto;
        margin-top: 12px;
      }

      .weekly-value-details {
        margin-top: var(--ccu-space-3);
        border-top: 1px solid var(--ccu-border);
      }

      .weekly-value-details > summary {
        width: fit-content;
        padding-top: var(--ccu-space-3);
        color: var(--vscode-textLink-foreground);
        cursor: pointer;
        font-weight: 600;
      }

      .weekly-value-details > summary:focus-visible {
        outline: 1px solid var(--ccu-focus);
        outline-offset: 3px;
      }

      .range-empty-hint {
        margin-bottom: var(--ccu-space-3);
      }

      .daily-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .daily-table th,
      .daily-table td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .daily-table th {
        background: var(--vscode-input-background);
        font-weight: bold;
        color: var(--vscode-foreground);
        position: sticky;
        top: 0;
      }

      .daily-table tbody tr:hover {
        background: var(--vscode-list-hoverBackground);
      }

      .date-cell {
        font-weight: bold;
        color: var(--vscode-symbolIcon-functionForeground);
        white-space: nowrap;
      }

      .cost-cell {
        font-weight: bold;
        color: var(--vscode-charts-green);
        text-align: right;
      }

      .number-cell {
        text-align: right;
        font-family: var(--ccu-data-font);
        font-variant-numeric: tabular-nums;
        /* Keep figures on one line: compact (k/M) numbers fit the panel with no
         * horizontal scroll; full integer numbers overflow so the table (only)
         * scrolls, while the chart above keeps its own independent scroll. */
        white-space: nowrap;
      }

      [data-provider-session-table] {
        table-layout: fixed;
        min-width: 960px;
      }

      [data-provider-session-table] .date-cell,
      [data-provider-session-table] [data-session-model],
      [data-provider-session-table] [data-session-effort],
      [data-provider-session-table] .project-name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      [data-session-thread-layout] {
        min-width: 0;
        margin-bottom: 0;
      }

      [data-session-thread-copy] {
        flex: 1 1 auto;
        min-width: 0;
      }

      [data-session-thread-title],
      [data-session-thread-role] {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      [data-session-detail] td {
        background: var(--vscode-editorWidget-background, var(--vscode-input-background));
      }

      [data-session-detail-grid] {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 8px 16px;
      }

      [data-session-detail-item] {
        min-width: 0;
      }

      [data-session-detail-item] > span,
      [data-session-detail-item] > strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .loading, .error, .no-data {
        text-align: center;
        padding: 40px 20px;
        border: 1px dashed var(--ccu-border);
        border-radius: var(--ccu-radius-panel);
        background: var(--ccu-surface-raised);
      }

      .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--vscode-progressBar-background);
        border-top: 3px solid var(--vscode-focusBorder);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 16px;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      .error {
        color: var(--vscode-errorForeground);
      }

      .no-data {
        color: var(--vscode-descriptionForeground);
      }

      .detail-cell {
        text-align: center;
        width: 40px;
      }

      .detail-button {
        background: transparent;
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        padding: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s ease;
      }

      .detail-button:hover {
        background: var(--vscode-list-hoverBackground);
        border-radius: 4px;
      }

      .detail-button.expanded svg {
        transform: rotate(180deg);
      }

      .hourly-detail-row td {
        padding: 0;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .hourly-detail-container {
        padding: 16px;
        background: var(--vscode-input-background);
        border-top: 1px solid var(--vscode-panel-border);
      }

      .hourly-detail-container h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
        color: var(--vscode-foreground);
      }

      .loading-indicator {
        text-align: center;
        color: var(--vscode-descriptionForeground);
        padding: 20px;
      }

      .project-cell {
        max-width: 340px;
      }

      .project-name {
        font-weight: bold;
        color: var(--vscode-symbolIcon-functionForeground);
      }

      .project-path {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 2px;
        display: flex;
        align-items: flex-start;
        gap: 4px;
      }
      .project-path-text {
        word-break: break-all;
      }
      /* Small copy-path icon, revealed on row hover. */
      .copy-path {
        flex-shrink: 0;
        background: none;
        border: none;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        padding: 0 2px;
        font-size: 11px;
        line-height: 1.3;
        opacity: 0;
        transition: opacity 0.1s;
      }
      .sort-row:hover .copy-path,
      .project-child-row:hover .copy-path,
      .copy-path.copied {
        opacity: 0.7;
      }
      .copy-path:hover {
        opacity: 1 !important;
        color: var(--vscode-foreground);
      }
      .copy-path.copied {
        color: var(--vscode-charts-green, #4caf50);
      }

      .composition-chart {
        margin: 12px 0 20px;
      }

      /* Efficiency chips (opt-in), appended under a usage summary. */
      .eff-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 10px 0 2px;
      }
      .eff-chip {
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        padding: 4px 10px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 999px;
        font-size: 12px;
      }
      .eff-chip .eff-label { color: var(--vscode-descriptionForeground); }
      .eff-chip .eff-value { font-weight: bold; }

      /* Top-10 costliest conversations (opt-in, Content tab). */
      .costly-panel { margin: 18px 0 8px; }
      .costly-row {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        margin: 6px 0;
        background: var(--vscode-editorWidget-background, transparent);
      }
      .costly-row > summary {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        cursor: pointer;
        list-style: none;
      }
      .costly-row > summary::-webkit-details-marker { display: none; }
      .costly-rank {
        flex: 0 0 auto;
        min-width: 20px;
        text-align: center;
        font-weight: bold;
        color: var(--vscode-descriptionForeground);
      }
      .costly-name {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .costly-cost {
        flex: 0 0 auto;
        font-weight: bold;
        color: var(--vscode-charts-green);
      }
      .costly-detail {
        padding: 6px 12px 10px 42px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .costly-kv {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        padding: 2px 0;
        color: var(--vscode-descriptionForeground);
      }
      .costly-kv-strong {
        font-weight: 700;
        color: var(--vscode-foreground);
      }
      .cache-warmth {
        font-size: 13px;
        line-height: 1.5;
        padding: 10px 12px;
        border-radius: 8px;
        background: var(--vscode-textBlockQuote-background);
        border-left: 3px solid var(--vscode-textBlockQuote-border);
        color: var(--vscode-foreground);
      }
      /* Experimental insights section — cards in the plugin's existing language. */
      .insights-panel { margin: 18px 0 8px; }
      .insight-card {
        margin: 10px 0;
        padding: 14px 16px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      }
      .insight-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
      }
      .insight-title { font-size: 14px; font-weight: 700; color: var(--vscode-foreground); }
      .insight-tag {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 8px;
        border-radius: 999px;
        color: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-panel-border);
        white-space: nowrap;
      }
      .insight-hero {
        font-size: 34px;
        font-weight: 800;
        line-height: 1.1;
        margin: 8px 0 2px;
        color: var(--vscode-charts-yellow, var(--vscode-foreground));
      }
      .insight-sub { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
      .insight-split { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
      .insight-pill {
        font-size: 12px;
        padding: 4px 10px;
        border-radius: 8px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      .insight-pill b { font-weight: 700; }
      .insight-tip {
        font-size: 13px;
        line-height: 1.5;
        color: var(--vscode-foreground);
        margin-bottom: 8px;
      }
      .insight-note {
        font-size: 11px;
        line-height: 1.5;
        color: var(--vscode-descriptionForeground);
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .hr-spark { display: flex; align-items: flex-end; gap: 2px; height: 64px; margin: 10px 0 2px; }
      .hr-col { flex: 1 1 0; display: flex; flex-direction: column; align-items: stretch; height: 100%; justify-content: flex-end; }
      .hr-bar { width: 100%; border-radius: 2px 2px 0 0; background: var(--vscode-panel-border); min-height: 2px; }
      .hr-bar.pk { background: var(--vscode-charts-yellow, var(--vscode-badge-background)); }
      .hr-lab { font-size: 8px; line-height: 10px; text-align: center; color: var(--vscode-descriptionForeground); height: 10px; }
      .cbm-list { margin: 6px 0 4px; }
      .cbm-row { display: flex; align-items: center; gap: 10px; padding: 3px 0; }
      .cbm-label {
        flex: 0 0 190px;
        font-size: 12px;
        color: var(--vscode-foreground);
        display: flex;
        justify-content: space-between;
        gap: 6px;
        overflow: hidden;
      }
      .cbm-provider { color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; }
      .cbm-mid { flex: 1 1 auto; min-width: 0; }
      .cbm-track {
        height: 8px;
        border-radius: 4px;
        background: var(--vscode-panel-border);
        overflow: hidden;
      }
      .cbm-fill { height: 100%; background: var(--vscode-charts-yellow, var(--vscode-badge-background)); }
      .cbm-sub { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
      .cbm-pct { flex: 0 0 72px; text-align: right; font-size: 12px; font-weight: 700; color: var(--vscode-foreground); }
      .cbm-unit { font-size: 10px; font-weight: 400; color: var(--vscode-descriptionForeground); margin-left: 1px; }
      .costly-prompt {
        font-size: 12px;
        line-height: 1.4;
        margin: 0 0 8px;
        padding: 8px 10px;
        border-radius: 6px;
        white-space: pre-wrap;
        word-break: break-word;
        /* Show the whole prompt, but cap the height and scroll long ones. */
        max-height: 220px;
        overflow-y: auto;
        background: var(--vscode-textBlockQuote-background);
        border-left: 3px solid var(--vscode-textBlockQuote-border);
        color: var(--vscode-foreground);
      }

      /* Share card panel (All tab): config card + responsive preview. Styled to
       * sit inside the plugin's existing card language (theme vars, soft border,
       * the shared .btn-secondary buttons). */
      .share-panel {
        margin: 8px 0 22px;
      }
      .sc-config {
        margin: 12px 0;
        padding: 16px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      }
      .sc-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px 16px;
        margin-bottom: 14px;
      }
      .sc-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--vscode-descriptionForeground);
      }
      .sc-field select {
        width: 100%;
        padding: 5px 8px;
        border-radius: 6px;
        border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
        font-size: 13px;
        text-transform: none;
        letter-spacing: normal;
      }
      .sc-checks {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 10px;
        margin-bottom: 14px;
        padding-top: 12px;
        padding-right: 0;
        padding-bottom: 0;
        padding-left: 0;
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .sc-check {
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px 4px 8px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 999px;
        color: var(--vscode-foreground);
        cursor: pointer;
        user-select: none;
      }
      .sc-check:hover {
        border-color: var(--vscode-focusBorder);
      }
      .share-preview {
        margin: 12px 0 0;
        padding: 10px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        overflow: auto;
        overscroll-behavior-inline: contain;
        -webkit-overflow-scrolling: touch;
        max-height: 640px;
        background: var(--vscode-editor-background);
      }
      .share-preview svg {
        display: block;
        width: 100%;
        height: auto;
        max-width: none;
        margin: 0 auto;
        border-radius: 8px;
      }
      .share-preview p {
        text-align: center;
      }
      .share-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 4px;
      }

      /* Optional token heatmap panel (All tab). The SVG has a fixed size; let it
       * scroll horizontally on narrow panels rather than squash. */
      .heatmap-panel {
        margin: 4px 0 22px;
      }
      .heatmap-svg {
        overflow-x: auto;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 6px;
        background: var(--vscode-editor-background);
      }
      .heatmap-svg svg {
        display: block;
      }
      .combined-heatmap-panel {
        position: relative;
        overflow: hidden;
        padding: var(--ccu-space-5);
        border: 1px solid var(--ccu-border);
        border-left: 4px solid var(--vscode-charts-purple);
        border-radius: var(--ccu-radius-lg);
        background: var(--ccu-surface-raised);
      }
      .combined-share-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--ccu-space-4);
        margin-bottom: var(--ccu-space-5);
      }
      .combined-share-header h2 {
        margin: 3px 0 5px;
      }
      .combined-share-header p {
        max-width: 760px;
        margin: 0;
        color: var(--vscode-descriptionForeground);
        line-height: 1.5;
      }
      .combined-share-eyebrow {
        color: var(--vscode-charts-purple);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .combined-private-badge {
        flex: 0 0 auto;
        padding: 5px 9px;
        border: 1px solid var(--ccu-border);
        border-radius: 999px;
        background: var(--ccu-surface-subtle);
        color: var(--vscode-foreground);
        font-size: 10px;
        white-space: nowrap;
      }
      .combined-share-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--ccu-space-4);
        align-items: start;
      }
      .sharing-template-field {
        max-width: 520px;
        margin: 0 0 var(--ccu-space-5);
      }
      .sharing-template-field select {
        min-height: 34px;
        font-family: var(--vscode-font-family);
      }
      .sharing-preview-stage,
      .sharing-presentation {
        min-width: 0;
      }
      .sharing-presentation[hidden] {
        display: none;
      }
      .sharing-presentation-title {
        margin: 0 0 var(--ccu-space-1);
        font-size: 15px;
      }
      .sharing-presentation-description {
        margin: 0 0 var(--ccu-space-3);
        color: var(--vscode-descriptionForeground);
        line-height: 1.45;
      }
      .sharing-controls-panel {
        box-sizing: border-box;
        width: 100%;
        margin-top: var(--ccu-space-4);
      }
      .sharing-artifact-preview {
        box-sizing: border-box;
        width: 100%;
      }
      .combined-preview-column,
      .combined-config-card {
        min-width: 0;
      }
      .combined-preview-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 24px;
        margin-bottom: var(--ccu-space-2);
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }
      .combined-preview-toolbar strong {
        color: var(--vscode-foreground);
        font-size: 12px;
      }
      .combined-config-card {
        padding: var(--ccu-space-4);
        border: 1px solid var(--ccu-border);
        border-radius: var(--ccu-radius-panel);
        background: var(--ccu-surface-subtle);
      }
      .combined-config-card h4,
      .sc-config h4 {
        margin: 0 0 var(--ccu-space-3);
        font-size: 13px;
      }
      .sharing-controls-panel .sc-field > span {
        color: var(--vscode-foreground);
      }
      .combined-heatmap-controls {
        display: grid;
        grid-template-columns: minmax(0, 2fr) repeat(2, minmax(160px, 0.8fr));
        gap: var(--ccu-space-3);
        margin-bottom: var(--ccu-space-4);
      }
      .combined-heatmap-controls .sc-field input,
      .combined-heatmap-controls .sc-field select {
        box-sizing: border-box;
        width: 100%;
        min-height: 30px;
        padding: 5px 8px;
        border: 1px solid var(--vscode-input-border, var(--ccu-border));
        border-radius: var(--ccu-radius-control);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        font-family: var(--vscode-font-family);
      }
      .combined-palette-fieldset {
        min-width: 0;
        margin: 0 0 var(--ccu-space-4);
        padding: var(--ccu-space-3) 0 0;
        border: 0;
        border-top: 1px solid var(--ccu-border);
      }
      .combined-palette-fieldset legend {
        padding: 0 6px 0 0;
        color: var(--vscode-foreground);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .combined-palette-options {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
      }
      .combined-palette-choice {
        display: grid;
        grid-template-columns: 14px minmax(42px, 1fr);
        gap: 4px 6px;
        align-items: center;
        padding: 7px;
        border: 1px solid var(--ccu-border);
        border-radius: 6px;
        background: var(--ccu-surface-raised);
        cursor: pointer;
        font-size: 10px;
      }
      .combined-palette-choice:has(input:checked) {
        border-color: var(--vscode-focusBorder);
        box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
      }
      .combined-palette-choice input {
        grid-column: 1;
        grid-row: 1;
        margin: 0;
      }
      .combined-palette-swatch {
        grid-column: 2;
        grid-row: 2;
        display: flex;
        height: 7px;
        overflow: hidden;
        border-radius: 999px;
      }
      .combined-palette-choice > span:last-child {
        grid-column: 2;
        grid-row: 1;
        min-width: 0;
        line-height: 1.25;
      }
      .combined-palette-swatch i {
        flex: 1 1 0;
      }
      .combined-custom-accent {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--ccu-space-2);
        margin-top: var(--ccu-space-2);
        color: var(--vscode-foreground);
        font-size: 11px;
      }
      .combined-custom-accent input {
        width: 42px;
        height: 26px;
        padding: 2px;
        border: 1px solid var(--ccu-border);
        border-radius: 5px;
        background: var(--vscode-input-background);
      }
      .combined-privacy-toggle {
        width: fit-content;
        margin-bottom: var(--ccu-space-2);
      }
      .combined-privacy-preview {
        padding: var(--ccu-space-2) var(--ccu-space-3);
        border-left: 3px solid var(--vscode-testing-iconPassed);
        border-radius: var(--ccu-radius-control);
        background: var(--ccu-surface-muted);
        color: var(--vscode-foreground);
        font-size: 10px;
        line-height: 1.4;
      }
      .combined-privacy-preview p {
        margin: 3px 0;
      }
      .combined-activity-disclaimer {
        margin: var(--ccu-space-2) var(--ccu-space-1) 0;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        line-height: 1.45;
      }
      .combined-share-actions {
        margin-top: var(--ccu-space-3);
        padding-top: var(--ccu-space-3);
        border-top: 1px solid var(--ccu-border);
      }
      .combined-output-panel {
        margin-top: var(--ccu-space-4);
        border-top: 1px solid var(--ccu-border);
        padding-top: var(--ccu-space-3);
      }
      .combined-output-panel summary {
        width: fit-content;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        font-weight: 600;
      }
      .combined-markdown {
        width: 100%;
        min-height: 46px;
        margin-top: var(--ccu-space-2);
        resize: vertical;
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border, var(--ccu-border));
        border-radius: var(--ccu-radius-control);
        padding: var(--ccu-space-2);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
      }
      .combined-heatmap-preview {
        margin: 0;
        padding: var(--ccu-space-3);
        border-radius: var(--ccu-radius-panel);
        background: var(--vscode-editor-background);
      }
      .combined-heatmap-preview svg {
        width: 100%;
        max-width: none;
        height: auto;
        border-radius: 12px;
      }
      .claude-heatmap-actions {
        padding-top: var(--ccu-space-3);
        border-top: 1px solid var(--ccu-border);
      }

      /* Clickable month bars in the all-time composition chart (drill to daily). */
      .hc-col-clickable {
        cursor: pointer;
      }
      .hc-col-clickable:hover .stack-bar {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }

      .cost-composition {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--vscode-panel-border);
      }

      .cost-comp-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 6px;
      }

      .cost-comp-head strong {
        color: var(--vscode-foreground);
        font-weight: 600;
      }

      .cost-comp-bar {
        display: flex;
        height: 14px;
        border-radius: 3px;
        overflow: hidden;
        background: var(--vscode-input-background);
      }

      .cost-comp-seg {
        height: 100%;
      }

      .cost-comp-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 6px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .composition-chart h4 {
        margin: 0 0 8px 0;
        font-size: 13px;
      }

      .stack-legend {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        margin-bottom: 8px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 2px;
        display: inline-block;
      }

      .stack-bar {
        width: 24px;
        display: flex;
        flex-direction: column-reverse;
        border-radius: 2px 2px 0 0;
        overflow: hidden;
        margin-bottom: 8px;
        min-height: 2px;
      }

      .stack-seg {
        width: 100%;
      }

      /* Cost bar rendered as a stacked composition: no gradient fill, segments
         stack from the bottom up. Segments ignore pointer events so a click
         falls through to the parent .chart-bar.clickable (drill-down). */
      .chart-bar.cost-stacked {
        background: none;
        display: flex;
        flex-direction: column-reverse;
        overflow: hidden;
        padding: 0;
      }
      .chart-bar.cost-stacked .stack-seg {
        pointer-events: none;
      }

      .seg-input {
        background: var(--vscode-charts-blue);
      }

      .seg-output {
        background: var(--vscode-charts-yellow);
      }

      .seg-cache-creation {
        background: var(--vscode-charts-purple);
      }

      .seg-cache-read {
        background: var(--vscode-charts-green);
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        gap: 12px;
      }

      .section-header h3 {
        margin: 0;
      }

      .section-header-right {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }

      .btn-small {
        padding: 4px 10px;
        font-size: 11px;
        white-space: nowrap;
      }

      .model-pricing {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed var(--vscode-panel-border);
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        word-break: break-word;
      }

      .table-hint {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin: 0 0 8px 0;
      }

      .quota-banner {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 0 0 12px 0;
        padding: 8px 10px;
        border: 1px solid var(--vscode-inputValidation-warningBorder, #d8a200);
        background: var(--vscode-inputValidation-warningBackground, rgba(216, 162, 0, 0.15));
        border-radius: 4px;
        font-size: 12px;
        line-height: 1.5;
      }
      .quota-banner-text {
        flex: 1;
      }
      .quota-banner-dismiss {
        flex: none;
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        font-size: 12px;
        padding: 0 2px;
      }

      .attr-controls {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        flex-wrap: wrap;
      }
      .attr-controls select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border, transparent);
        border-radius: 3px;
        padding: 2px 6px;
        font-size: 11px;
        max-width: 260px;
      }
      .attr-tab {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 3px 9px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .attr-tab.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-focusBorder);
      }
      .attr-char {
        margin: 8px 0;
        font-size: 13px;
      }
      .attr-hint {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 2px;
      }
      .wf-common-task {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.06));
        white-space: normal;
        line-height: 1.5;
      }

      th.sortable {
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }

      th.sortable:hover {
        color: var(--vscode-foreground);
        text-decoration: underline;
      }

      th.sortable.sorted-asc::after {
        content: ' \\25B2';
        font-size: 9px;
      }

      th.sortable.sorted-desc::after {
        content: ' \\25BC';
        font-size: 9px;
      }

      .group-toggle {
        display: inline-block;
        width: 14px;
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        transition: transform 0.15s ease;
      }

      .group-toggle.expanded {
        transform: rotate(90deg);
      }

      .group-count {
        font-weight: normal;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .project-child-cell {
        padding-left: 28px;
      }

      .project-child-row {
        background: var(--vscode-input-background);
      }

      .hc-wrap {
        display: flex;
        gap: 6px;
        margin-bottom: 20px;
        padding-top: 18px;
      }

      .hc-yaxis {
        width: 62px;
        height: 120px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        text-align: right;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }

      .hc-yval {
        line-height: 1;
        white-space: nowrap;
      }

      .hc-main {
        flex: 1;
        min-width: 0;
      }

      .hc-scroll {
        overflow-x: auto;
        overflow-y: visible;
      }

      .hc-plot {
        position: relative;
        height: 120px;
        min-width: fit-content;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .hc-grid {
        position: absolute;
        left: 0;
        right: 0;
        border-top: 1px dashed var(--vscode-panel-border);
        opacity: 0.6;
        pointer-events: none;
      }

      .hc-grid-top {
        top: 0;
      }

      .hc-grid-mid {
        top: 50%;
      }

      .hc-bars {
        display: flex;
        align-items: flex-end;
        gap: 4px;
        height: 120px;
        min-width: fit-content;
      }

      .hc-col {
        width: 38px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
      }

      .hc-col .chart-bar,
      .hc-col .stack-bar {
        margin-bottom: 0;
      }

      .hc-barval {
        font-size: 9px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 2px;
        white-space: nowrap;
      }

      .hc-xlabels {
        display: flex;
        gap: 4px;
        min-width: fit-content;
        margin-top: 4px;
      }

      .hc-xlabel {
        width: 38px;
        flex-shrink: 0;
        text-align: center;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }

      [data-codex-time-series],
      [data-codex-time-series] .chart-content,
      [data-codex-time-series] .chart-content > .hc-wrap,
      [data-codex-time-series] .composition-chart,
      [data-codex-time-series] .hc-wrap,
      [data-codex-time-series] .hc-main {
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }

      [data-codex-time-series] .hc-scroll,
      [data-codex-time-series] .daily-table-container {
        max-width: 100%;
        overflow-x: auto;
        overscroll-behavior-inline: contain;
        touch-action: pan-x pan-y;
        -webkit-overflow-scrolling: touch;
      }

      [data-codex-time-series] .daily-table {
        width: 100%;
        min-width: 1080px;
      }

      [data-codex-time-series] .daily-table th {
        white-space: nowrap;
      }

      /* Both providers render a complete rolling 30-day track. Keep those
         dense charts and their table inside independent, keyboard-focusable
         horizontal scrollers instead of widening the entire dashboard. The
         explicit max-content track also keeps grid lines and labels aligned
         after scrolling in Chromium. */
      [data-last30-daily] {
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }

      [data-last30-daily] .chart-content,
      [data-last30-daily] .chart-content > .hc-wrap,
      [data-last30-daily] .composition-chart,
      [data-last30-daily] .hc-wrap,
      [data-last30-daily] .hc-main {
        width: 100%;
        max-width: 100%;
        min-width: 0;
      }

      [data-last30-daily] .hc-scroll,
      [data-last30-daily] .daily-table-container {
        max-width: 100%;
        overflow-x: auto;
        overscroll-behavior-inline: contain;
        touch-action: pan-x pan-y;
        -webkit-overflow-scrolling: touch;
      }

      [data-last30-daily] .hc-plot,
      [data-last30-daily] .hc-xlabels {
        width: max-content;
        min-width: 100%;
      }

      [data-last30-daily] .daily-table {
        width: 100%;
        min-width: 960px;
      }

      [data-last30-daily] .daily-table th {
        white-space: nowrap;
      }

      .git-badge {
        display: inline-block;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 1px 5px;
        border-radius: 3px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        vertical-align: middle;
      }

      .cbar-total {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }

      .cbar-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 8px 0 16px;
      }

      .cbar-subhead {
        margin: 16px 0 4px;
        font-size: 14px;
      }

      .cbar-row {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
      }

      .cbar-label {
        width: 160px;
        flex-shrink: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cbar-track {
        flex: 1;
        height: 16px;
        min-width: 40px;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 3px;
        overflow: hidden;
      }

      .cbar-fill {
        height: 100%;
        border-radius: 2px;
        min-width: 1px;
      }

      .cbar-val {
        width: 96px;
        flex-shrink: 0;
        text-align: right;
        font-family: var(--vscode-editor-font-family);
      }

      .cbar-pct {
        width: 52px;
        flex-shrink: 0;
        text-align: right;
        color: var(--vscode-descriptionForeground);
      }

      .cf-1 {
        background: var(--vscode-charts-blue);
      }

      .cf-2 {
        background: var(--vscode-charts-yellow);
      }

      .cf-3 {
        background: var(--vscode-charts-purple);
      }

      .cf-4 {
        background: var(--vscode-charts-green);
      }

      .cf-5 {
        background: var(--vscode-charts-red);
      }

      .provider-tabs {
        display: flex;
        gap: 6px;
        margin: 4px 0 18px;
        padding-bottom: 10px;
        max-width: 100%;
        border-bottom: 1px solid var(--ccu-border);
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-inline: contain;
        scrollbar-width: thin;
      }
      .provider-tab {
        flex: 0 0 auto;
        white-space: nowrap;
        border: 1px solid var(--ccu-border);
        border-radius: 999px;
        padding: 5px 13px;
        background: transparent;
        color: var(--vscode-foreground);
        cursor: pointer;
      }
      .provider-tab.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-button-background);
      }

      .advice-effectiveness-body {
        margin-top: 13px;
        padding-top: 14px;
        border-top: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
        min-width: 0;
      }
      .advice-effectiveness-heading h4,
      .advice-feedback-section h5,
      .advice-payload-section h5 {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
      }
      .advice-effectiveness-heading h4 {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .advice-effectiveness-heading p,
      .advice-candidate-note,
      .advice-local-note,
      .advice-inline-status {
        margin: 4px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        line-height: 1.45;
      }
      .advice-candidate-note {
        margin-top: 7px;
      }
      .advice-spine {
        position: relative;
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 10px;
        list-style: none;
        margin: 14px 0 12px;
        padding: 0;
      }
      .advice-spine::before {
        content: "";
        position: absolute;
        z-index: 0;
        left: 10%;
        right: 10%;
        top: 13px;
        height: 1px;
        background: var(--vscode-textLink-foreground);
      }
      .advice-spine li {
        position: relative;
        z-index: 1;
        min-width: 0;
      }
      .advice-step-marker {
        display: flex;
        width: 26px;
        height: 26px;
        margin: 0 auto 7px;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--vscode-textLink-foreground);
        border-radius: 999px;
        background: var(--vscode-editor-background);
        color: var(--vscode-textLink-foreground);
        font-size: 10px;
        font-weight: 700;
      }
      .advice-spine li > div {
        text-align: center;
      }
      .advice-spine strong {
        font-size: 11px;
      }
      .advice-spine p {
        margin: 3px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 10.5px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
      .advice-step-caveat {
        font-size: 10px;
      }
      .advice-feedback-section,
      .advice-payload-section {
        margin-top: 12px;
        padding-top: 11px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .advice-feedback-group {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin-top: 7px;
      }
      .advice-feedback-button {
        padding: 4px 9px;
        border: 1px solid var(--vscode-button-secondaryBackground, var(--vscode-panel-border));
        border-radius: 999px;
        background: transparent;
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: 11px;
      }
      .advice-feedback-button.is-selected {
        border-width: 2px;
        border-color: var(--vscode-focusBorder);
        font-weight: 600;
      }
      .advice-feedback-button:disabled,
      .advice-consent input:disabled {
        opacity: 0.55;
        cursor: default;
      }
      .advice-feedback-button:focus-visible,
      .advice-consent input:focus-visible,
      .advice-payload-actions button:focus-visible,
      .advice-payload-preview summary:focus-visible,
      .advice-payload-preview pre:focus-visible {
        outline: 2px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .advice-consent {
        display: grid;
        gap: 8px;
        margin: 9px 0 0;
        padding: 10px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
      }
      .advice-consent legend {
        padding: 0 5px;
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
      }
      .advice-consent label {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        cursor: pointer;
      }
      .advice-consent input {
        flex: 0 0 auto;
        margin-top: 2px;
      }
      .advice-consent label span {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .advice-consent label strong,
      .advice-consent label small {
        font-size: 11px;
        line-height: 1.4;
      }
      .advice-consent label small {
        color: var(--vscode-descriptionForeground);
      }
      .advice-payload-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 9px;
      }
      .advice-payload-actions span {
        color: var(--vscode-descriptionForeground);
        font-size: 10.5px;
      }
      .advice-payload-preview {
        margin-top: 9px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        overflow: hidden;
      }
      .advice-payload-preview summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 9px;
        cursor: pointer;
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        font-size: 11px;
        font-weight: 600;
      }
      .advice-seal-stamp {
        flex: 0 0 auto;
        padding: 1px 5px;
        border: 1px solid var(--vscode-textLink-foreground);
        border-radius: 3px;
        color: var(--vscode-textLink-foreground);
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 9px;
        letter-spacing: 0.4px;
      }
      .advice-payload-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 5px 10px;
        padding: 8px 9px 0;
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
      }
      .advice-payload-meta code {
        flex-basis: 100%;
        color: var(--vscode-foreground);
        overflow-wrap: anywhere;
      }
      .advice-payload-preview pre {
        max-height: 280px;
        margin: 8px 9px 9px;
        padding: 9px;
        overflow: auto;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
        color: var(--vscode-editor-foreground, var(--vscode-foreground));
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 10px;
        line-height: 1.45;
        white-space: pre;
      }
      @media (max-width: 800px) {
        .project-matrix-head {
          flex-direction: column;
          gap: var(--ccu-space-2);
        }
        .project-matrix-coverage { white-space: normal; }
        .project-matrix-toolbar {
          gap: var(--ccu-space-2);
        }
        .combined-share-layout {
          grid-template-columns: minmax(0, 1fr);
        }
        .combined-heatmap-controls {
          grid-template-columns: minmax(0, 1fr);
        }
        .combined-palette-options {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .combined-heatmap-preview svg {
          width: auto;
          max-width: none;
        }
        .claude-share-card-presentation .share-preview svg {
          width: 1200px;
          min-width: 1200px;
        }
        .action-card-head {
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .advice-spine {
          grid-template-columns: minmax(0, 1fr);
          gap: 9px;
          padding-left: 0;
        }
        .advice-spine::before {
          left: 13px;
          right: auto;
          top: 13px;
          bottom: 13px;
          width: 1px;
          height: auto;
        }
        .advice-spine li {
          display: grid;
          grid-template-columns: 26px minmax(0, 1fr);
          gap: 9px;
        }
        .advice-step-marker {
          margin: 0;
        }
        .advice-spine li > div {
          text-align: left;
        }
      }
      @media (max-width: 480px) {
        body {
          padding: var(--ccu-space-3);
        }
        header {
          align-items: flex-start;
          gap: var(--ccu-space-3);
        }
        h1 {
          padding-top: 3px;
          font-size: 18px;
        }
        .actions {
          gap: var(--ccu-space-1);
        }
        .actions button {
          padding: 7px 9px;
        }
        .summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--ccu-space-2);
        }
        .summary-item {
          min-height: 58px;
          padding: 10px var(--ccu-space-3);
        }
        .summary-item .value {
          font-size: 17px;
        }
        .tabs {
          margin-bottom: var(--ccu-space-4);
        }
        .project-matrix-control {
          width: 100%;
        }
        .project-matrix-control > span {
          width: 48px;
        }
        .project-matrix-grid .project-matrix-project {
          width: 132px;
          max-width: 132px;
        }
        .combined-heatmap-panel {
          padding: var(--ccu-space-3);
        }
        .combined-share-header {
          flex-direction: column;
          gap: var(--ccu-space-2);
        }
        .combined-private-badge {
          white-space: normal;
        }
        .combined-heatmap-controls {
          grid-template-columns: minmax(0, 1fr);
        }
        .combined-palette-options {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          scroll-behavior: auto !important;
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `;
  }

  private getScript(): string {
    return `
// Get VSCode API
const vscode = acquireVsCodeApi();
const __adviceCopy = ${JSON.stringify(I18n.t.popup.adviceEffectiveness)};
let __claudeLast30HoursByDay = ${LIVE_PATCH_HOURS_START}${inlineScriptJson(
      claudeHourlyDisplayDto(this.hourlyDataForRolling30DaysByDay),
    )}${LIVE_PATCH_HOURS_END};

function ccuReadUiState() {
  try { return vscode.getState() || {}; } catch (e) { return {}; }
}
function ccuWriteUiState(key, value) {
  try {
    var st = ccuReadUiState();
    st[key] = value;
    vscode.setState(st);
  } catch (e) {}
}
async function ccuVerifyCanonicalPreview(body, sha256, utf8Bytes) {
  if (
    typeof body !== 'string' ||
    typeof sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isInteger(utf8Bytes) ||
    utf8Bytes < 0
  ) { return false; }
  try {
    var encoded = new TextEncoder().encode(body);
    if (encoded.byteLength !== utf8Bytes || !globalThis.crypto || !globalThis.crypto.subtle) {
      return false;
    }
    var digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    var hex = Array.prototype.map.call(new Uint8Array(digest), function(byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
    return hex === sha256;
  } catch (e) {
    return false;
  }
}
var advicePreviewValidationGeneration = {};
var optimizerPreviewValidationGeneration = 0;
function adviceCancelPendingPreviewValidation(provider) {
  if (provider !== 'claude' && provider !== 'codex') { return 0; }
  var generation = (advicePreviewValidationGeneration[provider] || 0) + 1;
  advicePreviewValidationGeneration[provider] = generation;
  return generation;
}
function adviceInvalidateAndClearPreview(provider) {
  adviceCancelPendingPreviewValidation(provider);
  adviceClearPreview(provider);
}
function adviceInvalidateAllPreviews() {
  adviceInvalidateAndClearPreview('claude');
  adviceInvalidateAndClearPreview('codex');
}
function ccuProviderName() {
  var selected = document.querySelector('.provider-tab[aria-selected="true"]');
  return selected ? (selected.getAttribute('data-provider') || selected.id.replace('provider-tab-', '')) : 'claude';
}
function ccuElementStateKey(element, kind) {
  var tab = element && element.closest ? element.closest('.tab-content') : null;
  var root = tab || document;
  var elements = Array.prototype.slice.call(root.querySelectorAll(kind === 'table' ? 'table' : '.daily-breakdown, .hourly-breakdown'));
  return ccuProviderName() + ':' + (tab ? tab.id : 'page') + ':' + kind + ':' + Math.max(0, elements.indexOf(element));
}

function ccuProjectMatrixState(root) {
  var provider = root ? root.getAttribute('data-project-matrix') : '';
  var all = ccuReadUiState().projectUsageMatrix || {};
  var saved = provider && all[provider] ? all[provider] : {};
  return {
    range: saved.range === '90' ? '90' : '30',
    view: saved.view === 'trend' ? 'trend' : 'heatmap',
    expanded: saved.expanded === true
  };
}
function ccuSaveProjectMatrixState(root, state) {
  var provider = root ? root.getAttribute('data-project-matrix') : '';
  if (provider !== 'claude' && provider !== 'codex') { return; }
  var all = ccuReadUiState().projectUsageMatrix || {};
  all[provider] = {
    range: state.range,
    view: state.view,
    expanded: state.expanded === true
  };
  ccuWriteUiState('projectUsageMatrix', all);
}
function ccuApplyProjectMatrixState(root, state) {
  if (!root) { return; }
  root.querySelectorAll('[data-project-matrix-range]').forEach(function(button) {
    var selected = button.getAttribute('data-project-matrix-range') === state.range;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  root.querySelectorAll('[data-project-matrix-view]').forEach(function(button) {
    var selected = button.getAttribute('data-project-matrix-view') === state.view;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  root.querySelectorAll('[data-project-matrix-range-panel]').forEach(function(panel) {
    panel.hidden = panel.getAttribute('data-project-matrix-range-panel') !== state.range;
    panel.querySelectorAll('[data-project-matrix-heatmap]').forEach(function(view) {
      view.hidden = state.view !== 'heatmap';
    });
    panel.querySelectorAll('[data-project-matrix-trend]').forEach(function(view) {
      view.hidden = state.view !== 'trend';
    });
  });
  root.querySelectorAll('[data-project-matrix-extra]').forEach(function(row) {
    row.hidden = !state.expanded;
  });
  var expand = root.querySelector('[data-project-matrix-expand]');
  if (expand) {
    expand.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');
    expand.textContent = state.expanded
      ? (expand.getAttribute('data-show-less') || '')
      : (expand.getAttribute('data-show-more') || '');
  }
}
function restoreProjectMatrixState(scope) {
  var root = scope || document;
  var matrices = [];
  if (root.matches && root.matches('[data-project-matrix]')) { matrices.push(root); }
  root.querySelectorAll('[data-project-matrix]').forEach(function(matrix) { matrices.push(matrix); });
  matrices.forEach(function(matrix) {
    ccuApplyProjectMatrixState(matrix, ccuProjectMatrixState(matrix));
  });
}
document.addEventListener('click', function(event) {
  var control = event.target && event.target.closest
    ? event.target.closest('[data-project-matrix-range],[data-project-matrix-view],[data-project-matrix-expand]')
    : null;
  if (!control) { return; }
  var root = control.closest('[data-project-matrix]');
  if (!root) { return; }
  event.preventDefault();
  var state = ccuProjectMatrixState(root);
  var range = control.getAttribute('data-project-matrix-range');
  var view = control.getAttribute('data-project-matrix-view');
  if (range === '30' || range === '90') { state.range = range; }
  if (view === 'heatmap' || view === 'trend') { state.view = view; }
  if (control.hasAttribute('data-project-matrix-expand')) { state.expanded = !state.expanded; }
  ccuApplyProjectMatrixState(root, state);
  ccuSaveProjectMatrixState(root, state);
});

function adviceRoot(provider) {
  if (provider === 'optimizer') {
    return document.querySelector('.action-card[data-advice-provider="optimizer"]');
  }
  return document.querySelector('.advice-effectiveness-body[data-advice-provider="' + provider + '"]');
}
function adviceConsentElements(provider) {
  var root = adviceRoot(provider);
  return {
    root: root,
    aggregate: root ? root.querySelector('[data-advice-consent-kind="aggregate"]') : null,
    prompt: root ? root.querySelector('[data-advice-consent-kind="prompt"]') : null,
    previewButton: root ? root.querySelector('[data-advice-action="preview"]') : null,
    sendButton: root ? root.querySelector('[data-advice-action="send"]') : null,
    preview: root ? root.querySelector('[data-advice-preview]') : null,
    consentStatus: root ? root.querySelector('[data-advice-consent-status]') : null,
  };
}
function adviceSyncConsentControls(provider) {
  var elements = adviceConsentElements(provider);
  if (!elements.root || !elements.aggregate || !elements.prompt) { return; }
  var promptAvailable = elements.prompt.getAttribute('data-prompt-available') === 'true';
  elements.prompt.disabled = elements.aggregate.disabled || !elements.aggregate.checked || !promptAvailable;
  if (elements.prompt.disabled) { elements.prompt.checked = false; }
  if (elements.previewButton) {
    elements.previewButton.disabled = elements.aggregate.disabled || !elements.aggregate.checked;
  }
}
function adviceClearPreview(provider) {
  var elements = adviceConsentElements(provider);
  if (!elements.preview) { return; }
  elements.preview.hidden = true;
  elements.preview.open = false;
  elements.preview.removeAttribute('data-snapshot-id');
  if (elements.sendButton) {
    elements.sendButton.disabled = true;
    elements.sendButton.textContent = __adviceCopy.sendPreparedRequest;
  }
  var body = elements.preview.querySelector('[data-advice-preview-body]');
  var digest = elements.preview.querySelector('[data-advice-preview-digest]');
  var mode = elements.preview.querySelector('[data-advice-preview-mode]');
  var contentType = elements.preview.querySelector('[data-advice-preview-content-type]');
  var bytes = elements.preview.querySelector('[data-advice-preview-bytes]');
  var count = elements.preview.querySelector('[data-advice-preview-count]');
  if (body) { body.textContent = ''; }
  if (digest) { digest.textContent = ''; }
  if (mode) { mode.textContent = ''; }
  if (contentType) { contentType.textContent = ''; }
  if (bytes) { bytes.textContent = ''; }
  if (count) { count.textContent = ''; }
}
function adviceSetConsentPending(provider, pending) {
  var elements = adviceConsentElements(provider);
  if (elements.aggregate) { elements.aggregate.disabled = !!pending; }
  if (elements.prompt) { elements.prompt.disabled = !!pending; }
  if (elements.previewButton) { elements.previewButton.disabled = true; }
  if (!pending) { adviceSyncConsentControls(provider); }
}
function restoreAdviceEffectivenessState() {
  document.querySelectorAll('.advice-effectiveness-body[data-advice-provider]').forEach(function(root) {
    var provider = root.getAttribute('data-advice-provider');
    if (provider) { adviceSyncConsentControls(provider); }
  });
}

// Keep expanded <details data-persist> open across auto-refresh re-renders — a
// data refresh shouldn't collapse something you're reading. Only a tab switch
// resets to the default (see clearPersistedDetails in showTab).
function savePersistedDetails() {
  try {
    var open = [];
    document.querySelectorAll('details[data-persist]').forEach(function(d){
      if (d.open) { open.push(d.getAttribute('data-persist')); }
    });
    var st = ccuReadUiState();
    st.openDetails = open;
    vscode.setState(st);
  } catch (e) {}
}
function restorePersistedDetails() {
  try {
    var st = ccuReadUiState();
    var open = st.openDetails || [];
    if (!open.length) { return; }
    document.querySelectorAll('details[data-persist]').forEach(function(d){
      if (open.indexOf(d.getAttribute('data-persist')) !== -1) { d.open = true; }
    });
  } catch (e) {}
}
function clearPersistedDetails() {
  try {
    var st = ccuReadUiState();
    st.openDetails = [];
    st.claudeDrilldownDetails = {};
    st.codexHourlyDetails = {};
    st.hourlyChartSelections = {};
    vscode.setState(st);
    document.querySelectorAll('[data-hourly-overview]').forEach(function(container) {
      clearHourlyOverviewSelection(container, false);
    });
  } catch (e) {}
}
// 'toggle' doesn't bubble — listen in the capture phase.
document.addEventListener('toggle', function(e){
  if (e.target && e.target.matches && e.target.matches('details[data-persist]')) { savePersistedDetails(); }
}, true);

// Restore the active tab from localStorage before first paint, so a reload can't change it.
function ccuSharingCommandPending() {
  return !!__sharingTemplateCommand;
}
function restoreActiveTab() {
  try {
    if (
      ccuSharingCommandPending() &&
      document.getElementById('tab-all') &&
      document.getElementById('all')
    ) {
      showTab('all', true);
      try { localStorage.setItem('ccu.activeTab', 'all'); } catch (e) {}
      return;
    }
    var t = localStorage.getItem('ccu.activeTab');
    if (t && document.getElementById('tab-' + t) && document.getElementById(t)) {
      showTab(t, true);
    }
  } catch (e) {}
}
var __ccuUiReady = false;
function restoreUi() {
  restoreActiveTab();
  restoreSessionFilter();
  restorePersistedDetails();
  restoreClaudeDrilldownDetails();
  restoreCodexHourlyDetails();
  restoreAdviceEffectivenessState();
  restoreSessionDetails();
  restoreTableSorts();
  restoreChartMetrics();
  initializeChartDrilldowns();
  initializeHourlyOverviewSelections();
  restoreHourlyOverviewSelections();
  initializeStatusRegions();
  restoreSharingTemplate();
  restoreCombinedHeatmapConfig();
  restoreShareCardDraft();
  restoreProjectMatrixState();
  requestLocalDataInventoryForVisibleSettings();
  restoreScrollPosition();
  vscode.postMessage({ command: 'localDataClientReady' });
}

${getDashboardRefreshClientScript()}
${getChartAccessibilityClientScript()}
function ccuScrollStateKey() {
  var active = document.querySelector('.tab.active');
  return ccuProviderName() + ':' + (active ? active.id.replace('tab-', '') : 'today');
}
function saveScrollPosition() {
  if (!__ccuUiReady) { return; }
  var positions = ccuReadUiState().scrollPositions || {};
  var key = ccuScrollStateKey();
  var y = window.scrollY;
  // Chromium may deliver one final scroll event after the debounce fires.
  // Do not make pagehide or visibilitychange rewrite an identical position;
  // setState is synchronous host work and duplicate writes make long Codex
  // pages feel less responsive without preserving any additional state.
  if (positions[key] === y) { return; }
  positions[key] = y;
  ccuWriteUiState('scrollPositions', positions);
}
function restoreScrollPosition() {
  var positions = ccuReadUiState().scrollPositions || {};
  var y = positions[ccuScrollStateKey()];
  if (typeof y !== 'number') { __ccuUiReady = true; return; }
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      window.scrollTo(0, y);
      __ccuUiReady = true;
    });
  });
}
var __ccuScrollSaveTimer = 0;
var __ccuScrollDirty = false;
function flushScrollPosition() {
  if (__ccuScrollSaveTimer) {
    clearTimeout(__ccuScrollSaveTimer);
    __ccuScrollSaveTimer = 0;
  }
  if (!__ccuUiReady || !__ccuScrollDirty) { return; }
  __ccuScrollDirty = false;
  saveScrollPosition();
}
function scheduleScrollPositionSave() {
  if (!__ccuUiReady) { return; }
  __ccuScrollDirty = true;
  if (__ccuScrollSaveTimer) { clearTimeout(__ccuScrollSaveTimer); }
  __ccuScrollSaveTimer = setTimeout(flushScrollPosition, 180);
}
window.addEventListener('scroll', scheduleScrollPositionSave, { passive: true });
window.addEventListener('pagehide', flushScrollPosition);
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') { flushScrollPosition(); }
});
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreUi);
} else {
  restoreUi();
}

// Locale + timezone baked in at render time so drill-down renders match the
// user's UI language and configured timezone (instead of the hardcoded zh-TW
// that the original used in this script body).
const __locale = ${JSON.stringify(I18n.getLocale())};
const __tz = ${JSON.stringify(resolveTimeZone(I18n.getTimezone()))};
const __currencyDisplay = ${JSON.stringify({
  ...I18n.getCurrencyDisplay(),
  decimalPlaces: I18n.getDecimalPlaces(),
})};
const __combinedHeatmapCopy = ${JSON.stringify(combinedHeatmapUiCopy(I18n.getLocale()))};
const __sharingWorkspaceCopy = ${JSON.stringify(I18n.sharingWorkspace)};
const __sharingTemplateCommand = ${JSON.stringify(this.sharingCommandIntents.pending() ?? null)};
const __localDataCopy = ${JSON.stringify(localDataUiCopy(I18n.getLocale()))};
const __dateOpts = (extra) => {
  const opts = Object.assign({}, extra || {});
  if (__tz) opts.timeZone = __tz;
  return opts;
};
// Usage date keys have already been bucketed in the configured timezone. Parse
// their components and format a UTC-noon sentinel so neither the configured
// zone nor the Webview host zone can roll a day/month label backwards.
function ccuFormatUsageDateKey(value, extra, monthly) {
  var raw = String(value || '');
  var match = /^(\\d{4})-(\\d{2})(?:-(\\d{2}))?$/.exec(raw);
  if (!match) { return raw; }
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3] || 1);
  var date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return raw;
  }
  var isMonthly = monthly === true || !match[3];
  var options = isMonthly
    ? { year: 'numeric', month: 'long' }
    : Object.assign({}, extra || {});
  options.timeZone = 'UTC';
  return date.toLocaleDateString(__locale, options);
}
const __dayKeyFormatter = new Intl.DateTimeFormat('en-CA', __dateOpts({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}));
function ccuDayKey(value) {
  var date = new Date(value);
  if (isNaN(date.getTime())) { return ''; }
  var parts = __dayKeyFormatter.formatToParts(date);
  var year = '';
  var month = '';
  var day = '';
  parts.forEach(function(part) {
    if (part.type === 'year') { year = part.value; }
    if (part.type === 'month') { month = part.value; }
    if (part.type === 'day') { day = part.value; }
  });
  return year && month && day ? year + '-' + month + '-' + day : '';
}
function ccuRollingDaySet(count) {
  var endKey = ccuDayKey(Date.now());
  var match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(endKey);
  var days = new Set();
  if (!match || count <= 0) { return days; }
  var end = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  for (var offset = 0; offset < count; offset++) {
    var cursor = new Date(end.getTime());
    cursor.setUTCDate(cursor.getUTCDate() - offset);
    days.add(cursor.toISOString().slice(0, 10));
  }
  return days;
}

// Define basic functions
function showProvider(provider, tab) {
  vscode.postMessage({ command: 'providerChanged', provider: provider, tab: tab || '' });
}

${getProviderNavClientScript()}

function selectSharingTemplate(template, save) {
  if (['combinedHeatmap', 'claudeShareCard', 'claudeHeatmap'].indexOf(template) < 0) { return; }
  var selector = document.getElementById('sharingTemplate');
  var option = selector ? selector.querySelector('option[value="' + template + '"]') : null;
  if (!selector || !option || option.disabled) { return; }
  selector.value = template;
  document.querySelectorAll('[data-sharing-presentation]').forEach(function(presentation) {
    presentation.hidden = presentation.getAttribute('data-sharing-presentation') !== template;
  });
  if (save) {
    try { localStorage.setItem('ccu.sharing.template', template); } catch (e) {}
    vscode.postMessage({ command: 'sharingTemplateChanged', template: template });
  }
}
function restoreSharingTemplate() {
  var selector = document.getElementById('sharingTemplate');
  if (!selector) { return; }
  var stored = '';
  var commandPending = ccuSharingCommandPending();
  try {
    if (commandPending) {
      stored = __sharingTemplateCommand.template;
      localStorage.setItem('ccu.sharing.template', stored);
    } else {
      stored = localStorage.getItem('ccu.sharing.template') || '';
    }
  } catch (e) {
    if (commandPending) { stored = __sharingTemplateCommand.template; }
  }
  var option = stored ? selector.querySelector('option[value="' + stored + '"]') : null;
  var initial = selector.value;
  var resolved = option && !option.disabled ? stored : selector.value;
  selectSharingTemplate(resolved, false);
  if (!commandPending && resolved !== initial) {
    vscode.postMessage({ command: 'sharingTemplateChanged', template: resolved });
  }
  if (commandPending) {
    vscode.postMessage({
      command: 'sharingTemplateCommandAck',
      revision: __sharingTemplateCommand.revision
    });
  }
}
function selectDefaultSharingTemplate() {
  var selector = document.getElementById('sharingTemplate');
  if (!selector) { return; }
  var combined = selector.querySelector('option[value="combinedHeatmap"]');
  selectSharingTemplate(combined && !combined.disabled ? 'combinedHeatmap' : 'claudeShareCard', false);
}

function scReadConfig() {
  var rangeEl = document.getElementById('scRange');
  var scopeEl = document.getElementById('scScope');
  var sections = {};
  var boxes = document.querySelectorAll('.sc-sec');
  for (var i = 0; i < boxes.length; i++) {
    sections[boxes[i].getAttribute('data-sec')] = boxes[i].checked;
  }
  var fullEl = document.getElementById('scFull');
  var themeEl = document.getElementById('scTheme');
  return {
    range: rangeEl ? rangeEl.value : 'last30',
    scope: scopeEl ? scopeEl.value : 'all',
    theme: themeEl ? themeEl.value : 'claudeCream',
    fullNumbers: fullEl ? fullEl.checked : false,
    sections: sections
  };
}
// Project paths and session IDs are valid in-memory selector values, but they
// must not become durable UI preferences. Keep the full draft only for the
// lifetime of this Webview and persist the non-identifying controls.
var __ccuShareCardDraft = null;
function scPersistentDraftConfig(cfg) {
  return {
    range: cfg && cfg.range,
    scope: 'all',
    theme: cfg && cfg.theme,
    fullNumbers: !!(cfg && cfg.fullNumbers),
    sections: cfg && cfg.sections
  };
}
function scWritePersistentDraft(cfg) {
  try {
    localStorage.setItem(
      'ccu.sharing.shareCardDraft',
      JSON.stringify(scPersistentDraftConfig(cfg))
    );
  } catch (e) {}
}
function scSaveDraft() {
  __ccuShareCardDraft = scReadConfig();
  scWritePersistentDraft(__ccuShareCardDraft);
}
function scSetSelectValue(id, value) {
  var select = document.getElementById(id);
  if (!select || typeof value !== 'string') { return; }
  for (var i = 0; i < select.options.length; i++) {
    if (select.options[i].value === value) { select.value = value; return; }
  }
}
function restoreShareCardDraft() {
  var controls = document.querySelector('.claude-share-card-presentation .sc-config');
  if (!controls) { return; }
  controls.addEventListener('change', scSaveDraft);
  try {
    var cfg = __ccuShareCardDraft;
    if (!cfg) {
      var raw = localStorage.getItem('ccu.sharing.shareCardDraft');
      if (!raw || raw.length > 4096) { return; }
      cfg = JSON.parse(raw);
      // Migrate older drafts that persisted a raw project path or session ID.
      __ccuShareCardDraft = cfg;
      scWritePersistentDraft(cfg);
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { return; }
    scSetSelectValue('scRange', cfg.range);
    scSetSelectValue('scScope', cfg.scope);
    scSetSelectValue('scTheme', cfg.theme);
    var full = document.getElementById('scFull');
    if (full && typeof cfg.fullNumbers === 'boolean') { full.checked = cfg.fullNumbers; }
    if (cfg.sections && typeof cfg.sections === 'object' && !Array.isArray(cfg.sections)) {
      controls.querySelectorAll('.sc-sec').forEach(function(box) {
        var key = box.getAttribute('data-sec');
        if (key && typeof cfg.sections[key] === 'boolean') { box.checked = cfg.sections[key]; }
      });
    }
  } catch (e) {}
}
function scApplyDefaultControls() {
  scSetSelectValue('scRange', 'last30');
  scSetSelectValue('scScope', 'all');
  scSetSelectValue('scTheme', 'claudeClassic');
  var full = document.getElementById('scFull');
  if (full) { full.checked = false; }
  var optional = { messages: true, projectName: true };
  document.querySelectorAll('.claude-share-card-presentation .sc-sec').forEach(function(box) {
    box.checked = !optional[box.getAttribute('data-sec')];
  });
}
function generateShareCard() {
  var cfg = scReadConfig();
  scSaveDraft();
  var prev = document.getElementById('scPreview');
  if (prev) { prev.innerHTML = '<p class="table-hint">' + __sharingWorkspaceCopy.generating + '</p>'; }
  vscode.postMessage({ command: 'buildShareCard', range: cfg.range, scope: cfg.scope, theme: cfg.theme, fullNumbers: cfg.fullNumbers, sections: cfg.sections });
}
function exportShareCardConfigured() {
  var cfg = scReadConfig();
  scSaveDraft();
  vscode.postMessage({ command: 'exportShareCard', range: cfg.range, scope: cfg.scope, theme: cfg.theme, fullNumbers: cfg.fullNumbers, sections: cfg.sections });
}
function exportHeatmap() {
  vscode.postMessage({ command: 'exportHeatmap' });
}
function publishHeatmap() {
  vscode.postMessage({ command: 'publishHeatmap' });
}
function combinedHeatmapReadConfig() {
  var title = document.getElementById('combinedHeatmapTitle');
  var range = document.getElementById('combinedHeatmapRange');
  var intensityMode = document.getElementById('combinedHeatmapIntensityMode');
  var privacy = document.getElementById('combinedHeatmapPrivacy');
  var palette = document.querySelector('input[name="combinedHeatmapPalette"]:checked');
  var customAccent = document.getElementById('combinedHeatmapCustomAccent');
  return {
    title: title ? title.value : __combinedHeatmapCopy.defaultTitle,
    range: range ? range.value : 'year',
    intensityMode: intensityMode ? intensityMode.value : 'quantile',
    privacyPreview: privacy ? privacy.checked : true,
    palette: palette ? palette.value : 'academicViolet',
    customAccent: customAccent ? customAccent.value : '#4f2f87'
  };
}
function combinedHeatmapSaveConfig(config) {
  try {
    localStorage.setItem('ccu.combinedHeatmap.title', config.title);
    localStorage.setItem('ccu.combinedHeatmap.range', config.range);
    localStorage.setItem('ccu.combinedHeatmap.intensityMode', config.intensityMode);
    localStorage.setItem('ccu.combinedHeatmap.privacyPreview', config.privacyPreview ? 'true' : 'false');
    localStorage.setItem('ccu.combinedHeatmap.palette', config.palette);
    localStorage.setItem('ccu.combinedHeatmap.customAccent', config.customAccent);
  } catch (e) {}
}
function toggleCombinedCustomAccent() {
  var config = combinedHeatmapReadConfig();
  var customAccent = document.getElementById('combinedHeatmapCustomAccent');
  if (customAccent) { customAccent.disabled = config.palette !== 'custom'; }
}
function toggleCombinedHeatmapPrivacy(save) {
  var config = combinedHeatmapReadConfig();
  var preview = document.getElementById('combinedHeatmapPrivacyPreview');
  if (preview) { preview.hidden = !config.privacyPreview; }
  if (save) { combinedHeatmapSaveConfig(config); }
}
function restoreCombinedHeatmapConfig() {
  var title = document.getElementById('combinedHeatmapTitle');
  var range = document.getElementById('combinedHeatmapRange');
  var intensityMode = document.getElementById('combinedHeatmapIntensityMode');
  var privacy = document.getElementById('combinedHeatmapPrivacy');
  var customAccent = document.getElementById('combinedHeatmapCustomAccent');
  if (!title || !range || !intensityMode || !privacy || !customAccent) { return; }
  var changed = false;
  try {
    var storedTitle = localStorage.getItem('ccu.combinedHeatmap.title');
    var storedRange = localStorage.getItem('ccu.combinedHeatmap.range');
    var storedIntensityMode = localStorage.getItem('ccu.combinedHeatmap.intensityMode');
    var storedPrivacy = localStorage.getItem('ccu.combinedHeatmap.privacyPreview');
    var storedPalette = localStorage.getItem('ccu.combinedHeatmap.palette');
    var storedAccent = localStorage.getItem('ccu.combinedHeatmap.customAccent');
    if (storedTitle) { title.value = storedTitle; changed = storedTitle !== title.getAttribute('data-default-value'); }
    if (storedRange === '30d' || storedRange === '90d' || storedRange === 'year') {
      range.value = storedRange;
      changed = changed || storedRange !== range.getAttribute('data-default-value');
    }
    if (storedIntensityMode === 'quantile' || storedIntensityMode === 'logarithmic' || storedIntensityMode === 'linear') {
      intensityMode.value = storedIntensityMode;
      changed = changed || storedIntensityMode !== intensityMode.getAttribute('data-default-value');
    }
    if (storedPrivacy === 'false') { privacy.checked = false; }
    if (['academicViolet', 'claudeOrange', 'codexBlue', 'githubGreen', 'custom'].indexOf(storedPalette) >= 0) {
      var paletteInput = document.querySelector('input[name="combinedHeatmapPalette"][value="' + storedPalette + '"]');
      if (paletteInput) { paletteInput.checked = true; }
      changed = changed || storedPalette !== 'academicViolet';
    }
    if (storedAccent && /^#[0-9a-fA-F]{6}$/.test(storedAccent)) {
      customAccent.value = storedAccent;
      changed = changed || storedAccent.toLowerCase() !== '#4f2f87';
    }
  } catch (e) {}
  toggleCombinedCustomAccent();
  toggleCombinedHeatmapPrivacy(false);
  if (changed) { generateCombinedHeatmapPreview(); }
}
function generateCombinedHeatmapPreview() {
  var config = combinedHeatmapReadConfig();
  combinedHeatmapSaveConfig(config);
  var status = document.getElementById('combinedHeatmapStatus');
  if (status) { status.textContent = __combinedHeatmapCopy.updatePreview + '…'; }
  vscode.postMessage({ command: 'previewCombinedHeatmap', title: config.title, range: config.range, intensityMode: config.intensityMode, palette: config.palette, customAccent: config.customAccent });
}
function exportCombinedHeatmap() {
  var config = combinedHeatmapReadConfig();
  combinedHeatmapSaveConfig(config);
  vscode.postMessage({ command: 'exportCombinedHeatmap', title: config.title, range: config.range, intensityMode: config.intensityMode, palette: config.palette, customAccent: config.customAccent });
}
function copyCombinedHeatmapMarkdown() {
  var config = combinedHeatmapReadConfig();
  combinedHeatmapSaveConfig(config);
  vscode.postMessage({ command: 'copyCombinedHeatmapMarkdown', title: config.title, range: config.range, intensityMode: config.intensityMode, palette: config.palette, customAccent: config.customAccent });
}
function resetCombinedHeatmapPreferences() {
  __ccuDirectSharingResetPending = true;
  var status = document.getElementById('combinedHeatmapStatus');
  if (status) { status.textContent = __combinedHeatmapCopy.resetSharing + '…'; }
  runLocalDataAction('reset-sharing-preferences');
}
function refresh() {
  vscode.postMessage({ command: 'refresh' });
}

function openSettings() {
  vscode.postMessage({ command: 'openSettings' });
}

function refreshPricing() {
  vscode.postMessage({ command: 'refreshPricing' });
}

function getAdvice() {
  vscode.postMessage({ command: 'getAdvice' });
}

function setSetting(key, value, type) {
  if (type === 'number') {
    var n = Number(value);
    if (!isFinite(n)) { return; }
    value = n;
  }
  vscode.postMessage({ command: 'updateSetting', key: key, value: value });
}

function setQuotaFormatPreset(select) {
  var input = document.getElementById('set_statusBarQuotaFormat');
  var custom = document.getElementById('set_statusBarQuotaFormat_custom');
  if (!input || !custom) { return; }
  var isCustom = select.value === 'custom';
  custom.hidden = !isCustom;
  if (isCustom) {
    if (!input.value) { input.value = select.dataset.defaultTemplate || ''; }
    setSetting('statusBarQuotaFormat', input.value, 'string');
    input.focus();
  } else {
    setSetting('statusBarQuotaFormat', select.value, 'string');
  }
}

function setQuotaFormatCustom(input) {
  var preset = document.getElementById('set_statusBarQuotaFormat_preset');
  // Leaving the input can fire its change event after a preset was selected.
  // Do not let a stale custom draft overwrite that deliberate choice.
  if (preset && preset.value === 'custom') {
    setSetting('statusBarQuotaFormat', input.value, 'string');
  }
}

function resetAllSettings(keys) {
  vscode.postMessage({ command: 'resetAllSettings', keys: Array.isArray(keys) ? keys : undefined });
}

var __ccuUiPreferenceKeys = [
  'ccu.activeTab',
  'ccu.sessionFilter',
  'ccu.sessionRange',
  'ccu.sessionModel'
];
var __ccuSharingPreferenceKeys = [
  'ccu.sharing.template',
  'ccu.sharing.shareCardDraft',
  'ccu.combinedHeatmap.title',
  'ccu.combinedHeatmap.range',
  'ccu.combinedHeatmap.intensityMode',
  'ccu.combinedHeatmap.privacyPreview',
  'ccu.combinedHeatmap.palette',
  'ccu.combinedHeatmap.customAccent'
];
function ccuCountPresentStorageKeys(storage, keys) {
  var count = 0;
  try {
    keys.forEach(function(key) {
      if (storage.getItem(key) !== null) { count += 1; }
    });
  } catch (e) {}
  return count;
}

function ccuCountPresentLocalStorageKeys(keys) {
  try { return ccuCountPresentStorageKeys(localStorage, keys); } catch (e) { return 0; }
}

function ccuLocalDataClientSummary() {
  var state = ccuReadUiState();
  return {
    uiPreferenceKeys: ccuCountPresentLocalStorageKeys(__ccuUiPreferenceKeys),
    webviewStateFields: state && typeof state === 'object' ? Object.keys(state).length : 0,
    sharingPreferenceKeys: ccuCountPresentLocalStorageKeys(__ccuSharingPreferenceKeys)
  };
}

function requestLocalDataInventory() {
  if (!document.getElementById('localDataInventoryBody')) { return; }
  vscode.postMessage({
    command: 'requestLocalDataInventory',
    clientSummary: ccuLocalDataClientSummary()
  });
}

function requestLocalDataInventoryForVisibleSettings() {
  var settings = document.getElementById('settings');
  if (settings && !settings.hidden && settings.classList.contains('active')) {
    requestLocalDataInventory();
  }
}

function runLocalDataAction(action) {
  var status = document.getElementById('localDataActionStatus');
  if (status) { status.textContent = '…'; }
  var scope = document.getElementById('localDataQuotaScope');
  vscode.postMessage({
    command: 'runLocalDataAction',
    action: action,
    quotaScopeToken: action === 'clear-quota-history' && scope ? scope.value : undefined
  });
}

function ccuResetStorageKeys(storage, keys) {
  try {
    keys.forEach(function(key) { storage.removeItem(key); });
    return keys.every(function(key) { return storage.getItem(key) === null; });
  } catch (e) {
    return false;
  }
}

function ccuResetLocalStorageKeys(keys) {
  try { return ccuResetStorageKeys(localStorage, keys); } catch (e) { return false; }
}

var __ccuDirectSharingResetPending = false;

function ccuApplyDefaultSharingControls() {
  var title = document.getElementById('combinedHeatmapTitle');
  var range = document.getElementById('combinedHeatmapRange');
  var intensityMode = document.getElementById('combinedHeatmapIntensityMode');
  var privacy = document.getElementById('combinedHeatmapPrivacy');
  var customAccent = document.getElementById('combinedHeatmapCustomAccent');
  if (title) { title.value = __combinedHeatmapCopy.defaultTitle; }
  if (range) { range.value = 'year'; }
  if (intensityMode) { intensityMode.value = 'quantile'; }
  if (privacy) { privacy.checked = true; }
  var defaultPalette = document.querySelector('input[name="combinedHeatmapPalette"][value="academicViolet"]');
  if (defaultPalette) { defaultPalette.checked = true; }
  if (customAccent) { customAccent.value = '#4f2f87'; }
  selectDefaultSharingTemplate();
  scApplyDefaultControls();
  toggleCombinedCustomAccent();
  toggleCombinedHeatmapPrivacy(false);
  vscode.postMessage({
    command: 'previewCombinedHeatmap',
    title: __combinedHeatmapCopy.defaultTitle,
    range: 'year',
    intensityMode: 'quantile',
    palette: 'academicViolet',
    customAccent: '#4f2f87'
  });
}

function ccuApplyLocalDataClientAction(action) {
  var ok = true;
  if (action === 'reset-ui-state' || action === 'clear-all-client-state') {
    ok = ccuResetLocalStorageKeys(__ccuUiPreferenceKeys) && ok;
    try {
      vscode.setState({});
      var state = vscode.getState();
      ok = (state === undefined || state === null || Object.keys(state).length === 0) && ok;
    } catch (e) {
      ok = false;
    }
  }
  if (action === 'reset-sharing-preferences' || action === 'clear-all-client-state') {
    var sharingStorageReset = ccuResetLocalStorageKeys(__ccuSharingPreferenceKeys);
    ok = sharingStorageReset && ok;
    if (sharingStorageReset) {
      ccuApplyDefaultSharingControls();
      var sharingMasterSwitch = document.getElementById('set_enableShareCard');
      if (sharingMasterSwitch && sharingMasterSwitch.type === 'checkbox') {
        // Host-side reset has already restored this sole visible switch to its
        // catalog default. Reflect that immediately without posting a new write.
        sharingMasterSwitch.checked = true;
      }
    }
  }
  return ok;
}

function ccuLocalDataFormatSizeCount(row) {
  var parts = [];
  if (typeof row.approximateBytes === 'number' && isFinite(row.approximateBytes)) {
    parts.push(new Intl.NumberFormat(__locale).format(row.approximateBytes) + ' ' + __localDataCopy.bytes);
  }
  if (typeof row.itemCount === 'number' && isFinite(row.itemCount)) {
    parts.push(new Intl.NumberFormat(__locale).format(row.itemCount) + ' ' + __localDataCopy.items);
  }
  return parts.length ? parts.join(' · ') : '—';
}

function ccuLocalDataFormatDate(value) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0) { return '—'; }
  try {
    return new Intl.DateTimeFormat(__locale, __dateOpts({
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })).format(new Date(value));
  } catch (e) { return '—'; }
}

function ccuRenderLocalDataInventory(inventory) {
  var body = document.getElementById('localDataInventoryBody');
  var exclusions = document.getElementById('localDataExclusions');
  var select = document.getElementById('localDataQuotaScope');
  if (!body || !inventory || inventory.schemaVersion !== 1 || !Array.isArray(inventory.rows)) { return false; }
  while (body.firstChild) { body.removeChild(body.firstChild); }
  inventory.rows.forEach(function(row) {
    var tr = document.createElement('tr');
    var values = [
      row.category,
      row.locationClass,
      row.schema,
      ccuLocalDataFormatSizeCount(row),
      ccuLocalDataFormatDate(row.oldestAt) + ' / ' + ccuLocalDataFormatDate(row.newestAt),
      row.networkInteraction,
      row.clearability
    ];
    values.forEach(function(value) {
      var td = document.createElement('td');
      td.textContent = typeof value === 'string' ? value : '—';
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  if (exclusions) {
    exclusions.textContent = __localDataCopy.sourceExclusions + ' ' +
      (Array.isArray(inventory.exclusions) ? inventory.exclusions.join(' · ') : '');
  }
  if (select) {
    while (select.firstChild) { select.removeChild(select.firstChild); }
    (Array.isArray(inventory.quotaScopes) ? inventory.quotaScopes : []).forEach(function(scope) {
      if (!scope || typeof scope.token !== 'string' || typeof scope.label !== 'string') { return; }
      var option = document.createElement('option');
      option.value = scope.token;
      option.textContent = scope.label;
      select.appendChild(option);
    });
  }
  return true;
}

function runOptimizer() {
  var ta = document.getElementById('optDraft');
  var btn = document.getElementById('optRunBtn');
  if (!ta || !ta.value.trim()) { return; }
  var err = document.getElementById('optError');
  var res = document.getElementById('optResult');
  var preview = document.getElementById('optPreview');
  if (err) { err.style.display = 'none'; }
  if (res) { res.style.display = 'none'; }
  if (preview) { preview.style.display = 'none'; preview.removeAttribute('data-snapshot-id'); }
  if (btn) {
    btn.disabled = true;
    btn.textContent = btn.getAttribute('data-running') || '…';
  }
  vscode.postMessage({
    command: 'optimizePrompt',
    draft: ta.value,
    resolve: !!(document.getElementById('optResolve') || {}).checked,
    distil: !!(document.getElementById('optDistil') || {}).checked,
    aesthetic: !!(document.getElementById('optAesthetic') || {}).checked,
  });
}

async function showOptimizerPreview(msg) {
  var validationGeneration = ++optimizerPreviewValidationGeneration;
  var btn = document.getElementById('optRunBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = btn.getAttribute('data-run') || __adviceCopy.previewPayload;
  }
  var err = document.getElementById('optError');
  var preview = document.getElementById('optPreview');
  var body = document.getElementById('optPreviewBody');
  var digest = document.getElementById('optPreviewDigest');
  var bytes = document.getElementById('optPreviewBytes');
  var send = document.getElementById('optSendBtn');
  if (preview) { preview.style.display = 'none'; preview.removeAttribute('data-snapshot-id'); }
  if (send) { send.disabled = true; send.textContent = __adviceCopy.sendPreparedRequest; }
  if (!msg.ok) {
    if (err && msg.error) { err.textContent = msg.error; err.style.display = ''; }
    return;
  }
  var valid =
    msg.ok === true &&
    /^optimizer-[a-f0-9]{24}$/.test(msg.snapshotId || '') &&
    typeof msg.body === 'string' &&
    typeof msg.sha256 === 'string' && /^[a-f0-9]{64}$/.test(msg.sha256) &&
    Number.isInteger(msg.utf8Bytes) && msg.utf8Bytes >= 0 &&
    msg.contentType === 'application/json' &&
    msg.dataMode === 'user-draft-only';
  if (valid) {
    valid = await ccuVerifyCanonicalPreview(msg.body, msg.sha256, msg.utf8Bytes);
  }
  if (validationGeneration !== optimizerPreviewValidationGeneration) { return; }
  if (!preview || !valid) {
    if (preview) { preview.style.display = 'none'; preview.removeAttribute('data-snapshot-id'); }
    if (send) { send.disabled = true; send.textContent = __adviceCopy.sendPreparedRequest; }
    if (err) {
      err.textContent = __adviceCopy.strictOutputRejected;
      err.style.display = '';
    }
    return;
  }
  if (err) { err.style.display = 'none'; }
  preview.setAttribute('data-snapshot-id', msg.snapshotId);
  preview.style.display = '';
  preview.open = true;
  if (body) { body.textContent = msg.body; }
  if (digest) { digest.textContent = 'SHA-256 ' + msg.sha256; }
  if (bytes) { bytes.textContent = __adviceCopy.payloadBytes.replace('{bytes}', String(msg.utf8Bytes)); }
  if (send) { send.disabled = false; send.textContent = __adviceCopy.sendPreparedRequest; }
}

function sendOptimizer() {
  var preview = document.getElementById('optPreview');
  var send = document.getElementById('optSendBtn');
  var draft = document.getElementById('optDraft');
  var snapshotId = preview ? preview.getAttribute('data-snapshot-id') : '';
  if (!draft || !/^optimizer-[a-f0-9]{24}$/.test(snapshotId || '')) { return; }
  if (send) { send.disabled = true; send.textContent = __adviceCopy.sendingPreparedRequest; }
  vscode.postMessage({
    command: 'sendOptimizerRequest',
    snapshotId: snapshotId,
    draft: draft.value,
  });
}

function showOptimizeResult(msg) {
  var btn = document.getElementById('optRunBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = btn.getAttribute('data-run') || 'Optimize';
  }
  var err = document.getElementById('optError');
  var res = document.getElementById('optResult');
  var preview = document.getElementById('optPreview');
  if (preview) { preview.style.display = 'none'; preview.removeAttribute('data-snapshot-id'); }
  if (msg.error) {
    if (err) { err.textContent = msg.error; err.style.display = ''; }
    return;
  }
  var validFeedbackTarget =
    typeof msg.adviceId === 'string' && /^advice-optimizer-[a-f0-9]{24}$/.test(msg.adviceId) &&
    msg.recommendationId === 'recommendation-optimizer-result-v1';
  if (!validFeedbackTarget) {
    if (err) {
      err.textContent = __adviceCopy.strictOutputRejected;
      err.style.display = '';
    }
    return;
  }
  var promptEl = document.getElementById('optPrompt');
  var settingsEl = document.getElementById('optSettings');
  if (promptEl) { promptEl.textContent = msg.prompt || ''; }
  if (settingsEl) {
    settingsEl.setAttribute('data-raw', msg.settings || '');
    formatOptSettings();
  }
  if (res) { res.style.display = ''; }
  var feedback = document.getElementById('optFeedback');
  if (feedback) {
    feedback.querySelectorAll('[data-advice-action="feedback"]').forEach(function(button) {
      button.setAttribute('data-advice-id', msg.adviceId);
      button.disabled = false;
      button.setAttribute('aria-pressed', 'false');
      button.classList.remove('is-selected');
      var marker = button.querySelector('[aria-hidden="true"]');
      if (marker) { marker.textContent = '○'; }
    });
    var feedbackStatus = feedback.querySelector('[data-advice-feedback-status]');
    if (feedbackStatus) { feedbackStatus.textContent = ''; }
    feedback.style.display = '';
  }
}

function copyOptPrompt(btn) {
  var promptEl = document.getElementById('optPrompt');
  if (!promptEl) { return; }
  var text = promptEl.textContent || '';
  var lbl = btn ? btn.querySelector('.opt-copy-lbl') : null;
  var done = function() {
    if (!btn) { return; }
    btn.classList.add('copied');
    if (lbl) { lbl.textContent = btn.getAttribute('data-copied') || 'Copied'; }
    setTimeout(function() {
      btn.classList.remove('copied');
      if (lbl) { lbl.textContent = btn.getAttribute('data-copy') || 'Copy'; }
    }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, done);
  } else {
    promptEl.focus();
    done();
  }
}

// Render the optimiser's "Recommended run settings" with the key value of each
// line (high / on / opus …) highlighted as a chip. Parses "Label: value — reason"
// from the raw text stashed in data-raw (so re-runs don't double-format).
function optEscHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatOptSettings() {
  var el = document.getElementById('optSettings');
  if (!el) { return; }
  var raw = el.getAttribute('data-raw');
  if (raw === null) { raw = el.textContent || ''; el.setAttribute('data-raw', raw); }
  var lines = raw.split('\\n').filter(function(l) { return l.trim() !== ''; });
  if (!lines.length) { el.innerHTML = ''; return; }
  el.innerHTML = lines.map(function(line) {
    var clean = line.replace(/^[\\s\\-*•]+/, '');
    var m = clean.match(/^([^:：]{1,28})[:：]\\s*([^\\s—()（]+)\\s*[—-]?\\s*(.*)$/);
    if (m) {
      var rest = m[3] && m[3].trim() ? '<span class="opt-set-rest">' + optEscHtml(m[3].trim()) + '</span>' : '';
      return '<div class="opt-set-row"><span class="opt-set-key">' + optEscHtml(m[1].trim()) +
        '</span><span class="opt-set-val">' + optEscHtml(m[2].trim()) + '</span>' + rest + '</div>';
    }
    return '<div class="opt-set-row">' + optEscHtml(clean) + '</div>';
  }).join('');
}

function dismissQuotaWarn() {
  vscode.postMessage({ command: 'dismissQuotaWarn' });
}

// Session row actions.
function copySession(btn) {
  if (!btn) { return; }
  var id = btn.getAttribute('data-session-id') || '';
  if (!id) { return; }
  var orig = btn.textContent;
  var done = function() {
    btn.classList.add('copied');
    btn.textContent = '✓';
    setTimeout(function() { btn.classList.remove('copied'); btn.textContent = orig; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(done, done);
  } else {
    done();
  }
}

function resumeSession(btn) {
  if (!btn) { return; }
  var id = btn.getAttribute('data-session-id') || '';
  if (!id) { return; }
  vscode.postMessage({
    command: 'resumeSession',
    sessionId: id,
    cwd: btn.getAttribute('data-cwd') || ''
  });
}

function deleteSession(btn) {
  if (!btn) { return; }
  var id = btn.getAttribute('data-session-id') || '';
  if (!id) { return; }
  // The host shows a modal confirm before anything is removed.
  vscode.postMessage({
    command: 'deleteSession',
    sessionId: id,
    title: btn.getAttribute('data-title') || ''
  });
}

function viewConversation(btn) {
  if (!btn) { return; }
  var id = btn.getAttribute('data-session-id') || '';
  if (!id) { return; }
  // Host reads the .jsonl, parses it, and opens a read-only viewer panel.
  vscode.postMessage({
    command: 'viewConversation',
    sessionId: id,
    title: btn.getAttribute('data-title') || ''
  });
}

function ccuSessState() {
  var pb = document.querySelector('.sess-filter[data-group="project"] .sess-filter-btn.active');
  var rb = document.querySelector('.sess-filter[data-group="range"] .sess-filter-btn.active');
  var ms = document.querySelector('.sess-model-select');
  return {
    project: pb ? pb.getAttribute('data-mode') : 'all',
    range: rb ? rb.getAttribute('data-range') : 'all',
    model: ms ? ms.value : 'all'
  };
}
function toggleSessionDetails(btn) {
  if (!btn) { return; }
  var row = btn.closest('tr');
  var detail = row ? row.nextElementSibling : null;
  if (!detail || !detail.hasAttribute('data-session-detail')) { return; }
  var expanded = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
  btn.textContent = expanded ? '▶' : '▼';
  detail.setAttribute('data-expanded', expanded ? 'false' : 'true');
  detail.style.display = expanded ? 'none' : 'table-row';
  saveSessionDetails();
}
function saveSessionDetails() {
  var all = ccuReadUiState().sessionDetails || {};
  all[ccuProviderName()] = Array.prototype.slice.call(document.querySelectorAll('[data-session-detail][data-expanded="true"]'))
    .map(function(row) { return row.id; }).filter(Boolean);
  ccuWriteUiState('sessionDetails', all);
}
function restoreSessionDetails() {
  var all = ccuReadUiState().sessionDetails || {};
  var open = all[ccuProviderName()] || [];
  open.forEach(function(id) {
    var detail = document.getElementById(id);
    var btn = document.querySelector('[data-session-detail-toggle][aria-controls="' + id + '"]');
    var row = btn ? btn.closest('tr') : null;
    if (!detail || !btn) { return; }
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = '▼';
    detail.setAttribute('data-expanded', 'true');
    detail.style.display = row && row.style.display === 'none' ? 'none' : 'table-row';
  });
}
function applySessionFilters() {
  var list = document.getElementById('sessionList');
  if (!list) { return; }
  var st = ccuSessState();
  var dayCount = st.range === 'today' ? 1 : st.range === '7' ? 7 : st.range === '30' ? 30 : 0;
  var allowedDays = dayCount > 0 ? ccuRollingDaySet(dayCount) : null;
  list.querySelectorAll('tr.sort-row').forEach(function(tr) {
    var okProject = st.project === 'all' || !tr.classList.contains('session-foreign');
    var rowDay = tr.getAttribute('data-day-key') || ccuDayKey(Number(tr.getAttribute('data-sort-time')));
    var okTime = !allowedDays || allowedDays.has(rowDay);
    var okModel = st.model === 'all' || (tr.getAttribute('data-models') || '').split('|').indexOf(st.model) !== -1;
    var visible = okProject && okTime && okModel;
    tr.style.display = visible ? '' : 'none';
    var detail = tr.nextElementSibling;
    if (detail && detail.hasAttribute('data-session-detail')) {
      detail.style.display = visible && detail.getAttribute('data-expanded') === 'true' ? 'table-row' : 'none';
    }
  });
}
// One handler per filter group; all persist and re-apply the combined filter.
function ccuSetActive(btn) {
  var group = btn.parentNode;
  if (!group) { return; }
  group.querySelectorAll('.sess-filter-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
}
function sessionFilter(btn) {
  if (!btn) { return; }
  ccuSetActive(btn);
  try { localStorage.setItem('ccu.sessionFilter', btn.getAttribute('data-mode')); } catch (e) {}
  applySessionFilters();
}
function sessionRange(btn) {
  if (!btn) { return; }
  ccuSetActive(btn);
  try { localStorage.setItem('ccu.sessionRange', btn.getAttribute('data-range')); } catch (e) {}
  applySessionFilters();
}
function sessionModel(sel) {
  if (!sel) { return; }
  try { localStorage.setItem('ccu.sessionModel', sel.value); } catch (e) {}
  applySessionFilters();
}
function restoreSessionFilter() {
  // Restore each dimension from localStorage (survives the post-delete reload),
  // then apply once. Defaults (nothing stored) = All range, All projects, All models.
  try {
    var mode = localStorage.getItem('ccu.sessionFilter');
    if (mode) {
      var pb = document.querySelector('.sess-filter[data-group="project"] .sess-filter-btn[data-mode="' + mode + '"]');
      if (pb) { ccuSetActive(pb); }
    }
    var range = localStorage.getItem('ccu.sessionRange');
    if (range) {
      var rb = document.querySelector('.sess-filter[data-group="range"] .sess-filter-btn[data-range="' + range + '"]');
      if (rb) { ccuSetActive(rb); }
    }
    var model = localStorage.getItem('ccu.sessionModel');
    if (model) {
      var ms = document.querySelector('.sess-model-select');
      if (ms) {
        for (var i = 0; i < ms.options.length; i++) {
          if (ms.options[i].value === model) { ms.value = model; break; }
        }
      }
    }
  } catch (e) {}
  applySessionFilters();
}

function copyPath(btn, e) {
  if (e) { e.stopPropagation(); }
  if (!btn) { return; }
  var p = btn.getAttribute('data-path') || '';
  if (!p) { return; }
  var orig = btn.textContent;
  var done = function() {
    btn.classList.add('copied');
    btn.textContent = '✓';
    setTimeout(function() { btn.classList.remove('copied'); btn.textContent = orig; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(p).then(done, done);
  } else { done(); }
}

function attrSetScope(kind) {
  document.querySelectorAll('.attr-tab').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-kind') === kind);
  });
  var sessSel = document.getElementById('attrTargetSession');
  var projSel = document.getElementById('attrTargetProject');
  if (sessSel) { sessSel.style.display = kind === 'session' ? '' : 'none'; }
  if (projSel) { projSel.style.display = kind === 'project' ? '' : 'none'; }
  requestAttribution();
}

function requestAttribution() {
  var active = document.querySelector('.attr-tab.active');
  if (!active) { return; }
  var kind = active.getAttribute('data-kind');
  var scope = { kind: kind };
  if (kind === 'session') {
    var sessSel = document.getElementById('attrTargetSession');
    if (!sessSel || !sessSel.value) { return; }
    scope.sessionId = sessSel.value;
  } else if (kind === 'project') {
    var projSel = document.getElementById('attrTargetProject');
    if (!projSel || !projSel.value) { return; }
    scope.projectPath = projSel.value;
  }
  vscode.postMessage({ command: 'getAttribution', scope: scope });
}

function toggleProjectGroup(groupId) {
  var groupRow = document.querySelector('.project-group-row[data-group="' + groupId + '"]');
  var childRows = document.querySelectorAll('.project-child-row[data-group="' + groupId + '"]');
  var toggle = groupRow ? groupRow.querySelector('.group-toggle') : null;
  var expanded = toggle && toggle.classList.contains('expanded');
  childRows.forEach(function(r) {
    r.style.display = expanded ? 'none' : 'table-row';
  });
  if (toggle) {
    toggle.classList.toggle('expanded');
    toggle.textContent = expanded ? '▶' : '▼';
  }
}

// Sort a table by a column key. Rows with class "sort-child" travel with the
// preceding "sort-row" (used for expandable project groups).
function sortTable(table, key, th, restoring) {
  var tbody = table.querySelector('tbody');
  if (!tbody) { return; }
  var allRows = Array.prototype.slice.call(tbody.children);

  var units = [];
  var current = null;
  allRows.forEach(function(row) {
    if ((row.classList.contains('sort-child') || row.hasAttribute('data-sort-child')) && current) {
      current.rows.push(row);
    } else {
      current = { lead: row, rows: [row] };
      units.push(current);
    }
  });

  // First click on a column sorts descending; clicking again flips direction.
  var ascending = th.getAttribute('data-sortdir') === 'desc';

  table.querySelectorAll('th.sortable').forEach(function(h) {
    h.removeAttribute('data-sortdir');
    h.classList.remove('sorted-asc', 'sorted-desc');
    h.setAttribute('aria-sort', 'none');
  });
  th.setAttribute('data-sortdir', ascending ? 'asc' : 'desc');
  th.classList.add(ascending ? 'sorted-asc' : 'sorted-desc');
  th.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');

  units.sort(function(a, b) {
    var va = a.lead.getAttribute('data-sort-' + key);
    var vb = b.lead.getAttribute('data-sort-' + key);
    if (va === null) { va = ''; }
    if (vb === null) { vb = ''; }
    var na = parseFloat(va);
    var nb = parseFloat(vb);
    var cmp;
    if (va !== '' && vb !== '' && !isNaN(na) && !isNaN(nb)) {
      cmp = na - nb;
    } else {
      cmp = String(va).localeCompare(String(vb));
    }
    return ascending ? cmp : -cmp;
  });

  units.forEach(function(u) {
    u.rows.forEach(function(r) { tbody.appendChild(r); });
  });

  if (!restoring) {
    var sorts = ccuReadUiState().tableSorts || {};
    sorts[ccuElementStateKey(table, 'table')] = { key: key, direction: ascending ? 'asc' : 'desc' };
    ccuWriteUiState('tableSorts', sorts);
  }
}
function initializeSortableHeaders(root) {
  var scope = root || document;
  scope.querySelectorAll('th.sortable').forEach(function(header) {
    header.setAttribute('tabindex', '0');
    if (!header.hasAttribute('aria-sort')) { header.setAttribute('aria-sort', 'none'); }
  });
}
function restoreTableSorts(root) {
  var scope = root || document;
  initializeSortableHeaders(scope);
  var sorts = ccuReadUiState().tableSorts || {};
  scope.querySelectorAll('table').forEach(function(table) {
    var saved = sorts[ccuElementStateKey(table, 'table')];
    if (!saved) { return; }
    var th = table.querySelector('th.sortable[data-sortkey="' + saved.key + '"]');
    if (!th) { return; }
    th.setAttribute('data-sortdir', saved.direction === 'asc' ? 'desc' : 'asc');
    sortTable(table, saved.key, th, true);
  });
}

function showTab(tabName, restoring) {
  try {
    // Keep the visual state and the WAI-ARIA tab contract in lockstep.
    document.querySelectorAll('.tabs [role="tab"]').forEach(function(tab) {
      tab.classList.remove('active');
      tab.setAttribute('aria-selected', 'false');
      tab.setAttribute('tabindex', '-1');
    });
    document.querySelectorAll('.tab-content[role="tabpanel"]').forEach(function(content) {
      content.classList.remove('active');
      content.hidden = true;
    });

    // Add active to selected tab and content
    const selectedTab = document.getElementById('tab-' + tabName);
    const selectedContent = document.getElementById(tabName);

    if (selectedTab && selectedContent) {
      selectedTab.classList.add('active');
      selectedTab.setAttribute('aria-selected', 'true');
      selectedTab.setAttribute('tabindex', '0');
      selectedContent.classList.add('active');
      selectedContent.hidden = false;

      if (!restoring) {
        vscode.postMessage({ command: 'tabChanged', tab: tabName });
        // Switching tabs resets expanded rows to their default (Carl's rule).
        clearPersistedDetails();
        // Persist in localStorage too — survives the reload, restored before paint.
        try { localStorage.setItem('ccu.activeTab', tabName); } catch (e) {}
        if (tabName === 'settings') { requestLocalDataInventory(); }
      }
    } else {
      console.error("Tab or content not found:", tabName);
    }
  } catch (error) {
    console.error("Error switching tabs:", error);
  }
}

// The dashboard views use the same roving-tabindex keyboard contract as the
// provider selector. A single-line scroll strip keeps the focused destination
// visible at narrow widths without turning translated labels vertical.
document.addEventListener('keydown', function(event) {
  var tab = event.target && event.target.closest
    ? event.target.closest('.tabs [role="tab"][data-dashboard-tab]')
    : null;
  if (!tab || ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) === -1) { return; }
  var tablist = tab.closest('.tabs[role="tablist"]');
  if (!tablist) { return; }
  var items = Array.prototype.slice.call(
    tablist.querySelectorAll('[role="tab"][data-dashboard-tab]'),
  );
  var index = items.indexOf(tab);
  if (index === -1 || items.length === 0) { return; }
  if (event.key === 'Home') { index = 0; }
  else if (event.key === 'End') { index = items.length - 1; }
  else { index = (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length; }
  event.preventDefault();
  var next = items[index];
  next.focus();
  if (next.scrollIntoView) { next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  showTab(next.getAttribute('data-dashboard-tab'));
});

function claudeDrilldownStateKey(detailRow, kind) {
  const tab = detailRow && detailRow.closest ? detailRow.closest('.tab-content') : null;
  return ccuProviderName() + ':' + (tab ? tab.id : kind) + ':' + kind;
}

function persistClaudeDrilldown(detailRow, kind, date) {
  if (!detailRow) { return; }
  const details = ccuReadUiState().claudeDrilldownDetails || {};
  const key = claudeDrilldownStateKey(detailRow, kind);
  if (date) { details[key] = date; } else { delete details[key]; }
  ccuWriteUiState('claudeDrilldownDetails', details);
}

function restoreClaudeDrilldownDetails() {
  try {
    const saved = ccuReadUiState().claudeDrilldownDetails || {};
    document.querySelectorAll('.hourly-detail-row:not([data-codex-hourly-detail-row])').forEach(function(row) {
      const date = row.getAttribute('data-date');
      if (date && saved[claudeDrilldownStateKey(row, 'hourly')] === date) {
        toggleHourlyDetail(date, true);
      }
    });
    document.querySelectorAll('.monthly-detail-row').forEach(function(row) {
      const date = row.getAttribute('data-date');
      if (date && saved[claudeDrilldownStateKey(row, 'monthly')] === date) {
        toggleMonthlyDetail(date, true);
      }
    });
    restoreClaudeAllTimeHourlyDetails(document);
  } catch (e) {}
}

function restoreClaudeAllTimeHourlyDetails(root) {
  try {
    const scope = root || document;
    const saved = ccuReadUiState().claudeDrilldownDetails || {};
    scope.querySelectorAll('[data-claude-alltime-hourly-detail-row]').forEach(function(row) {
      const date = row.getAttribute('data-date');
      if (date && saved[claudeDrilldownStateKey(row, 'hourly')] === date) {
        toggleClaudeAllTimeHourlyDetail(date, row, true);
      }
    });
  } catch (e) {}
}

function installMaterializedClaudeHourlyDetail(container, date) {
  if (!container || !Object.prototype.hasOwnProperty.call(__claudeLast30HoursByDay, date)) {
    return false;
  }
  container.innerHTML = renderHourlyData(__claudeLast30HoursByDay[date], date);
  container.dataset.loaded = 'true';
  bindChartTabEvents(container);
  restoreChartMetrics(container);
  initializeChartDrilldowns(container);
  initializeStatusRegions(container);
  return true;
}

function toggleHourlyDetail(date, restoring) {
  try {
    const detailRow = document.querySelector('.hourly-detail-row[data-date="' + date + '"]');
    const button = document.querySelector('.daily-row[data-date="' + date + '"] .detail-button');
    const container = document.getElementById('hourly-detail-' + date);
    const chartBar = document.querySelector(
      '.tab-content.active .hc-col[data-date="' + date + '"] .chart-bar.clickable, ' +
      '.tab-content.active .chart-bar-container[data-date="' + date + '"] .chart-bar.clickable',
    );

    if (detailRow && button && container) {
      const isExpanded = detailRow.style.display !== 'none' && detailRow.style.display !== '';

      if (!isExpanded) {
        // First, close all other expanded details
        closeAllHourlyDetails();

        // Show detail for this date
        detailRow.style.display = 'table-row';
        button.classList.add('expanded');
        setChartDrilldownExpanded('hourly-detail-' + date, true);

        // Update chart bar selection state
        if (chartBar) {
          chartBar.classList.add('selected');
        }
        persistClaudeDrilldown(detailRow, 'hourly', date);

        // Materialize from the bounded rolling-hour DTO already embedded in
        // this Webview. Expanding a day must never ask the host to regroup all
        // loaded Claude records or touch JSONL.
        if (!container.dataset.loaded) {
          installMaterializedClaudeHourlyDetail(container, date);
        }

        // Scroll the newly-revealed detail into view — clicking a bar at the
        // top of the tab otherwise expands a detail far down the table that
        // the user never notices.
        if (!restoring) {
          try { detailRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        }
      } else {
        // Hide detail
        detailRow.style.display = 'none';
        button.classList.remove('expanded');
        setChartDrilldownExpanded('hourly-detail-' + date, false);

        // Update chart bar selection state
        if (chartBar) {
          chartBar.classList.remove('selected');
        }
        persistClaudeDrilldown(detailRow, 'hourly', '');
      }

    } else {
      console.error("Could not find required elements for date:", date);
    }
  } catch (error) {
    console.error("Error in toggleHourlyDetail:", error);
  }
}

function claudeAllTimeHourlyElements(date, source) {
  const sourceScope = source && source.closest
    ? source.closest('[data-claude-alltime-daily]')
    : null;
  const searchScope = sourceScope || document.querySelector('#all [data-claude-alltime-daily]');
  if (!searchScope) { return {}; }
  const detailRow = searchScope.querySelector(
    '[data-claude-alltime-hourly-detail-row][data-date="' + date + '"]',
  );
  return {
    detailRow: detailRow,
    button: searchScope.querySelector(
      '[data-claude-alltime-hourly-toggle][data-date="' + date + '"]',
    ),
    container: detailRow
      ? detailRow.querySelector('.hourly-detail-container[id]')
      : null,
    chartBar: searchScope.querySelector(
      '.hc-col[data-date="' + date + '"] .chart-bar.clickable',
    ),
  };
}

function toggleClaudeAllTimeHourlyDetail(date, source, restoring) {
  try {
    const elements = claudeAllTimeHourlyElements(date, source);
    const detailRow = elements.detailRow;
    const button = elements.button;
    const container = elements.container;
    const chartBar = elements.chartBar;
    if (!detailRow || !button || !container) { return; }
    const isExpanded = detailRow.style.display !== 'none' && detailRow.style.display !== '';
    if (!isExpanded) {
      closeAllHourlyDetails();
      detailRow.style.display = 'table-row';
      button.classList.add('expanded');
      setChartDrilldownExpanded('claude-alltime-hourly-detail-' + date, true);
      if (chartBar) { chartBar.classList.add('selected'); }
      persistClaudeDrilldown(detailRow, 'hourly', date);
      if (!container.dataset.loaded) {
        installMaterializedClaudeHourlyDetail(container, date);
      }
      if (!restoring) {
        try { detailRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      }
    } else {
      detailRow.style.display = 'none';
      button.classList.remove('expanded');
      setChartDrilldownExpanded('claude-alltime-hourly-detail-' + date, false);
      if (chartBar) { chartBar.classList.remove('selected'); }
      persistClaudeDrilldown(detailRow, 'hourly', '');
    }
  } catch (error) {
    console.error('Error in toggleClaudeAllTimeHourlyDetail:', error);
  }
}

function codexHourlyDetailElements(date, source) {
  const sourceScope = source && source.closest
    ? source.closest('[data-codex-alltime-daily], [data-codex-last30-daily]')
    : null;
  const activeTab = document.querySelector('.tab-content.active');
  const searchScope = sourceScope || activeTab || document;
  const detailRow = searchScope.querySelector(
    '[data-codex-hourly-detail-row][data-date="' + date + '"]',
  );
  const scope = sourceScope || (detailRow && detailRow.closest
    ? detailRow.closest('[data-codex-alltime-daily], [data-codex-last30-daily], .tab-content')
    : searchScope);
  const container = detailRow
    ? detailRow.querySelector('.hourly-detail-container[id]')
    : null;
  return {
    detailRow: detailRow,
    button: scope ? scope.querySelector('[data-codex-hourly-toggle][data-date="' + date + '"]') : null,
    chartBar: scope ? scope.querySelector('.hc-col[data-date="' + date + '"] .chart-bar') : null,
    scope: scope,
    controls: container ? container.id : '',
  };
}

function codexHourlyDetailStateKey(detailRow) {
  const tab = detailRow && detailRow.closest ? detailRow.closest('.tab-content') : null;
  return 'codex:' + (tab ? tab.id : 'month');
}

function persistCodexHourlyDetail(detailRow, date) {
  if (!detailRow) { return; }
  const details = ccuReadUiState().codexHourlyDetails || {};
  const key = codexHourlyDetailStateKey(detailRow);
  if (date) { details[key] = date; } else { delete details[key]; }
  ccuWriteUiState('codexHourlyDetails', details);
}

function closeAllCodexHourlyDetails(scope) {
  const root = scope || document;
  root.querySelectorAll('[data-codex-hourly-detail-row]').forEach(function(row) {
    row.style.display = 'none';
  });
  root.querySelectorAll('[data-codex-hourly-toggle]').forEach(function(button) {
    button.classList.remove('expanded');
    button.setAttribute('aria-expanded', 'false');
  });
  root.querySelectorAll('.chart-bar.selected').forEach(function(bar) {
    bar.classList.remove('selected');
  });
  root.querySelectorAll(
    '[aria-controls^="codex-hourly-detail-"], [aria-controls^="codex-alltime-hourly-detail-"]',
  ).forEach(function(control) {
    control.setAttribute('aria-expanded', 'false');
  });
}

function setCodexHourlyDetail(date, expanded, restoring, source) {
  const elements = codexHourlyDetailElements(date, source);
  if (!elements.detailRow || !elements.button || !elements.controls) { return false; }
  if (expanded) {
    closeAllCodexHourlyDetails(elements.scope);
    elements.detailRow.style.display = 'table-row';
    elements.button.classList.add('expanded');
    elements.button.setAttribute('aria-expanded', 'true');
    setChartDrilldownExpanded(elements.controls, true);
    if (elements.chartBar) { elements.chartBar.classList.add('selected'); }
    persistCodexHourlyDetail(elements.detailRow, date);
    if (!restoring) {
      try { elements.detailRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    }
  } else {
    elements.detailRow.style.display = 'none';
    elements.button.classList.remove('expanded');
    elements.button.setAttribute('aria-expanded', 'false');
    setChartDrilldownExpanded(elements.controls, false);
    if (elements.chartBar) { elements.chartBar.classList.remove('selected'); }
    persistCodexHourlyDetail(elements.detailRow, '');
  }
  return true;
}

function toggleCodexHourlyDetail(date, source) {
  try {
    const elements = codexHourlyDetailElements(date, source);
    if (!elements.detailRow || !elements.button) { return; }
    setCodexHourlyDetail(
      date,
      elements.button.getAttribute('aria-expanded') !== 'true',
      false,
      source,
    );
  } catch (error) {
    console.error('Error in toggleCodexHourlyDetail:', error);
  }
}

function restoreCodexHourlyDetails() {
  try {
    const saved = ccuReadUiState().codexHourlyDetails || {};
    document.querySelectorAll('[data-codex-hourly-detail-row]').forEach(function(row) {
      const date = row.getAttribute('data-date');
      if (date && saved[codexHourlyDetailStateKey(row)] === date) {
        setCodexHourlyDetail(date, true, true, row);
      }
    });
  } catch (e) {}
}

function closeAllHourlyDetails() {
  // Close all expanded detail rows
  const allDetailRows = document.querySelectorAll('.hourly-detail-row');
  const allButtons = document.querySelectorAll('.detail-button.expanded');
  const allChartBars = document.querySelectorAll('.chart-bar.selected');

  allDetailRows.forEach(function(row) {
    row.style.display = 'none';
  });

  allButtons.forEach(function(btn) {
    btn.classList.remove('expanded');
    btn.setAttribute('aria-expanded', 'false');
  });

  allChartBars.forEach(function(bar) {
    bar.classList.remove('selected');
  });
  document.querySelectorAll('[aria-controls^="hourly-detail-"]').forEach(function(control) {
    control.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('[aria-controls^="claude-alltime-hourly-detail-"]').forEach(function(control) {
    control.setAttribute('aria-expanded', 'false');
  });

}

function toggleMonthlyDetail(monthDate, restoring) {
  try {
    const detailRow = document.querySelector('.monthly-detail-row[data-date="' + monthDate + '"]');
    const button = document.querySelector('.daily-row[data-date="' + monthDate + '"] .detail-button');
    const container = document.getElementById('monthly-detail-' + monthDate);
    const chartBar = document.querySelector(
      '.tab-content.active .hc-col[data-date="' + monthDate + '"] .chart-bar.clickable, ' +
      '.tab-content.active .chart-bar-container[data-date="' + monthDate + '"] .chart-bar.clickable',
    );

    if (detailRow && button && container) {
      const isExpanded = detailRow.style.display !== 'none' && detailRow.style.display !== '';

      if (!isExpanded) {
        // First, close all other expanded details
        closeAllMonthlyDetails();

        // Show detail for this month
        detailRow.style.display = 'table-row';
        button.classList.add('expanded');
        setChartDrilldownExpanded('monthly-detail-' + monthDate, true);

        // Update chart bar selection state
        if (chartBar) {
          chartBar.classList.add('selected');
        }
        persistClaudeDrilldown(detailRow, 'monthly', monthDate);

        // Request monthly data if not loaded
        if (!container.dataset.loaded) {
          vscode.postMessage({ command: 'getDailyData', month: monthDate, provider: ccuProviderName() });
          container.dataset.loaded = 'true';
        }

        // Scroll the newly-revealed detail into view (see toggleHourlyDetail).
        if (!restoring) {
          try { detailRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        }
      } else {
        // Hide detail
        detailRow.style.display = 'none';
        button.classList.remove('expanded');
        setChartDrilldownExpanded('monthly-detail-' + monthDate, false);

        // Update chart bar selection state
        if (chartBar) {
          chartBar.classList.remove('selected');
        }
        persistClaudeDrilldown(detailRow, 'monthly', '');
      }

    } else {
      console.error("Could not find required elements for month:", monthDate);
    }
  } catch (error) {
    console.error("Error in toggleMonthlyDetail:", error);
  }
}

function closeAllMonthlyDetails() {
  // Close all expanded monthly detail rows
  const allDetailRows = document.querySelectorAll('.monthly-detail-row');
  const allButtons = document.querySelectorAll('[aria-controls^="monthly-detail-"].detail-button.expanded');
  const allChartBars = document.querySelectorAll('[aria-controls^="monthly-detail-"].chart-bar.selected');

  allDetailRows.forEach(function(row) {
    row.style.display = 'none';
  });

  allButtons.forEach(function(btn) {
    btn.classList.remove('expanded');
    btn.setAttribute('aria-expanded', 'false');
  });

  allChartBars.forEach(function(bar) {
    bar.classList.remove('selected');
  });
  document.querySelectorAll('[aria-controls^="monthly-detail-"]').forEach(function(control) {
    control.setAttribute('aria-expanded', 'false');
  });

}

function updateHourlyChart(date, metric) {
  const container = document.getElementById('hourly-detail-' + date);
  if (!container) return;

  // Update active tab
  const tabs = container.querySelectorAll('.chart-tab');
  tabs.forEach(function(tab) {
    if (tab.dataset.metric === metric) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Re-render chart
  const chartContainer = document.getElementById('hourly-chart-' + date);
  const hourlyData = window['hourlyData_' + date];
  if (hourlyData && chartContainer) {
    chartContainer.innerHTML = renderHourlyChart(hourlyData, metric);
  }
}

// Sync chart bar selection state
function syncChartBarSelection(date, isSelected) {
  const chartBar = document.querySelector('.chart-bar-container[data-date="' + date + '"] .chart-bar');
  if (chartBar) {
    if (isSelected) {
      chartBar.classList.add('selected');
    } else {
      chartBar.classList.remove('selected');
    }
  }
}

// Make functions available globally
window.refresh = refresh;
window.openSettings = openSettings;
window.refreshPricing = refreshPricing;
window.getAdvice = getAdvice;
window.sendOptimizer = sendOptimizer;
window.toggleProjectGroup = toggleProjectGroup;
window.sortTable = sortTable;
window.dismissQuotaWarn = dismissQuotaWarn;
window.toggleSessionDetails = toggleSessionDetails;
window.attrSetScope = attrSetScope;
window.requestAttribution = requestAttribution;
window.showTab = showTab;
window.toggleHourlyDetail = toggleHourlyDetail;
window.toggleMonthlyDetail = toggleMonthlyDetail;
window.updateHourlyChart = updateHourlyChart;
window.syncChartBarSelection = syncChartBarSelection;
window.closeAllHourlyDetails = closeAllHourlyDetails;
window.closeAllMonthlyDetails = closeAllMonthlyDetails;

document.addEventListener('change', function(event) {
  var input = event.target && event.target.closest
    ? event.target.closest('[data-advice-consent-kind][data-provider]')
    : null;
  if (!input) { return; }
  var provider = input.getAttribute('data-provider');
  if (provider !== 'claude' && provider !== 'codex' && provider !== 'optimizer') { return; }
  var elements = adviceConsentElements(provider);
  if (!elements.aggregate || !elements.prompt) { return; }
  if (!elements.aggregate.checked) { elements.prompt.checked = false; }
  adviceSyncConsentControls(provider);
  adviceInvalidateAndClearPreview(provider);
  vscode.postMessage({ command: 'discardAdviceSnapshot', provider: provider });
  adviceSetConsentPending(provider, true);
  vscode.postMessage({
    command: 'updateAdviceConsent',
    provider: provider,
    aggregateConsent: elements.aggregate.checked ? 'explicit' : 'not-granted',
    promptSampleConsent: elements.prompt.checked ? 'explicit' : 'not-granted',
  });
});

document.addEventListener('input', function(event) {
  var target = event.target;
  if (!target || target.id !== 'optDraft') { return; }
  var preview = document.getElementById('optPreview');
  if (preview && preview.getAttribute('data-snapshot-id')) {
    preview.style.display = 'none';
    preview.removeAttribute('data-snapshot-id');
    vscode.postMessage({ command: 'discardOptimizerRequest' });
  }
});

document.addEventListener('click', function(event) {
  var action = event.target && event.target.closest
    ? event.target.closest('[data-advice-action][data-provider]')
    : null;
  if (!action) { return; }
  var provider = action.getAttribute('data-provider');
  if (provider !== 'claude' && provider !== 'codex' && provider !== 'optimizer') { return; }
  if (action.getAttribute('data-advice-action') === 'preview') {
    event.preventDefault();
    var elements = adviceConsentElements(provider);
    if (!elements.aggregate || !elements.prompt || !elements.aggregate.checked) { return; }
    adviceCancelPendingPreviewValidation(provider);
    action.disabled = true;
    if (elements.consentStatus) { elements.consentStatus.textContent = ''; }
    vscode.postMessage({
      command: 'prepareAdviceSnapshot',
      provider: provider,
      aggregateConsent: 'explicit',
      promptSampleConsent: elements.prompt.checked ? 'explicit' : 'not-granted',
    });
    return;
  }
  if (action.getAttribute('data-advice-action') === 'send') {
    event.preventDefault();
    var sendElements = adviceConsentElements(provider);
    var snapshotId = sendElements.preview
      ? sendElements.preview.getAttribute('data-snapshot-id')
      : null;
    if (!snapshotId || !/^snapshot-[a-f0-9]{24}$/.test(snapshotId)) { return; }
    action.disabled = true;
    action.textContent = __adviceCopy.sendingPreparedRequest;
    if (sendElements.consentStatus) {
      sendElements.consentStatus.textContent = __adviceCopy.sendingPreparedRequest;
    }
    vscode.postMessage({
      command: 'sendAdviceSnapshot',
      provider: provider,
      snapshotId: snapshotId,
    });
    return;
  }
  if (action.getAttribute('data-advice-action') === 'feedback') {
    event.preventDefault();
    var root = adviceRoot(provider);
    if (!root) { return; }
    var recommendationId = action.getAttribute('data-recommendation-id');
    root.querySelectorAll('[data-advice-action="feedback"]').forEach(function(button) {
      if (button.getAttribute('data-recommendation-id') !== recommendationId) { return; }
      button.disabled = true;
    });
    root.querySelectorAll('[data-advice-feedback-status]').forEach(function(status) {
      if (
        status.getAttribute('data-advice-id') === action.getAttribute('data-advice-id') &&
        status.getAttribute('data-recommendation-id') === recommendationId
      ) {
        status.textContent = '';
      }
    });
    vscode.postMessage({
      command: 'recordAdviceFeedback',
      provider: provider,
      adviceId: action.getAttribute('data-advice-id'),
      recommendationId: recommendationId,
      kind: action.getAttribute('data-feedback-kind'),
    });
    return;
  }
  if (action.getAttribute('data-advice-action') === 'snooze') {
    event.preventDefault();
    action.disabled = true;
    vscode.postMessage({
      command: 'snoozeAdvice',
      provider: provider,
      adviceId: action.getAttribute('data-advice-id'),
      recommendationId: action.getAttribute('data-recommendation-id'),
      mode: action.getAttribute('data-snooze-mode') === 'resume' ? 'resume' : 'snooze',
    });
    return;
  }
  if (action.getAttribute('data-advice-action') === 'clear') {
    event.preventDefault();
    if (!window.confirm(__adviceCopy.clearLocalDataConfirm)) { return; }
    action.disabled = true;
    adviceInvalidateAllPreviews();
    vscode.postMessage({ command: 'clearAdviceLocalData' });
  }
});

// Handle messages from extension
window.addEventListener('message', async function(event) {
  const message = event.data;

  if (message.command === 'advicePreviewsInvalidated') {
    adviceInvalidateAllPreviews();
    return;
  }

  if (message.command === 'dashboardDataPatch') {
    ccuQueueDashboardDataPatch(message);
    return;
  }

  if (
    message.command === 'codexIndexProgress' &&
    typeof message.text === 'string' &&
    message.text.length <= 1024
  ) {
    document.querySelectorAll('[data-codex-index-progress-text]').forEach(function(element) {
      element.textContent = message.text;
    });
  }

  if (message.command === 'requestLocalDataInventoryClient') {
    requestLocalDataInventory();
  }

  if (message.command === 'localDataClientAction') {
    var localDataClientActionOk = false;
    try {
      if (message.action === 'clear-all-client-state') {
        adviceInvalidateAllPreviews();
      }
      localDataClientActionOk = ccuApplyLocalDataClientAction(message.action) === true;
    } catch (e) {}
    if (typeof message.requestId === 'string' && message.requestId.length > 0) {
      vscode.postMessage({
        command: 'localDataClientActionAck',
        requestId: message.requestId,
        ok: localDataClientActionOk
      });
    }
    requestLocalDataInventory();
  }

  if (message.command === 'localDataInventoryResult') {
    var inventoryBody = document.getElementById('localDataInventoryBody');
    if (message.ok !== true || !ccuRenderLocalDataInventory(message.inventory)) {
      if (inventoryBody) {
        while (inventoryBody.firstChild) { inventoryBody.removeChild(inventoryBody.firstChild); }
        var unavailableRow = document.createElement('tr');
        var unavailableCell = document.createElement('td');
        unavailableCell.colSpan = 7;
        unavailableCell.className = 'table-hint';
        unavailableCell.textContent = __localDataCopy.unavailable;
        unavailableRow.appendChild(unavailableCell);
        inventoryBody.appendChild(unavailableRow);
      }
    }
  }

  if (message.command === 'localDataActionResult') {
    var localDataResult = message.result || {};
    var localDataStatus = document.getElementById('localDataActionStatus');
    if (localDataResult.clientAction) {
      ccuApplyLocalDataClientAction(localDataResult.clientAction);
    }
    if (localDataStatus) {
      localDataStatus.textContent = typeof localDataResult.message === 'string'
        ? localDataResult.message
        : __localDataCopy.unavailable;
    }
    if (__ccuDirectSharingResetPending) {
      var directSharingResetStatus = document.getElementById('combinedHeatmapStatus');
      if (directSharingResetStatus) {
        directSharingResetStatus.textContent = typeof localDataResult.message === 'string'
          ? localDataResult.message
          : (localDataResult.ok === true
            ? __combinedHeatmapCopy.resetComplete
            : __combinedHeatmapCopy.resetFailed);
      }
      __ccuDirectSharingResetPending = false;
    }
    requestLocalDataInventory();
  }

  if (message.command === 'adviceConsentResult') {
    var consentProvider = message.provider;
    var consentElements = adviceConsentElements(consentProvider);
    if (consentElements.aggregate && consentElements.prompt) {
      if (message.ok === true) {
        consentElements.aggregate.checked = message.aggregateConsent === 'explicit';
        consentElements.prompt.checked =
          consentElements.aggregate.checked && message.promptSampleConsent === 'explicit';
        if (!consentElements.aggregate.checked) {
          adviceInvalidateAndClearPreview(consentProvider);
        }
        adviceSetConsentPending(consentProvider, false);
        if (consentElements.consentStatus) { consentElements.consentStatus.textContent = ''; }
      } else {
        adviceInvalidateAndClearPreview(consentProvider);
        consentElements.aggregate.checked = false;
        consentElements.prompt.checked = false;
        consentElements.aggregate.disabled = true;
        consentElements.prompt.disabled = true;
        if (consentElements.previewButton) { consentElements.previewButton.disabled = true; }
        if (consentElements.consentStatus) {
          consentElements.consentStatus.textContent = __adviceCopy.feedbackSaveFailed;
        }
      }
    }
  }

  if (message.command === 'adviceSnapshotResult') {
    var snapshotProvider = message.provider;
    if (snapshotProvider !== 'claude' && snapshotProvider !== 'codex') { return; }
    var snapshotValidationGeneration = adviceCancelPendingPreviewValidation(snapshotProvider);
    var snapshotElements = adviceConsentElements(snapshotProvider);
    adviceClearPreview(snapshotProvider);
    var validSnapshot =
      message.ok === true &&
      typeof message.snapshotId === 'string' && /^snapshot-[a-f0-9]{24}$/.test(message.snapshotId) &&
      typeof message.body === 'string' &&
      typeof message.sha256 === 'string' && /^[a-f0-9]{64}$/.test(message.sha256) &&
      Number.isInteger(message.utf8Bytes) && message.utf8Bytes >= 0 &&
      Number.isInteger(message.promptSampleCount) && message.promptSampleCount >= 0 &&
      message.contentType === 'application/json' &&
      (message.dataMode === 'aggregates-only' ||
        message.dataMode === 'aggregates-with-personalization' ||
        message.dataMode === 'aggregates-with-prompt-samples');
    if (validSnapshot) {
      validSnapshot = await ccuVerifyCanonicalPreview(
        message.body,
        message.sha256,
        message.utf8Bytes,
      );
    }
    if (advicePreviewValidationGeneration[snapshotProvider] !== snapshotValidationGeneration) {
      return;
    }
    var currentSnapshotElements = adviceConsentElements(snapshotProvider);
    var currentConsentValid =
      currentSnapshotElements.root === snapshotElements.root &&
      currentSnapshotElements.preview === snapshotElements.preview &&
      currentSnapshotElements.aggregate &&
      !currentSnapshotElements.aggregate.disabled &&
      currentSnapshotElements.aggregate.checked &&
      (message.dataMode === 'aggregates-only' ||
        (currentSnapshotElements.prompt &&
          !currentSnapshotElements.prompt.disabled &&
          currentSnapshotElements.prompt.checked));
    if (!currentConsentValid) {
      adviceClearPreview(snapshotProvider);
      return;
    }
    if (!validSnapshot || !snapshotElements.preview) {
      if (snapshotElements.consentStatus) {
        snapshotElements.consentStatus.textContent = __adviceCopy.strictOutputRejected;
      }
    } else {
      var preview = snapshotElements.preview;
      var previewBody = preview.querySelector('[data-advice-preview-body]');
      var previewDigest = preview.querySelector('[data-advice-preview-digest]');
      var previewMode = preview.querySelector('[data-advice-preview-mode]');
      var previewContentType = preview.querySelector('[data-advice-preview-content-type]');
      var previewBytes = preview.querySelector('[data-advice-preview-bytes]');
      var previewCount = preview.querySelector('[data-advice-preview-count]');
      if (previewBody) { previewBody.textContent = message.body; }
      if (previewDigest) { previewDigest.textContent = 'SHA-256 ' + message.sha256; }
      if (previewContentType) { previewContentType.textContent = message.contentType; }
      if (previewMode) {
        previewMode.textContent = message.dataMode === 'aggregates-only'
          ? __adviceCopy.aggregatesOnly
          : message.dataMode === 'aggregates-with-personalization'
            ? __adviceCopy.aggregatesWithPersonalization
            : __adviceCopy.aggregatesWithPromptSamples;
      }
      if (previewBytes) {
        previewBytes.textContent = __adviceCopy.payloadBytes.replace('{bytes}', String(message.utf8Bytes));
      }
      if (previewCount) {
        previewCount.textContent = __adviceCopy.promptSamplesIncluded.replace(
          '{count}',
          String(message.promptSampleCount),
        );
      }
      preview.setAttribute('data-snapshot-id', message.snapshotId);
      preview.hidden = false;
      preview.open = true;
      if (snapshotElements.sendButton) {
        snapshotElements.sendButton.disabled = false;
        snapshotElements.sendButton.textContent = __adviceCopy.sendPreparedRequest;
      }
      if (snapshotElements.consentStatus) {
        snapshotElements.consentStatus.textContent = __adviceCopy.noNetworkTransport;
      }
    }
    adviceSyncConsentControls(snapshotProvider);
  }

  if (message.command === 'adviceSendResult') {
    var sendProvider = message.provider;
    var sendElements = adviceConsentElements(sendProvider);
    if (message.ok === true) {
      if (sendElements.consentStatus) {
        sendElements.consentStatus.textContent = __adviceCopy.sentPreparedRequest;
      }
      adviceInvalidateAndClearPreview(sendProvider);
    } else {
      if (sendElements.sendButton) {
        sendElements.sendButton.disabled = false;
        sendElements.sendButton.textContent = __adviceCopy.sendPreparedRequest;
      }
      if (sendElements.consentStatus) {
        sendElements.consentStatus.textContent = __adviceCopy.strictOutputRejected;
      }
    }
  }

  if (message.command === 'adviceFeedbackResult') {
    var feedbackProvider = message.provider;
    var feedbackRoot = adviceRoot(feedbackProvider);
    if (feedbackRoot) {
      var feedbackStatus = null;
      feedbackRoot.querySelectorAll('[data-advice-feedback-status]').forEach(function(status) {
        if (
          status.getAttribute('data-advice-id') === message.adviceId &&
          status.getAttribute('data-recommendation-id') === message.recommendationId
        ) {
          feedbackStatus = status;
        }
      });
      if (message.ok === true) {
        feedbackRoot.querySelectorAll('[data-advice-action="feedback"]').forEach(function(button) {
          if (
            button.getAttribute('data-advice-id') !== message.adviceId ||
            button.getAttribute('data-recommendation-id') !== message.recommendationId
          ) { return; }
          var kind = button.getAttribute('data-feedback-kind');
          var selected =
            (kind === 'helpful' && message.rating === 'helpful') ||
            (kind === 'not-helpful' && message.rating === 'not-helpful') ||
            (kind === 'applied' && message.applied === 'applied');
          button.disabled = false;
          button.setAttribute('aria-pressed', selected ? 'true' : 'false');
          button.classList.toggle('is-selected', selected);
          var marker = button.querySelector('[aria-hidden="true"]');
          if (marker) { marker.textContent = selected ? '✓' : '○'; }
        });
        if (feedbackStatus) { feedbackStatus.textContent = __adviceCopy.feedbackLocalOnly; }
      } else {
        feedbackRoot.querySelectorAll('[data-advice-action="feedback"]').forEach(function(button) {
          if (
            button.getAttribute('data-advice-id') === message.adviceId &&
            button.getAttribute('data-recommendation-id') === message.recommendationId
          ) {
            button.disabled = false;
          }
        });
        if (feedbackStatus) { feedbackStatus.textContent = __adviceCopy.feedbackSaveFailed; }
      }
    }
  }

  if (message.command === 'adviceSnoozeResult' && message.ok !== true) {
    document.querySelectorAll('[data-advice-action="snooze"]').forEach(function(button) {
      if (
        button.getAttribute('data-advice-id') === message.adviceId &&
        button.getAttribute('data-recommendation-id') === message.recommendationId
      ) {
        button.disabled = false;
      }
    });
  }

  if (message.command === 'adviceClearResult' && message.ok !== true) {
    document.querySelectorAll('[data-advice-action="clear"]').forEach(function(button) {
      button.disabled = false;
    });
  }
  if (message.command === 'adviceClearResult' && message.ok === true) {
    adviceInvalidateAllPreviews();
  }

  if (message.command === 'shareCardResult') {
    const prev = document.getElementById('scPreview');
    if (prev) {
      if (message.error) {
        var shareCardError = document.createElement('p');
        shareCardError.className = 'table-hint';
        shareCardError.textContent = __sharingWorkspaceCopy.cardBuildFailed + ' ' + String(message.error);
        prev.replaceChildren(shareCardError);
      } else {
        prev.innerHTML = message.svg || '';
      }
    }
  }

  if (message.command === 'combinedHeatmapResult') {
    var combinedPreview = document.getElementById('combinedHeatmapPreview');
    var combinedMarkdown = document.getElementById('combinedHeatmapMarkdown');
    var combinedStatus = document.getElementById('combinedHeatmapStatus');
    if (message.error) {
      if (combinedStatus) { combinedStatus.textContent = String(message.error); }
    } else {
      if (combinedPreview) {
        if (message.hasData) {
          combinedPreview.innerHTML = message.svg || '';
        } else {
          combinedPreview.textContent = __combinedHeatmapCopy.noData;
        }
      }
      if (combinedMarkdown) { combinedMarkdown.value = message.markdown || ''; }
      if (combinedStatus) { combinedStatus.textContent = ''; }
    }
  }

  if (message.command === 'combinedHeatmapMarkdownCopied') {
    var copyStatus = document.getElementById('combinedHeatmapStatus');
    if (copyStatus) {
      copyStatus.textContent = message.ok
        ? __combinedHeatmapCopy.copyMarkdown + ' ✓'
        : String(message.error || 'Could not copy Markdown.');
    }
  }

  if (message.command === 'dailyDataResponse') {
    const container = document.getElementById('monthly-detail-' + message.month);
    const responseProvider = message.provider === 'codex' ? 'codex' : 'claude';
    if (container && responseProvider === ccuProviderName() &&
        (Array.isArray(message.data) || typeof message.html === 'string')) {
      container.innerHTML = responseProvider === 'codex'
        ? message.html
        : renderDailyData(message.data, message.month);

      // Re-bind chart tab events after rendering
      bindChartTabEvents(container);
      restoreChartMetrics(container);
      initializeChartDrilldowns(container);
      restoreCodexHourlyDetails();
      restoreClaudeAllTimeHourlyDetails(container);
      initializeStatusRegions(container);
    }
  }

  if (message.command === 'attributionResponse') {
    const attrPanel = document.getElementById('attrPanel');
    if (attrPanel && typeof message.html === 'string') {
      attrPanel.innerHTML = message.html;
    }
  }

  if (message.command === 'optimizeResult') {
    showOptimizeResult(message);
  }
  if (message.command === 'optimizePreviewResult') {
    showOptimizerPreview(message);
  }
});

// Format any optimiser settings restored into the DOM by a re-render.
formatOptSettings();

function ccuChartStateKey(container) {
  var content = container.querySelector('.chart-content[id]');
  return ccuProviderName() + ':chart:' + (content ? content.id : ccuElementStateKey(container, 'chart'));
}
function saveChartMetric(container, metric) {
  var metrics = ccuReadUiState().chartMetrics || {};
  metrics[ccuChartStateKey(container)] = metric;
  ccuWriteUiState('chartMetrics', metrics);
}
function syncChartMetricState(container) {
  var heading = container.querySelector(':scope > h3, :scope > h4, :scope > .section-header h3');
  container.querySelectorAll(':scope > .chart-tabs').forEach(function(group) {
    group.setAttribute('role', 'group');
    if (heading && heading.textContent) { group.setAttribute('aria-label', heading.textContent.trim()); }
  });
  container.querySelectorAll('.chart-tab[data-metric]').forEach(function(item) {
    item.setAttribute('aria-pressed', item.classList.contains('active') ? 'true' : 'false');
  });
}
function applyChartMetric(container, metric, persist) {
  var tab = container.querySelector('.chart-tab[data-metric="' + metric + '"]');
  if (!tab) { return; }
  container.querySelectorAll('.chart-tab').forEach(function(item) {
    item.classList.remove('active');
    item.setAttribute('aria-pressed', 'false');
  });
  tab.classList.add('active');
  tab.setAttribute('aria-pressed', 'true');
  if (container.classList.contains('hourly-breakdown')) {
    var chartContent = container.querySelector('[id^="hourly-chart-"]');
    if (chartContent) { updateHourlyChart(chartContent.id.replace('hourly-chart-', ''), metric); }
  } else {
    updateMainChart(metric, container);
  }
  initializeHourlyOverviewSelections(container);
  refreshHourlyOverviewSelection(container);
  initializeChartRegions(container);
  if (persist) { saveChartMetric(container, metric); }
}
function restoreChartMetrics(root) {
  var scope = root || document;
  var containers = [];
  if (scope.matches && scope.matches('.daily-breakdown, .hourly-breakdown')) { containers.push(scope); }
  scope.querySelectorAll('.daily-breakdown, .hourly-breakdown').forEach(function(item) { containers.push(item); });
  var metrics = ccuReadUiState().chartMetrics || {};
  containers.forEach(function(container) {
    var metric = metrics[ccuChartStateKey(container)];
    if (metric) { applyChartMetric(container, metric, false); }
    else { syncChartMetricState(container); }
  });
  initializeChartRegions(scope);
}

function chartDrilldownInfo(element) {
  var holder = element && element.closest
    ? element.closest('[data-date]')
    : null;
  var date = holder ? holder.getAttribute('data-date') : '';
  if (!date) { return null; }
  var containingTab = element && element.closest ? element.closest('.tab-content') : null;
  var kind = element.closest('[data-codex-alltime-daily]')
    ? 'codex-alltime-hourly'
    : element.closest('[data-claude-alltime-daily]')
      ? 'claude-alltime-hourly'
    : containingTab && containingTab.id === 'all'
      ? 'monthly'
      : element.closest('[data-codex-last30-daily]')
        ? 'codex-hourly'
        : 'hourly';
  var prefix = kind === 'monthly'
    ? 'monthly-detail-'
    : kind === 'claude-alltime-hourly'
      ? 'claude-alltime-hourly-detail-'
    : kind === 'codex-alltime-hourly'
      ? 'codex-alltime-hourly-detail-'
      : kind === 'codex-hourly'
      ? 'codex-hourly-detail-'
      : 'hourly-detail-';
  return { date: date, kind: kind, controls: prefix + date };
}
function setChartDrilldownExpanded(controls, expanded) {
  document.querySelectorAll('[aria-controls="' + controls + '"]').forEach(function(control) {
    control.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  });
}
function activateChartDrilldown(element) {
  var info = chartDrilldownInfo(element);
  if (!info) { return; }
  if (info.kind === 'monthly') { toggleMonthlyDetail(info.date); }
  else if (info.kind === 'claude-alltime-hourly') {
    toggleClaudeAllTimeHourlyDetail(info.date, element);
  }
  else if (info.kind === 'codex-hourly' || info.kind === 'codex-alltime-hourly') {
    toggleCodexHourlyDetail(info.date, element);
  }
  else { toggleHourlyDetail(info.date); }
}
function initializeChartDrilldowns(root) {
  var scope = root || document;
  scope.querySelectorAll('.chart-bar.clickable, .hc-col-clickable[data-date]').forEach(function(control) {
    var info = chartDrilldownInfo(control);
    if (!info || !document.getElementById(info.controls)) { return; }
    control.setAttribute('role', 'button');
    control.setAttribute('tabindex', '0');
    control.setAttribute('aria-controls', info.controls);
    var label = control.getAttribute('title') || info.date;
    control.setAttribute('aria-label', label);
    var detail = document.getElementById(info.controls);
    var expanded = detail && detail.closest('tr')
      ? getComputedStyle(detail.closest('tr')).display !== 'none'
      : false;
    control.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  });
}
function hourlyOverviewSelectionKey(container) {
  return ccuChartStateKey(container) + ':hour-selection';
}
function hourlyOverviewControlHour(control) {
  var holder = control && control.closest ? control.closest('.hc-col[data-hour]') : null;
  return holder ? (holder.getAttribute('data-hour') || '') : '';
}
function hourlyOverviewDisplayHour(hour) {
  return /^[0-9]{2}$/.test(hour) ? hour + ':00' : hour;
}
function hourlyOverviewMetricLabel(container) {
  var active = container.querySelector(':scope > .chart-tabs .chart-tab.active[data-metric]');
  return active && active.textContent ? active.textContent.trim() : '';
}
function hourlyOverviewMetric(container) {
  var active = container.querySelector(':scope > .chart-tabs .chart-tab.active[data-metric]');
  return active ? (active.getAttribute('data-metric') || 'cost') : 'cost';
}
function formattedChartBarValue(control, metric) {
  var value = parseFloat(control.dataset[getDataAttribute(metric)]) || 0;
  return metric === 'cost' &&
    control.dataset.pricedTokens === '0' && control.dataset.hasUsage === 'true'
    ? '—'
    : formatValue(value, metric);
}
function hourlyOverviewSelectionText(container, control) {
  var hour = hourlyOverviewDisplayHour(hourlyOverviewControlHour(control));
  var metric = hourlyOverviewMetricLabel(container);
  // The visible bar-top label intentionally suppresses zeroes. Selection
  // status and accessible names still announce the exact zero value.
  var formatted = formattedChartBarValue(control, hourlyOverviewMetric(container));
  return hour + (metric ? ' · ' + metric : '') + (formatted ? ': ' + formatted : '');
}
function clearHourlyOverviewSelection(container, persist) {
  if (!container) { return; }
  container.querySelectorAll('[data-hour-selection-control]').forEach(function(control) {
    control.classList.remove('selected');
    control.setAttribute('aria-pressed', 'false');
  });
  container.querySelectorAll('.daily-table tbody tr[data-hour]').forEach(function(row) {
    row.classList.remove('chart-selection-row');
  });
  var detail = container.querySelector('[data-hour-selection-detail]');
  if (detail) {
    detail.hidden = true;
    detail.textContent = '';
  }
  if (persist) {
    var selections = ccuReadUiState().hourlyChartSelections || {};
    delete selections[hourlyOverviewSelectionKey(container)];
    ccuWriteUiState('hourlyChartSelections', selections);
  }
}
function setHourlyOverviewSelection(container, hour, persist) {
  if (!container || !hour) { return false; }
  var selected = null;
  container.querySelectorAll('.hc-col[data-hour] > .chart-bar').forEach(function(control) {
    if (hourlyOverviewControlHour(control) === hour) { selected = control; }
  });
  if (!selected) { return false; }
  clearHourlyOverviewSelection(container, false);
  selected.classList.add('selected');
  selected.setAttribute('aria-pressed', 'true');
  var selectedText = hourlyOverviewSelectionText(container, selected);
  selected.setAttribute('aria-label', selectedText);
  container.querySelectorAll('.daily-table tbody tr[data-hour]').forEach(function(row) {
    if (row.getAttribute('data-hour') === hour) { row.classList.add('chart-selection-row'); }
  });
  var detail = container.querySelector('[data-hour-selection-detail]');
  if (detail) {
    detail.textContent = selectedText;
    detail.hidden = false;
  }
  if (persist) {
    var selections = ccuReadUiState().hourlyChartSelections || {};
    selections[hourlyOverviewSelectionKey(container)] = hour;
    ccuWriteUiState('hourlyChartSelections', selections);
  }
  return true;
}
function refreshHourlyOverviewSelection(container) {
  if (!container || !container.matches('[data-hourly-overview]')) { return; }
  var selected = container.querySelector('[data-hour-selection-control][aria-pressed="true"]');
  if (!selected) { return; }
  var hour = hourlyOverviewControlHour(selected);
  if (hour) { setHourlyOverviewSelection(container, hour, false); }
}
function activateHourlyOverviewSelection(control) {
  var container = control && control.closest ? control.closest('[data-hourly-overview]') : null;
  if (!container) { return; }
  var hour = hourlyOverviewControlHour(control);
  if (!hour) { return; }
  if (control.getAttribute('aria-pressed') === 'true') {
    clearHourlyOverviewSelection(container, true);
  } else {
    setHourlyOverviewSelection(container, hour, true);
  }
}
function initializeHourlyOverviewSelections(root) {
  var scope = root || document;
  var containers = [];
  if (scope.matches && scope.matches('[data-hourly-overview]')) { containers.push(scope); }
  scope.querySelectorAll('[data-hourly-overview]').forEach(function(container) { containers.push(container); });
  containers.forEach(function(container) {
    var detail = container.querySelector('[data-hour-selection-detail]');
    if (!detail || !detail.id) { return; }
    container.querySelectorAll('.hc-col[data-hour] > .chart-bar').forEach(function(control) {
      control.setAttribute('data-hour-selection-control', '');
      control.setAttribute('role', 'button');
      control.setAttribute('tabindex', '0');
      control.setAttribute('aria-controls', detail.id);
      if (!control.hasAttribute('aria-pressed')) { control.setAttribute('aria-pressed', 'false'); }
      control.setAttribute('aria-label', hourlyOverviewSelectionText(container, control));
    });
  });
}
function restoreHourlyOverviewSelections(root) {
  var scope = root || document;
  var selections = ccuReadUiState().hourlyChartSelections || {};
  var containers = [];
  if (scope.matches && scope.matches('[data-hourly-overview]')) { containers.push(scope); }
  scope.querySelectorAll('[data-hourly-overview]').forEach(function(container) { containers.push(container); });
  containers.forEach(function(container) {
    var hour = selections[hourlyOverviewSelectionKey(container)];
    if (hour) { setHourlyOverviewSelection(container, hour, false); }
  });
}
function initializeStatusRegions(root) {
  var scope = root || document;
  scope.querySelectorAll('.loading, .no-data, .no-chart-data').forEach(function(region) {
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
  });
  scope.querySelectorAll('.error').forEach(function(region) {
    region.setAttribute('role', 'alert');
  });
}

// Global event delegation for chart tabs and chart bars
document.addEventListener('click', function(event) {
  // Handle sortable table header clicks
  var sortableTh = event.target.closest ? event.target.closest('th.sortable') : null;
  if (sortableTh) {
    var sortTableEl = sortableTh.closest('table');
    var sortKey = sortableTh.getAttribute('data-sortkey');
    if (sortTableEl && sortKey) {
      sortTable(sortTableEl, sortKey, sortableTh);
    }
    return;
  }

  // Handle chart tab clicks
  var chartTab = event.target.closest ? event.target.closest('.chart-tab[data-metric]') : null;
  if (chartTab) {
    event.preventDefault();
    const metric = chartTab.dataset.metric;

    // Find the container and determine the context
    const container = chartTab.closest('.daily-breakdown, .hourly-breakdown');

    if (container) {
      applyChartMetric(container, metric, true);
    }
  }

  var hourlySelection = event.target.closest
    ? event.target.closest('[data-hour-selection-control]')
    : null;
  if (hourlySelection) {
    event.preventDefault();
    activateHourlyOverviewSelection(hourlySelection);
    return;
  }

  // Handle chart bar clicks - only for clickable charts
  if (event.target.classList.contains('chart-bar') && event.target.classList.contains('clickable')) {
    event.preventDefault();
    activateChartDrilldown(event.target);
  }
});

document.addEventListener('keydown', function(event) {
  var sortableTh = event.target && event.target.closest
    ? event.target.closest('th.sortable')
    : null;
  if (!sortableTh || (event.key !== 'Enter' && event.key !== ' ')) { return; }
  var table = sortableTh.closest('table');
  var key = sortableTh.getAttribute('data-sortkey');
  if (!table || !key) { return; }
  event.preventDefault();
  sortTable(table, key, sortableTh);
});

document.addEventListener('keydown', function(event) {
  var hourlySelection = event.target && event.target.closest
    ? event.target.closest('[data-hour-selection-control]')
    : null;
  if (!hourlySelection || (event.key !== 'Enter' && event.key !== ' ')) { return; }
  event.preventDefault();
  activateHourlyOverviewSelection(hourlySelection);
});

document.addEventListener('keydown', function(event) {
  var control = event.target && event.target.closest
    ? event.target.closest('.chart-bar.clickable[role="button"], .hc-col-clickable[role="button"]')
    : null;
  if (!control || (event.key !== 'Enter' && event.key !== ' ')) { return; }
  event.preventDefault();
  activateChartDrilldown(control);
});

function bindChartTabEvents(container) {
  const chartTabs = container.querySelectorAll('.chart-tab[data-metric]');

  chartTabs.forEach(function(tab) {
    // Remove existing event listeners to prevent duplicates
    tab.removeEventListener('click', handleChartTabClick);

    // Add new event listener
    tab.addEventListener('click', handleChartTabClick);
  });
}

function handleChartTabClick(event) {
  event.preventDefault();

  const metric = this.dataset.metric;
  if (!metric) { return; }
  const container = this.closest('.daily-breakdown, .hourly-breakdown');

  if (container) {
    applyChartMetric(container, metric, true);
  }
}

function updateMainChart(metric, container) {
  if (typeof metric !== 'string' ||
      ['cost', 'inputTokens', 'outputTokens', 'cacheCreation', 'cacheRead', 'messages'].indexOf(metric) === -1) {
    return;
  }
  // If container is provided, use it; otherwise find the active tab content
  let targetContainer = container;
  if (!targetContainer) {
    targetContainer = document.querySelector('.tab-content.active');
    if (!targetContainer) {
      console.error("No active tab content found");
      return;
    }
  }

  // Update chart in the target container
  const chartBars = targetContainer.querySelectorAll('.chart-bar');
  if (chartBars.length === 0) {
    return;
  }

  // Calculate max values for the metric
  const values = Array.from(chartBars).map(function(bar) {
    const value = parseFloat(bar.dataset[getDataAttribute(metric)]) || 0;
    return value;
  });

  const maxValue = Math.max(...values);
  const maxHeight = 120;

  // Update each bar
  chartBars.forEach(function(bar, index) {
    const value = parseFloat(bar.dataset[getDataAttribute(metric)]) || 0;
    const height = maxValue > 0 ? (value / maxValue) * maxHeight : 2;

    // Update height
    bar.style.height = height + 'px';

    const hasClickable = bar.classList.contains('clickable');
    const hasSelected = bar.classList.contains('selected');

    // Cost metric on a chart that carries the cost breakdown (daily / monthly)
    // renders a stacked composition; every other case is a single-colour bar.
    const canStack = bar.dataset.costInput !== undefined;
    if (metric === 'cost' && canStack) {
      bar.className = 'chart-bar cost-bar cost-stacked';
      bar.innerHTML = buildCostStack(bar, height);
    } else {
      bar.className = 'chart-bar ' + getBarClass(metric);
      bar.innerHTML = '';
    }
    if (hasClickable) {
      bar.classList.add('clickable');
    }
    if (hasSelected) {
      bar.classList.add('selected');
    }

    // Update tooltip + on-bar value label
    const formattedValue = formattedChartBarValue(bar, metric);
    const container = bar.parentElement;
    const date = container.dataset.date;
    const hour = container.dataset.hour;
    const costHelp = metric === 'cost' ? bar.dataset.costHelp : '';
    const valueWithHelp = costHelp ? formattedValue + ' · ' + costHelp : formattedValue;

    if (hour) {
      // Hourly chart: tooltip shows the value only (the hour is on the x-axis).
      bar.title = valueWithHelp;
    } else if (date) {
      // Claude's all-time month key includes its sentinel first day. The chart
      // scope, not the presence of a day component, determines its label.
      bar.title = ccuFormatUsageDateKey(date, null, !!bar.closest('#allTimeChart')) + ': ' + valueWithHelp;
    }
    // Drill-down bars keep their accessible name synchronized with the
    // currently selected metric; otherwise a keyboard user would continue to
    // hear the initial cost value after switching to tokens or messages.
    if (bar.getAttribute('role') === 'button' && bar.title) {
      bar.setAttribute('aria-label', bar.title);
    }

    const barVal = container.querySelector('.hc-barval');
    if (barVal) {
      barVal.textContent = hour && value === 0 && formattedValue !== '—'
        ? ''
        : formattedValue;
    }
  });

  // Update the main chart's Y-axis reference labels for the new metric.
  // Scope to the wrap that holds the bars we just updated — the same container
  // also holds the token-composition chart's own hc-yaxis, so a container-wide
  // query would find 6 values (not 3) and silently skip the update, leaving
  // the axis stuck on the previous metric's units.
  const firstBar = chartBars[0];
  const wrap = firstBar && firstBar.closest ? firstBar.closest('.hc-wrap') : null;
  const yvals = wrap ? wrap.querySelectorAll('.hc-yaxis .hc-yval') : [];
  if (yvals.length === 3) {
    const hasUsage = Array.from(chartBars).some(function(bar) {
      return bar.dataset.hasUsage === 'true';
    });
    const hasPricedCost = Array.from(chartBars).some(function(bar) {
      return bar.dataset.pricedTokens === undefined || bar.dataset.pricedTokens !== '0';
    });
    const hasDisplayableCost = metric !== 'cost' || hasPricedCost || !hasUsage;
    yvals[0].textContent = hasDisplayableCost ? formatValue(maxValue, metric) : '—';
    yvals[1].textContent = hasDisplayableCost ? formatValue(maxValue / 2, metric) : '—';
    yvals[2].textContent = hasDisplayableCost ? formatValue(0, metric) : '—';
  }
}

function getDataAttribute(metric) {
  const mapping = {
    'cost': 'cost',
    'inputTokens': 'input',
    'outputTokens': 'output',
    'cacheCreation': 'cacheCreation',
    'cacheRead': 'cacheRead',
    'messages': 'messages'
  };
  return mapping[metric] || 'cost';
}

function getBarClass(metric) {
  const mapping = {
    'cost': 'cost-bar',
    'inputTokens': 'input-bar',
    'outputTokens': 'output-bar',
    'cacheCreation': 'cache-creation-bar',
    'cacheRead': 'cache-read-bar',
    'messages': 'messages-bar'
  };
  return mapping[metric] || 'cost-bar';
}

// Rebuild a cost bar's stacked composition (input / cache-read / cache-write /
// output) from its data attributes. Matches the server-side renderMainCostChart
// order and colours; segments are pointer-events:none so drill-down still works.
function buildCostStack(bar, barHeight) {
  const ci = parseFloat(bar.dataset.costInput) || 0;
  const co = parseFloat(bar.dataset.costOutput) || 0;
  const cw = parseFloat(bar.dataset.costCachewrite) || 0;
  const cr = parseFloat(bar.dataset.costCacheread) || 0;
  const total = ci + co + cw + cr;
  function seg(v, cls) {
    const h = total > 0 ? (v / total) * barHeight : 0;
    return '<div class="stack-seg ' + cls + '" style="height: ' + h + 'px;"></div>';
  }
  return seg(ci, 'seg-input') + seg(cr, 'seg-cache-read') + seg(cw, 'seg-cache-creation') + seg(co, 'seg-output');
}

function formatValue(value, metric) {
  if (metric === 'cost') {
    if (!Number.isFinite(value)) { return '—'; }
    var converted = value * __currencyDisplay.unitsPerUsd;
    var separator = /^[A-Z]{3}$/.test(__currencyDisplay.label) ? ' ' : '';
    return (__currencyDisplay.converted ? '≈' : '')
      + __currencyDisplay.label
      + separator
      + converted.toFixed(__currencyDisplay.decimalPlaces);
  } else {
    return value.toLocaleString();
  }
}

// Cache hit rate for a drill-down row: cacheRead / (input + cacheWrite + cacheRead).
function cacheHitPct(d) {
  var den = d.totalInputTokens + d.totalCacheCreationTokens + d.totalCacheReadTokens;
  return den > 0 ? (d.totalCacheReadTokens / den * 100).toFixed(0) + '%' : '-';
}

// Client-side stacked token-composition chart (mirrors the server-rendered
// renderCompositionChart, same CSS classes). Used when a month is expanded to
// show its per-day composition. items: [{ label, data }].
function compositionHtml(items) {
  if (!items || !items.length) { return ''; }
  var maxH = 120;
  var totals = items.map(function(it) {
    var d = it.data;
    return d.totalInputTokens + d.totalOutputTokens + d.totalCacheCreationTokens + d.totalCacheReadTokens;
  });
  var maxTotal = Math.max.apply(null, totals.concat([1]));
  var fmt = function(n) { return n.toLocaleString(__locale); };
  var bars = items.map(function(it, idx) {
    var d = it.data, total = totals[idx], barH = (total / maxTotal) * maxH;
    var seg = function(v, cls, label) {
      var h = total > 0 ? (v / total) * barH : 0;
      return '<div class="stack-seg ' + cls + '" style="height:' + h + 'px;" title="' + label + ': ' + fmt(v) + '"></div>';
    };
    return '<div class="hc-col"><div class="stack-bar" title="' + it.label + ': ' + fmt(total) + '">'
      + seg(d.totalInputTokens, 'seg-input', '${I18n.t.popup.inputTokens}')
      + seg(d.totalCacheReadTokens, 'seg-cache-read', '${I18n.t.popup.cacheRead}')
      + seg(d.totalCacheCreationTokens, 'seg-cache-creation', '${I18n.t.popup.cacheCreation}')
      + seg(d.totalOutputTokens, 'seg-output', '${I18n.t.popup.outputTokens}')
      + '</div></div>';
  }).join('');
  var xlabels = items.map(function(it) { return '<div class="hc-xlabel">' + it.label + '</div>'; }).join('');
  var dot = function(cls, label) { return '<span class="legend-item"><span class="legend-dot ' + cls + '"></span>' + label + '</span>'; };
  return '<div class="composition-chart"><h4>${I18n.t.popup.tokenComposition}</h4>'
    + '<div class="stack-legend">'
    + dot('seg-input', '${I18n.t.popup.inputTokens}') + dot('seg-cache-read', '${I18n.t.popup.cacheRead}')
    + dot('seg-cache-creation', '${I18n.t.popup.cacheCreation}') + dot('seg-output', '${I18n.t.popup.outputTokens}')
    + '</div>'
    + '<div class="hc-wrap"><div class="hc-yaxis">'
    + '<span class="hc-yval">' + fmt(maxTotal) + '</span><span class="hc-yval">' + fmt(Math.round(maxTotal / 2)) + '</span><span class="hc-yval">0</span>'
    + '</div><div class="hc-main"><div class="hc-scroll" tabindex="0"><div class="hc-plot">'
    + '<div class="hc-grid hc-grid-top"></div><div class="hc-grid hc-grid-mid"></div>'
    + '<div class="hc-bars">' + bars + '</div></div>'
    + '<div class="hc-xlabels">' + xlabels + '</div></div></div></div></div>';
}

function renderHourlyData(hourlyData, date) {
  if (!hourlyData || hourlyData.length === 0) {
    return '<div class="no-data">${I18n.t.popup.noDataMessage}</div>';
  }

  const rowsByHour = new Map();
  hourlyData.forEach(function(item) {
    if (item && /^(?:[01]\\d|2[0-3]):00$/.test(item.hour) && !rowsByHour.has(item.hour)) {
      rowsByHour.set(item.hour, item);
    }
  });
  hourlyData = Array.from({ length: 24 }, function(_unused, hour) {
    const label = String(hour).padStart(2, '0') + ':00';
    return rowsByHour.get(label) || {
      hour: label,
      data: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        totalCost: 0,
        costBreakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
        messageCount: 0
      }
    };
  });

  let html = '<div class="hourly-breakdown" data-claude-materialized-hours="true">';
  html += '<h4>' + ccuFormatUsageDateKey(date) + ' ${I18n.t.popup.hourlyBreakdown}</h4>';

  html += '<div class="chart-tabs">';
  html += '<button class="chart-tab active" data-metric="cost">${I18n.t.popup.cost}</button>';
  html += '<button class="chart-tab" data-metric="inputTokens">${I18n.t.popup.inputTokens}</button>';
  html += '<button class="chart-tab" data-metric="outputTokens">${I18n.t.popup.outputTokens}</button>';
  html += '<button class="chart-tab" data-metric="cacheCreation">${I18n.t.popup.cacheCreation}</button>';
  html += '<button class="chart-tab" data-metric="cacheRead">${I18n.t.popup.cacheRead}</button>';
  html += '<button class="chart-tab" data-metric="messages">${I18n.t.popup.messages}</button>';
  html += '</div>';

  // hc-wrap is self-contained (own Y-axis + scroll); a fixed-height
  // chart-container wrapper would add a second scrollbar.
  html += '<div class="chart-content" id="hourly-chart-' + date + '">';
  html += renderHourlyChart(hourlyData, 'cost');
  html += '</div>';

  html += '<div class="daily-table-container" tabindex="0"><table class="daily-table"><thead><tr>';
  html += '<th>${I18n.t.popup.hour}</th>';
  html += '<th>${I18n.t.popup.cost}</th>';
  html += '<th>${I18n.t.popup.inputTokens}</th>';
  html += '<th>${I18n.t.popup.outputTokens}</th>';
  html += '<th>${I18n.t.popup.cacheCreation}</th>';
  html += '<th>${I18n.t.popup.cacheRead}</th>';
  html += '<th>${I18n.t.popup.cacheHitRate}</th>';
  html += '<th>${I18n.t.popup.messages}</th>';
  html += '</tr></thead><tbody>';

  hourlyData.forEach(function(item) {
    html += '<tr data-hour="' + item.hour + '">';
    html += '<td class="date-cell">' + item.hour + '</td>';
    html += '<td class="cost-cell">' + formatValue(item.data.totalCost, 'cost') + '</td>';
    html += '<td class="number-cell">' + item.data.totalInputTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + item.data.totalOutputTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + item.data.totalCacheCreationTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + item.data.totalCacheReadTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + cacheHitPct(item.data) + '</td>';
    html += '<td class="number-cell">' + item.data.messageCount.toLocaleString(__locale) + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  window['hourlyData_' + date] = hourlyData;
  html += '</div>';
  return html;
}

function renderDailyData(dailyData, monthDate) {
  if (!dailyData || dailyData.length === 0) {
    return '<div class="no-data">${I18n.t.popup.noDataMessage}</div>';
  }

  const expandableDays = new Set(dailyData
    .filter(function(item) {
      return Object.prototype.hasOwnProperty.call(__claudeLast30HoursByDay, item.date);
    })
    .map(function(item) { return item.date; }));
  let html = '<div class="daily-breakdown" data-claude-alltime-daily="true">';
  html += '<h4>' + ccuFormatUsageDateKey(monthDate, null, true) + ' ${I18n.t.popup.dailyBreakdown}</h4>';

  html += '<div class="chart-tabs">';
  html += '<button class="chart-tab active" data-metric="cost">${I18n.t.popup.cost}</button>';
  html += '<button class="chart-tab" data-metric="inputTokens">${I18n.t.popup.inputTokens}</button>';
  html += '<button class="chart-tab" data-metric="outputTokens">${I18n.t.popup.outputTokens}</button>';
  html += '<button class="chart-tab" data-metric="cacheCreation">${I18n.t.popup.cacheCreation}</button>';
  html += '<button class="chart-tab" data-metric="cacheRead">${I18n.t.popup.cacheRead}</button>';
  html += '<button class="chart-tab" data-metric="messages">${I18n.t.popup.messages}</button>';
  html += '</div>';

  // hc-wrap is self-contained (own Y-axis + scroll); no chart-container.
  html += '<div class="chart-content" id="daily-chart-' + monthDate + '">';
  html += renderDailyChart(dailyData, 'cost', expandableDays);
  html += '</div>';

  // Per-day token composition for this month (the drill-down of the all-time
  // monthly composition the user clicked).
  html += compositionHtml(dailyData.map(function(item) {
    return {
      label: ccuFormatUsageDateKey(item.date, { month: 'numeric', day: 'numeric' }),
      data: item.data
    };
  }));

  html += '<div class="daily-table-container" tabindex="0"><table class="daily-table"><thead><tr>';
  html += '<th>${I18n.t.popup.date}</th>';
  html += '<th>${I18n.t.popup.cost}</th>';
  html += '<th>${I18n.t.popup.inputTokens}</th>';
  html += '<th>${I18n.t.popup.outputTokens}</th>';
  html += '<th>${I18n.t.popup.cacheCreation}</th>';
  html += '<th>${I18n.t.popup.cacheRead}</th>';
  html += '<th>${I18n.t.popup.cacheHitRate}</th>';
  html += '<th>${I18n.t.popup.messages}</th>';
  html += '<th></th>';
  html += '</tr></thead><tbody>';

  dailyData.forEach(function(item) {
    const formattedDate = ccuFormatUsageDateKey(item.date, { month: 'numeric', day: 'numeric' });

    const canExpand = expandableDays.has(item.date);
    html += '<tr class="daily-row" data-date="' + item.date + '">';
    html += '<td class="date-cell">' + formattedDate + '</td>';
    html += '<td class="cost-cell">' + formatValue(item.data.totalCost, 'cost') + '</td>';
    html += '<td class="number-cell">' + item.data.totalInputTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + item.data.totalOutputTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + item.data.totalCacheCreationTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + item.data.totalCacheReadTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + cacheHitPct(item.data) + '</td>';
    html += '<td class="number-cell">' + item.data.messageCount.toLocaleString(__locale) + '</td>';
    html += '<td class="detail-cell">';
    if (canExpand) {
      html += '<button class="detail-button" data-claude-alltime-hourly-toggle data-date="' + item.date + '" ' +
        'onclick="toggleClaudeAllTimeHourlyDetail(\\\'' + item.date + '\\\', this)" aria-expanded="false" ' +
        'aria-controls="claude-alltime-hourly-detail-' + item.date + '" ' +
        'title="${I18n.t.popup.hourlyBreakdown}">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">' +
        '<path class="expand-icon" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>' +
        '</svg></button>';
    }
    html += '</td>';
    html += '</tr>';
    if (canExpand) {
      html += '<tr class="hourly-detail-row" data-claude-alltime-hourly-detail-row data-date="' +
        item.date + '" style="display: none;"><td colspan="9">' +
        '<div class="hourly-detail-container" id="claude-alltime-hourly-detail-' + item.date + '">' +
        '<div class="loading-indicator">${I18n.t.statusBar.loading}</div></div></td></tr>';
    }
  });

  html += '</tbody></table></div>';
  window['dailyData_' + monthDate] = dailyData;
  html += '</div>';
  return html;
}

// Shared gridded chart for the drill-down details (daily under a month,
// hourly under a day). Matches the server-rendered main charts: a Y-axis,
// two dashed reference lines, and — for the cost metric — stacked
// composition bars (input / cache-read / cache-write / output). Other metrics
// render single-colour bars. Each bar carries the cost breakdown as data
// attributes so the in-place metric switcher (updateMainChart) can rebuild.
function griddedChart(items, metric, opts) {
  if (!items || items.length === 0) {
    return '<div class="no-chart-data" role="status">${this.escapeHtml(I18n.t.statusBar.noData)}</div>';
  }
  const maxHeight = 120;
  function metricValue(d) {
    switch (metric) {
      case 'inputTokens': return d.totalInputTokens;
      case 'outputTokens': return d.totalOutputTokens;
      case 'cacheCreation': return d.totalCacheCreationTokens;
      case 'cacheRead': return d.totalCacheReadTokens;
      case 'messages': return d.messageCount;
      default: return d.totalCost;
    }
  }
  const values = items.map(function(it) { return metricValue(it.data); });
  const maxValue = Math.max.apply(null, values.concat([0]));

  let bars = '';
  items.forEach(function(it, i) {
    const d = it.data;
    const value = values[i];
    const height = maxValue > 0 ? (value / maxValue) * maxHeight : 0;
    const cb = d.costBreakdown || { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    const keyAttr = opts.keyName === 'hour' ? 'data-hour' : 'data-date';
    const key = opts.keyName === 'hour' ? it.hour : it.date;

    let inner = '';
    let cls = 'chart-bar ' + getBarClass(metric);
    if (metric === 'cost') {
      cls = 'chart-bar cost-bar cost-stacked';
      const total = cb.input + cb.output + cb.cacheWrite + cb.cacheRead;
      function seg(v, c) {
        const h = total > 0 ? (v / total) * height : 0;
        return '<div class="stack-seg ' + c + '" style="height: ' + h + 'px;"></div>';
      }
      inner = seg(cb.input, 'seg-input') + seg(cb.cacheRead, 'seg-cache-read') +
              seg(cb.cacheWrite, 'seg-cache-creation') + seg(cb.output, 'seg-output');
    }
    const clickable = typeof opts.clickable === 'function'
      ? opts.clickable(it)
      : opts.clickable;
    if (clickable) { cls += ' clickable'; }

    const visibleValue = opts.hideZeroLabels && value === 0
      ? ''
      : formatValue(value, metric);
    bars += '<div class="hc-col" ' + keyAttr + '="' + key + '">' +
      '<div class="hc-barval">' + visibleValue + '</div>' +
      '<div class="' + cls + '" style="height: ' + height + 'px;" ' +
      'data-cost="' + d.totalCost + '" data-input="' + d.totalInputTokens + '" data-output="' + d.totalOutputTokens + '" ' +
      'data-cache-creation="' + d.totalCacheCreationTokens + '" data-cache-read="' + d.totalCacheReadTokens + '" data-messages="' + d.messageCount + '" ' +
      'data-cost-input="' + cb.input + '" data-cost-output="' + cb.output + '" data-cost-cachewrite="' + cb.cacheWrite + '" data-cost-cacheread="' + cb.cacheRead + '" ' +
      'title="' + opts.getTitle(it, value) + '">' + inner + '</div>' +
      '</div>';
  });

  const xlabels = items.map(function(it) {
    return '<div class="hc-xlabel">' + opts.getLabel(it) + '</div>';
  }).join('');

  return '<div class="hc-wrap">' +
    '<div class="hc-yaxis">' +
    '<span class="hc-yval">' + formatValue(maxValue, metric) + '</span>' +
    '<span class="hc-yval">' + formatValue(maxValue / 2, metric) + '</span>' +
    '<span class="hc-yval">' + formatValue(0, metric) + '</span>' +
    '</div>' +
    '<div class="hc-main"><div class="hc-scroll" tabindex="0">' +
    '<div class="hc-plot"><div class="hc-grid hc-grid-top"></div><div class="hc-grid hc-grid-mid"></div>' +
    '<div class="hc-bars">' + bars + '</div></div>' +
    '<div class="hc-xlabels">' + xlabels + '</div>' +
    '</div></div></div>';
}

function renderDailyChart(dailyData, metric, expandableDays) {
  // Parse 'YYYY-MM-DD' textually: new Date('YYYY-MM-DD') is interpreted as
  // UTC midnight, so getMonth()/getDate() shift back a day in negative-UTC
  // timezones. String parts are timezone-proof.
  function parts(dateStr) { return dateStr.split('-').map(Number); }
  return griddedChart(dailyData, metric, {
    keyName: 'date',
    clickable: function(it) { return !!(expandableDays && expandableDays.has(it.date)); },
    // Show month/day (not just the day number) so the axis isn't ambiguous.
    getLabel: function(it) { var p = parts(it.date); return p[1] + '/' + p[2]; },
    getTitle: function(it, v) {
      var p = parts(it.date);
      var d = new Date(p[0], p[1] - 1, p[2]); // local-time construction
      return d.toLocaleDateString(__locale) + ': ' + formatValue(v, metric);
    }
  });
}

function renderHourlyChart(hourlyData, metric) {
  return griddedChart(hourlyData, metric, {
    keyName: 'hour',
    clickable: false,
    hideZeroLabels: true,
    getLabel: function(it) { return it.hour; },
    getTitle: function(it, v) { return it.hour + ': ' + formatValue(v, metric); }
  });
}

`;
  }

  dispose(): void {
    if (this.panel) {
      this.panel.dispose();
    }
  }
}
