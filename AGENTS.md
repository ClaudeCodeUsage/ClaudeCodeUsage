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
- Use a pure, restrained geek aesthetic: help users understand model usage and
  usage behavior through concise statistics, not decorative presentation.
  Unrelated new extras default off. Material changes to established usage habits
  need an optional switch and a retained familiar path, not a forced replacement.
  Apply these gates to new scope; documentation changes do not silently change
  shipped defaults or disable correctness, safety or routine maintenance fixes.
- Prefer token-attribution accuracy over billing precision. Keep exact totals,
  labelled estimates, and point-in-time quota observations as separate concepts.
- Keep the extension local-first, lightweight, and read-mostly. Usage ingestion
  and derived-data clearing never rewrite or delete provider conversation JSONL.
  The existing, separately opt-in Session Actions feature may move exactly one
  confirmed Claude log to the OS trash; this is not authority for an agent to
  delete logs. Codex source logs remain read-only. Treat credential handling as
  security-sensitive and preserve the existing reviewed behavior.
- Add no new runtime dependencies for the current candidate without explicit
  maintainer approval.

## Maintainer decisions and agent execution

- The maintainer owns user value, feature scope, defaults, disclosure and release
  promises. Agents own implementation, counterexamples, regression tests,
  performance measurements and evidence integration within the authorized scope.
  Routine implementation choices do not require a new product decision.
- For a feature, identify the user question, observable result, default/off/reset
  behavior and privacy/resource constraints. Prefer the smallest coherent change;
  code size, badge counts and green-test totals are not measures of user benefit.
- Read documentation by task: `ARCHITECTURE.md` for module/data-flow changes,
  `LOCAL-DATA.md` and its versioned baseline for retained/exported fields and
  clearing, and `CONTRIBUTING.md` for test/package/release workflows. Small copy
  edits do not require replaying every historical plan. Task-local worktree paths,
  permissions and acceptance status belong in the current handoff, not this policy.
- Distinguish source integration, synthetic tests, native behavior and user
  acceptance. Missing data is not zero; passing fixtures do not establish that
  upstream logs always satisfy the same assumptions. Reuse relevant independent
  findings; seek a new bounded assessment for a substantive unresolved question,
  not for every routine fix or delivery.

## Architecture boundaries

- `src/extension.ts`: activation, commands, refresh orchestration, watcher,
  coalescing, settings changes, and diagnostic output.
- `src/dataLoader.ts`: Claude JSONL parsing primitives, validation, attribution,
  and content-analysis reducers retained for exact compatibility.
- `src/claudeIncrementalIndex.ts`: the production in-memory per-file Claude
  usage index, append-tail parser, exact global deduplication, and materialized
  dashboard aggregates. Unchanged warm refreshes must not fall back to a
  full-corpus body read or full-record aggregation; documented correctness-first
  content-analysis replay is a separate path, not the default for each watcher event.
  The single permitted exception on a changed-file refresh is a probe-guarded
  retry when a changed file's ownership order cannot be proven safe from the
  retained contributions.
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
  client behavior, plus existing host-side receipt/notice ownership. New pure
  calculations and eligibility rules belong in domain modules, not another
  renderer or duplicated scan. Compare never sums cost or quota across providers.
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
- Codex usage discovery is allowlisted to `.jsonl` and `.jsonl.zst` regular files
  recursively under `$CODEX_HOME/sessions` and `$CODEX_HOME/archived_sessions`
  (default `~/.codex`); reject symlinks and non-regular files. Never read
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
  an ordinary verified single-file append reads its tail and updates affected
  groups. With content analysis enabled, unsafe truncation/replacement/deletion,
  changed source order or UUID first-owner changes can require an ordered wider
  replay to preserve exact semantics. Report that cost separately; never turn it
  into unconditional full-corpus work on each watcher event. A new Extension Host
  may still perform one cold in-memory build.
- Codex optimization advice uses structural numeric signals only. Never inspect
  or persist prompt/response/command bodies or tool arguments.

## Development and tests

```bash
npm ci --ignore-scripts
npm run compile
npm test
npm ci --prefix .github/build-tools --ignore-scripts
.github/build-tools/node_modules/.bin/vsce package
```

