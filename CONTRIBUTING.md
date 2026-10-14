# Contributing

Thanks for your interest in Claude Code Usage — issues, PRs and ideas are
genuinely welcome. This is a small, focused project and contributions are how
it grows.

## Project scope

Before proposing a feature, it helps to know the positioning: this extension is
provider-aware and lightweight, supporting Claude Code and **Codex**.
Codex is enabled by default and can be turned off in provider settings.
The emphasis is truthful local usage and token attribution rather than billing
reconciliation. Features that sharpen attribution, privacy, or the advice
experience are the best fit.

Usage ingestion reads only each provider's local metadata and usage logs.
Usage ingestion is read-only, and Codex data is never mutated.
Codex provides clearly labelled API-equivalent cost estimates for exactly known
models, never a bill or subscription charge; unknown models remain unpriced.
Its usage JSONL is streamed and temporarily parsed for allowlisted
metadata; conversation fields are not inspected or used for analysis and are never
retained. Codex limits are last-observed values from local logs, not real-time billing
data.

Claude session actions are separately gated and disabled by default. When enabled,
they can resume or delete a selected session.
Deleting the selected session moves its log to the OS trash.

## Development setup

```bash
npm install
npm run compile          # tsc -> out/
npm run watch            # recompile on change
```

- Press **F5** in VS Code to launch the Extension Development Host and test
  your changes manually.
- Package a `.vsix` with `npx -y @vscode/vsce@3.9.1 package`.
  This is the pinned contributor recipe, not a claim about the latest stable
  VSCE. For a candidate, record the actual verified packaging tool/version and
  freeze its source and package hashes; do not silently upgrade dependencies.

Before host smoke or installation, isolate all writable user-data, extensions,
shared/agent state, global/workspace storage, provider homes, caches and lock
paths. See [the guarded native-test instructions](tests/native/README.md).
A separate window or worktree is insufficient. Compare selected normal-state
metadata/hashes before and after; unexplained changes stay unknown. Do not use
a default-profile `code --install-extension` or modify the daily installation.

## Pull requests

- Keep each PR focused on one logical change.
- Run `npm test` and the relevant browser/host layers below before opening the
  PR.
- Describe the problem and the fix; screenshots help for UI changes.
- If your change affects user-facing behaviour, update `CHANGELOG.md` and the
  relevant parts of `README.md`.

### Merge strategy and progress commits

The project defaults to **Squash and merge**: each reviewed PR adds one commit
to `main`, including multi-stage features and version work. A normal merge or
rebase merge requires an explicit maintainer exception for that PR.
Keep meaningful local stage commits until the PR is merged for verification and
rollback; this default does not require pre-squashing progress commits before
review. Do not rewrite published history or shared branches to apply it.

