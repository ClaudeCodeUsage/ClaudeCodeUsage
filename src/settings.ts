import * as vscode from 'vscode';

// Single source of truth for every user setting (V2.1: "settings in the
// dashboard"). Most settings moved OUT of VS Code's Settings UI to keep it
// uncluttered — they live in the extension's own globalState and are edited
// from the dashboard's ⚙ Settings tab. A small core stays declared in
// package.json so it remains editable in settings.json and travels with
// Settings Sync:
//   - language        (UI language; people sync this)
//   - dataDirectory   (machine-specific path a power user may script)
//   - advice.apiKey   (a secret some keep in their synced settings)
//
// The catalog below drives BOTH the read/write plumbing and the dashboard
// panel rendering, so adding a setting is a one-line change here.
//
// Setting labels/help are intentionally English (technical identifiers); the
// panel chrome — group headers, buttons, notes — is localised via i18n.

export type SettingType = 'boolean' | 'number' | 'enum' | 'string';
export type SettingStorage = 'config' | 'state';
export type SettingGroup = 'general' | 'features' | 'statusBar' | 'data' | 'advice';

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
  secret?: boolean; // mask the input (apiKey)
  multiline?: boolean; // render a textarea
}

// globalState key prefix for moved settings — namespaced to avoid colliding
// with other globalState entries (consent flags, dismissals, …).
const STATE_PREFIX = 'ccu.setting.';
const MIGRATION_FLAG = 'ccu.settingsMigrated.v1';
// V2.2: one-shot conversion of the old double-negative pauseDashboardRefresh to
// the positive dashboardAutoRefresh. Its own flag so it runs even for users who
// already passed the v1 migration.
const AUTOREFRESH_MIGRATION_FLAG = 'ccu.migrated.dashboardAutoRefresh';

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
  { zone: 'Asia/Shanghai', city: 'Shanghai' },
  { zone: 'Asia/Hong_Kong', city: 'Hong Kong' },
  { zone: 'Asia/Singapore', city: 'Singapore' },
  { zone: 'Asia/Tokyo', city: 'Tokyo' },
  { zone: 'Asia/Seoul', city: 'Seoul' },
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
    enumValues: ['auto', 'en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR'],
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
  },
  {
    key: 'compactNumbers',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'general',
    label: 'Compact token counts',
    help: 'Show 1.2M / 345K instead of full numbers.',
  },
  {
    key: 'showHeatmap',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'features',
    label: 'Show token heatmap (All tab)',
    help: 'Show a GitHub-style yearly token heatmap on the All tab. Off by default — mainly a shareable view of what you can already see elsewhere. Use "Export Token Heatmap" for a GitHub-profile SVG.',
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
    default: false,
    storage: 'state',
    group: 'features',
    label: 'Enable usage share card',
    help: 'Off by default. When on, the All tab gets a configurable "Share card" — pick a range (week / month / year / a specific month), a scope (overall / a project / a session) and which metrics to show, then generate a one-page SVG to share. Only aggregate numbers leave your machine, and only when you export.',
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
    key: 'enableSessionDelete',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'features',
    label: 'Enable "delete session" action',
    help: 'Off by default. When on, the Sessions tab shows a delete button that moves a conversation\'s log file to the OS trash. This touches your local Claude Code history files, so it stays opt-in.',
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
    // Opt-in weekly Opus limit in the status bar (PR #38, @wheelbarrel00).
    key: 'showOpusWeekly',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'statusBar',
    label: 'Show weekly Opus limit',
    help: 'Append the weekly Opus cap (opus:NN%) after the 5h / weekly figures.',
  },
  {
    // Show only the 5-hour quota window; drop weekly / Opus from the status bar.
    key: 'quotaFiveHourOnly',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'statusBar',
    label: 'Quota: 5-hour window only',
    help: 'Show only the 5-hour quota in the status bar, hiding the weekly figure (reset details stay in the tooltip).',
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
    key: 'fileWatching',
    type: 'boolean',
    default: true,
    storage: 'state',
    group: 'data',
    label: 'Live file watching',
    help: 'Refresh ~1.5s after each new message.',
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
  // NOTE: the 'subscription' backend (call Anthropic with the Claude Code OAuth
  // session, no API key) is intentionally NOT shipped in this version. Anthropic
  // returns 403 "Request not allowed" for that gray-area use of the OAuth token
  // (it only succeeds by routing around the TLS-fingerprint gate via curl), so
  // it is too fragile/inappropriate for a public extension. The transport code
  // stays in advisor.ts, dormant, to re-enable if direct calls become allowed.
  {
    key: 'advice.apiKey',
    type: 'string',
    default: '',
    storage: 'config',
    group: 'advice',
    label: 'API key',
    help: 'For the api backend. Stays in VS Code settings.',
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
    label: 'Prompt sample window (days)',
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
    help: 'Optional background; adds a "Personalised" section.',
    multiline: true,
  },
  {
    key: 'advice.optimizer.enabled',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'advice',
    label: 'Enable Usage Optimizer',
    help: 'Show the opt-in Optimizer card on the Content tab.',
  },
];

const BY_KEY: Map<string, SettingDef> = new Map(SETTINGS.map((d) => [d.key, d]));

/** A snapshot of one setting for the webview panel: definition + current value. */
export interface SettingView extends SettingDef {
  value: boolean | number | string;
}

/**
 * Read/write layer over the two stores. Core settings live in VS Code config;
 * the rest live in globalState. Both are addressed by the same dotted key.
 */
export class SettingsStore {
  constructor(private context: vscode.ExtensionContext) {}

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
    return this.context.globalState.get<T>(STATE_PREFIX + def.key, def.default as unknown as T);
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
    } else {
      await this.context.globalState.update(STATE_PREFIX + def.key, undefined);
    }
  }

  /** Clamp/validate a value against the def so the panel can't store garbage. */
  private coerce(def: SettingDef, value: boolean | number | string): boolean | number | string {
    if (def.type === 'boolean') {
      return !!value;
    }
    if (def.type === 'number') {
      let n = typeof value === 'number' ? value : Number(value);
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
      const allowed = def.enumValues || [];
      return allowed.includes(String(value)) ? String(value) : (def.default as string);
    }
    return String(value);
  }

  /** Catalog + current values, for rendering the dashboard settings panel. */
  snapshot(): SettingView[] {
    return SETTINGS.map((def) => ({ ...def, value: this.get(def.key) }));
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
}
