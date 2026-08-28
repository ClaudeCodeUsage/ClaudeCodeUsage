# Claude Code Usage

🌐 **Language**: [🏠 Main](README.md) | **English** | [繁體中文](README-zh-TW.md) | [简体中文](README-zh-CN.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Bahasa Indonesia](README-id.md)

---

**The local Claude Code and Codex usage coach in your status bar.** Not a billing tool. Claude retains its cost and quota views; Codex Beta adds token and behaviour insights with Codex-native semantics.

> **What it is:** a VS Code status-bar monitor that reads your local Claude Code conversation logs and shows **token-derived** usage and cost estimates — plus an optional AI advisor that suggests how to improve your prompts and reduce waste.
>
> **What it is _not_:** a billing tool. All amounts are estimates based on public per-million-token rates. Refer to your Anthropic account for actual charges.

> Screenshots are from the English UI. See the [main README](README.md) for the full feature reference.

## Screenshots

### Status bar

![Status bar](images/v2-status-bar-en.png)

Hover the quota indicator for a breakdown:

![Quota tooltip](images/v2-quota-en.png)

### Dashboard

![Dashboard](images/v2-dashboard-en.png)

## Features

- **Status bar** — today's cost, current-session cost, and real 5-hour / weekly quota (`5h:N% wk:N%`) read from Claude Code's own OAuth session. Zero configuration.
- **Dashboard tabs** — Today / This Month / All Time, plus **Sessions / Projects / Content / Branches**, all sortable.
- **Stacked cost-composition charts** with a Y-axis and reference lines — see at a glance how much of each day / month went to input, output, cache-write and cache-read.
- **Content tab** — estimates which content consumes your tokens (your prompts vs. tool results vs. assistant output / thinking).
- **AI advice** (opt-in) — sends a usage summary plus a sample of your prompts to an OpenAI-compatible API (DeepSeek V4 Pro by default) and suggests concrete rewrites. Bring your own key, or preview a static demo first.
- **Multi-vendor pricing** — Opus 4.x / Sonnet 4.x / Haiku 4.5 verified against Anthropic's public pricing; reference rates for OpenAI / Gemini / DeepSeek / Kimi / GLM / Qwen with family-aware fallback. `Refresh Token Pricing` pulls live LiteLLM data.
- **Personalisation** — language, timezone, decimal places, compact numbers, project grouping, dashboard auto-refresh toggle.

## Codex Beta in v2.3

- Codex usage records are discovered only from `sessions/**/*.jsonl` and `archived_sessions/**/*.jsonl`; credential, database, and unknown files remain excluded. Separately, the extension streams exactly `$CODEX_HOME/session_index.jsonl` to map `id` to `thread_name` for truthful thread titles. Absolute paths are redacted and titles remain memory-only. Usage-record JSONL lines are streamed and temporarily parsed only to extract allowlisted usage and structural metadata; prompt, response, command, and tool-argument fields are not inspected or used for analysis, and are never retained or persisted.
- **Processed** means input + output, **uncached usage** means uncached input + output, **cached input** remains a subset of input, and reasoning remains a subset of output. The overview also shows input cache hit rate as cached input / input. Codex billing cost is not shown. Its first summary card is a clearly labelled API-equivalent cost estimate for the selected scope, and the All-time view shows the weekly trend on the same pricing basis; Claude / Codex / Compare keep each provider's accounting separate.
- Codex **Today** means the current calendar day in the configured timezone. It adds exact hourly API-equivalent cost beside a separate token-composition view; daily and monthly primary charts also default to API-equivalent cost while token composition stays separately visible. Only exact known-model prices contribute, so unknown models remain unpriced and pricing coverage stays visible. The additive, schema-3-compatible hourly sidecar processes only canonical files already known to contain today, is checkpointed and resumable, and does not force a full-history reindex.
- Request-level attribution prefers valid `last_token_usage` components; its `total_tokens` is active-context size, not request usage. A full numeric total-plus-last signature suppresses only proven replay from the same pseudonymous rate-limit source or an immediately adjacent duplicate. Missing last snapshots fall back to cumulative lineage high-water. Upgrading triggers one automatic reindex, while the indexed subtotal remains visible throughout the pass.
- Claude and Codex All-time / Compare views calculate historical used equivalents directly from local token logs. The newest valid official reset observation anchors one sequence of unique, non-overlapping weekly periods, so each usage event is counted once; without a usable observation, usage-only rows fall back to Monday-to-Monday UTC calendar weeks. Any overlapping, non-aligned future reset is a conflict even when its series name differs; it cannot create another current period, and period ranges are shown separately from reset times. Codex usage is stored in daily slices: when one crosses an official intraday reset, its tokens are still counted once, the affected period is labelled a boundary approximation, and only used equivalent is shown. This display rule does not change the index schema or trigger a rebuild. Codex historical periods are always used-value-only. Only the newest current period may infer a total when the reset is unambiguous and indexed usage can be attributed to one observation source; current unused value remains withheld. Multi-sign-in usage that cannot be attributed reliably also stays used-only, without inventing an account split. Current official API rates are applied consistently across history. This is a proxy, not a bill or an official subscription price. The panel is enabled by default and can be hidden in Settings with `showWeeklyEquivalentValue`. Claude records profile-scoped quota observations from this release onward.
- Switching to Codex keeps the established Today / Month / All time / Sessions / Projects / Content / Settings structure, relabelled where Codex semantics differ. Both providers use the same render functions, HTML classes, charts, tables, spacing, and responsive rules; their time-series charts stay width-aligned while dense content scrolls inside its own region. Codex recommendations use indexed 30-day structural evidence.
- Root tasks use the latest real thread title after path redaction. Child rows prefer their own real thread title; when it is missing, they use the reported nickname and display the parent/root title; if those are also missing, they receive a localized neutral fallback. Project names use the Git repository name, or the directory basename outside Git. The extension does not invent Branches or Workflows that cannot be measured reliably.
- Rolling 7-day and 30-day values use exact event-day slices in the configured timezone. During an incomplete migration or rebuild, every Codex card, table, project, session, recommendation, and status value is visibly an **indexed subtotal**; unverified legacy totals are excluded. Once a Codex home is detected, its provider tab appears immediately; the page shows exact indexed-file, percentage, and byte progress during the first build, while Compare waits until both providers have real data. After the first atomic checkpoint, the complete subtotal dashboard stays usable while indexing continues; progress never replaces its cards or tables. A selected Codex home is account-agnostic, so logs left by multiple sign-ins in that same home are combined. Local logs expose no reliable account identity, so limit cards remain **last-observed** and are never summed.
- Each recommendation presents an observation, readable evidence, and a conditional action only when the indexed 30-day structural aggregates support it; no evidence means no generic advice.
- The persistent index stores machine-salted pseudonymous keys; numeric and structural aggregates; and sanitized project, directory, agent, model, effort, role, time, and quality metadata. It never stores raw IDs, full paths or repository URLs, thread titles, or conversation bodies.
- The shared Settings tab shows only common and Codex-effective controls when Codex is selected. Codex collection and local Codex recommendations can be disabled independently; the background watcher delay is configurable (30 seconds by default, with Off and longer intervals available). A first-time index or incomplete legacy migration gets one bounded 64 GiB / 16,384-file-pass streaming ceiling; it does not reserve that amount of memory and remains cancellable and resumable. After convergence, background work returns to 128 MiB / 64 file passes and the always-visible Refresh action uses 2 GiB / 512 file passes. Unchanged warm refreshes still read zero usage-record JSONL body bytes.

