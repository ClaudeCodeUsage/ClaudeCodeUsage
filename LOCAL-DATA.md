# Local data and privacy

Claude Code Usage is local-first. It reads provider-owned usage logs, stores
only bounded derived state needed for fast refresh and reset-aware estimates,
and never treats API-equivalent cost as a bill.

This page is the current inventory and versioned data-contract supplement for
version 2.5.0, combining achievements and compressed-log compatibility,
with the unreleased optional Codex quota/account-estimate additions below. The
historical v2.3.1 field-level baseline is in
[`docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.md`](docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.md).
The later compression, sharing, quota-pace, weekly-estimate preview and achievement sections here govern their added
runtime/persistent fields and exact clearing rules, including the canonical v2
envelope and twelve sharing keys. They do not relax unchanged baseline source-log,
credential, account-separation or explicit-network-consent restrictions.

中文说明见 [本地数据与隐私](LOCAL-DATA.zh-CN.md)。

## What the extension reads and retains

| Data class | Source | What is retained by the extension | Retention and clearing | Remote interaction |
|---|---|---|---|---|
| Claude usage records | Claude Code's local `projects/**/*.jsonl` | Runtime usage records and an in-memory per-file index; bounded prompt samples only when content analysis is enabled | Released on window reload/exit. Data controls never touch source logs; the separately opt-in Session Actions feature may move one exactly confirmed log to the OS trash (recoverable) | None unless the user separately previews and sends an advice request |
| Codex usage records | `.jsonl` and `.jsonl.zst` regular files recursively under `$CODEX_HOME/sessions` and `$CODEX_HOME/archived_sessions` | A schema-3 incremental index of pseudonymous file keys, decoded offsets, numeric usage, dates, model/effort, sanitized structural aggregates, optional compressed-source fingerprints/EOF marker, and bounded version-5 quota/Token checkpoints with separate admitted baseline requests and numeric incomplete-range witnesses | Until rebuild, explicit clear, schema replacement, or host removal; checkpoint migration reuses existing period replay | None |
| Codex titles | Exactly `$CODEX_HOME/session_index.jsonl` | `id → thread_name` is streamed for runtime display; titles are not written to the index | Runtime only | None |
| Weekly estimate preview | Existing numeric checkpoints/aggregates and local/opt-in official quota samples | `weekly-estimates-v1.json`: fixed-field snapshots, optional paired-window, official-delta or method-two matched-cut evidence with distinct local/official endpoints, public ratebook/parser/period versions, intervals/Δp/USD/Tokens/cycle bounds, internal account/window HMACs, leased source-local account ordinal and linked/unlinked diagnostics | Revisions preserve history; 4096 entries / 1 MiB stop new writes, no eviction. Clear fences include earliest monetary calibration start; selected-account clear preserves other/unassigned records and provider/all clear includes the archive | Calculation/chart/evidence projection has no network; optional official sample acquisition uses the daemon boundary below |
| Quota observations | Claude official response, structured Codex local events or opt-in `codex-official-api` sample | Provider, machine-local anonymous scope, original times/fractions/window/source/confidence/flags; optional revision-1 sanitized official facts with at most two windows and 128 HMAC-keyed reset credits; no raw account/credit IDs or free text | At most 180 days and 512 observations per provider/account/period after compaction; embedded facts share account/provider/all clearing | Enabled Claude lookup contacts Anthropic and may refresh its credentials. Optional Codex read can contact OpenAI through the existing daemon, whose authentication may refresh; the extension reads no Codex credentials |
| Settings and UI preferences | User choices | Typed extension settings, selected tab/filters, bounded background-work state, sharing presentation, Share Card draft controls, heatmap title/range/privacy/palette/provider/metric/show-amounts controls, gallery filter/size, and the optional display-currency preset | Until reset, clear, or uninstall; ordinary VS Code settings may participate in Settings Sync | No extension-initiated transfer; no exchange-rate lookup |
| Heatmap artifact (2.5.0) | At most 366 selected materialized civil-day aggregates | One accepted immutable SVG/Markdown artifact, opaque document-bound preview ID, source references and whitelisted config/quality identity | Runtime only; replaced/retired on control, source, pricing or display change, reset or disposal | None; preview/local export adds no source-log reads or network requests |
| Weekly quota pace (2.5.0) | Existing successful raw quota cache and original observation time | Runtime-only ≤16-window numeric projection, original-response metadata and bounded verified-account/window continuity anchors; default-off shared `showWeeklyQuotaPace` STATE preference | No extra observation store; source/credential invalidation withdraws forecasts and disposal releases runtime state | None added; does not enable quota tracking or request new credentials |
| Share destination | User-entered GitHub target | One versioned `ccu.heatmapDestination.v1` object containing optional `owner/repository/path`; no GitHub credential | Until sharing preferences are reset | Only after an explicit publish action and exact destination confirmation. A successful write is reported even if saving this convenience preference fails |
| Advice evidence | Derived local aggregates and explicit feedback | Coarse observations, recommendations, ratings, snoozes, comparable-task metrics, coverage, and versions | Bounded local ledger; clear independently | Nothing by default; only the exact previewed request is sent after a separate action |
| Local achievements (2.5.0) | Verified numeric usage and deliberate allowlisted local actions | A ≤64 KiB award envelope with public IDs, sequence/reason/unread state and optional first-record day/zone; safe setting-key/feature enums (never values), hour-streak maximum and qualified four-week peak | Default on; off stops new grants and extra proof work. Clear all removes exact achievement state and retains only an empty clear fence | None; sharing requires explicit local preview/export, not GitHub authentication |
| Advice API key | User-provided secret | Secret value in VS Code SecretStorage only | Until the key or all derived data is cleared | Used only as the authorization credential for the explicitly configured endpoint |

## Compressed Codex sources (2.5.0)

Zstd losslessly encodes the original JSONL; it is not an LLM summary and does not
change recorded token counts. Only the two usage roots above admit `.jsonl.zst`;
symlinks, non-regular files, other roots, credentials and SQLite remain excluded.
The separate title-only `session_index.jsonl` permission is unchanged. Source files
are never rewritten and no decompressed plaintext copy is saved.

Schema 3 adds optional `compression: 'zstd'`, `storageSize` (physical bytes),
`storageCtimeMs` and `compressionVerified: true`. The first three identify the
compressed representation alongside physical `mtimeMs`/`dev`/`ino`; the last marks
successful frame-EOF validation for that version. `size`, parser and migration
offsets remain decoded byte coordinates. Old entries without the new fields remain
plain. These anonymous numeric/enum/boolean fields live in the existing per-file
index and follow its rebuild/clear lifecycle; no new store or remote disclosure is added.
Deterministic decoding failures retain only `compressionFailure: { version: 1, code }`
and the physical fingerprint. The code is an allowlisted enum, never a native error,
path or message. Such rows contain no usage or proof, remain incomplete, and are not
retried until the physical version changes. Transient I/O and source changes remain
retryable. Unknown failure versions are discarded and revalidated.
Only verified compressed versions can add observations to the retained quota
history; a provisional checkpoint or rejected frame cannot seed that store.

This is a rebuildable index, not a historical backup: a source truly removed from
both allowed roots loses its usage contribution. Compression or an archive move
is not deletion; its remaining canonical source is reconciled without adding it twice.

Same-directory, same-basename plain JSONL is canonical and the compressed HMAC
key strips `.zst`; selection does not assert identical contents. Cross-area copies
still require full-census lineage deduplication. Encoding/other physical-version changes
invalidate old completion evidence and trigger quiet targeted historical rereads,
including moves with changed ctime; they do not create new live-usage receipts.

Unchanged verified files need at most 18 header bytes each and no body decompression
on warm refresh. Resume replays the decoded prefix, counts that work and permits
cancellation. The codec accepts one explicit-size frame without a dictionary-ID
field; corrupt/unknown-size input, extra frames or trailing data fail rather than
produce false completion. Limits are 4 GiB decoded/replay, 2 GiB physical and a
64 MiB window; the first historical compressed file may exceed a soft refresh budget
within those hard caps. Cold backfills containing compressed sources use at most
two file-pass workers. Native Node Zstd (22.15+ / 23.8+) adds no dependency.
Unsupported hosts report the limitation and retain last-good verified totals.
See [architecture](ARCHITECTURE.md) for the implementation boundary.

## Codex volume identity (P1)

Each source in the existing schema-3 P1 index may retain optional `volumeKey`, a
machine-salted HMAC of its stable filesystem `VolumeUUID`. No raw UUID, path or
volume name is retained. On macOS, a bounded metadata helper runs `/bin/df -P`
on an allowed usage root to resolve its mount device, validates the
`/dev/diskN[sN]*` form (numeric `N`), then runs `diskutil info -plist` on that device.
The commands share a total three-second deadline. Results are cached against root `dev`/`ino`;
either changing invalidates that cache. Unsupported hosts or inspection failure
use strict device/inode matching. Identity adds no credential or source-body I/O;
existing compressed-source checks of at most 18 header bytes remain unchanged.

