import * as vscode from 'vscode';
import {
  CODEX_LIVE_REFRESH_SECONDS,
  LIVE_REFRESH_SECONDS,
} from './refreshPolicy';
import {
  DISPLAY_CURRENCY_CODES,
  DISPLAY_CURRENCY_LABELS,
  normalizeDisplayCurrencyCode,
} from './currencyDisplay';

// Single source of truth for every user setting (V2.1: "settings in the
// dashboard"). Most settings moved OUT of VS Code's Settings UI to keep it
// uncluttered — they live in the extension's own globalState and are edited
// from the dashboard's ⚙ Settings tab. A small core stays declared in
// package.json so it remains editable in settings.json and travels with
// Settings Sync:
//   - language        (UI language; people sync this)
//   - dataDirectory   (machine-specific path a power user may script)
//   - codex.dataDirectory (optional machine-specific Codex home)
// API keys are deliberately absent from settings.json/globalState. The
// dashboard writes them to VS Code SecretStorage and never receives a stored
// value back from the extension host.
//
// The catalog below drives BOTH the read/write plumbing and the dashboard
// panel rendering, so adding a setting is a one-line change here.
//
// Setting labels/help are intentionally English (technical identifiers); the
// panel chrome — group headers, buttons, notes — is localised via i18n.

export type SettingType = 'boolean' | 'number' | 'enum' | 'string';
export type SettingStorage = 'config' | 'state' | 'secret';
export type SettingGroup = 'general' | 'providers' | 'features' | 'statusBar' | 'data' | 'advice';
export type SettingProvider = 'claude' | 'codex';

export interface SettingDef {
  key: string; // dotted config key, e.g. 'advice.backend'
  type: SettingType;
  default: boolean | number | string;
  storage: SettingStorage;
  group: SettingGroup;
  label: string; // short English label shown in the panel
  help?: string; // one-line English help
  enumValues?: string[]; // for type 'enum' (the full set of valid values)
  enumLabels?: string[]; // optional display labels (defaults to enumValues)
  // Optional <optgroup> structure for a long enum (e.g. timezone: Common vs All
  // zones). Purely presentational — enumValues stays the flat validation set.
  enumGroups?: { label: string; values: string[]; labels: string[] }[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  secret?: boolean; // mask the input (apiKey)
  multiline?: boolean; // render a textarea
  // Compatibility-only settings remain readable/resettable but are omitted
  // from the dashboard so a superseding control can be the single UI switch.
  visible?: boolean;
  // Dashboard visibility. Omitted settings are Claude-only; explicitly list
  // both providers for truly shared controls.
  providers?: SettingProvider[];
}

export function settingAppliesToProvider(
  def: SettingDef,
  provider: SettingProvider,
): boolean {
  return def.providers?.includes(provider) ?? provider === 'claude';
}

// globalState key prefix for moved settings — namespaced to avoid colliding
// with other globalState entries (consent flags, dismissals, …).
const STATE_PREFIX = 'ccu.setting.';
const SECRET_PREFIX = 'claudeCodeUsage.secret.';
const MIGRATION_FLAG = 'ccu.settingsMigrated.v1';
// V2.2: one-shot conversion of the old double-negative pauseDashboardRefresh to
// the positive dashboardAutoRefresh. Its own flag so it runs even for users who
// already passed the v1 migration.
const AUTOREFRESH_MIGRATION_FLAG = 'ccu.migrated.dashboardAutoRefresh';
// One-shot rename of showOpusWeekly to the model-agnostic showScopedWeekly. The
// usage API stopped populating its per-model Opus field and now scopes weekly
// caps itself, so a setting naming one model could no longer describe the thing
// it controls. Own flag so it runs regardless of the earlier migrations.
const SCOPED_WEEKLY_MIGRATION_FLAG = 'ccu.migrated.showScopedWeekly';
// The early 2.3.2 test build exposed a free-form label and manual USD
// multiplier. The release candidate replaces both with one fixed preset.
const CURRENCY_PRESET_MIGRATION_FLAG = 'ccu.migrated.currencyPreset.v2.3.2';

// Exact configuration/globalState names used by released predecessors but no
// longer present in SETTINGS. They are migration inputs, never a prefix-based
// deletion rule.
const RETIRED_SETTING_KEYS = [
  'fileWatching',
  'pauseDashboardRefresh',
  'showOpusWeekly',
  'advice.backend',
  'advice.subscriptionModel',
  'usdConversionRate',
] as const;

export type SettingsSecretMigrationErrorCode =
  | 'legacy-secret-conflict'
  | 'workspace-secret-requires-manual-migration'
  | 'secret-storage-unavailable'
  | 'secret-storage-failed';

/** A fixed-code error that can never carry the secret or provider error text. */
export class SettingsSecretMigrationError extends Error {
  constructor(readonly code: SettingsSecretMigrationErrorCode) {
    super(`settings-secret-migration:${code}`);
    this.name = 'SettingsSecretMigrationError';
  }
}

export class SettingsLocalDataClearError extends Error {
  readonly code = 'legacy-configuration-requires-manual-removal' as const;

