# Architecture

> A concise map of the extension's provider boundaries, data flow, and usage
> semantics. Update it whenever module ownership or provider behavior changes.
> A faithful Simplified-Chinese companion lives in
> [`ARCHITECTURE-zh-CN.md`](ARCHITECTURE-zh-CN.md).
> The bilingual
> [`v2.3.1 local data contract`](docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.md)
> is the historical field-level baseline. [`LOCAL-DATA.md`](LOCAL-DATA.md) is
> the current 2.5.0 inventory and versioned supplement for later fields,
> retention, migration, clearing and exports. Its explicitly later sections
> supersede only those subjects; unchanged baseline privacy rules still apply.

## Product boundary

**Claude Code Usage** remains local-first, dependency-free, and read-mostly.
v2.3.0 preserves the complete Claude experience and adds Codex Beta as a
provider-specific usage and optimization view.
The v2.3.1 candidate adds a default-off, local-first advice-effectiveness loop,
a single explicit BYOK request boundary, durable historical-work state, a
bounded local history of Codex weekly reset observations, and a rolling 30-day
Codex date/hour projection without changing provider accounting.
v2.4 phase 1 consolidates the existing sharing surfaces into one preview-first
workspace. A presentation selector switches among the combined activity
heatmap, the legacy Claude Share Card, and the Claude-only token heatmap; the
full-width export preview always precedes its controls.
Version 2.5.0 combines Codex compressed-log compatibility
with default-on, local-only tiered achievements
(`enableAchievements`), a once-only upgrade opt-out, and evidence/performance guards.
It also integrates provider/metric heatmap sharing, a six-pin manual showcase and
default-off weekly quota pace.
This document describes implementation contracts,
not a release or acceptance record. Native/F5, installed-package and performance
checks require their own evidence; browser checks do not establish those results.
Source-level guards check source contracts; they do not establish executed UI
transitions, native Webview behavior or installed-package acceptance.
Codex effort statistics and cumulative-only monetary-origin receipts are integrated.
GitHub-linked achievements, personal reviews and visualization redesign are not
part of version 2.5.0.

- Claude: exact local token buckets, model pricing estimates, and Anthropic
  OAuth 5-hour/weekly quota.
- Codex: local processed/fresh/cache/output/reasoning metrics, model and
  effort breakdowns, thread structure, index coverage, quality flags, and
  structural optimization guidance. Known models also receive a clearly
  qualified API-equivalent cost estimate; it is never a bill or subscription
  charge, and unknown models remain unpriced.
- Share & compare (internal provider key `compare`): the navigation/page label for
  sharing and side-by-side compatible metrics. It never sums provider cost,
  quota, or tokens into a misleading combined total.

Full invoice reconciliation, driving either coding agent, background telemetry,
and cross-device aggregate sync are out of scope. Existing Claude heatmap
publication remains an explicit, public-repository-only GitHub action with an
exact-target confirmation. Opening, switching, previewing, and local SVG/
Markdown export are strictly network-free and never request GitHub identity;
only the separate publish action can perform that network operation.

## Module map (`src/`)

| Module | Role |
|---|---|
| `extension.ts` | Activation, commands, settings, provider lifecycle, refresh orchestration, watchers, status/webview wiring, and anonymous diagnostics. |
| `claudeApiClient.ts` | Existing Claude OAuth/quota transport and runtime one-way identity signal for the credentials used by the last successful request; pace reads this signal without a new request or credential lookup. |
| `dataLoader.ts` | Claude parsing, validation, attribution, and content-analysis primitives retained for exact compatibility. |
| `claudeIncrementalIndex.ts` | Production in-memory per-file Claude index: append-tail parsing, exact cross-file response deduplication, affected-group aggregation, content-analysis contributions, and materialized dashboard rows. |
| `achievements.ts`, `achievementSnapshot.ts`, `achievementCalendar.ts`, `achievementHours.ts` | Versioned rules and numeric token/day/week/hour evidence; `codexAchievementCalendarProjection` resolves full-census ancestry before selecting witnessed dates, keeping positive subsets separate from whole-census completeness. |
| `achievementActivity.ts`, `achievementIcons.ts`, `achievementShare.ts` | Allowlisted deliberate local-action enums, bundled emblem lookup and explicit self-contained badge SVG export. |
| `achievementGallery.ts`, `achievementOverview.ts`, `achievementRecordStore.ts` | Pure theme ownership/record projections, stable goals, automatic/manual showcase selection and the ≤64 KiB canonical v2 envelope; six ordered manual pins and shared v1 lease/migration fences. |
| `achievementUiIcons.ts` | Pure rendering of known inline SVG control icons; no dependencies, network access or additional asset files. Existing localized labels remain in the shared Webview renderer. |
| `achievementMoney.ts`, `achievementMoneyScopes.ts`, `achievementMoneyCatalog.ts` | Fixed USD reference-price evidence for six provider-specific themes; weekly Codex subsets require census-bound date proof and fully dated billable/model vectors. Pricing coverage is separate from date coverage and floating dashboard estimates. |
| `achievementMoneyOrigin.ts` | Runtime-only frozen-book increment validation, fixed-field copying/economic bounds and necessary-and-sufficient cumulative crossings; independent of Token origin and never persisted as index proof. |
| `achievementModels.ts` | Non-monetary model-label recognition for collaboration/rainbow and Claude families, independent of fixed-price aliases; recognition does not establish a remote model's identity or pricing. |
| `achievementReferenceBooks.ts` | Three explicitly published v1 reference-book labels for reading saved money records, separate from current-book selection and new-write authorization. |
| `achievementTitles.ts` | Shared public title helper removing a matching localized rank or its legacy alias only after a catalog middle-dot separator; IDs and pins are unchanged. |
| `achievementDetailPresentation.ts`, `achievementHistoryDates.ts`, `achievementCalibration.ts` | Exact shared-condition display, runtime-only per-level log-date reduction and guarded local incremental recalibration; no new persistent store or source parser. |
| `achievementEffortStatistics.ts`, `achievementCollaboration.ts` | Complete-current-census Codex root × effort statistics and existing joint tier criteria; optional `CodexAchievementSignals.effortStatistics` is cached by proof revision and rendered only inside the existing effort-breadth disclosure. |
| `apiHeatmapDaily.ts`, `pricing.ts#getCurrentEstimatePricing` | Read-only ≤366-date projection with per-projection memoized, in-memory selected-model/component rate admission; preserves current cost scalars, excludes generic unknown-model fallback coverage and adds no network/corpus reads. |
| `apiHeatmap.ts`, `apiHeatmapCopy.ts` | Whitelisted provider/metric configuration and canonical local SVG/Markdown artifact; Token default, explicit amounts, separate provider monetary panels and eight-locale artifact copy. |
| `quotaPace.ts`, `quotaPaceAdapters.ts`, `quotaPaceSource.ts` | Pure cycle-average calculation, ≤16-window numeric adapters and runtime account/window continuity owner using original successful quota observations; no I/O, timers or persisted history. |
| `providers/codex/codexHourProof.ts` | Bounded UTC positive-output hour proof tied to canonical files, verified offsets, current identity and lineage. Optional old-checkpoint proof migration never resets primary totals. |
| `providers/codex/codexAchievementOrigin.ts` | Runtime-only main-tail Token and frozen-reference-money lower bounds; known native per-event pricing, affected aggregate-difference admission, settled canonical lineages and fixed copied worker DTOs. No persistent index fields or extra source reads. |
| `adviceEffectiveness/contract.ts`, `adapters.ts`, and `payload.ts` | Strict observation/evidence/recommendation/action/result contracts, privacy-rebuilding provider adapters, and canonical aggregate/personalization payloads. |
| `adviceEffectiveness/preparedRequest.ts` and `remoteAdvice.ts` | One host-owned full HTTP request object, exact preview/send bytes, BYOK-only authorization, cancellation, and strict structured-advice parsing. |
| `adviceEffectiveness/comparisonPairing.ts`, `comparisonResult.ts`, and `versionedPersistence.ts` | Sanitized comparable-task pairing, frozen measurement-version envelopes, and bounded local feedback/comparison storage. |
| `optimizerRequest.ts` | User-draft-only projection through the same prepared-request and strict-send boundary; no advice-evidence parser fallback. |
| `backgroundWorkState.ts` / `resourceOwnership.ts` | Durable progress/backoff/pause state and the testable creator/stop/disposal registry for timers, watchers, workers, network calls, and backfills. |
| `providers/providerTypes.ts` | Provider-neutral token, event, confidence, outcome, coverage, and limit contracts. |
| `providers/claudeProvider.ts` | Thin compatibility adapter that exposes existing Claude aggregates without changing their results. |
| `providers/codex/codexSchema.ts` | Minimal safe JSON guards; never flattens or returns message/command/tool bodies. |
| `providers/codex/codexParser.ts` | Codex exact-request parsing with cumulative high-water fallback, pseudonymous lineage metadata, structural counters, quality flags, and last-observed limits. |
| `providers/codex/codexManifest.ts` | Allowlisted Codex directory discovery, HMAC file keys, fingerprints, and manifest diffing. |
| `providers/codex/codexZstd.ts` / `codexJsonlScanner.ts` | Bounded header inspection and native single-frame Zstd decoding; the shared scanner keeps decoded byte coordinates and counts cancellable prefix replay as work. |
| `providers/codex/codexIndex.ts` | Schema-3 persistent per-file numeric aggregates and replay evidence, bounded cold/tail parsing, independent aggregate/period/rolling-30-day-hour coverage, and atomic save/load. |
| `providers/codex/codexLineage.ts` | Packed lineage fingerprint contract and runtime-only iterative, memoized primary depth ordering; no recursive stack growth or new persisted fields. |
| `providers/codex/codexQuotaHistory.ts` | Small account-neutral weekly reset-observation cache; compacts repeated local samples without retaining credentials, account names, or raw labels. |
| `providers/codex/codexIndexWorker.ts` / `codexIndexClient.ts` | Background coordinator, recent-first progress, cancellation, resume, checkpoint persistence, and single-flight client. |
| `providers/codex/codexFilePassPool.ts` / `codexFilePassWorker.ts` | Adaptive bounded local pool for independent per-file main, lineage, period, current-day, and identity passes during incomplete backfills. |
| `providers/codex/codexProvider.ts` | Extension-facing Codex snapshot facade and partial/unavailable/error outcomes; constructs runtime-only period witnesses from independent current contribution size/offset/prefix/zone, never from an incoming aggregate's witness. |
| `providers/codex/codexUsage.ts` | Codex calendar-Today/hourly, 7-day, 30-day, monthly, task, and project view-model aggregation with exact-model API-equivalent cost. |
| `providers/codex/codexInsights.ts` | Deterministic structural usage guidance; no prompt/body inspection. |
| `codexView.ts` / `codexViewComponents.ts` | Codex localized-copy and default-provider contracts; no HTML renderer, client script, or CSS ownership. |
| `settings.ts` | Canonical `SETTINGS` catalog and `SettingsStore`; ordinary values use configuration/globalState, while BYOK credentials use SecretStorage and never enter Webview snapshots. Do not scatter direct reads. |
| `statusBar.ts` / `codexStatus.ts` | Provider-specific status presentation and generic Claude quota formatting; weekly-pace tooltip additions reuse shared I18n copy without changing bar text/custom formats. |
| `webview.ts` | Single provider-aware Claude/Codex dashboard shell, shared render functions/client behavior, provider tabs, Compare and sharing. It also currently owns in-host achievement observation/receipt/notice state; it is not a presentation-only module. |
| `dashboardRefreshClient.ts` | Shared live-patch anchor/focus restoration, including disabled-control rejection and stable summary fallbacks; no provider I/O. |
| `i18n.ts` | All user-facing copy for all eight UI locales. |
| `types.ts` | Shared extension and Claude contracts. |

Existing pure modules such as `quotaFormat.ts`, `dateKeys.ts`, `shareCard.ts`,
`heatmap.ts`, `conversationLog.ts`, and `miniMarkdown.ts` keep their current
ownership and tests.

New calculations, grouping and eligibility rules belong in the existing pure
domain modules. `extension.ts` coordinates host lifecycle/I/O; `webview.ts`
integrates accepted results, existing receipts and presentation. Do not add a
second producer, renderer or corpus scan to implement a small feature. These
boundaries guide additions; they do not imply that mixed legacy methods have
already been extracted or require an unrelated large refactor.

## Provider data flow