- Use Node 24 for development and primary CI (`.nvmrc`). Keep release tools in
  the independent `.github/build-tools` lock, install with scripts disabled and
  invoke its local binaries; never replace these commands with an unpinned
  download. Audit both locks before release. Do not raise the VS Code API floor
  or runtime requirements merely to update development tools.

- Product TypeScript tests use `node:test` and live in `src/test/*.test.ts`.
  GitHub automation uses focused ESM tests in `.github/scripts/*.test.mjs`.
- Use red-green TDD for every behavior change: add a focused failing test, run
  it, implement the smallest change, then run the focused and full suites.
- Keep behavior tests focused and use `camelCase.test.ts` names. A repository
  policy test may group closely related repository/package invariants.
- User-facing changes require a `CHANGELOG.md` entry and matching documentation.
- UI changes also require an F5 Extension Development Host smoke test; release
  candidates require an installed-VSIX smoke test on macOS and Linux when available.
- Before F5, installation or a second Code instance uses fixtures, identify and
  isolate every writable profile, extension/shared/agent store, global/workspace
  storage, provider home, derived cache and lock path. A window or worktree alone
  is not isolation. Follow `tests/native/README.md`, verify actual storage paths
  and compare selected normal-state metadata/hashes before and after. Unexplained
  differences remain unknown, not proof of non-disruption. Never replace the
  daily installation or run a plain default-profile install as a test shortcut.
- Documentation-only edits verify affected facts, links and document/policy
  tests. They do not establish new runtime, native, performance or release passes.

### Plugin-scoped visual changes

- Preserve existing navigation, tabs, interactions and compact plugin density.
  Work within the explicitly scoped tab or export surface; a visual task does not
  authorize a plugin-wide frontend refactor, website-style shell or large-screen layout.
- Claude content analysis is the baseline for Codex advice: concise statistics,
  shared information hierarchy and minimal charts that explain data.
  Do not reuse achievement artwork, rank ornaments or decorative mascots
  in analysis/advice. Reuse existing unobtrusive metric icons where useful.
- Additional visual design belongs only on explicitly scoped surfaces such as
  achievements and heatmap sharing, without spilling into other tabs.
- Treat a comprehensive new visual style as a separate future opt-in, preserving
  the existing style and interaction path; do not implement a dual-style system
  as an incidental part of a tab-level change.

### New visual systems: design before implementation

- For a new visual system (such as achievements) or a substantial visual redesign,
  use built-in **imagegen** first to produce **2–3 materially distinct** design
  directions, not just color variants. Use synthetic content and the existing
  product/theme constraints; do not send private logs or account data as references.
- Compare information hierarchy, density, artwork, controls, long/localized text,
  empty/error/expanded states, and narrow/light/dark layouts. Let the maintainer
  select and explicitly approve a direction before production UI implementation.
  Read-only investigation and disposable feasibility prototypes may precede approval.
- Translate the approved design into concrete layout, state, accessibility and
  responsive acceptance criteria; then use red-green TDD to implement them in the
  shared renderer and existing theme tokens. Compare real rendered screenshots
  with the approved reference before requesting acceptance. Mockups are not
  runtime, accessibility, native or installed-package acceptance evidence.
- Preserve the selected reference and decision with the task's design artifacts.
  A material change of direction returns to visual confirmation, rather than
  accumulating speculative production revisions. If imagegen is unavailable,
  report that limitation and agree on an alternative before this design gate;
  do not silently switch to a paid API/CLI or skip the gate.
- Small copy corrections and local spacing fixes within an approved design do not
  require another image-generation round. Editable SVG/icon maintenance stays in
  its native format; this policy does not turn code-native UI into a raster image.

### UI rendering-environment fidelity

For any UI change, first prove that the rendering environment is equivalent to
a real VS Code webview: every referenced `--vscode-*` variable in the production
stylesheet must have a real value in the test harness, with a guard test enforcing
that invariant. Visual snapshots produced before this is true are not acceptance
evidence.
Variable values must come from the registered values of VS Code's built-in themes;
do not mix in another color system.
This is a necessary rendering-fidelity guard, not native acceptance for resource
URIs, fonts, screen readers, actual zoom or installed-package behavior.

