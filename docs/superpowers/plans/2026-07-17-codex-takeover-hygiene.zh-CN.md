# Codex 接手与仓库卫生 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 v2.2.1 产品行为的前提下，建立 Codex 可依赖的仓库级指导、中文审阅约定、换行/文件模式防护、忽略与 VSIX 打包边界，并如实致谢 Claude Code 与 OpenAI Codex 两种开发工具。

**已批准设计：** [V2.2.1 稳定化设计（简体中文）](../specs/2026-07-17-v2.2.1-stabilization-design.zh-CN.md)

**Architecture:** 根目录 `AGENTS.md` 是唯一 canonical 规范源，`AGENTS.zh-CN.md` 是供维护者审阅的忠实中文副本，`CLAUDE.md` 收敛为指向 canonical 规则的 Claude Code 兼容入口；可执行约束由 `src/test/repositoryPolicy.test.ts` 固化。`.gitattributes`、`.gitignore` 与 `.vscodeignore` 分别负责文本规范、本地状态隔离和扩展包边界，README 只记录工具致谢，不把工具伪装成人类贡献者。

**Tech Stack:** Markdown、Git attributes/ignore 规则、TypeScript 5.8、Node.js 20 `node:test`、`@vscode/vsce`、ZIP 文件清单审计。

## Global Constraints

- v2.2.1 保持 Claude-only；Codex 在本计划中只是开发工具，不是已经完成的用量 provider。
- 不新增 runtime dependency。
- 精确用量与估算洞察继续分离；不得把本计划包装成产品能力变化。
- 所有用户可见字符串必须覆盖现有七个 UI locale：`en`、`de-DE`、`zh-TW`、`zh-CN`、`ja`、`ko`、`pt-BR`。
- README 改动必须同时更新现有六份文件：`README.md`、`README-en.md`、`README-zh-CN.md`、`README-zh-TW.md`、`README-ja.md`、`README-ko.md`。
- 任何交给维护者审阅的 artifact（包括 spec、plan、design、release checklist、policy 或大幅文档变更）都必须提供忠实中文副本或中文 review companion，交付时中文链接排在英文链接之前。
- 扩展不得写入 Claude JSONL 日志；本计划及 v2.2.1 新增的性能诊断不得记录 prompt、绝对路径、session ID、credential 或原始 JSONL 行。不得把这一新增约束误写成对所有历史诊断的既成事实。
- push、创建 PR、merge 和发布 Release 都必须先得到维护者明确批准。
- Release Drafter 的 draft Release 是版本来源；不得手动改版本或创建发布 tag。
- 默认 tracked 文件模式为 `100644`；除非文件确实由操作系统直接执行且测试明确登记，否则不得提交 `100755`。
- 每项行为约束都先写失败测试，再做最小实现；完成前 `npm test` 必须零失败。

### Codex Desktop 命令启动方式

本文中的 `npm ...` / `npx ...` 是 CI 与普通开发 shell 的 canonical 命令。当前
Codex Desktop shell 的 `PATH` 可能不含 `node`、`npm`、`npx`；在这种环境中先设置：

```bash
CCU_NODE=/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
```

然后使用下面的固定、离线等价命令，不临时下载 VSCE：

```bash
CCU_NODE=/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$CCU_NODE" node_modules/typescript/bin/tsc -p ./
"$CCU_NODE" --test out/test/*.test.js
"$CCU_NODE" node_modules/@vscode/vsce/vsce ls --no-dependencies
```

每个 `Run: npm test` 在 Codex Desktop 中都必须执行前两行；`npx @vscode/vsce`
的清单检查使用第三行。Codex 环境没有 npm 时，完整临时打包必须先执行编译，
再使用 Task 4 给出的 pinned VSCE `pack()` 等价命令；不能直接运行会调用 npm
prepublish 的 `vsce package`。每个执行步骤都视为新的 shell；凡后文单独出现
`"$CCU_NODE"`，执行者必须在同一个 code block/command 前重新写入上述绝对路径。