```text
Claude JSONL
  ──> manifest metadata
  ──> in-memory per-file incremental index
  ──> exact global response identity + affected aggregate groups
  ──> materialized Claude status/dashboard inputs
  ──> Claude adapter

allowlisted Codex JSONL
  ──> manifest metadata
  ──> background worker
  ──> schema guard + exact-request parser with lineage high-water fallback
  ──> per-file numeric aggregate index + bounded neutral weekly-reset history
  ──> rolling sparse 30-day hourly sidecar
  ──> CodexProviderSnapshot
  ──> Codex scopes + insights
  ──> Codex status + provider-aware dashboard render inputs

Claude aggregates + Codex scopes ──> one `webview.ts` dashboard render stack
Claude aggregates + Codex scopes ──> side-by-side Compare (no cross-provider totals)

verified numeric provider evidence + deliberate allowlisted local actions
  ──> versioned achievement rules ──> bounded local grants/peak ledger
  ──> icon-first gallery ──> explicitly selected badge preview ──> local SVG export
verified new Claude/Codex append window + same frozen-book priced increment
  ──> necessary-and-sufficient cumulative crossings ──> independent Token/money receipts
  ──> guarded atomic recordUsage ──> first-record day/unread + one existing notice batch
complete current canonical Codex census + proof revision
  ──> cached optional six-row effortStatistics ──> existing effort-breadth disclosure only

materialized Claude + Codex daily aggregates
  ──> ≤366-date read-only projection ──> Claude / Codex / Both × Tokens / API-equivalent amount
  ──> immutable accepted SVG + Markdown + opaque document-bound handle
  ──> checked explicit local export (amounts never sum across providers)
existing successful raw quota + original observedAt + verified machine-local account HMAC
  ──> runtime continuity owner ──> bounded numeric weekly DTO ──> cycle-average pace
  ──> existing refresh callback ──> document/provider-bound dashboard patch + status tooltip
existing Codex local-log limits ──> account trust unknown ──> forecast unavailable
materialized Claude aggregates
  ──> unified sharing selector ──> legacy Share Card or Claude token heatmap preview
  ──> explicit local export, or public-only exact-target GitHub publication for the Claude heatmap

materialized provider snapshots
  ──> privacy-rebuilding advice adapters
  ──> local evidence + deterministic recommendations
  ──> optional host-owned Prepared request ──> preview ──> explicit BYOK send
  ──> local feedback ──> sanitized comparable pairs ──> frozen comparison envelope
```

One provider may be unavailable or partial without clearing the other
provider's last verified snapshot. Claude-only remains the v2.2.1 behavior;
Codex-only defaults to Codex; when both exist, the dashboard defaults to Claude.
Codex source availability is detected separately from indexed-data availability:
the Codex tab appears as soon as an allowed local home exists, an in-page state
covers the initial index with exact file, percentage, and byte counts, and
Compare remains hidden until both providers have real data. Before the worker
starts, the extension hydrates the last atomic checkpoint; a brand-new index
adopts its first checkpoint while the worker continues. Thus progress is an
annotation on the full indexed-subtotal dashboard rather than a replacement for
its cards and tables. Worker progress is coalesced to at most one Webview render
every 250 ms and repaints only while Codex is selected; the verified snapshot
still gets a final render when the refresh returns.

Codex Today is the current civil day in the configured timezone, not the most
recent task. Its summary uses that day's verified period slice; exact hourly
rows and 30-day drill-downs come from the independent rolling sidecar described
below. Clicking an already-rendered date only reveals that projection and does
not ask the host to read JSONL. Hourly,
daily, and monthly primary charts use API-equivalent cost by default, while the
token-composition chart remains a separate view. Unknown models contribute to
the token denominator but remain unpriced, so pricing coverage stays visible.
Claude and Codex time-series layouts share aligned responsive widths and keep
dense chart/table content inside local keyboard-focusable scrollers.

Provider-panel live patches preserve the page anchor plus non-zero horizontal
positions for the dashboard tab strip and bounded chart, table, project-matrix,
heatmap, sharing, and preview scrollers. Those positions are matched with
privacy-safe structural keys held only for the in-flight patch; they are not
written per frame to Webview state or sent to the Extension Host. Compare's
displayed update time is tied to its stable rendered data snapshot, so an
unchanged refresh remains byte-identical and does not replace the document.
While the user is actively scrolling, the Webview coalesces provider-panel
patches until a 120 ms quiet interval, with a 500 ms upper bound. The newest
revision alone is applied and acknowledged; the live data queue stays in
memory and never reads source logs or persists scroll state per frame.

`dashboardAutoRefresh` controls dashboard delivery, not background collection or
status items, for both providers. Startup may hydrate one verified snapshot;
manual/settings/pricing triggers remain explicit delivery paths. Source-revision
handoff to advice is non-rendering and remains active while paused. Refresh
failure state retains the last verified view and sends a coalesced inline status
message rather than a replacement panel. Persistent Codex work state and actual
main/period/hourly counters distinguish coverage from backfill and retry waits.
Data-panel HTML caches hold at most one entry per provider/tab; a separate
single-entry Claude weekly-input cache avoids rescanning unchanged records.
Content attribution uses a separate single-entry data-section cache rather than
caching the whole Content panel; advice/Optimizer controls remain live. It uses
the same calendar, settings and source-revocation boundaries as data panels.
Today's numeric attribution has its own single-entry cache keyed by records,
analysis, configured day/timezone and pricing identity. Minute-spaced polls may
refresh countdown HTML without walking the whole corpus; midnight, changed
inputs, prices and source revocation still recompute, and disposal releases it.
Data references, settings, prices, locale, currency, calendar boundaries and
quota expiry invalidate these caches. Today expires by minute; hidden history
by hour, when Content week attribution recomputes once. Disposal and source
replacement release retained references.
Claude materialization retains one structurally compared, time-aware render
contract, so unchanged poll/focus delivery reuses its aggregate references.
Identical quota/history observations also retain identity. The snapshot still
recomputes session expiry, workspace scopes and calendar ranges before comparison;
no token-total-only or fixed-hour key can conceal a changed render contract.
Claude failure recovery is source-scoped: selecting another home immediately
revokes its records, index, quota, advice handles, accepted sharing previews and
last-success time, regardless of dashboard pause. Configuration generation and
source checks after discovery, manifest scanning and index loading retire late
presentations. A distinct source/pricing generation rejects invalidated index
results, including A → B → A switches and manual price-refresh races. A completed,
verified same-source load may populate only the host index after a presentation
change, so the queued settings refresh avoids repeating a cold read; it cannot
publish the retired UI or bypass clear-all/disposal. Disposal cannot deliver a late clear.
Failures within the same source still retain the verified snapshot.
Codex retains a failed refresh's verified subtotal only within the same resolved
data directory. A directory change clears its view, insights and success time,
and suppresses shared checkpoint hydration until that provider refresh verifies
the source. Provider/generation checks after asynchronous boundaries prevent
retired work from updating its replacement. Unchanged complete render contracts
retain view/insight identity; completed steady polls do not fabricate backfill
progress or invalidate hidden panels merely by toggling loading.

中文：`dashboardAutoRefresh` 仅控制两个供应商的页面交付，不停止后台收集和状态栏。
手动更新仍可用，暂停期间也会撤销来源已过期的 AI 请求。失败提示单独轻量更新，保留
已验证页面。主日志、周期迁移和小时回填显示各自计数及重试状态，不把主日志覆盖率
冒充整体完成度。面板缓存按供应商／页签有界保存；记录、显示设置、价格与时间边界
变化时失效。今日倒计时按分钟过期，历史不随每分钟刷新重复计算。
内容归因只缓存数据区，AI 控件保持实时；今日数值归因另按记录、分析、自然日／时区
及价格身份保存单份缓存，跨分钟倒计时不重复遍历历史，午夜或输入变化仍重新计算；
撤销来源和释放时清除旧引用。隐藏历史面板按小时过期，内容周归因在整点重新计算一次。
Claude 切换来源立即撤销旧记录、索引、额度、建议句柄、分享预览及成功时间，页面暂停
不阻止此隔离；异步发现、扫描和索引返回均核对来源及配置代次，包括 A → B → A。
独立的来源／价格代次拒绝旧索引结果；仅显示设置变化时，同源的已验证构建可供宿主
复用，但不得交付已退休页面或绕过清除／释放边界。
释放后不再交付迟到清空；同一来源的临时失败仍保留已验证统计。
Codex 仅在同一数据目录内保留失败前的已验证统计；切换目录会清空旧视图、建议和成功
时间，新来源验证前不采用共享旧检查点。异步返回后校验供应商及配置代次，过期任务
不能改写新任务。已完成且未变化的轮询复用视图，不制造回填进度或重复渲染隐藏面板。

The sharing workspace is rendered once: in Compare when both providers have
data, otherwise as a Claude All-time fallback. Codex-only All-time also exposes
it while achievements are enabled. The heatmap presentation itself supports one
provider or both. `enableShareCard` is the only
visible sharing on/off control. The public command IDs `exportShareCard`,
`exportHeatmap`, and `publishHeatmapToGitHub` remain registered for compatibility
and open the matching presentation; they do not bypass preview. The retired
`showHeatmap` setting remains catalogued and clearable for one release but is
hidden and no longer creates a duplicate panel. The selected presentation is a
local UI preference and does not alter provider accounting. An explicit
compatibility command issues a provider-lifetime monotonically increasing
revision as a separate live intent. The Webview applies it and acknowledges the
exact revision; the host then removes the live intent without rewinding the
revision history, so an acknowledged command cannot replay on a normal render,
sharing reset, or dispose/reopen of the same provider. Reset Sharing
Preferences uses the existing confirmed local-data action: the host sends a
request-id client action, the Webview verifies deletion of the twelve allowlisted
localStorage keys, and the host reports failure (with its recovery tombstone)
unless the matching ACK is true.

At narrow Webview widths, the 1200×680 Claude Share Card retains its intrinsic
width inside a keyboard-focusable local horizontal scroller instead of being
scaled into illegibility. Renderer tests audit every normal-size SVG label at
4.5:1 or better, while browser geometry tests keep labels inside each viewBox;
the complete artifact remains inside the surrounding Axe scan.

## Token and limit semantics

Claude records carry Anthropic's four token buckets. The extension validates,
deduplicates, sums, and prices them by model. Claude cost remains an estimate
from the configured rate table; it is not an invoice.

Pricing diagnostics are bounded for the entire Extension Host lifetime. A
previously unknown model-shaped label can produce one warning, with at most 128
retained labels (160 characters each) and one suppression summary. Malformed,
oversized, or path-shaped labels share an anonymous placeholder. Refreshes and
label churn never reset the budget; fallback pricing remains active after the
budget is exhausted. Recognized Opus 5.5, Sonnet 5.5, GPT-6.1 Sol, GPT-6 Sol,
and GPT-6 Luna aliases use their own verified Standard/cache rates without
producing unknown-model warnings. Sol generations have different cache-read
rates. Aggregate data does not establish request-specific Fast/Batch/Flex,
long-context or regional OpenAI surcharges, so none is invented. Exact-price
coverage for Codex/weekly value excludes family/default fallback rates; Claude's
main cost retains its existing estimated fallback behavior, not a coverage flag.

Malformed model metadata (non-string, oversized, control-character or
prototype-named labels) is normalized to `<unknown>` before retention. Its
numeric usage remains counted and its price is zero/unattributed. Missing/null
model fields retain the existing skip behavior. Optional arbitrary objects
are not coerced to strings. Tool/session analysis maps use own-property reads
and setter-free own-property writes, preserving normal snapshot object shapes
without modifying shared prototypes. Internal render-time session, workflow,
project and attribution grouping tables have no inherited keys; public rows and
snapshots retain their ordinary-object shape. The compatibility full loader emits
anonymous summaries, not per-line/file console errors, and retains at most 12
bounded model names for optional diagnostic detail.

Manual runtime-price refreshes are single-flight. The HTTPS response is capped
at 16 MiB and 16,384 catalog entries with a 15-second absolute deadline as well
as an idle timeout. Valid finite non-negative fields build a fresh prototype-safe
catalog, atomically replacing the prior one only on success. Failures preserve
the previous catalog and fetched-time metadata; repeated refreshes do not retain
stale model IDs. Future model additions must verify official exact IDs/rates,
include repeated-pass diagnostic and cache/output reconciliation regressions,
and never promote family inference into exact coverage.

Codex uses these rules:

- processed = `input total + output total`
- fresh input + output = `max(0, input total - cached input) + output total`
- cached input is a subset of input; reasoning output is a subset of output
- neither subset is added again to processed totals
- fresh input + output is an optimization aid, not a cost/quota equivalence

Each valid Codex `token_count` normally carries `last_token_usage`; its input,
cached-input, output, and reasoning components are the exact request-level
attribution. `last_token_usage.total_tokens` is the active context size and is
not attributed as request usage. A full numeric signature of both total and
last snapshots suppresses replay only when it matches the same pseudonymous
rate-limit source or the immediately preceding record. This narrow proof avoids
silently merging a legitimate reset from another interleaved source.

If `last_token_usage` is absent, `total_token_usage` remains a cumulative
fallback and may include an inherited parent baseline. That path uses
per-component, per-lineage high-water marks. Unknown parents, regressions, and
schema drift produce quality flags rather than negative or fabricated usage.

