# Claude Code Usage

[![VSCode Marketplace](https://img.shields.io/visual-studio-marketplace/v/growthjack.claude-code-usage?style=flat-square&logo=visual-studio-code&label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=growthjack.claude-code-usage)
[![Open VSX Registry](https://img.shields.io/open-vsx/v/GrowthJack/claude-code-usage?style=flat-square&logo=eclipseide&label=Open%20VSX)](https://marketplace.cursorapi.com/items/?itemName=GrowthJack.claude-code-usage)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**The Claude Code coach in your status bar.** Not a billing tool. Not a
multi-provider monitor. A focused token tracker that uses AI to help you
use Claude Code better.

> **What this is:** A VS Code status-bar monitor that reads your local
> Claude Code conversation logs and shows **token-derived** usage and cost
> estimates — plus an optional AI advisor that suggests how to improve
> your prompts and reduce waste.
>
> **What this is _not_:** a billing tool. All amounts are estimates based
> on public per-million-token rates. Refer to your Anthropic account for
> actual charges.

> **看清你的 Claude Code 用量，让 AI 帮你用得更好。**
>
> **简介**：一个 VS Code 状态栏小工具，读取本地 Claude Code 对话日志，
> 按 token × 公开单价估算用量与成本；并提供可选的 AI 建议功能，帮你优化
> 提示词、减少不必要的 token 消耗。
>
> **它不是什么**：账单工具。显示金额均为估算值，实际费用请以官方账单为准。

🌐 **Multi-language documentation**:
[English](README-en.md) ·
[繁體中文](README-zh-TW.md) ·
[简体中文](README-zh-CN.md) ·
[日本語](README-ja.md) ·
[한국어](README-ko.md)

---

## Screenshots

### Status bar

![Status bar](images/v2-status-bar-en.png)

*Today's cost · current-session cost · 5-hour and weekly quota utilisation.*

Hover the quota indicator for a breakdown:

![Quota tooltip](images/v2-quota-en.png)

*Real `/usage` data — utilisation percent, reset countdown, and the
weekly reset weekday and time.*

### Dashboard

![Dashboard — summary and charts](images/v2-dashboard-en.png)

*Click the status bar to open the full dashboard. Stacked token-composition
chart, hourly breakdown, cache hit rate, cost composition by token type,
plus per-model and per-day tables below.*

### Content tab — where your tokens actually go

![Content tab](images/v2-content-en.png)

*Estimated breakdown of which content consumes tokens — your prompts vs.
tool results (by tool) vs. assistant output / thinking. This is the lever
for optimising your usage. Scoped to the last 30 days
(`advice.promptWindowDays`).*

### AI advice — a coaching report from your real usage

AI advice writes you a **Markdown document**, so it reads better as text than as
a screenshot. Set a key (`advice.apiKey`), click **Get AI advice** (the ✨ button
or the card on the Content tab), pick a scope (all projects, or one), and it sends
your usage aggregates + a sample of *your own* prompts to your model and opens a
prioritised report. Bring your own key — Anthropic (`/v1/messages`) by default, or
any OpenAI-compatible endpoint.

A flavour of what it returns (illustrative):

> **Write more complete instructions**
> - Several prompts open with "fix the bug" but don't name the file or the
>   symptom, so the first turn is spent searching. Lead with the file + expected
>   vs. actual behaviour.
>
> **Cut waste where it doesn't cost clarity**
> - ~38% of your tokens are spent above 150k context. `/clear` between unrelated
>   tasks keeps each request cheaper.

### Usage Optimizer

![Usage Optimizer card](images/v2-optimizer-en.png)

Paste a rough, half-formed request; get back one clean, **paste-ready** prompt
(plain text, no Markdown) plus a recommended reasoning effort / thinking / model
shown as chips. Three optional toggles refine it (flag vague references · condense
long pastes · suggest a style direction). Experimental, off by default; **only the
text you paste is sent** — never your files or the terminal — behind a one-time
consent prompt.

---

## What's new in 2.1

- **Sessions: resume / copy / delete** — each row can copy the session id,
  **resume** it (official Claude Code extension in-tab for this project, or a
  terminal `claude --resume <id>` for other projects), or **delete** it (to the
  trash, with confirm). A **Current project / All** filter defaults to the
  current project.
- **Quota display options** — `quotaFiveHourOnly` (show only the 5h
  window) and `showResetInStatusBar` (append the reset countdown, e.g.
  `5h:50%:2.3h | wk:30%:3.2d`), both in ⚙ Settings.
- **Wider dashboard** — detail page widened to 1600 px, still fluid
  on narrow screens.
- **Workflows tab** — every multi-agent run in one place: dynamic-workflow
  runs (ultracode) *and* ad-hoc sub-agent batches, with per-run cost, agent
  count, models used, **cache hit rate** (the "is my provider workflow-ready"
  diagnostic) and a per-agent drill-down labelled by each agent's task.
- **Usage tracking panel** — the official `/usage` "what's contributing"
  view, but multi-provider and with five scopes (Day / Week / Month /
  session / project): >150k-context share, 8h+-session share,
  subagent-heavy share, workflow share, plus Skills / Subagents / Plugins /
  Models breakdowns. Compact card on the Today tab.
- **Thinking share** per session (Sessions column + Today card) with an
  `/effort` hint when it runs high.
- **Workflow quota guard** — a dismissible banner before you start a run
  the remaining 5-hour window can't finish
  (`claudeCodeUsage.workflowQuotaWarnPercent`).
- **Settings in the dashboard** — a new ⚙ Settings tab manages every option
  in place; VS Code's own Settings keeps only the three that benefit from
  syncing (`language`, `dataDirectory`, `advice.apiKey`). Header buttons
  trimmed to ✨ AI advice and ⚙ Settings (both jump to their tab); the
  auto-refresh toggle moved into Settings (a manual ↻ appears when paused).
  If you hide the cost, quota *and* context items, the status bar keeps a small
  icon as a way back into the dashboard.
- **Status-bar metric** (`statusBarMetric`) — keep showing today's cost, or
  switch the first item to today's total **token** count (compact k/M).
- **Weekly Opus limit** (`showOpusWeekly`, opt-in) — append `opus:NN%` to the
  quota item for heavy Opus users. (PR #38, [@wheelbarrel00](https://github.com/wheelbarrel00).)
- **AI advice 2.0** — bring your own key: **Anthropic** (`/v1/messages`) by
  default, or any OpenAI-compatible endpoint (`advice.apiFormat`). Fed with the
  new signals (runs, cache hit rates, attribution, thinking share); optional
  `advice.userContext` adds a "Personalised for this project" section;
  `advice.promptWindowDays` (default 30) sets the sampling window. Transport
  hardened: timeout, retry, curl fallback. *(A keyless "subscription" backend
  was prototyped but isn't shipped — Anthropic blocks calling the API with the
  Claude Code OAuth token; it may return if that changes.)*
- **Usage Optimizer** (experimental, `advice.optimizer.enabled`, default off) —
  a Content-tab card where you paste a rough request and get back one tightened
  prompt as **plain text** (paste-ready, no Markdown) plus a recommended effort
  / thinking / model. Three optional lenses (flag ambiguous references ·
  condense long pastes · suggest a style direction). **Only the text you paste
  is sent**, behind a one-time consent prompt.
- **Context-window indicator** (experimental, off by default) — opt in via
  Settings to show the current session's context fill in the status bar. A "~"
  marks a guessed window; set `contextWindowOverride` for proxied/custom models.

## What's new in 2.0

- **Real 5-hour and weekly quota** in the status bar — reads Claude Code's
  existing OAuth session from `~/.claude/.credentials.json` or the macOS
  Keychain, zero config.
  Adapted from upstream [PR #9](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/9)
  by [@Dobidop](https://github.com/Dobidop).
- **Four new tabs**: Sessions, Projects, Content, Branches — all sortable.
- **Token-composition stacked chart** with Y-axis and reference lines.
- **AI advice command** (DeepSeek V4 Pro default, `reasoning_effort=max`)
  with a demo-mode fallback when no API key is configured.
- **Multi-vendor pricing**: Opus 4.x, Sonnet 4.x, Haiku 4.5 (verified
  against Anthropic's public pricing); reference rates for proxied setups
  (OpenAI, Gemini, DeepSeek, Kimi, GLM, Qwen) with family-aware fallback.
  `Refresh Token Pricing` pulls live LiteLLM data as runtime overrides.
- **Custom timezone** for date display (`claudeCodeUsage.timezone`).
- **Light-theme tab readability** fixed.
- **Locale-aware numbers and dates** throughout (German `.`, English `,`).
- **Real-time status bar** via `fs.watch` (1.5 s debounce) + idle-aware
  refresh + non-blocking loader (yields every 25 files).

Full changelog: [CHANGELOG.md](CHANGELOG.md).
Closes upstream issues
[#7](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/7),
[#10](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/10),
[#11](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/11),
[#13](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/13).

---

## Install

### VS Code Marketplace

Search for **`Claude Code Usage`** in the Extensions view (`Ctrl+Shift+X`),
or:

```
ext install GrowthJack.claude-code-usage
```

### Cursor / Windsurf / Antigravity (Open VSX)

Same extension is published at the Open VSX Registry:
[GrowthJack.claude-code-usage](https://marketplace.cursorapi.com/items/?itemName=GrowthJack.claude-code-usage).

### From a `.vsix` file

`Ctrl+Shift+P` → **Extensions: Install from VSIX...** → pick the
downloaded `.vsix`.

---

## Configuration

**Most settings live in the dashboard now.** Open the dashboard (run
**Show Usage Details**, or click the ⚙ in its header) and use the **⚙ Settings**
tab — grouped into General, Status bar, Data & refresh, and AI advice &
Optimizer. Changes apply immediately.

To keep VS Code's own Settings UI uncluttered, only three settings stay there
(so they still travel with Settings Sync). Open Settings (`Ctrl+,`) and search
for **`Claude Code Usage`**:

| Setting | Default | What it does |
|---|---|---|
| `language` | `"auto"` | UI language: `auto` / `en` / `zh-TW` / `zh-CN` / `ja` / `ko`. |
| `dataDirectory` | `""` | Custom Claude data dir; empty = auto-detect. |
| `advice.apiKey` | `""` | API key for AI advice + the Usage Optimizer (empty = advice opens a demo instead). |

Everything else — refresh interval, status-bar items, number/date formatting,
project grouping, content analysis, and all the AI advice / Optimizer options —
is in the dashboard's ⚙ Settings tab. Upgrading keeps your existing values: a
one-time migration copies them out of `settings.json` on first launch.

---

## How costs are calculated

The status-bar cost is **`Σ (tokens × per-million rate)`** across input,
output, cache-write and cache-read, summed by model.

- **Per-million rates** come from the bundled pricing table, which is
  verified against the public Anthropic pricing page and supplemented
  with reference rates for non-Anthropic models that may appear in
  proxied setups.
- **`Refresh Model Pricing`** (command + button in the dashboard) pulls
  live prices from [LiteLLM's public dataset](https://github.com/BerriAI/litellm)
  as runtime overrides.
- **Unknown model snapshots** are priced against the current tier of
  their detected family (Opus / Sonnet / Haiku / GPT / Gemini /
  DeepSeek / Kimi / GLM / Qwen) instead of falling back blindly.

What the status bar does **not** know:
- Your actual Anthropic invoice (discounts, free credits, plan caps).
- Whether your proxy provider charges different rates.
- Anything not recorded in your local `.jsonl` log files.

The **5h / weekly quota indicator** is different — it queries Claude
Code's real `/usage` endpoint via the OAuth session and shows the actual
percentage Anthropic is tracking for your account. That number is
authoritative.

---

## Privacy

- All token / cost / session analysis runs **locally** by reading your
  `~/.claude/projects/**/*.jsonl` files.
- The quota indicator calls **`api.anthropic.com/api/oauth/usage`** using
  Claude Code's existing OAuth token. No additional credentials are sent.
- **AI advice** and the **Usage Optimizer** are the only features that call a
  model — and only when *you* trigger them. AI advice sends an aggregate
  summary of your usage plus a sample of your recent prompts; the Optimizer
  sends **only the text you paste into it** (never your files or the terminal),
  behind a one-time consent prompt. Both send to the endpoint in `advice.apiUrl`
  with your own `advice.apiKey` (Anthropic `/v1/messages` by default, or any
  OpenAI-compatible endpoint). **Bring your own key**; nothing is shipped with
  the extension.

---

## Troubleshooting

**"No Claude Code Data"**
- Make sure Claude Code is installed and you have used it at least once.
- Check the `dataDirectory` setting; auto-detection looks at
  `~/.claude/projects` and `~/.config/claude/projects`.

**Quota row shows `5h:--% wk:--%`**
- Claude Code's OAuth token is missing or expired. Log in to Claude Code
  once; the extension reads `~/.claude/.credentials.json` where present, or
  the macOS Keychain entry used by Claude Code, and refreshes the bearer if
  needed.

**`Get AI Usage Advice` returns 404**
- DeepSeek's current endpoint does **not** use a `/v1` prefix. Use
  `https://api.deepseek.com/chat/completions`. The extension auto-strips
  `/v1` if present.

**`Get AI Usage Advice` shows demo instead of real advice**
- AI advice needs a key. With no key under `claudeCodeUsage.advice.apiKey`, the
  command opens a hand-written demo (filename-marked `…-DEMO-…`, with a prominent
  banner) instead of calling any API. Add a key in Settings to get real advice.

**Sluggish refresh on large histories**
- 2.0 yields to the event loop every 25 files; idle ticks skip recompute.
  If you still hit issues, raise `refreshInterval` or set
  `enableContentAnalysis` to `false`.

**Usage history disappears or is missing older months**
- Claude Code automatically deletes conversation logs older than
  `cleanupPeriodDays` (default: **30 days**). Once deleted, those records
  cannot be recovered. To retain more history, add this to your
  `~/.claude/settings.json`:
  ```json
  { "cleanupPeriodDays": 365 }
  ```
  This only affects logs kept from now on; already-deleted logs cannot be
  restored. Thanks to [@nickearnshaw](https://github.com/nickearnshaw) for
  documenting this ([PR #21](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/21)).

**Token counts appear lower than the model provider's own dashboard**
- If you use Claude Code with a third-party proxy that routes requests
  through sub-agents or background workflows (e.g. ultracode / dynamic
  workflows), each agent writes its own `.jsonl` log file inside a
  sub-directory. The extension reads all these files, but some proxy
  configurations may not write agent-level records at all. Until native
  workflow attribution is added in a future release, the total shown here
  may be lower than the provider's upstream count. Your actual spend is
  always on your provider's billing page.

---

## Credits

Maintained by [**@Carl723000**](https://github.com/Carl723000), who forked it
from [@jack21](https://github.com/jack21)'s original
[`ClaudeCodeUsage`](https://github.com/jack21) and now also helps own and
maintain the upstream organization
[`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage).
MIT-licensed. The 2.x work documented here (everything under "What's new") is by
@Carl723000 with [Claude Code](https://claude.com/claude-code); it has grown well
beyond the 2.0 baseline — see [CHANGELOG.md](CHANGELOG.md).

Contributors whose upstream PRs / issues are incorporated here:

- [@Dobidop](https://github.com/Dobidop) —
  [PR #9](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/9), the OAuth
  approach for reading real `/usage` data; the quota indicator is adapted from
  that work.
- [@nickearnshaw](https://github.com/nickearnshaw) —
  [PR #8](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/8) locale-aware
  number/date formatting;
  [PR #20](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/20) fix for
  the webview/status-bar getting stuck on "Loading…" (re-entrancy guard +
  spinner only on cold start);
  [PR #21](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/21) docs on
  `cleanupPeriodDays` for retaining usage history;
  [PR #24](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/24) quota-window
  rollover handling (drop a window once its reset has passed).
- [@ScherbakovAl](https://github.com/ScherbakovAl) —
  [PR #31](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/31), the
  original status-bar context-window indicator and the `showCost` toggle.
- [@wheelbarrel00](https://github.com/wheelbarrel00) —
  [PR #38](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/38), the opt-in
  weekly Opus limit (`showOpusWeekly`) in the status bar.
- [@brenoneill](https://github.com/brenoneill) —
  [PR #14](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/14), custom
  data directory (merged into upstream 1.0.8).
- [@mxzinke](https://github.com/mxzinke) — Opus 4.5 / Haiku 4.5 prices
  + German translation (upstream 1.0.8).

Also closed along the way: the test-suite seed
([#25](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/25)) and
unreliable context-window detection for proxied/custom models
([#31](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/31)).

Many code changes in this fork were drafted with assistance from
[Claude Code](https://claude.com/claude-code) (commits include
`Co-Authored-By: Claude <noreply@anthropic.com>`).

---

## Changelog

The current changelog lives in [**CHANGELOG.md**](CHANGELOG.md). The
most recent 2.1 entry summarises every feature, fix and personalisation
option in this release.

<details>
<summary><b>Pre-2.0 history (upstream 1.0.x)</b></summary>

### v1.0.8 (2025-11-28)
- Converted code comments from Traditional Chinese to English.
- Improved internationalisation standards.
- Pricing: added Opus 4.5 / Haiku 4.5 (thanks @mxzinke).
- Added German (de-DE) translation (thanks @mxzinke).

### v1.0.7 (2025-11-28)
- Multilingual translation for hourly usage labels.
- Removed hardcoded Chinese text; switched to i18n.

### v1.0.6 (2025-08-10)
- Added support for Claude Opus 4.1 pricing.

### v1.0.5 (2025-01)
- Hourly usage statistics + visualisation.

### v1.0.4 (2025-01)
- All-time data calculation; "All Time" translations.

### v1.0.3 (2025-01)
- Repository URL migration + README image link fixes.

### v1.0.0 (2025-01)
- Initial complete release.

</details>

---

## Contributing

Issues and pull requests are welcome on the
[GitHub repository](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage).

## License

[MIT](LICENSE)
