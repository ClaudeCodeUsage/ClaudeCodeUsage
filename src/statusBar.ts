import * as vscode from 'vscode';
import { ClaudeApiUsageResponse, ContextWindowInfo, UsageData } from './types';
import { I18n } from './i18n';
import {
  formatMonthlyReset,
  formatQuotaStatusText,
  formatResetCell,
  formatSharePercent,
  worstShownUtilisation,
  QuotaStatusOptions,
  ResetCountdownFormat
} from './quotaFormat';
import {
  QuotaCredits,
  QuotaWindow,
  creditsFromUsage,
  liveQuotaWindows,
  normalizeQuotaWindows,
  visibleQuotaWindows
} from './quotaWindows';

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
  // Opt-in: nest model-scoped weekly caps into the quota item's weekly figure,
  // as "wk 9% (fable 17%)". Grew out of the weekly-Opus option in PR #38
  // (@wheelbarrel00), which named a single model; the API now scopes these caps
  // itself, so the label follows whatever it reports.
  private showScopedWeekly: boolean = false;
  // Quota display preferences.
  private quotaFiveHourOnly: boolean = false; // show only the 5h window
  private showResetInBar: boolean = false;    // append reset countdown to the bar
  private resetCountdownFormat: ResetCountdownFormat = 'decimal'; // style of that countdown (#74)

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
    showScopedWeekly: boolean = false,
    quotaFiveHourOnly: boolean = false,
    showResetInBar: boolean = false,
    resetCountdownFormat: ResetCountdownFormat = 'decimal'
  ): void {
    this.showCost = showCost;
    this.showContext = showContext;
    this.usageLimitTracking = usageLimitTracking;
    this.metric = metric;
    this.showScopedWeekly = showScopedWeekly;
    this.quotaFiveHourOnly = quotaFiveHourOnly;
    this.showResetInBar = showResetInBar;
    this.resetCountdownFormat = resetCountdownFormat;
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
    // Normalize first: the API exposes quota windows two ways and only the
    // generic `limits` array still carries the per-model caps. See
    // quotaWindows.ts. liveQuotaWindows then drops or zeroes anything whose
    // period has rolled over, because when the OAuth fetch starts failing the
    // caller keeps handing us the last successful response.
    // visibleQuotaWindows then hides per-model caps sitting at 0%, applied once
    // here so the bar text, its warning colour, and the tooltip all agree.
    const live = visibleQuotaWindows(liveQuotaWindows(normalizeQuotaWindows(usageLimits)));
    // The status bar must stay clean: the default is the airy "5h 6% · wk 1%";
    // reset countdowns are opt-in (showResetInStatusBar), full reset detail
    // lives in the tooltip. The dense colon-heavy form is deliberately gone.
    // See quotaFormat.ts (pure + unit-tested).
    const opts: QuotaStatusOptions = {
      showReset: this.showResetInBar,
      fiveHourOnly: this.quotaFiveHourOnly,
      showScopedWeekly: this.showScopedWeekly,
      resetFormat: this.resetCountdownFormat
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

    this.quotaItem.tooltip = this.createQuotaTooltip(live, creditsFromUsage(usageLimits));
    this.quotaItem.show();
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

  /**
   * The detail view. It lists EVERY window the API reported, including scoped
   * caps the status-bar text is hiding, so opting out of "fable 16%" in the bar
   * still leaves the figure one hover away — which matters, because a scoped cap
   * can be the binding one.
   */
  private createQuotaTooltip(windows: QuotaWindow[], credits: QuotaCredits | null): vscode.MarkdownString {
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
    // One row per cap, each with its own bar. The tooltip has the width the
    // status bar does not, so a per-model cap is easier to read on its own line
    // than folded into the weekly figure.
    for (const w of windows) {
      md.appendMarkdown(
        this.quotaRowHtml(
          this.quotaRowLabel(w),
          formatSharePercent(w.utilization, w.decimals),
          w.utilization,
          formatResetCell(w.resetsAt, { format: this.resetCountdownFormat })
        )
      );
    }
    if (credits && credits.used > 0) {
      // The amount rather than a percentage: the cap is user-adjustable and may
      // be unlimited, so a share of it says little. The bar still tracks the cap
      // whenever there is a finite one.
      const spent = this.formatCreditAmount(credits.used, credits.currency);
      const amount = credits.limit === null
        ? spent
        : `${spent} / ${this.formatCreditAmount(credits.limit, credits.currency)}`;
      md.appendMarkdown(
        this.quotaRowHtml(
          t.quotaCredits,
          amount,
          credits.percent ?? 0,
          formatMonthlyReset(credits.resetsAt)
        )
      );
    }
    md.appendMarkdown(`</table>\n\n*${t.quotaHint}*`);
    return md;
  }

  /** Credit amounts always carry two decimals (they are real money, unlike the
   * estimated token costs elsewhere, which follow the user's decimalPlaces).
   * I18n.formatCurrency is USD-only, so any other currency prints its code
   * rather than a wrong "$". */
  private formatCreditAmount(amount: number, currency: string): string {
    return currency === 'USD' ? I18n.formatCurrency(amount, 2) : `${amount.toFixed(2)} ${currency}`;
  }

  /** Tooltip label for a window. Scoped rows are named by the API ("Fable"), so
   * the extension never has to know which model the plan meters this week. */
  private quotaRowLabel(w: QuotaWindow): string {
    const t = I18n.t.popup;
    if (w.kind === 'session') {
      return t.quota5h;
    }
    if (w.kind === 'weekly_all') {
      return `${t.quotaWeekly} (${t.quotaAllModels})`;
    }
    return w.scopeLabel ? `${t.quotaWeekly} (${w.scopeLabel})` : `${t.quotaWeekly} (${t.quotaScoped})`;
  }

  /** Build one row of the quota tooltip table, with an SVG progress bar. The
   * share text and reset text are pre-formatted by the pure helpers in
   * quotaFormat, so this only assembles HTML.
   *
   * The reset cell carries a leading pad because both it and the share beside it
   * are right-aligned: VS Code's tooltip table gives adjacent cells no gutter, so
   * "9%2d 7h (Thu 17:00)" ran together as one string without it. */
  private quotaRowHtml(label: string, shares: string, barPct: number, resets: string): string {
    const bar = this.progressBarSvg(Math.max(0, Math.min(100, barPct)));
    return (
      `<tr>` +
      `<td align="left"><b>${label}</b></td>` +
      `<td>${bar}</td>` +
      `<td align="right">${shares}</td>` +
      `<td align="right">&nbsp;&nbsp;${resets}</td>` +
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

  dispose(): void {
    this.statusBarItem.dispose();
    this.quotaItem.dispose();
    this.contextItem.dispose();
  }
}