Codex `rate_limits` found in local logs is a last-observed snapshot only. It is
hidden once its reset time passes. The v2.3.1 candidate also keeps a bounded,
account-neutral history of account-wide weekly observations: repeated samples
for one reset boundary collapse to one representative, while genuinely
different reset times remain separate. This history is evidence for aligning
and auditing weekly estimates; it is not an account registry and cannot reveal
a reset that never appears in a local log line. v2.3.0 does not read Codex
credentials or make a network call to refresh it.

## Privacy and persistence

### Local achievements (2.5.0)

Historical dates use a frozen 138-rule registration manifest. Each handler verifies
the exact ID, counter, target, group, rule version, series, base ID and monetary
scope; adding a rule or changing its interpretation cannot silently inherit a date.
The module-level signature covers actual and registered metadata.
Session reconstruction consumes only the canonical uncapped session admission,
not arbitrary positive-output records. Its cache uses weak record-array keys and
is explicitly retired on source/evidence changes. Changed logs require recalibration.
Calibration stages independently verified native activity receipts and preserves
their first-recorded dates even if the UI operation is cancelled or another source
fails. Only historical reconciliation stays quiet. Completed, partially saved,
cancelled and failed outcomes remain distinct.

Gallery-wide expand/collapse changes only card entries in existing `openDetails`
local UI persistence; it does not select sources, grant awards or acknowledge unread
records. Bronze/Silver/Gold are localized display labels, including 铜／银／金 and
銅／銀／金. Legacy IDs, pins, reference pricebooks and thresholds are unchanged.
Conditions and units are consolidated only when exactly equal across levels.
`webview.ts` renders one shared achievement money-reference disclosure with the
current book/date per enabled provider and one non-billing note. Saved different
historical `referencePricebook` values are grouped with the exact associated award
titles/ranks; current book selection never rewrites those associations. Per-card
price/basis notes are removed while scope and pricing coverage remain. The current
statistic remains uncapped even at the highest rank. Missing/stale evidence stays
unavailable rather than being replaced by a target or a saved award.

Expanded rank rows render names with per-rank theme tokens (foreground fallback in
high contrast) and bold, right-aligned thresholds on the same header row. Only the
next rank above the highest earned renders “In progress” when proof is ready;
later ranks, fully earned cards and pending proof omit it. Verified retained-log
dates render as bare ISO dates, with source interpretation once in Evidence details
and provenance in title/ARIA. If both dates exist, only the verified date is visible
and first-recorded details remain in title/ARIA; a first-recorded date alone retains
its explicit label, and unknown stays unknown. These are renderer-only changes:
award rules, date calculations, catalog and persisted records are unchanged.

`root-portfolio` retains its IDs, thresholds and saved awards under the localized
name Independent root tasks / 独立主任务. `achievements.ts` builds `modelsByRoot` only
from verified root ownership and recognized model buckets with positive input
**or** output. `verifiedRootCount` counts each root tree once, including eligible
children, without asserting task completion or reading task content.

The Share & compare label changes neither the `compare` provider key nor navigation
state ownership. Achievement sharing only adds basic equal-width checkbox options
with a separate rank line. The local-icon repair uses the same
`webview.cspSource` as the main dashboard CSP for bundled `asWebviewUri` resources;
it adds no remote image permission. `achievementShare.ts` embeds the fixed public
`https://github.com/ClaudeCodeUsage/ClaudeCodeUsage` anchor with no input-derived
destination, resource fetch, telemetry or personal metadata. Headings, footers and
rank/threshold labels wrap with reserved spacing in the existing grid; output
remains deterministic with bundled image data and the immutable preview/export seal.
Broad sharing-page visual unification/beautification and a durable usage archive
are deferred to the next version and are not implemented in 2.5.0.

Per-level historical dates are derived annotations with `schemaVersion: 1`, bound
to `ruleVersion`, data timezone and actual catalog shape. Cache reuse also depends
on current source evidence, enabled providers and pricing context. Source, OFF,
timezone or price changes rebuild or withdraw annotations. This runtime cache is
not a new store: canonical v2 `recordedDay`, original unknown dates and unread state
remain intact. A displayed log date is the earliest verifiable date in retained
local evidence, including a verified subset; it cannot establish the account's
actual complete history. A saved first-record date remains a distinct fact.

Automatic date evaluation reuses materialized daily rows for supported volume,
output, cache, model/family, activity and weekly rules. Codex admits strictly
verified, fully dated file evidence. Consistent with the existing evaluator,
active-day counts and streaks include today's positive activity and use that day
as their date; qualified family/day rules require a closed day and use day + 1.
Four-week windows exclude the first incomplete week based on the first positive
activity day, not an earlier zero-only row. These are date projections of existing
conditions, not rule changes. Only explicit manual recalibration reduces the
already-held, uncapped Claude record memory for output-session, Fable-session and
same-session Fable/other-family dates. Date reduction reads only materialized numbers
or usage metadata in held records, with no extra log-body scan, conversation-content
inspection or metadata export. Normal local incremental refresh may still read
allowlisted new/changed JSONL under existing analysis settings; it forces no full
reread and adds no scanner or network access. Ordinary warm refreshes never regroup
those records for dates.

Joint-agent/effort conditions, hourly/night conditions, single-task monetary dates
and migrated local actions without timestamps have no supported historical date
handler. Keep them unknown or show their original first record; never fill today
as a substitute. Future rules require an explicit date-handler allowlist and rule
version isolation; new scopes default to unknown. Future catalog envelopes retain
the existing read-only, fail-closed behavior rather than being rewritten.

Manual calibration is a local-only single-flight incremental operation. It adds
no OAuth/quota, online pricing, BYOK or other network request, forced full scan or
old-award clearing. While pending, a shared guard pauses historical grants and baseline
advancement while real native receipts are staged. The guarded commit reconciles history quietly, with
no new-award notices or forced grants. Busy work, an unaccepted current index census,
failure or pre-commit cancellation cannot be reported as success. The base index
requires an accepted current manifest and complete indexing; independent calendar,
pricing or subset coverage may remain partial. Verified partial history retains
lower bounds or unknowns; completion does not mean all award scopes are fully covered.
Cancellation before the historical commit adds no historical awards;
once the atomic commit completes under a valid guard, a committed flag records the
actual result, and a later cancellation neither undoes saved records nor reports
them as unsaved. No storage schema, source parser,
dependency or package-version change is introduced by these presentation features.

The gallery has 50 display themes and 178 award conditions. `enableAchievements` defaults
on, but an existing opt-out wins; a once-only non-modal upgrade announcement offers
view/disable actions without opening the gallery automatically. Historical grants
establish a quiet baseline. Subsequent eligible in-panel notices have no sound or
focus change; night and 24/48-hour output badges remain silent.

Twenty-four API-equivalent conditions belong to six separate Claude/Codex cumulative,
completed-week and single-session/task themes. `achievementMoney.ts` freezes
`api-reference-2026-10-{backend}-v1`, dated 2026-10-09; exact decimal components
sum before flooring to microUSD. Exact models and complete rates, including known
Claude cache-write TTL, qualify; unknown models remain unpriced. Verified priced
subsets prove only lower bounds. Week scopes use completed Monday-start weeks in
the current data zone; single scopes require one Claude session or an independently
verified Codex task tree. Historical recognition is quiet. Cumulative monetary
crossings now use verified live append receipts; completed-week and single-session/
task monetary scopes still reconcile quietly with unknown dates. Dashboard pricing/
display currency does not alter these rules.

Both `claude-api-week` and `codex-api-week` now contain five ranks: Bronze $100,
Silver $500, Gold $2,500, Platinum $10,000 and Legendary $25,000. Only the four
Platinum/Legendary IDs are added; the existing three IDs/targets, series ownership,
artwork, completed-week boundary and frozen-price provenance remain unchanged.
Their four explicit history registrations bring the manifest to 138 entries; a
supported log-derived annotation is still separate from a saved first-record date.
Legacy envelopes reject the new IDs, and the pre-expansion reader fails closed
without rewriting or clearing either envelope. Schema/catalog versions and the
65,536-byte cap stay unchanged; the reported maximum-envelope fixture is 37,374
bytes. These synthetic checks do not establish native/F5 acceptance.

`achievementModels.ts` keeps non-monetary collaboration/rainbow recognition
independent of `achievementMoney.ts`'s fixed pricing aliases. Claude family labels
admit only the explicit `global`, `us`, `eu`, `jp`, `apac` and `in` Anthropic prefixes;
arbitrary prefixes such as `xx` are rejected. Recognized Codex named-family labels
may still be unpriced; recognition adds no rate or pricing alias and is not proof
of upstream routing or availability.

Gallery counts use the enabled-provider series and level denominators separately.
Before those counts render, record loading, unavailable, changed and disabled
states use explicit eight-locale status copy instead of an apparent empty `0 / 0`
collection. A verified Claude cumulative subtotal is shown as a `≥` lower bound
while an enabled Codex source remains unverified; unknown Codex usage is not exact zero.
Canonical series keys own disclosure/focus restoration across tier changes, with
aliases for older level-specific keys. All/Next/Earned filtering uses only a local
UI enum; it never schedules provider work. A safe provider enum and one-shot focus
intent return from sharing to the originating gallery. A compact next target precedes the
expandable all-tier rules. The settings shortcut focuses the existing opt-out.
The catalog supplies 52 artwork groups with distinct bundled raster artwork. Tiers share
their series emblem; level color/labels provide the progression. Gallery numbers
are floored integer abbreviations, never rounded up to an unmet target; full
integer progress remains in tooltips and accessibility text. Detailed data caveats
are in a persisted, initially collapsed disclosure. Embedded export images are
cached by filename rather than repeated for every tier ID.

`achievementGallery.ts` is a pure display-ownership map, not a rule or ledger
migration. Fourteen-day (`streak-machine`) and first shared-day (`dual-provider-day`)
milestones live in their canonical growing themes. Every formal rule appears once
in details; milestones keep their own icon, status and condition without an extra
tier pip. A milestone-only award is earned but has zero earned formal tiers.
Overview/recent/disclosure aliases use this map. Saved pin keys remain exact; old
duplicate pins are individually removable in the same card. Sharing, grant IDs,
dates and unread batches are unchanged; rendering neither writes nor reads logs.
If a legacy unpin control disappears, the existing transient focus fallback
returns to the canonical theme summary, then the achievement tab if unavailable.
Surviving control IDs still take precedence; no persistent focus state is added.

The exploration card details project the existing three safe feature enums from
committed `achievementActivity`, in their catalog order, not an action timeline.
Each step says recorded/not recorded; neither historical awards nor pending writes
supply missing facts. Advice feedback and setting changes remain separate rules.
This display adds no controls, state fields, reads, events or evaluator changes.
Its bundled `safe-feature-journey-v242.png` replaces the misleading “10X” lookup;
the old asset remains untouched. Gallery, notice and local SVG use the same map.
Notice motion is CSS-only: one 440 ms opacity/scale reveal on the existing emblem,
not the notice root or text. Reduced motion and both native high-contrast body
classes disable it entirely. Existing delivery, cooldown, dismissal and ACK
protocols are unchanged; no new timer, persistence, network or replay is added.

`achievementGallery.ts` allowlists same-provider current model/token destinations.
The shared renderer requires existing materialized data and a matching family for
model links; shared/calendar/action badges have no substitute totals link. The client
resolves only fixed DOM destinations from current rendered buttons. One public theme
key and provider enum in existing Webview UI state preserve the statistics return;
special navigation retains disclosures/scroll, while ordinary tab/provider changes
retire the intent. No host command, log scan, award evidence/date or share consent is added.

`achievementStages.ts` adds display-only 1/2/5 integer nodes between formal
Token tiers and within one decade before a Token entry tier, never after the last.
First-tier stages require positive, ready progress; monetary entry tiers stay unchanged. Closed cards show current
progress toward the next formal level and, where applicable, the next intermediate
stage. Pending/stale proof has neither. Counter/setting exploration is excluded;
formal IDs, thresholds, award counts, notifications and share choices are unchanged.
Nodes are derived only from the fixed catalog and current aggregates: no writes,
history scanner, timer or additional permission.

`achievementOverview.ts` selects at most three earned representatives and three
positive, current goals from already-collapsed enabled-provider rows. Goals use
the next display-stage fraction, with canonical ties and distinct topics; rank
and current-provider ties guide representatives. Night/hour goals are not
promoted. Selection keys stay in host memory for a visit, reset on entry/provider
change/manual refresh/OFF/clear, and never become share choices. Live changes
update values and remove invalid goals without replacing or reordering them.
Overview buttons open the existing persisted series disclosure; they do not
read logs, issue refresh requests or persist a second aggregate index. Pins and
record projections and the foreground missed-notice summary use the bounded
canonical envelope below without creating a second award store.
Next-target overview cards use the target's name, rank label and rank color;
earned gallery cards keep their earned rank. `achievementTitles.ts` is shared
with SVG export so a matching localized rank suffix or its legacy alias after a
catalog middle dot is not repeated beside a separate rank label; other title text
and unranked milestones remain intact.

