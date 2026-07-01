import * as vscode from 'vscode';
import { ClaudeDataLoader } from './dataLoader';
import { I18n } from './i18n';
import { getModelRatesPerMillion } from './pricing';
import { SETTINGS, SettingsStore, SettingView } from './settings';
import { buildResumeCommand, isUsableCwd, isValidSessionId, isUnderDir } from './sessionResume';
import { renderHeatmapSvg } from './heatmapSvg';
import {
  AttributionScope,
  BranchUsage,
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

export class UsageWebviewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private currentSessionData: SessionData | null = null;
  private todayData: UsageData | null = null;
  private monthData: UsageData | null = null;
  private allTimeData: UsageData | null = null;
  private dailyDataForMonth: { date: string; data: UsageData }[] = [];
  private dailyDataForAllTime: { date: string; data: UsageData }[] = [];
  private hourlyDataForToday: { hour: string; data: UsageData }[] = [];
  private isLoading: boolean = false;
  private error: string | null = null;
  private dataDirectory: string | null = null;
  private currentTab: string = 'today';
  private hourlyDataCache: Map<string, { hour: string; data: UsageData }[]> = new Map();
  private allRecords: any[] = [];
  private sessionBreakdown: SessionUsage[] = [];
  private projectBreakdown: ProjectGroup[] = [];
  private contentAnalysis: ContentAnalysis | null = null;
  private branchBreakdown: BranchUsage[] = [];
  private workflowBreakdown: WorkflowUsage[] = [];
  // Real quota utilisation (pushed asynchronously) for the workflow quota
  // guard banner; dismissal lasts for the lifetime of this window.
  private usageLimits: ClaudeApiUsageResponse | null = null;
  private quotaWarnDismissed: boolean = false;
  // Set by extension.ts: runs the Usage Optimizer round-trip (model lives there
  // with the config + OAuth client). Returns the optimised prompt + settings
  // recommendation, or an error string.
  public onOptimize?: (
    draft: string,
    options: { resolve: boolean; distil: boolean; aesthetic: boolean }
  ) => Promise<{ prompt?: string; settings?: string; error?: string }>;
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
  } | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  /** Read a moved/core setting through the shared store, with a fallback. */
  private setting<T>(key: string, fallback: T): T {
    return this.settings ? this.settings.get<T>(key) : fallback;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel('claudeCodeUsage', I18n.t.popup.title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
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
        case 'setDashboardAutoRefresh':
          // Persist the in-dashboard toggle so it survives reload. Lives in the
          // dashboard-managed store now (no longer in VS Code Settings).
          await this.settings?.set('dashboardAutoRefresh', !!message.value);
          break;
        case 'tabChanged':
          this.currentTab = message.tab;
          break;
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
        case 'updateSetting':
          if (this.settings && typeof message.key === 'string') {
            await this.settings.set(message.key, message.value);
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
            for (const d of SETTINGS) {
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
          const draft = String(message.draft || '');
          const opts = {
            resolve: !!message.resolve,
            distil: !!message.distil,
            aesthetic: !!message.aesthetic,
          };
          // Persist the inputs immediately so a refresh mid-request keeps them.
          this.optimizerState = { draft, ...opts };
          let result: { prompt?: string; settings?: string; error?: string };
          if (this.onOptimize) {
            result = await this.onOptimize(draft, opts);
          } else {
            result = { error: 'Optimizer is not available.' };
          }
          // Persist the result too, so re-rendering the webview (auto-refresh)
          // restores it instead of wiping a prompt the user is still reading.
          this.optimizerState = { draft, ...opts, ...result };
          if (this.panel) {
            this.panel.webview.postMessage({ command: 'optimizeResult', ...result });
          }
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
        case 'getHourlyData':
          const dateString = message.date;
          if (dateString && this.panel) {
            // Get hourly data for the specified date
            const { ClaudeDataLoader } = await import('./dataLoader');
            const hourlyData = ClaudeDataLoader.getHourlyDataForDate(this.allRecords, dateString);

            // Send data back to webview
            this.panel.webview.postMessage({
              command: 'hourlyDataResponse',
              date: dateString,
              data: hourlyData,
            });
          }
          break;
        case 'getDailyData':
          const monthString = message.month;
          if (monthString && this.panel) {
            // Get daily data for the specified month
            const { ClaudeDataLoader } = await import('./dataLoader');
            const dailyData = ClaudeDataLoader.getDailyDataForSpecificMonth(this.allRecords, monthString);

            // Send data back to webview
            this.panel.webview.postMessage({
              command: 'dailyDataResponse',
              month: monthString,
              data: dailyData,
            });
          }
          break;
      }
    });

    this.updateWebview();
  }

  updateData(
    sessionData: SessionData | null,
    todayData: UsageData | null,
    monthData: UsageData | null,
    allTimeData: UsageData | null,
    dailyDataForMonth: { date: string; data: UsageData }[] = [],
    dailyDataForAllTime: { date: string; data: UsageData }[] = [],
    hourlyDataForToday: { hour: string; data: UsageData }[] = [],
    error?: string,
    dataDirectory?: string | null,
    allRecords?: any[],
    sessionBreakdown: SessionUsage[] = [],
    projectBreakdown: ProjectGroup[] = [],
    contentAnalysis: ContentAnalysis | null = null,
    branchBreakdown: BranchUsage[] = [],
    workflowBreakdown: WorkflowUsage[] = []
  ): void {
    this.currentSessionData = sessionData;
    this.todayData = todayData;
    this.monthData = monthData;
    this.allTimeData = allTimeData;
    this.dailyDataForMonth = dailyDataForMonth;
    this.dailyDataForAllTime = dailyDataForAllTime;
    this.hourlyDataForToday = hourlyDataForToday;
    this.error = error || null;
    this.dataDirectory = dataDirectory || null;
    this.isLoading = false;
    if (allRecords) {
      this.allRecords = allRecords;
    }
    this.sessionBreakdown = sessionBreakdown;
    this.projectBreakdown = projectBreakdown;
    this.contentAnalysis = contentAnalysis;
    this.branchBreakdown = branchBreakdown;
    this.workflowBreakdown = workflowBreakdown;

    if (this.panel) {
      this.updateWebview();
    }
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

  /** Quota-guard banner: warns before starting a workflow run on a nearly
   * exhausted 5-hour window. Threshold via workflowQuotaWarnPercent (0 = off);
   * dismissible per window-session. Status bar stays untouched. */
  private renderQuotaBanner(): string {
    if (this.quotaWarnDismissed) {
      return '';
    }
    const warnPercent = this.setting<number>('workflowQuotaWarnPercent', 50);
    const fiveHour = this.usageLimits?.five_hour;
    if (!warnPercent || warnPercent <= 0 || !fiveHour || typeof fiveHour.utilization !== 'number') {
      return '';
    }
    // An already-reset window means a fresh quota — never warn on stale data.
    const resetsAt = Date.parse(fiveHour.resets_at);
    if (!isNaN(resetsAt) && resetsAt <= Date.now()) {
      return '';
    }
    const remaining = Math.max(0, Math.round(100 - fiveHour.utilization));
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

  private updateWebview(): void {
    if (!this.panel) return;
    const html = this.getWebviewContent();
    if (html === this.lastHtml) {
      return;
    }
    this.lastHtml = html;
    this.panel.webview.html = html;
  }

  private getWebviewContent(): string {
    if (this.isLoading) {
      return this.getLoadingContent();
    }

    if (this.error) {
      return this.getErrorContent();
    }

    if (!this.currentSessionData && !this.todayData && !this.monthData) {
      return this.getNoDataContent();
    }

    return this.getMainContent();
  }

  private getLoadingContent(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
        <title>${I18n.t.popup.title}</title>
        <style>${this.getStyles()}</style>
      </head>
      <body>
        <div class="container">
          <div class="loading">
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
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
        <title>${I18n.t.popup.title}</title>
        <style>${this.getStyles()}</style>
      </head>
      <body>
        <div class="container">
          <div class="error">
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
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
        <title>${I18n.t.popup.title}</title>
        <style>${this.getStyles()}</style>
      </head>
      <body>
        <div class="container">
          <div class="no-data">
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

  private getMainContent(): string {
    // Pre-resolve I18n values to avoid template literal issues
    const title = I18n.t.popup.title;
    const refresh = I18n.t.popup.refresh;
    const settings = I18n.t.popup.settings;
    const today = I18n.t.popup.today;
    const thisMonth = I18n.t.popup.thisMonth;
    const allTime = I18n.t.popup.allTime;
    const sessions = I18n.t.popup.sessions;
    const projects = I18n.t.popup.projects;
    const contentTab = I18n.t.popup.contentAnalysis;
    const branchesTab = I18n.t.popup.branches;
    const workflowsTab = I18n.t.popup.workflows;
    const settingsTab = I18n.t.popup.settingsTab;

    const todayActive = this.currentTab === 'today' ? 'active' : '';
    const monthActive = this.currentTab === 'month' ? 'active' : '';
    const allActive = this.currentTab === 'all' ? 'active' : '';
    const sessionsActive = this.currentTab === 'sessions' ? 'active' : '';
    const projectsActive = this.currentTab === 'projects' ? 'active' : '';
    const contentActive = this.currentTab === 'content' ? 'active' : '';
    const branchesActive = this.currentTab === 'branches' ? 'active' : '';
    const workflowsActive = this.currentTab === 'workflows' ? 'active' : '';
    const settingsActive = this.currentTab === 'settings' ? 'active' : '';

    // The Content tab is hidden when content analysis is disabled via
    // claudeCodeUsage.enableContentAnalysis (the analyser returned null).
    const contentEnabled = this.contentAnalysis !== null;
    const contentTabButton = contentEnabled
      ? '<button id="tab-content" class="tab ' + contentActive +
        '" onclick="showTab(\'content\')">' + contentTab + '</button>'
      : '';
    const contentTabContent = contentEnabled
      ? '<div id="content" class="tab-content ' + contentActive + '">' + this.renderContentData() + '</div>'
      : '';

    return (
      `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
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
              <button onclick="showTab('content')" class="btn-secondary">✨ ` +
      I18n.t.popup.adviceCardTitle +
      `</button>
              <button onclick="showTab('settings')" class="btn-secondary">⚙ ` +
      settings +
      `</button>
            </div>
          </header>` +
      this.renderQuotaBanner() +
      `
          <div class="tabs">
            <button id="tab-today" class="tab ` +
      todayActive +
      `" onclick="showTab('today')">` +
      today +
      `</button>
            <button id="tab-month" class="tab ` +
      monthActive +
      `" onclick="showTab('month')">` +
      thisMonth +
      `</button>
            <button id="tab-all" class="tab ` +
      allActive +
      `" onclick="showTab('all')">` +
      allTime +
      `</button>
            <button id="tab-sessions" class="tab ` +
      sessionsActive +
      `" onclick="showTab('sessions')">` +
      sessions +
      `</button>
            <button id="tab-projects" class="tab ` +
      projectsActive +
      `" onclick="showTab('projects')">` +
      projects +
      `</button>
            ` +
      contentTabButton +
      `
            <button id="tab-branches" class="tab ` +
      branchesActive +
      `" onclick="showTab('branches')">` +
      branchesTab +
      `</button>
            <button id="tab-workflows" class="tab ` +
      workflowsActive +
      `" onclick="showTab('workflows')">` +
      workflowsTab +
      `</button>
            <button id="tab-settings" class="tab ` +
      settingsActive +
      `" onclick="showTab('settings')">` +
      settingsTab +
      `</button>
          </div>

          <div id="today" class="tab-content ` +
      todayActive +
      `">
            ` +
      this.renderTodayData() +
      `
          </div>

          <div id="month" class="tab-content ` +
      monthActive +
      `">
            ` +
      this.renderMonthData() +
      `
          </div>

          <div id="all" class="tab-content ` +
      allActive +
      `">
            ` +
      this.renderAllTimeData() +
      `
          </div>

          <div id="sessions" class="tab-content ` +
      sessionsActive +
      `">
            ` +
      this.renderSessionData() +
      `
          </div>

          <div id="projects" class="tab-content ` +
      projectsActive +
      `">
            ` +
      this.renderProjectData() +
      `
          </div>

          ` +
      contentTabContent +
      `

          <div id="branches" class="tab-content ` +
      branchesActive +
      `">
            ` +
      this.renderBranchData() +
      `
          </div>

          <div id="workflows" class="tab-content ` +
      workflowsActive +
      `">
            ` +
      this.renderWorkflowData() +
      `
          </div>

          <div id="settings" class="tab-content ` +
      settingsActive +
      `">
            ` +
      this.renderSettingsPanel() +
      `
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
   * settings (language / dataDirectory / advice.apiKey) still write to VS Code
   * config; the rest write to the dashboard-managed store. Setting labels/help
   * are English (technical); group headers + chrome are localised.
   */
  private renderSettingsPanel(): string {
    const t = I18n.t.popup;
    const snap: SettingView[] = this.settings ? this.settings.snapshot() : [];
    const groups: { key: string; label: string }[] = [
      { key: 'general', label: t.settingsGroupGeneral },
      { key: 'statusBar', label: t.settingsGroupStatusBar },
      { key: 'data', label: t.settingsGroupData },
      { key: 'advice', label: t.settingsGroupAdvice },
    ];
    let html = '<div class="settings-panel">';
    html += '<p class="table-hint">' + t.settingsIntro + '</p>';
    html +=
      '<div class="settings-toolbar">' +
      '<button class="btn-secondary btn-small" onclick="resetAllSettings()">' +
      t.settingsResetAll +
      '</button></div>';
    for (const g of groups) {
      const items = snap.filter((s) => s.group === g.key);
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

  /** One row in the settings panel: label + help + the right input control. The
   * label / help follow the plugin language (I18n.settingText), falling back to
   * the catalog English for the English UI. */
  private renderSettingRow(it: SettingView): string {
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
      const opts = (it.enumValues || [])
        .map((v, i) => {
          const label = (it.enumLabels && it.enumLabels[i]) || (v === '' ? '(default)' : v);
          const sel = String(it.value) === v ? ' selected' : '';
          return '<option value="' + esc(v) + '"' + sel + '>' + esc(label) + '</option>';
        })
        .join('');
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

  private renderTodayData(): string {
    if (!this.todayData) {
      return '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>';
    }

    const todaySummary = this.renderUsageData(this.todayData) + this.renderTodayInsights();

    let hourlyBreakdown = '';
    if (this.hourlyDataForToday.length > 0) {
      const cost = I18n.t.popup.cost;
      const inputTokens = I18n.t.popup.inputTokens;
      const outputTokens = I18n.t.popup.outputTokens;
      const cacheCreation = I18n.t.popup.cacheCreation;
      const cacheRead = I18n.t.popup.cacheRead;
      const messages = I18n.t.popup.messages;

      let hourlyRows = '';
      this.hourlyDataForToday.forEach(({ hour, data }) => {
        hourlyRows +=
          '<tr>' +
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
        '<div class="daily-breakdown">' +
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
        this.renderHourlyChart() +
        this.renderCompositionChart(
          [...this.hourlyDataForToday]
            .sort((a, b) => a.hour.localeCompare(b.hour))
            .map((h) => ({ label: h.hour, data: h.data }))
        ) +
        '<div class="daily-table-container">' +
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

  private renderUsageData(data: UsageData | null): string {
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
          '<span class="model-cost">' +
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

    return html;
  }

  private renderMonthData(): string {
    if (!this.monthData) {
      return `<div class="no-data"><p>${I18n.t.popup.noDataMessage}</p></div>`;
    }

    const monthSummary = this.renderUsageData(this.monthData);

    const dailyBreakdown =
      this.dailyDataForMonth.length > 0
        ? `
      <div class="daily-breakdown">
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
          ${this.renderDailyChart()}
        </div>

        ${this.renderCompositionChart(
          [...this.dailyDataForMonth]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((d) => ({ label: this.getShortDate(d.date), data: d.data }))
        )}

        <div class="daily-table-container">
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
              ${this.dailyDataForMonth
                .map(
                  ({ date, data }) => `
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
                    <button class="detail-button" onclick="toggleHourlyDetail('${date}')" title="${I18n.t.popup.hourlyBreakdown}">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path class="expand-icon" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
                      </svg>
                    </button>
                  </td>
                </tr>
                <tr class="hourly-detail-row" data-date="${date}" style="display: none;">
                  <td colspan="9">
                    <div class="hourly-detail-container" id="hourly-detail-${date}">
                      <div class="loading-indicator">載入中...</div>
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

    return monthSummary + dailyBreakdown;
  }

  private renderAllTimeData(): string {
    if (!this.allTimeData) {
      return `<div class="no-data"><p>${I18n.t.popup.noDataMessage}</p></div>`;
    }

    const allTimeSummary = this.renderUsageData(this.allTimeData);

    // Optional GitHub-style token heatmap (off by default; mainly a shareable
    // view). Inline SVG renders with working hover tooltips inside the webview.
    let heatmapPanel = '';
    if (this.setting<boolean>('showHeatmap', false) && this.allRecords && this.allRecords.length > 0) {
      const daily = ClaudeDataLoader.getDailyUsageMap(this.allRecords, I18n.getTimezone());
      heatmapPanel =
        '<div class="heatmap-panel"><h3>Token heatmap</h3>' +
        '<div class="heatmap-svg">' + renderHeatmapSvg(daily) + '</div></div>';
    }

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
          ${this.renderAllTimeChart()}
        </div>

        ${this.renderCompositionChart(
          [...this.dailyDataForAllTime]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((d) => ({ label: this.getShortDate(d.date), data: d.data, key: d.date }))
        )}

        <div class="daily-table-container">
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
                  <td class="date-cell">${this.formatDate(date)}</td>
                  <td class="cost-cell">${I18n.formatCurrency(data.totalCost)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalInputTokens)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalOutputTokens)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalCacheCreationTokens)}</td>
                  <td class="number-cell">${I18n.formatNumber(data.totalCacheReadTokens)}</td>
                  <td class="number-cell">${this.formatPercent(this.cacheHitRate(data))}</td>
                  <td class="number-cell">${I18n.formatNumber(data.messageCount)}</td>
                  <td class="detail-cell">
                    <button class="detail-button" onclick="toggleMonthlyDetail('${date}')" title="顯示每日詳細資料">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path class="expand-icon" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
                      </svg>
                    </button>
                  </td>
                </tr>
                <tr class="monthly-detail-row" data-date="${date}" style="display: none;">
                  <td colspan="9">
                    <div class="monthly-detail-container" id="monthly-detail-${date}">
                      <div class="loading-indicator">載入中...</div>
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

    // Heatmap sits right above the "monthly usage" breakdown, below the totals.
    return allTimeSummary + heatmapPanel + dailyBreakdown;
  }

  private renderSessionData(): string {
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

    let rows = '';
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
      // Calibrated absolute (Phase 8): thinking share × the session's EXACT
      // output tokens = a billing-anchored "real thinking tokens" figure.
      const realThinkingTokens =
        thinkingShare !== null ? Math.round(thinkingShare * d.totalOutputTokens) : null;
      // Tooltip: calibrated token figure + (for heavy sessions) the effort hint.
      const thinkingTitle = [
        realThinkingTokens !== null ? '~' + I18n.formatNumber(realThinkingTokens) + ' ' + t.thinkingTokensCalibrated : '',
        thinkingShare !== null && thinkingShare > 0.6 ? t.effortHint : '',
      ].filter((x) => x).join(' · ');
      rows +=
        '<tr class="sort-row' + (foreign ? ' session-foreign' : '') + '"' +
        ' data-sort-time="' + s.startTime.getTime() + '"' +
        ' data-sort-session="' + this.escapeHtml(fullName.toLowerCase()) + '"' +
        ' data-sort-project="' + this.escapeHtml((s.projectName || '').toLowerCase()) + '"' +
        ' data-sort-context="' + s.peakContextTokens + '"' +
        ' data-sort-thinking="' + (thinkingShare ?? -1) + '"' +
        ' data-sort-duration="' + (s.endTime.getTime() - s.startTime.getTime()) + '"' +
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
        (thinkingShare !== null ? this.formatPercent(thinkingShare) + (thinkingShare > 0.6 ? ' ⚠' : '') : '-') +
        '</td>' +
        '<td class="number-cell">' + I18n.formatNumber(d.messageCount) + '</td>' +
        '<td class="number-cell">' + this.escapeHtml(this.formatDuration(s.startTime, s.endTime)) + '</td>' +
        // Copy id / resume / delete actions; id re-validated host-side.
        '<td class="actions-cell">' +
        '<button class="session-action" title="' + this.escapeHtml(t.copySessionId) +
        '" data-session-id="' + this.escapeHtml(s.sessionId) + '" onclick="copySession(this)">⧉</button>' +
        '<button class="session-action" title="' + this.escapeHtml(t.resumeSession) +
        '" data-session-id="' + this.escapeHtml(s.sessionId) +
        '" data-cwd="' + this.escapeHtml(s.projectPath || '') + '" onclick="resumeSession(this)">▶</button>' +
        '<button class="session-action session-delete" title="' + this.escapeHtml(t.deleteSession) +
        '" data-session-id="' + this.escapeHtml(s.sessionId) +
        '" data-title="' + this.escapeHtml(fullName) + '" onclick="deleteSession(this)">🗑</button>' +
        '</td>' +
        '</tr>';
    });

    const th = (key: string, label: string): string =>
      '<th class="sortable" data-sortkey="' + key + '">' + label + '</th>';

    // Filter the list to the current project (default) or all.
    const total = this.sessionBreakdown.length;
    const foreignCount = total - currentCount;
    const showToggle = !!workspacePath && currentCount > 0 && foreignCount > 0;
    const filterBar = showToggle
      ? '<div class="sess-filter">' +
        '<button class="sess-filter-btn active" data-mode="current" onclick="sessionFilter(this)">' +
          this.escapeHtml(t.sessionFilterCurrent) + ' (' + currentCount + ')</button>' +
        '<button class="sess-filter-btn" data-mode="all" onclick="sessionFilter(this)">' +
          this.escapeHtml(t.sessionFilterAll) + ' (' + total + ')</button>' +
        '</div>'
      : '';

    return (
      '<div class="daily-breakdown">' +
      '<h3>' + t.sessionBreakdown + '</h3>' +
      '<p class="table-hint">' + t.sortHint + '</p>' +
      filterBar +
      '<div class="session-list' + (showToggle ? ' show-current' : '') + '" id="sessionList">' +
      '<div class="daily-table-container">' +
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

  /** Reading-friendly date/time: "Today HH:MM", "Yesterday HH:MM", "MM-DD HH:MM" or "YYYY-MM-DD". */
  private formatDateTime(date: Date): string {
    if (!date || isNaN(date.getTime()) || date.getTime() === 0) {
      return '-';
    }
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const hm = pad(date.getHours()) + ':' + pad(date.getMinutes());
    const sameDay = (a: Date, b: Date): boolean =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (sameDay(date, now)) {
      return I18n.t.popup.today + ' ' + hm;
    }
    if (sameDay(date, yesterday)) {
      return I18n.t.popup.yesterday + ' ' + hm;
    }
    if (date.getFullYear() === now.getFullYear()) {
      return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + hm;
    }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
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

  private renderProjectData(): string {
    if (!this.projectBreakdown || this.projectBreakdown.length === 0) {
      return '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>';
    }

    const t = I18n.t.popup;

    const usageCells = (d: UsageData): string =>
      '<td class="cost-cell">' + I18n.formatCurrency(d.totalCost) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.totalInputTokens) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.totalOutputTokens) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.totalCacheCreationTokens) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.totalCacheReadTokens) + '</td>' +
      '<td class="number-cell">' + I18n.formatNumber(d.messageCount) + '</td>';

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
      '<div class="daily-breakdown">' +
      '<h3>' + t.projectBreakdown + '</h3>' +
      '<p class="table-hint">' + t.sortHint + '</p>' +
      '<div class="daily-table-container">' +
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
      '<div class="daily-table-container">' +
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
  private renderTodayInsights(): string {
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
  private renderWorkflowData(): string {
    if (!this.workflowBreakdown || this.workflowBreakdown.length === 0) {
      return '<div class="no-data"><p>' + I18n.t.popup.noDataMessage + '</p></div>';
    }

    const t = I18n.t.popup;

    // Summary strip: workflow count + cost this calendar month, and that
    // cost's share of the month's total spend.
    const now = new Date();
    const thisMonth = this.workflowBreakdown.filter(
      (w) => w.endTime.getFullYear() === now.getFullYear() && w.endTime.getMonth() === now.getMonth()
    );
    const monthWorkflowCost = thisMonth.reduce(
      (sum, w) => sum + w.data.totalCost + (w.orchestration ? w.orchestration.totalCost : 0),
      0
    );
    const monthTotalCost = this.monthData ? this.monthData.totalCost : 0;
    const monthShare = monthTotalCost > 0 ? monthWorkflowCost / monthTotalCost : null;
    const summaryStrip =
      '<p class="table-hint">' +
      t.workflowsThisMonth + ': ' + thisMonth.length +
      ' · ' + I18n.formatCurrency(monthWorkflowCost) +
      (monthShare !== null ? ' · ' + this.formatPercent(monthShare) + ' ' + t.workflowCostShare : '') +
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
      '<div class="daily-table-container">' +
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
      '</div>'
    );
  }

  /**
   * Usage Optimizer card (Phase 9c). Default OFF — until the user opts in via
   * settings it shows only a description + an "enable" button. When enabled it
   * exposes a textarea + toggles; the round-trip runs in extension.ts via the
   * onOptimize hook (consent modal lives there). The result skeleton is baked
   * in (hidden) so the webview JS only fills text — no labels passed to JS.
   */
  private renderOptimizerCard(): string {
    const t = I18n.t.popup;
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
        '<div class="action-card">' +
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
    const lens = (id: string, label: string, hint: string, on?: boolean): string =>
      '<label title="' + this.escapeHtml(hint) + '"><input type="checkbox" id="' + id + '"' +
      ck(on) + '> ' + this.escapeHtml(label) + '</label>';
    return (
      '<div class="action-card">' +
      head('') +
      '<p class="action-card-howto">' + t.optimizerHowto + '</p>' +
      '<textarea id="optDraft" class="opt-input" rows="4" placeholder="' +
      this.escapeHtml(t.optimizerPlaceholder) + '">' + draftVal + '</textarea>' +
      '<div class="opt-controls">' +
      lens('optResolve', t.optimizerResolve, t.optimizerResolveHint, st?.resolve) +
      lens('optDistil', t.optimizerDistil, t.optimizerDistilHint, st?.distil) +
      lens('optAesthetic', t.optimizerAesthetic, t.optimizerAestheticHint, st?.aesthetic) +
      '<button class="btn-primary" id="optRunBtn" data-run="' +
      this.escapeHtml(t.optimizerRun) + '" data-running="' +
      this.escapeHtml(t.optimizerRunning) + '" onclick="runOptimizer()">' +
      t.optimizerRun + '</button>' +
      '</div>' +
      '<div id="optError" class="opt-error" style="display:' + (hasErr ? '' : 'none') + '">' +
      (hasErr ? this.escapeHtml(st!.error as string) : '') + '</div>' +
      '<div id="optResult" class="opt-result" style="display:' + (hasResult ? '' : 'none') + '">' +
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
      '</div>' +
      '</div>'
    );
  }

  /**
   * "Content" tab: an estimated breakdown of which conversation content consumes
   * tokens (your prompts vs. tool results vs. assistant output), to help spot
   * habits worth optimising. Token figures are estimated from text length.
   */
  private renderContentData(): string {
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
  private renderCompositionChart(items: { label: string; data: UsageData; key?: string }[]): string {
    if (!items || items.length === 0) {
      return '';
    }

    const t = I18n.t.popup;
    const maxHeight = 120;
    const totals = items.map(
      (it) =>
        it.data.totalInputTokens + it.data.totalOutputTokens + it.data.totalCacheCreationTokens + it.data.totalCacheReadTokens
    );
    const maxTotal = Math.max(...totals, 1);

    let bars = '';
    items.forEach((it, idx) => {
      const d = it.data;
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
      const colOpen = it.key
        ? '<div class="hc-col hc-col-clickable" onclick="toggleMonthlyDetail(\'' + it.key + '\')" title="' +
          this.escapeHtml(it.label) + ' — ' + I18n.formatNumber(total) + '">'
        : '<div class="hc-col">';
      bars +=
        colOpen +
        '<div class="stack-bar" title="' +
        this.escapeHtml(it.label) +
        ': ' +
        I18n.formatNumber(total) +
        '">' +
        seg(d.totalInputTokens, 'seg-input', t.inputTokens) +
        seg(d.totalCacheReadTokens, 'seg-cache-read', t.cacheRead) +
        seg(d.totalCacheCreationTokens, 'seg-cache-creation', t.cacheCreation) +
        seg(d.totalOutputTokens, 'seg-output', t.outputTokens) +
        '</div>' +
        '</div>';
    });

    const xlabels = items.map((it) => '<div class="hc-xlabel">' + this.escapeHtml(it.label) + '</div>').join('');

    const dot = (cls: string, label: string): string =>
      '<span class="legend-item"><span class="legend-dot ' + cls + '"></span>' + label + '</span>';

    return (
      '<div class="composition-chart">' +
      '<h4>' +
      t.tokenComposition +
      '</h4>' +
      '<div class="stack-legend">' +
      dot('seg-input', t.inputTokens) +
      dot('seg-cache-read', t.cacheRead) +
      dot('seg-cache-creation', t.cacheCreation) +
      dot('seg-output', t.outputTokens) +
      '</div>' +
      '<div class="hc-wrap">' +
      '<div class="hc-yaxis">' +
      '<span class="hc-yval">' + I18n.formatNumber(maxTotal) + '</span>' +
      '<span class="hc-yval">' + I18n.formatNumber(Math.round(maxTotal / 2)) + '</span>' +
      '<span class="hc-yval">0</span>' +
      '</div>' +
      '<div class="hc-main"><div class="hc-scroll">' +
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

  private renderDailyChart(): string {
    const sortedData = [...this.dailyDataForMonth].sort((a, b) => a.date.localeCompare(b.date));
    return this.renderMainCostChart(sortedData);
  }

  private renderAllTimeChart(): string {
    const sortedData = [...this.dailyDataForAllTime].sort((a, b) => a.date.localeCompare(b.date));
    return this.renderMainCostChart(sortedData);
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

  private renderMainCostChart(sortedData: { date: string; data: UsageData }[]): string {
    if (sortedData.length === 0) {
      return '<div class="no-chart-data">No data available</div>';
    }
    const maxCost = Math.max(...sortedData.map((d) => d.data.totalCost), 0);
    const maxHeight = 120;

    const costStack = (data: UsageData, barHeight: number): string => this.costStackHtml(data, barHeight);

    const bars = sortedData
      .map(({ date, data }) => {
        const barHeight = maxCost > 0 ? (data.totalCost / maxCost) * maxHeight : 0;
        const cb = data.costBreakdown;
        return (
          '<div class="hc-col" data-date="' + date + '">' +
          '<div class="hc-barval">' + I18n.formatCurrency(data.totalCost) + '</div>' +
          '<div class="chart-bar cost-bar cost-stacked clickable" style="height: ' + barHeight + 'px;" ' +
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
          'title="' + this.escapeHtml(this.formatDate(date)) + ': ' + I18n.formatCurrency(data.totalCost) + '">' +
          costStack(data, barHeight) +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    const xlabels = sortedData
      .map(({ date }) => '<div class="hc-xlabel">' + this.getShortDate(date) + '</div>')
      .join('');

    return (
      '<div class="hc-wrap">' +
      '<div class="hc-yaxis">' +
      '<span class="hc-yval">' + I18n.formatCurrency(maxCost) + '</span>' +
      '<span class="hc-yval">' + I18n.formatCurrency(maxCost / 2) + '</span>' +
      '<span class="hc-yval">' + I18n.formatCurrency(0) + '</span>' +
      '</div>' +
      '<div class="hc-main"><div class="hc-scroll">' +
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
   * reference lines and a value label on top of every bar, so figures are
   * readable without hovering.
   */
  private renderHourlyChart(): string {
    if (this.hourlyDataForToday.length === 0) {
      return '<div class="no-chart-data">No data available</div>';
    }

    const sortedData = [...this.hourlyDataForToday].sort((a, b) => a.hour.localeCompare(b.hour));
    const maxCost = Math.max(...sortedData.map((d) => d.data.totalCost), 0);
    const maxHeight = 120; // Plot height in pixels — kept in sync with updateMainChart.

    const bars = sortedData
      .map(({ hour, data }) => {
        const height = maxCost > 0 ? (data.totalCost / maxCost) * maxHeight : 0;
        const cb = data.costBreakdown;
        return (
          '<div class="hc-col" data-hour="' + hour + '">' +
          '<div class="hc-barval">' + I18n.formatCurrency(data.totalCost) + '</div>' +
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
      '<div class="hc-scroll">' +
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

  private getShortDate(dateString: string): string {
    // Parse 'YYYY-MM-DD' textually — new Date('YYYY-MM-DD') is UTC midnight,
    // which shifts the displayed day back by one in negative-UTC timezones.
    const [y, m, d] = dateString.split('-').map(Number);
    // Month-only dates (first of month) label as YYYY/MM for monthly charts.
    if (dateString.endsWith('-01')) {
      return `${y}/${String(m).padStart(2, '0')}`;
    }
    return `${m}/${d}`;
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    // Check if this is a month-only date (ends with -01)
    if (dateString.endsWith('-01')) {
      return date.toLocaleDateString(I18n.getLocale(), I18n.dateFormatOptions({ year: 'numeric', month: 'long' }));
    }
    // Standard date formatting for daily data, locale + timezone aware.
    return date.toLocaleDateString(I18n.getLocale(), I18n.dateFormatOptions());
  }

  private getStyles(): string {
    return `
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
        margin: 0;
        padding: 16px;
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
        margin-bottom: 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
        padding-bottom: 16px;
      }


      h1 {
        margin: 0;
        font-size: 20px;
      }

      .actions {
        display: flex;
        gap: 8px;
      }

      button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 12px;
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

      /* Refresh-Now button is only relevant when auto-refresh is OFF — hide
         it by default, show only when the body carries the .auto-off class. */
      .btn-refresh-now {
        display: none;
      }
      body.auto-off .btn-refresh-now {
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

      /* Sessions "current project / all" filter. */
      .sess-filter {
        display: flex;
        gap: 6px;
        margin: 0 0 10px;
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
      .session-list.show-current .session-foreign {
        display: none;
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
        margin-bottom: 20px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .tab {
        background: transparent;
        border: none;
        padding: 8px 16px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        /* Explicit foreground colour — otherwise the inherited button
           foreground (white) becomes invisible on light themes. (Fixes
           upstream issue #11.) */
        color: var(--vscode-foreground);
      }

      .tab.active {
        border-bottom-color: var(--vscode-focusBorder);
        color: var(--vscode-focusBorder);
      }

      .tab-content {
        display: none;
      }

      .tab-content.active {
        display: block;
      }

      .usage-summary {
        margin-bottom: 24px;
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
      }

      .summary-item {
        text-align: center;
        padding: 16px;
        background: var(--vscode-input-background);
        border-radius: 8px;
        border: 1px solid var(--vscode-input-border);
      }

      .summary-item .label {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 8px;
      }

      .summary-item .value {
        font-size: 18px;
        font-weight: bold;
      }

      .summary-item .value.cost {
        color: var(--vscode-charts-green);
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
        gap: 12px;
      }

      .model-item {
        padding: 12px;
        background: var(--vscode-input-background);
        border-radius: 6px;
        border: 1px solid var(--vscode-input-border);
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
        margin-bottom: 8px;
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

      .model-cost {
        font-weight: bold;
        color: var(--vscode-charts-green);
        margin-left: auto;
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
        opacity: 0.85;
      }

      .chart-tabs {
        display: flex;
        gap: 4px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }

      .chart-tab {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
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
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 8px;
        padding: 16px;
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

      .chart-bar.clickable:hover {
        opacity: 0.8;
        transform: scaleY(1.05);
      }

      .chart-bar.selected {
        border: 2px solid var(--vscode-focusBorder);
        box-shadow: 0 0 4px var(--vscode-focusBorder);
      }

      .cost-bar {
        background: linear-gradient(to top, var(--vscode-charts-green), var(--vscode-charts-blue));
      }

      .input-bar {
        background: linear-gradient(to top, var(--vscode-charts-blue), var(--vscode-charts-purple));
      }

      .output-bar {
        background: linear-gradient(to top, var(--vscode-charts-orange), var(--vscode-charts-red));
      }

      .cache-creation-bar {
        background: linear-gradient(to top, var(--vscode-charts-purple), var(--vscode-charts-pink));
      }

      .cache-read-bar {
        background: linear-gradient(to top, var(--vscode-charts-yellow), var(--vscode-charts-orange));
      }

      .messages-bar {
        background: linear-gradient(to top, var(--vscode-charts-foreground), var(--vscode-charts-lines));
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
        font-family: var(--vscode-editor-font-family);
        /* Keep figures on one line: compact (k/M) numbers fit the panel with no
         * horizontal scroll; full integer numbers overflow so the table (only)
         * scrolls, while the chart above keeps its own independent scroll. */
        white-space: nowrap;
      }

      .loading, .error, .no-data {
        text-align: center;
        padding: 40px 20px;
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
        background: #ffffff;
      }
      .heatmap-svg svg {
        display: block;
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
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 6px;
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
        background: var(--vscode-charts-orange);
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
        color: var(--vscode-focusBorder);
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
        background: var(--vscode-charts-orange);
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
    `;
  }

  private getScript(): string {
    return `
console.log("[DEBUG] === JAVASCRIPT INITIALIZATION START ===");

// Get VSCode API
const vscode = acquireVsCodeApi();
console.log("[DEBUG] VSCode API acquired");

// Restore the active tab from localStorage before first paint, so a reload can't change it.
function restoreActiveTab() {
  try {
    var t = localStorage.getItem('ccu.activeTab');
    if (t && document.getElementById('tab-' + t) && document.getElementById(t)) {
      showTab(t);
    }
  } catch (e) {}
}
function restoreUi() { restoreActiveTab(); restoreSessionFilter(); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreUi);
} else {
  restoreUi();
}

// Locale + timezone baked in at render time so drill-down renders match the
// user's UI language and configured timezone (instead of the hardcoded zh-TW
// that the original used in this script body).
const __locale = ${JSON.stringify(I18n.getLocale())};
const __tz = ${JSON.stringify(I18n.getTimezone())};
const __dateOpts = (extra) => {
  const opts = Object.assign({}, extra || {});
  if (__tz) opts.timeZone = __tz;
  return opts;
};

// Define basic functions
function refresh() {
  console.log("[DEBUG] refresh called");
  vscode.postMessage({ command: 'refresh' });
}

function openSettings() {
  console.log("[DEBUG] openSettings called");
  vscode.postMessage({ command: 'openSettings' });
}

function refreshPricing() {
  console.log("[DEBUG] refreshPricing called");
  vscode.postMessage({ command: 'refreshPricing' });
}

function getAdvice() {
  console.log("[DEBUG] getAdvice called");
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

function resetAllSettings() {
  vscode.postMessage({ command: 'resetAllSettings' });
}

function runOptimizer() {
  var ta = document.getElementById('optDraft');
  var btn = document.getElementById('optRunBtn');
  if (!ta || !ta.value.trim()) { return; }
  var err = document.getElementById('optError');
  var res = document.getElementById('optResult');
  if (err) { err.style.display = 'none'; }
  if (res) { res.style.display = 'none'; }
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

function showOptimizeResult(msg) {
  var btn = document.getElementById('optRunBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = btn.getAttribute('data-run') || 'Optimize';
  }
  var err = document.getElementById('optError');
  var res = document.getElementById('optResult');
  if (msg.error) {
    if (err) { err.textContent = msg.error; err.style.display = ''; }
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

function applySessionFilter(mode) {
  var list = document.getElementById('sessionList');
  if (!list) { return; }
  list.classList.toggle('show-current', mode === 'current');
  document.querySelectorAll('.sess-filter-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-mode') === mode);
  });
}
function sessionFilter(btn) {
  if (!btn) { return; }
  var mode = btn.getAttribute('data-mode');
  applySessionFilter(mode);
  // Persist so the full-document reload (e.g. after a delete) keeps the filter.
  try { localStorage.setItem('ccu.sessionFilter', mode); } catch (e) {}
}
function restoreSessionFilter() {
  try {
    var mode = localStorage.getItem('ccu.sessionFilter');
    if (mode && document.querySelector('.sess-filter-btn[data-mode="' + mode + '"]')) {
      applySessionFilter(mode);
    }
  } catch (e) {}
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
function sortTable(table, key, th) {
  var tbody = table.querySelector('tbody');
  if (!tbody) { return; }
  var allRows = Array.prototype.slice.call(tbody.children);

  var units = [];
  var current = null;
  allRows.forEach(function(row) {
    if (row.classList.contains('sort-child') && current) {
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
  });
  th.setAttribute('data-sortdir', ascending ? 'asc' : 'desc');
  th.classList.add(ascending ? 'sorted-asc' : 'sorted-desc');

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
}

function showTab(tabName) {
  console.log("[DEBUG] showTab called:", tabName);

  try {
    // Remove active from all tabs and contents
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Add active to selected tab and content
    const selectedTab = document.getElementById('tab-' + tabName);
    const selectedContent = document.getElementById(tabName);

    if (selectedTab && selectedContent) {
      selectedTab.classList.add('active');
      selectedContent.classList.add('active');
      console.log("[DEBUG] Tab switched successfully to:", tabName);

      vscode.postMessage({ command: 'tabChanged', tab: tabName });
      // Persist in localStorage too — survives the reload, restored before paint.
      try { localStorage.setItem('ccu.activeTab', tabName); } catch (e) {}
    } else {
      console.error("[DEBUG] Tab or content not found:", tabName);
    }
  } catch (error) {
    console.error("[DEBUG] Error switching tabs:", error);
  }
}

function toggleHourlyDetail(date) {
  console.log("[DEBUG] toggleHourlyDetail called for date:", date);

  try {
    const detailRow = document.querySelector('.hourly-detail-row[data-date="' + date + '"]');
    const button = document.querySelector('.daily-row[data-date="' + date + '"] .detail-button');
    const container = document.getElementById('hourly-detail-' + date);
    const chartBar = document.querySelector('.chart-bar-container[data-date="' + date + '"] .chart-bar');

    console.log("[DEBUG] Found elements:", {
      detailRow: !!detailRow,
      button: !!button,
      container: !!container,
      chartBar: !!chartBar
    });

    if (detailRow && button && container) {
      const isExpanded = detailRow.style.display !== 'none' && detailRow.style.display !== '';

      if (!isExpanded) {
        // First, close all other expanded details
        closeAllHourlyDetails();

        // Show detail for this date
        detailRow.style.display = 'table-row';
        button.classList.add('expanded');

        // Update chart bar selection state
        if (chartBar) {
          chartBar.classList.add('selected');
          console.log("[DEBUG] Chart bar selected for date:", date);
        }

        console.log("[DEBUG] Showing hourly detail for date:", date);

        // Request hourly data if not loaded
        if (!container.dataset.loaded) {
          console.log("[DEBUG] Requesting hourly data for date:", date);
          vscode.postMessage({ command: 'getHourlyData', date: date });
          container.dataset.loaded = 'true';
        }

        // Scroll the newly-revealed detail into view — clicking a bar at the
        // top of the tab otherwise expands a detail far down the table that
        // the user never notices.
        try { detailRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      } else {
        // Hide detail
        detailRow.style.display = 'none';
        button.classList.remove('expanded');

        // Update chart bar selection state
        if (chartBar) {
          chartBar.classList.remove('selected');
          console.log("[DEBUG] Chart bar deselected for date:", date);
        }

        console.log("[DEBUG] Hiding hourly detail for date:", date);
      }

    } else {
      console.error("[DEBUG] Could not find required elements for date:", date);
    }
  } catch (error) {
    console.error("[DEBUG] Error in toggleHourlyDetail:", error);
  }
}

function closeAllHourlyDetails() {
  console.log("[DEBUG] closeAllHourlyDetails called");

  // Close all expanded detail rows
  const allDetailRows = document.querySelectorAll('.hourly-detail-row');
  const allButtons = document.querySelectorAll('.detail-button.expanded');
  const allChartBars = document.querySelectorAll('.chart-bar.selected');

  allDetailRows.forEach(function(row) {
    row.style.display = 'none';
  });

  allButtons.forEach(function(btn) {
    btn.classList.remove('expanded');
  });

  allChartBars.forEach(function(bar) {
    bar.classList.remove('selected');
  });

  console.log("[DEBUG] Closed all detail rows");
}

function toggleMonthlyDetail(monthDate) {
  console.log("[DEBUG] toggleMonthlyDetail called for month:", monthDate);

  try {
    const detailRow = document.querySelector('.monthly-detail-row[data-date="' + monthDate + '"]');
    const button = document.querySelector('.daily-row[data-date="' + monthDate + '"] .detail-button');
    const container = document.getElementById('monthly-detail-' + monthDate);
    const chartBar = document.querySelector('.chart-bar-container[data-date="' + monthDate + '"] .chart-bar');

    console.log("[DEBUG] Found elements:", {
      detailRow: !!detailRow,
      button: !!button,
      container: !!container,
      chartBar: !!chartBar
    });

    if (detailRow && button && container) {
      const isExpanded = detailRow.style.display !== 'none' && detailRow.style.display !== '';

      if (!isExpanded) {
        // First, close all other expanded details
        closeAllMonthlyDetails();

        // Show detail for this month
        detailRow.style.display = 'table-row';
        button.classList.add('expanded');

        // Update chart bar selection state
        if (chartBar) {
          chartBar.classList.add('selected');
          console.log("[DEBUG] Chart bar selected for month:", monthDate);
        }

        console.log("[DEBUG] Showing monthly detail for month:", monthDate);

        // Request monthly data if not loaded
        if (!container.dataset.loaded) {
          console.log("[DEBUG] Requesting daily data for month:", monthDate);
          vscode.postMessage({ command: 'getDailyData', month: monthDate });
          container.dataset.loaded = 'true';
        }

        // Scroll the newly-revealed detail into view (see toggleHourlyDetail).
        try { detailRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      } else {
        // Hide detail
        detailRow.style.display = 'none';
        button.classList.remove('expanded');

        // Update chart bar selection state
        if (chartBar) {
          chartBar.classList.remove('selected');
          console.log("[DEBUG] Chart bar deselected for month:", monthDate);
        }

        console.log("[DEBUG] Hiding monthly detail for month:", monthDate);
      }

    } else {
      console.error("[DEBUG] Could not find required elements for month:", monthDate);
    }
  } catch (error) {
    console.error("[DEBUG] Error in toggleMonthlyDetail:", error);
  }
}

function closeAllMonthlyDetails() {
  console.log("[DEBUG] closeAllMonthlyDetails called");

  // Close all expanded monthly detail rows
  const allDetailRows = document.querySelectorAll('.monthly-detail-row');
  const allButtons = document.querySelectorAll('.detail-button.expanded');
  const allChartBars = document.querySelectorAll('.chart-bar.selected');

  allDetailRows.forEach(function(row) {
    row.style.display = 'none';
  });

  allButtons.forEach(function(btn) {
    btn.classList.remove('expanded');
  });

  allChartBars.forEach(function(bar) {
    bar.classList.remove('selected');
  });

  console.log("[DEBUG] Closed all monthly detail rows");
}

function updateHourlyChart(date, metric) {
  console.log("[DEBUG] updateHourlyChart called with date:", date, "metric:", metric);

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
  console.log("[DEBUG] syncChartBarSelection called for date:", date, "selected:", isSelected);

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
window.toggleProjectGroup = toggleProjectGroup;
window.sortTable = sortTable;
window.dismissQuotaWarn = dismissQuotaWarn;
window.attrSetScope = attrSetScope;
window.requestAttribution = requestAttribution;
window.showTab = showTab;
window.toggleHourlyDetail = toggleHourlyDetail;
window.toggleMonthlyDetail = toggleMonthlyDetail;
window.updateHourlyChart = updateHourlyChart;
window.syncChartBarSelection = syncChartBarSelection;
window.closeAllHourlyDetails = closeAllHourlyDetails;
window.closeAllMonthlyDetails = closeAllMonthlyDetails;

// Handle messages from extension
window.addEventListener('message', function(event) {
  const message = event.data;

  if (message.command === 'hourlyDataResponse') {
    const container = document.getElementById('hourly-detail-' + message.date);
    if (container && message.data) {
      console.log("[DEBUG] Rendering hourly data for date:", message.date);
      container.innerHTML = renderHourlyData(message.data, message.date);

      // Re-bind chart tab events after rendering
      bindChartTabEvents(container);
    }
  }

  if (message.command === 'dailyDataResponse') {
    const container = document.getElementById('monthly-detail-' + message.month);
    if (container && message.data) {
      console.log("[DEBUG] Rendering daily data for month:", message.month);
      container.innerHTML = renderDailyData(message.data, message.month);

      // Re-bind chart tab events after rendering
      bindChartTabEvents(container);
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
});

// Format any optimiser settings restored into the DOM by a re-render.
formatOptSettings();

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
  if (event.target.classList.contains('chart-tab')) {
    console.log("[DEBUG] Chart tab clicked:", event.target);

    event.preventDefault();
    const metric = event.target.dataset.metric;
    console.log("[DEBUG] Chart tab metric:", metric);

    // Find the container and determine the context
    const container = event.target.closest('.daily-breakdown') || event.target.closest('.hourly-breakdown');
    console.log("[DEBUG] Chart tab container:", container);

    if (container) {
      // Update active tab
      const tabs = container.querySelectorAll('.chart-tab');
      tabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      event.target.classList.add('active');

      // Determine chart type and update accordingly
      if (container.classList.contains('hourly-breakdown')) {
        // This is an hourly detail chart - extract date from the chart content ID
        const chartContent = container.querySelector('[id^="hourly-chart-"]');
        if (chartContent) {
          const date = chartContent.id.replace('hourly-chart-', '');
          console.log("[DEBUG] Updating hourly chart for date:", date, "metric:", metric);
          updateHourlyChart(date, metric);
        }
      } else {
        // This is a main chart (daily/monthly)
        console.log("[DEBUG] Updating main chart with metric:", metric);
        updateMainChart(metric, container);
      }
    }
  }

  // Handle chart bar clicks - only for clickable charts
  if (event.target.classList.contains('chart-bar') && event.target.classList.contains('clickable')) {
    console.log("[DEBUG] Clickable chart bar clicked:", event.target);

    event.preventDefault();
    // Daily/monthly charts now use .hc-col; the JS-rendered drill-downs still
    // use .chart-bar-container — support both.
    const container = event.target.closest('.hc-col') || event.target.closest('.chart-bar-container');
    if (container) {
      const date = container.dataset.date;
      if (date) {
        console.log("[DEBUG] Chart bar clicked for date:", date);

        // Determine if this is a monthly chart or daily chart based on current tab
        const activeTab = document.querySelector('.tab.active');
        if (activeTab && activeTab.id === 'tab-all') {
          // This is in the "all time" tab, so it's a monthly chart
          toggleMonthlyDetail(date);
        } else {
          // This is in the "month" tab, so it's a daily chart
          toggleHourlyDetail(date);
        }
      }
    }
  }
});

function bindChartTabEvents(container) {
  console.log("[DEBUG] Binding chart tab events for container:", container);

  const chartTabs = container.querySelectorAll('.chart-tab');
  console.log("[DEBUG] Found chart tabs:", chartTabs.length);

  chartTabs.forEach(function(tab, index) {
    console.log("[DEBUG] Processing chart tab", index, ":", tab.dataset.metric);

    // Remove existing event listeners to prevent duplicates
    tab.removeEventListener('click', handleChartTabClick);

    // Add new event listener
    tab.addEventListener('click', handleChartTabClick);
  });
}

function handleChartTabClick(event) {
  console.log("[DEBUG] handleChartTabClick called");
  event.preventDefault();

  const metric = this.dataset.metric;
  const container = this.closest('.daily-breakdown') || this.closest('.hourly-breakdown');

  if (container) {
    // Update active tab
    const tabs = container.querySelectorAll('.chart-tab');
    tabs.forEach(function(tab) {
      tab.classList.remove('active');
    });
    this.classList.add('active');

    // Update chart based on context
    if (container.classList.contains('hourly-breakdown')) {
      const chartContent = container.querySelector('[id^="hourly-chart-"]');
      if (chartContent) {
        const date = chartContent.id.replace('hourly-chart-', '');
        updateHourlyChart(date, metric);
      }
    } else {
      updateMainChart(metric, null);
    }
  }
}

function updateMainChart(metric, container) {
  console.log("[DEBUG] updateMainChart called with metric:", metric, "container:", container);

  // If container is provided, use it; otherwise find the active tab content
  let targetContainer = container;
  if (!targetContainer) {
    targetContainer = document.querySelector('.tab-content.active');
    if (!targetContainer) {
      console.error("[DEBUG] No active tab content found");
      return;
    }
  }

  // Update chart in the target container
  const chartBars = targetContainer.querySelectorAll('.chart-bar');
  if (chartBars.length === 0) {
    console.log("[DEBUG] No chart bars found in target container");
    return;
  }

  console.log("[DEBUG] Updating", chartBars.length, "chart bars with metric:", metric);

  // Calculate max values for the metric
  const values = Array.from(chartBars).map(function(bar) {
    const value = parseFloat(bar.dataset[getDataAttribute(metric)]) || 0;
    return value;
  });

  const maxValue = Math.max(...values);
  const maxHeight = 120;

  console.log("[DEBUG] Max value for metric", metric, ":", maxValue);

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
    const formattedValue = formatValue(value, metric);
    const container = bar.parentElement;
    const date = container.dataset.date;
    const hour = container.dataset.hour;

    if (hour) {
      // Hourly chart: tooltip shows the value only (the hour is on the x-axis).
      bar.title = formattedValue;
    } else if (date) {
      const dateObj = new Date(date);
      bar.title = dateObj.toLocaleDateString() + ': ' + formattedValue;
    }

    const barVal = container.querySelector('.hc-barval');
    if (barVal) {
      barVal.textContent = formattedValue;
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
    yvals[0].textContent = formatValue(maxValue, metric);
    yvals[1].textContent = formatValue(maxValue / 2, metric);
    yvals[2].textContent = formatValue(0, metric);
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
    return '$' + value.toFixed(2);
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
    + '</div><div class="hc-main"><div class="hc-scroll"><div class="hc-plot">'
    + '<div class="hc-grid hc-grid-top"></div><div class="hc-grid hc-grid-mid"></div>'
    + '<div class="hc-bars">' + bars + '</div></div>'
    + '<div class="hc-xlabels">' + xlabels + '</div></div></div></div></div>';
}

function renderHourlyData(hourlyData, date) {
  if (!hourlyData || hourlyData.length === 0) {
    return '<div class="no-data">${I18n.t.popup.noDataMessage}</div>';
  }

  let html = '<div class="hourly-breakdown">';
  html += '<h4>' + new Date(date).toLocaleDateString(__locale, __dateOpts()) + ' ${I18n.t.popup.hourlyBreakdown}</h4>';

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

  html += '<div class="daily-table-container"><table class="daily-table"><thead><tr>';
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
    html += '<tr>';
    html += '<td class="date-cell">' + item.hour + '</td>';
    html += '<td class="cost-cell">$' + item.data.totalCost.toFixed(2) + '</td>';
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

  let html = '<div class="daily-breakdown">';
  html += '<h4>' + new Date(monthDate).toLocaleDateString(__locale, __dateOpts({ year: 'numeric', month: 'long' })) + ' ${I18n.t.popup.dailyBreakdown}</h4>';

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
  html += renderDailyChart(dailyData, 'cost');
  html += '</div>';

  // Per-day token composition for this month (the drill-down of the all-time
  // monthly composition the user clicked).
  html += compositionHtml(dailyData.map(function(item) {
    return {
      label: new Date(item.date).toLocaleDateString(__locale, __dateOpts({ month: 'numeric', day: 'numeric' })),
      data: item.data
    };
  }));

  html += '<div class="daily-table-container"><table class="daily-table"><thead><tr>';
  html += '<th>${I18n.t.popup.date}</th>';
  html += '<th>${I18n.t.popup.cost}</th>';
  html += '<th>${I18n.t.popup.inputTokens}</th>';
  html += '<th>${I18n.t.popup.outputTokens}</th>';
  html += '<th>${I18n.t.popup.cacheCreation}</th>';
  html += '<th>${I18n.t.popup.cacheRead}</th>';
  html += '<th>${I18n.t.popup.cacheHitRate}</th>';
  html += '<th>${I18n.t.popup.messages}</th>';
  html += '</tr></thead><tbody>';

  dailyData.forEach(function(item) {
    const dateObj = new Date(item.date);
    const formattedDate = dateObj.toLocaleDateString(__locale, __dateOpts({ month: 'numeric', day: 'numeric' }));

    html += '<tr>';
    html += '<td class="date-cell">' + formattedDate + '</td>';
    html += '<td class="cost-cell">$' + item.data.totalCost.toFixed(2) + '</td>';
    html += '<td class="number-cell">' + item.data.totalInputTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + item.data.totalOutputTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + item.data.totalCacheCreationTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + item.data.totalCacheReadTokens.toLocaleString(__locale) + '</td>';
    html += '<td class="number-cell">' + cacheHitPct(item.data) + '</td>';
    html += '<td class="number-cell">' + item.data.messageCount.toLocaleString(__locale) + '</td>';
    html += '</tr>';
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
    return '<div class="no-chart-data">No data available</div>';
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
    if (opts.clickable) { cls += ' clickable'; }

    bars += '<div class="hc-col" ' + keyAttr + '="' + key + '">' +
      '<div class="hc-barval">' + formatValue(value, metric) + '</div>' +
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
    '<div class="hc-main"><div class="hc-scroll">' +
    '<div class="hc-plot"><div class="hc-grid hc-grid-top"></div><div class="hc-grid hc-grid-mid"></div>' +
    '<div class="hc-bars">' + bars + '</div></div>' +
    '<div class="hc-xlabels">' + xlabels + '</div>' +
    '</div></div></div>';
}

function renderDailyChart(dailyData, metric) {
  // Parse 'YYYY-MM-DD' textually: new Date('YYYY-MM-DD') is interpreted as
  // UTC midnight, so getMonth()/getDate() shift back a day in negative-UTC
  // timezones. String parts are timezone-proof.
  function parts(dateStr) { return dateStr.split('-').map(Number); }
  return griddedChart(dailyData, metric, {
    keyName: 'date',
    clickable: false,
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
    getLabel: function(it) { return it.hour; },
    getTitle: function(it, v) { return it.hour + ': ' + formatValue(v, metric); }
  });
}

// Initialize chart tab events for existing elements
setTimeout(function() {
  console.log("[DEBUG] Initializing chart tab events for existing elements");
  const existingChartContainers = document.querySelectorAll('.daily-breakdown');
  existingChartContainers.forEach(function(container) {
    bindChartTabEvents(container);
  });
}, 1000);

console.log("[DEBUG] All functions defined and ready");`;
  }

  dispose(): void {
    if (this.panel) {
      this.panel.dispose();
    }
  }
}
