# Architecture

> A concise technical map of this extension — what it is, how data flows, and
> how the exact token/cost numbers are produced. Kept deliberately short: it is
> the reference a contributor (or an automated issue/PR helper) reads *instead
> of* re-reading `src/`. If you change a module's role or the data flow, update
> this file. A Simplified-Chinese version lives in
> [`ARCHITECTURE-zh-CN.md`](ARCHITECTURE-zh-CN.md).

## What it is (and isn't)

**Claude Code Usage** is a VS Code extension that reports Claude Code token
usage and cost — in the status bar and a dashboard webview — by reading Claude
Code's own local logs. It is deliberately:

- **Claude-only** — built around Claude Code's log format and Anthropic's OAuth
  quota. (DeepSeek etc. are priced as a courtesy for CC-Switch users, but Claude
  is the focus.)
- **Lightweight** — minimal UI, no runtime dependencies, secondary views
  collapsed by default.
- **Token-attribution focused** — the headline numbers are *exact*, read from
  each request's own usage accounting, not estimated.
- **Read-only** over `~/.claude` — it never writes to Claude Code's data.

**Out of scope** (use this list to triage requests): multi-provider/vendor
dashboards as a first-class feature; full billing/invoice reconciliation;
writing to or driving Claude Code; non-usage analytics. Requests that sharpen
token insight, attribution, or the advice experience are the right fit.

## Module map (`src/`)