Equal proven volume key and inode, with unchanged representation/other fingerprints,
permit cache reuse after device renumbering. Known different volume keys reject
reuse even at the same device number. Legacy records lacking `volumeKey` cannot
bridge a device change; they learn it when device/inode already match or after a
fresh scan. There is no parser/schema bump or forced rescan for this field.

The field lives and clears with its P1 contribution under the existing
rebuild/clear lifecycle; there is no separate store or remote disclosure. Older
readers may drop it, requiring later revalidation; this is not a universal
rollback-write guarantee. Primary usage totals are unaffected. Runtime calibration
may still retire on a device change; persisted volume identity must not restore
its prior baseline.

## What is never cached

Long-term and weekly monetary ranks add only public catalog IDs to the existing envelope: at most 178
current records within the unchanged 64 KiB total cap, including auxiliary evidence
and retained old-rule records. No usage/cost value or source identity is stored per rank.
Old 144-record v2 envelopes and pins retain provenance;
new IDs cannot be accepted in v1 or inferred from an old rank. Downgrade readers
may fail closed without overwriting unknown current records.

The two weekly API-equivalent series each have five levels: Bronze $100, Silver
$500, Gold $2,500, Platinum $10,000 and Legendary $25,000. Only the last two ranks
per provider are new; old IDs, thresholds and saved provenance are unchanged.
The catalog now has 24 monetary conditions within 178 rules and 50 themes. Weekly
evidence still requires a completed Monday-start week in the configured timezone
and the existing frozen reference-price basis. No live weekly receipt, extra
usage history or storage schema is introduced. The four new IDs are rejected by
legacy-envelope parsing; a pre-expansion reader fails closed without rewriting
or clearing either envelope. The reported maximum-envelope fixture is 37,374 bytes
against the unchanged 65,536-byte cap; this is synthetic validation, not native acceptance.

The compact achievement overview adds no stored fields or source reads. A bounded
runtime set of positive combined-calendar lower-bound rule IDs reuses validated
provider days; it is recomputed on evaluation, cleared when achievements stop and
never serialized or shared as an identity. NEXT capacity checks and first-tier
display stages are pure projections, not additional awards or dates. Claude
split-only cache-creation normalization changes only accepted numeric aggregates
when both known TTL counts are explicit and safe; source JSONL remains unchanged.
Legacy Codex calendar proof recovery reuses existing numeric migration cursors and
lineage markers after bounded body revalidation, not another store or scanner.

- OAuth access or refresh tokens, cookies, authorization headers, or GitHub
  credentials in extension-owned derived storage. Claude's provider-owned
  credential file or macOS Keychain item may be updated when its OAuth token
  needs refreshing for a quota lookup.
- API keys outside VS Code SecretStorage.
- Full account identifiers, email addresses, display names, or subscription
  names. Account continuity uses a machine-local HMAC fingerprint or an
  isolated unattributed epoch.
- Raw prompt/response bodies, tool arguments, commands, complete CLI output,
  absolute source-log paths, repository remotes, or persistent thread titles.

When Claude quota tracking is enabled, the extension uses the selected Claude
profile's existing access token to query `api.anthropic.com/api/oauth/usage`.
If it is expired, the existing refresh token is sent to
`console.anthropic.com/v1/oauth/token`; the replacement access token is written
back to that profile's credential file or macOS Keychain item. This is separate
from optional BYOK AI advice, which never uses Claude subscription credentials.

## Weekly estimate preview and archive

`codex.officialQuota.enabled` defaults off. With quota tracking enabled, the host
can read the already-running official local Codex daemon through
`providers/codex/codexOfficialQuota.ts` and `codexQuotaWebSocket.ts`: a short-lived
`app-server proxy` carries WebSocket frames over stdio. The only application messages are
`initialize`, `initialized` and `account/rateLimits/read`. The extension never
starts the daemon, initiates login or reads credentials. The quota API can
contact OpenAI, and daemon-managed authentication may refresh credentials;
a local proxy connection does not make this operation network-free.

The host rejects custom Codex homes and remote extension hosts. Reads require
the window to be focused, including while editing documents; automatic attempts are at
least 60 seconds apart and manual attempts at least 10 seconds apart. Existing
refresh/visibility callbacks drive them, with no extra recurring timer.
Failure, cancellation or unsupported sources produce unavailable state, not a
substitute account from local logs. Successful current quota identity does not
prove ownership of local usage.

Official P2 observations are durable epoch checkpoints even before a monetary
estimate exists. `codexQuotaEpoch.ts` copies first observation, fixed reset anchor,
optional lower boundary and cautious reason, never an invented exact manual-reset
time. With validated new `officialFacts`, unused planned-reset drift before the
deadline and same-window nonzero corrections of at most one percentage point do
not split cycles; corrections still retire calibration. Larger drops, positive-to-zero
changes and positive-use reset changes retain cautious boundaries. Legacy P2 rules stay intact.

`CodexAccountEstimator` in `codexAccountEstimate.ts` routes declared
`codexForwardCollectionVersion: 1` or trusted proof `slicesVersion: 1` to
`codexForwardMatchedEstimator.ts`; older forward proofs retain the method-one
`codexForwardAccountEstimate.ts` route. Declared forward collection with missing
proof never falls back to historical estimation. Both require a fresh verified
primary census and exact scan-issued append offsets/usage times.
The bounded immutable runtime proof (16,384 sources / 8 MiB; 64 MiB hashing cap)
includes every primary source; changed sources need complete priced increments
and matching local quota witnesses, or the whole interval is withheld. Unchanged
old sources need no historical-sidecar migration; `allTime` completion is not a
forward-calibration prerequisite. Census, append witnesses and baselines are never
persisted or restored. Method-one archive evidence can retain numeric
`collectionMode: 'forward-append-v1'` receipts. This adds no runtime dependency,
source I/O, scanner or anonymous contribution; existing opt-in official reads retain
the daemon/network boundary above. Forward samples/proofs use five-minute freshness
bounds and accumulate verified increments until an increase of at least one
percentage point is observed, with the final sample below 100%.

Local proof/rates/pricing version are captured before the official RPC, not after
concurrent watcher or persistence work. A fresh exact baseline-proof reread with
unchanged account/context/epoch/percentage is quota-facts-only and preserves the
monetary baseline without counting USD twice; other proof reuse remains rejected.
One fixed-field local `codex-calibration` output record per existing cadenced read
can distinguish the cause using enum state/reason, paired-point/interval counts
and relative proof/bracket durations. No identifiers, model names, raw errors,
extra cache, timer or telemetry flow are added; progress remains non-restorable.
Matched collection reports its first rejected guard separately: unproven birth,
source/append continuity, missing numeric slices, invalid slice order/vector,
missing pricing, baseline-time overlap or usage after the official request.
These fixed enum reasons do not identify a source or relax monetary eligibility.
Window blur cancels in-flight network authority and recurring work but retains
the accepted in-memory calibration baseline. On return, the ordinary account,
epoch, freshness and full-append checks decide whether it remains comparable.
No baseline is restored from disk or accepted solely because focus returned.

Observed `token_usage_record` compatibility is scan-local only: a record, validated
response item and newly emitted exact-last count must occupy consecutive raw
ordinals and physical lines, share locked thread/model context and request token
components, and fall within five seconds. The earlier record time and count time
both bound usage; cumulative scopes are not compared as identical totals. Metadata
adds no tokens/USD and no marker, raw ID/body or pending pair is persisted. Split,
unsafe, missing or replayed pairs remain ineligible. Primary parser schema, totals,
signatures and warnings are unchanged. This observed layout does not establish a
universal shared-request identity contract or make historical amounts complete.

Optional runtime append `slices` retain only request time envelopes, exact emitted
primary token components, a sanitized model and optional same-line Codex numeric
quota. Per-pass limits are 128 requests / 64 KiB; retained windows share the existing
256-KiB live history cap. Overflow omits detail as a whole. Neither slices nor
pending pair state survive P1 serialization/restart, and collection adds no source
read, history replay, account attribution, body/ID field or persistent store.
The matched route first reconciles every changed source's complete primary delta,
exact offsets and current physical snapshot, then uses the same global local cuts
for both numeric USD and local Δp. Official request/observation times and
percentages remain context and current as-of facts, never substituted into the
local numerator or denominator. It reuses the existing public model ratebook.

Runtime-only `forwardSourcesCurrent` verifies manifest-versus-contribution
identity/version/EOF. False withholds proof; absent cannot exempt file-level
`replaced-jsonl`/`truncated-jsonl` diagnostics. Only fresh current-source verification
can admit those file reset diagnostics for a new future baseline. Unsafe parser
flags remain fatal; replacement scans grant no append or birth authority.
After discarding the first arbitrary percentage-step span, flat-percentage USD
is sealed into bounded numeric prefix sums across polls. Residual unsealed rows
are capped at 2048 / 256 KiB, the source set at 16,384, official context history at
32 points and compatible runs at 64. Context/account/epoch/pricing changes,
gaps or unsafe input retire the baseline; no receipt restores it. These runtime
details add no persisted bodies, raw IDs, titles, paths or credentials.
The method is implemented and routed; deployment and verification against actual
usage remain outstanding.

