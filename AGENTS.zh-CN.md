# AGENTS.md（简体中文审阅版）

本文件是根目录 [AGENTS.md](AGENTS.md) 的忠实中文副本，供维护者快速审阅；
执行约束以两份文件共同表达的同一规则为准。

## 产品定位与范围

- Claude Code Usage 是一个读取本地 Claude Code 与 Codex 用量日志的
  VS Code 扩展。Claude 保留精确 token 总量、成本估算与 OAuth 配额；
  v2.3.0 直接包含 Codex Beta，提供 provider-specific 的本地用量与优化视图，
  以及明确标注的 API 等效成本估算；不得把估算冒充账单或订阅扣费，
  也不假定其指标与 Claude 账单等价。
- 保留既有产品身份与 Claude 工作流，同时增加 provider-neutral contract。
  Claude 与 Codex 仪表盘必须复用同一组 provider-aware render function 和同一份 CSS contract。
- 优先保证 token 归因准确，不追求账单级精度。精确总量、明确标注的估算、
  某一时点的配额观测必须保持为不同概念。
- 扩展保持 local-first、轻量和 read-mostly。绝不修改 Claude 或 Codex 对话 JSONL；
  credential 处理属于安全敏感范围，只保留已经审阅的既有行为。
- v2.3.0 不新增 runtime dependency。

## 架构边界

- `src/extension.ts`：激活、命令、刷新调度、watcher、合并刷新、设置变化和诊断输出。
- `src/dataLoader.ts`：Claude JSONL 解析 primitive、校验、归因与内容分析 reducer，
  用于保持既有精确语义兼容。
- `src/claudeIncrementalIndex.ts`：生产环境使用的 Claude 内存 per-file 用量索引、
  append-tail 解析、精确全局去重与已物化的 dashboard aggregate。运行中刷新不得
  回退为全语料 body 重读或全 records 重新聚合。
- `src/providers/providerTypes.ts` 与 provider adapter：provider-neutral token、
  coverage、confidence 与 limit contract；不得抹平 provider 语义。
- `src/providers/codex/`：允许目录发现、schema guard、精确单次请求解析及
  cumulative high-water 回退、per-file 聚合索引、worker protocol、受限多 worker
  冷回填和 Codex facade。
- `src/codexView.ts` / `src/codexViewComponents.ts`：只保存 Codex 文案与默认
  provider contract，不负责 HTML、client code 或样式。
- `src/settings.ts`：`SETTINGS` catalog 与 `SettingsStore`；不要散落直接配置读取。
- `src/statusBar.ts`：状态栏 token、成本、配额和 context 展示。
- `src/webview.ts`：Claude/Codex 唯一一套 provider-aware dashboard HTML 与客户端行为；
  Compare 绝不跨 provider 求和成本或配额。
- `src/i18n.ts`：八个 UI locale 的全部用户可见文案。
- `src/types.ts`：共享 contract。
- 改变模块职责或数据流前先读 `ARCHITECTURE.md`；若该变化需要维护者审阅，
  同时提供忠实的简体中文 review companion。

## 安全与隐私不变量

- 绝不上传 prompt、response、原始 JSONL 行、绝对路径、原始 session ID、
  credential 或本地用户名。v2.3.0 新增的诊断也不得记录这些内容；未经过
  明确隐私审阅，不扩大历史诊断输出范围。
- Codex 只发现 `$CODEX_HOME/sessions/**/*.jsonl` 与
  `$CODEX_HOME/archived_sessions/**/*.jsonl`（默认 `~/.codex`）。不得为用量
  读取 `auth.json`、SQLite、config secret、keychain、浏览器状态或未知文件。
- 另允许流式读取 `$CODEX_HOME/session_index.jsonl`，但仅用于恢复真实线程标题所需的
  `id` → `thread_name` 映射。标题中的绝对路径必须遮蔽，标题仅驻留内存且绝不持久化；
  符号链接与非普通文件必须拒绝，并且不读取该文件的任何其他字段。
- Codex raw path/session/parent ID 只允许存在于本地 worker 的短期内存；
  持久化只保留 machine-salted 伪名 key 与数字聚合。
- Advice 和 optimizer 的网络调用必须由用户明确触发，只能发送文档约定的摘要
  或用户亲自粘贴的文字。
- 新设置默认行为必须有明确文档且符合直觉。Beta provider 只能在允许的本地目录
  存在时默认启用，目录不存在时必须 no-op；其他实验性/近似功能默认关闭，
  除非已批准 spec 明确规定例外。
- 不要仅为了诊断功能而读取 secret 或 credential 文件；使用脱敏 metadata 与 fixture。
- 不要手改 `out/` 生成物；修改 `src/` 后编译。

## Codex Beta 数据与性能不变量

- Codex processed tokens 是 `input + output`；fresh input + output 是
  `max(0, input - cached input) + output`，它只是行为优化指标，不是成本或配额等价。
  Cached input 是 input 子集，reasoning 是 output 子集，绝不重复相加。