`achievementLongTerm.ts` appends 30 fixed ranks to 15 existing sustained Claude/
activity series. Their first three IDs, thresholds and evidence remain unchanged;
new IDs reuse their explicit base rule's counter/art and locale-native name/rank.
No consecutive-day tiers or scanners are added. Family days now share the activity
topic, so one automatic slot need not suppress an independently earned model-volume
badge. Historical IDs and v1 series-pin vocabulary stay frozen, independent of live
series membership. Additive IDs cannot be imported as v1 proof; current v2 accepts
old 144-record envelopes and up to 178 current records under the unchanged 64 KiB cap. An
old binary may reject unfamiliar IDs but must not overwrite the canonical envelope.
Higher output/cache tiers use the same causal native-tail checks; session/calendar
reconciliation remains quiet with unknown dates. Explicit share choices never
auto-upgrade to a higher rank.

`codexAchievementRevision.ts` uses a runtime v3 digest binding the full census,
independent indexed/global-calendar/timezone fences, contribution witnesses and
period cursors/day vectors. Cursor-, witness- or fence-only changes retire
calendar/Money caches even when displayed counters match. The digest reuses the
existing hash/cache path; it adds no I/O, timer, store or persistent index field.

The provider rebuilds the current full census and independent witnesses before
comparing them exactly with the preceding publication. Only equal, detached,
deeply immutable copies registered by `immutableCodexAchievementFiles` can reuse
revision and calendar-projection memoization under the same independent fences.
`indexChanged`, zero body reads, equal totals or a caller-supplied digest are not
substitutes for this comparison. Mutable or malformed inputs take the ordinary
validation path; worker-owned aggregates and older publications are not mutated.
Money-scope binding reuses the internally validated projection instead of repeating
the same calendar computation, without trusting an arbitrary supplied projection.

A synthetic 20,000-file × three-date benchmark, including snapshot construction,
measured median warm evaluation of about 348 → 109 ms and changed evaluation of
about 2,110 → 1,460 ms. Changed/append work remains roughly 1.5 seconds and O(files)
in this case; even reuse still requires full-census comparison. These local
measurements exclude worker parsing, file discovery and dashboard rendering.
They are not end-to-end refresh, native responsiveness or general latency guarantees.

`codexAchievementCalendarProjection` requires a verified current manifest and
complete base index. The provider constructs each runtime-only witness from the
contribution's own size, offset, expected lineage prefix and zone: EOF must match
the period cursor, prefix/zone must match current period semantics, and period migration,
oversized-line discard and lineage reconciliation must be absent. Incoming
aggregate witnesses are stripped; failed refreshes cannot reuse them as authority.
The projection resolves ancestry over the full census before selecting dates,
excluding conflicting branches and descendants. Sound positive dated components
remain `verified-subset` lower bounds for activity, family and weekly Token rules,
even with undated residuals or an incomplete global calendar fence. A subset never
proves complete/zero history, a four-completed-week mean or a retained calendar peak;
dual-provider date rules also retain their existing full-proof fence.

`codexAchievementMoneyScopes` obtains the validated projection of the original
full census, reusing it only for the immutable snapshots described above, and checks
`sourceRevision`, completeness/scope and numeric day/model signatures before
selecting fully dated files. Each selected file must cover every billable counter
and model/date vector exactly; Token containment alone is insufficient. A positive
completed-Monday-week amount from this subset is a lower bound with partial
coverage and runtime `scopeLowerBound`; partial zero-only/empty remains pending.
Positivity uses exact units, even when integer microUSD floors to zero.
Pricing coverage is independent of date/census coverage: unknown models remain
unpriced and overflow remains unavailable. Cumulative and task scopes are unchanged.
No prices or rules are added; the existing eight-locale evidence caveat is reused
with updated wording for unverified Codex lineage or dated usage. The footer also
shows it for date/weekly-money scope bounds when identity coverage is complete.
Witnesses/revisions carry no raw identity into rendering, export or persistent index state.

The overview uses bounded horizontal cards rather than stretching a few icons
across the desktop. In-card pins remain separate buttons; next-target bars are
decorative companions to labelled numeric progress. Existing size choices, artwork,
theme tokens and persistence routes remain. `modelRainbowNextEligibility`
excludes a NEXT tier above enabled-provider family capacity (Claude four, Codex
three), without changing formal conditions, pins or gallery visibility.

Positive combined calendar rules have a bounded runtime set of per-rule lower
bounds derived from independently validated provider days. Active days, streaks,
active weeks, weekly Token peak and a proved three-family day can show `≥` while
another provider is incomplete. Zero partial counts remain unknown; shared dates
and four-week averages retain full-proof fences. This does not reopen the combined
notice latch or invent dates for imported grants. `normalizeClaudeNativeUsage`
restores a missing flat cache-creation count only from both explicit safe known
TTL components, without mutating the source. Full and compact/incremental reducers
share it; contradictions and unknown TTL fields remain excluded from money proof.

With achievement proof enabled, a compatible legacy Codex period without current
lineage markers enters the existing bounded period migration, rather than staying
a warm no-op forever. All-time proof coverage remains incomplete until canonical
files are revalidated; readable compatible slices remain available for ordinary
display. Persisted cursors support cancellation/resume and completed proof returns
to zero-body warm refresh. OFF skips this additional revalidation.

`achievementEvidence.ts` classifies rules into nine independent runtime evidence
domains. Ready, pending and stale proof is separate from saved award identity:
pending/stale cards retain earned tiers but omit numeric progress and are excluded
from Next filtering. Each domain establishes a quiet baseline on first/recovered
proof; incomplete calendar proof does not suppress subsequent verified Token
awards. Provider retirement resets only affected domains. Once a usage domain has
quietly reconciled calibrated history, later levels are no longer permanently
silenced by the migration recheck set. These latches are memory-only; they do not
yet constitute a durable missed-notice journal or cross-host coordination.

The Claude index has a runtime-only tail-origin contract. An explicit
accepted-observation window is copied before asynchronous work; existing physical
file/prefix/EOF verification supplies offsets before content-analysis plans may
expand. After global response deduplication, only new canonical winners beyond
those offsets, with safe native token vectors and timestamps in that window,
contribute to a fixed total/output/cache-read/cache-creation/four-family numeric lower bound.
Cold builds, discovered imports, replacements, incomplete tails and timezone
retirement do not supply live origin. Mixed history retains only independently
verified additions. No source identities enter the result, no index field is
persisted, and no additional body read or timer is introduced. The rule helper
uses the existing formal targets and requires these additions to be sufficient
against the previous progress and necessary against the new progress, per exact
level; calendar/session/agent rules are not inferred from volume. The host now
captures the canonical award fence before parsing and commits the accepted index
before handing off existing materialized references, independently of rendering.
Four-family, output, cache-read, cache-creation and cumulative crossings use atomic
usage awards. Cumulative monetary proof follows the separate path below; other
usage rules remain quiet pending their own origin proof. Claude's
creation, read and output components must be safe integers with a sum no greater
than processed volume; cached creation is counted once in the native vector.
Explicit rebuilds never provide a live window. Retiring only presentation does not
discard a sound source commit; source/failure/clear/OFF/timezone/disposal guards do.
Display-zone volume receipts do not relabel calendar evidence from another zone.

Codex now has the corresponding producer/worker foundation. Only established
physical-file appends from a complete prior base index receive a copied explicit
observation window. The normal main parser accumulates input-plus-output,
output, cached-input and three-family numbers within that window. After duplicate
and lineage reconciliation, both snapshots must verify the same physical/session
ownership and settled inherited prefix; each admitted field is bounded by that
file's actual aggregate increase. An unrelated identity conflict excludes its
branch, not sound additions. Cold/imported/replaced files, incomplete tails,
changed timezone, counter regression and unsettled prefixes provide no live proof.
Main file-pass workers, coordinator and client rebuild the fixed numeric DTO;
foreign windows/requests, duplicate task replies, recovery/adoption and cancellation
cannot supply it. Final atomic-save failure never delivers a successful result.
Proof is ephemeral and warm zero-body refreshes never replay it. The per-level
helper uses existing approved targets with the same necessary-and-sufficient
volume test; it does not infer calendar, effort breadth, sessions or agent awards.
The Codex facade copies the window before asynchronous work and returns only
matching successful proof. Before each observation the webview owner rereads the
canonical award generation/sequence under the shared lease. The extension hands
off accepted snapshots without rendering, including when dashboard updates are
paused. Separate accepted references feed the evaluator without changing the
displayed snapshot. Source, setting, timezone, clear and disposal guards retire
proof; an unrelated Claude failure cannot erase sound Codex additions. The fixed
Token crossing set commits first-record day/zone and unread state through
`recordUsage`. Only selected history rows written after the accepted baseline
sequence may be superseded; older history, action provenance and existing usage
remain unchanged. Superseding advances sequence, fencing old display ACKs.
Failed writes retain at most the catalog's ID count of runtime receipts for an
ordinary-refresh retry; retired receipts release their source guards. No new
index fields, body reads, watcher or timer are added. Foreground notice delivery
uses the existing shared cooldown and ACK guards. Claude uses the same bounded
receipt queue and lease; either provider's failure retires only its own proofs.
Other usage scopes still reconcile quietly pending their own origin proof;
cumulative money uses the independent runtime path below.

`achievementMoneyOrigin.ts` admits only the four cumulative monetary tiers per
provider, and only when before/after full-scope evidence and the new increment use
the same frozen book. The admitted
increment must both suffice from the previous total and be necessary to the new
total reaching the existing target. Claude's normal parser/index includes only
additional accepted response identities with complete reference-price TTL evidence;
two fixed Claude backend books are supported. Codex's real worker/facade path prices
known native events under the OpenAI book and bounds each admitted candidate by the
affected file's priced aggregate difference. No accepted window or achievements OFF
means no extra monetary-origin work. Primary parser accounting is unchanged.

The optional runtime money proof contains only provider/backend/public book version,
an exact-unit decimal string of at most 64 digits, microUSD and eligible processed
Tokens. Fixed-field reconstruction at IPC boundaries and a frozen-book maximum
per-Token-rate economic bound reject invalid proof independently of Token proof.
The new monetary-origin amounts, exact units, eligible-Token counters, raw event/source
IDs and proof are never written to the index or award file; only the public
`referencePricebook` version accompanies a money award's ordinary record metadata.
Existing usage aggregates retain their documented storage contract. Price evidence
is always the frozen reference, never current floating prices.

The host keeps bounded independent money receipts behind source, identity, scope,
date/timezone, clear-generation and feature-OFF guards. It rechecks the current book
and qualified full cumulative scope at the lease commit. A money-only book/scope
invalidation withdraws money without cancelling an independently valid Token receipt;
the common source/index, clear, OFF and disposal guards still apply to both. In
particular, a Claude backend change also invalidates the index generation and can
retire pending Token proof. Failed saves retain retryable
runtime proof and never display an optimistic date. `recordUsage` saves origin
`usage`, first-record day/zone and unread state atomically. Only same-book peer history
written after the accepted baseline sequence can be repaired with a new sequence;
different-book or established history keeps its original basis/date. Token and money
writes from one accepted update coalesce into one existing five-minute notice batch.
No timer is added; hidden-panel/unread-summary behavior is unchanged. Completed-week,
single-session/task and other unsupported live usage scopes stay quiet with unknown dates.

`CodexAchievementSignals.effortStatistics` is optional evidence from a complete,
current canonical index census. `extension.ts` computes it only when the proof
revision changes and reuses the same signal object/helper result on unchanged warm
updates. OFF skips the helper; source/config replacement or incomplete indexing
withdraws evidence as unknown, not six fabricated zero rows. The pure helper pools
non-approval-reviewer root × effort populations and admits only each population's
own positive output. Six rows (low/medium/high/xhigh/max/ultra) appear only inside
the expanded existing effort-breadth card, using its next existing tier's three
joint criteria:

| Existing tier | Processed Tokens per effort | Output Tokens per effort | Qualifying roots per effort |
|---|---|---|---|
| Bronze | 100M | 100K | 5 |
| Silver | 500M | 500K | 10 |
| Gold | 2B | 2M | 30 |