Each fresh continuity baseline starts unaligned: discard USD and points through
the first observed increase of at least one percentage point, then measure from
that observed step. Switches, gaps and invalid intervals restart alignment;
same-cycle percentage decreases retire the old calibration cohort without themselves
creating a new cycle or reusing its points. Runtime context additionally binds
`planType`, `spendControlReached` and `ordinaryUsageAllowed`, alongside actual rates;
changes break continuity, without extending the persisted facts allowlist.
Alignment does not guarantee unbiased estimates or establish an error bound.

The live producer retains at most 32 append windows per source and 512 windows /
256 KiB overall. A branded previous proof from the same provider can bridge an
unchanged normalized warm reload or a verified ordered append, never a restart,
copied proof, changed owner/generation or unknown gap. The consumer selects an
exact offset chain for its own official bracket; missing/evicted prefixes remain
unknown. Method-one fitting requires matching local and official percentage endpoints;
known-zero quiet refreshes preserve alignment. Last counter observations survive
blur so a later correction cannot restore a retired calibration cohort. EOF-packed
partial lineage blocks preserve the same ordered-prefix semantics as full blocks.

Approved old parsing/accounting gaps may precede a fresh forward baseline, but
do not establish complete history. Each unsafe new line independently invalidates
its append witness even when its diagnostic flag already existed. Stale state,
identity/ownership failures and unknown quality flags remain blocking, subject
only to the verified file-reset diagnostic rule above, never unsafe parser flags. The UI
receives only a runtime allowlisted calibration state and numeric paired-point /
interval counts; these progress facts are not persisted, restored or sent elsewhere.
An entirely pending chart explicitly says that capacity is unknown, not zero.
New root sources may join only with runtime birth provenance covering a full
offset-zero scan, stable ownership and a contiguous append chain. Every old source
must remain; all new dollars/timestamps must fit the official bracket. Predecessor
census summaries are capped at 32 and are never saved. Unproven children, restored
or copied witnesses, unsafe initial input and missing prices reject the interval.

The comparison prioritizes identified account cycles. Anonymous reference cycles
overlapping their observed coverage are omitted from both bars and summary rows,
with an explicit omitted-cycle count. Their archive values remain unchanged and
are never assigned to an account. Non-overlapping older references remain visible;
a pending account cycle never borrows an anonymous capacity.

The historical aggregate compatibility path in `codexAccountEstimate.ts` keeps the
following separate rules; these do not gate forward calibration. Account switching breaks the monetary baseline
without bridging intervening use; bounded compatible account/epoch/price sums can
be retained. Full clearing, source/index invalidation and restart clear runtime
calibration; archived evidence never restores a pre-restart baseline. Actual model-rate
changes break the baseline even if the public pricing-version label is unchanged.
Valid epoch intervals may span up to 65 minutes with complete indexes
and consistent local witnesses; over five minutes adds a continuity warning.
Legacy callers retain the five-minute cap. Unexpired older quota observations
retain their original timestamp and a stale marker, not current account authority.
Recent-observation continuity is tracked
separately from that baseline: a valid unsaturated unchanged-percentage read updates
`lastObserved` while preserving the original monetary baseline. Continuous
unchanged reads can therefore span more than five minutes without discarding
the work awaiting a percentage increase.
Historical aggregate calibration requires a verified current manifest and complete current/all-time
indexing. Historical `ambiguousSessionGroups` can leave `coverage.identity.complete`
false after a full scan; that global flag no longer blocks an otherwise verified
unambiguous subset. Deduplication supplies runtime-only `ambiguousFileKeys`, and the
provider attaches the verified `calibrationSourceScope` exclusion set. The estimator
uses only unambiguous sources; primary totals and identity quality flags stay intact,
and the subset is never presented as complete account usage. Receipts retain only
the `excludedSources` count, not excluded keys; exclusions add `partial-history`.
Index rebuilds, `indexGeneration` or exclusion-set changes require a fresh baseline.
Unmatched or conflicting sources, detectable revisions to already-closed historical
buckets and late backfill at/before the baseline are excluded from calibration.
Optional `inputs.codexCalibrationCensus` is a runtime-only source census from
`codexCalibrationCensus.ts` via `buildCodexCalibrationCensus(index, verified,
canonical, ambiguous, verifiedAt = Date.now())`. Its schema-1 envelope contains
`indexGeneration`, `verifiedAt` and every indexed source, including noncanonical
and ambiguous files: `sourceKey`, `revision`, `continuity`, `bytes`, `canonical`,
`eligible`, `uncertain`, `activityThrough`, `usageThrough`, `usageRevision` and
`ranges`. Bounds are 16,384 sources /
8 MiB, with a 64 MiB hashing-processing cap; no partial census is issued.
The producer's WeakSet brand admits only its immutable runtime objects;
serialized or copied proof confers no authority. Reusing an old index object
returns the original proof and verification time. Each subsequent official
increment needs a distinct, unconsumed proof verified after its baseline and
no later than its sample, with at most five minutes of lag.
The provider conservatively stamps the verification attempt's start, before
worker parsing or title loading; publication latency cannot renew that proof.

Only a fresh official increment may waive an uncertain source whose revision
and lineage continuity are unchanged and whose known activity ends at/before
the baseline. Changed or newly eligible uncertain sources get no static waiver;
missing current increments still withhold the whole interval. This grants no
account ownership, historical repricing or historical completeness. Census
proof is never persisted, exported or rendered, and adds no source I/O.
`activityThrough` includes nonusage metadata; `usageThrough` uses the numeric
usage/quota boundary in `state.lastEventAt`, and `usageRevision` binds complete
model vectors and pairing/uncertainty provenance, not physical byte metadata.
A fully parsed metadata-only append may count as known zero only when both
source snapshots are complete and eligible, numeric provenance is unchanged,
usage is no later than baseline, and activity is no later than sample. This
exception cannot turn unknown tails, parse gaps, future activity or new sources
into zero; missing projection of a current usage increment still withholds the interval.

For both forward and historical compatibility estimates, each admitted interval must have an increase of at least
one percentage point and end below 100%. That interval admission rule is distinct
from the five-percentage-point cycle display gate below. Compatible admitted intervals within
the same account/epoch/price scope are aggregated, including compatible earlier
intervals retained across a switch or blur, but never the transition gap:
`linkedLocalDeltaUsd` is the sum of their
linked local priced increments (ΣlinkedUSD), and `deltaPercent` is the sum of
their matching percentage-point increases (ΣdeltaP), not just the latest pair:

```text
F = linkedLocalDeltaUsd / (deltaPercent / 100)
R = F * (1 - p / 100)
```

This is a quota-scoped local incremental proxy, not an owned account total or a
complete cross-device amount. Late events indistinguishable within a daily aggregate
remain unresolved: this low-confidence proxy does not establish per-request timing
or precision. `usedEquivalentUsd` is the sum of admitted
calibration increments, not the actual-used total or proof of owned USD. Actual-used
statistics remain separate usage projections with their own coverage/attribution limits;
`F` is conditional full-capacity equivalent, not account spending. `calibrationStart` preserves the run's first
admitted monetary interval start (the earliest local cut in method two, not its
older official context anchor). The unused estimate
is frozen at the same as-of sample. Never subtract later local usage to create
a live balance. A current official sample does not prove historical account
ownership or continuity across account switches.

For historical Codex logs, `providers/codex/codexQuotaCheckpoints.ts` retains
version-5 numeric checkpoints during the existing lineage-admitted index pass.
Quota-only replay for missing or incompatible checkpoint state requires the
explicit internal historical path (`allowQuotaCheckpointBackfill: true`), now
defaulting false. Independently required primary and period migrations are unchanged
and may still rebuild checkpoints in their own work; there is no second scanner.
An unchanged warm refresh rereads no
usage-record bodies, and projection never opens source logs. Checkpoints contain
numeric times, percentages, segment/completeness state and sanitized per-model
Token counts with internal pseudonymous source keys, never raw text or raw IDs.

For quota calibration only, `codexParser.ts` validates raw numeric
`last_token_usage` cost components before compatibility defaults or clamps.
Valid request components survive a cumulative-only counter regression.
Present optional cached/reasoning fields must be nonnegative safe integers,
cached-input aliases must agree, cached input cannot exceed input, reasoning
cannot exceed output, and input + output must be safe. `last.total_tokens`
remains independent context size, not a request-component sum. These stricter
pairing checks leave primary totals, high-water updates, warnings and dedup
unchanged.

Version 5 keeps `segmentResetAt` fixed to the segment's first reset anchor.
Each row's `resetAt` uses that canonical first R; `observedResetAt` retains its
original raw numeric R. Jitter within ±5 minutes is compared with the fixed
first anchor, never chained through later observations. Pairing never extends
beyond the canonical reset. `observedResetAt` is optional only for legacy runtime
inputs; strict v5 storage requires it. When version-1–4 sidecars are rebuilt,
they require bounded period replay; they are not relabelled and old baselines are never retrojoined.
Primary quota observations
keep their raw reset values unchanged.