## File map

- Create: `AGENTS.md` — Codex 与其他 agent 的英文规范源。
- Create: `AGENTS.zh-CN.md` — 与 `AGENTS.md` 同义的维护者审阅副本。
- Modify: `CLAUDE.md` — 删除陈旧/冲突规则，改为 canonical AGENTS 的 Claude Code 兼容入口。
- Create: `.gitattributes` — LF 与二进制文件分类。
- Modify: `.gitignore` — 排除 agent 本地状态与仓库内 worktree。
- Modify: `.vscodeignore` — 防止 agent 指令、本地状态、源码、测试与 workflow 源进入 VSIX。
- Create: `src/test/repositoryPolicy.test.ts` — 仓库规范、打包边界、工具致谢和 locale 数量的回归测试。
- Modify: `README.md`, `README-en.md`, `README-zh-CN.md`, `README-zh-TW.md`, `README-ja.md`, `README-ko.md` — 分语言添加开发工具致谢。
- Modify: `CHANGELOG.md` — 记录已发布的 2.2.0 日期和 v2.2.1 接手/工具归因变化。
- Modify: `.github/PULL_REQUEST_TEMPLATE.md` — 把错误的“六种语言”修正为七个 UI locale。

---

### Task 1: 建立 canonical AGENTS 指导和中文审阅副本

**Files:**
- Create: `AGENTS.md`
- Create: `AGENTS.zh-CN.md`
- Modify: `CLAUDE.md`
- Create: `src/test/repositoryPolicy.test.ts`

**Interfaces:**
- Consumes: `ARCHITECTURE.md` 的模块边界、`CONTRIBUTING.md` 的测试/发布流程、已批准的 v2.2.1 stabilization spec。
- Produces: `AGENTS.md` 中稳定的产品约束、测试命令、文档同步规则、GitHub attribution 与远程操作审批边界；`repoFile(relativePath: string): string` 供后续任务的同一测试文件复用。

- [ ] **Step 1: 确认干净基线**

Run: `npm test`

Expected: TypeScript 编译成功，现有 114 项 `node:test` 测试全部通过，进程退出码为 0。

- [ ] **Step 2: 写 canonical 指导的失败测试**

Create `src/test/repositoryPolicy.test.ts` with:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');

function repoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

test('AGENTS is the canonical Codex repository policy', () => {
  const agents = repoFile('AGENTS.md');
  assert.match(agents, /Claude-only in v2\.2\.1/);
  assert.match(agents, /no new runtime dependencies/i);
  assert.match(agents, /all seven UI locales/i);
  assert.match(agents, /push, open a pull request, merge, or publish a release/i);
  assert.match(agents, /Generated with \[OpenAI Codex\]/);
});

test('AGENTS links a faithful Simplified-Chinese review copy', () => {
  const agents = repoFile('AGENTS.md');
  const chinese = repoFile('AGENTS.zh-CN.md');
  assert.match(agents, /AGENTS\.zh-CN\.md/);
  assert.match(chinese, /v2\.2\.1 保持 Claude-only/);
  assert.match(chinese, /中文链接排在英文链接之前/);
  assert.match(chinese, /推送、创建 PR、合并或发布 Release/);
});

