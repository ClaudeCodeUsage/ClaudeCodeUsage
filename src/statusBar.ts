import * as vscode from 'vscode';
import { ClaudeApiUsageResponse, ClaudeUsageLimit, ContextWindowInfo, UsageData } from './types';
import { I18n } from './i18n';
import { formatQuotaStatusText, worstShownUtilisation, QuotaStatusOptions } from './quotaFormat';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private quotaItem: vscode.StatusBarItem;
  private contextItem: vscode.StatusBarItem;
  private isLoading: boolean = false;
  // Per-item visibility, driven by the showCost / showContext / quota settings.
  private showCost: boolean = true;
  private showContext: boolean = true;
  private usageLimitTracking: boolean = true;
  // First item shows today's cost ('cost'), this month's cost ('monthly-cost'), or today's token count ('tokens').
  private metric: 'cost' | 'monthly-cost' | 'tokens' = 'cost';
  // Opt-in: append the weekly Opus limit (opus:NN%) to the quota item (PR #38,
  // @wheelbarrel00).
  private showOpusWeekly: boolean = false;
  // Quota display preferences.
  private quotaFiveHourOnly: boolean = false; // show only the 5h window
  private showResetInBar: boolean = false;    // append reset countdown to the bar

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'claudeCodeUsage.showDetails';
    this.statusBarItem.show();

    // A second, quieter item for the real usage-limit indicator.
    this.quotaItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.quotaItem.command = 'claudeCodeUsage.showDetails';

    // Context-window fill of the current session (like /context).
    this.contextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    this.contextItem.command = 'claudeCodeUsage.showDetails';

    // Visible from t=0: an empty-text status bar item renders as nothing, so
    // without this the extension appears "missing" until the first full
    // refresh lands (which can lag behind a slow first quota fetch on a cold
    // network). Reported as "usage not showing the first time I open VS Code".
    this.setLoading(true);
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
    this.updateStatusBar();
  }

  /** Apply the showCost / showContext settings. Hiding takes effect
   * immediately; re-showing happens on the next data update (the caller
   * triggers a refresh right after a config change). */
  setVisibility(
    showCost: boolean,
    showContext: boolean,
    usageLimitTracking: boolean = true,
    metric: 'cost' | 'monthly-cost' | 'tokens' = 'cost',
    showOpusWeekly: boolean = false,
    quotaFiveHourOnly: boolean = false,
    showResetInBar: boolean = false
  ): void {
    this.showCost = showCost;
    this.showContext = showContext;
    this.usageLimitTracking = usageLimitTracking;
    this.metric = metric;
    this.showOpusWeekly = showOpusWeekly;
    this.quotaFiveHourOnly = quotaFiveHourOnly;
    this.showResetInBar = showResetInBar;
    if (!showContext) {
      this.contextItem.hide();
    }
    // Re-apply the first item — it may need to become an icon-only entry point.
    this.applyCostVisibility();
  }

  /** Show / hide the first status-bar item per the showCost setting. When cost
   * is off, the item normally hides — UNLESS the quota and context items are
   * also off by setting, in which case there would be NO clickable way back
   * into the dashboard. In that all-off case we keep it as an icon-only entry
   * point. Every method that sets the item's text calls this, so it reappears
   * (or collapses to the entry icon) as soon as a setting changes. */
  private applyCostVisibility(): void {
    if (this.showCost) {
      this.statusBarItem.show();
      return;
    }
    if (!this.showContext && !this.usageLimitTracking) {
      // Sole remaining entry point: an icon that opens the dashboard.
      this.statusBarItem.text = '$(graph)';
      this.statusBarItem.tooltip = I18n.t.popup.title;
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  updateUsageData(
    todayData: UsageData | null,
    workspaceTodayData?: UsageData | null,
    error?: string,
    usageLimits?: ClaudeApiUsageResponse | null,
    monthData?: UsageData | null
  ): void {
    // Quota is account-level and decoupled from local-data state: the caller
    // is expected to call updateQuota() separately so workspaces without
    // history still see it. We only touch the cost item here.
    this.isLoading = false;

    if (error) {
      this.showError(error);
      return;
    }

    if (!todayData) {
      this.showNoData();
      return;
    }

    this.showTodayData(todayData, workspaceTodayData ?? null, monthData ?? null);
    // The usageLimits arg is kept for callers that want a single-call update
    // path; quota was already refreshed earlier in this cycle.
    if (usageLimits !== undefined) {
      this.updateQuota(usageLimits);
    }
  }

  private updateStatusBar(): void {
    if (this.isLoading) {
      this.statusBarItem.text = `$(sync~spin) ${I18n.t.statusBar.loading}`;
      this.statusBarItem.tooltip = I18n.t.statusBar.loading;
      this.applyCostVisibility();
      return;
    }
  }

  private showTodayData(todayData: UsageData, workspaceTodayData: UsageData | null, monthData: UsageData | null): void {
    // Primary figure = today across all projects; secondary = today for the
    // current workspace, so you can see this project's share next to the global
    // total. Both reset at midnight. The metric setting switches cost ↔ tokens ↔ monthly cost.
    const ws = workspaceTodayData ?? null;
    const totalTokens = (d: UsageData): number =>
      d.totalInputTokens + d.totalOutputTokens + d.totalCacheCreationTokens + d.totalCacheReadTokens;
    let text: string;
    if (this.metric === 'tokens') {
      text = `$(symbol-number) ${I18n.formatTokensCompact(totalTokens(todayData))}`;
      if (ws) {
        text += ` $(folder) ${I18n.formatTokensCompact(totalTokens(ws))}`;
      }
    } else if (this.metric === 'monthly-cost') {
      text = `$(calendar) ${I18n.formatCurrency(monthData?.totalCost ?? 0)}`;
    } else {
      text = `$(pulse) ${I18n.formatCurrency(todayData.totalCost)}`;
      // Show the workspace figure whenever a workspace is open — including
      // $0.00; hiding it at zero read as a bug ("where did my number go?").
      if (ws) {
        text += ` $(folder) ${I18n.formatCurrency(ws.totalCost)}`;
      }
    }
    this.statusBarItem.text = text;

    this.statusBarItem.tooltip = this.metric === 'monthly-cost'
      ? this.createMonthlyTooltip(monthData)
      : this.createTooltip(todayData, ws);
    this.statusBarItem.backgroundColor = undefined;
    this.applyCostVisibility();
  }

  /**
   * Update the context-window indicator with the current session's fill
   * (estimated from the latest log record — see getCurrentContextInfo).
   * Hidden when there is no current session or the setting is off.
   */
  updateContext(info: ContextWindowInfo | null): void {
    if (!info || !this.showContext || info.windowTokens <= 0) {
      this.contextItem.hide();
      return;
    }
    const pct = Math.min(100, (info.contextTokens / info.windowTokens) * 100);
    // "~" marks an estimated (guessed) window size so the % doesn't read as exact.
    const approx = info.estimated ? '~' : '';
    this.contextItem.text = `$(layers) ${approx}${Math.round(pct)}%`;

    // Same thresholds as the quota item: amber at 80%, red at 95%.
    if (pct >= 95) {
      this.contextItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (pct >= 80) {
      this.contextItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.contextItem.backgroundColor = undefined;
    }

    const t = I18n.t.popup;
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    md.supportHtml = true;
    md.appendMarkdown(`**${t.contextWindow}** — ${info.model}\n\n`);
    // One HTML table following the tooltip convention — left column is the
    // label / visual, right column is the value. So the bar sits on the left and
    // its percentage on the right, lining up with the figures below. "~" marks a
    // guessed window size (see the override setting).
    const freeSpace = Math.max(0, info.windowTokens - info.contextTokens);
    const num = (n: number): string => I18n.formatNumber(n);
    let html = '<table>';
    html += `<tr><td>${this.progressBarSvg(pct, 30)}</td><td align="right"><b>${pct.toFixed(1)}%</b></td></tr>`;
    html += `<tr><td>${t.inputTokens}</td><td align="right">${num(info.inputTokens)}</td></tr>`;
    html += `<tr><td>${t.cacheRead}</td><td align="right">${num(info.cacheReadTokens)}</td></tr>`;
    html += `<tr><td>${t.cacheCreation}</td><td align="right">${num(info.cacheCreationTokens)}</td></tr>`;
    html += `<tr><td>${t.contextLeft}</td><td align="right">${num(freeSpace)} / ${approx}${num(info.windowTokens)}</td></tr>`;
    html += '</table>';
    md.appendMarkdown(html + '\n\n');
    // Two short, actionable lines (the rest of the explanation lives in Settings).
    md.appendMarkdown(`*${t.contextHint}*  \n*${t.contextHintCompact}*`);
    this.contextItem.tooltip = md;
    this.contextItem.show();
  }

  /**
   * Update the quota indicator with real 5-hour / weekly utilisation from the
   * OAuth usage API. Hidden when the data is unavailable (e.g. not signed in).
   * Public so it can be refreshed on its own while the rest of the UI is idle.
   */
  updateQuota(usageLimits: ClaudeApiUsageResponse | null): void {
    // A window's utilization is a point-in-time snapshot only valid until its
    // resets_at. When the OAuth fetch starts failing (expired creds, 401/403,
    // offline, rate-limited), maybeFetchUsageLimits keeps handing us the last
    // successful response — so without this guard we'd keep rendering a value
    // long after its window rolled over (e.g. a stale "5h:100%" lingering for
    // hours, even after a plan upgrade or a reset). Drop any window whose reset
    // time has passed. Adapted from PR #24 by @nickearnshaw.
    const live = this.liveWindows(usageLimits);
    // Collapse to the 5h window only.
    if (this.quotaFiveHourOnly && live) {
      live.seven_day = undefined;
      live.seven_day_opus = undefined;
    }
    // The status bar must stay clean: the default is the airy "5h 6% · wk 1%";
    // reset countdowns are opt-in (showResetInStatusBar), full reset detail
    // lives in the tooltip. The dense colon-heavy form is deliberately gone.
    // See quotaFormat.ts (pure + unit-tested).
    const opts: QuotaStatusOptions = {
      showReset: this.showResetInBar,
      fiveHourOnly: this.quotaFiveHourOnly,
      showOpusWeekly: this.showOpusWeekly
    };
    const text = formatQuotaStatusText(live, opts);
    if (!text) {
      this.quotaItem.hide();
      return;
    }
    const worstPct = worstShownUtilisation(live, opts);

    this.quotaItem.text = `$(dashboard) ${text}`;

    // Stay quiet until usage actually gets high.
    if (worstPct >= 95) {
      this.quotaItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (worstPct >= 80) {
      this.quotaItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.quotaItem.backgroundColor = undefined;
    }

    this.quotaItem.tooltip = this.createQuotaTooltip(live as ClaudeApiUsageResponse);
    this.quotaItem.show();
  }

  /**
   * Return a copy of the usage response containing only windows still inside
   * their current period. A window whose resets_at has already passed has
   * rolled over, so its cached utilization is stale and must not be shown.
   * A window with an unparseable resets_at is kept (we don't hide data we
   * can't reason about). Returns null when nothing current remains, which
   * collapses the indicator instead of showing a wrong figure.
   * Adapted from PR #24 by @nickearnshaw.
   */
  private liveWindows(usageLimits: ClaudeApiUsageResponse | null): ClaudeApiUsageResponse | null {
    if (!usageLimits) {
      return null;
    }
    const now = Date.now();
    const H5 = 5 * 60 * 60 * 1000;
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    // A window's utilization is a point-in-time snapshot valid until resets_at.
    // Once that passes the window has rolled over: utilisation is back at 0 for
    // the new period. Rather than show a stale value (the old #24 bug) or hide
    // the row entirely (which looked like the indicator vanished), we display
    // 0% and roll the reset time forward by whole periods so the countdown is
    // sensible. A forced refetch (see extension.maybeFetchUsageLimits) then
    // replaces this estimate with the real new-window value shortly after.
    const roll = (limit: ClaudeUsageLimit | undefined, periodMs: number): ClaudeUsageLimit | undefined => {
      if (!limit) {
        return undefined;
      }
      const t = Date.parse(limit.resets_at);
      if (isNaN(t)) {
        return limit; // unparseable — don't reason about it, keep as-is
      }
      if (t > now) {
        return limit; // still current
      }
      // Expired. If it reset only recently (within ~2 periods), the data is
      // simply waiting for the next refetch — show 0% for the fresh window.
      // But if it expired long ago, the fetch has been failing for ages and we
      // have no trustworthy data: drop it rather than assert a fabricated 0%
      // (which would falsely imply "full quota available").
      if (now - t > 2 * periodMs) {
        return undefined;
      }
      let next = t;
      while (next <= now) {
        next += periodMs;
      }
      return { utilization: 0, resets_at: new Date(next).toISOString() };
    };
    const out: ClaudeApiUsageResponse = {
      five_hour: roll(usageLimits.five_hour, H5),
      seven_day: roll(usageLimits.seven_day, WEEK),
      seven_day_opus: roll(usageLimits.seven_day_opus, WEEK)
    };
    if (!out.five_hour && !out.seven_day && !out.seven_day_opus) {
      return null;
    }
    return out;
  }

  private showNoData(): void {
    this.statusBarItem.text = `$(circle-slash) ${I18n.t.statusBar.noData}`;
    this.statusBarItem.tooltip = I18n.t.statusBar.notRunning;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.applyCostVisibility();
  }

  private showError(error: string): void {
    this.statusBarItem.text = `$(error) ${I18n.t.statusBar.error}`;
    this.statusBarItem.tooltip = error;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.applyCostVisibility();
  }

  /**
   * Hover tooltip as a Markdown table so figures line up in neat, right-aligned
   * columns (a plain-text tooltip cannot align reliably).
   */
  private createTooltip(todayData: UsageData, workspaceTodayData: UsageData | null): vscode.MarkdownString {
    const t = I18n.t.popup;
    const ws = workspaceTodayData;

    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;

    if (ws) {
      md.appendMarkdown(`| | $(pulse) ${t.today} | $(folder) ${t.workspaceToday} |\n`);
      md.appendMarkdown(`|:--|--:|--:|\n`);
    } else {
      md.appendMarkdown(`| | $(pulse) ${t.today} |\n`);
      md.appendMarkdown(`|:--|--:|\n`);
    }

    const row = (label: string, todayValue: string, sessionValue: string): void => {
      md.appendMarkdown(ws ? `| ${label} | ${todayValue} | ${sessionValue} |\n` : `| ${label} | ${todayValue} |\n`);
    };

    row(t.cost, I18n.formatCurrency(todayData.totalCost), ws ? I18n.formatCurrency(ws.totalCost) : '');
    row(
      t.inputTokens,
      I18n.formatNumber(todayData.totalInputTokens),
      ws ? I18n.formatNumber(ws.totalInputTokens) : ''
    );
    row(
      t.outputTokens,
      I18n.formatNumber(todayData.totalOutputTokens),
      ws ? I18n.formatNumber(ws.totalOutputTokens) : ''
    );
    row(
      t.cacheCreation,
      I18n.formatNumber(todayData.totalCacheCreationTokens),
      ws ? I18n.formatNumber(ws.totalCacheCreationTokens) : ''
    );
    row(
      t.cacheRead,
      I18n.formatNumber(todayData.totalCacheReadTokens),
      ws ? I18n.formatNumber(ws.totalCacheReadTokens) : ''
    );
    row(t.messages, I18n.formatNumber(todayData.messageCount), ws ? I18n.formatNumber(ws.messageCount) : '');

    md.appendMarkdown(`\n\n*Click for detailed breakdown*`);
    return md;
  }

  private createMonthlyTooltip(monthData: UsageData | null): vscode.MarkdownString {
    const t = I18n.t.popup;
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;

    md.appendMarkdown(`| | $(calendar) ${t.thisMonth} |\n`);
    md.appendMarkdown(`|:--|--:|\n`);
    md.appendMarkdown(`| ${t.cost} | ${I18n.formatCurrency(monthData?.totalCost ?? 0)} |\n`);
    md.appendMarkdown(`| ${t.inputTokens} | ${I18n.formatNumber(monthData?.totalInputTokens ?? 0)} |\n`);
    md.appendMarkdown(`| ${t.outputTokens} | ${I18n.formatNumber(monthData?.totalOutputTokens ?? 0)} |\n`);
    md.appendMarkdown(`| ${t.cacheCreation} | ${I18n.formatNumber(monthData?.totalCacheCreationTokens ?? 0)} |\n`);
    md.appendMarkdown(`| ${t.cacheRead} | ${I18n.formatNumber(monthData?.totalCacheReadTokens ?? 0)} |\n`);
    md.appendMarkdown(`| ${t.messages} | ${I18n.formatNumber(monthData?.messageCount ?? 0)} |\n`);
    md.appendMarkdown(`\n\n*Click for detailed breakdown*`);
    return md;
  }

  private createQuotaTooltip(usageLimits: ClaudeApiUsageResponse): vscode.MarkdownString {
    const t = I18n.t.popup;
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    md.supportHtml = true;
    md.appendMarkdown(`**${t.quota}**\n\n`);
    // HTML table with embedded SVG progress bars. SVG is the most reliable
    // VS Code can render inside a Markdown tooltip — it survives the markdown
    // sanitiser, looks identical on light and dark themes, and lets us pick
    // bar colour by threshold so a near-full quota visually screams.
    md.appendMarkdown(`<table>\n`);
    md.appendMarkdown(
      `<tr><th align="left">${t.quotaWindow}</th>` +
      `<th></th><th align="right">${t.share}</th>` +
      `<th align="right">${t.resets}</th></tr>\n`
    );
    if (usageLimits.five_hour) {
      md.appendMarkdown(this.quotaRowHtml(t.quota5h, usageLimits.five_hour, false));
    }
    if (usageLimits.seven_day) {
      md.appendMarkdown(this.quotaRowHtml(t.quotaWeekly, usageLimits.seven_day, true));
    }
    if (usageLimits.seven_day_opus) {
      md.appendMarkdown(this.quotaRowHtml(`${t.quotaWeekly} (Opus)`, usageLimits.seven_day_opus, true));
    }
    md.appendMarkdown(`</table>\n\n*${t.quotaHint}*`);
    return md;
  }

  /** Build one row of the quota tooltip table, with an SVG progress bar. */
  private quotaRowHtml(label: string, limit: ClaudeUsageLimit, weekly: boolean): string {
    const resetDate = new Date(limit.resets_at);
    const resets = isNaN(resetDate.getTime())
      ? '—'
      : weekly
        ? `${this.formatWeeklyReset(resetDate)}<br>${this.formatCountdown(resetDate)}`
        : this.formatCountdown(resetDate);
    const pct = Math.max(0, Math.min(100, limit.utilization));
    const bar = this.progressBarSvg(pct);
    return (
      `<tr>` +
      `<td align="left"><b>${label}</b></td>` +
      `<td>${bar}</td>` +
      `<td align="right">${pct.toFixed(1)}%</td>` +
      `<td align="right">${resets}</td>` +
      `</tr>\n`
    );
  }

  /** Progress bar: nested <span>s with solid background colours so the
   * sanitiser keeps everything we need. The outer span paints the full
   * 100% track in solid medium gray (#bbb) — visible on both light and
   * dark themes without relying on rgba opacity that some themes wash out.
   * The inner span paints the filled portion in colour, sitting on top of
   * the gray track.
   *
   * Bar colour mirrors the status-bar warning/error thresholds (amber at
   * >=80%, red at >=95%) so the visual signal matches the indicator. */
  private progressBarSvg(pct: number, total: number = 24): string {
    const TOTAL = total;
    const filled = Math.max(0, Math.min(TOTAL, Math.round((pct / 100) * TOTAL)));
    const empty = TOTAL - filled;
    let color = '#4caf50';                    // green
    if (pct >= 95) { color = '#f44336'; }     // red
    else if (pct >= 80) { color = '#ff9800'; } // amber
    const nbsp = (n: number) => '&nbsp;'.repeat(n);
    return (
      `<span style="background-color:#bbbbbb;font-size:48%;border-radius:3px;">` +
        `<span style="background-color:${color};border-radius:3px;">${nbsp(filled)}</span>` +
        `${nbsp(empty)}` +
      `</span>`
    );
  }

    /** Time remaining until a reset, e.g. "2h 15m" or "3.2d". */
  private formatCountdown(target: Date): string {
    const ms = target.getTime() - Date.now();
    if (ms <= 0) {
      return '0m';
    }
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 24) {
      return `${(hours / 24).toFixed(1)}d`;
    }
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  /** Localised weekday + time of a weekly reset, in 24-hour form
   * (e.g. "Wed 03:00"). hour12:false suppresses AM/PM that some locales add. */
  private formatWeeklyReset(target: Date): string {
    try {
      return target.toLocaleString(undefined, {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch {
      return target.toISOString();
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this.quotaItem.dispose();
    this.contextItem.dispose();
  }
}