A segment's cumulative `byModel` excludes its own baseline line. On baseline
rows only, `baselineByModel` separately records the admitted request on that
line: an empty map means known zero, absence means unavailable. This lets an
enclosing interval from a concurrent source include that request's USD without
counting it in its own segment delta. If the required baseline request cannot
be established, its whole overlapping component is rejected rather than silently
omitting its value.

Retention is bounded to 512 points / 256 KiB per file, with at most 16 model
entries per map. Retained and resumable-draft payloads share a 32 MiB index
budget; the provider projection is bounded to 65,536 points / 32 MiB. See the
[`codexQuotaCheckpoints.ts`](src/providers/codex/codexQuotaCheckpoints.ts) constants.
Compaction keeps segment endpoints or removes whole old segments, preserving the baseline
of any retained interval. Version 5 retains bounded `CodexQuotaIncompleteRange`
numeric interval witnesses: `from`, `through` and optional `resetAt`, exposed as
`codexQuotaIncompleteRanges`. Up to 512 merged gap ranges per state and 65,536
projected ranges localize skipped, omitted or ambiguous activity without raw
text or IDs. Coarsening widens the affected interval conservatively. A gap
outside an admitted interval does not poison it, even within the same reset.
Unknown/unlocalized scope cannot assert completeness; legacy per-reset/global
guards remain the fallback when interval witnesses are unavailable.

For already-oversized records, `codexRootTimestampWitness.ts` validates JSON
structure and a unique (including escaped-key aliases) root timestamp during
that same stream pass. It retains no body text: depth is capped at 64, key size
at 128 characters, key count at 4096, and timestamp text at 64 characters.
A valid witness supplies only a dated exclusion point; malformed, duplicate,
over-limit or mid-record-resumed input keeps conservative unknown-gap handling.

`codexWindowEstimate.ts` consumes these checkpoints when present, retaining the
legacy `series-prefix-v1` method label with explicit `windowEvidence`. It pairs
within a source/segment and prices actual model components from the normalized
ratebook. Concurrent sources may contribute local USD, but overlapping
percentage intervals use their union, never a sum of duplicated account-wide
counters. A shared reset timestamp R is a window reference, never account
identity; a cross-source counter contradiction is not inferred to be a switch.
Pairs whose time intervals overlap form a component; touching intervals stay
separate. If a component overlaps an incomplete-range witness, has incomplete
or unknown-priced USD, missing baseline evidence, or contradictory counters,
the WHOLE overlapping component is rejected: both its USD numerator and Δp
denominator leave the fit. A missing source's dollars cannot be removed while
its percentage remains. A quota-only component has no usable local numerator.
A separate clean component may still calibrate the window.

Compatible admitted components form a coherent calibration cohort. A small
counter correction starts another cohort, not another quota cycle. The
strongest cohort by covered Δp wins, with recency breaking ties; its own amount,
percentage and as-of observation remain paired. Unobserved gaps and incompatible
cohorts are never bridged into an enlarged denominator. If no eligible cohort
remains, or covered Δp is insufficient, total/unused capacity is `null`, not zero.
`complete` describes the admitted cohort, not completeness of all local history
or account usage. Primary local usage totals are unchanged.

For an eligible paired window, F = ΔUSD / (Δp / 100) and
R = F × (1 − p / 100), using the same as-of observation. At least five
percentage points of covered Δp are required for cycle monetary display,
including official-delta candidates. This is a local quality policy, not
official measurement precision, a percentage error bound or a confidence
interval; fractional observations are retained. Local paired-window and
official account-delta amounts remain conditional proxies, not proof of full
account ownership or complete cross-device usage. Model mix or actual rate
changes can change the estimate; no clamp preserves an older large value.
Price semantics follow normalized rate content and parser/period versions,
not a price fetch timestamp.

Legacy daily-prefix and `paired-delta` records remain readable at their frozen
amounts. Legacy error-bound ranges are not invented for the new paired-window
method. When new precise inputs cover the same reset/reference bucket, the
coordinator withdraws old unassigned daily-prefix capacity from the display,
even while the new evidence is pending; it does not rewrite archive bytes.
Partial pricing/history or excluded USD cannot support a displayed Codex cycle
capacity. No method here supplies the independent
`WeeklyEquivalentUsage.accountSeriesKey` and `inputs.accountUsageCoverage`
proof needed for `owned-window`. Claude conversion behavior is preserved;
`showWeeklyQuotaPace` remains a separate elapsed-time forecast.

The Codex cycle quota comparison uses one summary row and one bar or pending
placeholder per historical cycle. Official P2 (seven-day) observations are
isolated by source, account and period; five-hour observations are not joined
into that history. `codexQuotaEpoch.ts` derives reset epochs independently of
monetary calibration, so a cycle can remain pending without an amount. Durable
account ordinals survive that pending state. Matching reset times alone never
bind local history to an official account.

`codexQuotaCycles.ts` combines official checkpoints and saved epochs into
display-only `quotaCycle` bounds: `startAt`/`startLowerAt`,
`endAt`/`endLowerAt`, `closed` and `scheduledResetAt`. Early resets truncate
the previous cycle; uncertain boundaries remain explicit. Account visits, daily
usage, calibration segments, price changes and resampling do not create new
reset cycles. Unknown windows may use labelled, non-overlapping seven-day
reference buckets (`fallbackDays: 7`), not claimed subscription boundaries.
Legacy references are assigned by original observation time to UTC Monday
buckets; a paired window keeps its first-observed reference bucket, so redraws
or crossing Monday do not split that retained window. A detected drop retains
its observed boundary bracket. Accounts remain separate and unassigned groups
do not acquire account labels.

For verified official zero-use history, `codexQuotaCycles.ts` may alias a
moving planned reset into one provisional display cycle while still before
the previous deadline and first positive use. The same account fingerprint,
official source and `providerWindowFingerprint` must agree. First positive use
fixes the provisional deadline. A generic legacy account-ambiguous flag alone
does not negate that verified evidence; all raw flags are preserved. Explicit
unverified attribution, fingerprint/source mismatches, clock anomalies or
contradictory counters reject the alias. This is display-only: P2 observations,
archive amounts and raw calibration `quotaEpoch` metadata remain unchanged;
it supplies no local-usage ownership or monetary calibration.

`selectCodexCycleEstimates` selects by monetary eligibility and covered Δp
before recency, then method preference on a tie. There is no largest-value
preference or old-value clamp. Each selected amount keeps its own percentage
and as-of time; a later quota observation does not silently replace those
fields. Invalid monetary evidence leaves a pending cycle visible. Old archived
amounts remain frozen even when their display eligibility changes, and
overlapping estimates or accounts are never summed.

Both bar segments use that snapshot: estimated used = F − R, estimated
unused = R, total height = F. A closed cycle need not be exhausted.
The table has one summary row per cycle with expandable calibration interval,
Δp, amount and pricing evidence. Official and local observations retain their
separate as-of/reset details; source conflicts are visible rather than resolved
by silently choosing a source. Up to 48 cycle summaries are selected before the
display cap and scroll horizontally. Short dates use at most two axis lines,
with a seven-day reference marker where applicable. Current requires fresh
matching official account/epoch evidence when official reads are enabled;
unassigned, stale or closed cycles cannot acquire that marker.

These helpers feed `weeklyEstimateChart.ts` and the shared renderer/CSS; Claude keeps
its established behavior. Primary local usage stays in its existing views,
without an extra seven-day local-usage graph. Cycle projection adds no file,
raw-log scan, network request, telemetry or contribution flow. Estimate headers
identify estimates and monetary cells omit repeated ≈.

`quotaObservationStore.ts` accepts `codex-official-api` through
`codexQuotaCaptureFromOfficialSample`, using `official-account-scope-v1|` for the
validated account HMAC. The existing schema-2 P2 envelope adds optional
`schemaRevision: 1` and only verified official Codex observations may carry schema-1
`officialFacts`: `requestedAt`, optional `ordinaryUsageAllowed`, at most two numeric
primary/secondary `windows`, and optional `rateLimitResetCredits`. Its independent
nonnegative `availableCount` is retained even if runtime details are invalid;
details are capped at 128 credits with 64-hex HMAC `creditKey`, allowlisted
status/reset type, grant time and optional expiry. Missing, null, zero and fetched-empty
lists remain distinct; unavailable details/expiry never imply zero. No raw account
or credit IDs, names, paths, free text, plan or credentials are retained.
Strict persisted validation, deep copies, dedup and bounded first/latest/change
compaction apply. Facts share the observation's 180-day / 512-per-series limits
and account/provider/all clearing; no file or storage engine is added. Current code
rejects unknown revisions and refuses appends with unresolved quarantine/recovery
files, preserving recoverable history. Older readers may reject or quarantine new fields;
this does not guarantee that all older versions preserve the canonical file on later writes.
Local-log captures remain unattributed and separate.