test('CLAUDE is a compatibility entry point, not a conflicting policy source', () => {
  const claude = repoFile('CLAUDE.md');
  assert.match(claude, /AGENTS\.md.*canonical repository policy/);
  assert.match(claude, /polling always follows\s+`refreshInterval`/);
  assert.doesNotMatch(claude, /activity-aware: ~15 s|never writes to `~\/\.claude\/`/);
});
```

- [ ] **Step 3: 运行测试并确认它因文件缺失而失败**

Run: `npm test`

Expected: FAIL；`repositoryPolicy.test.js` 报 `ENOENT`，缺少 `AGENTS.md`。

- [ ] **Step 4: 创建英文 canonical AGENTS**

Create `AGENTS.md` with exactly:

````md
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
````

- [ ] **Step 5: 创建忠实的简体中文副本**

Create `AGENTS.zh-CN.md` with exactly:

````md
# AGENTS.md（简体中文审阅版）

本文件是根目录 [AGENTS.md](AGENTS.md) 的忠实中文副本，供维护者快速审阅；
执行约束以两份文件共同表达的同一规则为准。

## 产品定位与范围

- Claude Code Usage 是一个 VS Code 扩展，读取 Claude Code 本地 JSONL 用量
  日志，展示精确 token 总量、成本估算和 OAuth 配额。
- v2.2.1 保持 Claude-only。Codex 在这个版本中是开发工具，不是已经完成的
  用量 provider，也不构成产品改名的理由。
- 优先保证 token 归因准确，不追求账单级精度。精确总量、明确标注的估算、
  某一时点的配额观测必须保持为不同概念。
- 扩展保持 local-first、轻量和 read-mostly。绝不修改 Claude 对话 JSONL；
  credential 处理属于安全敏感范围，只保留已经审阅的既有行为。
- v2.2.1 不新增 runtime dependency。

## 架构边界

- `src/extension.ts`：激活、命令、刷新调度、watcher、合并刷新、设置变化和诊断输出。
- `src/dataLoader.ts`：JSONL 发现/解析、去重、归因、内容分析和用量聚合。
- `src/settings.ts`：`SETTINGS` catalog 与 `SettingsStore`；不要散落直接配置读取。
- `src/statusBar.ts`：状态栏 token、成本、配额和 context 展示。
- `src/webview.ts`：dashboard HTML 与客户端行为。
- `src/i18n.ts`：七个 UI locale 的全部用户可见文案。
- `src/types.ts`：共享 contract。
- 改变模块职责或数据流前先读 `ARCHITECTURE.md`；若该变化需要维护者审阅，
  同时提供忠实的简体中文 review companion。

## 安全与隐私不变量

- 绝不上传 prompt、response、原始 JSONL 行、绝对路径、原始 session ID、
  credential 或本地用户名。v2.2.1 新增的性能诊断也不得记录这些内容；未经过
  明确隐私审阅，不扩大历史诊断输出范围。
- Advice 和 optimizer 的网络调用必须由用户明确触发，只能发送文档约定的摘要
  或用户亲自粘贴的文字。
- 新设置默认保持既有行为；实验性或近似功能默认关闭。
- 不要仅为了诊断功能而读取 secret 或 credential 文件；使用脱敏 metadata 与 fixture。
- 不要手改 `out/` 生成物；修改 `src/` 后编译。

## 开发与测试

```bash
npm ci
npm run compile
npm test
npx @vscode/vsce package
```

- 产品 TypeScript 测试使用 `node:test`，放在 `src/test/*.test.ts`；GitHub 自动化的
  ESM 测试放在 `.github/scripts/*.test.mjs`。
- 每项行为变更遵循 red-green TDD：先加聚焦的失败测试并运行，再做最小实现，
  然后运行聚焦测试和完整测试。
- 行为测试保持聚焦，文件名使用 `camelCase.test.ts`；repository policy test 可以
  合并紧密相关的仓库/打包不变量。
- 用户可见变更需要更新 `CHANGELOG.md` 和对应文档。
- UI 变更还要用 F5 Extension Development Host smoke test；候选版本在条件允许时
  需要在 macOS 和 Linux 安装 VSIX 做 smoke test。

## 本地化与审阅文档

- 每个用户可见字符串都通过 `I18n` 覆盖七个 UI locale：`en`、`de-DE`、
  `zh-TW`、`zh-CN`、`ja`、`ko`、`pt-BR`。
- 六份 README 必须一起更新：`README.md`、`README-en.md`、`README-zh-CN.md`、
  `README-zh-TW.md`、`README-ja.md`、`README-ko.md`。
- 每份交给维护者审阅的 artifact（包括 spec、implementation plan、design、
  release checklist、policy 或大幅 contributor 文档变更），都提供忠实中文副本
  或中文 review companion，并在交付时先放中文链接。
- 除非维护者明确要求那一份审阅材料，不要强制加入被 ignore 的私人文档。

## Git 与发布纪律

- 脏工作区里的无关改动必须保留；实现应使用干净的 `codex/` 分支或隔离 worktree。
- tracked 文件默认模式为 `100644` 且使用 LF。只有确实由操作系统直接执行的程序
  才能用 `100755`，并要登记到仓库 policy 测试；提交前用 `git ls-files --stage` 核对。
- commit 保持聚焦；仓库通过已审阅 PR squash-merge 到 `main`。
- 未经维护者明确批准，不得推送、创建 PR、合并或发布 Release。
- 不得手动修改 `package.json` 版本或创建发布 tag。Release Drafter 维护 draft；
  发布已审阅 draft 后才创建 tag，publish workflow 再从 tag 写入包版本。

## GitHub 文本归因

经过维护者审阅的 Codex 文本必须以以下内容准确结尾：

```md
---
🤖 Generated with [OpenAI Codex](https://developers.openai.com/codex/)
```

未经审阅的 Codex 自动 first pass 必须使用：

```md
---
🤖 Generated by [OpenAI Codex](https://developers.openai.com/codex/) as an automated first pass — not a maintainer decision.
```

- 归因必须写实际 generator。当前 first-pass runner 默认使用 DeepSeek，不得改标 Codex。
- trusted footer 由 wrapper 而不是模型输出负责，并且只能出现一次。
- 在六份 README 中把 Claude Code 与 OpenAI Codex 记为开发工具；不得把工具放入
  Release Drafter 的人类 contributor 列表，也不得编造 `Co-Authored-By` 身份。
- comment-only 的受控 first-pass automation 与 maintainer-only 的高权限 mention
  workflow 必须保持分离。
````

- [ ] **Step 6: 将 CLAUDE.md 收敛为兼容入口**

Replace `CLAUDE.md` with exactly:

```md
# CLAUDE.md

Compatibility entry point for Claude Code. `AGENTS.md` is the canonical
repository policy; read and follow it before changing this repository. The
faithful maintainer review copy is `AGENTS.zh-CN.md`.

Claude-specific compatibility notes:

- The product remains Claude-only in v2.2.1; Codex is a development tool.
- Claude conversation JSONL is read-only. OAuth credential refresh is a
  separate, existing security-sensitive behavior; do not broaden it casually.
- JSONL activity may tune the quota-cache TTL, but polling always follows
  `refreshInterval`; do not restore a hidden active polling override.
- Do not create a second policy source here. Update `AGENTS.md` and its Chinese
  review copy when repository rules change.
```

- [ ] **Step 7: 运行聚焦测试并确认通过**

Run: `npm run compile && node --test out/test/repositoryPolicy.test.js`

Expected: 3 tests，3 pass，0 fail。

- [ ] **Step 8: 检查中英文关键约束是否成对出现**

Run: `rg -n "Claude-only|runtime dependenc|seven UI locales|maintainer approval|OpenAI Codex" AGENTS.md && rg -n "Claude-only|runtime dependency|七个 UI locale|维护者明确批准|OpenAI Codex" AGENTS.zh-CN.md`

Expected: 两个命令都命中五类约束；无缺项。

- [ ] **Step 9: 提交 agent 指导**

```bash
git add AGENTS.md AGENTS.zh-CN.md CLAUDE.md src/test/repositoryPolicy.test.ts
git commit -m "docs: establish Codex repository guidance"
```

Expected: 一个只包含两份 agent 指导、Claude Code 兼容入口和 policy test 源文件的 commit；`out/` 生成物保持 ignored 且不提交。

---

### Task 2: 固化 LF、文件模式、ignore 与 VSIX 排除边界

**Files:**
- Create: `.gitattributes`
- Modify: `.gitignore:27`
- Modify: `.vscodeignore:1-28`
- Modify: `src/test/repositoryPolicy.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `REPO_ROOT` 与 `repoFile(relativePath: string): string`。
- Produces: LF 规则、二进制扩展名、agent 本地目录 ignore 集合、VSIX forbidden-path 集合，以及 tracked mode 回归检查。

- [ ] **Step 1: 在测试文件中加入失败的仓库卫生断言**

Add this import to `src/test/repositoryPolicy.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
```

Append exactly:

```ts
function activePatterns(relativePath: string): Set<string> {
  return new Set(
    repoFile(relativePath)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

test('line endings and tracked file modes are repository-safe', () => {
  const attributes = repoFile('.gitattributes');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
  for (const binary of ['*.png binary', '*.jpg binary', '*.jpeg binary', '*.gif binary', '*.webp binary', '*.ico binary', '*.vsix binary']) {
    assert.match(attributes, new RegExp(`^${binary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }

  const badModes = execFileSync('git', ['ls-files', '--stage'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.startsWith('100644 '));
  assert.deepEqual(badModes, []);
});

test('git and VSIX ignores exclude private and development-only material', () => {
  const gitIgnore = activePatterns('.gitignore');
  for (const pattern of ['out', 'node_modules', '*.vsix', '.env', '.env.*', 'secrets.json', 'CLAUDE.local.md', 'docs/', '.claude/', '.agents/', '.codex/', '.worktrees/']) {
    assert.ok(gitIgnore.has(pattern), `.gitignore missing ${pattern}`);
  }

  const vscodeIgnore = activePatterns('.vscodeignore');
  for (const pattern of ['.github/**', 'src/**', 'out/test/**', 'AGENTS.md', 'AGENTS.zh-CN.md', 'CLAUDE.md', 'CLAUDE.local.md', 'CONTRIBUTING.md', 'docs/**', '.claude/**', '.agents/**', '.codex/**', '.worktrees/**', '.env', '**/.env', '**/.env.*', '**/secrets.json', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx']) {
    assert.ok(vscodeIgnore.has(pattern), `.vscodeignore missing ${pattern}`);
  }
});
```

- [ ] **Step 2: 运行聚焦测试并确认新断言失败**

Run: `npm run compile && node --test out/test/repositoryPolicy.test.js`

Expected: FAIL；首先报告 `.gitattributes` 的 `ENOENT`。

- [ ] **Step 3: 添加 LF 与二进制规则**

Create `.gitattributes` with exactly:

```gitattributes
* text=auto eol=lf