Row progress is the minimum of the three criterion fractions, capped at 100%;
renderer and evaluator share `EFFORT_PROCESSED`, `EFFORT_OUTPUT` and `EFFORT_ROOTS`.
The informational subtotal/coverage is fixed USD under
`api-reference-2026-10-openai-v1` (2026-10-09), independent of display currency;
it is not an effort-qualification condition.
Separate model and effort marginals cannot establish a model × effort cross-tab;
there is no ratio allocation. A single-model or single-effort full pricing-component
reconciliation admits a known priced subset; remaining Tokens stay unpriced.
Empty, unpriced, partial, invalid and overflow states remain distinct, with unsafe
money withheld. The DTO exports no identities/model labels/exact-unit strings,
stores no history and adds no rules, thresholds, navigation or preferences. Current
Claude logs supply no effort attribution for this surface.

Plugin-action provenance compares the committed before/after activity ledger
through the canonical rule evaluator. Only newly crossed plugin targets enter
a bounded six-ID runtime set; hydration and imported ledgers do not. Successful
grant persistence consumes the IDs; failed saves retain retryable proof, while
OFF/clear retires it. Local action awards are evaluated after a successful ledger
save even without a visible/ready panel, without rendering hidden views. Queued
usage IDs still check the provider-evidence epoch; plugin IDs check the separate
clear/activity epoch so provider revocation cannot erase independent action proof.
This adds neither storage fields nor timestamps and is not cross-host coordination.

`achievementRecordStore.ts` now owns the canonical `achievements-v2.json` award
envelope in extension global storage, separately from those runtime latches.
It validates at most 178 current unique rule IDs, monotonic sequence/generation, reason
enums and optional first-record day/zone within 64 KiB. Audited old grants seed
only a missing canonical file. The v1 file is read-only migration input outside
explicit clearing. Versioned migration archives saved awards from the 21 changed
model/team/effort/rainbow conditions; legacy records are capped at 48 and never
prove current rules. Fixed-price award rows may retain a public reference-pricebook
version, never a personal amount.

Reading saved monetary rows accepts the provider's current books and the three
explicitly published v1 labels in `achievementReferenceBooks.ts`: Claude
`api-reference-2026-10-anthropic-v1` and
`api-reference-2026-10-aws-bedrock-in-region-v1`, and Codex
`api-reference-2026-10-openai-v1`. Retained labels are not rewritten when current
book selection changes. New `append` and `recordUsage` drafts require a current
provider book; readable historical labels alone cannot authorize new grants.
This is an explicit published-history registry, not a pattern-based future
whitelist, and adds no prices, IDs, storage fields or schema. An unknown non-current
book fails closed; its envelope remains untouched, including by Clear All.

Schema/catalog versions, automatic/manual mode, ordered pins, pin revision and a
bounded legacy-file boundary share the same envelope.
The existing v1 lease coordinates both files; Clear All commits a v2 tombstone
then an empty v1 downgrade fence, with interrupted clears resumed under that lease.
Old Gold is not evidence for recalibrated rules. Migration preserves unknown
dates; an existing canonical file wins over
stale globalState. Each transaction rereads under the existing filesystem lease,
flushes a private temporary file and atomically renames it. Concurrent hosts do
not overwrite peers' awards. Clear holds that lease while deleting exact related
globalState keys, then saves an empty generation/sequence fence; old hosts fail
closed until reload. Action/hour/calendar writes check their adopted generation.
Unknown, future, oversized or symlink inputs remain untouched and do not fall
back to a legacy grant mirror. Disabled achievements do not initialize the file.
Actual saved local actions retain unread records even when hidden or delivery
fails. Proven Claude/Codex Token crossings and same-frozen-book cumulative
API-equivalent crossings also save unread first-record days through independent
receipts. Session/task and calendar/structure awards without their own verified
new-activity origin still reconcile quietly with unknown dates. Ready-domain
growth or price-only changes do not establish producer-origin evidence. The envelope also owns
the existing bounded activity/hour/calendar proof: activity unions the 29 safe
keys/four enums, hours retain a maximum ≤48, and calendar maxima merge only within
the same measurement context. A Claude-only retained peak ignores unrelated Codex
parser/period versions; rules, timezone, provider-presence and complete-current
evidence fences still apply, and any context including Codex still checks both versions.
Legacy auxiliary Memento entries are migration inputs, not runtime mirrors.
Hydration always adopts canonical proof, including
empty proof after clear; a bounded 33-key pending-action map replays deliberate
bootstrap actions only after hydration. This avoids restoring stale whole-object
Memento caches. Plugin provenance compares the actual under-lease before/after
activity, not another host's imported progress. A deliberate action and its newly
crossed plugin awards commit in one transaction, so peer history reconciliation
cannot preempt their origin/date/unread state. Live notices reserve a shared five-minute
cooldown under the same lease without marking records read. The existing native
window-state owner supplies foreground eligibility; panel visibility/readiness,
OFF/clear generation and document replacement fence delivery and ACK. A runtime
opaque token binds display confirmation to only the represented IDs and maximum
issued sequence. Other or later unread records survive. False/rejected/slow delivery
does not block award writes or clear. The client confirms only after visible insertion,
without focus theft, and pauses its six-second dismissal during hover/keyboard use.
Lost batches never replay as live notices. A foreground unread summary now provides
explicit bounded confirmation; unsupported live usage scopes remain pending. Sharing
consent is still explicit.

`showAchievementNotices` is a default-on local presentation preference alongside
the full achievement switch. Disabling it does not retire producer evidence,
stop grants, delete unread records or spend a notice cooldown. A separate runtime
preference epoch retires queued reservations and ACKs, including rapid OFF→ON;
the visible client dismisses immediately and rejects stale notices until a saved
host render enables them. Re-enabling never replays missed popups. The settings
route updates only dashboard presentation, without restarting providers or scans.
This opt-out is excluded from the plugin-action achievement allowlist.

`achievementOverview.ts` now prepares read-only record projections: at most three
recent non-historical series, thirty recording-order rows and exact visible unread
level IDs. Recording order is not inferred attainment time, and projection eviction
does not remove awards. Automatic mode recommends at most three earned themes;
manual mode shows only the chosen pins, up to six, without automatic fillers or
changes to next goals. Closed-card pin controls and a searchable editor save
selection/order/mode under the shared lease. Bulk selection/reordering checks the
current pin revision so stale windows cannot replace peers' choices.
`setPinned` applies one idempotent intent under the
filesystem lease, rejects unearned keys, and never exceeds six slots or overwrites
a peer's unrelated pins. The record projection is now rendered with up to three
recent series and a folded thirty-row history. Each row keeps the exact public
level and first-record day/zone or an explicit historical unknown-date label;
clicks only open existing rules and never acknowledge records or select sharing.
The disclosure survives replacement. Earned badge details send one generation-bound
pin/unpin intent, accepted only by the ready foreground panel while achievements
are enabled. After a successful save, existing dashboard patches hydrate pressed
state and the showcase without modifying next goals or sharing. Stable control IDs
preserve focus/anchor; save failure preserves the old preference and uses fixed
localized inline feedback. A render failure is not reported as a failed durable save.
Disabled-source guards apply to pin acquisition, not to deliberate cancellation
of a known public key. A folded list exposes at most six hidden saved pins;
canceling one preserves peers' unrelated preferences under the same lease, without
provider activation, log reads, awards or read acknowledgement. Error dispatch
matches existing data keys, including hidden controls, without constructing selectors.
Removing a focused hidden-pin control uses up to two transient, existing DOM
focus descriptors: the management summary, then the achievement tab if the list
disappears. The surviving target supplies the scroll anchor; no preference or
client state is added. Acquisition rechecks source availability when the queued
transaction executes, not only when the message arrives.

The ready handshake now reports the actual restored provider/tab. The host accepts
only its current provider and allowed panels (compare has only `all`); ordinary
tab messages use the same allowlist. Restoration does not count a feature use,
change provider or grant/read an award. The unread display preparation selects at
most six exact non-historical unread levels from the complete bounded record
envelope, independently of the thirty-row history view. An unchanged represented
group retains its IDs and sequence when a peer adds an award; hiding, reading or
replacing a member retires the group. This pure projection copies rows and never
writes receipts. The folded New awards UI binds that group to an opaque runtime
summary token and document identity. Only an explicit confirmation from the same
ready, visible, focused achievement panel can enqueue a receipt. The host uses
its own exact IDs/maximum sequence, never client-supplied IDs, and rechecks enabled
sources, provider, clear epoch and packet identity at the lease commit boundary.
The fresh shared-file merge preserves peers' other and later unread awards.
Failure sends only fixed localized feedback; success adopts saved state before
patching, and a later render failure cannot pretend that durable save failed.
Group removal restores focus to its summary or the achievement tab. Viewing,
pinning and sharing do not read it. No additional timer, scan or persisted field
is introduced. Full document replacement, including patch-failure fallback,
renews the runtime document identity and retires old ready/tab/receipt messages;
ordinary data patches keep it. Blur/OFF/clear/disposal/provider/tab changes retire
group ownership rather than replaying missed notices.

就绪握手报告实际恢复的供应商／页签，宿主只接受当前供应商的合法页面；对比页
只接受 `all`，普通切页也使用同一白名单。恢复不计作功能体验、不切换供应商、
不授奖或确认已读。未读展示的准备投影从完整有界封套选择最多六个精确非历史
等级，不受三十条历史显示上限影响；其他窗口新增不扩大既有组的 ID／序号。
成员隐藏、已读或被替换后重新选组。只读投影复制记录，不写确认。
默认折叠「新增 N 项」使用运行期匿名组句柄及文档身份；只有同一就绪／可见／聚焦
成就页的明确「标记本组已读」才排队保存。共享 lease 提交边界再次复核来源开启、
供应商、清除代次及组身份，仅确认宿主保存的精确 ID／序号，不接受客户端任意 ID。
重读合并保留其他窗口后来新增；失败仅给固定本地化反馈，保存后的渲染失败不误报
保存失败。移除组后焦点回到摘要或成就页签；浏览／固定／分享不确认。
没有新增定时器、日志扫描或持久字段。完整文档替换及补丁失败回退更新文档身份，
拒绝旧页面就绪／切页／已读消息；普通数据补丁保留身份。失焦／关闭／清除／销毁／
切换供应商或页签退役组所有权，不重放错过提示。

关闭供应商只阻止新增固定，不阻止明确取消已保存的公开键。折叠入口最多列出六个
隐藏固定项，共享 lease 下仅移除选中项，不启用供应商、不读日志、不改变奖章、
未读及分享；错误反馈匹配既有数据键，兼容隐藏项按钮，不拼接任意选择器。
取消按钮消失时，焦点优先回到管理组摘要，列表消失则回到成就页签；最多两个
既有 DOM 描述符仅存于运行期，保留幸存锚点，不新增偏好或客户端状态。
排队保存前也复核供应商是否仍启用，避免请求发出后关闭供应商仍新增固定。

Explicit badge sharing can include retained earned records from a disabled provider.
The gallery and pin acquisition filter by enabled providers; retained records supply
neither current usage progress nor new grant authority. Sharing does not re-enable
the provider or read its logs.

Badge sharing keeps one accepted SVG plus an opaque runtime-only handle. Client
token/request counters reject superseded replies; a response may remove unavailable
selected IDs but never add badges. Restore reuses matching accepted bytes. Export
requires the same handle, ordered IDs and display language, and captures those bytes
before its single-flight save dialog. Success, cancellation and anonymous write
failure are acknowledged in the panel; a later language change cannot mutate an
already-started save. Removed choices are explained, never silently upgraded.
Replacing, clearing, disabling or closing the panel retires the retained
artifact. Build failures retire the old handle and return only an anonymous flag.