`weeklyEstimateArchive.ts` retains fixed-field DTOs in the existing schema-1
`weekly-estimates-v1.json`: original times, amounts, pricing coverage/version,
method/flags, optional calibration range, `unlinkedEquivalentUsd` and
`linkedSourceCount`, optional validated `quotaEpoch` numeric/enum metadata, and
optional `calibrationEvidence` for new admitted `account-delta-v1` estimates.
Paired local windows add fixed-field `windowEvidence` through
`codexWindowEvidence.ts`: schema/method versions, `from`, `through`,
`calibratedThrough`, start/end percentages, covered Δp, ΔUSD, priced/all Tokens,
interval/source counts, excluded USD, completeness, the exact normalized
ratebook and numeric/enum cycle metadata. Optional numeric `skippedIntervals`
and `skippedUsd` retain proof of whole rejected or unselected components,
outside the admitted USD/Δp fit. Missing fields in older method-one receipts
mean zero; they do not license a partial numerator. Validation checks consistency with
the retained amount and pricing evidence; it does not establish ownership.
`codexCalibrationEvidence.ts` copies only fixed fields: the latest admitted interval's
before/after observation and request times, start/end percentages, incremental USD,
priced/all Tokens, linked-source count, `excludedSources` count and continuity-gap
boolean; cumulative interval
count, ΣdeltaUSD, ΣdeltaP and priced/all Tokens; and the exact public model input,
cached-input and output rates plus parser/period versions used for that estimate.
Each archived percentage-change point retains that evidence. Older records without
it remain valid and receive no invented evidence or identity. Frozen historical
amounts are read back without repricing or restoring runtime calibration. Evidence
capture reuses materialized aggregates: no new data file, log scan, network request
or credential access.
New matched receipts keep `CodexCalibrationEvidence.schemaVersion: 1`, set
`methodVersion: 2` and `collectionMode: 'forward-matched-cut-v1'`, and require
`matchedCut: { from, through, percentFrom, percentThrough }`. The existing
`interval` retains REAL official requested/observed times and official percentages;
its USD/Tokens and accumulated USD/Δp use the matched local cuts. Method two
requires complete pricing, zero excluded sources and no continuity gap. Current
as-of utilization and unused equivalent use the official percentage;
`usedEquivalentUsd` remains calibration-sample USD, not cycle-used USD.
Method-one evidence semantics remain unchanged; old records receive no inferred
matched cuts. Existing details show distinct local monetary and official context
ranges, without a new chart or navigation. Neither version persists raw logs,
credentials, thread titles or paths.
Epoch-aware keys distinguish same-reset pre/post-drop records while the absent-field
legacy key branch stays unchanged. The existing internal `accountScopeKey` is now used;
source-local `accountNumber` is assigned and persisted under the shared lease.
Source/window keys and account scope use machine-salted HMAC. Internal `localWindowKey` is also stripped at the public projection boundary;
only a local window number is exposed. Only the account ordinal
number reaches the public projection; HMACs, source keys, paths, raw IDs, email
and conversation content never reach HTML/export. Old records retain their
method, pricing version and unassigned status rather than being relabelled.

Archive revisions preserve past snapshots with no expiry or eviction. New Codex
captures coalesce repeated same-percentage/method/price/segment facts, preserving
the first stored as-of point rather than every live update. At 4096
entries or 1 MiB new writes stop; reads remain available. Mutations reread under
a cross-process lease and use symlink checks and atomic 0600 replacement.
Older preview readers can reject new methods/fields.
The archive document remains schema 1 and estimate method `account-delta-v1`;
current readers accept both receipt versions without rewriting method-one meaning.
Source audit and compatibility tests establish that the audited pre-method-two
readers reject `methodVersion: 2` and refuse record writes against such an archive.
This is not a universal rollback-write guarantee. Preserve derived archives before
rollback; provider-owned logs are not modified.

`weeklyEstimateCoordinator.ts` keeps bounded memoized projections and queued
archive work; projection reads no raw logs and creates no network requests.
Cycle representatives are selected before the 48-row display cap. Host calibration
queues the existing writer directly rather than relying on dashboard rendering.
Selected-account clearing uses internal fingerprint and durable cutoff fences,
preserving other accounts and unassigned records. Provider/all-history clears
also cover the archive. The fence checks paired `windowEvidence.from` and, for `account-delta-v1`,
`calibrationStart`, as well as `observedAt`. For method two this is the earliest
monetary calibration cut, not the older official context anchor: another instance's old accumulated evidence cannot re-enter
with a later observation timestamp. At its next sample the host retires that account's
affected runtime sums and establishes a fresh baseline; queued stale observations
cannot restore cleared data.
Unchanged projections do not repeat archive I/O merely as time passes.
Numeric checkpoint version 5 is an additive part of the existing index and
period replay. The default-on `showWeeklyEquivalentValue` display setting and
package version are unchanged; no new dependency is required.

## Sharing workspace and exports

The preview-first sharing workspace reuses materialized provider aggregates; it
does not scan logs again or create another statistics cache. Its remembered
presentation is one local enum (`ccu.sharing.template`): combined activity
heatmap, Claude Share Card, Claude token heatmap, or (in 2.5.0)
explicitly selected earned badges. `enableShareCard` is the
only visible on/off setting. The retired `showHeatmap` value remains catalogued
for bounded clearing and one-release compatibility, but it no longer creates a
second panel. Explicit legacy-command coordination is runtime-only: the host
keeps a monotonically increasing provider-lifetime revision separately from the
single live intent, and removes that intent after the Webview acknowledges its
exact revision. No command revision is stored in browser storage.

Share Card project and session selections can contain raw local paths or
session identifiers, so those values remain memory-only and disappear when the
Webview closes. Browser storage keeps only non-identifying presentation
controls such as range, theme, visible sections, number format, and the
selected presentation.

Share Card export uses the exact accepted SVG. Changing visible sections or
other controls requires a new preview; a single runtime artifact and opaque
preview ID are retained, not an export history. Resetting ordinary dashboard
settings preserves the BYOK key. Its separately confirmed clear-key command
remains the explicit removal route.

```text
Claude processed = input + cache creation + cache read + output
Codex processed  = input total + output total
Combined activity = Claude processed + Codex processed
```

Codex cached input is already part of input total, and reasoning is already
part of output total, so neither is added again. Combined activity is local
token volume—not productivity, billing, model capability, or provider
equivalence.

Local SVG and Markdown exports contain only a bounded title, selected date
range, daily Claude/Codex/combined Token aggregates or explicitly selected separate
provider amount estimates, pricing/source coverage, labels and caveats. They do not
contain accounts, projects, thread titles, paths, prompts, or log content.
Claude Share Card and Claude token heatmap presentations consume Claude
aggregates only; they do not imply that Codex exposes equivalent fields.
Preview and local export are strictly network-free and do not request GitHub
authentication, profile, avatar, or name data.

The heatmap defaults to Tokens and allowlists Claude/Codex/Both plus
Tokens/API-equivalent amount. Amounts require an explicit choice and reuse current
floating daily estimates, not the fixed USD pricebooks used for achievements.
Claude estimates retain current backend/fallback/override semantics; Codex prices
exact known models only. Missing/unpriced/partial/true-zero days remain distinct;
incomplete data or pricing is labelled, and a priced subset proves a lower bound.
Both renders independent monetary panels and never sums provider amounts.
The read-only projector selects at most 366 dates from existing daily arrays;
it neither scans the retained corpus nor reprices usage. Token/hidden mode does
not access money/quality getters. Hiding amounts restores Token text, colors,
titles/tooltips, metadata and Markdown and retires the old opaque preview handle.

One accepted heatmap artifact is retained in host memory, not as an export history.
Document/request checks reject superseded replies; source references, controls,
pricing/timezone/locale/currency/display revisions bind acceptance. A changed
source or pending repricing cannot export a previous amount preview. Export checks
before and after the save dialog, including the current visible/ready document,
then writes the immutable accepted SVG bytes;
Markdown copying also requires current acceptance.

Reset Sharing Preferences clears exactly twelve browser keys: `ccu.sharing.template`,
`ccu.sharing.achievementBadges`, `ccu.sharing.shareCardDraft`, and the nine
`ccu.combinedHeatmap.` suffixes `title`, `range`, `intensityMode`, `privacyPreview`,
`palette`, `customAccent`, `provider`, `metric`, `showAmounts`. These are bounded
presentation choices, not provider logs, quota observations or credentials. It
uses the existing request-ID/ACK path and applies defaults only after deletion succeeds.

Direct GitHub publication is a separate optional action and never runs in the
background. It requests `public_repo`, verifies the repository is public and resolves its
default branch, then asks the user to confirm the exact
`owner/repository/branch/path` and whether the file will be created or replaced.
Private repositories use local SVG plus Markdown instead of silently requesting
broader access. After GitHub accepts the write, success is authoritative and is
reported before any warning that the atomic destination preference could not be saved.

## Weekly quota pace (2.5.0)

`showWeeklyQuotaPace` defaults false, is shared by both providers and does not
enable quota tracking. Off exits before source getters, clock/cache/client access
or projection. On uses only the existing successful raw response and its original
`observedAt`; repainting never refreshes the observation time. Account continuity
uses the existing verified request-account HMAC in memory, not a profile, home,
label, raw account ID or credential. No new request, timer, log scan, observation
store or account history is added. The numeric DTO exposes no HMAC or identity.