*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.webp binary
*.ico binary
*.vsix binary
```

- [ ] **Step 4: 隔离 agent 本地状态和仓库内 worktree**

Append to `.gitignore`:

```gitignore

# Agent-local state and in-repository worktrees are never source artifacts.
.claude/
.agents/
.codex/
.worktrees/
```

- [ ] **Step 5: 扩大 VSIX 指令与本地状态排除集合**

Insert after `.claude/**` in `.vscodeignore`:

```gitignore
.agents/**
.codex/**
.worktrees/**
```

Insert after `out/test/**`:

```gitignore
AGENTS.md
AGENTS.zh-CN.md
```

Append the explicit secret/key package denylist:

```gitignore
**/.env
**/.env.*
**/secrets.json
**/*.pem
**/*.key
**/*.p12
**/*.pfx
```

- [ ] **Step 6: 规范当前 tracked 文件模式**

Run: `git ls-files --stage | awk '$1 != "100644" { print $4 }'`

Expected: 干净 v2.2.0 基线无输出。若出现文件，停止本 task，逐个核对精确输出并在计划中登记真实 executable allowlist；不得用目录或 glob 批量改 mode。

- [ ] **Step 7: 运行聚焦测试和 whitespace 检查**

Run: `npm run compile && node --test out/test/repositoryPolicy.test.js`

Expected: 5 tests，5 pass，0 fail。

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 8: 提交仓库卫生防护**

```bash
git add .gitattributes .gitignore .vscodeignore src/test/repositoryPolicy.test.ts
git commit -m "chore: protect repository and package boundaries"
```

Expected: commit 不包含任何本地 secret、`.vsix` 或 agent 状态文件。

---

### Task 3: 在六份 README 如实记录工具致谢并修正 locale 数量

**Files:**
- Modify: `README.md:338-340`
- Modify: `README-en.md:73-76`
- Modify: `README-zh-CN.md:187-200`
- Modify: `README-zh-TW.md:73-76`
- Modify: `README-ja.md:73-76`
- Modify: `README-ko.md:73-76`
- Modify: `CHANGELOG.md:1-8`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md:31-35`
- Modify: `src/test/repositoryPolicy.test.ts`