  constructor(readonly keys: readonly string[]) {
    super('settings-local-data-clear:legacy-configuration-requires-manual-removal');
    this.name = 'SettingsLocalDataClearError';
  }
}

// Timezone dropdown ('' = system default). A dropdown (not free text) means an
// invalid value can never be entered (#51). Rather than dump all ~400 IANA
// zones, we curate the common ones — like a typical app's timezone picker — and
// label each with its current UTC offset so it's easy to find (#: "地点 + 时区
// 括号"). An exotic zone set earlier still stays selectable (the settings UI
// injects the stored value if it's not in this list).
//
// Ordered roughly west → east. Offsets are computed live (DST-aware) at load.
// Labels use the canonical IANA time-zone database identifier (the official,
// apolitical standard) — its last path segment as a friendly city name — so no
// editorialised country groupings that could read as taking a side.
const CURATED_ZONES: { zone: string; city: string }[] = [
  { zone: 'Pacific/Honolulu', city: 'Honolulu' },
  { zone: 'America/Anchorage', city: 'Anchorage' },
  { zone: 'America/Los_Angeles', city: 'Los Angeles' },
  { zone: 'America/Denver', city: 'Denver' },
  { zone: 'America/Chicago', city: 'Chicago' },
  { zone: 'America/New_York', city: 'New York' },
  { zone: 'America/Sao_Paulo', city: 'São Paulo' },
  { zone: 'UTC', city: 'UTC' },
  { zone: 'Europe/London', city: 'London' },
  { zone: 'Europe/Paris', city: 'Paris' },
  { zone: 'Europe/Berlin', city: 'Berlin' },
  { zone: 'Europe/Athens', city: 'Athens' },
  { zone: 'Europe/Moscow', city: 'Moscow' },
  { zone: 'Asia/Dubai', city: 'Dubai' },
  { zone: 'Asia/Karachi', city: 'Karachi' },
  { zone: 'Asia/Kolkata', city: 'Kolkata' },
  { zone: 'Asia/Dhaka', city: 'Dhaka' },
  { zone: 'Asia/Bangkok', city: 'Bangkok' },
  { zone: 'Asia/Jakarta', city: 'Jakarta (WIB)' },
  { zone: 'Asia/Shanghai', city: 'Shanghai' },
  { zone: 'Asia/Hong_Kong', city: 'Hong Kong' },
  { zone: 'Asia/Singapore', city: 'Singapore' },
  { zone: 'Asia/Makassar', city: 'Makassar (WITA)' },
  { zone: 'Asia/Tokyo', city: 'Tokyo' },
  { zone: 'Asia/Seoul', city: 'Seoul' },
  { zone: 'Asia/Jayapura', city: 'Jayapura (WIT)' },
  { zone: 'Australia/Sydney', city: 'Sydney' },
  { zone: 'Pacific/Auckland', city: 'Auckland' },
];

/** Current UTC offset of a zone as "UTC+08:00" (DST-aware), or '' if unknown. */
function utcOffsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    // "GMT+08:00" → "UTC+08:00"; bare "GMT" (UTC) → "UTC+00:00".
    const norm = raw.replace('GMT', 'UTC');
    return norm === 'UTC' ? 'UTC+00:00' : norm;
  } catch {
    return '';
  }
}

// Full UTC-offset coverage (Carl: it's the *offsets* that must be complete, not
// every city). Whole hours use fixed-offset Etc/GMT zones (POSIX-inverted sign,
// no DST); the real fractional offsets use a representative zone. A region hint
// aids recognition. Labels are computed live so they always match the actual
// bucketing.
// Pure UTC offsets — no place/country names at all (offset is neutral). The
// backing IANA zone is an implementation detail; the label shows only the offset.
const OFFSET_ZONES: { zone: string }[] = [
  { zone: 'Etc/GMT+12' }, { zone: 'Etc/GMT+11' }, { zone: 'Etc/GMT+10' },
  { zone: 'Pacific/Marquesas' }, { zone: 'Etc/GMT+9' }, { zone: 'Etc/GMT+8' },
  { zone: 'Etc/GMT+7' }, { zone: 'Etc/GMT+6' }, { zone: 'Etc/GMT+5' }, { zone: 'Etc/GMT+4' },
  { zone: 'America/St_Johns' }, { zone: 'Etc/GMT+3' }, { zone: 'Etc/GMT+2' },
  { zone: 'Etc/GMT+1' }, { zone: 'UTC' }, { zone: 'Etc/GMT-1' }, { zone: 'Etc/GMT-2' }, { zone: 'Etc/GMT-3' },
  { zone: 'Asia/Tehran' }, { zone: 'Etc/GMT-4' }, { zone: 'Asia/Kabul' },
  { zone: 'Etc/GMT-5' }, { zone: 'Asia/Kolkata' }, { zone: 'Asia/Kathmandu' },
  { zone: 'Etc/GMT-6' }, { zone: 'Asia/Yangon' }, { zone: 'Etc/GMT-7' }, { zone: 'Etc/GMT-8' },
  { zone: 'Australia/Eucla' }, { zone: 'Etc/GMT-9' }, { zone: 'Australia/Darwin' },
  { zone: 'Etc/GMT-10' }, { zone: 'Australia/Lord_Howe' }, { zone: 'Etc/GMT-11' },
  { zone: 'Etc/GMT-12' }, { zone: 'Pacific/Chatham' }, { zone: 'Etc/GMT-13' }, { zone: 'Etc/GMT-14' },
];

const offLabel = (zone: string, name: string): string => {
  const off = utcOffsetLabel(zone);
  return off ? `(${off}) ${name}` : name;
};
const offsetOnly = (zone: string): string => `(${utcOffsetLabel(zone) || 'UTC'})`;

// Flat set (validation accepts any listed zone) + labels; the dropdown groups them.
const TIMEZONE_VALUES: string[] = ['', ...CURATED_ZONES.map((z) => z.zone), ...OFFSET_ZONES.map((z) => z.zone)];
const TIMEZONE_LABELS: string[] = [
  'System default',
  ...CURATED_ZONES.map((z) => offLabel(z.zone, z.city)),
  ...OFFSET_ZONES.map((z) => offsetOnly(z.zone)),
];
// Common named zones (IANA cities) stay handy at the top; every UTC offset is
// under "UTC offset".
const TIMEZONE_GROUPS = [
  { label: 'System', values: [''], labels: ['System default'] },
  { label: 'Common', values: CURATED_ZONES.map((z) => z.zone), labels: CURATED_ZONES.map((z) => offLabel(z.zone, z.city)) },
  { label: 'UTC offset', values: OFFSET_ZONES.map((z) => z.zone), labels: OFFSET_ZONES.map((z) => offsetOnly(z.zone)) },
];

