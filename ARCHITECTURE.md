# Architecture

> A concise map of the extension's provider boundaries, data flow, and usage
> semantics. Update it whenever module ownership or provider behavior changes.
> A faithful Simplified-Chinese companion lives in
> [`ARCHITECTURE-zh-CN.md`](ARCHITECTURE-zh-CN.md).
> The normative persistent-data inventory, retention, migration, clearing, and
> network boundaries live in the bilingual
> [`v2.3.1 local data contract`](docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.md).

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

- Claude: exact local token buckets, model pricing estimates, and Anthropic
  OAuth 5-hour/weekly quota.
- Codex: local processed/fresh/cache/output/reasoning metrics, model and
  effort breakdowns, thread structure, index coverage, quality flags, and
  structural optimization guidance. Known models also receive a clearly
  qualified API-equivalent cost estimate; it is never a bill or subscription
  charge, and unknown models remain unpriced.
- Compare: side-by-side compatible metrics only. It never sums provider cost,
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
| `dataLoader.ts` | Claude parsing, validation, attribution, and content-analysis primitives retained for exact compatibility. |
| `claudeIncrementalIndex.ts` | Production in-memory per-file Claude index: append-tail parsing, exact cross-file response deduplication, affected-group aggregation, content-analysis contributions, and materialized dashboard rows. |
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
| `providers/codex/codexIndex.ts` | Schema-3 persistent per-file numeric aggregates and replay evidence, bounded cold/tail parsing, independent aggregate/period/rolling-30-day-hour coverage, and atomic save/load. |
| `providers/codex/codexQuotaHistory.ts` | Small account-neutral weekly reset-observation cache; compacts repeated local samples without retaining credentials, account names, or raw labels. |
| `providers/codex/codexIndexWorker.ts` / `codexIndexClient.ts` | Background coordinator, recent-first progress, cancellation, resume, checkpoint persistence, and single-flight client. |
| `providers/codex/codexFilePassPool.ts` / `codexFilePassWorker.ts` | Adaptive bounded local pool for independent per-file main, lineage, period, current-day, and identity passes during incomplete backfills. |
| `providers/codex/codexProvider.ts` | Extension-facing Codex snapshot facade and partial/unavailable/error outcomes. |
| `providers/codex/codexUsage.ts` | Codex calendar-Today/hourly, 7-day, 30-day, monthly, task, and project view-model aggregation with exact-model API-equivalent cost. |
| `providers/codex/codexInsights.ts` | Deterministic structural usage guidance; no prompt/body inspection. |
| `codexView.ts` / `codexViewComponents.ts` | Codex localized-copy and default-provider contracts; no HTML renderer, client script, or CSS ownership. |
| `settings.ts` | Canonical `SETTINGS` catalog and `SettingsStore`; ordinary values use configuration/globalState, while BYOK credentials use SecretStorage and never enter Webview snapshots. Do not scatter direct reads. |
| `statusBar.ts` / `codexStatus.ts` | Provider-specific status presentation and generic Claude quota formatting. |
| `webview.ts` | Single provider-aware Claude/Codex dashboard shell, shared render functions, shared client behavior, provider tabs, Compare presentation, and the unified sharing workspace. |
| `i18n.ts` | All user-facing copy for all eight UI locales. |
| `types.ts` | Shared extension and Claude contracts. |

Existing pure modules such as `quotaFormat.ts`, `dateKeys.ts`, `shareCard.ts`,
`heatmap.ts`, `conversationLog.ts`, and `miniMarkdown.ts` keep their current
ownership and tests.

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

materialized Claude + Codex daily aggregates
  ──> unified sharing selector ──> combined activity preview ──> explicit local SVG/Markdown export
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

The sharing workspace is rendered once: in Compare when both providers have
data, otherwise as a Claude All-time fallback. `enableShareCard` is the only
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
request-id client action, the Webview verifies deletion of the eight allowlisted
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

Codex discovery is restricted to:

