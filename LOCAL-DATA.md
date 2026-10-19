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

## What the extension reads and retains

| Data class | Source | What is retained by the extension | Retention and clearing | Remote interaction |
|---|---|---|---|---|
| Claude usage records | Claude Code's local `projects/**/*.jsonl` | Runtime usage records and an in-memory per-file index; bounded prompt samples only when content analysis is enabled | Released on window reload/exit. Data controls never touch source logs; the separately opt-in Session Actions feature may move one exactly confirmed log to the OS trash (recoverable) | None unless the user separately previews and sends an advice request |
| Codex usage records | `.jsonl` and `.jsonl.zst` regular files recursively under `$CODEX_HOME/sessions` and `$CODEX_HOME/archived_sessions` | A schema-3 incremental index of pseudonymous file keys, decoded offsets, numeric usage, dates, model/effort, sanitized structural aggregates, and optional compressed-source fingerprints/EOF marker | Until rebuild, explicit clear, schema replacement, or host removal | None |
| Codex titles | Exactly `$CODEX_HOME/session_index.jsonl` | `id → thread_name` is streamed for runtime display; titles are not written to the index | Runtime only | None |
| Weekly estimate preview | Existing local aggregates and local/opt-in official quota samples | `weekly-estimates-v1.json`: fixed numeric/enum snapshots, pricing version, optional calibration range, internal account HMAC, leased source-local account ordinal and linked/unlinked diagnostics | Revisions preserve history; 4096 entries / 1 MiB stop new writes, no eviction. Selected-account clear preserves other/unassigned records; provider/all clear includes the archive | Calculation/chart projection has no network; optional official sample acquisition uses the daemon boundary below |
| Quota observations | Claude official response, structured Codex local events or opt-in `codex-official-api` sample | Provider, machine-local anonymous scope, original observed/reset times, fractions, window identity, source, confidence and flags; no raw account ID/email | At most 180 days and 512 observations per provider/account/period after compaction; clear separately or with all derived data | Enabled Claude lookup contacts Anthropic and may refresh its credentials. Optional Codex read can contact OpenAI through the existing daemon, whose authentication may refresh; the extension reads no Codex credentials |
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
still require full-census lineage deduplication. Encoding/physical-version changes
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
`app-server proxy` carries WebSocket frames over stdio. Protocol compatibility
was checked with CLI 0.163.0-alpha.10.2. The only application messages are
`initialize`, `initialized` and `account/rateLimits/read`. The extension never
starts the daemon, initiates login or reads credentials. The quota API can
contact OpenAI, and daemon-managed authentication may refresh credentials;
a local proxy connection does not make this operation network-free.

The host rejects custom Codex homes and remote extension hosts. Reads require
the dashboard to be visible and the window focused; automatic attempts are at
least 60 seconds apart and manual attempts at least 10 seconds apart. Existing
refresh/visibility callbacks drive them, with no extra recurring timer.
Failure, cancellation or unsupported sources produce unavailable state, not a
substitute account from local logs. Successful current quota identity does not
prove ownership of local usage.

`codexAccountEstimate.ts` owns a runtime-only baseline for `account-delta-v1`.
Failure, reset, clock discontinuity, a real gap over five minutes between reads,
source/account or pricing change, blur and extension restart retire both the
accumulated run and monetary baseline. Recent-observation continuity is tracked
separately from that baseline: a valid unsaturated unchanged-percentage read updates
`lastObserved` while preserving the original monetary baseline. Continuous
unchanged reads can therefore span more than five minutes without discarding
the work awaiting a percentage increase.
Calibration requires complete current-index,
all-time and identity coverage (`coverage.identity.complete`); index rebuilds or
`indexGeneration` changes reset the baseline. Unmatched or conflicting local
sources are excluded. Each admitted interval must have an increase of at least
one percentage point and end below 100%. Compatible admitted intervals within
the continuous run are aggregated: `linkedLocalDeltaUsd` is the sum of their
linked local priced increments (ΣlinkedUSD), and `deltaPercent` is the sum of
their matching percentage-point increases (ΣdeltaP), not just the latest pair:

```text
F = linkedLocalDeltaUsd / (deltaPercent / 100)
R = F * (1 - p / 100)
```

This is a quota-scoped local incremental proxy, not an owned account total or a
complete cross-device amount. `usedEquivalentUsd` is the sum of admitted
calibration increments, and `calibrationStart` preserves the run's first
admitted interval start. The unused estimate
is frozen at the same as-of sample. Never subtract later local usage to create
a live balance. A successful daemon read establishes protocol availability;
real account switching and A → B → A continuity remain unverified. Synthetic
coverage is not real-account acceptance.

