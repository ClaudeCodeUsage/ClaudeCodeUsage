# AGENTS.md

Repository guidance for OpenAI Codex and other agentic contributors. A faithful
Simplified-Chinese review copy lives in [AGENTS.zh-CN.md](AGENTS.zh-CN.md).

## Product identity and scope

- Claude Code Usage is a VS Code extension that reads local Claude Code and
  Codex usage logs. Claude keeps its exact token totals, cost estimates, and
  OAuth quota; Codex Beta in v2.3.0 has provider-specific local usage and
  optimization views plus clearly labelled API-equivalent cost estimates,
  without pretending those estimates are a bill or subscription charge.
- Preserve the established product identity and Claude workflows while adding
  provider-neutral contracts. Claude and Codex dashboard presentation must use
  the same provider-aware render functions and the same CSS contract.
- Prefer token-attribution accuracy over billing precision. Keep exact totals,
  labelled estimates, and point-in-time quota observations as separate concepts.
- Keep the extension local-first, lightweight, and read-mostly. Never modify
  Claude or Codex conversation JSONL files. Treat credential handling as security-sensitive
  and preserve the existing reviewed behavior.
- Add no new runtime dependencies in v2.3.0.

## Architecture boundaries

- `src/extension.ts`: activation, commands, refresh orchestration, watcher,
  coalescing, settings changes, and diagnostic output.
- `src/dataLoader.ts`: Claude JSONL parsing primitives, validation, attribution,
  and content-analysis reducers retained for exact compatibility.
- `src/claudeIncrementalIndex.ts`: the production in-memory per-file Claude
  usage index, append-tail parser, exact global deduplication, and materialized
  dashboard aggregates. Runtime refreshes must not fall back to a full-corpus
  body read or full-record aggregation.
- `src/providers/providerTypes.ts` and provider adapters: provider-neutral token,
  coverage, confidence, and limit contracts. Do not erase provider semantics.
- `src/providers/codex/`: allowed-root discovery, schema guards, exact-request
  parsing with cumulative high-water fallback, per-file aggregate index, worker
  protocol, bounded multi-worker cold backfill, and Codex facade.
- `src/codexView.ts` / `src/codexViewComponents.ts`: Codex copy and default-provider
  contracts only; they do not own HTML, client code, or styles.
- `src/settings.ts`: the `SETTINGS` catalog and `SettingsStore`; do not scatter
  direct configuration reads.
- `src/statusBar.ts`: status-bar token/cost/quota/context presentation.
- `src/webview.ts`: the single provider-aware Claude/Codex dashboard HTML and
  client behavior. Compare never sums cost or quota across providers.
- `src/i18n.ts`: all user-facing copy for all eight UI locales.
- `src/types.ts`: shared contracts.
- Read `ARCHITECTURE.md` before changing module ownership or the data flow. If
  that change is submitted for maintainer review, also provide a faithful
  Simplified-Chinese review companion.

## Safety and privacy invariants

- Never upload prompt text, response text, raw JSONL lines, absolute paths, raw
  session IDs, credentials, or local usernames. New v2.3.0 performance
  diagnostics must not log them either; do not broaden older diagnostic output
  without an explicit privacy review.
- Codex discovery is allowlisted to `$CODEX_HOME/sessions/**/*.jsonl` and
  `$CODEX_HOME/archived_sessions/**/*.jsonl` (default `~/.codex`). Never read
  `auth.json`, SQLite databases, config secrets, keychains, browser state, or
  unknown files for Codex usage.
- Additionally, `$CODEX_HOME/session_index.jsonl` may be streamed solely to
  recover the `id` → `thread_name` mapping used for real thread titles. Absolute
  paths inside titles are masked, titles stay in memory and are never persisted,
  symlinks and non-regular files are rejected, and no other field of that file
  is read.
- Raw Codex paths/session/parent IDs may exist only in short-lived local worker
  memory. Persist machine-salted pseudonymous keys and numeric aggregates only.
- Advice and optimizer network calls remain explicit user actions and may send
  only the documented digest or text the user pasted.
- New settings default to documented, non-surprising behavior. A beta provider
  may default enabled only when its allowed local directory exists and absence
  is a no-op; other experimental/approximate features default off unless an
  approved spec explicitly says otherwise.
