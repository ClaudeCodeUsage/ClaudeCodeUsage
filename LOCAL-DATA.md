# Local data and privacy

Claude Code Usage is local-first. It reads provider-owned usage logs, stores
only bounded derived state needed for fast refresh and reset-aware estimates,
and never treats API-equivalent cost as a bill.

This page is the user-facing inventory for the v2.4 development line, including
the unreleased 2.4.2 local-achievements candidate. The
v2.3.1 normative field-level contract is in
[`docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.md`](docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.md).

## What the extension reads and retains

| Data class | Source | What is retained by the extension | Retention and clearing | Remote interaction |
|---|---|---|---|---|
| Claude usage records | Claude Code's local `projects/**/*.jsonl` | Runtime usage records and an in-memory per-file index; bounded prompt samples only when content analysis is enabled | Released on window reload/exit. Data controls never touch source logs; the separately opt-in Session Actions feature may move one exactly confirmed log to the OS trash (recoverable) | None unless the user separately previews and sends an advice request |
| Codex usage records | `$CODEX_HOME/sessions/**/*.jsonl` and `archived_sessions/**/*.jsonl` | A versioned incremental index of pseudonymous file keys, offsets, numeric usage, dates, model/effort, and sanitized structural aggregates | Until rebuild, explicit clear, schema replacement, or host removal | None |
| Codex titles | Exactly `$CODEX_HOME/session_index.jsonl` | `id → thread_name` is streamed for runtime display; titles are not written to the index | Runtime only | None |
| Quota observations | Claude's official quota response or structured Codex rate-limit events | Provider, machine-local anonymous account epoch, observed/reset time, period, used/remaining fraction, anonymous window identity, source, confidence, and quality flags | At most 180 days and 512 observations per provider/account/period after boundary-preserving compaction; clear separately or with all derived data | Claude quota lookup contacts Anthropic when enabled; an expired Claude token is refreshed with Anthropic and written back to its credential source. Codex quota evidence is local |
| Settings and UI preferences | User choices | Typed extension settings, selected tab/filters, bounded background-work state, sharing presentation, Share Card draft controls, heatmap title/range/privacy/palette/provider/metric/show-amounts controls, gallery filter/size, and the optional display-currency preset | Until reset, clear, or uninstall; ordinary VS Code settings may participate in Settings Sync | No extension-initiated transfer; no exchange-rate lookup |
| Heatmap artifact (2.4.2 candidate) | At most 366 selected materialized civil-day aggregates | One accepted immutable SVG/Markdown artifact, opaque document-bound preview ID, source references and whitelisted config/quality identity | Runtime only; replaced/retired on control, source, pricing or display change, reset or disposal | None; preview/local export adds no source-log reads or network requests |
| Weekly quota pace (2.4.2 candidate) | Existing successful raw quota cache and original observation time | Runtime-only ≤16-window numeric projection, original-response metadata and bounded verified-account/window continuity anchors; default-off shared `showWeeklyQuotaPace` STATE preference | No extra observation store; source/credential invalidation withdraws forecasts and disposal releases runtime state | None added; does not enable quota tracking or request new credentials |
| Share destination | User-entered GitHub target | One versioned `ccu.heatmapDestination.v1` object containing optional `owner/repository/path`; no GitHub credential | Until sharing preferences are reset | Only after an explicit publish action and exact destination confirmation. A successful write is reported even if saving this convenience preference fails |
| Advice evidence | Derived local aggregates and explicit feedback | Coarse observations, recommendations, ratings, snoozes, comparable-task metrics, coverage, and versions | Bounded local ledger; clear independently | Nothing by default; only the exact previewed request is sent after a separate action |
| Local achievements (2.4.2 candidate) | Verified numeric usage and deliberate allowlisted local actions | A ≤64 KiB award envelope with public IDs, sequence/reason/unread state and optional first-record day/zone; safe setting-key/feature enums (never values), hour-streak maximum and qualified four-week peak | Default on; off stops new grants and extra proof work. Clear all removes exact achievement state and retains only an empty clear fence | None; sharing requires explicit local preview/export, not GitHub authentication |
| Advice API key | User-provided secret | Secret value in VS Code SecretStorage only | Until the key or all derived data is cleared | Used only as the authorization credential for the explicitly configured endpoint |

## What is never cached

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