export const SETTINGS: SettingDef[] = [
  // --- General ---
  {
    key: 'language',
    type: 'enum',
    default: 'auto',
    storage: 'config',
    group: 'general',
    label: 'Display language',
    help: 'UI language. "auto" follows VS Code.',
    enumValues: ['auto', 'en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'],
    providers: ['claude', 'codex'],
  },
  {
    key: 'decimalPlaces',
    type: 'number',
    default: 2,
    storage: 'state',
    group: 'general',
    label: 'Cost decimal places',
    min: 0,
    max: 4,
    providers: ['claude', 'codex'],
  },
  {
    key: 'displayCurrency',
    type: 'enum',
    default: 'USD',
    storage: 'state',
    group: 'general',
    label: 'Cost display currency',
    help: 'Display only. Uses bundled reference rates dated 2026-09-09; rates are not editable or fetched, and underlying estimates remain USD.',
    enumValues: DISPLAY_CURRENCY_CODES,
    enumLabels: DISPLAY_CURRENCY_LABELS,
    providers: ['claude', 'codex'],
  },
  {
    key: 'tokenDecimalPlaces',
    type: 'number',
    default: 1,
    storage: 'state',
    group: 'general',
    label: 'Token decimal places',
    help: 'Decimals for compact token display (1.2M / 345.6K). Full integer counts are unaffected.',
    min: 0,
    max: 2,
    providers: ['claude', 'codex'],
  },
  {
    key: 'compactNumbers',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'general',
    label: 'Compact token counts',
    help: 'Show 1.2M / 345K instead of full numbers.',
    providers: ['claude', 'codex'],
  },
  {
    key: 'releaseAnnouncements',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'general',
    label: 'Release announcements',
    help: "Show one What's New notification after an extension upgrade.",
    providers: ['claude', 'codex'],
  },

  // --- Providers ---
  {
    key: 'pricingBackend',
    type: 'enum',
    default: 'anthropic',
    storage: 'state',
    group: 'providers',
    label: 'Claude pricing backend',
    help: 'Select AWS Bedrock in-region rates when Claude Code usage is routed through Bedrock.',
    enumValues: ['anthropic', 'aws-bedrock-in-region'],
    enumLabels: ['Anthropic direct API', 'AWS Bedrock (in-region)'],
    providers: ['claude'],
  },
  {
    key: 'codex.enabled',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'providers',
    label: 'Enable Codex',
    help: 'Read privacy-safe usage aggregates from local Codex session logs.',
    providers: ['claude', 'codex'],
  },
  {
    key: 'codex.dataDirectory',
    type: 'string',
    default: '',
    storage: 'config',
    group: 'providers',
    label: 'Custom Codex data directory',
    help: 'Empty = CODEX_HOME, then ~/.codex. Authentication files are never read.',
    providers: ['codex'],
  },
  {
    key: 'codex.fileWatchSeconds',
    type: 'enum',
    default: '30',
    storage: 'state',
    group: 'providers',
    label: 'Codex live refresh delay',
    help: 'Quiet debounce after local Codex JSONL changes. Off disables watching.',
    enumValues: [...CODEX_LIVE_REFRESH_SECONDS],
    enumLabels: ['Off', '10s', '30s', '60s', '120s', '300s'],
    providers: ['codex'],
  },
  {
    key: 'codex.optimization.enabled',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'providers',
    label: 'Show Codex behavior optimization',
    help: 'Show local, deterministic Codex behavior metrics and recommendations.',
    providers: ['codex'],
  },
  {
    key: 'showWeeklyEquivalentValue',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'features',
    label: 'Show weekly API-equivalent value',
    help: 'On by default. Show the historical weekly API-equivalent value panel in All-time and Compare. This is an estimate, not a bill or subscription allowance.',
    providers: ['claude', 'codex'],
  },
  {
    key: 'showProjectUsageMatrix',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'features',
    label: 'Show project usage matrix',
    help: 'On by default. Add a local 30/90-day Token heatmap and stacked trend to Projects. Reuses indexed aggregates and never allocates subscription quota by project.',
    providers: ['claude', 'codex'],
  },
  {
    key: 'showHeatmap',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'features',
    label: 'Show token heatmap (All-time tab)',
    help: 'Show a GitHub-style yearly token heatmap on the All tab. Off by default — mainly a shareable view of what you can already see elsewhere. Use "Export Token Heatmap" for a GitHub-profile SVG.',
    visible: false,
  },
  {
    key: 'showEfficiency',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'features',
    label: 'Show efficiency insights',
    help: 'Off by default (not everyone wants these). Adds cost/message, tokens/message and realised cache savings to Today / month / all-time and the projects table. (The "top 10 costliest messages" panel has its own toggle below.)',
  },
  {
    key: 'enableShareCard',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'features',
    label: 'Enable sharing workspace',
    help: 'On by default. Show the single preview-first sharing workspace. Turn it off to hide sharing UI; the legacy export commands still open the matching preview explicitly.',
    providers: ['claude', 'codex'],
  },
  {
    key: 'showCostliestMessages',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'features',
    label: 'Show "top 10 costliest messages"',
    help: 'Off by default. Adds a panel on the Content tab that ranks your single most expensive turns and, on expand, shows the prompt that triggered each (plus a cost split so you can tell a cache miss from a long answer). It reads and displays your own prompt text, so it stays opt-in.',
  },
  {
    key: 'showInsights',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'features',
    label: 'Show experimental insights',
    help: 'Off by default. Adds an "Experimental insights" section to the Content tab — our own estimates from your local logs (e.g. a cache-churn bill: $ spent re-writing cache after model switches / idle gaps). These are computed heuristics, not standardized metrics, so they stay opt-in and are labelled as estimates.',
  },
  {
    key: 'enableSessionActions',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'features',
    label: 'Enable session resume & delete actions',
    help: 'Off by default. When on, the Sessions tab shows Resume and Delete buttons. Both ACT on your Claude Code — resume reopens a conversation (and reloads it into context), delete moves its log file to the OS trash — which is at odds with this extension being read-only, so they stay opt-in together.',
  },
  {
    key: 'showConversationViewer',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'features',
    label: 'Enable conversation viewer',
    help: 'On by default. The Sessions tab shows a "view" button that opens a read-only reader for a past conversation — so you can re-read your prompts and the model\'s answers to jog your memory WITHOUT loading them back into the model\'s context (unlike resume). It only reads your local log files (read-only), so it is on by default; turn it off to hide the button.',
  },
  {
    key: 'timezone',
    type: 'enum',
    default: '',
    storage: 'state',
    group: 'general',
    label: 'Timezone for dates',
    help: 'Pick a common zone or a UTC offset (every offset is covered), or the system default. Labels show the current UTC offset.',
    enumValues: TIMEZONE_VALUES,
    enumLabels: TIMEZONE_LABELS,
    enumGroups: TIMEZONE_GROUPS,
    providers: ['claude', 'codex'],
  },
  {
    key: 'projectGroupingMode',
    type: 'enum',
    default: 'git',
    storage: 'state',
    group: 'general',
    label: 'Projects grouping',
    help: 'git = by repo · folder = top-level · flat = each cwd.',
    enumValues: ['git', 'folder', 'flat'],
  },

  // --- Status bar ---
  {
    key: 'statusBarProvider',
    type: 'enum',
    default: 'auto',
    storage: 'state',
    group: 'statusBar',
    label: 'Status-bar provider',
    help: 'Auto prefers Claude when both providers have data.',
    enumValues: ['auto', 'claude', 'codex'],
    enumLabels: ['Auto', 'Claude', 'Codex'],
    providers: ['claude', 'codex'],
  },
  {
    key: 'codex.statusMetric',
    type: 'enum',
    default: 'processed',
    storage: 'state',
    group: 'statusBar',
    label: 'Codex status metric',
    help: "Today's processed tokens (default), uncached usage, or output tokens.",
    enumValues: ['processed', 'fresh', 'output'],
    enumLabels: ['Processed', 'Uncached', 'Output'],
    providers: ['codex'],
  },
  {
    key: 'showCost',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'statusBar',
    label: "Show today's cost / tokens",
  },
  {
    key: 'statusBarMetric',
    type: 'enum',
    default: 'cost',
    storage: 'state',
    group: 'statusBar',
    label: 'Status-bar metric',
    help: "What the first status-bar item shows: today's cost, this month's cost, or today's total token count (k/M).",
    enumValues: ['cost', 'monthly-cost', 'tokens'],
    enumLabels: ["Today's cost", "Monthly cost", 'Token count'],
  },
  {
    key: 'showContext',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'statusBar',
    label: 'Show context-window fill (experimental)',
    help:
      'Off by default. Estimates the current session context %, like /context, from the latest log record. It can only show the input-side total, not /context’s category breakdown (those are Claude Code internals not written to disk), so it is approximate — a "~" marks a guessed window size.',
  },
  {
    key: 'contextWindowOverride',
    type: 'number',
    default: 0,
    storage: 'state',
    group: 'statusBar',
    label: 'Context window override (tokens)',
    help: '0 = auto-detect from the model. Set your real window (e.g. 1000000) for proxied/custom models the auto-detect cannot recognise.',
    min: 0,
    max: 10_000_000,
  },
  {
    key: 'usageLimitTracking',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'statusBar',
    label: 'Show 5h / weekly quota',
  },
  {
    // Opt-in model-scoped weekly caps in the status bar. Was showOpusWeekly
    // (PR #38, @wheelbarrel00) until the API began naming the scope itself.
    key: 'showScopedWeekly',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'statusBar',
    label: 'Show per-model weekly limit',
    help: 'Add any model-specific weekly cap your plan meters to the weekly figure, e.g. "wk 9% (fable 17%)", once it has usage against it. Anthropic supplies the name, so it follows whichever model is capped. Leaving this off does not hide it from the tooltip.',
  },
  {
    // Show only the 5-hour quota window; drop every weekly figure from the bar.
    key: 'quotaFiveHourOnly',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'statusBar',
    label: 'Quota: 5-hour window only',
    help: 'Show only the 5-hour quota in the status bar, hiding the weekly figures (reset details stay in the tooltip).',
  },
  {
    // Append the 5h / weekly reset countdown to the status-bar quota item.
    key: 'showResetInStatusBar',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'statusBar',
    label: 'Quota: show reset countdown',
    help: 'Append a compact reset countdown in the status bar (5h 6% ↻4.8h). Off keeps it clean (5h 6% · wk 1%); the tooltip always shows full reset times.',
  },
  {
    // Format of the reset countdown appended by showResetInStatusBar (#74).
    key: 'resetCountdownFormat',
    type: 'enum',
    default: 'decimal',
    storage: 'state',
    group: 'statusBar',
    label: 'Quota: reset countdown format',
    help: 'Only applies when "Quota: show reset countdown" is on. Decimal (4.8h / 1.6d), whole units (4h 48m / 1d 14h), or your computer\'s local clock time / date (18:20 / 2026-07-22).',
    enumValues: ['decimal', 'units', 'clock'],
    enumLabels: ['Decimal (4.8h / 1.6d)', 'Units (4h 48m / 1d 14h)', 'Local time (18:20 / 2026-07-22)'],
  },
  {
    // Explicit status-bar layout replacing the built-in one; grammar in quotaFormat.ts.
    key: 'statusBarQuotaFormat',
    type: 'string',
    default: '',
    storage: 'state',
    group: 'statusBar',
    label: 'Quota: status bar format',
    help: 'Empty keeps the built-in layout (5h 6% · wk 1%). Otherwise: {5h.pct}, {wk.pct} (or {7d.pct}) and {model:Fable.pct}, each also taking .reset and .label — e.g. "{5h.pct} | {7d.pct} · {model:Fable.pct}". A window your plan does not report renders empty. .reset can name its own style: {5h.reset:units}, :decimal, :clock or :at (wall clock).',
    maxLength: 120,
  },
  {
    key: 'workflowQuotaWarnPercent',
    type: 'number',
    default: 50,
    storage: 'state',
    group: 'statusBar',
    label: 'Workflow quota warning %',
    help: 'Warn before a run when remaining 5h quota is below this. 0 = off.',
    min: 0,
    max: 100,
  },

  // --- Data & refresh ---
  {
    key: 'dataDirectory',
    type: 'string',
    default: '',
    storage: 'config',
    group: 'data',
    label: 'Custom data directory',
    help: 'Claude data dir; empty = auto-detect.',
  },
  {
    key: 'refreshInterval',
    type: 'number',
    default: 60,
    storage: 'state',
    group: 'data',
    label: 'Refresh interval (s)',
    min: 30,
    max: 3600,
  },
  {
    key: 'fileWatchSeconds',
    type: 'enum',
    default: '2',
    storage: 'state',
    group: 'data',
    label: 'Live refresh delay',
    help: 'Wait after the last local JSONL change before refreshing (quiet debounce; each new event restarts the delay). No API call is made; quota fetches are throttled separately. Off disables watching, and 60–300s is the lowest-CPU option for large histories.',
    enumValues: [...LIVE_REFRESH_SECONDS],
    enumLabels: ['Off', '1s', '2s', '5s', '10s', '20s', '30s', '60s', '120s', '300s'],
  },
  {
    // V2.2: positive wording, replacing the old double-negative
    // `pauseDashboardRefresh` (migrated by SettingsStore.migrateDashboardAutoRefresh).
    key: 'dashboardAutoRefresh',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'data',
    label: 'Dashboard auto-refresh',
    help: 'Auto-refresh the dashboard as new usage lands. Off = manual refresh only (the status bar still updates).',
    providers: ['claude', 'codex'],
  },
  {
    key: 'enableContentAnalysis',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'data',
    label: 'Content analysis (Content tab)',
    help: 'Disable to skip the CPU-heavy text scan.',
  },
  {
    key: 'analysis.calibrate',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'data',
    label: 'Calibrate content figures',
    help: 'Scale estimates to exact billed token totals.',
  },

  // --- AI advice & Optimizer ---
  {
    key: 'advice.effectiveness.enabled',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'advice',
    label: 'Enable AI advice effectiveness preview',
    help: 'Off by default. Shows local evidence, an optional exact BYOK request preview/send flow, local feedback, and comparable-task results. Previewing never sends; sending requires a separate click.',
    providers: ['claude', 'codex'],
  },
  // Claude Code OAuth/subscription credentials remain quota-only. AI requests
  // have no dormant subscription transport: both surfaces require an exact
  // Prepared preview plus a separate Send click through configured BYOK.
  {
    key: 'advice.apiKey',
    type: 'string',
    default: '',
    storage: 'secret',
    group: 'advice',
    label: 'API key',
    help: 'Bring-your-own key for the configured endpoint. It is stored in VS Code SecretStorage and is never sent to the dashboard or placed in a preview body.',
    secret: true,
  },
  {
    key: 'advice.apiFormat',
    type: 'enum',
    default: 'anthropic',
    storage: 'state',
    group: 'advice',
    label: 'API format',
    help: 'anthropic = /v1/messages · openai = chat-completions.',
    enumValues: ['anthropic', 'openai'],
  },
  {
    key: 'advice.apiUrl',
    type: 'string',
    default: 'https://api.deepseek.com/chat/completions',
    storage: 'state',
    group: 'advice',
    label: 'API URL',
    help: 'Endpoint for the api backend.',
  },
  {
    key: 'advice.model',
    type: 'string',
    default: 'deepseek-v4-pro',
    storage: 'state',
    group: 'advice',
    label: 'API model',
  },
  {
    key: 'advice.reasoningEffort',
    type: 'enum',
    default: 'max',
    storage: 'state',
    group: 'advice',
    label: 'Reasoning effort (openai)',
    enumValues: ['', 'high', 'max'],
    enumLabels: ['(off)', 'high', 'max'],
  },
  {
    key: 'advice.promptWindowDays',
    type: 'number',
    default: 30,
    storage: 'state',
    group: 'advice',
    label: 'Evidence and prompt window (days)',
    min: 1,
    max: 365,
  },
  {
    key: 'advice.userContext',
    type: 'string',
    default: '',
    storage: 'state',
    group: 'advice',
    label: 'Personal/project context',
    help: 'Optional free text. It may leave the machine only with separate prompt-personalization consent and appears verbatim in the exact request preview.',
    multiline: true,
  },
  {
    key: 'advice.optimizer.enabled',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'advice',
    label: 'Enable Usage Optimizer',
    help: 'Show the opt-in Optimizer card on the Content tab. Its user-draft-only request is previewed before a separate Send action.',
  },
];

