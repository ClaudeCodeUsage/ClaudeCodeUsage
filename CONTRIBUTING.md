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

Use Node **24 LTS** (`.nvmrc`; `nvm use` if you use nvm).

```bash
npm ci --ignore-scripts
npm run compile          # tsc -> out/
npm run watch            # recompile on change
```

- Press **F5** in VS Code to launch the Extension Development Host and test
  your changes manually.
- Install build-only tools with `npm ci --prefix .github/build-tools --ignore-scripts`,
  then package with `.github/build-tools/node_modules/.bin/vsce package`.
  The separate manifest pins VSCE 4.0.0 and OVSX 1.3.0, including their transitive
  dependencies in its lock. These tools never become extension runtime dependencies.
  For a candidate, record actual tool versions and freeze source and package hashes.
- Audit both locks with `npm audit --ignore-scripts --audit-level=high` and
  `npm audit --prefix .github/build-tools --ignore-scripts --audit-level=high`.
  CI fails on high/critical advisories or audit service errors; a successful audit
  only covers known advisories, not all possible supply-chain compromises.
  Keep installation scripts disabled; investigate any tool requiring one rather
  than enabling scripts globally. Update the tool lock through a reviewed PR,
  not `npx` downloads or `npm audit fix --force` in a publish job.

中文审阅：开发和主要 CI 使用 Node 24 LTS。根目录和 `.github/build-tools` 分别锁定
测试依赖与构建／发布工具；两处均用 `npm ci --ignore-scripts` 安装并审计，高危／严重
漏洞或审计服务失败会阻止 CI。VSCE 4.0.0／OVSX 1.3.0 及其间接依赖使用独立锁文件，
不随插件交付，不提高插件最低 VS Code 版本。发布不临时下载工具，也不自动强制修复依赖；
升级通过审阅的 PR 完成。审计无警报只表示未命中已知漏洞，不能证明供应链绝对安全。

The audited Axe 4.12.1 baseline is retained for now. The 4.14 upgrade detects
existing `label-content-name-mismatch` failures on achievement controls. Resolve
those with focused accessibility tests and the required native UI acceptance in
a separate change before upgrading; do not disable the new rule or rewrite visual
baselines merely to make a dependency update pass.

中文审阅：本次保留已审计的 Axe 4.12.1。4.14 的新检查发现成就控件既有的可访问名称
与可见文字不一致问题；应在独立改动中补齐无障碍测试和项目要求的原生 UI 验收后升级，
不能通过关闭新规则或重写视觉基线来消除依赖升级失败。

Before host smoke or installation, isolate all writable user-data, extensions,
shared/agent state, global/workspace storage, provider homes, caches and lock
paths. See [the guarded native-test instructions](tests/native/README.md).
A separate window or worktree is insufficient. Compare selected normal-state
metadata/hashes before and after; unexplained changes stay unknown. Do not use
a default-profile `code --install-extension` or modify the daily installation.

### Dependabot update proposals

`.github/dependabot.yml` becomes active only after it reaches the default branch.
It checks development dependencies, separate build tools and GitHub Actions each
Sunday at 09:00, 09:30 and 10:00 respectively in `Asia/Shanghai`. These are requested
check times, not guaranteed job start times; first enablement may also prompt an
initial check. Validate the first real job and generated PR after enablement;
local checks alone do not establish scheduling or real bot execution.

Each scope permits at most **two open ordinary version-update PRs** (up to six
across the three scopes, not two globally). Minor/patch proposals are grouped by
scope. Major updates and root `@axe-core/playwright` / `@types/vscode` updates stay
individual for focused review. Excluding a package from a group does not ignore
it: sensitive upgrades can still be proposed. No ignore/allow filter or non-default
target branch is added, and groups apply only to version updates, leaving existing
security alerts and security-update PRs independent of the weekly schedule and
ordinary-PR limit. Available safe fixes must still be assessed for compatibility.

