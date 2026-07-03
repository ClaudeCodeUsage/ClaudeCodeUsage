# 架构说明

> 本扩展的简明技术地图——它是什么、数据如何流动、以及那些"精确的" token / 成本
> 数字是怎么算出来的。刻意写得简短：它是给贡献者（或自动化的 issue/PR 助手）
> 读的参考，让他们**不必**重新通读 `src/`。如果你改变了某个模块的职责或数据
> 流，请同步更新本文件。英文版见
> [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 它是什么（以及不是什么）

**Claude Code Usage** 是一个 VS Code 扩展，通过读取 Claude Code 自己的本地日志，
在状态栏和仪表盘 webview 中报告 Claude Code 的 token 用量与成本。它刻意保持：

- **只服务 Claude**——围绕 Claude Code 的日志格式和 Anthropic 的 OAuth 额度构建。
  （为方便 CC-Switch 用户，也给 DeepSeek 等做了定价，但 Claude 是核心。）
- **轻量**——界面精简、无运行时依赖、次要视图默认折叠。
- **聚焦 token 归因**——头部的核心数字是**精确的**，直接读自每次请求自带的用量
  记账，而非估算。
- 对 `~/.claude` **只读**——绝不写入 Claude Code 的数据。

**范围之外**（用这张清单做 issue 初筛）：把多供应商/多厂商仪表盘当作一等功能；
完整的账单/发票对账；写入或驱动 Claude Code；与用量无关的分析。能让 token 洞察、
归因或建议体验更锋利的需求，才是合适的方向。

## 模块地图（`src/`）

| 模块 | 职责 |
|---|---|
| `extension.ts` | 激活、命令注册，以及刷新编排：一个"感知活跃度"、会自我重排的定时器（你活跃时更快、空闲时更缓），带 generation 守卫与合并去重，外加 `pauseDashboardRefresh`。配置经 `SettingsStore` 读取，启动时跑一次设置迁移，监听 workspace 文件夹切换（重取额度），并持有 `runOptimizer`（用量优化器往返）。把 loader + 状态栏 + webview + 额度客户端串起来。 |
| `dataLoader.ts` | 数据管线。读取 `~/.claude/projects/**/*.jsonl`，解析/校验/去重记录，提取会话标题与用户提示标记，并完成全部聚合（`calculateUsageData` + 今日/本月/会话/项目/分组/分支等口径）。v2.1 还有：`getWorkflowBreakdown`（从 `subagents/` 日志识别多 agent 运行 + 临时批次）、`getUsageAttribution`（用量构成面板）、`getCurrentContextInfo` + `contextWindowFor`（按模型上下文窗口、取主线程记录、`estimated` 标记）、内容/校准分析（`windowDays` 可配）。逻辑量最大的一块。 |
| `settings.ts` | **（v2.1）** 所有用户设置的单一真源：`SETTINGS` 目录（类型/默认/存储/分组）+ `SettingsStore`。核心三项（`language`、`dataDirectory`、`advice.apiKey`）留 VS Code 配置；其余进 `globalState`，由 dashboard 的 ⚙ 设置标签页编辑。`migrateOnce()` 把 2.1 前 `settings.json` 的值搬进存储。 |
| `pricing.ts` | 按模型、按 token 的费率表（input / output / 缓存写 / 缓存读分别计价），模型家族推断，以及 `[1m]` 上下文后缀的剥离。`calculateCostBreakdown` 把一条用量记录变成四部分成本。 |
| `statusBar.ts` | 三个状态栏条目：主条目（今日成本**或** token 量，`statusBarMetric`；三项全隐藏时退化为只剩图标的入口）、额度条目（5h / 每周，可选 `opus:NN%`）、实验性上下文窗口指示器（条形 + 明细 tooltip，窗口为猜测时标 `~`）。 |
| `webview.ts` | 仪表盘：分页视图（今日、会话、项目、内容、分支、工作流、**⚙ 设置**）、AI 建议 + 用量优化器操作卡、图表与可排序表格。跨重渲染保留优化器状态，并跳过完全相同的重渲染。体量最大的文件——几乎所有 UI 都在这里。 |
| `claudeApiClient.ts` | Anthropic OAuth 额度：读取 `~/.claude/.credentials.json`，刷新 token（先重读磁盘），从 `api.anthropic.com/api/oauth/usage` 拉取真实用量。走 `httpClient`（fetch → curl）；HTTP 429 冷却 60 秒。 |
| `httpClient.ts` | **（v2.1）** 共享传输层：`requestViaFetch` 与 `requestViaCurl`（curl 的 `cwd` 钉到 home，避免切 workspace 后陈旧 cwd 触发 ENOENT）。curl 是 Anthropic TLS 指纹门 `403 "Request not allowed"` 的兜底。 |
| `advisor.ts` | AI 建议 + **用量优化器**传输层：`callModel`（Anthropic `/v1/messages` 或 OpenAI chat-completions，带 curl 403 兜底）、`getUsageAdvice`，以及优化器纯函数 `buildOptimizerSystemPrompt` / `parseOptimizerOutput`。只支持 API（订阅分支留休眠）。需手动开启。 |
| `adviceSummary.ts` | **（v2.1）** 构建发给建议模型的用量摘要——聚合 + 多 agent 运行 + 思考占比 + 归因 + 一段按窗口取的用户自己的 prompt 样本。 |
| `adviceDemoSample.ts` | 在配置 key 之前展示的静态示例建议（六种语言全覆盖），让功能可被发现。 |
| `i18n.ts` | 六种语言的字符串表（`en`、`de-DE`、`zh-TW`、`zh-CN`、`ja`、`ko`）+ `SETTINGS_I18N`（⚙ 设置面板每项的标签/帮助）与 `settingText()`。所有面向用户的字符串都经过这里。 |
| `types.ts` | 共享接口（`ClaudeUsageRecord`、`UsageData`、`SessionUsage`、`SupportedLanguage`、`ExtensionConfig`、`ContextWindowInfo`、额度 + 归因 + 工作流类型……）。 |

## 数据流

```
~/.claude/projects/<编码后的cwd>/<会话>.jsonl       （一个文件 = 一段对话）
        │  逐行读取，对每行 JSON.parse
        ▼
校验（是用量记录吗？）─► 去重（messageId+requestId，保留 token 更高的那条）
        │  给每条记录打上 会话 id + 项目（优先用真实 cwd）
        ▼
ClaudeUsageRecord[]  ──►  calculateUsageData()  ──►  UsageData
        │                  （对 4 个 token 桶求和并各自计价）          │
        │                                                             ├─► 状态栏（今日 + 额度）
        └─ 会话标题、用户提示标记                                      └─► webview（各口径明细 + 图表）
```

额度是一条**独立**路径：`claudeApiClient` 调用 OAuth 用量接口，独立于本地日志地
返回 5 小时 / 7 天 / 7 天 Opus 的用量占比（日志无从得知你套餐的上限，只有
Anthropic 知道）。

## token 与成本如何计算（精确，而非估算）

JSONL 里每一行助手回复都带一个 `message.usage` 对象——这是 **Anthropic API 自己
的 token 记账**，与 Anthropic 计费所依据的数字相同。扩展不去估算它们，而是读取、
校验、去重、求和、计价：

1. **校验**——只保留 `usage.input_tokens` 为数字的记录（真实 API 响应）；跳过
   合成 / 报错 / `<synthetic>` 模型条目。
2. **去重**——哈希 = `messageId + requestId`；冲突时保留 token 更高的那条（应对
   某些代理会先记一行占位、再记真实数值的情况）。
3. **求和**，把四个桶累加进总数：
   - `input_tokens`——新鲜的 prompt，全价
   - `cache_read_input_tokens`——从缓存命中的前缀，约为 input 价的 10%
   - `cache_creation_input_tokens`——**写入**缓存的前缀（即"输入缓存（未命中）"
     那根条），约为 input 价的 125%；在切换模型或间隔 >5 分钟后会飙升（prompt
     缓存按模型隔离，TTL 约 5 分钟）
   - `output_tokens`——生成内容，output 价
4. **计价**——每个桶 × 其按模型的费率（`pricing.ts`）；成本 = 求和。

产品中**唯一**的估算，是"内容"标签页里基于字符数的"什么在吃 token"拆解（以及计划
中的 v2.2 模型匹配 / 缓存浪费功能）——它们始终标注为估算，绝不并入精确总数。
"消息数"只统计用户手敲的 prompt，靠合成的零 token 标记记录实现，因此永不影响 token
求和。

## 模型核心功能的日志格式事实（2026-06-13 在磁盘上验证）

JSONL 日志里*有*和*没有*什么——任何要推理运行、模型、effort 的功能的参考。当 Claude
Code 格式漂移时，用 JSON 键探查重新验证（绝不要用子串 grep——见下方的坑）。

- **运行配置（effort / thinking 预算）不被记录。** 任何用量行上都没有 `effort` /
  `ultracode` / `maxThinking` / 推理预算字段。唯一的 mode 记录是一条 `type:"mode"` 行，
  带 `permissionMode`（如 `"normal"`）。**我们无法得知一次运行用的是什么 effort 等级。**
  ⇒ 唯一可靠的"动态工作流已启用"信号是 **`subagents/workflows/wf_<id>/` 目录的存在**，
  而非 effort。普通 Task 工具扇出（无 `wf_` 目录）是"临时批次"，不是工作流。
  - **坑：** 子串 grep `effort`/`ultracode` *看起来*命中了——但只在 prompt 正文和工具调用
    日志里（包括本插件自己的命令一旦被记录）。解析 JSON 键；绝不为配置去 grep。
- **skill / 插件归因是一等的。** 助手用量行带 `attributionSkill`（如
  `"superpowers:executing-plans"`）和 `attributionPlugin`（如 `"superpowers"`）。它们是
  权威的——优先用它们而非旧的 `<command-name>` / `Skill` tool_use 启发式，并用 skill/插件
  自身行的*精确* `message.usage` 来加权。
- **为什么原生 Claude 的"工作流"在工作流 tab 里看起来缺失。** Claude 子代理日志*确实*
  存在（某些 `subagents/` 目录下有 haiku/opus）。但当原生 Claude 运行用 ultracode 时，
  昂贵的 **Opus/Fable 编排留在主会话日志里**，只有便宜的 **haiku** 子代理（或没有）写
  `agent-*.jsonl`。一个重度 Fable/Opus 的主线程可能**根本没有 `subagents/` 目录**。工作流
  tab 按*子代理文件*分组，所以它显示便宜模型、漏掉主线程成本——这正是 v2.1-PartII 要修的
  （关联运行的编排主会话并显示其成本/模型）。**通则：** *昂贵*模型通常是主线程编排者；
  子代理文件偏便宜。永远不要只凭子代理文件推断"我主要用哪个模型"。
- **较新的字段（Claude Code ≥ 2.1）** 值得知道：顶层 `entrypoint`（如 `claude-vscode`）、
  `permissionMode`、`version`、`context_management`；行 `type`：`mode`、`last-prompt`
  （逐字的最后一条用户 prompt）、`queue-operation`、`file-history-snapshot`、`attachment`、
  `system`（hook 摘要）；`message.usage` 上：`service_tier`、`iterations`、`speed`、
  `inference_geo`、`cache_creation`（对象）。总量（`input/output/cache_*`）仍然精确。

## 关键不变量（别破坏它们）

- 对 `~/.claude` **只读**（唯一的写是 `claudeApiClient` 刷新 `advice.apiKey` 的 token；绝不动用户日志）。
- 所有面向用户的字符串都要走 `i18n.ts`、**六种语言齐全**；设置面板的标签/帮助走 `SETTINGS_I18N`（英文回退到目录）。
- **设置统一走 `SettingsStore`，不要散读。** 只有核心三项（`language`、`dataDirectory`、`advice.apiKey`）声明在 `package.json` / VS Code 配置；其余在 `globalState`，必须经 store 读（`config.get` 找不到）。加一个设置 = `settings.ts` 目录里一条 +（其 `SETTINGS_I18N` 行）。
- 新设置**默认维持现有行为**（opt-in）；实验性/近似功能默认关闭（上下文指示器、用量优化器）。
- **不新增运行时依赖。** 对外调用（额度、建议/优化器）走 `httpClient` 的 fetch→curl 403 兜底；spawn `curl` 时 `cwd: os.homedir()`。
- 精确总数与标注过的估算，永不混在一起。
- 建议/优化器**只**发送用量摘要 / 粘贴的草稿——绝不发送用户的文件。

## 刷新模型

仪表盘 / 状态栏靠 `extension.ts` 里一个感知活跃度的循环保持最新：一个自我重排的
定时器，你活跃时间隔缩短、空闲时拉长，由 `refreshGen` generation 计数器与合并去重
守护，避免重叠刷新堆叠。对 `~/.claude/projects` 的文件监听（可关闭）带来约 1.5 秒
延迟；定时器是兜底。面板打开查看时，`pauseDashboardRefresh` 会冻结更新。

## 发布

TypeScript strict、干净编译（`node ./node_modules/typescript/bin/tsc -p ./`——F5/调试任务用它而非 `npm`，绕开 Windows 的 `npm.ps1` 执行策略拦截）、`node:test` 全绿。仓库在组织 **`ClaudeCodeUsage/ClaudeCodeUsage`**，`main` 有分支保护（PR + `test` 检查）。流程（Release Drafter，v2.0.3 搭好）：贡献者提 PR；维护者带版本标签（`patch`/`minor`/`major`，默认 patch）**squash-merge**——这就是每个 PR 的全部操作；草稿 Release 自动攒好分类发布说明；点 **Publish** 打 `v*` 标签，`publish.yml` 盖好 `package.json`、用 `@vscode/vsce` 打包，发到 VS Code Marketplace + Open VSX 并附 `.vsix`。跨 fork PR 的署名由 squash-merge 保住；个别手动重落用 `git merge -s ours` 把贡献者提交留作已合并祖先。关 issue 的 PR 用 `Closes #N`。
