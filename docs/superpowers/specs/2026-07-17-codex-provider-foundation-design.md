# Codex Provider Foundation Design

**Date:** 2026-07-17
**Status:** Approved by the maintainer on 2026-07-17; implementation starts after v2.2.1
**Reference:** [CodexBar](https://github.com/steipete/CodexBar)
**Chinese review copy:** [简体中文版](2026-07-17-codex-provider-foundation-design.zh-CN.md)

## Objective

Add Codex as a read-only, explicitly separated usage source without weakening
Claude accuracy or implying unsupported cost/quota precision. The architecture
must support future providers while keeping provider-specific semantics inside
adapters.

## Product decision

The existing extension remains Claude Code Usage during the beta. Internally it
gains a provider-neutral core and a Codex adapter behind an experimental flag.
The dashboard exposes Claude, Codex, and Compare views. A later adoption review
decides between a unified product name and two thin Marketplace extensions
sharing one core.

## Architecture

```text
ClaudeLogAdapter ─┐
                  ├─ NormalizedUsageEvent ─ Aggregator ─ Claude | Codex | Compare
CodexAdapter ─────┘

ClaudeLimitSource ─┐
                   ├─ ProviderLimitSnapshot ─ provider-specific quota UI
CodexLimitSource ──┘
```

Historical token facts, point-in-time quota snapshots, and monetary estimates
are different contracts. They are not combined into one large snapshot.

```ts
interface NormalizedUsageEvent {
  provider: 'claude' | 'codex';
  sourceKind: 'local-jsonl' | 'otel' | 'cli-rpc' | 'oauth';
  schemaVariant: string;
  timestamp: number;
  sessionId: string;
  parentSessionId?: string;
  projectPath?: string;
  model?: string;
  tokens: {
    inputTotal: number;
    uncachedInput?: number;
    cacheRead?: number;
    cacheWrite?: number;
    outputTotal: number;
    reasoningOutput?: number;
  };
  cost?: {
    usd: number;
    basis: 'reported' | 'api-equivalent-estimate';
    pricingVersion: string;
  };
  confidence: 'exact' | 'estimated' | 'partial' | 'unknown';
  qualityFlags: string[];
}
```

`ProviderLimitSnapshot` stores observation time, source, windows, reset times,
and confidence. Quota values never participate in cross-device or
cross-provider summation.

## Provider semantics

- Claude input, cache-read, and cache-write buckets are mutually exclusive and
  additive.
- Codex `cached_input` is contained within input, and reasoning output is
  contained within output. They are never added twice.
- Repeated Codex cumulative counters use lineage/high-water logic rather than
  line-by-line summation.
- Fork and subagent sessions preserve parent baseline and parent identifiers.
- Missing parents and unknown schema variants produce quality flags; the UI
  fails visibly to partial/unknown rather than silently inventing precision.
- Source product is identified by adapter/path/schema, not by model name.

## Codex ingestion stages

### Experimental local adapter

- Discover versioned local session/rollout files under `CODEX_HOME` without
  reading `auth.json`, internal account databases, or browser state.
- Maintain fixtures for CLI, IDE/Desktop, resume, archive, fork/subagent,
  compaction, truncation, and interleaved counters.
- Treat the local rollout format as an unstable interface with schema guards
  and diagnostics.
- Use the v2.2.1 per-file index and a single-flight scan executor.

### Optional supported telemetry path

OpenAI's opt-in OTel output is a future advanced source. It remains disabled by
default, keeps prompt logging off, and requires an explicit local collector or
bridge. It does not replace the zero-configuration local beta until the user
experience is practical.

## UI and aggregation

Compare may aggregate only metrics with compatible meaning:

- total tokens;
- output tokens;
- sessions;
- active time.

Provider-specific views retain:

- cache composition and efficiency;
- quota windows;
- monetary cost or API-equivalent estimates;
- message/turn counts;
- source-specific workflow diagnostics.

Subscription usage never appears as actual dollar spend. Unknown model prices
remain unavailable instead of falling back to a guessed family price.

## CodexBar lessons adopted

CodexBar is used as an architectural reference, not copied wholesale:

- provider descriptors and ordered fetch strategies;
- per-source outcomes and diagnostics;
- per-file `mtime + size + parsed contribution` caching;
- single-flight/coalesced expensive scans;
- separate local token/cost and remote quota pipelines;
- explicit confidence and quality flags;
- fork/interleaved-counter fixtures.

The concrete references are CodexBar's
[provider authoring guide](https://github.com/steipete/CodexBar/blob/main/docs/provider.md),
[refresh loop](https://github.com/steipete/CodexBar/blob/main/docs/refresh-loop.md),
and its large-corpus performance investigation in
[issue #1392](https://github.com/steipete/CodexBar/issues/1392). The latter is
also a warning not to guess the final hotspot: metadata validation, rather
than JSON parsing, dominated one of its largest profiles.

Its browser-cookie scraping, private backend calls, direct auth-file handling,
large unified snapshot, and implicit subscription-cost assumptions are not
adopted. Any later substantive code port must preserve CodexBar's MIT notice.

## Opt-in cross-device sync

Cross-device sync is scheduled only after the Codex beta and normalized schema
are stable, provisionally v2.4.x.

- Use VS Code's built-in GitHub authentication provider for identity; do not
  embed an OAuth client secret in the extension.
- GitHub authentication and storage are separate. A dedicated sync service is
  preferred; private Gist is at most an advanced experiment, not the default
  database.
- Sync only aggregates keyed by device, provider, day, and model.
- Never upload prompts, responses, raw logs, paths, credentials, raw session
  IDs, or local usernames.
- Use idempotent upsert with `schemaVersion`, pseudonymous device ID, revision,
  and deletion tombstones.
- Quota sync stores only the latest observation and never sums devices.
- Consent is off by default and includes a first-upload preview, data export,
  remote deletion, device revocation, and an immediate disable switch.
- Retention, encryption, account deletion, endpoint ownership, incident
  response, and privacy copy are release gates, not post-launch follow-ups.

## Version sequence

1. v2.2.1: stabilize scanning and repository/process safety.
2. v2.3: introduce provider contracts and refactor the Claude adapter without
   changing results.
3. v2.3.x: ship the read-only Codex beta and Compare view.
4. v2.4: ship a small provider-neutral local achievement set.
5. v2.4.x: preview opt-in GitHub-authenticated aggregate sync after privacy and
   deletion controls pass review.
6. v2.5+: consider telemetry, dynamic pricing, and explicit safe writes as
   separate projects.

## Acceptance criteria for Codex beta

- Fixture coverage across every supported Codex surface and lifecycle event.
- Incremental and cold scans produce identical normalized totals.
- Provider totals match their source-native totals or visibly degrade with a
  quality flag.
- No duplicate cached-input or reasoning-output counting.
- No network request when sync, telemetry, and remote quota are off.
- No credential file access.
- Compare view never sums cost or quota.
- Diagnostic export contains no prompt, raw path, or raw session identifier.

## Non-goals

- Immediate product rename;
- feature parity for unsupported Codex quota or subscription cost;
- automatic reading of OpenAI credentials;
- raw-log cloud sync;
- GitHub Gist as the production sync database;
- achievements before provider semantics stabilize.