**Interfaces:**
- Consumes: Task 1 的 README 同步规则与“工具不是人类 contributor”边界。
- Produces: 六份 README 中一致的 OpenAI Codex tool-credit 链接；PR checklist 的七 locale 约束。

- [ ] **Step 1: 添加失败的多语言文档断言**

Append to `src/test/repositoryPolicy.test.ts`:

```ts
test('all six README files credit both development tools', () => {
  const readmes = [
    'README.md',
    'README-en.md',
    'README-zh-CN.md',
    'README-zh-TW.md',
    'README-ja.md',
    'README-ko.md',
  ];
  for (const readme of readmes) {
    const body = repoFile(readme);
    assert.match(body, /https:\/\/claude\.com\/claude-code/, `${readme} missing Claude Code credit`);
    assert.match(body, /https:\/\/developers\.openai\.com\/codex\//, `${readme} missing OpenAI Codex credit`);
  }
});

test('pull request checklist names the actual seven UI locales', () => {
  const packageJson = JSON.parse(repoFile('package.json')) as {
    contributes: { configuration: { properties: Record<string, { enum?: string[] }> } };
  };
  const languageValues = packageJson.contributes.configuration.properties['claudeCodeUsage.language'].enum ?? [];
  assert.equal(languageValues.filter((value) => value !== 'auto').length, 7);

  const template = repoFile('.github/PULL_REQUEST_TEMPLATE.md');
  assert.match(template, /all seven UI locales/);
  assert.doesNotMatch(template, /all six languages/);
  assert.match(template, /all six README editions/);
});

test('changelog records the released baseline and the v2.2.1 tooling transition', () => {
  const changelog = repoFile('CHANGELOG.md');
  assert.match(changelog, /^## \[2\.2\.1\] — Unreleased$/m);
  assert.match(changelog, /^## \[2\.2\.0\] — 2026-07-07$/m);
  assert.match(changelog, /OpenAI Codex/);
  assert.doesNotMatch(changelog, /^## \[2\.2\.0\] — Unreleased$/m);
});
```

