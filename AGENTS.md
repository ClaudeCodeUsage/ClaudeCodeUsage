# CLAUDE.md

Guidance for Claude Code (and human contributors) working in this repository.

## Project Overview

"Claude Code Usage" is a VS Code extension that monitors Claude Code token
usage and cost estimates in the status bar, with a detailed dashboard webview.
It reads Claude Code's local `.jsonl` conversation logs and an OAuth-backed
real `/usage` quota.

**Positioning (keep this in mind for every change):** Claude-only, lightweight,
**token-precision over cost-precision**. Cost figures are estimates derived from
public per-million-token rates — the product value is helping users *see where
tokens go* and *use Claude Code better* (incl. the AI advice feature). Not a
billing tool, not a multi-provider monitor.

## Architecture (`src/`)

- **`extension.ts`** — main class, activation, refresh orchestration. Owns the
  adaptive refresh cadence (activity-aware: ~15 s while logs are being written,
  the user's interval when idle), the re-entrancy guard + coalescing, the
  `fs.watch` recursive file watcher, and the diagnostic `OutputChannel`.
- **`dataLoader.ts`** — finds + parses `.jsonl` records; dedup (keeps the
  higher-token record on a hash collision); aggregation (today / month / all
  time / sessions / projects / branches); content analysis; diagnostic stats.
- **`statusBar.ts`** — the two status-bar items (cost + quota). Quota tooltip is
  an HTML progress bar; `liveWindows()` drops windows whose reset time has
  passed so a stale value never lingers.
- **`webview.ts`** — the dashboard (tabs, charts, tables). Large single file:
  server-rendered HTML + an inlined client script. Cost charts render as
  gridded stacked compositions.
- **`pricing.ts`** — pricing table (Anthropic + reference rates for OpenAI /
  Gemini / DeepSeek / Kimi / GLM / Qwen), family-aware fallback, LiteLLM
  runtime refresh.
- **`claudeApiClient.ts`** — OAuth credential read + token refresh + `/usage`
  fetch. Routes through the system `curl` binary because Anthropic's edge
  rejects Node's TLS fingerprint.
- **`advisor.ts`** + **`adviceDemoSample.ts`** — the opt-in AI advice feature
  and its localised static demo.
- **`i18n.ts`** — translations for en / de-DE / zh-TW / zh-CN / ja / ko.
- **`types.ts`** — shared interfaces.

## Build & Release

This repo is built with a **portable Node** (no global install assumed) and
`@vscode/vsce`. Common commands:

```bash
npm run compile        # tsc -> out/
npm run watch          # tsc --watch
npx @vscode/vsce package   # build a .vsix
```

- **F5** launches the Extension Development Host for manual testing.
- **Releases are automated.** Pushing a `v*` tag to the upstream repo triggers
  `.github/workflows/publish.yml`, which compiles, packages, publishes to the
  VS Code Marketplace + Open VSX, and attaches the `.vsix` to a GitHub Release.
  The workflow verifies the tag matches `package.json`'s `version`. So to
  release: bump `version`, update `CHANGELOG.md`, merge to `main`, then
  `git tag vX.Y.Z && git push <upstream> vX.Y.Z`.
- Versioning follows semver: bug-only → patch (`2.0.x`); new user-facing
  feature → minor (`2.x.0`); breaking UX → major.

## Conventions

- **Commit hygiene:** one meaningful commit per logical change; avoid a stream
  of "fix the previous fix" commits. RC branches squash-merge to `main`.
- **Tests:** pure-logic modules (pricing, aggregation, quota-window handling,
  i18n) are the high-value test targets. A `node:test` suite is planned
  (see issue #25).
- **Data is read-only:** the extension never writes to `~/.claude/`.

## Documentation Maintenance

When changing user-facing behaviour, update `README.md` (the canonical, fullest
doc) and keep the language editions reasonably in sync:
`README-en.md` (concise), `README-zh-CN.md` (full translation — highest-traffic
locale), `README-zh-TW.md` / `README-ja.md` / `README-ko.md` (concise).
`CHANGELOG.md` is the authoritative change record.


## Codex 工具適配
瀏覽器操作使用當前 Codex browser／computer-use 工具；原文的 Claude MCP 工具名稱只描述操作意圖，不能直接呼叫。提問依目前模式使用可用工具；Git 操作仍需當次明確授權。