The legacy globalState ledger holds allowlisted rule IDs, 29 safe setting-key names
and four local-feature enums, a streak maximum capped at 48, and one qualified
four-week-average numeric maximum. It stores no setting values, account/source
identifiers, prompts, credentials, timestamps of actions, or export history.
Audit and recoverable migration state is exact-allowlisted in Clear All.
See [the complete inventory](LOCAL-DATA.md#local-achievements-250).

Claude materializes session-achievement evidence before the Sessions tab's
1,000-row display cap. Flat `projects/<project>/agent-*.jsonl` files have no
path-proven parent and are excluded only from that session-achievement evidence.
Record `sessionId`/`isSidechain` metadata is not promoted into an ownership contract.
Token totals, pricing, daily aggregates and visible session rows are unchanged;
nested agents keep the existing parent-directory contract. This runtime-only
filter neither changes source logs nor removes cached or saved awards.
Codex positive token/model/agent milestones require complete current manifest
indexing and independently verified canonical lineages. Identity conflicts block
only affected branches and descendants, not unrelated positive proof. Selection
and root resolution are iterative/memoized; invalid vectors, orphan/cyclic/unknown
roles and unsafe sums fail closed. Calendar selection uses the full-census ancestry
and runtime-witness contract above; only whole-census completeness authorizes zero,
four-week means and retained peaks. Positive-output UTC hours piggyback on normal parsing; existing
indexes use bounded checkpointable proof migration while preserving primary
totals. OFF suppresses that extra migration, not ordinary usage parsing.
The host keeps a separate runtime-only SHA-256 achievement proof revision:
canonical identities, six Token counters, model/effort buckets, period lineage
markers/cursors, runtime contribution witnesses and date buckets, plus independent
indexed/global-calendar/timezone fences. A proof-only change
updates achievement signals even when the complete dashboard render contract
is equal. Unchanged proof and display-only title/structural changes reuse the
signals; no second corpus, JSONL read, persistent key or timer is added. The
revision is streamed from existing aggregates and is never logged or exported.
OFF skips this projection and evaluation entirely and drops its cached proof;
re-enabling adopts current evidence on the next accepted snapshot. Source
replacement also retires the revision and signals. This does not retroactively
remove historical grants or make legacy period proof complete automatically.
Failed refreshes revoke new-grant authority without rerendering or discarding
last displayed statistics, including when auto-refresh presentation is paused.
Separate usage-evidence and clear/activity epochs guard queued writes; retired
providers cannot authorize a new grant. First-baseline reconciliation stays quiet.

Timestamp bounds for unbounded Claude project/session/branch/workflow histories
are calculated in one pass without argument spreading; project merges likewise
append entries individually. This avoids the independently reproduced 150k-row
V8 stack overflow without changing deduplication or numeric accounting.
Dense tool-result appends likewise add structural events individually: one tool
ID may have unbounded result envelopes, so array argument expansion is unsafe.
The 150k-result append regression matches full content analysis and retains
zero-body-read warm refreshes.
Claude refresh failures report only fixed phase/reason enums and actually
observed anonymous counters; unavailable counts/timings say `unknown`.
Read/parse, aggregate and content-analysis phases remain distinguishable.
No arbitrary exception name, message, stack or path is logged. Identical
sanitized phase/reason pairs are reported once per Extension Host lifetime,
bounded to 60 pairs; verified prior statistics remain authoritative.
A failed Claude revision admits automatic retries after 30/60/120/240/480 seconds,
then caps at 15 minutes; explicit retries retain a 5-second minimum cooldown.
This runtime-only gate uses a monotonic clock, holds one current revision and
adds no timer, scanner or persistent history. Source/price/parse authority changes
admit new work, while presentation settings, watcher bursts and queued follow-ups
cannot bypass it. Retired work cannot reset another revision's backoff, and only
verified index success restores ordinary warm-refresh cadence. Quota fetching
keeps its independent existing policy. Skipped manual retries still deliver
compact failure feedback without replacing verified usage or reading log bodies.
Primary Codex lineage depth ordering uses explicit DFS frames and one active-path
set. It preserves the prior memo-before-cycle, parent order, orphan and root
semantics without recursive calls, copied ancestor sets or parent-array argument
spreading. The persisted 10k-depth derived-reconciliation regression reads zero
source bodies; bounded small-graph oracle tests preserve accounting order. This
is separate from achievement evidence traversal and does not change index schema,
fingerprints, prefix subtraction or provider Token/cost/limit semantics.

Codex discovery is restricted to:

- `$CODEX_HOME/sessions/**/*.jsonl` and `sessions/**/*.jsonl.zst`
- `$CODEX_HOME/archived_sessions/**/*.jsonl` and `archived_sessions/**/*.jsonl.zst`
- default `$CODEX_HOME`: `~/.codex`

It never reads `auth.json`, SQLite databases, config secrets, keychains, browser
state, or unknown files. Raw paths/session/parent IDs stay in short-lived local
worker memory. Disk persistence contains machine-salted pseudonymous keys,
numeric per-day/model/effort/session aggregates, and the bounded neutral quota
history described above—never prompt, response, command, tool-argument,
raw-line, raw-path, account name, credential, or raw provider-label content.

In version 2.5.0, `.jsonl.zst` is lossless Zstd storage of the original
JSONL, not an LLM summary: a smaller disk file does not change its logged token
counts. Discovery rejects symlinks and non-regular files. Same-directory,
same-basename `.jsonl` wins over `.jsonl.zst`; the HMAC file key strips only the
final `.zst`. This canonical source selection makes no byte-equivalence claim.
Copies across active/archive areas still use the full-census lineage deduplication.
Sources are read-only and decoded plaintext is never written to disk.

Manifest `size`, parser cursors and migration offsets remain decoded byte
coordinates. Only compressed entries add `compression: 'zstd'`, `storageSize`
(physical bytes) and `storageCtimeMs`; `mtimeMs`/`dev`/`ino` also describe the physical
file. Schema 3 adds these fields and the persisted `compressionVerified: true`
marker without changing its version; old entries without them remain plain.
The marker requires verified frame EOF, not merely `offset === size`. Encoding or
physical-version changes force a targeted historical reread, including a same-inode,
same-size overwrite with restored mtime. A compressed move with changed fingerprints
also replaces the destination. Such reconciliation is quiet and creates no new
live-usage receipt.

For a deterministic body-decoding failure, a versioned `compressionFailure`
allowlisted code and physical fingerprint replace the entire provisional contribution.
No tokens, lineage, quota or calendar witnesses survive in that row. An unchanged
failed version is not decoded or checkpointed again and is not pending work, but
`failedFiles` and incomplete coverage remain visible. A physical/encoding change
invalidates the failure state; transient I/O, cancellation and source races remain
retryable. Unknown persisted failure versions force validation rather than authority.
Header discovery errors still fail the refresh and preserve the last-good snapshot.
Per-file quota observations are promoted into retained global history only after
compressed-frame verification, never from an intermediate draft checkpoint.

After verified compressed-frame EOF, a valid final JSON record without a newline
is parsed once. An invalid trailing fragment records `invalid-json`; an oversized
final line records `oversized-jsonl-line`. In each case the cursor advances to the
actual decoded EOF, so an immutable tail cannot cause repeated whole-frame replay.
These JSONL quality flags do not excuse frame corruption or establish complete
usage coverage. Active plain logs keep their existing unterminated-line behavior.

Discovery reads at most 18 header bytes through a read-only handle, checking fstat
identity/size against lstat and checking for mutation during the read. The codec
accepts one frame with explicit Frame Content Size (FCS) and no dictionary-ID field.
Malformed/unknown-size input, damage, extra frames, trailing bytes or size mismatch
fail explicitly; a header alone never establishes body validity or completion.
Hard ceilings are 4 GiB decoded data, 4 GiB replay prefix, 2 GiB physical data and a
64 MiB window. Decoding uses [Node's native Zstd API](https://nodejs.org/api/zlib.html#zlibcreatezstddecompressoptions),
available from Node 22.15.0 on the 22.x line and 23.8.0 on the 23.x line, with no new
dependency. Capability is checked in the actual extension host; an unsupported
host reports the error and retains the last verified snapshot rather than claiming
completion.

An unchanged, fully verified compressed version needs only metadata/header checks
on a warm refresh, with zero body decompression. Resume replays from the frame
start to the decoded cursor; discarded prefix bytes count toward work and remain
cancellable. At most the first historical compressed file in a refresh may exceed
the soft byte budget within codec hard caps, avoiding perpetual deferral. These
backfills use at most two file-pass workers when compressed sources are present.
The numeric index remains rebuildable, not a backup: truly removed sources lose
their contributions; remaining compressed/archived representations are reconciled.
These are implementation contracts, not evidence of native recovery or acceptance.

Advice starts from materialized aggregates rather than rereading JSONL or
walking retained records. Aggregate-only is the remote default. Prompt samples
and optional user context have a separate explicit consent and must appear in
the exact request preview. The host keeps the prepared object and API key; the
webview receives only the preview and an opaque handle. A second click sends the
same byte object to the configured BYOK endpoint. Feedback, comparable pairs,
and comparison envelopes remain local and accept no prompt, response, path,
session, title, endpoint, or credential field.

The preview includes the resolved HTTP(S) destination, API format and model.
Normalization may append a protocol path but never changes the configured host
or proxy prefix; incompatible direct-provider paths fail closed. URL credentials,
query parameters and fragments are rejected before preview to prevent secret
disclosure. A private WeakMap seal binds all metadata and the original byte object;
public hash recomputation cannot authorize rerouting. Ordinary settings reset
preserves SecretStorage; separately confirmed clear-key controls own deletion.
Secret initialization also completes a one-time advice-format migration before
activation can expose the key. An existing key without an explicit state/legacy
configuration format pins the prior Anthropic default; legacy configuration is
read only before the generic settings migration, never resurrected after reset.
Explicit formats are preserved and new keyless installs use OpenAI-compatible
defaults. The bounded
`ccu.migrated.adviceDefaultFormat.v2.4.1` enum stores only this compatibility
default, not a key, account or endpoint, and survives ordinary defaults reset.
Incompatible endpoints fail before preparation; a failed migration clears loaded
keys for that activation, retaining the recoverable SecretStorage value. The
explicit clear-all allowlist and value-free inventory include the enum marker.

中文：AI 预览包含最终地址、API 格式和模型，地址规范化不更换主机或代理前缀。
不匹配的协议及含凭据、查询参数或片段的 URL 在预览前拒绝；私有完整性快照绑定
目标信息和原始请求字节。恢复默认设置不删除 SecretStorage 中的密钥。
激活前完成协议兼容迁移：已有密钥且未明确设置协议时保留旧 Anthropic 默认，显式设置
不变，新安装采用 OpenAI 兼容默认。枚举迁移标记只保存兼容协议，不含密钥、账户或地址；
旧 VS Code 协议配置仅在首次通用迁移前读取，迁移后恢复默认不会重新导入过时设置。
普通恢复默认保留它，确认清除全部派生数据才清除。迁移失败使本次 AI 功能无可用密钥，
不删除可恢复的 SecretStorage 密钥，也不阻断用量页面。

Advice consent changes invalidate prepared handles immediately. A host-side
pending-write counter blocks new previews and sends until every queued consent
write settles; failed persistence stays closed. Aggregate/prompt revocation also
cancels active advice transports through the existing network owner, separately
from user-draft Optimizer calls. Cancellation cannot recall transmitted bytes.

The machine salt lives in VS Code `globalState`, not in the index file. Worker
progress/results/errors and diagnostics contain anonymous counts and timings,
not paths or identifiers. `refresh:` diagnostics include the bounded trigger,
Claude-watcher/coalescing counters, and the count of quota-watcher events for
which the operating system supplied no filename. `codex-index` diagnostics add
the actual refresh trigger, watcher/debounce counts, historical-backfill mode,
and foreground/background worker profile; generic failure paths use `unknown`
rather than infer a mode that was not observed.

Sharing previews are produced from already materialized aggregates.
Share Card preview/export uses one provider-lifetime immutable SVG plus an opaque
preview ID and canonical allowlisted configuration key. Control changes require
a new accepted preview; stale replies cannot accept a newer draft. Export captures
the exact accepted SVG before opening the asynchronous save dialog. This cache
does not retain a history of artifacts or perform network/log reads.

中文：分享卡在运行期仅保留一份已接受的 SVG、匿名预览 ID 与允许字段配置摘要。
修改控制项后须重新预览；过期回复不会恢复导出权限。导出在保存对话框之前捕获已确认
的 SVG，不重新生成不同内容，也不保留产物历史。

The heatmap config allowlists `provider=claude|codex|both` and
`metric=tokens|apiEquivalent`. Amounts require `showAmounts=true`; otherwise it
normalizes to Tokens. `apiHeatmapDaily.ts` locates the interval with logarithmic
date-key lookup in existing descending daily arrays and projects only selected
payloads. The caller supplies civil-day bounds/timezone; it never re-buckets days,
reads retained records, recomputes old daily/model cost scalars or calls an API.
For selected Claude model rows only, `getCurrentEstimatePricing` checks existing
in-memory rates, memoized once per model per projection. The generic unknown-model
Sonnet fallback cannot supply known coverage; a missing required component rate
is unpriced, an explicit zero is valid, and partial coverage counts known components.
Runtime/family rates remain estimates. The legacy 1-hour-to-5-minute cache estimate
is not a frozen-book definition. General cost accounting is unchanged. At most
366 dates are materialized. Equal duplicate rows deduplicate; conflicting rows withhold money
and retain the largest observed Token bound, never add duplicate totals.

Amounts are current floating daily estimates, not achievement reference money.
Claude keeps current backend/fallback/override estimates; Codex keeps exact known-
model-priced Token subsets. Empty/missing days, unpriced activity, partial pricing
and genuinely priced zero remain distinct. Incomplete source coverage is explicit;
a priced subtotal is a lower bound, not a complete total. Both renders separate
Claude/Codex amount blocks and never computes a joint monetary total. Hiding amounts
restores Token colors, labels, titles/tooltips, metadata and Markdown; Token mode
does not access rates or daily money/quality getters. The renderer's identity contains only
whitelisted config, numeric quality, source/pricing/display revisions and bundled
currency metadata; internal signatures are not exported.

The host retains one accepted immutable artifact with an opaque preview ID,
document identity and materialized source references. Control changes retire it;
request sequence and document checks reject old responses. Source, pricing,
timezone, locale/currency/display changes invalidate acceptance. Monetary previews
are unavailable during pending repricing. Export requires the current visible,
ready document and rechecks acceptance before and after the single-flight save
dialog, then writes the accepted SVG bytes without
rebuilding. Markdown copying also requires the accepted artifact. No second corpus,
export history, authentication or network path is introduced.

`showWeeklyQuotaPace` is a default-false STATE setting shared by Claude and Codex.
With it off, the owner exits before source getters, clock/cache/client access or
projection; enabling it does not enable quota tracking. On consumes the existing
successful raw cache, original `observedAt` and existing verified request-account
HMAC signal in memory, never profile/home/window labels as account proof. The
runtime source owner preserves original metadata per response and checks numeric
counter/reset/window continuity across toggles. Changed account/source, drops or
unexpected resets latch distrust until a verified ordinary seven-day rollover;
repainting or a restored high counter does not clear it. Current Codex local-log
snapshots always carry unknown account trust, so their forecast is unavailable.

The pure formula uses start = reset − seven days, reference = elapsed fraction
at the original observation, forecast = used fraction / elapsed fraction. Thus
29% used at 25% elapsed forecasts 116%, and deviation is +4 percentage points.
It describes account-wide cycle-average consumption, including other devices or
members. The first six hours show insufficient sample; after thirty minutes of
staleness or reset, the forecast is withdrawn. A zeroed successful-cache time on
credential invalidation withdraws it immediately. Existing refresh callbacks
deliver a minimal document/provider-bound host patch even with dashboard auto-
refresh off; the client performs no optimistic forecast repaint. No new request,
timer, historical scan or persistent state is added. Dashboard and status-bar
tooltip share eight-locale `weeklyQuotaPaceCopy`; bar text/custom formats are unchanged.

The gallery toolbar precedes showcase/overview. Small/Medium/Large set collection
emblems to 56/80/112 px and showcase emblems to 56/72/96 px, retaining text size and
click areas. Saved pin errors appear near the requesting controls; disabled or
removed controls fall back to a stable summary. Existing browser gallery/API checks
exercise these surfaces, but do not validate native/F5, new VSIX or performance.
The stylesheet contract checks all 47 used VS Code variables against each matching
registered fixture theme, treating registered null colors as CSS `initial`.
The unregistered pink-variable reference now uses its exact existing endpoint
`#d16ba5`; this is no palette/appearance change or broader visual redesign.
Automated checks do not replace the user's subjective appearance review.

Above 960 px, the shared renderer uses a content-sized badge column capped at
`2 * --achievement-overview-width + 8px` and a next-target column that fills the
remaining space, with a 16 px gap. This avoids reserving an empty half-width column
for one badge. At 960 px or below they stack directly with a 12 px gap. Auxiliary
history sections follow both. `achievementUiIcons` supplies decorative inline SVG
icons beside existing localized share/settings/filter/size/editor/info labels;
summary counts use compact chips. This presentation change preserves control IDs,
persistence, eligibility and host/client message protocols. Early-data evidence
remains under investigation; this layout change establishes no data fix or new
runtime/native acceptance result.

Pending/stale card details use all eight I18n locales to explain calendar,
model-ownership, money and current-source requirements, with an information icon
on notes; these are scope requirements, not exact root-cause classifications, and
expose no raw source/error details or new evidence authority.

`extension.ts` returns early only when `codexWorkerCancellationRequested` is
true, the outcome is `error`, `failureCode === 'cancelled'`, and
`result.diagnostic?.failedFiles === 0` exactly; a missing count remains unknown
and follows failure/revocation behavior. This zero-count check is defensive:
the current producer reports `failedFiles: 0` for terminal cancellation/throws
because final per-file diagnostics are unavailable. It does not prove that no
files failed before cancellation. The host ignores this cancellation result:
no snapshot application, success timestamp or new acceptance receipt; the prior
failed state and last successful time remain intact. Processing resumes after a
fresh successful scan. The interrupted result authorizes no new awards; subsequent
history-only reconciliation remains import-only, without live dates or notices.
`codexProvider.ts` marks every error result's manifest incomplete. Reported nonzero
or missing failed-file counts, other errors and unowned cancellations retain
failure/revocation behavior. A hypothetical nonzero cancelled result tests the
host's defensive branch, not a failure census supplied by the current producer.

Valid period-migration checkpoints now resume even when `tokenEventsSeen` is below
the inherited prefix, provided `days` is empty. The bounded cursor advances across
passes, persistence/restart and cancellation. Resuming does not promote dates:
promotion still requires the complete prefix, EOF and current-timezone witness
checks. Reviewed regressions cover batching, persistence, cancellation, negative
EOF cases and unchanged warm reads of zero bodies. Undated, oversized and
conflicting evidence remains conservatively pending; this correction does not
resolve every missing date.

Combined activity adds Claude processed volume to Codex processed volume only for the
explicit activity visualization; Codex cached input and reasoning subsets are
not added twice, and no cost, quota, capability, or productivity equivalence is
claimed. The Claude Share Card and Claude heatmap remain Claude-only. Local
preview/export performs no network request and has no GitHub authentication,
profile, avatar, or name lookup. Claude heatmap publication is a distinct
explicit action and keeps the public-repository probe plus exact branch/path and
create-or-overwrite confirmation described in the local data contract. A
successful remote write is authoritative; its exact result is reported even if
the single versioned destination-preference object cannot be persisted.

### Schema 3 index contract

Schema 3 uses source-scoped `globalStorage` files
`codex-index-v1-<HMAC>.json`; the HMAC binds the resolved Codex home, profile-local
machine salt, and configured timezone. VS Code profiles may share the extension's
global storage directory, so a write lease alone cannot isolate their sources.
The old `codex-index-v1.json` is read-only migration input. A worker adopts it once
under scoped-then-legacy leases only if every saved file key is proven by the
current allowlisted metadata manifest with the same salt. No unchanged JSONL
body is reread; unprovable ownership, deleted keys, malformed data, or oversized
legacy input fail closed without modifying the old file. Root quota history in
that formerly shared container is not trusted; only proven per-file observations
are adopted. Already migrated P2 history stays independent.

When a timezone-scoped target is absent, the worker can read a complete sibling
checkpoint proven by both its source/salt filename and the current manifest.
It examines at most 16 recent candidates within a shared 256 MiB read budget,
pins each atomic file through an open handle, and never locks or modifies a
sibling. Primary usage stays indexed; existing targeted period/hour migration
handles timezone-sensitive buckets. Existing targets, even empty rebuild
checkpoints, take precedence; otherwise fixed legacy adoption remains the fallback.

Rebuild clears only the active scoped family and installs an empty schema-3
checkpoint to prevent legacy resurrection. Inventory and explicitly confirmed
Clear All cover exact canonical, recovery, and interrupted-write families in
this extension storage directory; locks, lookalikes, and source logs are excluded.
No source path, salt, or namespace fingerprint reaches diagnostics or exports.

中文：schema 3 按 Codex 日志目录、本地配置盐和数据时区的 HMAC 隔离缓存。
VS Code 配置可能共用扩展存储目录，写入锁不能替代来源隔离。旧单文件只作为只读
迁移输入；当前白名单元数据清单须证明每个文件键归属，才在双锁内沿用，不重读未变
日志。无法证明归属、已删除的键、损坏或超大旧输入不沿用，也不修改旧文件。旧共享
容器的顶层额度历史不可信，只接收已证明归属的逐文件观测，独立 P2 历史不清除。
新时区目标不存在时，可只读沿用文件名与当前清单均证明属于同一目录／盐的完整
兄弟检查点。最多检查 16 个较新候选，共享 256 MiB 读取预算，通过打开句柄固定原子
文件，不锁定或修改兄弟输入。主用量保持已索引，日期／小时由现有定向迁移补算。
已有目标（包括空重建检查点）优先；否则仍回退为旧单文件迁移。
重建只清理当前文件族并写入空检查点防止旧缓存复活；清单与明确确认的全部清除覆盖
当前扩展存储中的精确索引文件族，不处理锁、相似文件或源日志。不外传路径、盐或来源指纹。

Its persisted DTO is an explicit allowlist of numeric
aggregates, enum values, pseudonymous keys, cleaned labels, and opaque
fingerprints derived only from numeric token-counter vectors. A v3 file never
stores a raw incomplete line or a carry buffer. The only reader for those old
fields is the explicitly named legacy schema-1 migration boundary; it discards
the carry before the v3 index is saved. Schema-1 and schema-2 indexes are marked
for a bounded lineage rescan; their prior totals are not retained and added to
the rebuilt result. A schema-3 container whose per-file parser state predates
exact-request semantics is also reset once, so incompatible aggregates are
never mixed. The parser state may persist only bounded numeric total-plus-last
signatures keyed by machine-salted pseudonyms, plus the immediately preceding
numeric signature.

Each physical rollout locks its first reliable session and tree identity. An
ordered numeric-event fingerprint trace then finds the copied prefix of a child
inside its verified parent while retaining every independent sibling suffix.
Nested forks and separate fork epochs apply their own prefix once. If the
reported parent is absent, the child stays conservatively counted in full and a
visible `missing-parent` quality warning replaces silent subtraction. Counter
regressions still emit exact last usage with partial confidence; the cumulative
fallback uses component high-water containment and never creates negative
deltas or counts a reset gap again. A verified ordered overlap for the same
pseudonymous session across active/archive copies is likewise counted once,
while conflicting identity metadata still keeps identity coverage incomplete.

There are two separate truth layers. The all-time view is built from the
verified aggregate of canonical file contributions. Time-bucketed period slices
are promoted independently, so a partial migration cannot overwrite, inflate,
or stand in for that all-time verified aggregate. Period coverage is anchored by
the target-zone `asOfDay` and reports separate 7-day, 30-day, and all-time
states. The 7/30-day views sum events in their natural calendar days; they do
not pull an entire older session into a range merely because the session's last
activity falls inside it.

The rolling 30-day hourly index is an additive schema-3 sidecar, not a third
source of all-time truth. A file becomes eligible only after duplicate
classification selects it as canonical and its verified period slice intersects
the configured civil-day window. Per-file hourly promotion and in-progress
cursors are checkpointed, so cancellation resumes from the verified offset.
Day 31 is evicted as the window advances. A timezone change requests one
targeted migration. This path neither invalidates the primary aggregate nor
triggers an unrelated full-history reindex.

Identity is also a coverage contract. Git SCP-style SSH and HTTPS repository
URLs are canonicalized to the same repository identity where their host/path
matches. Root titles use the latest trusted `updated_at` title, subagents retain
their reported nickname plus parent title, projects prefer the canonical
repository name over a directory fallback, and recent-task ordering uses the
maximum activity observed across a complete lineage. A strictly exact
active/archive pair is deduplicated only after both copies are verified and
their safe signatures agree; any other repeated session is ambiguous and keeps
identity coverage incomplete rather than guessing. This stable ambiguity is a
data-quality state, not unfinished I/O: once base and required period coverage
are complete, it no longer leaves the dashboard labelled as still indexing.

The five structural call proxies are `patchCalls`, `toolCalls`,
`postPatchToolCalls`, `compactCount`, and `taskCompleteCount`. They describe
observed structural envelopes only, not file, command, or review counts. They
produce no dollar cost and are never derived from prompt, response, command
body, or tool-argument content.

## Refresh and scale

Claude polling always honors `refreshInterval`; its file watcher uses the
configured quiet debounce. The production Claude path maintains an in-memory
per-file index: unchanged refreshes read zero JSONL bodies, and an ordinary
verified single-file append starts with its tail and affected aggregate groups.
With content analysis enabled, unsafe truncate/replace/move/delete and source-order
or UUID ownership changes may require a wider ordered replay as described below;
they are not guaranteed to read only the changed file. Content-analysis contributions
and the established cross-file response-identity rules use the same atomic path.
Content analysis keeps a process-local materialized accumulator. Its cutoff is
the same continuously rolling millisecond cutoff used by `ClaudeDataLoader`, not
a local-midnight approximation. Both loaders use the shared exact-cutoff helper;
the full loader captures it once for content analysis and calibration, so a
clock advance during parsing cannot give those contributions different windows.
Per-file oldest-admitted timestamps and the
oldest calibration record act as frontiers: moving the cutoff between frontiers
changes no result and needs no body read, while whole retained or expired files
can be rebased from metadata. Crossing a frontier reparses the affected boundary
and any UUID claimant whose first-owner status may change.

Completed malformed JSONL lines are stable ignored input and therefore do not
invalidate cutoff metadata or cause repeated body reads. An incomplete JSON
fragment remains behind the safe cursor, while a syntactically valid JSON value
at EOF is accepted even without a final newline; a later append must first
preserve that record boundary. If content analysis is disabled, a timezone
change may rebucket ordinary usage in memory, but re-enabling analysis rebuilds
all day-sensitive analysis contributions before any result is published. This
also covers DST transitions rather than copying stale day keys from the former
zone.

An ordinary single-file append first reads only the verified tail, applies the
changed-file delta, and recalibrates only affected canonical response identities.
Aggregate buckets use transaction-local copy-on-write ownership: each touched
bucket is copied once, not once per record/model label. Previously published
snapshots remain immutable. Provider UI synchronization failures are reported
at most once per Extension Host lifetime. They cannot stop Codex provider work
or reject its refresh drain, prevent Claude from committing an otherwise
verified index after a failed new-snapshot render, or strand either refresh gate.
Numeric-only structural summaries preserve the legacy accumulator's global
`tool_use` → `tool_result` map and Skill-preamble attribution across file
boundaries; warm appends replay only touched tool IDs. Duplicate UUID membership
uses at most 64 immutable layers, and a direct first-owner map decides whether a
touched UUID can stay incremental without searching every later file. An
occasional O(U) compaction replaces rebuilding the full UUID set on every append.
If a tail preempts a later UUID owner, the provisional result is discarded and
analysis is rebuilt in the loader's complete file order.

That canonical order retains the bounded timestamp probe itself: a file with
more than 1 MiB of completed timestamp-less prefix keeps the loader's neutral
timestamp and discovery rank even if full parsing later encounters a timestamp.
A relative `discoveryIndex` change among timestamp ties is likewise treated as a
semantic reorder. New/replaced files, multi-file appends, moves, deletes,
backward cutoff movement, and an append that gives an ordinarily undated file
its first probe-visible timestamp use the same correctness-first ordered rebuild.
Per-file Skill candidates retain numeric matching-result evidence; the global
5,000-use cap and any earlier-file displacement are applied only during ordered
materialization.

The slow materialization path is O(F + A + R) in memory (files, retained analysis
state, and calibration records). Cutoff-only work reads boundary/claimant files;
source-order changes may reread the complete corpus to re-establish first-owner,
prompt-order, and skill-cap semantics. The public result still materializes its
established records array, but content calibration no longer creates a second
all-record copy. A new Extension Host performs one cold in-memory build. Codex
uses its own quiet debounce (default 30 seconds, configurable to
Off/10/30/60/120/300).
Claude log, Codex log, and Claude credentials-directory watchers all treat
`fs.watch` as an acceleration path: asynchronous watcher errors close the
affected handle and use capped exponential re-arming while polling remains the
fallback. If a failed credentials watcher retries while its profile directory
is temporarily absent, the same bounded chain continues only while the window
is focused and quota tracking remains enabled; recreating the directory restores
one watcher. A filename omitted by the operating system is accepted only by the
credentials watcher, where the event can represent an atomic credential-file
replacement and is counted anonymously for diagnosis.
Claude directory discovery has a separate setup generation from the installed
watcher generation. A redundant same-directory setup leaves installed event and
error callbacks live; a newer lookup supersedes an older lookup. Closing the
watcher invalidates both pending discovery and retired callbacks, so stopping on
blur, disabling, source change or disposal cannot be undone by a late lookup.

Codex history is designed for multi-gigabyte local corpora:

- discovery and parsing run outside the Extension Host in a worker;
- files are indexed recent-first with progress and cancellation; an incomplete
  backfill uses up to half of the available logical CPUs, capped at six local
  file-pass workers (at most two if compressed sources are present), while
  completed indexes return to the single low-power coordinator path;
- the ordered file-pass apply frontier admits at most twice the worker count
  of in-flight, buffered and applying results together (at most 12 for six
  workers). A slow file/checkpoint backpressures idle workers instead of
  retaining the entire batch; ordering, cancellation and resume stay intact;
- unchanged warm refresh reads no JSONL body;
- a first non-empty index or incomplete legacy migration gets one bounded
  16,384 file passes / 64 GiB streaming ceiling; this is not an up-front memory
  allocation and retains cancellation and atomic resume checkpoints. After
  convergence, automatic work uses 64 file passes / 128 MiB and the
  always-visible manual Refresh uses 512 file passes / 2 GiB. The safe minimum
  is 1 MiB + 1 byte, reads use 1 MiB chunks, and a Codex JSONL line is capped at
  1 MiB;
- live progress remains frequent, while a large persisted snapshot is written
  at most roughly every 10 seconds, 2 GiB, or 256 completed file passes, plus
  the final stage boundary. This bounds crash recovery without letting repeated
  tens-of-megabytes snapshots dominate a fast backfill;
- derived lineage is reconciled only in stages that can change it; period and
  stable stages reuse the verified relationship instead of repeatedly scanning
  the complete index;
- rolling 30-day hourly work is limited to canonical files already known from
  period slices to intersect the configured civil-day window; its own
  checkpoints resume independently, evicts day 31, and does not reset the
  primary index;
- append refresh reads only the new tail; an incomplete line stays only in the
  scanner's short-lived memory and is retried from the safe cursor, never in v3;
- truncation/replacement reparses only the affected file;
- cancellation checkpoints atomically save per-file contributions and migration
  progress, so the next run resumes from the verified cursor;
- an Extension Host single-flight owns the complete Codex provider lifecycle,
  not only the worker call. A trigger burst runs the current request and at most
  one follow-up carrying the strongest pending trigger; every caller awaits the
  same drain. Failure releases the gate, while disposal or local-data clearing
  drains pending state without starting more provider work. Index teardown adds
  a synchronous suspension fence before its first await, so queued refresh work
  cannot recreate the index while a clear or rebuild is active. On the success
  path the fence remains raised until the replacement provider is installed; a
  lifecycle failure unwinds it with the original error instead of wedging all
  future refreshes.

Quota history is populated opportunistically by those same JSONL passes. An
older complete index may receive one metadata-only seed from its already saved
last-observed limit, but there is no second quota scanner, timer, network poll,
or credential lookup. Once that seed is present, an unchanged warm refresh
continues to read zero usage-record bodies.

Historical work also has a small durable control state: measurement version,
reason, progress, failure streak, next eligible time, and pause reason. Progress
continues immediately after success. Failure or no progress applies backoff, so
ordinary refresh/watch/focus events cannot restart the same stalled migration.
The resource registry records who created every timer, watcher, worker, network
request, and backfill, and releases a lease only after its real stop callback
finishes. A bounded first-index backfill may continue after focus loss for
first-use latency, but extension disposal, provider disable, or explicit
cancellation still owns its termination.

A completed control state is reopened when a verified snapshot becomes incomplete,
even without a generation change or corruption marker. User pauses and failure
backoff are preserved. Refresh failures expose only fixed allowlisted error codes,
not arbitrary error messages, paths, or stacks.

中文：已完成状态遇到已验证覆盖率回退时重新补齐，不要求代次变化或损坏标记；
用户暂停和失败退避仍保留。失败诊断只记录固定白名单错误代码，不记录原始报错、路径或调用栈。

The opt-in `tests/perf/measure-codex-worker-lifecycle.cjs` diagnostic runs the
compiled production coordinator/file-pass workers against a fresh synthetic
home, index and lease directory. Three rounds request achievement-hour backfill
ON/OFF, exercise an explicitly incomplete legacy period projection, perform
20 zero-body warm refreshes per group, then dispose during an active request.
The flag is a backfill request, not a full achievement/UI switch; older cohorts
may not implement it. It observes worker exits, process-wide RSS (shared by
threads), sampled per-isolate heap/external usage, and V8-serialized message
byte proxies without retaining messages or heap dumps. Frozen resource/time
guards stop only test-owned workers. `--out` can select an immutable compiled
cohort for comparisons. These are Node diagnostics, not native Extension Host,
panel lifecycle, multi-window or Windows OOM acceptance evidence.

Native diagnostic setup has a separate opt-in safety guard in
`tests/native/isolation.cjs`. It derives ten distinct test-owned directories,
including explicit user/extensions/shared and agent stores plus synthetic
Claude/Codex homes. Before any seed write, it checks Test mode, actual
Extension Host storage/configuration paths and symlink-free owned paths.
Only then may its caller seed quota/advice/network-related settings in that
test context's globalState before production activation; settings.json alone
does not control settings whose catalog storage is globalState. A failed seed
write stops setup. Pure `nativeTestIsolation.test.ts` checks do not launch Code.
The guard is not a sandbox, a credential scanner, proof of native activation,
or an installed-VSIX/F5 smoke test. Test files remain excluded from the VSIX.

tests/native/prepare.cjs can stage unchanged compiled modules and assets/ in a
fresh temporary root with six bounded synthetic logs. Its test-only main first
runs the actual-context guard, then activates the production extension; the
native runner exercises real API refresh/panel/dispose behavior. Explicit CLI
options additionally select in-memory SecretStorage and disable recent-folder
entries, crash reporting and experiments. Preparation tests never launch Code.
This small development-host diagnostic is not the final packaged VSIX, pixel
acceptance, manual F5, long soak, multi-window or Windows evidence. See the
helper README for normal-state before/after and background-launch requirements.

Weekly API-equivalent history is derived from already-aggregated token usage.
The newest valid reset observation anchors non-overlapping seven-day display
buckets; without one, usage-only history uses Monday-to-Monday UTC calendar
weeks. A real utilization sample can support a full-window estimate, including
for historical buckets. For Codex, the account-wide `codex` series is allowed to
use all eligible local files in the same home because file keys are not account
identities. A reset that drifts from the seven-day grid is mapped by observation
time to the corresponding display bucket; source uncertainty, reset drift, and
daily slices crossing a boundary lower confidence and are rendered as an
approximation. Each usage row still contributes to exactly one bucket.

For each eligible in-window observation, the candidate uses the already-priced
local usage through that observation, not all usage through the current time:

```text
candidateFullEquivalent = pricedUsedEquivalentThroughObservedAt / usedFraction
```

Only positive local amounts and `0 < usedFraction <= 1` produce a candidate.
Multiple candidates use an evidence-weighted median, considering pricing coverage,
observation confidence/account attribution, boundary flags and observation timing.
The current window may show a low-confidence local estimate even when account
attribution is uncertain: eligible Codex usage from the same local home/window is
compared with the latest applicable quota-observation cluster, not allocated to
individual accounts. Current overlapping/competing series force low confidence.
Only completed Codex display windows with multiple distinct mapped `seriesKey`
values withhold total/unused inference; a single unattributed or account-ambiguous
series can still retain a low-confidence estimate after completion.

With a valid aggregate candidate, displayed full equivalent is at least the
current priced used equivalent; unused equivalent is their non-negative difference.
If cumulative known used value exceeds the aggregate candidate, retain used value
as a low-confidence lower bound and withhold unused value rather than fabricate
zero. This compares the cumulative amount, not just post-observation additions,
against the weighted-median candidate, not one sample. With no valid candidate,
show used value only. Full/unused values are
API-equivalent estimates, not money paid, an official account balance or a promise
of remaining subscription usage. This is not the elapsed-time prediction in
`showWeeklyQuotaPace`, whose trusted-account/window rules are unchanged.

The maintainer's 2026-10-11 decision preserves this existing current-cycle
estimation behavior. Accurate per-account attribution belongs to future
multi-account compatibility; it is not implemented or promised by version 2.5.0.

v2.3.0 does not infer a $20, $100, or $200 subscription tier. Local Codex logs
do not expose a reliable account-and-plan identity, so a future comparison must
use an explicit opt-in account mapping rather than attaching prices by guess.

## Release invariants

- Default to **Squash and merge**: keep local development commits and their
  validation evidence during implementation, then land one squash commit per PR
  on `main`. A normal merge requires an explicit maintainer exception. Do not
  rewrite published Git history to retrofit this policy.
- Strict TypeScript, red-green TDD, full `node:test`, F5 smoke test, and installed
  VSIX smoke test are required in proportion to the change.
- The canonical CI browser gate uses four isolated shards, one worker per shard
  and a 35-minute timeout per shard. The stable `UI Test` aggregate runs with
  `if: always()` and passes only when all shards succeed; failed, cancelled or
  skipped shards fail closed. `Node Tests` and `Release Package` keep their check
  names, and packaging depends on both Node and aggregated UI success. This
  configuration is not evidence that a particular CI run has passed.
- User-visible strings cover `en`, `de-DE`, `zh-TW`, `zh-CN`, `ja`, `ko`,
  `pt-BR`, and `id`; all nine README files (the main page plus eight locale
  editions) move together.
- Dormant preparation/experiment modules and review-only v2.3.1 documents stay
  unreachable from the production command graph and are excluded from VSIX.
- `package.json` is not manually version-bumped. Publishing the reviewed Release
  Drafter draft creates the tag; the publish workflow stamps that tag version.
- Contributor PR attribution is preserved by merging the contributor's original
  PR or, with authorization, adjusting that PR branch before merge.