### Interaction-state acceptance

Webview updates may use a full-page replacement or a provider-panel live patch.
Every new user-interactive state (expand/collapse, sorting, filtering, or
selection) must use the existing persistence mechanism and include an operation
→ update → reload → state-remains test, preserving relevant focus and scroll
anchors. A static assertion of the first render is not acceptance evidence.

## Localization and review documents

- Every user-facing string goes through `I18n` with all eight UI locales:
  `en`, `de-DE`, `zh-TW`, `zh-CN`, `ja`, `ko`, `pt-BR`, and `id`.
- Update all nine README files together: `README.md`, `README-en.md`,
  `README-de-DE.md`, `README-zh-CN.md`, `README-zh-TW.md`, `README-ja.md`,
  `README-ko.md`, `README-pt-BR.md`, and `README-id.md`.
- README release summaries follow the existing minor-version What's New format:
  a short feature list, not an implementation diary or a second manual.
  Detailed rules, storage contracts and verification belong in linked documentation
  such as `LOCAL-DATA.md`, `CHANGELOG.md` and contributor notes. Do not repeat
  thresholds, catalog counts, acceptance history, per-fix details or future roadmap
  promises in multiple release-specific README sections.
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
- This project defaults to **Squash and merge**: each reviewed PR contributes
  one commit to `main`, including multi-stage features, performance work and
  version development. A normal merge or rebase merge is an exception only when
  explicitly specified by the maintainer for that PR.
- Local progress commits are separate from the PR merge strategy. Preserve
  meaningful implementation, test and fix commits until the PR is merged so
  stages remain available for verification and rollback; do not pre-squash them
  merely to prepare a PR. Preserving their original SHAs in `main` is not the default.
- Commit at meaningful, verifiable milestones, not per file, agent turn or
  contribution-graph target. Keep a logical change with its regression tests and
  necessary documentation together. Fold trivial formatting, wording and immediate
  fixups into related unpublished work; retain separate commits for independently
  useful fixes or evidence-backed milestones until merge. Do not rewrite published
  history or shared branches to apply this default. Leave previously squashed
  history unchanged; do not reconstruct or re-merge old commits merely to restore
  contribution-graph counts.
- Preserve the original PR and truthful authorship when squashing: verify the
  squash commit author and all applicable `Co-authored-by` trailers. Keep real
  contributor credit on each Release change entry; an aggregate contributor list
  is not a substitute. Squashing must not relabel another author's work as the
  maintainer's or an assistant's.
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
- Release notes focus on user-visible outcomes, necessary compatibility/action
  notes and factual limitations. Do not list merge strategies, one-off acceptance
  requests, test counts, agent/reviewer settings or routine achievement rank and
  threshold tuning as standalone highlights. Keep internal planning and proof in
  the PR and task handoff; do not turn the maintainer's implementation checklist
  into public release prose. Explain technical details only when users need them
  to use the change safely, and retain truthful per-entry contributor credit.

## GitHub text attribution

### Public PR descriptions

- Describe changes, rationale, tests and limitations directly.
- Do not narrate private user or maintainer requests, approvals or agent instructions.
  This includes summaries, checklists, titles and review comments, not just release notes.
  Private execution/authorization records belong in the local task handoff.
- Keep required AI attribution and truthful contributor credit. A general repository
  permission rule or an attribution disclaimer is not a private request narrative.
- State current verification gaps factually; do not substitute an approval story
  for evidence that the change is correct or ready to merge.

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
- Credit Claude Code and OpenAI Codex as development tools in all nine README
  files. Do not put tools in Release Drafter's human contributor list. A commit
  mainly written by OpenAI Codex must include this exact trailer:

```text
Co-authored-by: OpenAI Codex <215057067+openai-codex[bot]@users.noreply.github.com>
```
- Keep controlled comment-only first-pass automation separate from the
  privileged maintainer-only mention workflow.

## Codex 工具適配
瀏覽器操作使用當前 Codex browser／computer-use 工具；原文的 Claude MCP 工具名稱只描述操作意圖，不能直接呼叫。提問依目前模式使用可用工具；已授權範圍內的本地小提交可保存進度，推送、PR、合併、tag 與發布仍須維護者明確授權。