## Install

Search for **`Claude Code Usage`** in the Extensions view (`Ctrl+Shift+X`), or:

```
ext install GrowthJack.claude-code-usage
```

Also on the [Open VSX Registry](https://open-vsx.org/extension/GrowthJack/claude-code-usage) for Cursor / Windsurf.

## Configuration

Open Settings (`Ctrl+,`) and search for **`Claude Code Usage`**. All settings are optional. The most useful:

- `language` — UI language (`auto` / `en` / `de-DE` / `zh-TW` / `zh-CN` / `ja` / `ko` / `pt-BR` / `id`).
- `timezone` — IANA timezone for date display (e.g. `Asia/Hong_Kong`).
- `usageLimitTracking` — show the real 5h / weekly quota indicator.
- `showCost` / `showContext` — toggle the cost item and the context-window fill indicator (like `/context`) in the status bar.
- Each of these status-bar items is opt-out — set `usageLimitTracking`, `showCost`, or `showContext` to `false` to hide just that one.
- `advice.apiKey` — API key for the AI advice feature (OpenAI-compatible).
- `pauseDashboardRefresh` — pause dashboard auto-refresh (also toggleable in the dashboard header).

See the [full settings table in the main README](README.md#configuration).

## Troubleshooting

**"No Claude Code Data"** — make sure Claude Code is installed and used at least once; check the `dataDirectory` setting (auto-detection looks at `~/.claude/projects`).

**Quota shows `5h:--% wk:--%`** — log in to the active Claude profile once.
Credentials follow explicit `dataDirectory`, then the first valid
`CLAUDE_CONFIG_DIR`, then `~/.claude`; the global macOS Keychain item is used
only for the default profile.

**Usage history is missing older months** — Claude Code deletes logs older than `cleanupPeriodDays` (default 30). To keep more, set `{ "cleanupPeriodDays": 365 }` in `~/.claude/settings.json`. Already-deleted logs can't be recovered.

**Token counts are lower than Claude Code's `stats-cache`** — one response can
produce separate `thinking` and `text` transcript rows with the same
`messageId`, `requestId`, and complete `usage` vector. The extension counts the
response identity once and keeps its largest vector; Claude Code's `stats-cache`
sums the rows. The extension does not multiply its total to match that cache.

**Token counts lower than your provider's dashboard** — some proxies / dynamic workflows write per-agent records to sub-directories that may be incomplete. Your actual spend is on your provider's billing page. Native workflow attribution is planned.

**High CPU or sluggish refresh on a large history (Linux included)**
- V2.2.1 removes the hidden 8-second active polling override and bounds the
  first-timestamp scan. Until you install it, set **Live refresh delay** to
  **Off**, set **Refresh interval** to **300–900 seconds**, and optionally turn
  **Content analysis** off. Turning Dashboard auto-refresh off by itself does
  not stop status-bar parsing.
- If V2.2.1 still runs hot, open **Show Diagnostic Logs** and attach only the
  anonymous `refresh:` lines to issue #70; they contain counts and timings, not
  prompts, paths, session IDs, credentials, or raw log lines.

## Credits

Forked from [`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage). MIT-licensed. Community contributions credited in [CHANGELOG.md](CHANGELOG.md). Many code changes drafted with [Claude Code](https://claude.com/claude-code).

Development-tool credit: repository maintenance uses both [Claude Code](https://claude.com/claude-code) and [OpenAI Codex](https://developers.openai.com/codex/). This credits tools separately from human contributors; Codex is not added to Release Drafter's contributor list and receives no fabricated `Co-Authored-By` identity.

**Issues, PRs and ideas are warmly welcomed** — that's how the project grows.

## License

[MIT](LICENSE)
