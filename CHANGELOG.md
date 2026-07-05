# Changelog

All notable changes to this fork compared to upstream
[`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage) (last
upstream release: 1.0.8). Format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Fixed
- **Sonnet 5 context window** — `contextWindowFor()` only recognised the 1M
  window via a "4.6+" pattern (e.g. `sonnet-4-6`), so `claude-sonnet-5` — which
  has no `-4-` segment — fell through to the 200K legacy default. The dashboard
  and status-bar context bar now correctly show a 1M window for Sonnet 5.

## [2.1.1] — Unreleased

### Added
- **Monthly cost in the status bar** — the `statusBarMetric` setting gains a
  new `monthly-cost` option. When selected, the first status-bar item shows the
  current calendar month's total cost ($(calendar) icon) instead of today's
  cost. Hover tooltip mirrors the today tooltip with month-to-date token and
  cost breakdown. (PR #41, @PhisicsLollo0.)
- **Sessions: resume / copy / delete** — each session row can copy its id, copy
  its project path, resume it (in the
  official Claude Code extension, or a terminal for cross-project sessions), or
  delete it (to the trash, after a confirm); plus a Current project / All filter.
  (PR #43, @oxsean.)
- **Quota display options** — `quotaFiveHourOnly` (show only the 5-hour window)
  and `showResetInStatusBar` (append a compact reset countdown) in the ⚙ Settings
  tab. The default stays the clean `5h 6% · wk 1%`; full reset times always live
  in the tooltip. To hide cost, set `statusBarMetric` to `tokens`. (PR #43.)
- **Sturdier quota** — the last `/usage` result is cached to disk and shown
  instantly on startup; on a 429 the fetch backs off instead of hammering the
  endpoint. (PR #43.)
- **Wider dashboard** (up to 1600 px) with indented sub-project rows; status-bar
  setting changes apply without a full dashboard reload. (PR #43.)
- **Brazilian Portuguese (pt-BR)** — adds pt-BR as a seventh interface
  language: status bar, dashboard, settings labels/help and the advice demo
  sample. (PR #48, @henrique-carvalho-dev.)

### Fixed
- **Account switch now refreshes the quota** — switching Claude accounts no
  longer leaves the status bar stuck on the previous account's usage until a
  window reload. The OAuth credentials are re-read on every quota fetch (a
  switched-in account's token is valid, so the old expiry-only re-read never
  noticed it), and the credentials file is watched so the change is picked up
  promptly instead of after a full cache interval. (Keychain-stored credentials
  on macOS update on the next refresh tick.) (PR #47.)
- **Model pricing accuracy** — several models had missing or stale pricing:
  `glm-5.1`, `glm-5.2` (were falling back to glm-4.6 rates), `minimax-m3`
  (used Sonnet default), `mimo-v2.5-pro` (used Sonnet default),
  `kimi-k2.7-code` (input/output correct via family inference, cache wrong),
  `qwen3.5-flash`, `qwen3.5-plus` (used qwen-plus rates),
  `hy3-preview` (used Sonnet default), `step-3.7-flash`, `step-3.5-flash`
  (used Sonnet default). Added correct official/exchange rates for each;
  registered family-inference branches for minimax, mimo, hy3 and step-
  so unknown future models from these providers also get sensible defaults.
  (PR #46, @YuboZhang.)

## [2.1.0] — 2026-06-26

### Added
- **Weekly Opus limit in the status bar** — opt-in `showOpusWeekly` (default
  off) appends `opus:NN%` after the 5h / weekly quota figures, for heavy Opus
  users who want an at-a-glance weekly Opus signal. Merged from
  [PR #38](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/38)
  (@wheelbarrel00); re-applied here on the dashboard-managed settings.
- **Settings in the dashboard** — a new ⚙ Settings tab edits every option in
  place (grouped: General, Status bar, Data & refresh, AI advice & Optimizer),
  applied immediately. To keep VS Code's own Settings UI uncluttered, only
  three settings stay declared there (so they still sync via Settings Sync):
  `language`, `dataDirectory`, `advice.apiKey`. The rest now live in the
  extension's own storage and are managed from the dashboard. A one-time
  migration copies any existing `settings.json` values into the new store on
  first launch, so upgrades keep your configuration. (Setting labels/help are
  English; group headers and chrome are localised in all six languages.)
- **Workflows tab** — one row per multi-agent run: true dynamic-workflow
  runs (wf_ dirs) **and ad-hoc sub-agent batches** (≥2 Task-tool agents in
  one session, tagged "subagents" — what ultracode produces when the
  dynamic-workflow feature isn't engaged, e.g. via proxy routing). Columns:
  start time, name (script-derived or session title), project, **models
  used**, agent count, cost, token split, **cache hit rate** and duration;
  expands to a per-agent breakdown where each agent is labelled by **the
  task it was dispatched** (shared boilerplate hoisted into one pinned row,
  agent rows show only what differs; full text in tooltips). The cache
  hit rate is the headline diagnostic: native-Claude workflows reuse the
  prompt cache across agents (observed ~75%), a provider without cross-agent
  caching shows ~0% — i.e. the same workflow costs disproportionately more.
  A summary strip shows this month's workflow count, cost and cost share.
- **Sub-agent attribution in the loader** — records from `subagents/` logs
  now carry the workflow id, agent id and agent type (from
  `agent-*.meta.json`), resolved from the file path so worktree-isolated
  agents attribute correctly.
- **Thinking share** — estimated thinking-token share per session (new
  sortable Sessions column, ⚠ + `/effort` hint above 60%) and a one-line
  summary on the Today tab. Estimated from text length, like the rest of
  the content analysis.
- **Workflow quota guard** — a dismissible dashboard banner when the
  remaining 5-hour quota drops below `workflowQuotaWarnPercent` (default
  50%, 0 disables): interrupted workflow runs lose their prompt cache and
  re-run ~40% more expensive. The status bar stays untouched.
- **Usage attribution panel** ("What's contributing to your usage?") —
  modelled on the official `/usage` screen but multi-provider and with five
  scopes (Day / Week / Month / per-session / per-project, vs. Day/Week
  officially). Characteristic lines (independent signals, not a breakdown):
  share of usage at >150k context, from 8h+ active sessions, from
  subagent-heavy sessions, from workflow runs, plus the top skill and top
  plugin once they exceed 10%. Tables: Skills, Subagents (by agent type),
  Plugins, Models. Skill shares follow the official methodology — the
  session's usage at/after the skill's invocation counts toward it (shares
  overlap by design); trivial commands like /model and /clear are excluded.
  Full panel in the Content tab; a compact strip (≥5% lines only) on the
  Today tab.

- **AI advice transport** — speaks the **Anthropic** `/v1/messages` shape by
  default (`advice.apiFormat`), with the OpenAI chat-completions shape kept for
  DeepSeek and other compatible proxies. Timeout / retry / curl-fallback
  hardening across both. *(A keyless "subscription" backend — reuse the Claude
  Code OAuth session to call the API with no key — was prototyped and verified
  working via curl, but is NOT shipped: Anthropic returns 403 "Request not
  allowed" for that use of the OAuth token, so it's too fragile/inappropriate
  for a public extension. The transport stays dormant in advisor.ts to
  re-enable if direct calls become permitted.)*
- **AI advice fed with the new signals** — the advice prompt now includes
  the multi-agent runs (per-run cost, agent fan-out, cache hit rate per
  provider), the estimated thinking share and the usage-attribution panel
  (characteristics + top skills/subagents/plugins/models), so the model can
  give targeted advice instead of generic tips. New optional setting
  `claudeCodeUsage.advice.userContext`: free-text background about you/the
  project; when set, the advice ends with a "Personalised for this project"
  section calibrated against it. New `advice.promptWindowDays` (default 30)
  sets how many days of your own prompts and content the analysis samples.
- **AI advice card** at the top of the Content tab — the "Get AI advice"
  button now lives in a labelled card that says, in one line, what gets sent,
  instead of being tucked into the analysis header.
- **Usage Optimizer** (opt-in, `advice.optimizer.enabled`, default off) — a
  card on the Content tab where you paste a rough request and get back ONE
  tightened, paste-ready prompt plus a recommended reasoning effort / thinking
  / model for that task. Three optional lenses: flag ambiguous references,
  condense long pasted material, suggest a style direction. Runs through the
  same backend as AI advice; **only the text you paste is sent** (never your
  files or Claude Code's terminal), behind a one-time consent prompt.
- **Context-window indicator** in the status bar — shows the current
  session's context fill as a percentage (like `/context`), estimated from
  the latest log record (`input + cache read + cache write` tokens vs the
  model's window; `[1m]` long-context variants use 1M). Amber at 80%, red at
  95%. **Experimental, off by default** (`claudeCodeUsage.showContext`) — it can
  only show the input-side total, not `/context`'s category breakdown (those are
  Claude Code internals not on disk). A `~` marks a guessed window size;
  `contextWindowOverride` pins the real size for proxied/custom models. Reads
  the main-thread record (a running sub-agent no longer hijacks it) and stays
  visible across an overnight gap (24 h staleness guard). The tooltip shows a
  quota-style bar + the input-side composition.
  (Built on [PR #31](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/31), @ScherbakovAl.)
- **`claudeCodeUsage.showCost` setting** — hide the status-bar cost item for
  those who only want the quota / context indicators (the dashboard still
  shows all cost figures). (PR #31, @ScherbakovAl.)
- **Authoritative skill / plugin attribution** — the Usage tracking panel now
  weights skills and plugins by the exact usage Claude Code stamps on each line
  (`attributionSkill` / `attributionPlugin`, ≥ CC 2.1) instead of the
  `<command-name>` heuristic, which it keeps only as a fallback for older logs.
- **Workflow main-session orchestration** — each run's drill-down now shows the
  main-thread spend that bracketed it (same session, within the run's window),
  so a native-Claude run whose expensive Opus/Fable orchestration lived in the
  main thread finally shows its true cost and models, not just the cheap
  sub-agent files. Heuristic (timestamp-bracketing, capped to focused windows).
- **Clearer run badges** — "workflow" (a dynamic-workflow run dir) vs
  "subagents (ad-hoc)" (a plain Task-tool fan-out), with a hint that the effort
  level itself is not recorded in the logs.
- **Per-model context-window sizes** in the status-bar context indicator
  (Opus 4.6+/Sonnet 4.6+/Fable 5 = 1M, Haiku/older Claude = 200K, DeepSeek =
  128K), and its tooltip is now a `/context`-style breakdown (fresh input /
  cache read / cache write / free space) with a tightened note. The Today
  "Usage tracking" card now shows only exact cost-weighted shares — the
  text-length thinking estimate was dropped from it (it remains on the
  Sessions tab, marked as an estimate). The Workflows tab gained a note
  explaining that native-Claude ultracode whose orchestration stays in the
  main session shows up in Sessions / Usage tracking rather than as a row.
- **Calibrated content analysis** — the Content tab can now anchor its
  per-category token figures to the *exact* billed totals (`analysis.calibrate`,
  default on): relative shares still come from text length, but the absolute
  numbers are scaled so assistant categories sum to real output tokens and
  user/tool-result categories to real input + cache-write tokens. This corrects
  a large undercount the text-length estimate had on the input side (cache
  creation is invisible to character counts). Sessions' Thinking column gains a
  calibrated "real thinking tokens" figure in its tooltip.

### Changed
- **Header trimmed** — the apple-style auto-refresh toggle moved into the ⚙
  Settings tab (a manual ↻ refresh still appears top-right when auto-refresh is
  paused). Two shortcut buttons remain: ✨ AI advice and ⚙ Settings, each
  jumping to its tab. The gear icon sits on the header button; the tab label
  drops it.
- **Usage Optimizer output is plain text** — the rewritten prompt is now
  returned without Markdown (no bold/headings/backticks/bullets) so it pastes
  cleanly into a terminal. Copy clearer, task-framed help; marked experimental.
- **AI advice + Optimizer cards redesigned** as a cohesive "action card"
  treatment (accent rail + icon badge), distinct from the data panels.

### Fixed
- **"Get AI Usage Advice" hanging or failing with `terminated`** — the
  request now has a 120 s timeout with a clear error, one retry, and a
  fallback to the system `curl` (the same transport of last resort the quota
  client uses); the prompt-sample payload is capped (40 prompts × 1500 chars).
- **Advice prompt samples polluted by agent traffic** — sub-agent logs,
  meta/sidechain lines and agent-framework scaffolding text are no longer
  harvested as "user prompts" for the advice feature.
- **Quota indicator blanked after switching folders in the same window** — the
  curl fallback now pins its working directory to the home dir (an inherited,
  now-invalid cwd made `spawn` fail with ENOENT), and a workspace-folders-change
  listener forces a fresh fetch — so the quota survives a folder switch without
  needing a new window.

## [2.0.2] — 2026-06-09

### Added
- **Claude Fable 5 / Mythos 5** pricing ($10 / $50, cache write $12.50,
  cache read $1 per MTok). Model ids with a `[1m]` long-context suffix are
  now resolved to their base pricing (also fixes proxy configs like
  `deepseek-v4-pro[1m]`).
- **Stacked cost-composition charts** on the Today (hourly), This-Month
  (daily) and All-Time (monthly) views, with a Y-axis and reference lines.
  Each cost bar splits into input / output / cache-write / cache-read; the
  metric switcher still renders single bars for token / message metrics.
- **Sessions tab "Session" column** — the conversation title (the name
  `claude --resume` shows), sortable, so same-project sessions are
  distinguishable.
- Dashboard **auto-refresh toggle** had already landed in 2.0.1; this release
  refines its surrounding behaviour.

### Fixed
- **Quota indicator stale / stuck after reset** — an expired window now shows
  0% (rolled forward to the new period) and is refetched, instead of lingering
  on a stale value or vanishing. Adapted from
  [PR #24](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/24) by
  [@nickearnshaw](https://github.com/nickearnshaw).
- **Quota "only comes back after I restart VS Code"** — an expired in-memory
  OAuth token now triggers a re-read of `~/.claude/.credentials.json` (which
  Claude Code keeps refreshing) before our own refresh; the 429 cool-down was
  cut from 5 minutes to 60 s; and the `/usage` fetch cadence was made gentler
  (60 s active / 120 s idle) so rate-limiting is rare.
- **Usage not showing the first time you open VS Code** — the status bar now
  shows a loading state immediately and the quota fetch is non-blocking, so
  local cost figures appear at once and the quota follows.
  ([#26](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/26))
- **"This project" figure undercounted / disappeared** — per-conversation
  attribution now keys off the session's home project directory instead of the
  per-record working directory (which wanders mid-session), and the figure is
  shown even at $0 instead of vanishing through the day.
- **Message count** now counts messages you actually typed, excluding API
  calls, command echoes (`/model` …) and interruption markers (a session that
  read 106 now reads ~86). Token figures are unchanged.
- **Per-metric chart Y-axis** now updates when switching metric (it was stuck
  on the cost units).
- **Activity-aware refresh** (≈8 s while Claude Code is writing, the user's
  interval when idle) with coalesced triggers, so high-consumption ultracode /
  Fable 5 runs update promptly without starving on rapid sub-agent writes.
- **Sub-agent / workflow log attribution** — records under
  `subagents/workflows/…` resolve to their parent session and real project
  (were fragmenting into `wf_*` / `agent-*` pseudo-entries).
- Drill-down charts: removed a double scrollbar; date labels parse the date
  textually (UTC parsing shifted labels a day in negative-UTC timezones).
- `launch.json` `preLaunchTask` fixed so F5 works in a single-root checkout
  ([PR #22](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/22), @nickearnshaw).

### Docs / project
- Refreshed all language READMEs to v2 (en / zh-TW / ja / ko concise; zh-CN
  full translation); fixed the `CHANGELOG.md` link casing.
- Added `CONTRIBUTING.md`, a PR template, and issue templates; documented
  `cleanupPeriodDays` for history retention
  ([PR #21](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/21), @nickearnshaw).
- Loading-spinner / re-entrancy guard for the webview
  ([PR #20](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/20), @nickearnshaw).
- Updated `CLAUDE.md` to the v2 architecture and release process.

---

## [2.0.1] — 2026-06-03

### Added
- **Dashboard "Auto-refresh" toggle** — iOS-style slider in the header
  pauses automatic webview updates while the status bar continues live.
  The "Refresh Now" button appears when auto-refresh is off. State persists
  via `claudeCodeUsage.pauseDashboardRefresh` setting. Addresses
  issue #17 follow-up (constantly-reloading dashboard during agent work).
- **`claudeCodeUsage.fileWatching` setting** — disables `fs.watch`-based
  real-time refresh for users who prefer the calmer interval-only mode.
- **Diagnostic output channel** — `Claude Code Usage: Show Diagnostic Logs`
  now logs per-refresh stats: files scanned, records kept/replaced/skipped,
  rejection reasons, and per-model record counts with token sums. Useful
  for diagnosing under-reported usage with third-party proxies.

### Fixed
- **Dedup kept the wrong record** (issue #18, reported by @zhaoxiao9302):
  proxies such as mimo / CC Switch write a `tokens=0` placeholder first
  and then a second record with real values sharing the same `messageId`.
  The dedup now keeps whichever record has the higher total token sum
  instead of always keeping the first.
- **DeepSeek pricing wrong** — `deepseek-chat` and `deepseek-reasoner`
  were priced at V4-Flash rates ($0.14/$0.28); corrected to V4-Pro
  ($0.435/$0.87, cache hit $0.003625). Added explicit `deepseek-v4-pro`
  entry. Family fallback now also resolves to Pro tier.
- **Quota indicator hidden in workspaces without local data** — quota is
  account-level; it now refreshes unconditionally and is no longer hidden
  when the workspace has no Claude history or the data directory cannot
  be found.
- **Webview / status bar stuck on "Loading…"** (PR #20, @nickearnshaw):
  added re-entrancy guard so overlapping refresh triggers coalesce instead
  of piling up. Spinner now only shows on cold start (no data yet);
  background refreshes keep the existing dashboard visible.
- **Log timestamps were UTC** — diagnostic output channel now shows the
  user's local time.

### Added (models)
- **Opus 4.8** added to the pricing table (same tier as 4.7/4.6/4.5).

### Changed
- Quota fetch cache: 2 min (v2.0.0) → 120 s (unchanged value, restored
  from an intermediate 30 s that was too chatty).
- Validator relaxed: only `timestamp` and numeric `input_tokens` /
  `output_tokens` are required; secondary fields with unexpected types
  are accepted rather than causing the whole record to be dropped.
- `claudeCodeUsage.advice.apiKey` no longer falls back to the pre-2.0
  flat `adviceApiKey` key (fixes demo-mode never triggering).

### Docs
- README intro replaced with "The Claude Code coach in your status bar"
  positioning (EN + 中文 + ja + ko + zh-TW slogan updated).
- New Troubleshooting entries: missing history (→ `cleanupPeriodDays`),
  token counts lower than provider dashboard (→ sub-agent note).
  Thanks @nickearnshaw (PR #21) for the `cleanupPeriodDays` docs.

### Dev
- `launch.json` `preLaunchTask` fixed so F5 works in a single-root
  checkout (PR #22, @nickearnshaw).

---

## [2.0.0] — 2026-05-26

### Added

#### Pricing accuracy
- **Opus 4.6 / 4.7 / Sonnet 4.5 / Sonnet 4.6 / Haiku 4.5** added to the pricing
  table (verified against the official Anthropic pricing page).
- Reference pricing for common non-Anthropic models that may appear in proxied
  Claude Code setups: **OpenAI** (GPT-5.x, 4.1.x, 4o, o3, o4-mini), **Google
  Gemini** (2.5 Pro/Flash, 2.0 Flash), **DeepSeek** (chat / reasoner /
  v4-flash), **Moonshot Kimi** (K2.5 / K2.6), **Zhipu GLM** (4.5 / 4.6) and
  **Alibaba Qwen** (Max / Plus / Turbo / Long).
- **Family-aware pricing fallback**: unknown model snapshots are now priced
  against the current tier of their detected family (Opus / Sonnet / Haiku /
  GPT / Gemini / DeepSeek / Kimi / GLM / Qwen) instead of always falling back
  to Sonnet 4.
- **Per-model rates** displayed inline in the model breakdown section.
- **`Refresh Model Pricing`** command + button pulls live prices from
  LiteLLM's public dataset as runtime overrides.

#### Quota tracking (real `/usage` data)
- **5-hour and weekly limit utilisation** + reset times fetched via Claude
  Code's own OAuth session at `~/.claude/.credentials.json` →
  `api.anthropic.com/api/oauth/usage`. Zero configuration. _Approach adapted
  from upstream [PR #9](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/9) by
  [@Dobidop](https://github.com/Dobidop)._
- Dedicated, quieter status-bar item shows `5h:N% wk:N%`; warns yellow at
  ≥80%, red at ≥95%.
- Tooltip is a Markdown table with utilisation, reset countdown and weekly
  reset weekday/time.

#### Usage insights
- **Sessions tab** — usage per conversation (one row per `.jsonl` file), with
  project, peak context window, duration and a session-id tooltip. Sortable.
- **Projects tab** — usage aggregated per working directory. Paths that differ
  only in case are merged. Projects are grouped (configurably) by their
  enclosing git repository with sub-folder drill-down. Sortable.
- **Content tab** — estimated breakdown of which conversation content consumes
  tokens (your prompts vs. tool results by tool vs. assistant output /
  thinking), scoped to the last 30 days.
- **Branches tab** — usage aggregated per git branch.
- **Stacked token-composition chart** on the daily / monthly / hourly views,
  with Y-axis and reference lines.
- **Today's hourly chart** now has a Y-axis, two dashed reference lines and a
  value label on every bar; tooltip no longer repeats the hour.
- **Cost composition** in the usage summary: how much of the cost comes from
  input / output / cache-write / cache-read tokens.
- **Cache hit rate** metric in the usage summary.
- **Peak context** column on the Sessions tab, mirroring what `/context`
  reports for a single request.

#### AI advice (opt-in)
- **`Get AI Usage Advice`** command + button. Sends an aggregate summary
  plus a sample of your recent user prompts (or just the aggregates if
  prompts are unavailable) to an OpenAI-compatible chat endpoint
  (DeepSeek V4 Pro by default, `reasoning_effort=max`) and opens the
  optimisation advice as a Markdown document.
- **Scope picker**: overall, or one specific project.
- Output filename is `claude-advice-<scope>-YYYY-MM-DD_HHmm.md`.
- Advice model is instructed to reply in the user's UI language.
- **Demo-mode fallback**: if no API key is configured, the command offers
  a `Preview demo` option that opens a static example of what real advice
  looks like — so users can decide whether to set up a key before
  configuring one. The demo file is filename-marked `…-DEMO-…`, opens
  with a prominent banner ("This file is a static demo, not real advice"
  + 4 enable steps), and the body is **localised per UI language**
  (en / zh-CN / zh-TW / ja / ko / de-DE) so users can judge the feature
  in their own language.

#### Quality-of-life
- **Status-bar tooltip** is now an aligned Markdown table.
- Status bar also shows the **current-session cost** next to today's cost.
- **Compact number format** option (`1.2M` / `345K`).
- **Reading-friendly timestamps** ("Today HH:MM", "Yesterday HH:MM",
  "MM-DD HH:MM", "YYYY-MM-DD").
- **Sortable columns** on Sessions / Projects / Branches tabs.
- **`Refresh Model Pricing`** + `Get AI Usage Advice` commands in the
  Command Palette.

#### Settings (all opt-in)
- `enableContentAnalysis` — toggle the Content tab + analysis pipeline.
- `projectGroupingMode` — `git` (default), `folder` (no fs walk) or `flat`.
- `compactNumbers` — toggle `1.2M`/`345K` formatting.
- `usageLimitTracking` — enable/disable the OAuth quota indicator.
- `adviceApiKey` / `adviceApiUrl` / `adviceModel` / `adviceReasoningEffort` —
  AI advice configuration.

### Changed

- **`advice.apiKey` is no longer back-compat read from the pre-2.0
  `adviceApiKey` flat key.** Other `advice.*` config still falls back so
  URL / model / effort survive the rename. Reason: with the apiKey
  fallback, clearing the *new* key in Settings did not actually disable
  the feature (the old key kept it alive silently and the demo-mode
  fallback never triggered). Migration: if you set `adviceApiKey`
  before 2.0, re-paste it under **`claudeCodeUsage.advice.apiKey`**.
- **OAuth usage API calls now go through the system `curl` binary** instead
  of Node's `fetch` / `https`. Reason: Anthropic's edge now rejects
  requests whose TLS ClientHello (JA3/JA4) does not match a real CLI
  client — Node's openssl handshake gets `403 "Request not allowed"` from
  both the usage and token-refresh endpoints, while the same bearer token
  works fine through `curl`. `curl.exe` ships with Windows 10+ (2018) and
  is universally available on macOS / Linux, so this is portable. If
  `curl` is missing the quota indicator just stays hidden, like before.

### Fixed

- **Opus 4.5** 5-minute cache-write rate: was `$6.00 / MTok`, corrected to
  `$6.25 / MTok` (= 1.25× the input rate).
- **Haiku 3.5** 5-minute cache-write rate: was `$1.60 / MTok` (that's the
  1-hour rate), corrected to `$1.00 / MTok`.
- `claudeCodeUsage.decimalPlaces` setting was ignored by `formatCurrency` —
  now respected throughout the UI.
- Cache metrics renamed to **"Input Cache (Miss/Hit)"** for clarity.
- **Hard-coded Traditional Chinese strings** in the drill-down views
  (`renderHourlyData`, `renderDailyData`, `renderDailyChart`) replaced with
  proper i18n — non-zh-TW users no longer see Chinese in the daily/hourly
  detail panels. Affected closing upstream **PR #8** in spirit.
- **Light theme tab visibility**: tab labels inherited a white foreground
  on light themes and became unreadable. Fixed by setting an explicit
  `color: var(--vscode-foreground)` on `.tab`. **Closes upstream #11.**
- All `toLocaleString` / `toLocaleDateString` calls now pass the user's
  selected locale explicitly, so thousands-separators and date order match
  the UI language (German `.`, English `,`, etc.). Aligned with upstream
  **PR #8**'s locale-aware approach.

### Personalisation

- `enableContentAnalysis` (default true) — toggle the Content tab + analysis pipeline.
- `projectGroupingMode` — `git` (default), `folder` (no fs walk) or `flat`.
- `timezone` — IANA timezone name for date display (e.g. `Asia/Hong_Kong`,
  `UTC`). Useful inside sandboxes / devcontainers whose system timezone
  doesn't match the user's actual zone. **Closes upstream #10.**
- `compactNumbers` — toggle `1.2M`/`345K` formatting.
- `usageLimitTracking` — enable/disable the OAuth quota indicator.
- `adviceApiKey` / `adviceApiUrl` / `adviceModel` / `adviceReasoningEffort` —
  AI advice configuration.

### Issues closed by this release

- **#7** Phantom `ccusageIntegration.js` in published `.vsix` — this release
  is built from clean source; the file does not exist. `.claude/**` and
  `.github/**` added to `.vscodeignore` as a belt-and-braces measure.
- **#10** Preferred timezone configuration — see `timezone` setting above.
- **#11** Display anomaly under light theme — fixed.
- **#13** "Feature request: % used" — fulfilled by the real OAuth quota
  indicator described above.

### Performance & stability

- **Idle-aware refresh**: when no log file has changed since the last load,
  the refresh skips the recompute and only updates the (independent) quota
  indicator. Idle ticks now do near-zero work.
- **Non-blocking refresh**: the loader yields to the event loop every 25
  files so a large history no longer freezes the extension host (and the
  Claude Code extension that shares it).
- Refresh uses an `mtime`-based check instead of a fixed 1-minute cache age.

### Acknowledgements

Based on [`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage)
MIT-licensed. Significant inspiration / patches from upstream
PRs:

- [#9](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/pull/9) — Real 5-hour and
  weekly usage limit tracking via the Anthropic OAuth API, by
  [@Dobidop](https://github.com/Dobidop). The OAuth approach in this fork is
  adapted from that PR.

Many code changes in this fork were drafted with assistance from
[Claude Code](https://claude.com/claude-code) (commits credit
`Co-Authored-By: Claude <noreply@anthropic.com>`).

---

## Pre-2.0 history (upstream 1.0.x)

Released under [`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage)
before the 2.0 fork.

## [1.0.8] — 2025-11-28

- Converted all code comments from Traditional Chinese to English.
- Improved code internationalisation standards.
- Pricing: added Opus 4.5 / Haiku 4.5 rates (thanks to
  [@mxzinke](https://github.com/mxzinke)).
- Added German (de-DE) translation support (thanks to
  [@mxzinke](https://github.com/mxzinke)).

## [1.0.7] — 2025-11-28

- Multilingual translation support for hourly usage labels.
- Removed hardcoded Chinese text from code; replaced with i18n
  translation system.

## [1.0.6] — 2025-08-10

- Added support for Claude Opus 4.1 model pricing
  (`claude-opus-4-1-20250805` / `claude-opus-4-1`).
- Pricing matches Opus 4 ($15 / $75 per MTok).

## [1.0.5] — 2025-01

- Hourly usage statistics and visualisation.
- Dashboard hourly breakdown.

## [1.0.4] — 2025-01

- All-time data calculation.
- "All Time" translations across supported languages.

## [1.0.3] — 2025-01

- GitHub repository URL migration.
- README image-link fixes.

## [1.0.0] — 2025-01

- Initial complete release.
- Status-bar usage monitoring.
- Multi-language support (en / zh-TW / zh-CN / ja / ko).
- Analytics dashboard with charts and tables.
- Theme integration and responsive design.
