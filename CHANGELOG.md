# Changelog

All notable changes to this fork compared to upstream
[`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage) (last
upstream release: 1.0.8). Format follows [Keep a Changelog](https://keepachangelog.com).

## [2.3.3] — Unreleased

### Fixed
- **Resilient release delivery** — the verified VSIX is attached to the GitHub
  Release before either registry publish begins, and VS Code Marketplace and
  Open VSX are attempted independently. Both registry uploads use pinned,
  Node-engine-compatible CLIs, bounded retries, and duplicate-safe publishing,
  so a transient timeout cannot silently block the other registry or leave the
  release without its downloadable package. Targeted retries reuse that exact
  attached VSIX; a missing legacy asset is rebuilt once from its release tag.
  A failed asset download is never mistaken for a missing asset or silently
  replaced by a rebuild.
  Release Drafter also performs a merge-complete reconciliation pass so the PR
  that triggered the main-branch push cannot be omitted by event-ordering races.

## [2.3.2] — 2026-09-12

### Added
- **Project activity matrix (brought forward from the planned v2.3.3)** — the
  existing Projects page now gives Claude and Codex the same Token-only 30/90-day
  project × day heatmap and daily stacked trend. Exact tooltips and explicit
  complete/partial coverage keep the view auditable; bounded project rows,
  matrix cells, and trend series roll the long tail into **Other projects**.
  It reuses provider indexes already built during normal refresh, so opening,
  switching, or expanding the view performs no source-JSONL read and adds no
  watcher, timer, cache, worker, dependency, or network path.
- **Curated display currencies (#91)** — a single compact Settings dropdown now
  selects USD (default) or one of thirteen common display currencies. Conversion
  uses a bundled 2026-09-09 ECB-derived snapshot; rates are deterministic,
  offline, and not user-editable. Stored prices, aggregation, sorting, and
  persistence remain in USD, converted estimates carry an `≈` marker, and
  provider-native usage credits are never converted.
- **Complete chart drill-down paths** — both providers support All time month →
  day and Last 30 days day → hour expansion wherever materialized aggregates
  exist. Mouse, Enter, and Space share the same selection, disclosure, focus,
  nested-collapse, and reload-restoration behavior without reading JSONL on
  click.
- **Provider-qualified chart names** — chart regions and heatmaps expose stable,
  localized provider, scope, chart-type, and selected-metric names. Names update
  with metric switches and remain unique across Compare.

### Changed
- **Project insight schedule** — the formerly planned v2.3.3 project matrix is
  included in this v2.3.2 candidate; the later roadmap now starts after X-06
  instead of carrying a duplicate implementation phase.
- **State-preserving live refresh** — ordinary updates replace only the active
  provider panel and preserve the selected tab, drill-down chain, chart/hour
  selection, temporary Optimizer input, keyboard focus, and nearest scroll
  anchor. Structural changes and failed delivery still fall back safely to a
  complete Webview document.
- **Exact dashboard ranges** — Today remains 24 configured-zone hours and Last
  30 days remains today plus the preceding 29 calendar dates. Missing buckets
  are represented as zero without extending source aggregates.
- **Quieter hourly charts** — zero-usage hours retain their axis positions,
  table rows, click details, tooltips, and accessible values, but no longer
  repeat `0` above every empty bar. Real activity with unavailable pricing still
  displays `—`.

### Fixed
- **Resilient provider watchers** — failed Claude or Codex watchers re-arm with
  bounded exponential backoff while polling remains available; recovery and
  disposal cannot create a retry hot loop.
- **Efficient Codex title lookup** — validated file identity and stat metadata
  avoid repeatedly streaming an unchanged `session_index.jsonl`; titles remain
  memory-only and path-redacted.
- **Quota and Webview boundaries** — bounded quota compaction preserves series
  endpoints and reset boundaries, and dynamic sharing failures render as text
  instead of interpreted HTML.

## [2.3.1] — 2026-09-08

### Added
- **GPT-6 Astra and Claude Fable 5.1 pricing** — exact model IDs now use their
  current official Standard API rates and context windows: `gpt-6-astra`
  (1.05M context) and `claude-fable-5-1` / `claude-mythos-5-1` (1M context).
  Fable 5.1's model-specific cache-read rate is `$0.25 / MTok`; historical
  Fable 5 pricing remains unchanged. GPT-6 requests above 272K input receive a
  request-wide surcharge from OpenAI, but local aggregate logs cannot prove
  that per-request boundary, so the API-equivalent estimate deliberately uses
  the standard short-context rate and keeps the existing request-level-pricing
  disclaimer.
- **AWS Bedrock in-region Claude pricing (#95)** — an opt-in Claude pricing
  backend covers Opus 4.5–5, Sonnet 4.5–5, and Haiku 4.5 with separate
  5-minute/1-hour cache-write and cache-read rates. Switching backends
  invalidates cached Claude cost aggregates so unchanged local logs are
  repriced immediately. Sonnet 5 uses the standard in-region rate that applies
  after its launch promotion ended on 2026-08-31. Thanks to
  [@akapti](https://github.com/akapti) for the contribution.
- **Combined activity heatmap and private sharing** — Compare now leads with a
  Claude + Codex calendar heatmap built from the existing provider daily
  aggregates. Its preview-first share studio exports deterministic local SVG, a
  privacy-safe card, and a copyable Markdown snippet with configurable title,
  30/90-day or yearly range, and an explicit privacy preview. The default
  Academic Violet ramp follows the project-profile visual reference, quantile
  bands keep isolated peaks from flattening ordinary days, and the mapping can
  be switched locally between quantile, logarithmic, and linear modes. Four
  curated or one custom accent palette can be selected. Claude-only and
  Codex-only histories remain useful; no second log scan or statistics cache is
  introduced.
- **Durable quota observation history** — versioned, atomically written,
  bounded observations keep provider, machine-local anonymous account epoch,
  observation/reset time, used/remaining fraction, window identity, source,
  confidence, and quality flags. Window-ID changes, reset-time changes, and
  significant usage rollbacks preserve irregular and same-day reset events.
- **Observed weekly allowance estimates** — every valid observation in a
  coherent window contributes `priced used equivalent / used fraction`; robust
  aggregation weights price/log coverage, boundary quality, attribution, and
  recency. Total estimates never fall below confirmed usage, unused estimates
  never go negative, and a coherent current or completed window exposes both as
  a subscription-durability estimate. If later logs overrun a stale observation,
  the full value remains a low-confidence lower bound while unused is withheld
  instead of showing a false zero. Unattributed or approximate windows are
  labelled low confidence. Even when local Codex quota series overlap, the
  current period uses the latest real observation for a clearly labelled
  low-confidence blended total/unused estimate; ambiguous completed periods
  stay used-only.
- **Evidence-backed advice loop** — the default-off feature keeps local
  observations, evidence, recommendations, actions, local helpful/not-helpful/
  applied feedback, and guarded comparable-task results in one surface. When
  reliable comparable work is unavailable, it says that the evidence is
  insufficient instead of manufacturing an improvement claim.
- **Exact BYOK preview and explicit send** — aggregate-only is the default.
  Prompt personalization has separate consent. The complete Anthropic or
  OpenAI-compatible request body is prepared once, previewed with its byte count
  and SHA-256, and only the same canonical bytes can be sent after a second user
  click. Claude Code OAuth credentials are never used for generative requests.
- **Versioned local comparison evidence** — sanitized task pairs and frozen
  comparison-result envelopes retain only coarse provider, cohort, metric,
  quality, coverage, and version fields. Prompt text, response text, paths,
  session identifiers, and task bodies have no persistence field.
- **Bounded local advice snooze** — each recommendation can be paused for seven
  days (up to thirty days), moved out of the default summary, and shown again
  on demand or after expiry; ratings and applied feedback remain independent.
- **Thirty-day Codex hourly drill-down** — every populated date in the rolling
  30-day view can expand from the already-indexed sparse date/hour sidecar.
  Clicking a date reads zero JSONL bodies; the 31st day is evicted, and Claude
  and Codex use the configured timezone and shared `HH:00` labels.

### Changed
- **Refreshed release documentation** — all seven README editions now show the
  current Claude Today, Codex overview, collapsed weekly details, and vertical
  sharing studio. Captures use the production renderer with disclosed synthetic
  fixtures; a repeatable capture script keeps screenshot provenance explicit.
- **Shared dashboard system** — Claude and Codex now reuse the same density,
  headings, disclosure controls, chart/table framing, empty states, focus
  treatment, responsive navigation, and light/dark design tokens while keeping
  provider-specific metric labels and meanings. Dashboard figures use the VS
  Code UI font again; monospace remains limited to code and copyable snippets.
- **Preview-first sharing layout** — the combined heatmap now occupies the full
  reading width and Card settings sit directly below it. Weekly period tables
  are collapsed by default so the trend chart remains primary. The sharing
  workspace is enabled by default and one Settings toggle hides all sharing UI.
- **Concise plugin settings** — the verbose local-data inventory and destructive
  privacy-control panel no longer renders inside the dashboard. The authoritative
  inventory, retention boundaries, and clear paths remain in the repository's
  `LOCAL-DATA.md` files.
- **Aligned Codex status bar** — the main Codex item now uses configured-zone
  Today instead of Recent task. Its compact quota percentage means remaining
  allowance; the tooltip and warning colour continue to use observed utilisation
  with Claude's progress bars, thresholds, reset columns, and line wrapping.
- **Chronological month views** — Codex monthly charts and tables render
  oldest-first in every range.
- **Explicit Codex uncached composition** — the Token composition summary now
  surfaces uncached usage (uncached input + output) while retaining the
  non-overlapping uncached-input / cached-input / output stack; reasoning stays
  a disclosed subset of output.
- **System-reminder prompt filtering remains intentional** — framework reminder
  messages are excluded from user-input counts; token and cost totals are unchanged.
- **One AI request boundary** — the former Get AI Advice command and Usage
  Optimizer now enter the same preview, explicit-send, cancellation, strict
  response parsing, and local-state boundary. The optimizer still sends only
  the draft pasted by the user and keeps its copyable result format.
- **Resumable Codex historical work** — first-use and migration work records its
  progress, failure streak, next eligible time, and pause reason. Successful
  work continues without an artificial delay; failure or no progress cannot be
  hot-looped by ordinary refreshes, and restart resumes from a safe checkpoint.
- **Unified resource ownership** — timers, watchers, workers, network requests,
  and backfills expose their creator, stop conditions, and actual disposal to
  lifecycle tests. A bounded first-index exception may finish after focus loss,
  but disable, explicit cancellation, and extension disposal still stop it.
- **Safer Codex rolling totals and reset history** — recent 7/30-day views no
  longer trust an inflated or still-rebuilding period sidecar; they use the
  verified daily aggregate until the configured-zone projection catches up.
  The existing index pass also captures compact quota observations without
  polling, credentials, or a second scanner.

### Fixed
- **One-time v2.3.0 Codex token-semantics migration** — the per-file parser
  state now carries a new semantics version. Existing schema-3 indexes request
  one bounded, resumable rebuild instead of retaining pre-fix request
  attribution indefinitely; completed files survive partial checkpoints.
- **Account-aware quota confidence** — a reset boundary may remain useful for
  deterministic weekly alignment across anonymous Codex epochs, but crossing
  an account/profile fingerprint can no longer erase `account-ambiguous`.
  Current-window total and unused estimates remain available at low confidence.
- **Deterministic scroll debounce test** — continuous-scroll coverage now emits
  one synchronous gesture and advances only the fake clock, removing a race
  between animation frames and the 180 ms persistence timer.
- **Immediate advice-consent revocation** — withdrawing aggregate or prompt
  consent immediately invalidates prepared previews and cancels active advice
  requests, without waiting for local storage. New previews/sends stay blocked
  until all consent writes settle; persistence failures stay closed. Unrelated
  user-draft Optimizer requests are not cancelled. Already transmitted bytes
  cannot be recalled.
- **Claude watcher failures fall back safely** — asynchronous `fs.watch`
  errors (for example, an exhausted watch-handle limit) are now handled after
  registration, close the owned watcher cleanly, and leave normal polling
  active instead of escaping through the Extension Host.
- **Timezone-stable chart date labels** — daily and monthly usage keys no
  longer roll back a day or month when a chart metric changes or a drill-down
  renders in a Webview host/configured timezone west of UTC. Bare monthly keys
  also render as the intended month instead of `Invalid Date`.
- **Configured-zone advice snooze dates** — Advice and Optimizer now format a
  snooze expiry with the selected UI locale and configured timezone instead of
  whichever timezone happens to host the Extension process.
- **Configured-zone rolling ranges** — the Claude provider heatmap now ends on
  today in the configured timezone. Share Card 7-day, 30-day, and yearly scopes,
  plus Usage tracking and AI-advice 7-day/30-day attribution, use exact
  civil-date windows instead of fixed millisecond cutoffs. Claude and Codex
  session range filters now follow those same Today/7-day/30-day date keys.
  Claude session, project, branch, and workflow timestamps also use the
  configured timezone for their clock and Today/Yesterday/year labels.
  Activity near UTC boundaries is no longer omitted or pulled from an adjacent
  local day.
- **Complete Share studio localization** — the active Compare sharing workspace
  now carries complete German, Japanese, Korean, Brazilian Portuguese, and
  Indonesian copy instead of silently falling back to English. A repository
  coverage guard keeps all eight supported locales aligned when copy fields
  change.
- **Hardened Codex thread-title path redaction** — runtime titles now mask POSIX
  absolute paths even when a path is attached directly to a colon or other
  punctuation (for example, `3:/Users/name`), preventing local usernames and
  filesystem locations from reaching dashboard text or screenshots.
- **Claude chart drill-down reload parity** — expanded day-to-hour and
  month-to-day rows now survive a Webview reload, re-request their lazy detail
  data, and retain selected/ARIA state. Chart controls derive their drill-down
  kind from their own tab instead of whichever tab happened to be active while
  the page initialized; an intentional tab switch still clears expansions.
- **Claude rolling-range regression** — Claude's middle dashboard tab now uses
  Today plus the preceding 29 configured-zone calendar dates instead of the
  current calendar month. The Workflows summary now uses the same rolling range,
  classifies runs by their configured-zone start date, and compares against the
  matching 30-day total. The monthly-cost status-bar option remains a calendar
  month, and an empty Today view identifies the latest recent activity date.
- **Reconciled 30-day Codex statistics** — “Last 30 days” is the configured
  timezone's current calendar date plus the preceding 29 dates. The view is
  projected from verified daily aggregates, so Today ≤ Last 30 days ≤ All time,
  daily/monthly/model/effort totals reconcile, and repeated refresh/reindex does
  not accumulate duplicate thread or historical-file usage.
- **Reasoning-effort normalization** — current, legacy, nested, missing, and
  invalid structured variants are normalized without guessing from a model
  name. Non-zero unknown usage is visible with an explanation; zero-value
  unknown rows are omitted.
- **Duplicate share rows fail safely** — identical provider/date rows are
  idempotent, conflicting duplicates block export, and absent dates render as
  zero in the selected range.
- **Smooth Codex dashboard scrolling** — scroll position is persisted once
  after a gesture instead of serializing Webview state on every animation
  frame. Live first-index progress now patches its status text in place rather
  than rebuilding the complete dashboard DOM every 250 ms, so active indexing
  no longer interrupts scrolling or disclosure state.
- **Per-model API-equivalent headlines** — Codex model disclosures now follow
  Claude's visual meaning: the green value is an exact-model API-equivalent
  price with pricing-coverage help. Unknown models remain visibly unpriced, and
  effort disclosures keep their uncached-token value in neutral text.
- **OpenAI reasoning-effort requests** — OpenAI-compatible request bodies now
  send `reasoning_effort` without the unsupported top-level `thinking`
  parameter, fixing [#94](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/94).
  Thanks to [@aaroncvan](https://github.com/aaroncvan) for the report and
  [@Alex668866](https://github.com/Alex668866) for the precise diagnosis.

### Privacy and packaging
- Disabled or unconsented advice adds no timer, watcher, worker, network request,
  log scan, or hidden Webview render relative to v2.3.0. There are no default or
  background AI requests.
- Combined exports contain only title, date range, daily aggregate totals,
  provider labels, and caveats—never accounts, fingerprints, projects, threads,
  paths, prompts, or log content. Local SVG/Markdown needs no account permission.
- Direct GitHub publication remains an explicit, exact-destination action. It
  requests only `public_repo`, verifies a public repository and default branch,
  previews create/overwrite, and stores owner/repository/path only after success.
  Release validation uses mocks and performs no real repository write.
- Dormant migration/experiment modules and internal v2.3.1 review documents are
  explicitly excluded from the VSIX. The human-controlled publish workflow
  stamps package metadata from the reviewed `v2.3.1` release tag.

## [2.3.0] — 2026-08-28

### Fixed
- **Codex Today is now the configured calendar day** — the first Codex tab now
  pairs its day total with exact hourly API-equivalent cost and a separate
  token-composition view. Its additive schema-3 current-day sidecar scans only
  canonical files already known to contain that day, checkpoints and resumes,
  and does not trigger a full-history reindex. Daily and monthly primary trends
  now default to API-equivalent cost while token composition remains separate;
  unknown models stay unpriced and pricing coverage remains visible. Claude and
  Codex time-series charts keep aligned responsive widths, with dense content
  scrolling inside its own keyboard-focusable region.
- **Weekly API-equivalent periods no longer overlap or double-count usage** —
  the newest valid official reset observation anchors one sequence of unique
  `[start, reset)` weekly buckets, so each local usage event contributes to
  exactly one period. A genuinely different quota series with an overlapping,
  non-aligned future reset is treated as a conflict; same-series observations
  remain one low-confidence series rather than creating an additional
  "current" row. Codex usage is persisted in daily slices, so a slice that
  crosses an official intraday reset remains counted once but marks the affected
  period as a boundary approximation and lowers confidence on any full
  allowance estimate. Drifted reset observations are mapped by observation time
  to the corresponding display bucket. This display-only correction does not
  change the index schema or trigger a rebuild. Same-series Codex observations
  can estimate historical as well as current full values from all eligible local
  files; current unused value remains withheld, historical unused value requires
  a full estimate, and genuinely different quota series or missing evidence stays
  used-only.
- **Claude changed-file refreshes no longer reread the full corpus (#87)** —
  the production refresh path now keeps an exact in-memory per-file index,
  reads only a verified append tail, and rebuilds only affected files for
  truncate, replacement, move, and delete events. Cross-file response identity,
  request-ID degradation, content UUID ownership, titles, context, sessions,
  projects, branches, workflows, costliest messages, and all time buckets retain
  the established full-loader results. Dashboard aggregates are materialized
  incrementally, so an unchanged watcher refresh reads zero JSONL bodies and
  performs zero aggregate mutations. A new Extension Host still performs one
  cold in-memory build; normal runtime changes no longer repeat that work.
- **Codex one-time backfills now use high-end hardware** — incomplete indexes
  use an adaptive local pool of up to half the logical CPUs, capped at six
  workers, for independent file passes. One-MiB stream chunks, stage-aware
  lineage reconciliation, one durable write for a small warm append, and
  coarser resumable checkpoints prevent repeated tens-of-megabytes index writes
  from dominating the scan. Once complete, refresh returns to the bounded
  low-power incremental path. Stable duplicate-session ambiguity is now shown
  as an explicit data-quality warning and no longer leaves the page falsely
  labelled as still indexing forever.
- **Codex request-level token attribution** — valid `last_token_usage` snapshots
  now provide the exact input, cached-input, output, and reasoning components;
  their `total_tokens` value remains an active-context measurement rather than
  request usage. A full numeric total-plus-last signature suppresses only a
  replay from the same pseudonymous rate-limit source or an immediately adjacent
  duplicate. Missing last snapshots retain the cumulative lineage high-water
  fallback. Existing schema-3 indexes rebuild once, keep showing indexed
  subtotals during that pass, and never mix the two attribution semantics.
- **Conservative Codex rebuild totals** — schema and lineage migrations no
  longer expose retained legacy aggregates as current usage. Cards, tables,
  projects, sessions, recommendations, and the status bar now use only freshly
  indexed contributions and show an indexed-subtotal notice until coverage
  converges. Stale files remain visible in data-quality reporting. Account
  limits remain last-observed snapshots and are never summed.
- **Profile-scoped Claude quota credentials (#89)** — quota reads and token
  refresh writes now follow explicit `dataDirectory`, then the first valid
  `CLAUDE_CONFIG_DIR`, then `~/.claude`. A selected custom profile without a
  credentials file shows quota as unavailable instead of silently using the
  single global macOS Keychain account, and persisted quota snapshots are
  isolated by profile. Thanks to [@HoangJN](https://github.com/HoangJN) for the
  precise report.
- **Per-model weekly limits are read again** — Anthropic's usage API stopped
  filling in its per-model quota fields, so the weekly Opus figure had silently
  gone blank. The extension now reads whichever per-model weekly cap your plan
  meters and labels it the way Anthropic does, for example "Fable".
- **The quota tooltip follows the reset countdown format** — it always used
  whole units, so on the default decimal setting the same window read "4.5h" in
  the status bar but "4h 29m" in the tooltip. Every row now reads "time left
  (wall clock)" on one line, the 5-hour window included, which previously showed
  no reset time at all.
- **Missing settings translations** — four Brazilian Portuguese entries and one
  Indonesian entry showed English text in the settings panel.

### Added
- **Codex API-equivalent cost summary** — every Codex usage scope now begins
  with a clearly labelled approximate dollar value calculated from currently
  indexed tokens and exact known-model API prices. Unknown models stay unpriced,
  the hover text reports priced-model coverage, and the value is explicitly not
  presented as a bill or subscription charge.
- **Historical weekly allowance value** — Claude and Codex All-time and Compare
  views now calculate historical used API-equivalent value directly from local
  token logs. One valid observed reset anchors unique, non-overlapping weekly
  buckets; without one, usage-only rows use Monday-to-Monday UTC calendar weeks.
  Codex account-wide observations can decorate historical and current buckets;
  reset drift is mapped by observation time, while source ambiguity and boundary
  slices lower confidence. Genuinely conflicting quota series and periods with
  no usable observation remain used-value-only. Current unused value is still
  withheld, while historical unused value is shown only when a full estimate is
  available.
  Current official API prices are applied consistently and each period includes
  model-price coverage. This remains an estimate, not a bill or an official
  subscription price. The panel is enabled by default and can be hidden with
  `showWeeklyEquivalentValue`.
- **Complete Claude quota details** — the tooltip now shows every active
  all-model and model-scoped weekly cap reported by Anthropic, plus used monthly
  credits when available. Model-scoped status-bar display remains opt-in and is
  named dynamically instead of assuming Opus.
- **Codex Beta** — local-only Codex usage views for processed, uncached input +
  output, cached input, input cache-hit rate, output, reasoning, model, effort,
  thread structure, index coverage, quality flags, and last-observed limit
  snapshots.
- **Provider-aware dashboard** — Claude, Codex Beta, and side-by-side Compare
  modes preserve provider-specific semantics; Compare does not sum cost or quota.
- **Immediate Codex entry during backfill** — once an allowed Codex home is
  detected, its provider tab appears before the first index finishes and shows
  exact indexed-file, percentage, and byte progress inside the page. The last
  atomic checkpoint is hydrated before the worker starts, so its full indexed-
  subtotal dashboard remains usable while reconciliation continues; a brand-new
  index adopts its first checkpoint without waiting for the whole pass. Progress
  renders are coalesced so the indicator does not turn backfill into a Webview
  redraw loop. Compare still waits until both providers have real data.
- **Provider-aware Codex dashboard** — the existing Today / Month / All time /
  Sessions / Projects / Content / Settings render functions now accept a
  provider and present the corresponding Codex calendar Today with hourly detail /
  Last 30 days / All time / Sessions / Projects / Recommendations / Settings data.
- **Truthful Codex identities** — root tasks use the latest path-redacted local
  thread title; child rows prefer their own real thread title, then fall back to
  their reported nickname while displaying the parent/root title. If those are
  also missing, localized neutral fallbacks are used. Projects use the Git
  repository name (or a non-Git folder basename). Raw session IDs, repository
  URLs, and full paths remain excluded.
- **Codex detail tables and limits** — source-derived task/project names,
  provider-native token columns, model/range filtering, sortable session and
  project tables, and unexpired named limit windows make high usage traceable
  without inventing Branches, Workflows, cost, or real-time subscription state.
- **Local Codex optimization guidance** — structural signals explain unusually
  high subagent, effort, approval-reviewer, tool-call, and cache overhead without
  inspecting or retaining prompt, response, command, or tool-argument content.
- **Scalable Codex indexing** — a cancellable background worker and persistent
  per-file aggregate index support incremental progress, tail-only append reads,
  resume, and zero unchanged usage-record/rollout JSONL body rereads on warm
  refreshes. Incomplete one-time backfills may use the bounded adaptive local
  file-pass pool; completed indexes do not retain those extra workers. This does
  not include the exact `$CODEX_HOME/session_index.jsonl` title stream performed
  on every refresh.
- **One-pass initial Codex backfill** — the first non-empty index or an
  incomplete legacy migration receives a bounded 64 GiB / 16,384-file-pass
  streaming ceiling, with cancellation and atomic resume checkpoints. The
  ceiling is not an up-front memory allocation. After convergence, automatic
  work returns to 128 MiB / 64 file passes and the always-visible Refresh action
  uses 2 GiB / 512 file passes. Unchanged warm refreshes still read zero
  usage-record JSONL bodies.
- **Codex UI release gate** — production-rendered coverage checks shared-tab
  navigation, settings, charts, sorting, accessibility, responsive overflow,
  stylesheet identity, and the invariant that Codex-rendered classes are a
  subset of classes already emitted by the Claude dashboard.

### Changed
- **`showOpusWeekly` is now `showScopedWeekly`** — the setting no longer names a
  single model, because the API says which model is capped. Your existing choice
  carries over, and it stays opt-in and off by default.
- **The quota tooltip lists every weekly cap** the API reports, each on its own
  row with its own bar, whether or not the status bar is showing it. A per-model
  cap can be the binding one, so it is always one hover away.
- **The status bar nests a per-model cap in the weekly figure** — "wk 9%
  (fable 17%)" with one countdown, rather than repeating the identical reset for
  each cap. A cap that reset on its own schedule would still get its own segment.
- **Caps with nothing to report stay hidden** — a per-model weekly cap appears
  once it has usage against it, so it is absent at the start of a week rather
  than sitting at 0%. The 5-hour and all-models figures always show.
- **Reset times read to the minute** — they were shown truncated to the second,
  so a cap resetting at 16:59:59 displayed as "16:59" while the cap it resets
  alongside displayed "17:00".
- **Quota warns at the same points as the official Claude app.**
  The quota indicator and every bar in its tooltip now turn amber at 75% and red at 90%, instead of 80% and 95%.
  The context-window indicator keeps the earlier 80% and 95% steps.
- **Unified Claude/Codex dashboard shell** — Codex Beta now uses the same
  header/action order, navigation rhythm, summary cards, detail rows, token
  composition, tables, spacing, and responsive behavior as the existing Claude
  dashboard. Usage limits are compact summary cards, recent-task identity is no
  longer followed by a duplicate statistics block, and recommendation
  composition uses the established model-detail layout.
- **Consistent Codex terminology** — user-facing metrics now use Processed,
  Input, Uncached input, Cached input, Output, Reasoning, and Uncached usage
  consistently across all eight supported locales; internal field names and
  persisted setting values remain compatible.
- **Readable Codex Sessions table** — the collapsed view keeps eight useful
  columns at 1280 px, prioritizes Thread and Project, and moves secondary token
  details into an expandable row without duplicating Role.
- **Stable dashboard UI state** — the selected provider, active tab, chart
  metric, table sort, expanded rows, recommendation filters, and page scroll
  position survive a webview reload when still applicable.
- **Generic model-scoped weekly setting** — the earlier `showOpusWeekly` choice
  migrates to `showScopedWeekly`, follows the model name supplied by Anthropic,
  and nests a shared-reset cap into the weekly status-bar segment.
- **One Claude/Codex dashboard render stack** — Codex Beta is now a provider
  switch inside `webview.ts`. It uses the same render functions, HTML shell,
  class names, stylesheet, header/action order, tabs, summary cards, detail
  rows, charts, tables, spacing, and responsive behavior as Claude.
- **Exact-version release announcements** — the default-on notification can be
  disabled, stays quiet on a fresh install, and shows only the content for the
  complete installed version instead of falling back to stale v2.2 notes.
- Repository policy and architecture now define provider-neutral contracts,
  Codex privacy boundaries, eight-locale/seven-README parity, and the real
  OpenAI Codex co-author trailer for Codex-led commits.
- Codex indexing follows observed rollout semantics: child counters start from
  their own zero, repeated metadata preserves lineage, `guardian` sessions are
  approval reviewers, and known non-usage envelopes are not quality failures.
- The shared Settings renderer shows only shared and Codex-effective controls
  when Codex is selected. Codex and its local optimization signals can be
  disabled independently; recommendations remain grounded in the indexed
  30-day structural aggregates and disclose partial coverage.
- Codex period charts now reuse the existing dashboard's Y axis, grid, theme
  colors, horizontal scrolling, and metric-switching behavior.
- **Persistent period indexing** — the compatible `codex-index-v1.json` path now
  persists only sanitized aggregates, promotes exact local day slices in bounded
  resumable batches, and exposes independent 7-day, 30-day, and all-time
  coverage. All-time aggregates remain verified independently of partial period
  slices; exact active/archive copies are deduplicated while ambiguous identities
  remain visible as incomplete coverage.
- Rolling 7-day and 30-day views now use exact event-day slices in the configured
  timezone. Period migration and coverage gaps stay visibly partial instead of
  being presented as complete data.
- **Schema-3 lineage reconciliation** — ordered fingerprints of numeric token
  counters remove only copied parent prefixes across direct, nested, and
  multi-epoch forks and verified active/archive overlaps while preserving
  independent sibling work. Missing parents remain conservatively counted and
  surface a visible quality warning. Legacy indexes rebuild in bounded passes
  instead of retaining inflated totals.

### Fixed
- **Claude response-level token counting** — regression fixtures now lock the
  observed transcript behavior: one response may emit separate `thinking` and
  `text` rows with the same `messageId`, `requestId`, and complete `usage`
  vector, so the extension counts that response once and keeps its largest
  vector rather than summing rows like Claude Code's `stats-cache`. Identity
  degradation is also covered: a matching row that omits `requestId` still
  joins the sole known request, while distinct request IDs stay separate.
- **Shared-dashboard readability** — active tabs remain distinguishable in
  Light+ and Dark+, sortable headers expose their interaction without changing
  the established alignment, and the output segment in composition charts uses
  a fully opaque registered VS Code theme color.
- **Responsive first-pass automation** — when both configured model tiers fail
  or return no usable text, the Issue/PR workflow posts a deterministic,
  provider-neutral fallback instead of exiting without a comment; reruns avoid
  duplicate first-pass replies.
- **Consistent Claude quota reset detail** — tooltip countdowns follow the
  selected format and pair it with the wall-clock reset, while zero-use scoped
  caps stay out of the compact status bar.
- **Codex idle energy and multi-window contention** — Unfocused VS Code windows
  suspend Claude and Codex polling/watchers until focus returns. Complete,
  unchanged Codex indexes now skip aggregate recomputation and disk writes;
  cross-window refreshes share a single index lease, and atomic saves use unique
  temporary files instead of competing for one `.tmp`.
- **Stable rolling-period tests** — Codex index refreshes use an injectable clock
  internally so recent-period coverage remains deterministic without changing
  runtime date or timezone semantics.
- **Codex index self-recovery** — malformed JSON and unsupported persisted index
  schemas are atomically preserved as timestamped `.corrupt-*.json` backups,
  then rebuilt from local usage records instead of leaving Codex Beta stuck in
  an error state. Diagnostics expose only a safe recovery reason, never the
  index path or contents; unrelated filesystem errors still fail closed.
- **Codex fork overcounting** — copied token histories replayed into child
  rollouts no longer inflate provider totals. Counter regressions use
  exact last-request components with partial confidence; only the missing-last
  cumulative fallback uses component-wise high-water containment rather than
  adding reset gaps again.
- **Visible Codex backfill state** — while bounded indexing is still converging,
  Coverage · Quality now warns that current totals are incomplete, shows the
  real indexed-files/total-files progress, and clears the warning automatically
  once base and period coverage are complete.

### Removed
- **Weekly Opus naming retired** — the fixed Opus-specific surface is replaced
  by the generic, API-named `showScopedWeekly` setting. PR #38 and
  [@wheelbarrel00](https://github.com/wheelbarrel00) remain credited for the
  original contribution.

### Privacy
- Codex usage-record discovery is restricted to `sessions/**/*.jsonl` and
  `archived_sessions/**/*.jsonl`. Separately, the extension streams exactly
  `$CODEX_HOME/session_index.jsonl` to map `id` to `thread_name` for truthful
  thread titles; credentials, SQLite databases, browser/keychain state, and
  unknown files remain excluded.
- Absolute filesystem paths embedded in a Codex thread title are replaced with
  `[path]`, and the sanitized title remains memory-only. Usage-record JSONL lines
  are streamed and temporarily parsed only for allowlisted metadata; prompt,
  response, command, and tool-argument fields are not inspected or used for
  analysis and are never retained.
- The persistent index contains machine-salted pseudonymous keys, numeric and
  structural aggregates, and sanitized project, directory, agent, model,
  effort, role, time, and quality metadata. It never persists raw IDs, full
  paths or repository URLs, thread titles, or conversation bodies.

## [2.2.2] — Unreleased

### Fixed
- **Lower multi-window energy use** — Suspend polling and file watchers in
  unfocused VS Code windows, then refresh immediately when the window regains
  focus. This avoids repeating the same local scan in every Extension Host.
- **Quota failure throttling** — Back off repeated quota authentication failures
  for up to one hour, while retrying immediately after Claude credentials
  change.
- **Usage dashboard recovery (#79, fixes #82)** — one oversized non-transcript
  `.jsonl` can no longer abort the earliest-timestamp probe and blank the whole
  dashboard. Thanks [@ptweezy](https://github.com/ptweezy).
- **Opus 5 context window (#81, reported in #84)** — recognise the bare
  `claude-opus-5` model id as a 1M-context model and remove its spurious
  unknown-model pricing diagnostic. Thanks [@e7d](https://github.com/e7d).
## [2.2.1] — 2026-07-18

### Added
- **Bahasa Indonesia (`id`) (#76)** — the extension's eighth UI language covers
  the dashboard, status bar, settings, and AI-advice demo, with a dedicated
  `README-id.md`. Thanks [@projectronic](https://github.com/projectronic).
- **Sessions: all sessions + filters (#73)** — the Sessions tab can show all
  sessions and adds persisted time-range, project, and model filters. Thanks
  [@Carl723000](https://github.com/Carl723000).
- **Reset countdown formats (#75, closes #74)** — quota reset countdowns can use
  decimal, whole-unit, or local clock/date formats. Thanks
  [@projectronic](https://github.com/projectronic).
- **Indonesian timezone presets (#77)** — the timezone picker now includes WIB,
  WITA, and WIT presets. Thanks [@projectronic](https://github.com/projectronic).

### Changed
- **Codex maintenance handoff** — `AGENTS.md` is now the canonical repository
  policy with a Simplified-Chinese review copy. Claude Code and OpenAI Codex
  are credited as development tools, separately from human contributors.

### Fixed
- **High-CPU refresh mitigation (#70)** — polling now always honors the
  configured 30–3600 second `refreshInterval`; file watching is quiet-debounce
  only and adds 60/120/300-second choices. First-timestamp reads stop after the
  first valid timestamp and run with at most eight readers.
- **Date labels (#54, PR #71)** — daily rows on the first of a month remain
  daily labels, while monthly keys no longer shift one month backward in
  negative-UTC zones. Thanks [@YuboZhang](https://github.com/YuboZhang).
- **Automatic first-pass language (#72)** — repository bot replies now default
  to English, using English-first bilingual output only for Chinese authors.
- **Cold-start refresh failures** — an incomplete first scan now clears the
  loading state and shows a localized retry/diagnostic message while preserving
  an existing successful snapshot on later transient failures.

### Diagnostics
- **Anonymous refresh timings** — Show Diagnostic Logs now reports trigger,
  file/change/reuse/removal counts, bytes, parsed lines, watcher/coalescing
  counts, and manifest/read-parse/aggregate-render/total timings. It never logs
  prompts, paths, session IDs, credentials, or raw JSONL lines.

> This is a mitigation pending Linux prerelease validation. Issue #70 remains
> open until the reporter confirms the result; the per-file incremental index
> is tracked separately.

### Security
- Hardened GitHub first-pass automation with truthful per-tier provider attribution,
  one code-owned footer, fail-closed PR diff handling, and bounded base-repository file reads
  with traversal, symlink, hidden-path, and secret-path denial.
- Manual publish retries now require an explicit existing release tag, check out
  and verify its fully qualified `refs/tags/` commit, and can target only the
  registry that needs recovery.

## [2.2.0] — 2026-07-07

### Added
- **`tokenDecimalPlaces`** (default 1, 0–2) — decimals for the *compact* token
  display (`1.2M` / `345.6K`); full integer counts are unaffected.
- **Cache-hit-rate column** in the All-time (monthly) and This-month (daily)
  breakdown tables — and in the expanded per-day / per-hour drill-downs — so the
  cache efficiency is visible per row, not just in the summary card.
- **Token heatmap on the All tab** (opt-in, `showHeatmap`, default off) — a
  GitHub-style yearly token heatmap (Claude orange) at the top of the All tab.
  Inline SVG, so the per-day hover tooltips work in the dashboard. Mainly a
  shareable view of data already shown elsewhere, hence off by default.
- **Export Token Heatmap (GitHub style)** — a command that writes a
  self-contained, GitHub-contribution-style SVG of the trailing year's token
  usage (Claude-orange scale, top-left summary, per-day tooltips, source
  watermark) to a file, with a one-click "copy Markdown embed" — for pasting
  into a GitHub profile README. Pure, unit-tested renderer (`heatmapSvg.ts`).
- **Token-composition drill-down** — clicking a month in the All-time *Token
  composition* chart expands that month's per-day composition (alongside the
  daily chart + table), so you can read the input / output / cache-write /
  cache-read split day by day, not just at the month level.
- **Share-card + heatmap foundations** — tested pure logic (`src/shareCard.ts`,
  `src/heatmap.ts`) for the upcoming Usage Share Card and Monthly token heatmap.

- **Efficiency insights** (opt-in, `showEfficiency`, default off) — starts with a
  **top-10 costliest conversations** panel on the Content tab: expandable rows
  (native disclosure) showing each session's tokens, cache-hit rate, top model
  and project, ranked by cost. (Cost-per-message + realised cache-savings chips
  on Today/projects use the same toggle.)
- **"What's new" prompt after upgrades** — a single, dismissible notification
  the first time you run a new major.minor version, pointing at the dashboard so
  new (including opt-in, default-off) features are discoverable. Shown once per
  version; skipped on a fresh install.
- **Usage Share Card** (opt-in, `enableShareCard`, default off) — a configurable
  one-page SVG you can generate and export/share: pick a range (last 30 days /
  week / month / year / a specific month), a scope (overall / a project / a
  session), which metrics to show, and a **theme** — **Claude Classic** (orange,
  default), **Claude Cream**, **Aurora Dark**, or **Auto**. Self-contained SVG;
  optional GitHub **avatar + name**; deterministic; privacy by construction (no
  prompts/paths/ids). Built on demand; config + preview survive a refresh.
- **Publish Token Heatmap to GitHub** — one-click publish of the heatmap SVG to
  a repo (default: your profile repo) via VS Code's built-in GitHub auth (no
  PAT). Shows a consent modal first.
- **Top-10 costliest *messages*** (opt-in, `showCostliestMessages`, default off,
  Content tab) — ranks single turns by cost; expand for the triggering prompt,
  model, skill, a **cost split** that distinguishes a **cache miss** from a long
  answer, the **cache-hit rate**, and the **time since the last turn** (+ a
  "model switch flushed the cache" / "idle past cache TTL" cause). (Reworked from
  the earlier costliest-*conversations* panel.)
- **Cache warmth estimate** (`showEfficiency`) — infers how long your prompt
  cache stays warm while idle from your own turns (measured **~60 min**, not 5).
- **Efficiency chips** — cost/message, **tokens/message**, realised cache savings
  on Today / month / all-time; a **Cost/msg** column in the projects table.
- **Conversation viewer** (opt-in, `showConversationViewer`, **default on** — it's
  read-only) — a "view" button on the Sessions tab opens a read-only reader for a
  past conversation: your prompts up front, the model's answers rendered from
  Markdown (tables included), with thinking and tool traffic behind toggles. Lets
  you re-read a session to jog your memory *without* loading it back into the
  model's context (unlike resume). Reads local logs only; refreshes each time you
  open it; loads the last 10 rounds.
- **Experimental insights** (opt-in, `showInsights`, default off, Content tab) —
  heuristic estimates from your local logs, labelled as estimates: a **cache-churn
  bill** ($ spent re-writing cache after model switches / idle gaps), **cache
  warmth by model** (how long each model keeps your cache warm), **big one-shot
  turns** (a checkpoint nudge), **your active hours** (a 24-h token sparkline +
  peak window), and **skill ROI** (output tokens returned per $ per skill/plugin).
- **Sessions "Active" column** — estimated hands-on time per session (gaps between
  turns, each idle gap capped at 1.5 h), which is far more meaningful than the raw
  first-to-last span for long-lived sessions. Sortable, with an explanatory tooltip.
- **Live-refresh delay control** (`fileWatchSeconds`: Off / 1 / 2 / 5 / 10 / 20 /
  30 s, default 2 s) replaces the on/off "live file watching" toggle. This only
  re-reads your **local** log files — no API call; the `/usage` quota fetch is
  throttled separately.
- **Chinese share-card units** — the share card uses 万/亿 (萬/億 in zh-TW) and its
  text follows the UI language, so an English card is fully English and a Chinese
  card fully Chinese.

### Changed
- **`enableSessionActions`** (default off) gates the Sessions **resume _and_
  delete** buttons together — both *act* on your Claude Code (reopen / trash a
  log), at odds with the extension being read-only, so they're opt-in as a pair.
  (Replaces the earlier `enableSessionDelete`.)
- **Timezone-aware bucketing** — every Today / day / month / hour total now derives
  its day boundary from the configured IANA zone (empty = system), kept in lockstep
  with the display, so the aggregations agree with each other and with the console;
  an invalid zone falls back to the system zone instead of breaking the dashboard.
- **Cache-write cost by TTL** — when a log carries the cache-creation TTL split, a
  1-hour cache write is priced at 2× base input (vs the 5-minute 1.25×), matching
  Anthropic's billing; logs without the split are unchanged. (PR #62, @zeyutang.)
- **Timezone dropdown = full UTC-offset coverage** — common zones plus every UTC
  offset (grouped Common / UTC offset), each labelled with its current offset;
  IANA identifiers only (no editorialised place names).
- **`dashboardAutoRefresh`** (positive wording, default true) replaces the
  double-negative `pauseDashboardRefresh`; existing values are migrated.
- Repository metadata (`repository` / `bugs` / `homepage`) now points at the
  `ClaudeCodeUsage` organization.

### Fixed
- **Thinking share reads "hidden", not a false 0%,** for models that omit their
  reasoning text (Fable 5 / Opus 4.8 — `"thinking":""` + a signature).
- **Quota reset countdown** in the tooltip now reads `4d 12h` (the compact
  status-bar form keeps `4.5d`); a recently-expired usage-anchored window no
  longer shows a fabricated countdown while idle.
- **Auto-refresh no longer wipes** the generated share card or collapses expanded
  Content rows (reset only on tab switch); the GitHub avatar renders (webview CSP
  now allows `data:` images).
- Message counts exclude api_error retries and the compaction summary line.
- **Timezone is a validated dropdown** — the Timezone setting is now a picker of
  valid IANA zones (`Intl.supportedValuesOf`) instead of free text, so an invalid
  value can't be entered; a guard also rejects any old bad synced value. Fixes a
  crash where a hand-typed zone made `Intl` throw and broke the whole dashboard.
  (#51)
- **German (de-DE) now selectable** — the German translation (contributed by
  @mxzinke) existed in the strings and `SupportedLanguage` but had never been
  added to the `package.json` enum or the settings dropdown, so it couldn't be
  chosen. Exposed it everywhere; verified the translation and fixed two English
  leaks (`error`, popup `currentSession`).
- **pt-BR now selectable** — Brazilian Portuguese (added in 2.1.1) was missing
  from the dashboard's language dropdown (`settings.ts` enum) and the README
  language lists, even though the strings, `package.json` enum and
  `SupportedLanguage` already had it. Wired it through everywhere.
- **Timezone-correct month / day bucketing** — the This-month and All-time
  breakdowns now bucket every record's day *and* month in the configured
  timezone (empty = system). Previously the month boundary was local while the
  day key was UTC, so a record just after local midnight on the 1st showed up
  under the previous month's last day. (`src/dateKeys.ts`, unit-tested.)
- **Breakdown table scroll** — number cells stay on one line, so the compact
  (k/M) view fits the panel with no horizontal scroll while full integer numbers
  overflow and scroll the table only; the chart keeps its own scroll.
- **API-error retries no longer inflate the Messages count** — when a request
  errors, Claude Code retries it and re-logs the same user prompt; an identical
  prompt re-appearing within a short window is now counted once (genuine
  re-sends minutes/hours later still count). (`src/promptDedup.ts`, unit-tested.)
- **Compaction summary no longer counts as a message** — when a session is
  auto-compacted, Claude Code injects the "This session is being continued…"
  summary as a *user* message; it's now excluded from the Messages count (you
  never typed it). Verified on real logs.
- **Cache-write ("input cache miss") bars render again** — in every usage bar
  chart, selecting the cache-write metric showed only the axis and value labels:
  the bar's gradient referenced a `--vscode-charts-pink` colour VS Code doesn't
  define, which made the whole gradient invalid (transparent). Added a fallback.

### Removed
- Dropped the unused `@types/glob` devDependency (clears a vulnerability
  advisory). Thanks @zeyutang (#63).

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
