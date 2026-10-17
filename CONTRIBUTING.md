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

The audited Axe 4.13.0 baseline is used for browser checks. The 4.14 upgrade detects
existing `label-content-name-mismatch` failures on achievement controls. Resolve
those with focused accessibility tests and the required native UI acceptance in
a separate change before upgrading; do not disable the new rule or rewrite visual
baselines merely to make a dependency update pass.

中文审阅：浏览器检查使用已审计的 Axe 4.13.0。4.14 的新检查发现成就控件既有的可访问名称
与可见文字不一致问题；应在独立改动中补齐无障碍测试和项目要求的原生 UI 验收后升级，
不能通过关闭新规则或重写视觉基线来消除依赖升级失败。

Before host smoke or installation, isolate all writable user-data, extensions,
shared/agent state, global/workspace storage, provider homes, caches and lock
paths. See [the guarded native-test instructions](tests/native/README.md).
A separate window or worktree is insufficient. Compare selected normal-state
metadata/hashes before and after; unexplained changes stay unknown. Do not use
a default-profile `code --install-extension` or modify the daily installation.

### Dependabot update proposals

`.github/dependabot.yml` requests a **single weekly ordinary version-update PR**
for root npm dependencies, the separate `.github/build-tools` npm lock and GitHub
Actions through one `weekly-dependencies` multi-ecosystem group. All three scopes
use `patterns: ["*"]`: eligible major/minor/patch and sensitive Axe/VS Code type
proposals share the batch rather than generating intentional per-package PRs.
The shared schedule is Sunday 09:00 in `Asia/Shanghai`, not three staggered jobs.
See [GitHub's multi-ecosystem guide](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configuring-multi-ecosystem-updates).

This is one ordinary proposal group, **not a repository-wide maximum-one-PR
guarantee**. Existing security updates remain independent and must not wait for
the weekly batch. No ignore/allow filter, security grouping, cooldown, credentials
or non-default target branch is added. Group-level PR-limit enforcement is not
assumed; the minimal documented configuration does not need such a limit.
Only available, resolvable updates can enter a batch; inspect actual coverage.

Grouping is not upgrade approval. Keep paired Playwright package/image pins,
reviewed Action SHAs, both locks and their policy tests, Node/type compatibility
and the VS Code API floor. Assess major and sensitive tool changes within the
batch; fix related pins/tests with evidence or defer incompatible changes. Do not
weaken guards merely to make the batch green. Keep CODEOWNERS/CI and
maintainer-authorized Squash and merge; no automatic merge or new-version
publication is added. Delivery recovery for already-published releases is unchanged.
The `dependencies` label does not hide release notes; use `skip-changelog` only
after review establishes that a change is internal-only.

The configuration activates on the default branch. Requested times may queue,
and initial enablement/configuration changes may trigger an earlier check.
Validate the first real grouped job/PR; local policy and YAML checks do not prove
GitHub service execution. Migrating the configuration does not itself combine,
close or merge existing individual PRs. Verify replacement coverage before any
separately authorized cleanup; never ignore an update merely to reduce noise.
Removing this file stops ordinary proposals; repository security settings remain
separate. This change does not upgrade packages, edit locks/runtime/version or
change release workflows.

中文审阅：三个范围（根 npm、独立构建工具 npm、GitHub Actions）共用一个每周普通版本升级 PR
分组，每周日北京时间 09:00 请求检查，不再分三次。可解析的大／小／补丁及敏感工具升级
都进入同一普通批次，不再按包主动拆分；合并提案不等于批准升级。
安全更新保持独立，不为凑批次延迟修复；不加忽略、允许、冷却、凭据或其他目标分支。
一个分组不代表全仓库永远最多一个 PR，旧提案和安全提案可能仍存在，也不假定未核实的
分组限额执行效果。仍须审阅 Node／类型、VS Code API、Playwright 包／镜像和 Action SHA，
保留锁与测试守卫；不兼容项可在批次中暂缓，不能为变绿降低门槛。通过后仍需维护者授权
Squash 合并，不自动合并或发布新版本；既有正式版本交付恢复不变。
配置进入默认分支后生效；首次／变更检查和排队可能不在指定时刻。须核验首个真实分组
作业和 PR 的实际更新覆盖。配置迁移不自动合并、关闭或替代 #137–#140 等旧提案，
确认替代批次完整覆盖后才另行授权清理，不用忽略包来减少通知。此变更不升级包、不改锁、
运行时代码、产品版本或发布工作流；删除配置仅停用普通提案，安全设置仍独立管理。

## Pull requests

Describe changes directly; omit private request and approval narratives.
Use summaries, checklists and review comments for the change, rationale, observed
tests and factual limitations, not private conversations or agent execution instructions.
Keep required AI attribution and contributor credit; execution records stay local.

中文审阅：PR 直接写改动、理由、测试和限制，不叙述私人对话中的要求、授权或智能体
执行指令；概要、核对项、标题和审阅评论均适用。保留必要 AI 归因与真实贡献署名。

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
(`.github/workflows/test.yml`). Node Tests (including both dependency audits),
UI Test and Release Package remain the stable required checks. Only PRs whose
actual tested-tree diff is verified to contain allowlisted regular documentation
files may omit browser jobs; unknown ranges, mixed changes, renames involving code,
symlinks, dependencies, assets, tests and CI changes run the complete UI suite.
The UI aggregate rejects unknown, failed, cancelled or unexpected skipped results.
Main pushes always run full UI, so a newer docs commit cannot cancel runtime
verification and replace it with a documentation exemption.

Four isolated single-worker jobs discover every current Playwright spec, then
assign whole files exactly once using historical-duration estimates in
`.github/scripts/ui-timings.json`. The baseline is not a test allowlist: new files
and new tests receive nonzero weights. Invalid discovery/timings and empty shards
fail rather than silently passing. Inspect the plan with
`node .github/scripts/ui-shards.mjs --shard=1/4 --plan`; after compiling, omit
`--plan` to execute that partition. Refresh timing estimates from a complete
successful run and retain their provenance/limitations; modeled balance is not
a measured speedup. No tests, locales, themes, retries or snapshot tolerances are removed.
Obsolete Test runs are cancelled only within the same PR or main ref; other PRs
and release workflows remain separate. No auto-merge or publishing is enabled.

中文审阅：Node 测试（含两份依赖审计）、UI 汇总与打包仍是固定门禁。只有 PR 的实际待测
树差异已确认全部为白名单普通文档时，才可省去浏览器；未知范围、混合改动、涉及代码的
重命名、符号链接、依赖、资源、测试及 CI 改动均完整测 UI。汇总门禁拒绝未知、失败、取消
或不符合预期的跳过。main 推送始终完整测 UI，防止新文档提交取消前一轮代码检查后免测。
四个隔离单 worker 从当前完整清单按历史耗时估算分配文件，每文件恰好一次；新增文件／用例
具有非零权重，历史数据不是白名单。发现／计时异常或空分片会失败，不删测试、语言、主题、
重试或截图阈值。`--plan` 只检查分配；实际执行先编译，计时更新保留完整成功来源与局限，
估算均衡不等于实测加速。过时 Test 仅在同 PR 或 main 引用内取消，不影响其他 PR／发布流程，
不开启自动合并或发布。

Canonical Linux screenshots may only be updated
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