/** Exact globalState entries owned by the current catalog or known releases. */
export const OWNED_SETTING_GLOBAL_STATE_KEYS: readonly string[] = [
  ...SETTINGS
    .filter((definition) => definition.storage === 'state' || definition.storage === 'secret')
    .map((definition) => STATE_PREFIX + definition.key),
  ...RETIRED_SETTING_KEYS.map((key) => STATE_PREFIX + key),
];

/** Only these still-registered configuration keys may be updated through VS Code. */
export const REGISTERED_CONFIGURATION_SETTING_KEYS: readonly string[] = SETTINGS
  .filter((definition) => definition.storage === 'config')
  .map((definition) => definition.key);

/** Current and released keys inspected before a local-data clear. */
export const KNOWN_CONFIGURATION_SETTING_KEYS: readonly string[] = [
  ...new Set([
    ...SETTINGS.map((definition) => definition.key),
    ...RETIRED_SETTING_KEYS,
  ]),
];

const BY_KEY: Map<string, SettingDef> = new Map(SETTINGS.map((d) => [d.key, d]));

/** A snapshot of one setting for the webview panel: definition + current value. */
export interface SettingView extends SettingDef {
  value: boolean | number | string;
  /** Secret values never cross into the webview; it receives only this bit. */
  configured?: boolean;
}

