# AGENTS.md

Repository guidance for OpenAI Codex and other agentic contributors. A faithful
Simplified-Chinese review copy lives in [AGENTS.zh-CN.md](AGENTS.zh-CN.md).

## Product identity and scope

- Claude Code Usage is a VS Code extension that reads Claude Code's local JSONL
  usage logs and displays exact token totals, cost estimates, and OAuth quota.
- The product remains Claude-only in v2.2.1. Codex is a development tool in
  this release, not a completed usage provider or a reason to rename the product.
- Prefer token-attribution accuracy over billing precision. Keep exact totals,
  labelled estimates, and point-in-time quota observations as separate concepts.
- Keep the extension local-first, lightweight, and read-mostly. Never modify
  Claude conversation JSONL files. Treat credential handling as security-sensitive
  and preserve the existing reviewed behavior.
- Add no new runtime dependencies in v2.2.1.

## Architecture boundaries

- `src/extension.ts`: activation, commands, refresh orchestration, watcher,
  coalescing, settings changes, and diagnostic output.
- `src/dataLoader.ts`: JSONL discovery/parsing, deduplication, attribution,
  content analysis, and usage aggregation.
- `src/settings.ts`: the `SETTINGS` catalog and `SettingsStore`; do not scatter
  direct configuration reads.
- `src/statusBar.ts`: status-bar token/cost/quota/context presentation.
- `src/webview.ts`: dashboard HTML and client behavior.
- `src/i18n.ts`: all user-facing copy for all seven UI locales.
- `src/types.ts`: shared contracts.
- Read `ARCHITECTURE.md` before changing module ownership or the data flow. If
  that change is submitted for maintainer review, also provide a faithful
  Simplified-Chinese review companion.

## Safety and privacy invariants

- Never upload prompt text, response text, raw JSONL lines, absolute paths, raw
  session IDs, credentials, or local usernames. New v2.2.1 performance
  diagnostics must not log them either; do not broaden older diagnostic output
  without an explicit privacy review.
- Advice and optimizer network calls remain explicit user actions and may send
  only the documented digest or text the user pasted.
- New settings default to existing behavior. Experimental or approximate
  features default off.
- Do not read secret or credential files merely to diagnose a feature. Use
  redacted metadata and fixtures.
- Do not hand-edit generated files in `out/`; edit `src/` and compile.

## Development and tests

```bash
npm ci
npm run compile
npm test
npx @vscode/vsce package
```

- Product TypeScript tests use `node:test` and live in `src/test/*.test.ts`.
  GitHub automation uses focused ESM tests in `.github/scripts/*.test.mjs`.
- Use red-green TDD for every behavior change: add a focused failing test, run
  it, implement the smallest change, then run the focused and full suites.
- Keep behavior tests focused and use `camelCase.test.ts` names. A repository
  policy test may group closely related repository/package invariants.
- User-facing changes require a `CHANGELOG.md` entry and matching documentation.
- UI changes also require an F5 Extension Development Host smoke test; release
  candidates require an installed-VSIX smoke test on macOS and Linux when available.

## Localization and review documents

- Every user-facing string goes through `I18n` with all seven UI locales:
  `en`, `de-DE`, `zh-TW`, `zh-CN`, `ja`, `ko`, and `pt-BR`.
- Update all six README files together: `README.md`, `README-en.md`,
  `README-zh-CN.md`, `README-zh-TW.md`, `README-ja.md`, and `README-ko.md`.
- For every artifact submitted for maintainer review—including a spec,
  implementation plan, design, release checklist, policy, or substantial
  contributor-document change—provide a faithful Chinese sibling or review
  companion and present the Chinese link before the English link.
- Do not force-add ignored private documents unless the maintainer explicitly
  requested that exact review artifact.

## Git and release discipline

- Preserve unrelated work in a dirty tree. Use a clean `codex/` branch or an
  isolated worktree for implementation.
- Tracked files default to mode `100644` and LF endings. Use `100755` only for a
  real directly executed program, register it in the repository policy test,
  and verify modes with `git ls-files --stage` before committing.
- Keep commits focused. The repository squash-merges reviewed PRs to `main`.
- Never copy changes from a contributor pull request into a maintainer PR and
  close the contributor PR as superseded. To preserve attribution, merge the
  contributor's original pull request, or—with explicit authorization—update that
  original PR branch and then merge it. Put extra tests, refactors, or hardening
  in a follow-up PR that builds on the merged contribution.
- Do not push, open a pull request, merge, or publish a release without explicit
  maintainer approval.
- Do not bump `package.json` or create release tags manually. Release Drafter
  prepares a draft; publishing that reviewed draft creates the tag, and the
  publish workflow stamps the package version from it.

## GitHub text attribution

Maintainer-reviewed text generated with Codex ends with exactly:

```md
---
🤖 Generated with [OpenAI Codex](https://developers.openai.com/codex/)
```

An unreviewed automated Codex first pass uses exactly:

```md
---
🤖 Generated by [OpenAI Codex](https://developers.openai.com/codex/) as an automated first pass — not a maintainer decision.
```

- Attribution must name the actual generator. The current first-pass runner
  defaults to DeepSeek and must not be relabelled Codex.
- The wrapper, not model output, owns the trusted footer and emits exactly one.
- Credit Claude Code and OpenAI Codex as development tools in all six README
  files. Do not put tools in Release Drafter's human contributor list and do
  not invent a `Co-Authored-By` identity.
- Keep controlled comment-only first-pass automation separate from the
  privileged maintainer-only mention workflow.