Bot proposals are not approvals. Preserve paired Playwright package/image pins,
reviewed Action SHAs, both locks and their policy tests, the supported Node line,
and the VS Code API floor. An upgrade-only PR may initially fail intentional pin
guards until its compatibility evidence and related pins/tests are reviewed.
Use the existing CODEOWNERS/CI process and maintainer-authorized Squash and merge;
this configuration adds **no automatic merge or new-release publication**.
Existing delivery recovery for already-published releases is unchanged.
The `dependencies` label does not hide
release notes: add `skip-changelog` only when the reviewed change is internal-only.
The configuration alone does not upgrade packages or change runtime code or
release triggers. Removing it stops ordinary version updates; security alerts
and security updates remain separate repository security settings.

中文审阅：配置进入默认分支后才启用。开发依赖、独立构建工具和 GitHub Actions 分别在
每周日北京时间 09:00、09:30、10:00 请求检查；实际启动可能排队，初次启用也可能先检查一次。
每类最多两个未关闭的普通升级 PR，三类合计最多六个，不是全仓库最多两个。小版本／补丁
按用途分组；大版本及根目录 Axe、VS Code 类型升级单独提案，仍可能出现，并非忽略。
不设置忽略／允许筛选或其他目标分支，分组仅用于普通版本升级；已有安全警报和安全修复
不受每周排期及普通 PR 限额限制。机器人只提建议，不自动批准，不新增自动合并或新版本
发布；既有已发布版本的交付恢复保持不变。
维护者须核对 Playwright 包／镜像、Action SHA、锁文件、策略测试、Node 支持周期及 API
兼容门槛；只改版本可能先触发固定版本守卫，不能为变绿盲目放宽测试。沿用 CODEOWNERS
和 CI，明确授权后 Squash 合并；内部维护经审阅后再标记 `skip-changelog`，不默认隐藏
所有依赖或安全变更。配置本身不升级包或修改产品代码、发布触发器；实际排期及机器人
PR 行为须启用后核验首个作业，本地校验不能证明已运行定时机器人。可删除配置停用普通
升级；安全警报／安全修复开关仍在仓库安全设置中单独管理。

## Pull requests

- Keep each PR focused on one logical change.
- Run `npm test` and the relevant browser/host layers below before opening the
  PR.
- Describe the problem and the fix; screenshots help for UI changes.
- If your change affects user-facing behaviour, update `CHANGELOG.md` and the
  relevant parts of `README.md`.

### New visual features

For a new visual system or substantial redesign, follow the
[design-before-implementation gate](AGENTS.md#new-visual-systems-design-before-implementation):
compare 2–3 distinct imagegen mockups, obtain maintainer approval, then turn the
selected direction into testable criteria and implement with red-green TDD.
Generated mockups are design references, not proof of native behavior or accessibility.
Small copy/spacing fixes within an approved design do not restart this process.

中文审阅：全新视觉系统或大幅重设计，先用 imagegen 生成 2–3 个实质不同方案，
由维护者比选定稿，再转为可测试的验收条件并按 red-green TDD 实现。设计图不是
原生行为或无障碍的证明；已定稿设计内的小文案／间距修补无需重新启动此流程。

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
`mcr.microsoft.com/playwright:v1.64.1-noble` pinned to the multi-platform digest
in `test.yml`, with
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

Manual retries obtain the release-tool manifest and lock from the exact trusted
workflow commit, fetching that commit explicitly even when the release checkout
does not contain it. Tools install and pass audit outside the packaged tree;
the original tag's source and any restored release asset remain unchanged.

中文审阅：历史版本重试会显式获取当前可信工作流的精确提交，从中读取工具清单和锁文件，
在打包目录外安装并通过审计；不要求旧版本包含新工具配置，不改变原 tag 源码或已恢复的
正式安装包。三个交付目标仍独立重试，成功审计不会自动触发版本发布。

### Release-note attribution

Release notes describe what changed for users, not how the team was instructed
to implement or merge it. Do not turn internal implementation requests into release highlights:
merge strategy, acceptance checklists, test counts, agent settings and routine
achievement-rank/threshold adjustments belong in PRs or task records, not release
prose. Keep necessary compatibility instructions, honest limitations and the
per-entry contributor credit below.

中文审阅：发版说明写用户感知到什么变化，不写内部如何要求实现或合并。合并方式、
验收清单、测试数量、智能体设置和普通成就档位／门槛调整不作为独立发布亮点；
这些细节留在 PR 或任务记录。必要兼容说明、事实边界和逐项贡献者署名仍须保留。

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