The inferred start is reset minus seven days. A 29% observation at 25% elapsed
projects 116% account-wide cycle use, including other devices/members. No forecast
is shown in the first six hours; after thirty minutes without a fresh observation
or after reset it is withdrawn. Credential invalidation zeroes the successful-cache
time and withdraws it immediately. Counter drops, changed account/source/window
or unexpected resets latch distrust until a verified ordinary seven-day rollover;
higher counters or a repaint alone cannot restore it. Current Codex local-log
evidence has unknown account trust, so forecasting remains unavailable.

Existing refresh callbacks send a minimal document/provider-bound host patch,
including when dashboard auto-refresh is off. The client does not optimistically
recompute forecasts. The dashboard and status-bar tooltip reuse shared eight-locale
copy without changing compact bar text or custom quota formats.

<a id="local-achievements-242-candidate"></a>

## Local achievements (2.5.0)

The historical-date manifest explicitly registers 138 current rules; registration
alone never proves that retained logs can date a level. Unknown IDs or changed
counter/threshold/version/ownership/base/scope remain undated. Manual session
dates follow canonical uncapped admission; weak cache keys retain no second
records corpus and source retirement releases the annotations. Changed logs require
another calibration. Real producer-verified new usage remains an independent
receipt with its original date/unread contract, even when calibration is cancelled;
historical reconciliation does not consume it. Partial saves have a separate result.

Gallery management reuses existing card `openDetails` local UI persistence.
Expand/collapse does not touch sources, awards or unread state. Localized
Bronze/Silver/Gold labels and exact shared conditions/units add no stored field.
One shared money-reference section shows each enabled provider's current book/date
and the non-billing explanation. Different historical books keep their exact award
associations from saved `referencePricebook` values; presentation does not relabel
or rewrite awards. Cards retain scope and pricing coverage without repeated
price/basis notes. Legacy IDs,
pins and pricebooks remain unchanged. Even a fully earned card shows the uncapped
current statistic; stale or missing evidence is not replaced by its target.

Compact expanded rows use per-rank theme colors (foreground fallback in high
contrast) and bold, right-aligned thresholds on the same header row. “In progress”
appears only on the next rank above the highest earned when proof is ready, never
on later ranks, fully earned cards or pending proof. Verified retained-log dates
appear as bare ISO dates; Evidence details explains their source once, while
title/ARIA retains provenance. If both dates exist, only the verified date is visible
and first-recorded details remain in title/ARIA; first-recorded-only dates retain
their explicit label and unknown dates remain unknown. This display precedence
does not mutate awards, rules, date calculations, catalog, records or storage.

The `root-portfolio` display name is Independent root tasks. Its existing aggregate
counts verifiable Codex root ownership with recognized positive model usage (input
or output), counting a root and its children once. It does not prove task completion,
read task content or add persisted identities. IDs, thresholds and saved awards are unchanged.

The navigation/page label Share & compare, basic equal-width badge choices and
separate rank line add no data category. The checkbox-icon repair permits
the same bundled local resource source (`webview.cspSource`) as the main webview
CSP, without enabling remote images. Broad sharing-page visual unification/beautification
and a durable usage archive are deferred to the next version; version 2.5.0 adds
neither. Current derived caches are not a promised durable usage archive.

Log-derived per-level dates are runtime-only annotations (`schemaVersion: 1`),
bound to `ruleVersion`, timezone, catalog shape and current source/pricing context.
Source changes, OFF, timezone and price changes rebuild or withdraw this derived
cache. It adds no persistent store and does not alter canonical v2 original
`recordedDay`, unknown dates, unread state or storage schema. The earliest date
verifiable from retained logs is not the account's actual complete history and
remains distinct from when the extension first recorded an award.

Supported volume/output/cache/model/family/activity/weekly dates automatically reuse
materialized days and strictly verified fully dated Codex files. Active-day counts
and streaks include today's positive activity and use that day; qualified family/day
conditions require a closed day and use day + 1. Four-week windows exclude the first
incomplete week using the first positive activity day, not leading zero-only rows.
This follows existing rules. Only manual calibration additionally reduces already-held,
uncapped Claude record memory for output-session, Fable-session and same-session
Fable/other-family dates. Date reduction uses only materialized numbers or held
record usage metadata, without extra log-body scans, conversation-content inspection
or metadata export. Normal incremental refresh may read allowlisted new/changed
JSONL under existing analysis settings, without forced full rereads, new scanners or
network access. Ordinary warm updates do not regroup those records for dates. Joint-agent/effort,
hour/night, single-task money and timestamp-less migrated local-action dates remain
unknown or retain first-record dates; today is never invented as a replacement.

Calibration is local-only, single-flight and incremental, with no forced full scan,
old-award clearing, OAuth/quota, online pricing, BYOK or other network call. A pending
guard pauses historical grants and baseline advancement while real native receipts are staged; the guarded
commit reconciles history quietly without new notices or forced grants. Busy work,
an unaccepted current index census, failure or pre-commit cancellation is not success.
Verified partial history retains lower bounds or unknowns; completion does not mean
all award scopes are fully covered. Cancellation before the historical commit adds no historical awards;
after a valid atomic commit, saved records remain and late cancellation must not
misreport the completed commit.
Future date handlers require an explicit allowlist and rule-version isolation;
new scopes default to unknown, and future catalog envelopes remain read-only and
fail closed. Source parsers, dependencies and package version are unchanged.

Codex achievement reuse compares the rebuilt full file census and independent
witnesses exactly, then reuses detached, deeply immutable copies for revision and
calendar/money-projection memoization. Flags or matching totals alone do not prove
equality. These copies and caches are runtime-only, not another persistent index;
source reads, exported identity and clearing boundaries are unchanged.

Flat Claude `agent-*.jsonl` files without a path-proven parent are excluded only
from session-achievement evidence. Token totals, prices, daily aggregates and
visible session rows remain unchanged. Nested agents retain their parent-path
contract, source logs stay untouched, and cached/saved awards are retained.

`enableAchievements` defaults to true. The once-only upgrade reminder reuses
`ccu.lastSeenVersion`; it requests no new permission, opens no panel automatically,
respects disabled release reminders and preserves an existing achievement opt-out.
Historical unlocks are saved quietly before new-activity notifications become
eligible. Later notices are brief, dashboard-only, and never play sound or move focus.
Night/24–48-hour output badges do not produce these notices.

The host's 64-character achievement proof revision is memory-only, streamed
from existing numeric/identity aggregates, never logged, persisted or exported.
It separates proof changes from chart changes without retaining a second index
or reading logs. Turning achievements off skips this projection and evaluation;
source replacement retires the cached proof. Existing grants remain saved.

Codex calendar witnesses are runtime-only projections of the provider's independent
current contribution size/offset/prefix/zone, admitted only with a verified current
manifest and complete base index, without period migration, oversized-line discard
or lineage reconciliation.
`sourceRevision` binds the full census, global calendar fence and numeric day
vectors in the existing hash/cache; ancestry is resolved before date selection.
Neither witnesses nor revisions are logged, persisted or exported; they add no
raw identity exposure, index field, I/O, timer or store. Weekly money coverage's
`scopeLowerBound` is only a runtime marker alongside numeric coverage, distinct
from pricing coverage; no subset identity list reaches the UI or exports.

Nine fixed, memory-only evidence-domain latches distinguish first/recovered
history from later eligible awards. Pending or stale proof is shown explicitly,
not as zero usage; saved awards remain independent. No action history, new
persistent key, source identifier or network request is added by these latches.
Record loading, unavailable, changed and disabled states have explicit eight-locale
copy before gallery counts render, rather than an apparent empty `0 / 0` catalog.
A verified Claude cumulative subtotal remains a `≥` lower bound while an enabled
Codex source is unverified. Next-target names/ranks and duplicate-free SVG rank
labels are display projections, with no new stored fields or award authority.

Plugin notices require an actual target crossing in a successfully saved local
action delta. Hydrated/imported actions grant quietly; re-enabling does not turn
them into new actions. At most six public plugin-rule IDs are held temporarily
in memory until their grant saves, or the feature is disabled/cleared. There are
no action timestamps in that provenance latch. A failed grant save can retry without
repeating the action. Provider-log proof retirement does not cancel these independent
local-action awards. Saving while the dashboard is hidden/closed does not open or
refresh it. This provenance guard is not a durable missed-notice journal.

Intermediate Token stages are ephemeral display targets derived from formal
thresholds, not new awards. They store no milestone history, produce no notices,
and never become selectable export badges.