Different anonymous account fingerprints are not merged. If local Codex logs
cannot establish one coherent account/window, the dashboard shows only used
API-equivalent value and explains why it cannot claim an account-level unused
allowance.

Display-currency conversion is presentation-only. Pricing, aggregation,
persistence, sorting, and comparisons remain USD-denominated. The extension
stores only one validated preset code and resolves it against bundled reference
rates dated 2026-09-09. Rates are not editable and no lookup is performed.
Converted estimates carry `≈`; provider-native money such as actual usage
credits remains in its reported currency. The snapshot derives currency-per-USD
values from the [ECB euro reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html).

## Sharing workspace and exports

The preview-first sharing workspace reuses materialized provider aggregates; it
does not scan logs again or create another statistics cache. Its remembered
presentation is one local enum (`ccu.sharing.template`): combined activity
heatmap, Claude Share Card, Claude token heatmap, or (in the 2.4.2 candidate)
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

The candidate heatmap defaults to Tokens and allowlists Claude/Codex/Both plus
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

## Weekly quota pace (2.4.2 candidate)

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

## Local achievements (2.4.2 candidate)

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

Nine fixed, memory-only evidence-domain latches distinguish first/recovered
history from later eligible awards. Pending or stale proof is shown explicitly,
not as zero usage; saved awards remain independent. No action history, new
persistent key, source identifier or network request is added by these latches.

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
to 56/80/112 px and showcase emblems to 72/96/128 px while preserving text/click areas.

The gallery persists only `all` / `next` / `earned` filter and small/medium/large
size enums in existing Webview UI state; disclosure keys are public series IDs. The sharing
return route remembers only a Claude/Codex enum and a one-shot focus boolean. They contain no
usage, paths or identities and are removed by Reset Dashboard UI State. Opening,
filtering or expanding the gallery does not read logs or add network calls.
Current-statistics navigation also keeps one public theme key and a provider enum
in that same UI state until return, ordinary navigation or UI reset. It stores no
dates, models, paths or new action history and does not scan provider logs.
Badge-sharing preferences remember only manually selected public rule IDs (at
most nine). One accepted SVG and its opaque preview handle stay in provider
memory, not on disk as an export history. The current language is checked before
export; switching language never silently saves an outdated-language preview.
Export writes those exact preview bytes;
replacement, reset, disable or panel close releases the retained artifact.

The extension-owned ledger contains only the following validated fields:

- `globalStorage/achievements-v2.json`: the canonical award envelope, at most
  64 KiB and one current record for each of 144 public rule IDs. Fields are schema/catalog/rule
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
  personal amounts. Notice reservation
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
  Candidate hosts with the old generation suspend writes until reload. Leases,
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
  Canonical transactions merge activity sets/hour maxima and matching-context
  calendar peaks; different calendar contexts are never combined. Real hosts do
  not mirror these fields back to cached Memento entries. The empty clear fence
  wins over every old auxiliary migration input, as well as old award IDs.
- Exact audit/migration booleans and a bounded rule-ID migration draft; unknown
  fields are rejected. Clear All includes these and known older achievement schemas
  by exact name, without deleting unrelated or future state.

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

Once the current manifest is fully indexed, positive Codex milestones may use
independently verified lineages while
withholding conflicting branches and descendants. Calendar awards retain their
complete identity/date requirement. This selection is in memory only: no new
scan, network call, persisted identity list or storage field is added.
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
Badge sharing exports only selected public rule labels, tier markers, bundled icons
and caveats, not source paths, account data or logs. Choose up to nine earned badges
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

The source-integrated candidate is unreleased. Integration alone does not establish
full Node/UI, native/F5, installed-VSIX or performance acceptance; gate outcomes
are recorded separately in local candidate evidence. Browser checks cannot prove
native/F5, installed-package or Windows acceptance. Subjective appearance still
requires user review. Cumulative-only live money awards and inline Codex effort
statistics are integrated in the current source.

- A reset that never appears in an official response or local structured event
  cannot be reconstructed. Day-only Codex evidence lowers boundary confidence.
- Local Codex histories may include several sign-ins. Ambiguous overlap remains
  used-only; the extension never invents an account split.
- API-equivalent values use currently known public API prices and pricing
  coverage. They are estimates, not provider bills or subscription prices.
- Retention of source logs is controlled by Claude Code and Codex, not this
  extension.
