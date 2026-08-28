# Architecture

> A concise map of the extension's provider boundaries, data flow, and usage
> semantics. Update it whenever module ownership or provider behavior changes.
> A faithful Simplified-Chinese companion lives in
> [`ARCHITECTURE-zh-CN.md`](ARCHITECTURE-zh-CN.md).

## Product boundary

**Claude Code Usage** remains local-first, dependency-free, and read-mostly.
v2.3.0 preserves the complete Claude experience and adds Codex Beta as a
provider-specific usage and optimization view.

- Claude: exact local token buckets, model pricing estimates, and Anthropic
  OAuth 5-hour/weekly quota.
- Codex Beta: local processed/fresh/cache/output/reasoning metrics, model and
  effort breakdowns, thread structure, index coverage, quality flags, and
  structural optimization guidance. Known models also receive a clearly
  qualified API-equivalent cost estimate; it is never a bill or subscription
  charge, and unknown models remain unpriced.
- Compare: side-by-side compatible metrics only. It never sums provider cost,
  quota, or tokens into a misleading combined total.

Full invoice reconciliation, driving either coding agent, and background
telemetry are out of scope. Opt-in GitHub authentication and cross-device
aggregate sync are deferred to v2.4.x after a separate privacy review.

## Module map (`src/`)

| Module | Role |
|---|---|
| `extension.ts` | Activation, commands, settings, provider lifecycle, refresh orchestration, watchers, status/webview wiring, and anonymous diagnostics. |
| `dataLoader.ts` | Claude parsing, validation, attribution, and content-analysis primitives retained for exact compatibility. |
| `claudeIncrementalIndex.ts` | Production in-memory per-file Claude index: append-tail parsing, exact cross-file response deduplication, affected-group aggregation, content-analysis contributions, and materialized dashboard rows. |
| `providers/providerTypes.ts` | Provider-neutral token, event, confidence, outcome, coverage, and limit contracts. |
| `providers/claudeProvider.ts` | Thin compatibility adapter that exposes existing Claude aggregates without changing their results. |
| `providers/codex/codexSchema.ts` | Minimal safe JSON guards; never flattens or returns message/command/tool bodies. |
| `providers/codex/codexParser.ts` | Codex exact-request parsing with cumulative high-water fallback, pseudonymous lineage metadata, structural counters, quality flags, and last-observed limits. |
| `providers/codex/codexManifest.ts` | Allowlisted Codex directory discovery, HMAC file keys, fingerprints, and manifest diffing. |
| `providers/codex/codexIndex.ts` | Schema-3 persistent per-file numeric aggregates and replay evidence, bounded cold/tail parsing, independent aggregate/period/current-day coverage, and atomic save/load. |
| `providers/codex/codexIndexWorker.ts` / `codexIndexClient.ts` | Background coordinator, recent-first progress, cancellation, resume, checkpoint persistence, and single-flight client. |
| `providers/codex/codexFilePassPool.ts` / `codexFilePassWorker.ts` | Adaptive bounded local pool for independent per-file main, lineage, period, current-day, and identity passes during incomplete backfills. |
| `providers/codex/codexProvider.ts` | Extension-facing Codex snapshot facade and partial/unavailable/error outcomes. |
| `providers/codex/codexUsage.ts` | Codex calendar-Today/hourly, 7-day, 30-day, monthly, task, and project view-model aggregation with exact-model API-equivalent cost. |
| `providers/codex/codexInsights.ts` | Deterministic structural usage guidance; no prompt/body inspection. |
| `codexView.ts` / `codexViewComponents.ts` | Codex localized-copy and default-provider contracts; no HTML renderer, client script, or CSS ownership. |
| `settings.ts` | Canonical `SETTINGS` catalog and `SettingsStore`; do not scatter direct reads. |
| `statusBar.ts` / `codexStatus.ts` | Provider-specific status presentation and generic Claude quota formatting. |
| `webview.ts` | Single provider-aware Claude/Codex dashboard shell, shared render functions, shared client behavior, provider tabs, and Compare presentation. |
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
  ──> per-file numeric aggregate index + targeted current-day hourly sidecar
  ──> CodexProviderSnapshot
  ──> Codex scopes + insights
  ──> Codex status + provider-aware dashboard render inputs