For historical Codex logs, `weeklyEstimate.ts` builds `LocalWeeklyEstimate`
records with `series-prefix-v1`: a file's usage joins that file's own quota
observations by local `sourceKey`, not account names. Ambiguous or unmatched
sources are excluded from that sample, rather than pooling every source into
each counter. `linkedSourceCount` counts linked local sources, not accounts;
`unlinkedEquivalentUsd` reports excluded local value. Overlapping samples'
diagnostics must not be summed. Source-less fallback and saved
`rough-prefix-v2` / `legacy-prefix-ratio` records stay explicitly unassigned;
a current quota identity never relabels old history.

Historical rough prefix conversion uses positive priced local value U and
0 < p <= 100: `F = U / (p / 100)`. Partial pricing, account-unattributed history,
uncertain boundaries and partial local indexing lower confidence; they do not
by themselves suppress rough numbers. Unknown prices contribute no invented
dollars: do not divide U by token pricing coverage to fill the gap. Missing a
valid percentage or positive priced value means unknown, not fabricated zero.
A boundary-crossing daily bucket may enter only the rough numerator using an
explicit uniform-in-time assumption. Actual usage accounting is not split.
Counter decreases start a new observation segment; each segment stops at its
first known saturated sample when it reaches 100%.

Legacy `paired-delta` is evaluated independently over its exact, fully priced
interval. Earlier unknown-price usage outside it cannot disqualify a valid
pair. It requires an explicit common `windowId` and known per-sample
`percentageErrorBound`. Unknown error bounds fall back to a rough estimate
without inventing `fullRange`. With local increment ΔU, fraction change d and
summed fraction-error bound q (d > q), [ΔU/(d+q), ΔU/(d−q)] is a conditional measurement
range, not an account-capacity confidence interval. `fullRange` and
`calibrationStart` preserve that interval. None of these methods supplies the
independent `WeeklyEquivalentUsage.accountSeriesKey` and
`inputs.accountUsageCoverage` proof needed for `owned-window`.
`showWeeklyQuotaPace` remains a separate elapsed-time forecast.

`weeklyEstimateChart.ts` selects the latest valid estimate per local
`accountNumber` plus actual reset window. Both segments share the same
observation snapshot: blue estimated used = F - R, green estimated unused = R,
total height = F. A paired delta of 30 with F = 150 and R = 90 gives blue 60,
not 30. Never add current actual usage to old unused value. Suppress old
display-grid buckets that overlap a selected observed window so they do not
appear a second time; older unobserved periods retain non-overlapping usage-only
bars. Their seven-day grid is display alignment with Monday-to-Monday UTC
fallback, not a historical reset schedule. Account windows may overlap and are
not summed. Only the latest unexpired observation can be current; a numbered
account also requires an available matching current identity.

The chart performs no new estimate inference or persistence and does not
change primary local statistics. Table actual-used columns remain separate;
estimate column headers identify estimates, while monetary cells omit ≈.
Every quota percentage retains its observed timestamp and original reset.
Public account labels are local ordinal numbers, not identities or account
names. Current quota identity still does not prove local usage ownership.

`quotaObservationStore.ts` accepts `codex-official-api` through
`codexQuotaCaptureFromOfficialSample`. It copies only original numeric
observation/reset times, percentage and a validated account HMAC, using
`official-account-scope-v1|` for the stable identity namespace. No raw account
ID, email, plan or credentials enter that adapter or store. Existing schema-2
retention, compaction and clearing apply; local-log captures stay unattributed
and separate. An older schema-2 reader rejects the unknown source enum:
compatibility is one-way, not a schema downgrade.

`weeklyEstimateArchive.ts` retains fixed numeric/enum DTOs in
`weekly-estimates-v1.json`: original times, amounts, pricing coverage/version,
method/flags, optional calibration range, `unlinkedEquivalentUsd` and
`linkedSourceCount`. The existing internal `accountScopeKey` is now used;
source-local `accountNumber` is assigned and persisted under the shared lease.
Source/window keys and account scope use machine-salted HMAC. Only the ordinal
number reaches the public projection; HMACs, source keys, paths, raw IDs, email
and conversation content never reach HTML/export. Old records retain their
method, pricing version and unassigned status rather than being relabelled.

Archive revisions preserve past snapshots with no expiry or eviction. At 4096
entries or 1 MiB new writes stop; reads remain available. Mutations reread under
a cross-process lease and use symlink checks and atomic 0600 replacement.
Current readers accept the new methods and older records; older preview readers
can reject new methods/fields. Preserve derived archives before rollback;
provider-owned logs are not modified.

`weeklyEstimateCoordinator.ts` keeps bounded memoized projections and queued
archive work; projection reads no raw logs and creates no network requests.
Selected-account clearing uses internal fingerprint and durable cutoff fences,
preserving other accounts and unassigned records. Provider/all-history clears
also cover the archive; queued stale observations cannot restore cleared data.
Unchanged projections do not repeat archive I/O merely as time passes.
Dependencies, primary ingestion/index schema, package version and the
default-on `showWeeklyEquivalentValue` display setting are unchanged.

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