- [ ] **Step 2: 运行聚焦测试并确认 Codex credit 缺失**

Run: `npm run compile && node --test out/test/repositoryPolicy.test.js`

Expected: FAIL；`all six README files credit both development tools` 首先指出 `README.md missing OpenAI Codex credit`。

- [ ] **Step 3: 更新英文主 README 与英文精简 README**

In `README.md`, insert after the paragraph ending with `see [CHANGELOG.md](CHANGELOG.md).`:

```md

Development-tool credit: repository maintenance uses both
[Claude Code](https://claude.com/claude-code) and
[OpenAI Codex](https://developers.openai.com/codex/). This credits the tools
separately from human contributors: Codex is not added to Release Drafter's
contributor list, and no fabricated `Co-Authored-By` identity is used for it.
```

In `README-en.md`, insert after the existing Credits paragraph:

```md

Development-tool credit: repository maintenance uses both [Claude Code](https://claude.com/claude-code) and [OpenAI Codex](https://developers.openai.com/codex/). This credits tools separately from human contributors; Codex is not added to Release Drafter's contributor list and receives no fabricated `Co-Authored-By` identity.
```

- [ ] **Step 4: 更新简体与繁体中文 README**

In `README-zh-CN.md`, insert after the opening Credits paragraph ending in `CHANGELOG.md`:

