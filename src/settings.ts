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
export type SettingGroup = 'general' | 'statusBar' | 'data' | 'advice';

export interface SettingDef {
  key: string; // dotted config key, e.g. 'advice.backend'
  type: SettingType;
  default: boolean | number | string;
  storage: SettingStorage;
  group: SettingGroup;
  label: string; // short English label shown in the panel
  help?: string; // one-line English help
  enumValues?: string[]; // for type 'enum'
  enumLabels?: string[]; // optional display labels (defaults to enumValues)
  min?: number;
  max?: number;
  secret?: boolean; // mask the input (apiKey)
  multiline?: boolean; // render a textarea
}

// globalState key prefix for moved settings — namespaced to avoid colliding
// with other globalState entries (consent flags, dismissals, …).
const STATE_PREFIX = 'ccu.setting.';
const MIGRATION_FLAG = 'ccu.settingsMigrated.v1';

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
    enumValues: ['auto', 'en', 'zh-TW', 'zh-CN', 'ja', 'ko'],
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
    key: 'compactNumbers',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'general',
    label: 'Compact token counts',
    help: 'Show 1.2M / 345K instead of full numbers.',
  },
  {
    key: 'timezone',
    type: 'string',
    default: '',
    storage: 'state',
    group: 'general',
    label: 'Timezone for dates',
    help: 'IANA zone (e.g. Asia/Hong_Kong). Empty = system.',
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
    label: 'Show only the 5-hour quota',
    help: 'Hide the weekly (and Opus) windows; show just the 5-hour utilisation.',
  },
  {
    // Append the 5h / weekly reset countdown to the status-bar quota item.
    key: 'showResetInStatusBar',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'statusBar',
    label: 'Show quota reset time in status bar',
    help: 'Append the reset countdown (e.g. "5h:50%:2.3h") to the status-bar quota item.',
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
    key: 'pauseDashboardRefresh',
    type: 'boolean',
    default: false,
    storage: 'state',
    group: 'data',
    label: 'Pause dashboard auto-refresh',
    help: 'Status bar still updates; dashboard only on manual refresh.',
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
}