The automatic overview retains at most six public series/rule selection keys
(three badges plus three goals) in host memory during a visit. It adds no timestamp, usage history or
share consent. Entering the gallery can recompute this small display selection
from accepted aggregates without reading logs. Manual pins and first-record dates
use the canonical envelope below, not a second Webview preference copy.
Manual mode shows only up to six chosen themes, with saved order and no automatic
fillers. Closed-card pin controls and the searchable editor use the same lease;
bulk selection/reorder checks the current pin revision. Nearby save errors retain
the old choice, with stable summary focus when a control is removed or disabled.
The toolbar precedes the overview; Small/Medium/Large changes collection emblems
to 56/80/112 px and showcase emblems to 56/72/96 px while preserving text/click areas.
Above 960 px, the badge column fits its content up to two overview-card widths
plus their internal gap; next targets fill the remaining space, with 16 px between
columns. At 960 px or below they stack directly with a 12 px gap; auxiliary history
sections follow both.
Count chips and decorative control icons retain the existing localized labels.
The pure `achievementUiIcons` module renders known inline SVG paths without
dependencies, network access or additional asset files. These presentation changes
add no stored fields or source reads and preserve controls, persistence, eligibility
and message protocols. Early-data evidence remains under investigation; no data
repair or new validation pass is claimed here.

Pending/stale card details show calendar, model-ownership, money and current-source
requirements in all eight I18n locales, with information icons on notes. These
scope requirements do not classify exact root causes, expose raw source/error
details, or confer new evidence authority.

The host returns early only for explicit
`codexWorkerCancellationRequested`, an `error` outcome with
`failureCode === 'cancelled'`, and exactly `result.diagnostic?.failedFiles === 0`.
A missing count remains unknown and follows failure/revocation behavior.
The zero-count check is defensive: the current producer reports `failedFiles: 0`
on terminal cancellation/throws because final file diagnostics are unavailable.
It does not prove that no files failed before cancellation.
The cancellation result supplies no applied snapshot, success timestamp or new
acceptance receipt; prior failed state and last successful time remain intact.
Processing resumes after a fresh successful scan. The interrupted result does not
authorize new awards; subsequent history-only reconciliation remains import-only,
without live dates or notices. All error results mark the manifest incomplete.
Reported nonzero/missing failure counts, other errors and unowned cancellations
retain failure/revocation behavior. Tests supplying a nonzero cancelled count cover
a defensive host branch, not a failure census supplied by the current producer.

Valid period-migration checkpoints now resume with `tokenEventsSeen` below the
inherited prefix when `days` is empty. Their bounded cursor advances across passes,
persistence/restart and cancellation; dates are promoted only after the complete
prefix, EOF and current-timezone witness checks. Reviewed regressions cover
batching, persistence, cancellation, negative EOF cases and unchanged warm reads
of zero bodies. Undated, oversized and conflicting evidence remains conservatively
pending; this does not resolve every missing date.

The gallery persists only `all` / `next` / `earned` filter and small/medium/large
size enums in existing Webview UI state; disclosure keys are public series IDs. The sharing
return route remembers only a Claude/Codex enum and a one-shot focus boolean. They contain no
usage, paths or identities and are removed by Reset Dashboard UI State. Opening,
filtering or expanding the gallery does not read logs or add network calls.
Current-statistics navigation also keeps one public theme key and a provider enum
in that same UI state until return, ordinary navigation or UI reset. It stores no
dates, models, paths or new action history and does not scan provider logs.
Explicit sharing can include retained earned badges from a disabled provider.
The gallery and new pins filter by enabled providers. Retained badges do not supply
current progress or new grant authority, and sharing does not re-enable a provider
or read its logs.
Badge-sharing preferences remember only manually selected public rule IDs (at
most nine). One accepted SVG and its opaque preview handle stay in provider
memory, not on disk as an export history. The current language is checked before
export; switching language never silently saves an outdated-language preview.
Export writes those exact preview bytes;
replacement, reset, disable or panel close releases the retained artifact.

The extension-owned ledger contains only the following validated fields:

- `globalStorage/achievements-v2.json`: the canonical award envelope, at most
  64 KiB and one current record for each of 178 public rule IDs. Fields are schema/catalog/rule
  version, monotonic clear generation/record sequence, four reason enums
  (`existing`, `history`, `usage`, `activity`), unread boolean, optional first-record
  calendar day and timezone, at most six ordered public series pins, automatic/manual
  showcase mode, pin revision and one notification
  cooldown number, plus the existing auxiliary proof described below. The entire
  envelope, including auxiliary proof, shares the 64 KiB limit. A bounded legacy
  boundary contains only the old derived-store generation/sequence/signature.
  At most 48 old-rule records retain saved awards from the 21 changed model/team/
  effort/rainbow conditions without authorizing new rules; unknown dates stay unknown.
  Money records may retain a public frozen-reference pricebook version, never
  personal amounts. Reads accept the provider's current books plus the three
  explicitly published v1 labels in `achievementReferenceBooks.ts`: Claude's
  `api-reference-2026-10-anthropic-v1` and
  `api-reference-2026-10-aws-bedrock-in-region-v1`, and Codex's
  `api-reference-2026-10-openai-v1`. Changing the current book does not relabel
  saved records; new `append` and `recordUsage` drafts require a current provider
  book. Historical readability does not authorize a new grant. This registry
  adds no prices, IDs, storage fields or schema and does not admit future books
  by string pattern. Unknown non-current books fail closed, leaving the entire
  envelope untouched even by Clear All; the exact deletion scope is not broadened.
  Notice reservation
  updates the shared five-minute cooldown, not unread state. Only foreground display
  confirmation with a current opaque runtime token reads its represented IDs through
  the issued sequence; other/later awards remain unread. Failed delivery, OFF, blur,
  clear or a replaced document cannot confirm a retired notice. The missed-notice
  summary is folded by default and shows at most six exact visible non-historical
  levels per group. Explicit Mark this group read saves only those IDs after
  current document/provider/source/focus/clear checks under the same lease;
  other windows' later awards remain unread. The opaque group and document
  identities exist only in memory, not in the file or network. Failed saves
  retain unread state; browsing/pinning/sharing are not confirmation. No extra
  timer or log scan is added. Earned badge details save one pin/unpin intent under the
  shared v1 lease, with at most six public keys; no award, read status or share choice
  is changed. Failed saves retain the old preference; old/OFF/clear requests are rejected.
  Disabled-source pins can be removed explicitly from a folded list of at most
  six saved public keys; this does not enable a provider or read its logs.
  The gallery shows at most three recent non-historical series and a folded
  thirty-row record projection without deleting awards. Dates are first-record
  days in their saved zones, not inferred attainment dates. Old records explicitly
  retain unknown dates; ordinary browsing is not a read ACK or sharing consent.
  Audited old awards migrate quietly with unknown dates. Verified Claude/Codex Token
  crossings and newly crossed, saved local actions retain unread first-record
  days—not inferred original attainment times. Other usage reconciliation stays
  quiet until its own new source activity can be proved. Claude cache-creation
  origin adds one safe numeric runtime component, never a persisted field.
  Claude/Codex observation windows,
  fixed numeric deltas and retry receipts exist only in bounded runtime memory;
  no new source identity or timeline is stored. Claude retains references to the
  already committed materialized inputs, not another copied log corpus. Only late history recorded after
  the observation's canonical sequence can be replaced by proven live origin;
  pre-existing history is not rewritten. Retired/disabled/cleared sources discard
  pending proof. No action timeline is retained.
  The default-on `showAchievementNotices` local setting only controls floating
  in-panel notices. Turning it off keeps grants and unread records, retires queued
  delivery/ACKs and never replays missed notices when re-enabled. It is not counted
  in the setting-exploration achievement ledger and does not start scans.
  Transactions merge the latest bytes under a cross-process lease, with flushed
  private temporary files and atomic rename. Missing-state initialization waits
  for legacy audits and does not run while OFF. Unknown/future/malformed/oversized
  or symlink files fail closed without quarantine or overwrite. Clear All deletes
  exact regular `.achievements-v1.json.<UUID>.tmp` / `.achievements-v2.json.<UUID>.tmp`
  files and related old keys under that lease, replacing the canonical v2 file with an empty clear fence
  (schema/generation/sequence, empty records/pins/activity, zero cooldown/hour
  maximum and no calendar peak), then writes an empty v1 downgrade fence. It is not
  unlinked, preventing a still-running old host from resurrecting legacy awards.
  Hosts with the old generation suspend writes until reload. Leases,
  lookalikes, unknown files and provider sources are not deleted. Inventory P12
  reports only aggregate byte/record counts, not record contents or dates.
- `globalStorage/achievements-v1.json`: read-only migration input outside explicit
  clearing; not a current award mirror. Existing v2 is authoritative after downgrade.
  Both files share the existing v1 lease; interrupted clear fences resume under it.

- `ccu.achievements.grants.v5`: audited legacy migration input of at most 124 IDs;
  real hosts do not write a grant mirror after adopting the canonical envelope.
- `auxiliary.activity` (old `ccu.achievements.activity.v2` migration input): at most 29 safe setting-key names and four feature
  enums. Only deliberate, successful local actions count; no setting values,
  secrets, paths, consent decisions or default/migration/reset events are retained.
- `auxiliary.hours` (old `ccu.achievements.hours.v3` migration input): the numeric maximum positive-output hour streak,
  capped at 48. It is not a list of human working hours.