```md

开发工具致谢：仓库维护同时使用了 [Claude Code](https://claude.com/claude-code) 和 [OpenAI Codex](https://developers.openai.com/codex/)。这只记录开发工具，与人类贡献者身份分开；Codex 不会进入 Release Drafter 的人类 contributor 列表，也不会获得伪造的 `Co-Authored-By` 身份。
```

In `README-zh-TW.md`, insert after the existing Credits paragraph:

```md

開發工具致謝：repository 維護同時使用 [Claude Code](https://claude.com/claude-code) 與 [OpenAI Codex](https://developers.openai.com/codex/)。這只記錄開發工具，與人類貢獻者身分分開；Codex 不會列入 Release Drafter 的人類 contributor 名單，也不會使用虛構的 `Co-Authored-By` 身分。
```

- [ ] **Step 5: 更新日文与韩文 README**

In `README-ja.md`, insert after the existing Credits paragraph:

```md

開発ツールのクレジット：リポジトリの保守には [Claude Code](https://claude.com/claude-code) と [OpenAI Codex](https://developers.openai.com/codex/) の両方を使用しています。これは人間のコントリビューターとは別のツール表記であり、Codex を Release Drafter のコントリビューター一覧に加えたり、架空の `Co-Authored-By` ID を付けたりしません。
```

In `README-ko.md`, insert after the existing Credits paragraph:

```md

개발 도구 크레딧: 저장소 유지보수에는 [Claude Code](https://claude.com/claude-code)와 [OpenAI Codex](https://developers.openai.com/codex/)를 함께 사용합니다. 이는 사람 기여자와 분리된 도구 표기이며, Codex를 Release Drafter의 사람 기여자 목록에 넣거나 허위 `Co-Authored-By` 신원을 부여하지 않습니다.
```

- [ ] **Step 6: 修正 PR template 的 locale checklist**

Replace:

```md
- [ ] User-facing strings go through `I18n` with **all six languages** filled
```

with:

```md
- [ ] User-facing strings go through `I18n` with **all seven UI locales** filled
- [ ] Behaviour/documentation changes update **all six README editions** together
```

- [ ] **Step 7: 修正发布基线并建立 v2.2.1 CHANGELOG 区段**

Change `## [2.2.0] — Unreleased` to `## [2.2.0] — 2026-07-07`, then insert before it:

```md
## [2.2.1] — Unreleased

### Changed
- **Codex maintenance handoff** — `AGENTS.md` is now the canonical repository
  policy with a Simplified-Chinese review copy. Claude Code and OpenAI Codex
  are credited as development tools, separately from human contributors.
```

Later v2.2.1 plans append their own `Fixed`, `Diagnostics`, or `Security` bullets under this single header; they must not create a second `2.2.1` section.

- [ ] **Step 8: 运行聚焦测试并检查六份文件同步性**

Run: `npm run compile && node --test out/test/repositoryPolicy.test.js`

Expected: 8 tests，8 pass，0 fail。

Run: `for file in README.md README-en.md README-zh-CN.md README-zh-TW.md README-ja.md README-ko.md; do rg -n "developers.openai.com/codex/" "$file" || exit 1; done`

Expected: 每个 README 恰好至少出现一条 OpenAI Codex tool-credit 命中；任何文件无命中都会令检查不完整。

- [ ] **Step 9: 提交多语言工具致谢**

```bash
git add README.md README-en.md README-zh-CN.md README-zh-TW.md README-ja.md README-ko.md CHANGELOG.md .github/PULL_REQUEST_TEMPLATE.md src/test/repositoryPolicy.test.ts
git commit -m "docs: credit Codex development tooling"
```