| Module | Role |
|---|---|
| `extension.ts` | Activation, command registration, and the refresh orchestration: an activity-aware, self-rescheduling timer (faster while you're active, calmer when idle) with a generation guard and coalescing, plus `pauseDashboardRefresh`. Reads config through `SettingsStore`, runs the settings migration once, listens for workspace-folder changes (re-fetches quota), and owns `runOptimizer` (the Usage Optimizer round-trip). Wires loader + status bar + webview + quota client together. |
| `dataLoader.ts` | The data pipeline. Reads `~/.claude/projects/**/*.jsonl`, parses/validates/dedups records, harvests session titles and user-prompt markers, and aggregates everything (`calculateUsageData` + today/month/session/project/group/branch breakdowns). Also v2.1: `getWorkflowBreakdown` (multi-agent runs from `subagents/` logs + ad-hoc batches), `getUsageAttribution` (the "what's contributing" panel), `getCurrentContextInfo` + `contextWindowFor` (per-model context window, main-thread record, `estimated` flag), and the content/calibration analysis (`windowDays` configurable). The largest piece of logic. |
| `settings.ts` | **(v2.1)** Single source of truth for every user setting: the `SETTINGS` catalog (type/default/storage/group) + `SettingsStore`. A small core (`language`, `dataDirectory`, `advice.apiKey`) lives in VS Code config; the rest in `globalState`, edited from the dashboard's ⚙ Settings tab. `migrateOnce()` copies pre-2.1 `settings.json` values into the store. |
| `pricing.ts` | Per-model, per-token rate table (separate input / output / cache-write / cache-read rates), model-family inference, and `[1m]`-context-suffix stripping. `calculateCostBreakdown` turns a usage record into a four-part cost. |
| `statusBar.ts` | Three status-bar items: the primary (today's cost **or** token count, `statusBarMetric`; icon-only entry fallback when all three are hidden), the quota item (5h / weekly, opt-in `opus:NN%`), and the experimental context-window indicator (bar + breakdown tooltip, `~` for guessed windows). |
| `webview.ts` | The dashboard: tabbed views (today, sessions, projects, content, branches, workflows, **⚙ settings**), the AI-advice + Usage-Optimizer action cards, charts and sortable tables. Holds optimizer state across re-renders and skips identical re-renders. By far the biggest file — almost all UI lives here. |
| `claudeApiClient.ts` | Anthropic OAuth quota: reads `~/.claude/.credentials.json`, refreshes the token (re-reading disk first), and fetches real utilisation from `api.anthropic.com/api/oauth/usage`. Uses `httpClient` (fetch → curl). 60s cool-down on HTTP 429. |
| `httpClient.ts` | **(v2.1)** Shared transport: `requestViaFetch` and `requestViaCurl` (curl `cwd` pinned to home so a stale workspace cwd can't ENOENT it). curl is the fallback for Anthropic's TLS-fingerprint `403 "Request not allowed"` gate. |
| `advisor.ts` | The AI-advice + **Usage Optimizer** transport: `callModel` (Anthropic `/v1/messages` or OpenAI chat-completions, with the curl 403 fallback), `getUsageAdvice`, and the optimizer's pure helpers `buildOptimizerSystemPrompt` / `parseOptimizerOutput`. API-only (a dormant subscription branch remains). Opt-in. |
| `adviceSummary.ts` | **(v2.1)** Builds the usage digest sent to the advice model — aggregates + multi-agent runs + thinking share + attribution + a windowed sample of the user's own prompts. |
| `adviceDemoSample.ts` | Static sample advice (all six languages) shown before a key is configured, so the feature is discoverable. |
| `i18n.ts` | The string table for six languages (`en`, `de-DE`, `zh-TW`, `zh-CN`, `ja`, `ko`) + `SETTINGS_I18N` (per-setting label/help for the ⚙ Settings panel) and `settingText()`. Every user-facing string goes through here. |
| `types.ts` | Shared interfaces (`ClaudeUsageRecord`, `UsageData`, `SessionUsage`, `SupportedLanguage`, `ExtensionConfig`, `ContextWindowInfo`, quota + attribution + workflow types, …). |

## Data flow

```
~/.claude/projects/<encoded-cwd>/<session>.jsonl     (one file = one conversation)
        │  read line-by-line, JSON.parse each line
        ▼
validate (is it a usage record?) ─► dedup (messageId+requestId, keep higher tokens)
        │  tag each record with session id + project (real cwd preferred)
        ▼
ClaudeUsageRecord[]  ──►  calculateUsageData()  ──►  UsageData
        │                   (sum the 4 token buckets, price each)        │
        │                                                                ├─► status bar (today + quota)
        └─ session titles, user-prompt markers                           └─► webview (breakdowns + charts)
```

Quota is a **separate** path: `claudeApiClient` calls the OAuth usage endpoint
and returns five-hour / seven-day / seven-day-opus utilisation independently of
the local logs (the logs cannot know your plan's limits; only Anthropic does).

## How tokens & cost are computed (exact, not estimated)

Each assistant-response line in the JSONL carries a `message.usage` object — the
**Anthropic API's own token accounting**, the same counts Anthropic bills on.
The extension does not estimate these; it reads, validates, dedups, sums, and
prices them:

1. **Validate** — keep only records whose `usage.input_tokens` is a number (real
   API responses); skip synthetic/error/`<synthetic>` model entries.
2. **Dedup** — hash = `messageId + requestId`; on collision keep the
   higher-token copy (handles proxies that log a placeholder line first, then
   the real values).
3. **Sum** the four buckets into the totals:
   - `input_tokens` — fresh prompt, full price
   - `cache_read_input_tokens` — prefix served from cache, ~10% of input price
   - `cache_creation_input_tokens` — prefix *written* to cache (the
     "Input Cache (Miss)" bar), ~125% of input price; spikes on a model switch
     or after a >5-min gap (the prompt cache is per-model with a ~5-min TTL)
   - `output_tokens` — generated, output price
4. **Price** — each bucket × its per-model rate (`pricing.ts`); cost = the sum.

The **only** estimates in the product are the Content tab's character-based
"what's consuming tokens" breakdown (and the planned v2.2 model-fit /
cache-waste features) — always labelled as estimates and never folded into the
exact totals. "Messages" counts user-typed prompts only, via synthetic
zero-token marker records, so it never affects token sums.

## Log-format facts for model-core features (verified on disk 2026-06-13)

What the JSONL logs *do* and *don't* contain — the reference for any feature
that reasons about runs, models, or effort. Re-verify with a JSON-key probe
(never a substring grep — see the trap below) when Claude Code's format drifts.

- **Run config (effort / thinking budget) is NOT logged.** There is no
  `effort` / `ultracode` / `maxThinking` / reasoning-budget field on any usage
  line. The only mode record is a `type:"mode"` line carrying `permissionMode`
  (e.g. `"normal"`). **We cannot tell what effort level a run used.** ⇒ the only
  reliable "dynamic-workflow engaged" signal is the **presence of a
  `subagents/workflows/wf_<id>/` directory**, not effort. A plain Task-tool
  fan-out (no `wf_` dir) is an "ad-hoc batch", not a workflow.
  - **Trap:** a substring grep for `effort`/`ultracode` *appears* to hit — but
    only inside prompt text and tool-call logs (including this extension's own
    commands once they're logged). Parse JSON keys; never grep for config.
- **Skill / plugin attribution IS first-class.** Assistant usage lines carry
  `attributionSkill` (e.g. `"superpowers:executing-plans"`) and
  `attributionPlugin` (e.g. `"superpowers"`). These are authoritative — prefer
  them over the older `<command-name>` / `Skill` tool_use heuristic, and
  cost-weight a skill/plugin by the *exact* `message.usage` of its own lines.
- **Why native-Claude "workflows" look missing from the Workflows tab.** Claude
  sub-agent logs *do* exist (haiku/opus appear under some `subagents/` dirs).
  But when a native-Claude run uses ultracode, the expensive **Opus/Fable
  orchestration stays in the main session log**, and only cheap **haiku**
  sub-agents (or none) write `agent-*.jsonl`. A heavy Fable/Opus main thread can
  produce **no `subagents/` dir at all**. The Workflows tab groups *sub-agent
  files*, so it shows the cheap models and misses the main-thread cost — hence
  the v2.1-PartII fix to associate a run's orchestrating main session and surface
  its cost/models. **General principle:** the *expensive* model is usually the
  main-thread orchestrator; sub-agent files skew cheap. Never infer "which model
  I mainly use" from sub-agent files alone.
- **Newer fields (Claude Code ≥ 2.1)** worth knowing: top-level `entrypoint`
  (e.g. `claude-vscode`), `permissionMode`, `version`, `context_management`; line
  `type`s `mode`, `last-prompt` (verbatim last user prompt), `queue-operation`,
  `file-history-snapshot`, `attachment`, `system` (hook summaries); and on
  `message.usage`: `service_tier`, `iterations`, `speed`, `inference_geo`,
  `cache_creation` (object). Totals (`input/output/cache_*`) remain exact.

## Key invariants (don't break these)

- **Read-only** over `~/.claude` (the one write is `advice.apiKey` token refresh in `claudeApiClient`; never touch user logs).
- Every user-facing string goes through `i18n.ts` in **all six languages**; settings-panel labels/help go through `SETTINGS_I18N` (English fallback from the catalog).
- **Settings live in `SettingsStore`, not scattered reads.** Only the core trio (`language`, `dataDirectory`, `advice.apiKey`) is declared in `package.json` / VS Code config; everything else is `globalState` and must be read via the store (so `config.get` won't find it). Adding a setting = one catalog entry in `settings.ts` (+ its `SETTINGS_I18N` rows).
- New settings **default to existing behaviour** (opt-in); experimental/approximate features default OFF (context indicator, Usage Optimizer).
- **No new runtime dependencies.** External calls (quota, advice/optimizer) go through `httpClient` with the fetch→curl 403 fallback; spawn `curl` with `cwd: os.homedir()`.
- Exact totals and labelled estimates never mix.
- Advice/Optimizer send **only** the usage digest / the pasted draft — never the user's files.

## Refresh model

The dashboard/status bar stay current via an activity-aware loop in
`extension.ts`: a self-rescheduling timer whose interval shortens when you're
active and lengthens when idle, guarded by a `refreshGen` generation counter and
coalescing so overlapping refreshes can't stack. File-watching of
`~/.claude/projects` (opt-out) gives ~1.5s latency; an interval is the fallback.
`pauseDashboardRefresh` freezes updates while the panel is open for inspection.

## Release

TypeScript strict, clean compile (`node ./node_modules/typescript/bin/tsc -p ./`
— the F5/debug task uses this, not `npm`, to dodge the Windows `npm.ps1`
execution-policy block), green `node:test`. The repo lives at the org
**`ClaudeCodeUsage/ClaudeCodeUsage`**; `main` is branch-protected (PR + `test`
check). Flow (Release Drafter, set up in v2.0.3): contributors open PRs; the
maintainer **squash-merges** with a version label (`patch`/`minor`/`major`,
default patch) — that's the whole per-PR action; a **draft GitHub Release**
auto-accumulates categorised notes; clicking **Publish** tags `v*` and
`publish.yml` stamps `package.json`, packages with `@vscode/vsce`, and ships to
the VS Code Marketplace + Open VSX with the `.vsix` attached. A cross-fork PR's
attribution is preserved by squash-merge; the rare manual re-apply uses
`git merge -s ours` to keep the contributor's commits as merged ancestors.
Issue-closing PRs use `Closes #N`.