- `$CODEX_HOME/sessions/**/*.jsonl`
- `$CODEX_HOME/archived_sessions/**/*.jsonl`
- default `$CODEX_HOME`: `~/.codex`

It never reads `auth.json`, SQLite databases, config secrets, keychains, browser
state, or unknown files. Raw paths/session/parent IDs stay in short-lived local
worker memory. Disk persistence contains machine-salted pseudonymous keys,
numeric per-day/model/effort/session aggregates, and the bounded neutral quota
history described above—never prompt, response, command, tool-argument,
raw-line, raw-path, account name, credential, or raw provider-label content.

Advice starts from materialized aggregates rather than rereading JSONL or
walking retained records. Aggregate-only is the remote default. Prompt samples
and optional user context have a separate explicit consent and must appear in
the exact request preview. The host keeps the prepared object and API key; the
webview receives only the preview and an opaque handle. A second click sends the
same byte object to the configured BYOK endpoint. Feedback, comparable pairs,
and comparison envelopes remain local and accept no prompt, response, path,
session, title, endpoint, or credential field.

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

Sharing previews are produced from already materialized aggregates. Combined
activity adds Claude processed volume to Codex processed volume only for the
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

Schema 3 deliberately keeps the established `globalStorage` filename
`codex-index-v1.json`; the filename is a compatibility path, not a statement
about the JSON schema. Its persisted DTO is an explicit allowlist of numeric
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
per-file index: unchanged refreshes read zero JSONL bodies, appends read only a
verified tail, and truncate/replace/move/delete changes rebuild only affected
files and aggregate groups. Content-analysis contributions and the established
cross-file response-identity rules are updated through the same atomic path.
Content analysis keeps a process-local materialized accumulator. Its cutoff is
the same continuously rolling millisecond cutoff used by `ClaudeDataLoader`, not
a local-midnight approximation. Per-file oldest-admitted timestamps and the
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

Codex history is designed for multi-gigabyte local corpora:

- discovery and parsing run outside the Extension Host in a worker;
- files are indexed recent-first with progress and cancellation; an incomplete
  backfill uses up to half of the available logical CPUs, capped at six local
  file-pass workers, while completed indexes return to the single low-power
  coordinator path;
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

Weekly API-equivalent history is derived from already-aggregated token usage.
The newest valid reset observation anchors non-overlapping seven-day display
buckets; without one, usage-only history uses Monday-to-Monday UTC calendar
weeks. A real utilization sample can support a full-window estimate, including
for historical buckets. For Codex, the account-wide `codex` series is allowed to
use all eligible local files in the same home because file keys are not account
identities. A reset that drifts from the seven-day grid is mapped by observation
time to the corresponding display bucket; source uncertainty, reset drift, and
daily slices crossing a boundary lower confidence and are rendered as an
approximation. A genuinely different quota series remains usage-only. Current
unused value is withheld, while historical unused value is shown only alongside
a full estimate. Each usage row still contributes to exactly one bucket.

v2.3.0 does not infer a $20, $100, or $200 subscription tier. Local Codex logs
do not expose a reliable account-and-plan identity, so a future comparison must
use an explicit opt-in account mapping rather than attaching prices by guess.

## Release invariants

- Strict TypeScript, red-green TDD, full `node:test`, F5 smoke test, and installed
  VSIX smoke test are required in proportion to the change.
- User-visible strings cover `en`, `de-DE`, `zh-TW`, `zh-CN`, `ja`, `ko`,
  `pt-BR`, and `id`; all nine README files (the main page plus eight locale
  editions) move together.
- Dormant preparation/experiment modules and review-only v2.3.1 documents stay
  unreachable from the production command graph and are excluded from VSIX.
- `package.json` is not manually version-bumped. Publishing the reviewed Release
  Drafter draft creates the tag; the publish workflow stamps that tag version.
- Contributor PR attribution is preserved by merging the contributor's original
  PR or, with authorization, adjusting that PR branch before merge.