Expected: commit 同时包含六份 README，不修改 `.github/release-drafter.yml`，也不添加任何 `Co-Authored-By` trailer。

---

### Task 4: 执行完整测试与实际 VSIX 清单审计

**Files:**
- Verify only: all tracked source and generated test output
- Produce outside repository: `/tmp/claude-code-usage-policy-review.vsix`
- Produce outside repository: `/tmp/claude-code-usage-policy-review.files`

**Interfaces:**
- Consumes: Tasks 1-3 的 policy tests、`.vscodeignore` 和 README 文档。
- Produces: 可附在 PR/release checklist 的零失败测试结果与不含私有/开发文件的真实 VSIX 清单证据。

- [ ] **Step 1: 运行完整编译测试套件**

Run: `npm test`

Expected: 编译退出码 0；全部 `node:test` 通过，`fail 0`。

- [ ] **Step 2: 生成候选 VSIX 到明确的临时路径**

Run: `npx @vscode/vsce package --out /tmp/claude-code-usage-policy-review.vsix`

Codex Desktop equivalent:

```bash
CCU_NODE=/Users/carl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$CCU_NODE" node_modules/typescript/bin/tsc -p ./
"$CCU_NODE" -e 'require("./node_modules/@vscode/vsce/out/package").pack({ cwd: process.cwd(), packagePath: "/tmp/claude-code-usage-policy-review.vsix", dependencies: false }).catch((error) => { console.error(error); process.exit(1); })'
```

Expected: 编译和 pinned VSCE pack 均退出 0，并写入 `/tmp/claude-code-usage-policy-review.vsix`；`dependencies: false` 只跳过缺失 npm 的 dependency/prepublish 探测，前一行显式编译不能省略。文件名故意不冒充尚未由 Release Drafter 发布的 v2.2.1，且不得在仓库根目录留下 `*.vsix`。

- [ ] **Step 3: 导出并检查真实包清单**

Run: `unzip -Z1 /tmp/claude-code-usage-policy-review.vsix | sort > /tmp/claude-code-usage-policy-review.files`

Expected: 退出码 0，清单非空。

Run:

```bash
if rg -n '^extension/(AGENTS(?:\.zh-CN)?\.md|CLAUDE(?:\.local)?\.md|CONTRIBUTING\.md|docs/|\.github/|src/|out/test/|(?:.*/)?\.env(?:\..*)?$|(?:.*/)?secrets\.json$|\.claude/|\.agents/|\.codex/|\.worktrees/|.*\.(?:pem|key|p12|pfx)$)' /tmp/claude-code-usage-policy-review.files; then
  exit 1
fi
```

Expected: 无 forbidden-path 输出，命令退出码 0。

Run:

```bash
for required in extension/package.json extension/out/extension.js extension/readme.md extension/LICENSE.txt extension/icon.png; do
  rg -Fqx "$required" /tmp/claude-code-usage-policy-review.files || exit 1
  test "$(rg -Fxc "$required" /tmp/claude-code-usage-policy-review.files)" -eq 1 || exit 1
done
```

Expected: 五个 required artifact 各存在且恰好命中一次；任一缺失或重复都会退出 1。

- [ ] **Step 4: 检查 diff、文件模式与工作树**

Run: `git diff --check upstream/main...HEAD`

Expected: 无输出，退出码 0。

Run: `git ls-files --stage | awk '$1 != "100644" { print }'`

Expected: 无输出。

Run: `git status --short`

Expected: 无输出；临时 VSIX 和清单都位于 `/tmp`，不污染工作树。

- [ ] **Step 5: 记录验证证据，不制造空 commit**

在 PR 或 release checklist 中记录 `npm test` 的通过摘要、VSIX 路径、forbidden-path 检查无输出和 required artifact 五项命中。该步骤不修改仓库，因此不创建空 commit。