Claude aggregates + Codex scopes ──> one `webview.ts` dashboard render stack
Claude aggregates + Codex scopes ──> side-by-side Compare (no cross-provider totals)
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
rows come from the independent current-day sidecar described below. Hourly,
daily, and monthly primary charts use API-equivalent cost by default, while the
token-composition chart remains a separate view. Unknown models contribute to
the token denominator but remain unpriced, so pricing coverage stays visible.
Claude and Codex time-series layouts share aligned responsive widths and keep
dense chart/table content inside local keyboard-focusable scrollers.

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

Codex `rate_limits.primary` found in local logs is a last-observed snapshot only.
It is hidden once its reset time passes. v2.3.0 does not read Codex credentials
or make a network call to refresh it.

## Privacy and persistence

Codex discovery is restricted to:

- `$CODEX_HOME/sessions/**/*.jsonl`
- `$CODEX_HOME/archived_sessions/**/*.jsonl`
- default `$CODEX_HOME`: `~/.codex`

It never reads `auth.json`, SQLite databases, config secrets, keychains, browser
state, or unknown files. Raw paths/session/parent IDs stay in short-lived local
worker memory. Disk persistence contains machine-salted pseudonymous keys and
numeric per-day/model/effort/session aggregates only—never prompt, response,
command, tool-argument, raw-line, or raw-path content.

The machine salt lives in VS Code `globalState`, not in the index file. Worker
progress/results/errors and diagnostics contain anonymous counts and timings,
not paths or identifiers.

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

The current-day hourly index is an additive schema-3 sidecar, not a third source
of all-time truth. A file becomes eligible only after duplicate classification
selects it as canonical and its verified period slice already contains
`asOfDay`. Per-file hourly promotion and in-progress cursors are checkpointed,
so cancellation resumes from the verified offset. A day or timezone change
discards the stale sidecar and targets the new civil day. This path neither
invalidates the primary aggregate nor triggers a full-history reindex.

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
A new Extension Host performs one cold in-memory build; watcher-driven refreshes
do not reread and reaggregate the complete corpus. Codex uses its own quiet
debounce (default 30 seconds, configurable to Off/10/30/60/120/300).

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
- current-day hourly work is limited to canonical files already known from
  period slices to contain `asOfDay`; its own checkpoints resume independently
  and do not reset the primary index;
- append refresh reads only the new tail; an incomplete line stays only in the
  scanner's short-lived memory and is retried from the safe cursor, never in v3;
- truncation/replacement reparses only the affected file;
- cancellation checkpoints atomically save per-file contributions and migration
  progress, so the next run resumes from the verified cursor;
- concurrent refresh requests share one worker run.

Weekly API-equivalent history is derived from already-aggregated token usage.
Observed weekly resets align seven-day buckets; otherwise usage-only history
uses Monday-to-Monday UTC calendar weeks. A token log can prove used value, but
not an historical subscription capacity: full and unused estimates are emitted
only where a real quota-utilization sample exists. Codex usage-only history may
combine multiple sign-ins in one home, while quota-derived rows remain bound to
their observed reset series.

v2.3.0 does not infer a $20, $100, or $200 subscription tier. Local Codex logs
do not expose a reliable account-and-plan identity, so a future comparison must
use an explicit opt-in account mapping rather than attaching prices by guess.

## Release invariants

- Strict TypeScript, red-green TDD, full `node:test`, F5 smoke test, and installed
  VSIX smoke test are required in proportion to the change.
- User-visible strings cover `en`, `de-DE`, `zh-TW`, `zh-CN`, `ja`, `ko`,
  `pt-BR`, and `id`; all seven README editions move together.
- `package.json` is not manually version-bumped. Publishing the reviewed Release
  Drafter draft creates the tag; the publish workflow stamps that tag version.
- Contributor PR attribution is preserved by merging the contributor's original
  PR or, with authorization, adjusting that PR branch before merge.