/**
 * Read/write layer over VS Code configuration, globalState, and SecretStorage.
 * All entries are addressed by the same dotted catalog key.
 */
export class SettingsStore {
  private readonly secretValues = new Map<string, string>();

  constructor(private context: vscode.ExtensionContext) {}

  private secretKey(key: string): string {
    return SECRET_PREFIX + key;
  }

  /**
   * Load secrets before the extension starts. Legacy plaintext values migrate
   * only after SecretStorage succeeds, then are removed from globalState and
   * the old global configuration entry. This method is idempotent.
   */
  async initializeSecrets(): Promise<void> {
    // A retry must never leave a previously loaded key available after a
    // failed migration or SecretStorage read.
    this.secretValues.clear();
    const secrets = this.context.secrets;
    if (!secrets) {
      throw new SettingsSecretMigrationError('secret-storage-unavailable');
    }
    try {
      const rootConfiguration = this.cfg();
      for (const def of SETTINGS) {
        if (def.storage !== 'secret') {
          continue;
        }
        const storageKey = this.secretKey(def.key);
        let value = await secrets.get(storageKey);
        const legacyStateKey = STATE_PREFIX + def.key;
        const legacyState = this.context.globalState.get<unknown>(legacyStateKey);
        const inspected = rootConfiguration.inspect<unknown>(def.key);
        const folderScopes = (vscode.workspace.workspaceFolders ?? []).map((folder) => {
          const configuration = vscode.workspace.getConfiguration('claudeCodeUsage', folder.uri);
          return {
            configuration,
            value: configuration.inspect<unknown>(def.key)?.workspaceFolderValue,
          };
        });
        const legacyScopes = [
          legacyState,
          inspected?.globalValue,
          inspected?.workspaceValue,
          ...folderScopes.map((scope) => scope.value),
        ];
        const strings = legacyScopes
          .filter((candidate): candidate is string => typeof candidate === 'string')
          .map((candidate) => candidate.trim())
          .filter((candidate) => candidate !== '');

        const configurationPlaintext = [
          inspected?.globalValue,
          inspected?.workspaceValue,
          ...folderScopes.map((scope) => scope.value),
        ].some((candidate) =>
          typeof candidate === 'string' && candidate.trim() !== '',
        );
        if (configurationPlaintext) {
          // `advice.apiKey` is intentionally no longer registered. VS Code
          // refuses programmatic updates to unregistered settings, so an
          // automatic migration could copy the secret yet leave plaintext in
          // settings.json. Require explicit manual removal instead.
          throw new SettingsSecretMigrationError(
            'workspace-secret-requires-manual-migration',
          );
        }

        if (!value) {
          const machineCandidates = [legacyState, inspected?.globalValue]
            .filter((candidate): candidate is string => typeof candidate === 'string')
            .map((candidate) => candidate.trim())
            .filter((candidate) => candidate !== '');
          const distinctMachineCandidates = [...new Set(machineCandidates)];
          if (distinctMachineCandidates.length > 1) {
            throw new SettingsSecretMigrationError('legacy-secret-conflict');
          }
          const machineCandidate = distinctMachineCandidates[0];
          const workspaceCandidates = [
            inspected?.workspaceValue,
            ...folderScopes.map((scope) => scope.value),
          ].filter((candidate): candidate is string => typeof candidate === 'string');

          if (!machineCandidate && workspaceCandidates.some((candidate) => candidate.trim() !== '')) {
            // A global SecretStorage slot cannot safely preserve a workspace-
            // specific key. Leave the plaintext untouched and ask the user to
            // migrate it explicitly instead of selecting one folder silently.
            throw new SettingsSecretMigrationError('workspace-secret-requires-manual-migration');
          }
          if (
            machineCandidate &&
            workspaceCandidates.some((candidate) => candidate.trim() !== machineCandidate)
          ) {
            throw new SettingsSecretMigrationError('legacy-secret-conflict');
          }
          if (machineCandidate) {
            // A second Extension Host may have completed the same machine-wide
            // migration after our first read. Re-read before writing; all safe
            // automatic candidates are already required to be identical.
            const concurrentValue = await secrets.get(storageKey);
            if (concurrentValue) {
              value = concurrentValue;
            } else {
              await secrets.store(storageKey, machineCandidate);
              value = machineCandidate;
            }
          }
        }

        // Delete legacy entries only when a secure value is present, or when
        // every explicit legacy entry is empty. This prevents a partial
        // migration from destroying the only recoverable credential.
        if (value || strings.length === 0) {
          if (legacyState !== undefined) {
            await this.context.globalState.update(legacyStateKey, undefined);
          }
        }
        if (value) {
          this.secretValues.set(def.key, value);
        }
      }
    } catch (error) {
      if (error instanceof SettingsSecretMigrationError) {
        throw error;
      }
      throw new SettingsSecretMigrationError('secret-storage-failed');
    }
  }