- 有效请求的各 token component 优先取自 `last_token_usage`；其中 `total_tokens`
  表示活跃上下文大小，不是该请求的用量。只有完整的 total-plus-last 数字签名与
  同一 machine-salted rate-limit 来源或紧邻的上一条记录一致时，才判定为重放。
  若缺少 last usage，则回退为按 lineage high-water baseline 解析 cumulative
  `total_token_usage`。Counter regression、unknown parent 和 schema drift 产生明确
  quality flag，不伪造精度。
- 持久化 parser 语义变化必须触发一次有界自动重扫。重建期间排除旧 aggregate，
  持续显示已索引小计与进度，不混合两套不兼容的总量。
- 从 Codex 本地日志恢复的 rate limit 只是 `last-observed`；到达 reset 时间后丢弃，
  不为了追求“实时”而读 credential 或发网络请求。
- 2.4-GB-class 历史必须由 background worker 与持久化 per-file 聚合索引处理。
  Unchanged warm refresh 不读 JSONL body，append refresh 只读 tail；支持 progress、cancel、resume
  与 single-flight。一次性的未完成回填可以使用自适应、受限的本地 worker pool 与
  更粗粒度的 durable checkpoint；收敛后必须回到低功耗增量路径。
- Claude 运行中刷新使用 `claudeIncrementalIndex.ts` 的内存 per-file 索引。
  Unchanged refresh 的 JSONL body read 必须为 0；append/truncate/replace/move/delete
  只处理受影响文件和 aggregate group，同时保持既有 response-identity 去重与
  content-analysis 语义。新的 Extension Host 仍可执行一次冷内存建索引；这与每次
  watcher event 都重读全语料是两回事。
- Codex 优化建议只使用结构化数字信号，不读取或持久化 prompt/response/command body
  或 tool arguments。

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

### UI 渲染环境保真度

任何 UI 改动，渲染环境必须先证明与真实 VS Code webview 等价：生产样式表中所有
被引用的 `--vscode-*` 变量必须在测试 harness 中有真实取值，且有守卫测试强制
这一点。在此之前产生的视觉快照一律不作为验收依据。
变量的取值必须来自 VS Code 内置主题的注册值，不得混用其他配色体系。

### 交互状态验收

webview 刷新为整页替换。任何新增的用户可交互状态（展开/折叠、排序、筛选、
选中），必须接入现有持久化机制，并附带一条“操作 → reload → 状态仍在”的测试。
只验证首次渲染的静态断言不构成验收。

## 本地化与审阅文档

- 每个用户可见字符串都通过 `I18n` 覆盖八个 UI locale：`en`、`de-DE`、
  `zh-TW`、`zh-CN`、`ja`、`ko`、`pt-BR`、`id`。
- 七份 README 必须一起更新：`README.md`、`README-en.md`、`README-zh-CN.md`、
  `README-zh-TW.md`、`README-ja.md`、`README-ko.md`、`README-id.md`。
- 每份交给维护者审阅的 artifact（包括 spec、implementation plan、design、
  release checklist、policy 或大幅 contributor 文档变更），都提供忠实中文副本
  或中文 review companion，并确保交付时中文链接排在英文链接之前。
- 除非维护者明确要求那一份审阅材料，不要强制加入被 ignore 的私人文档。

## Git 与发布纪律

- 脏工作区里的无关改动必须保留；实现应使用干净的 `codex/` 分支或隔离 worktree。
- tracked 文件默认模式为 `100644` 且使用 LF。只有确实由操作系统直接执行的程序
  才能用 `100755`，并要登记到仓库 policy 测试；提交前用 `git ls-files --stage` 核对。
- commit 保持聚焦；仓库通过已审阅 PR squash-merge 到 `main`。
- 严禁把贡献者 PR 的改动吸收到维护者 PR 后，再以 superseded／已吸收为由直接关闭
  贡献者 PR。必须优先合并贡献者的原始 PR；如确需修改，应先获得明确授权，在该原始
  PR 分支上修改后再合并。额外测试、重构或加固应作为建立在已合并贡献之上的后续 PR。
- PR 不够合理但仍有实际价值时，应友善提出修改意见并优先请作者更新；经明确授权后，
  也可以直接在原 PR 分支调整，并在修改后合并，不要用维护者 PR 取代贡献者记录。
- 不合并而关闭贡献者 PR 只限于确实无可保留价值的极少数情况，例如空 PR、spam 或
  与项目完全无关的改动；关闭时必须公开、尊重地说明原因。
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
- 在七份 README 中把 Claude Code 与 OpenAI Codex 记为开发工具；不得把工具放入
  Release Drafter 的人类 contributor 列表。主要撰写代码的 OpenAI Codex commit 必须
  带以下精确 trailer：

```text
Co-authored-by: OpenAI Codex <215057067+openai-codex[bot]@users.noreply.github.com>
```
- comment-only 的受控 first-pass automation 与 maintainer-only 的高权限 mention
  workflow 必须保持分离。