Merge the contributor's original PR and verify the squash commit author and all
applicable `Co-authored-by` trailers. Never copy another contributor's PR into a
maintainer PR and close the original as superseded. If changes are needed,
prefer an author update, or update the original PR branch with explicit
authorization. Keep truthful credit on each Release change entry, as described
in [Release-note attribution](#release-note-attribution).
See [the repository Git policy](AGENTS.md#git-and-release-discipline).

中文审阅：本项目默认 Squash and merge，每个已审阅 PR 向 `main` 合入一个提交，
多阶段功能和版本开发也适用。只有维护者针对该 PR 明确指定时，才例外采用普通 merge
或 rebase merge。本地有意义的阶段提交保留至 PR 合并，供验证和回滚，不要求在审阅前
提前 squash；不得为应用此规则重写已发布历史或共享分支。合并贡献者的原始 PR，
核对 squash commit 作者及所有适用的 `Co-authored-by` trailer；不得把他人 PR
复制进维护者 PR 后以 superseded 为由关闭原 PR。需要修改时，优先请作者更新，
或经明确授权在原 PR 分支修改。Release 每条变更均保留真实贡献者 credit。

## Tests

Tests run in three layers:

1. **Node logic and policy — `npm test`.** This runs the TypeScript compile,
   then executes the Node logic and repository-policy tests against compiled
   output with Node's built-in runner (`node:test` + `node:assert`).
2. **Real Webview Chromium — `npm run test:ui`.** This compiles and exercises
   the real, complete Webview in Chromium, covering interaction, reload state,
   Axe accessibility, eight-locale overflow, and visual baselines.
3. **VS Code host smoke.** Press **F5** or install a packaged VSIX. Verify real
   VS Code host activation, real local metadata, and theme smoke behavior. This
   layer does not replace the first two layers.

Browser checks use the production renderer and synthetic fixtures, not an actual
native installed window. Theme-variable guards are required but cannot prove
resource URIs, native fonts, screen readers or real zoom. Record those gates
separately; preparing a launch configuration or succeeding at CLI installation
does not execute F5 or accept the installed UI.

中文审阅：Codex 对已知精确型号提供明确标注的 API 等价估值，不是账单或订阅扣费，
未知型号仍未定价。原生／安装测试须隔离全部可写状态，单独窗口或工作树不足以证明隔离；
不替换日常 Code，无法归因的日常状态变化保留未知。浏览器生产渲染夹具与主题变量守卫
不代替原生字体、资源 URI、真实缩放、读屏、实际 F5 或已安装界面验收。贡献者的 VSCE
固定版本示例不是“最新稳定版”声明；候选记录实际工具版本、冻结源码和包 hash。

CI uses separate gates, with packaging after both test jobs pass on every PR
(`.github/workflows/test.yml`). Canonical Linux screenshots may only be updated
with the exact official container
`mcr.microsoft.com/playwright:v1.61.1-noble`, with
`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`. A macOS run must not overwrite a
Linux snapshot; reproduce and update it in that exact Linux container.

**Where tests live.** Put test files **directly** in `src/test/`, named
`*.test.ts`. Because `tsc` is configured with `rootDir: src`, they compile to
`out/test/` where the runner picks them up, and they're excluded from the
packaged `.vsix`. Keep the directory flat — the `test` script globs
`out/test/*.test.js` (a single level, so it stays portable across Node
versions), which means files in nested subfolders would be silently skipped.

**What to test in the Node layer.** Keep modules under direct test independent
of the live `vscode` API. Existing examples include:

- pricing & cost calculation (`pricing.ts`)
- aggregation: daily / weekly / monthly / all-time (`dataLoader.ts`)
- quota-window handling (`statusBar.ts`)
- i18n formatting (`i18n.ts`)

If you add or change logic in these, please add a test. `src/test/pricing.test.ts`
is a worked example to copy from. Prefer asserting on **observable behaviour**
(a computed cost, a resolved pricing tier) over implementation details, and add
a case for the tricky edge you just fixed so it can't regress.

Webview behavior belongs in `tests/ui/` and must use the production rendering
harness rather than synthetic HTML. Extension activation, commands, and real
local-provider integration receive the VS Code host smoke layer.

## Releases

Releases are automated and contributor-friendly — you never touch versions or
tags:

1. **Open a PR** (a `fix/…`, `feat/…` or `docs/…` branch name keeps the intent
   clear). A maintainer applies the matching label when merging — that label sets
   the version bump (`minor` → minor, `breaking` or `major` → major; ordinary
   `feature` / `fix` / docs and unlabeled PRs → patch).
2. **A maintainer squash-merges it by default.** [Release Drafter](https://github.com/release-drafter/release-drafter)
   then adds your change to a continuously-updated **draft GitHub Release** and
   recomputes the next version.
3. **To ship, a maintainer reviews that draft and clicks Publish.** That creates
   the tag and triggers `publish.yml`, which packages and verifies the `.vsix`,
   attaches it to the GitHub Release, then publishes independently to the VS
   Code Marketplace and Open VSX. Registry uploads use bounded duplicate-safe
   retries; a targeted manual retry reuses that attached, verified package and
   can recover either registry without changing the release tag. Older releases
   that have no asset yet are rebuilt once from their exact tag and repaired.

Changes ship through your original PR, preserving its *merged* status. The default
squash produces a new commit rather than preserving each branch commit SHA; the
maintainer verifies its author and applicable `Co-authored-by` trailers and retains
truthful per-entry Release credit.

### Release-note attribution

The draft release already puts `@PR-author` **on each change entry**. When a
maintainer edits the draft before publishing, keep that per-entry attribution
beside the specific change; a single Contributors list at the bottom is not a
substitute. If a fix comes from a linked public issue, verify the issue reporter
and credit `@reporter` on that same entry too. Keep the summary Contributors
list (including the maintainer when they contributed), and identify a verified
first-time contributor where relevant. Do not attribute unmerged PR code as
shipped, or mention private plans in public notes. The maintainer reviews the
draft and personally clicks Publish.

At each minor release, reconcile the README Credits against public PR and
issue authors. Keep merged PRs, issue reports, and unmerged proposals distinct;
do not remove earlier contributors when refreshing the list.

## Repository assistants and truthful attribution

### Controlled automatic first pass

New issues and external pull requests may receive one controlled, comment-only
first pass when the maintainer enables the kill switch. The current runner uses
an Anthropic Messages-compatible transport and may truthfully identify a tier as
DeepSeek or Claude. Cheap and escalation tiers are configured and attributed
independently; the footer names the provider whose reply became the final body.

The runner checks out only the base repository, never executes contributor code,
reads at most six allowlisted text files within byte budgets, and can only post
one comment. Public input remains untrusted and model output may be wrong. A
missing or empty PR diff stops the workflow without posting a review.
When both model tiers fail or return no usable PR analysis, the workflow fails
with a status-only diagnostic and **does not post a generic review**. Inspect
the Actions log before retrying; API response bodies, credentials, PR text,
and model replies are not included in this diagnostic. Issues retain a clearly
labelled, provider-neutral triage fallback. Historical fallback comments are
not automatically replaced. The bot only runs on `opened`, so a later retry
requires an explicitly arranged workflow run, not a fresh push to the PR.

中文说明：外部 PR 的自动初审若两层模型都失败，会在 Actions 中显示安全的
状态分类并停止，不再发布泛泛的模板评论；日志不会包含密钥、接口原文或 PR
内容。Issue 的分流兜底保持不变。旧评论不会自动改写，给 PR 推新提交也不会
触发本工作流再次运行，是否重试由维护者决定。

Codex automatic attribution is not enabled in v2.2.1. It requires a separately
implemented and trusted OpenAI/Codex transport; a model name or repository
variable alone cannot enable it. Codex automatic attribution remains disabled in v2.3.0.

### Maintainer-reviewed Codex text

A maintainer-reviewed issue comment or pull-request response drafted with Codex
uses:

```md
---
🤖 Generated with [OpenAI Codex](https://developers.openai.com/codex/)
```

This means the maintainer reviewed the text. It does not add a synthetic
`Co-Authored-By` identity or imply that the automatic runner used Codex.

### Maintainer-only mention agent

`.github/workflows/claude.yml` is a separate, maintainer-gated Claude Code
workflow with repository write permissions. v2.2.1 does not migrate this privileged workflow to Codex.
v2.3.0 still does not migrate this privileged workflow to Codex. Treat every
assistant reply as a starting point, not repository authority; the maintainer
makes the final decision.

## Code of conduct

Be kind and constructive. We're all here to make a useful tool.