  /** Secret migration is advice-only; a failure must not disable usage views. */
  async initializeSecretsForActivation(): Promise<SettingsSecretMigrationErrorCode | null> {
    try {
      await this.initializeSecrets();
      return null;
    } catch (error) {
      this.secretValues.clear();
      return error instanceof SettingsSecretMigrationError
        ? error.code
        : 'secret-storage-failed';
    }
  }

  private cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('claudeCodeUsage');
  }

  /** Current value for a key (typed by the caller), with the catalog default. */
  get<T>(key: string): T {
    const def = BY_KEY.get(key);
    if (!def) {
      throw new Error(`Unknown setting: ${key}`);
    }
    if (def.storage === 'config') {
      return this.cfg().get<T>(def.key, def.default as unknown as T);
    }
    if (def.storage === 'secret') {
      return (this.secretValues.get(def.key) ?? def.default) as unknown as T;
    }
    const value = this.context.globalState.get<T>(
      STATE_PREFIX + def.key,
      def.default as unknown as T,
    );
    return (def.key === 'displayCurrency'
      ? normalizeDisplayCurrencyCode(value)
      : value) as T;
  }

  /** Persist a value to whichever store owns the key. */
  async set(key: string, value: boolean | number | string): Promise<void> {
    const def = BY_KEY.get(key);
    if (!def) {
      throw new Error(`Unknown setting: ${key}`);
    }
    const coerced = this.coerce(def, value);
    if (def.storage === 'config') {
      await this.cfg().update(def.key, coerced, vscode.ConfigurationTarget.Global);
    } else if (def.storage === 'secret') {
      const secret = String(coerced).trim();
      if (secret === '') {
        await this.context.secrets.delete(this.secretKey(def.key));
        this.secretValues.delete(def.key);
      } else {
        await this.context.secrets.store(this.secretKey(def.key), secret);
        this.secretValues.set(def.key, secret);
      }
    } else {
      await this.context.globalState.update(STATE_PREFIX + def.key, coerced);
    }
  }

  /** Restore one setting to its catalog default. */
  async reset(key: string): Promise<void> {
    const def = BY_KEY.get(key);
    if (!def) {
      return;
    }
    if (def.storage === 'config') {
      await this.cfg().update(def.key, undefined, vscode.ConfigurationTarget.Global);
    } else if (def.storage === 'secret') {
      await this.context.secrets.delete(this.secretKey(def.key));
      this.secretValues.delete(def.key);
    } else {
      await this.context.globalState.update(STATE_PREFIX + def.key, undefined);
    }
  }

  private explicitConfigurationScopes(key: string): Array<{
    configuration: vscode.WorkspaceConfiguration;
    target: vscode.ConfigurationTarget;
  }> {
    const scopes: Array<{
      configuration: vscode.WorkspaceConfiguration;
      target: vscode.ConfigurationTarget;
    }> = [];
    const root = this.cfg();
    const rootValues = root.inspect<unknown>(key);
    if (rootValues?.globalValue !== undefined) {
      scopes.push({ configuration: root, target: vscode.ConfigurationTarget.Global });
    }
    const workspaceOpen = vscode.workspace.workspaceFile !== undefined ||
      (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    if (workspaceOpen && rootValues?.workspaceValue !== undefined) {
      scopes.push({ configuration: root, target: vscode.ConfigurationTarget.Workspace });
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const configuration = vscode.workspace.getConfiguration('claudeCodeUsage', folder.uri);
      if (configuration.inspect<unknown>(key)?.workspaceFolderValue !== undefined) {
        scopes.push({
          configuration,
          target: vscode.ConfigurationTarget.WorkspaceFolder,
        });
      }
    }
    return scopes;
  }

  private preflightConfigurationClear(keys: readonly string[]): void {
    const registered = new Set(REGISTERED_CONFIGURATION_SETTING_KEYS);
    const blocked = keys.filter((key) =>
      !registered.has(key) && this.explicitConfigurationScopes(key).length > 0,
    );
    if (blocked.length > 0) {
      // VS Code rejects updates to keys no longer registered by the current
      // manifest. Stop before deleting SecretStorage/globalState so the user
      // never receives a misleading partial-clear success.
      throw new SettingsLocalDataClearError([...new Set(blocked)].sort());
    }
  }

  private async clearRegisteredConfigurationScopes(key: string): Promise<void> {
    for (const scope of this.explicitConfigurationScopes(key)) {
      await scope.configuration.update(key, undefined, scope.target);
    }
  }

  private async clearOwnedSetting(def: SettingDef): Promise<void> {
    if (def.storage === 'state') {
      await this.context.globalState.update(STATE_PREFIX + def.key, undefined);
    } else if (def.storage === 'secret') {
      await this.context.secrets.delete(this.secretKey(def.key));
      this.secretValues.delete(def.key);
      // Released development builds briefly used the state slot as a
      // plaintext migration source. Remove only this exact key.
      await this.context.globalState.update(STATE_PREFIX + def.key, undefined);
    }
    if (def.storage === 'config') {
      await this.clearRegisteredConfigurationScopes(def.key);
    }
  }

  private async verifyOwnedSettingsCleared(definitions: readonly SettingDef[]): Promise<void> {
    for (const definition of definitions) {
      if (
        (definition.storage === 'state' || definition.storage === 'secret') &&
        this.context.globalState.get(STATE_PREFIX + definition.key) !== undefined
      ) {
        throw new Error('settings-local-data-clear:state-postcondition-failed');
      }
      if (
        definition.storage === 'secret' &&
        await this.context.secrets.get(this.secretKey(definition.key)) !== undefined
      ) {
        throw new Error('settings-local-data-clear:secret-postcondition-failed');
      }
      if (
        definition.storage === 'config' &&
        this.explicitConfigurationScopes(definition.key).length > 0
      ) {
        throw new Error('settings-local-data-clear:configuration-postcondition-failed');
      }
    }
  }

  /** Clear a bounded subset of catalogued settings from every visible scope. */
  async resetOwnedSettings(keys: readonly string[]): Promise<void> {
    const definitions = keys.map((key) => {
      const definition = BY_KEY.get(key);
      if (!definition) throw new Error(`Unknown setting: ${key}`);
      return definition;
    });
    this.preflightConfigurationClear(definitions.map((definition) => definition.key));
    for (const def of definitions) {
      await this.clearOwnedSetting(def);
    }
    await this.verifyOwnedSettingsCleared(definitions);
  }

  /** Clear the secret and every exact plaintext migration location we can inspect. */
  async clearByokOwnedData(): Promise<void> {
    await this.resetOwnedSettings(['advice.apiKey']);
  }

  /** Reset both host-side feature toggles owned by sharing/heatmap UI. */
  async resetSharingOwnedData(): Promise<void> {
    await this.resetOwnedSettings(['showHeatmap', 'enableShareCard']);
  }

  preflightResetAllOwnedData(): void {
    this.preflightConfigurationClear(KNOWN_CONFIGURATION_SETTING_KEYS);
  }

  /**
   * Clear the exact settings catalog from globalState, SecretStorage, and all
   * currently inspectable configuration scopes. This is intentionally an
   * allowlist; it never deletes arbitrary `claudeCodeUsage` configuration.
   */
  async resetAllOwnedData(): Promise<void> {
    this.preflightResetAllOwnedData();
    for (const def of SETTINGS) {
      await this.clearOwnedSetting(def);
    }
    // Retired names are migration inputs, not an invitation to prefix-delete
    // unknown future settings.
    for (const key of RETIRED_SETTING_KEYS) {
      await this.context.globalState.update(STATE_PREFIX + key, undefined);
    }
    await this.verifyOwnedSettingsCleared(SETTINGS);
    for (const key of RETIRED_SETTING_KEYS) {
      if (this.context.globalState.get(STATE_PREFIX + key) !== undefined) {
        throw new Error('settings-local-data-clear:retired-state-postcondition-failed');
      }
    }
  }

  /** Clamp/validate a value against the def so the panel can't store garbage. */
  private coerce(def: SettingDef, value: boolean | number | string): boolean | number | string {
    if (def.type === 'boolean') {
      return !!value;
    }
    if (def.type === 'number') {
      let n = typeof value === 'number'
        ? value
        : String(value).trim() === ''
          ? Number.NaN
          : Number(value);
      if (!Number.isFinite(n)) {
        n = def.default as number;
      }
      if (def.min !== undefined) {
        n = Math.max(def.min, n);
      }
      if (def.max !== undefined) {
        n = Math.min(def.max, n);
      }
      return n;
    }
    if (def.type === 'enum') {
      if (def.key === 'displayCurrency') {
        return normalizeDisplayCurrencyCode(value);
      }
      const allowed = def.enumValues || [];
      return allowed.includes(String(value)) ? String(value) : (def.default as string);
    }
    const stringValue = String(value);
    return def.maxLength === undefined
      ? stringValue
      : Array.from(stringValue).slice(0, def.maxLength).join('');
  }

  /** Catalog + current values, for rendering the dashboard settings panel. */
  snapshot(): SettingView[] {
    return SETTINGS.map((def) => def.storage === 'secret'
      ? {
          ...def,
          value: '',
          configured: this.secretValues.has(def.key),
        }
      : { ...def, value: this.get(def.key) });
  }

  /**
   * One-time migration when upgrading from a version that declared every
   * setting in package.json: copy any explicit user value from settings.json
   * into globalState for the keys that have since moved. Idempotent — guarded
   * by a globalState flag — so it runs at most once.
   */
  async migrateOnce(): Promise<void> {
    if (this.context.globalState.get<boolean>(MIGRATION_FLAG, false)) {
      return;
    }
    const cfg = this.cfg();
    for (const def of SETTINGS) {
      if (def.storage !== 'state') {
        continue;
      }
      // Only copy if the user has no globalState value yet AND had set an
      // explicit value in settings.json (inspect still reports it even though
      // the key is no longer declared).
      const already = this.context.globalState.get(STATE_PREFIX + def.key);
      if (already !== undefined) {
        continue;
      }
      const info = cfg.inspect(def.key);
      const userVal =
        info?.globalValue ??
        info?.workspaceFolderValue ??
        info?.workspaceValue;
      if (userVal !== undefined) {
        await this.context.globalState.update(STATE_PREFIX + def.key, this.coerce(def, userVal as never));
      }
    }
    await this.context.globalState.update(MIGRATION_FLAG, true);
  }

  /**
   * One-shot V2.2 migration: the old `pauseDashboardRefresh` (double negative)
   * becomes `dashboardAutoRefresh` (positive), inverted:
   *   pauseDashboardRefresh === true  → dashboardAutoRefresh = false
   *   false / undefined               → dashboardAutoRefresh = true (the default)
   * Reads the old value from globalState (2.1) or settings.json (pre-2.1).
   */
  async migrateDashboardAutoRefresh(): Promise<void> {
    if (this.context.globalState.get<boolean>(AUTOREFRESH_MIGRATION_FLAG, false)) {
      return;
    }
    const newKey = STATE_PREFIX + 'dashboardAutoRefresh';
    if (this.context.globalState.get(newKey) === undefined) {
      let oldPause = this.context.globalState.get<boolean>(STATE_PREFIX + 'pauseDashboardRefresh');
      if (oldPause === undefined) {
        const info = this.cfg().inspect('pauseDashboardRefresh');
        const v = info?.globalValue ?? info?.workspaceFolderValue ?? info?.workspaceValue;
        if (typeof v === 'boolean') {
          oldPause = v;
        }
      }
      // Only write when the user had actually set the old flag; otherwise leave
      // dashboardAutoRefresh at its catalog default (true).
      if (oldPause !== undefined) {
        await this.context.globalState.update(newKey, !oldPause);
      }
    }
    await this.context.globalState.update(AUTOREFRESH_MIGRATION_FLAG, true);
  }

  /**
   * One-shot rename: `showOpusWeekly` → `showScopedWeekly`, same meaning, no
   * inversion. Anyone who opted into the weekly Opus figure wanted the scoped
   * weekly cap, whatever model it now names, so the old value carries straight
   * over. Reads from globalState (2.1+) or settings.json (pre-2.1).
   */
  async migrateScopedWeekly(): Promise<void> {
    if (this.context.globalState.get<boolean>(SCOPED_WEEKLY_MIGRATION_FLAG, false)) {
      return;
    }
    const newKey = STATE_PREFIX + 'showScopedWeekly';
    if (this.context.globalState.get(newKey) === undefined) {
      let old = this.context.globalState.get<boolean>(STATE_PREFIX + 'showOpusWeekly');
      if (old === undefined) {
        const info = this.cfg().inspect('showOpusWeekly');
        const v = info?.globalValue ?? info?.workspaceFolderValue ?? info?.workspaceValue;
        if (typeof v === 'boolean') {
          old = v;
        }
      }
      // Only write when the old flag was actually set; otherwise leave
      // showScopedWeekly at its catalog default (false).
      if (old !== undefined) {
        await this.context.globalState.update(newKey, old);
      }
    }
    await this.context.globalState.update(SCOPED_WEEKLY_MIGRATION_FLAG, true);
  }

  /**
   * Replace the early 2.3.2 free-form currency pair with one preset code.
   * Existing supported codes and unambiguous symbols survive; the obsolete
   * manual multiplier is removed because bundled rates are now authoritative.
   */
  async migrateCurrencyPreset(): Promise<void> {
    if (this.context.globalState.get<boolean>(CURRENCY_PRESET_MIGRATION_FLAG, false)) {
      return;
    }
    const currencyKey = STATE_PREFIX + 'displayCurrency';
    const storedCurrency = this.context.globalState.get<unknown>(currencyKey);
    if (storedCurrency !== undefined) {
      await this.context.globalState.update(
        currencyKey,
        normalizeDisplayCurrencyCode(storedCurrency),
      );
    }
    await this.context.globalState.update(STATE_PREFIX + 'usdConversionRate', undefined);
    await this.context.globalState.update(CURRENCY_PRESET_MIGRATION_FLAG, true);
  }
}
