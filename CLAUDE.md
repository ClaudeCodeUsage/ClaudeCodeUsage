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
- **`i18n.ts`** — translations for, and selectable UI languages (package.json
  enum + settings dropdown), all seven: en / de-DE / zh-TW / zh-CN / ja / ko /
  pt-BR. Keep the three in sync when adding a language: `SupportedLanguage`
  (types.ts), the `package.json` enum, and `settings.ts` `enumValues`.
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
- **Releases are merge-and-auto-release.** As labelled PRs merge to `main`,
  `.github/workflows/release-drafter.yml` keeps a **draft GitHub Release** up to
  date (categorised notes + next semver version from the PR labels). To ship, a
  maintainer reviews that draft and clicks **Publish** — which creates the tag
  and triggers `.github/workflows/publish.yml`. Publish checks out the released
  commit, stamps `package.json`'s version *from the release tag* (no hand-bump),
  compiles, packages, publishes to the VS Code Marketplace + Open VSX, and
  attaches the `.vsix`. So to release: just **Publish the draft Release** — no
  manual `version` bump, no `git tag`.
- Versioning follows semver, resolved by `release-drafter.yml` from the merged
  PRs' labels: **everything defaults to patch** (`fix` / `feature` / `enhancement`
  / `docs` / `ci` / `chore` → patch); only an explicit **`minor`** label bumps the
  minor (`2.x.0`); `breaking` / `major` bump the major. So a feature ships in a
  patch release *unless a maintainer deliberately labels the PR `minor`*.

### Pre-release checklist

Before a maintainer clicks **Publish** on the draft Release, run through this.
The steps that keep getting skipped are the CHANGELOG date and the "What's new"
section — both 2.1.1 and 2.2.0 shipped still marked `— Unreleased`.

1. **CHANGELOG date** — change the top `## [x.y.z] — Unreleased` to
   `## [x.y.z] — YYYY-MM-DD`, then `grep -n Unreleased CHANGELOG.md` to confirm
   none remain.
2. **CHANGELOG completeness** — every PR since the last tag is under
   Added / Changed / Fixed with `(#NN, @author)`.
3. **"What's new"** — add a `## What's new in <minor>` section to `README.md`
   and `README-zh-CN.md` (the two editions that carry it); for a patch, fold
   notable items into the current minor's list.
4. **Localisation parity** — new user-facing strings exist in **all seven**
   languages (en / de-DE / zh-TW / zh-CN / ja / ko / pt-BR); a new UI language is
   wired through `SupportedLanguage` (types.ts), the `package.json` enum and
   `settings.ts` `enumValues`, and added to the README language table.
5. **Settings / commands** — any new setting or command appears in `README.md`'s
   settings table and `package.json` `contributes`.
6. **Build & test** — `npm run compile` and `npm test` are clean; package a
   `.vsix` and smoke-test the changed behaviour locally.
7. **After Publish** — pull the new tag + commits so local `main` isn't left
   behind upstream.

## Conventions

- **Commit hygiene:** one meaningful commit per logical change; avoid a stream
  of "fix the previous fix" commits. RC branches squash-merge to `main`.
- **Tests:** a `node:test` suite runs against compiled output (`npm test`; see
  `src/test/` and CONTRIBUTING). Pure-logic modules (pricing, aggregation,
  timezone/date keys, dedup, share-card, heatmap, conversation-log, mini-markdown)
  are the high-value targets and now carry most of the coverage. **One concern per
  test file, named `camelCase.test.ts`** to match the module (e.g. `pricing.test.ts`,
  `dateKeys.test.ts`) — don't add dotted `x.y.test.ts` files; fold new cases into
  the existing file for that area.
- **Data is read-only:** the extension never writes to `~/.claude/`.

## Documentation Maintenance

When changing user-facing behaviour, update `README.md` (the canonical, fullest
doc) and keep the language editions reasonably in sync:
`README-en.md` (concise), `README-zh-CN.md` (full translation — highest-traffic
locale), `README-zh-TW.md` / `README-ja.md` / `README-ko.md` (concise).
`CHANGELOG.md` is the authoritative change record.