- Do not read secret or credential files merely to diagnose a feature. Use
  redacted metadata and fixtures.
- Do not hand-edit generated files in `out/`; edit `src/` and compile.

## Codex Beta data and performance invariants

- Codex processed tokens are `input + output`. Fresh input + output is
  `max(0, input - cached input) + output`; it is a behavior aid, not a cost or
  quota equivalent. Cached input is a subset of input and reasoning is a subset
  of output, so never add either twice.
- Attribute valid request components from `last_token_usage`; its `total_tokens`
  field is active-context size, not request usage. Suppress replay only when the
  full numeric total-plus-last signature matches the same machine-salted
  rate-limit source or the immediately preceding record. If last usage is
  absent, fall back to cumulative `total_token_usage` with per-lineage
  high-water baselines. Counter regressions, unknown parents, and schema drift
  produce explicit quality flags instead of invented precision.
- A persisted parser-semantics change must force one bounded automatic rescan.
  Exclude old aggregates while rebuilding and keep the indexed subtotal and
  progress visible rather than mixing incompatible totals.
- Codex rate limits recovered from local logs are `last-observed` only. Drop
  them after their reset time; do not access credentials or call a network API
  merely to make them current.
- 2.4-GB-class history must be indexed in a background worker with a persistent
  per-file aggregate index. Unchanged warm refresh reads no JSONL body; append
  refresh reads only the tail. Support progress, cancellation, resume, and
  single-flight refresh. A one-time incomplete backfill may use an adaptive,
  bounded local worker pool and coarser durable checkpoints; steady-state work
  returns to the low-power incremental path.
- Claude runtime refreshes use the in-memory per-file index in
  `claudeIncrementalIndex.ts`. An unchanged refresh reads zero JSONL bodies;
  append/truncate/replace/move/delete work is limited to affected files and
  affected aggregate groups while preserving the established response-identity
  and content-analysis semantics. A new Extension Host may still perform one
  cold in-memory build; this is distinct from rereading the corpus after every
  watcher event.
- Codex optimization advice uses structural numeric signals only. Never inspect
  or persist prompt/response/command bodies or tool arguments.

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

### UI rendering-environment fidelity

For any UI change, first prove that the rendering environment is equivalent to
a real VS Code webview: every referenced `--vscode-*` variable in the production
stylesheet must have a real value in the test harness, with a guard test enforcing
that invariant. Visual snapshots produced before this is true are not acceptance
evidence.
Variable values must come from the registered values of VS Code's built-in themes;
do not mix in another color system.

### Interaction-state acceptance

Webview refresh is a full-page replacement. Every new user-interactive state
(expand/collapse, sorting, filtering, or selection) must use the existing
persistence mechanism and include an operation → reload → state-remains test.
A static assertion of the first render is not acceptance evidence.

## Localization and review documents

- Every user-facing string goes through `I18n` with all eight UI locales:
  `en`, `de-DE`, `zh-TW`, `zh-CN`, `ja`, `ko`, `pt-BR`, and `id`.
- Update all seven README files together: `README.md`, `README-en.md`,
  `README-zh-CN.md`, `README-zh-TW.md`, `README-ja.md`, `README-ko.md`, and
  `README-id.md`.
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
- If a contribution needs revision but has meaningful value, review it
  constructively and prefer an author update. With explicit authorization,
  adjust the original PR branch and then merge it instead of replacing it.
- Close a contributor PR without merging only in the exceptional case where no
  meaningful contribution can be salvaged, such as an empty PR, spam, or an
  irrelevant change. Explain the reason publicly and respectfully.
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
- Credit Claude Code and OpenAI Codex as development tools in all seven README
  files. Do not put tools in Release Drafter's human contributor list. A commit
  mainly written by OpenAI Codex must include this exact trailer:

```text
Co-authored-by: OpenAI Codex <215057067+openai-codex[bot]@users.noreply.github.com>
```
- Keep controlled comment-only first-pass automation separate from the
  privileged maintainer-only mention workflow.

## Codex 工具適配
瀏覽器操作使用當前 Codex browser／computer-use 工具；原文的 Claude MCP 工具名稱只描述操作意圖，不能直接呼叫。提問依目前模式使用可用工具；Git 操作仍需當次明確授權。