- `auxiliary.calendarPeak` (old `ccu.achievements.calendarPeak.v1` migration input): one verified four-completed-week average
  maximum plus measurement versions, timezone and provider-presence bitmask.
  Reuse requires matching context and complete current normalized numeric evidence.
  Claude-only peaks ignore unrelated Codex parser/period versions; rule version,
  timezone, provider-presence and complete-current evidence checks remain. Any
  context including Codex still requires matching parser and period versions.
  Canonical transactions merge activity sets/hour maxima and matching-context
  calendar peaks; different calendar contexts are never combined. Real hosts do
  not mirror these fields back to cached Memento entries. The empty clear fence
  wins over every old auxiliary migration input, as well as old award IDs.
- Exact audit/migration booleans and a bounded rule-ID migration draft; unknown
  fields are rejected. Clear All includes these and known older achievement schemas
  by exact name, without deleting unrelated or future state.

Non-monetary collaboration/rainbow model recognition in `achievementModels.ts`
is independent of fixed pricing aliases. Claude admits only explicit `global`,
`us`, `eu`, `jp`, `apac` and `in` Anthropic prefixes, rejecting `xx`; recognized
named-family labels without fixed rates remain unpriced. This adds no pricing
coverage or proof of upstream model identity.

Numeric evaluation reuses materialized indexes. Six API-equivalent achievement
themes use fixed versioned USD reference prices
(`api-reference-2026-10-{backend}-v1`, dated 2026-10-09), exact known models and
complete component rates (including known Claude
cache-write TTL). They cover cumulative priced subtotals, completed Monday-start
weeks in the current data zone and one Claude session/verified Codex task tree.
Priced subsets prove a lower bound, not a bill. Monetary history stays quiet;
only the four cumulative money tiers per provider can save unread first-record
day/zone from accepted native Claude/Codex tail-window increments. Before/after
cumulative evidence and the increment must use the same frozen public pricebook;
the increment must suffice from the prior total and be necessary to the new total
crossing the tier. Price changes, imports and rebuilds do not establish live origin.
Completed-week and single-session/task money awards stay quiet with unknown dates.

Monetary-origin proof is runtime-only: public provider/backend/book version,
bounded exact units, microUSD and eligible processed Tokens. The new numeric money,
exact units and proof counters are never added to the index or award file; the award
retains only public `referencePricebook` plus its ordinary bounded record metadata.
Money-only pricebook/scope invalidation does not cancel independently valid Token
receipts; common source/index, clear, OFF and disposal guards still apply to both.
A Claude backend change also invalidates the index generation and can retire pending
Token proof. Saves recheck source/scope/book, date/timezone, clear generation and OFF
under the shared lease. Failed saves retain bounded retryable proof without an
optimistic date. Same-book provisional peer history written after the accepted
baseline sequence may be repaired; pre-baseline history or a different pricebook
keeps its saved basis/date. One accepted update uses the existing notice batch.

The existing Codex effort-breadth details consume an optional six-row runtime
`effortStatistics` DTO, cached by complete-current-index proof revision. It pools
each non-approval-reviewer root task × effort and requires that population's own
positive output; no raw root/session IDs, model labels or exact-unit strings reach
the UI. Processed Tokens, output and distinct qualifying roots jointly determine
progress using the existing shared tier constants. The frozen USD subtotal and
coverage are informational and do not qualify effort awards. Model/effort marginals
are never allocated proportionally; only a reconciled single-model or single-effort
population admits a known priced subset. Empty, unpriced, partial, invalid and
overflow states remain explicit: partial money shows a lower bound, unsafe money
is withheld; absent/incomplete evidence shows
unknown, not six zero rows. No new effort preference, rule, storage or log read is added.

Once the verified current manifest is fully indexed, positive Codex milestones
may use independently verified lineages, excluding conflicting branches and
descendants. Sound witnessed dates support activity/family/weekly Token lower
bounds; partial history cannot prove zero, a four-week mean or a retained peak.
Weekly money revalidates the full-census revision and day vectors, then requires
exact billable/model date equality in each selected fully dated file. Only positive
amounts support a partial-scope lower bound; partial zero-only/empty remains pending.
Date coverage does not imply pricing coverage: unknown prices and overflow retain
their existing states. Cumulative/task scopes and reference prices are unchanged.
This selection stays in memory; no new scan, network call or persistence is added.
Codex's per-file index additionally
stores positive-output UTC hour IDs with a verified byte offset and excluded-lineage
event count: at most 32,768 hours per file and 524,288 unique hours per snapshot.
Capacity exhaustion fails closed instead of certifying a partial hour history.
Existing indexes can complete this proof through a bounded, resumable pass, leaving
primary token totals intact. With achievements off, no extra historical proof pass
is scheduled; ordinary new-log indexing still runs.

Refreshed grants require current verified evidence; displayed stale statistics
after a refresh failure cannot grant new awards. Saved legitimate awards remain
available when the underlying rolling window expires. Source changes and clearing
invalidate queued evidence. Continuous output means recorded output in each UTC
hour, not continuous human work. Week-based rules use the configured timezone;
partial dates cannot be counted as proven zero-use dates.

Badges cover local history, which may include shared accounts and multiple sign-ins.
They do not certify identity, skill, productivity, subscription allowance or bills.
Badge sharing exports only selected public rule labels, tier markers, bundled icons,
caveats and the fixed public repository link
`https://github.com/ClaudeCodeUsage/ClaudeCodeUsage`, not source paths, account data
or logs. The SVG hyperlink contains no user-supplied URL or tracking parameters;
preview/export does not fetch it. It adds no automatic network request, external
image dependency or personal metadata. Long labels wrap with reserved spacing;
the accepted immutable preview/export seal remains unchanged. Choose up to nine earned badges
and accept a local preview before export; no automatic export, sign-in or upload.

## Clear and migration behavior

Separate Command Palette actions rebuild the Codex derived index, clear quota
history, clear advice data, reset UI or sharing preferences, and remove the BYOK
secret. “Clear all extension-derived data” first lists its targets. These
maintenance actions stay out of the dashboard Settings tab so it remains
concise. None of them deletes Claude or Codex source logs or provider-owned
credentials.

Codex indexes are isolated by log directory, profile-local salt, and data
timezone, even when VS Code profiles share extension storage. An owned legacy
checkpoint can be adopted using metadata alone; unprovable, malformed, or
oversized legacy data is left untouched. Rebuild affects the active index only
and leaves an empty checkpoint to prevent legacy resurrection. Clear All removes
all exact legacy/scoped index families in this extension storage, never locks,
lookalike files, or provider logs. Other running instances are not stopped and
may later recreate their own derived data. A separate test window or profile
does not by itself prove that its persistent writes are isolated.
When switching timezone with no target checkpoint, a complete, proven same-source
checkpoint may be reused read-only; date/hour buckets migrate without restarting
primary history. Optional reads have a shared 256 MiB / 16-candidate limit.

Clearing all quota history atomically replaces the quota store with one valid
empty schema-2 document and removes only its exact quarantine/interrupted-write
siblings under the same cross-process lease. A provider/account-only clear
fails closed when quarantined data or an unresolved legacy migration cannot be
assigned safely; the user may then explicitly choose the all-history clear.

Clear All deletes an exact catalog of released setting/state names, not every
key beginning with `ccu.setting.`. Unknown or future keys are preserved. Before
any mutation it checks all currently visible configuration scopes; an
unregistered legacy setting that VS Code cannot safely update blocks the whole
operation, leaves existing data intact, and is reported for manual removal.
Queued activation writes are drained before deletion and exact postconditions
are verified afterward. If the Webview cannot acknowledge its allowlisted
browser-state reset, a value-free pending action marker is retried on the next
panel open instead of reporting a false success. The reset button inside the
sharing workspace uses this same host request → request-id client reset → ACK
path; it reports browser-storage deletion failures and applies defaults only
after the allowlisted deletion succeeds.

This clearing boundary is separate from the opt-in Session Actions feature.
That feature can move one user-selected Claude session log to the OS trash only
after its own modal confirmation; it never participates in Clear All.

v2.3.1 validates and atomically migrates known legacy quota/config state before
removing the legacy copy. Corrupt or future-schema files fail closed; an old
valid file is not overwritten until the replacement validates. Uninstall may
leave host-managed extension storage behind, so the explicit clear command is
the reliable deletion route.

VS Code only lets the running extension inspect Global, the current Workspace,
and currently open Workspace Folder configuration scopes. A legacy value that
exists only in a closed workspace remains there until that workspace is opened
and the clear control is run again (or the setting is removed manually).

## Known limits

This inventory describes data contracts, not a release or acceptance record.
Native/F5, installed-package and performance checks require their own evidence;
browser checks do not establish those results. Live monetary award dates are
limited to verified cumulative crossings; other monetary scopes remain historical.
Source-level guards check source contracts, not executed UI transitions, native
Webview behavior or installed-package acceptance.

- A reset that never appears in an official response or local structured event
  cannot be reconstructed. A daily slice crossing a reset cannot prove exact-window usage.
- Rough archived estimates do not prove same-account ownership or complete account
  history. Actual last-observed quota percentages retain their timestamps and original resets.
- API-equivalent values use currently known public API prices and pricing
  coverage. They are estimates, not provider bills or subscription prices.
- Retention of source logs is controlled by Claude Code and Codex, not this
  extension.
