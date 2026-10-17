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
- 采用纯粹、克制的极客风，以精炼统计帮助用户理解模型用量与使用行为，不为展示效果过度设计。
  无关的新增附加功能默认关闭；明显改变既有使用习惯的体验须有可选开关并保留熟悉路径，
  不强制替换。此准入约束针对新增范围，文档修订不暗中修改已发布默认值，
  也不把正确性、安全性或常规维护修补变为可选项。
- 优先保证 token 归因准确，不追求账单级精度。精确总量、明确标注的估算、
  某一时点的配额观测必须保持为不同概念。
- 扩展保持 local-first、轻量和 read-mostly。用量读取和派生数据清除绝不改写或删除
  供应商对话 JSONL。既有“会话操作”只有在另行启用并精确确认后，才能将单个 Claude
  日志移入系统回收站；这不授权 agent 删除日志。Codex 源日志始终只读。
  credential 处理属于安全敏感范围，只保留已经审阅的既有行为。
- 当前候选未经维护者明确批准，不新增 runtime dependency。

## 维护者决策与智能体执行

- 维护者裁决用户价值、功能范围、默认行为、披露和发布承诺；智能体在已授权范围内
  负责实现、反例、回归测试、性能测量和证据整合。普通实现细节不需要反复升级为产品决策。
- 新功能先明确用户问题、可观察结果、默认／关闭／重置行为和隐私／资源约束。
  优先完成最小而完整的改动；代码量、徽章数量和绿测总数不等于用户收益。
- 按任务读取文档：模块／数据流变化读 `ARCHITECTURE.md`；保留／导出字段和清除
  读 `LOCAL-DATA.md` 及其版本化基线；测试／打包／发布读 `CONTRIBUTING.md`。
  小文案修改无需重读全部历史方案。当前工作树路径、授权和验收状态放在当前交接，
  不写入这份长期政策。
- 区分源码接入、合成测试、原生行为和用户接受。缺失不是零；夹具通过不证明上游
  日志永远满足相同假设。复用相关独立意见，只为实质未解问题做有范围的新判断，
  不在每次普通修补或交付时重审。

## 架构边界

- `src/extension.ts`：激活、命令、刷新调度、watcher、合并刷新、设置变化和诊断输出。
- `src/dataLoader.ts`：Claude JSONL 解析 primitive、校验、归因与内容分析 reducer，
  用于保持既有精确语义兼容。
- `src/claudeIncrementalIndex.ts`：生产环境使用的 Claude 内存 per-file 用量索引、
  append-tail 解析、精确全局去重与已物化的 dashboard aggregate。未变化暖刷新不得
  回退为全语料 body 重读或全 records 重新聚合；已有正确性优先的内容分析重放是
  独立路径，不得成为每个 watcher event 的默认处理。变更文件刷新唯一允许的例外是：
  当变更文件的归属顺序无法从保留的 per-file 贡献中证明安全时，由探针守卫的一次性重试。
- `src/providers/providerTypes.ts` 与 provider adapter：provider-neutral token、
  coverage、confidence 与 limit contract；不得抹平 provider 语义。
- `src/providers/codex/`：允许目录发现、schema guard、精确单次请求解析及
  cumulative high-water 回退、per-file 聚合索引、worker protocol、受限多 worker
  冷回填和 Codex facade。
- `src/codexView.ts` / `src/codexViewComponents.ts`：只保存 Codex 文案与默认
  provider contract，不负责 HTML、client code 或样式。
- `src/settings.ts`：`SETTINGS` catalog 与 `SettingsStore`；不要散落直接配置读取。
- `src/statusBar.ts`：状态栏 token、成本、配额和 context 展示。
- `src/webview.ts`：Claude/Codex 唯一一套 provider-aware dashboard HTML 与客户端行为，
  以及既有宿主收据／提示所有权。新增纯计算和资格规则进入领域模块，不另建 renderer
  或重复扫描器；Compare 绝不跨 provider 求和成本或配额。
- `src/i18n.ts`：八个 UI locale 的全部用户可见文案。
- `src/types.ts`：共享 contract。
- 改变模块职责或数据流前先读 `ARCHITECTURE.md`；若该变化需要维护者审阅，
  同时提供忠实的简体中文 review companion。

## 安全与隐私不变量

- 绝不上传 prompt、response、原始 JSONL 行、绝对路径、原始 session ID、
  credential 或本地用户名。v2.3.0 新增的诊断也不得记录这些内容；未经过
  明确隐私审阅，不扩大历史诊断输出范围。
- Codex 用量发现仅限 `$CODEX_HOME/sessions` 与 `$CODEX_HOME/archived_sessions`
  下递归的 `.jsonl` 和 `.jsonl.zst` 普通文件（默认 `~/.codex`）；拒绝符号链接与
  非普通文件。不得为用量
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
  Unchanged refresh 的 JSONL body read 必须为 0；普通已验证单文件 append 只读 tail
  并更新受影响组。内容分析开启时，不安全截断／替换／删除、来源顺序或 UUID first-owner
  变化可能为保持精确语义触发更广的有序重放；该成本单独报告，不得变成每个 watcher
  event 的无条件全语料处理。新的 Extension Host 仍可执行一次冷内存建索引。
- Codex 优化建议只使用结构化数字信号，不读取或持久化 prompt/response/command body
  或 tool arguments。

## 开发与测试

```bash
npm ci --ignore-scripts
npm run compile
npm test
npm ci --prefix .github/build-tools --ignore-scripts
.github/build-tools/node_modules/.bin/vsce package
```

- 开发和主要 CI 使用 Node 24（见 `.nvmrc`）。发布工具单独锁定在
  `.github/build-tools`，禁用安装脚本并调用其本地二进制，不改用未锁定的临时下载。
  发布前审计两份锁文件；不因更新开发工具而提高 VS Code API 或运行时兼容门槛。

- 产品 TypeScript 测试使用 `node:test`，放在 `src/test/*.test.ts`；GitHub 自动化的
  ESM 测试放在 `.github/scripts/*.test.mjs`。
- 每项行为变更遵循 red-green TDD：先加聚焦的失败测试并运行，再做最小实现，
  然后运行聚焦测试和完整测试。
- 行为测试保持聚焦，文件名使用 `camelCase.test.ts`；repository policy test 可以
  合并紧密相关的仓库/打包不变量。
- 用户可见变更需要更新 `CHANGELOG.md` 和对应文档。
- UI 变更还要用 F5 Extension Development Host smoke test；候选版本在条件允许时
  需要在 macOS 和 Linux 安装 VSIX 做 smoke test。
- F5、安装或第二个 Code 实例使用夹具之前，识别并隔离全部可写 profile、extensions／
  shared／agent store、global／workspaceStorage、provider home、派生缓存和锁路径。
  单独窗口或工作树不等于隔离。按 `tests/native/README.md` 核对实际存储路径，前后
  比较选定日常状态元数据／hash；无法归因的变化保留未知，不声称无干扰。
  不替换日常安装，不把默认 profile 的直接安装当作测试捷径。
- 纯文档修订核对相关事实、链接和文档／政策测试，不产生新的运行期、原生、性能或发布通过结论。

### 插件范围内的视觉优化

- 保留现有导航、标签页、交互方式和紧凑插件密度。
  只修改明确纳入范围的标签页或导出对象；视觉任务不授权插件级前端重构、
  网页式外壳或大屏布局。
- 以现有 Claude 内容分析为 Codex 优化建议的对齐基准：精炼统计、共享信息层级，
  只增加解释数据所需的最小可视化。不得复用成就插画、等级饰件或装饰性吉祥物；
  有助理解时可沿用既有克制的指标图标。
- 额外视觉设计仅限明确指定的对象，例如成就和热力图分享，不向其他标签页扩散。
- 全面新风格属于未来单独的可选方案，应保留旧版风格与原交互路径；
  不在标签页局部优化中顺带实现新旧双风格系统。

### 全新可视化：先定稿，再实现

- 全新视觉系统（如成就系统）或大幅视觉重设计，先用内置 **imagegen** 生成
  **2–3 个有实质不同**的设计方向，不只是换色。使用合成内容并遵守现有产品／主题
  约束，不将私人日志或账户数据作为参考上传。
- 比较信息层级、密度、图案、控件、长文案／本地化、空态／错误／展开状态，以及
  窄屏／明暗布局。由维护者选择并明确确认方向后，才开始生产 UI 实现；
  只读调查与一次性可行性原型可先行。
- 将已批准设计转成具体布局、状态、无障碍与响应式验收条件，再按 red-green TDD
  在共享渲染器及既有主题 token 中实现。交付前将真实渲染截图与定稿参考对照。
  设计图不是运行期、无障碍、原生或已安装包的验收证据。
- 将定稿参考和选择理由与当前设计材料一同保存。实质改变设计方向时回到视觉确认，
  不在生产代码中不断累加猜测性修改。imagegen 不可用时说明限制，并在设计门禁前
  商定替代方式；不擅自切换付费 API／CLI 或跳过定稿。
- 已批准设计内的小文案修正、局部间距修补无需重新出图。可编辑 SVG／图标沿用原生
  格式维护；本流程不把代码原生 UI 变成栅格图片。

### UI 渲染环境保真度

任何 UI 改动，渲染环境必须先证明与真实 VS Code webview 等价：生产样式表中所有
被引用的 `--vscode-*` 变量必须在测试 harness 中有真实取值，且有守卫测试强制
这一点。在此之前产生的视觉快照一律不作为验收依据。
变量的取值必须来自 VS Code 内置主题的注册值，不得混用其他配色体系。
这是必要的渲染保真守卫，不证明原生资源 URI、字体、读屏、真实缩放或已安装包行为。

### 交互状态验收

webview 更新可能整页替换，也可能使用供应商面板 live patch。任何新增的用户可交互
状态（展开／折叠、排序、筛选、选中）必须接入现有持久化机制，并附带
“操作 → 更新 → reload → 状态仍在”的测试，保持相关焦点与滚动锚点。
只验证首次渲染的静态断言不构成验收。

## 本地化与审阅文档

- 每个用户可见字符串都通过 `I18n` 覆盖八个 UI locale：`en`、`de-DE`、
  `zh-TW`、`zh-CN`、`ja`、`ko`、`pt-BR`、`id`。
- 九份 README 必须一起更新：`README.md`、`README-en.md`、`README-de-DE.md`、
  `README-zh-CN.md`、`README-zh-TW.md`、`README-ja.md`、`README-ko.md`、
  `README-pt-BR.md`、`README-id.md`。
- README 版本概要沿用既有按 minor 版本组织的 What's New 格式：
  简短列出功能，不写实现日记，也不另造一份操作手册。
  详细规则、存储约定和验证证据放入所链接的文档，例如 `LOCAL-DATA.md`、
  `CHANGELOG.md` 和贡献文档。不在多个版本专属 README 章节重复门槛、目录数量、
  验收过程、逐项修补细节或未来路线承诺。
- 每份交给维护者审阅的 artifact（包括 spec、implementation plan、design、
  release checklist、policy 或大幅 contributor 文档变更），都提供忠实中文副本
  或中文 review companion，并确保交付时中文链接排在英文链接之前。
- 除非维护者明确要求那一份审阅材料，不要强制加入被 ignore 的私人文档。

## Git 与发布纪律

- 脏工作区里的无关改动必须保留；实现应使用干净的 `codex/` 分支或隔离 worktree。
- tracked 文件默认模式为 `100644` 且使用 LF。只有确实由操作系统直接执行的程序
  才能用 `100755`，并要登记到仓库 policy 测试；提交前用 `git ls-files --stage` 核对。
- 本项目默认使用 **Squash and merge**：每个已审阅 PR 向 `main` 合入一个提交，
  多阶段功能、性能优化和版本开发也适用。只有维护者针对该 PR 明确指定时，
  才例外使用普通 merge 或 rebase merge。
- 本地进度提交与 PR 合并策略分别管理。有意义的实现、测试和修复提交保留至 PR 合并，
  便于分阶段验证和回滚；不要仅为准备 PR 提前 squash。
  将这些提交的原始 SHA 保留在 `main` 不再是默认要求。
- 按有意义、可验证的阶段提交，不按文件、对话轮次或热力图数量拆分。一个逻辑修改应与
  对应回归测试、必要文档一起提交。琐碎格式、措辞及紧随其后的修补并入相关未发布工作；
  独立有用的修复或有证据的阶段成果单独保留至合并。不得为应用此默认规则而重写
  已发布历史或共享分支。已经 squash 的旧历史保持不变，
  不为恢复贡献热力图数量重建或重新合入旧提交。
- Squash 时保留原始 PR 和真实作者归属：核对 squash commit 的作者及所有适用的
  `Co-authored-by` trailer。Release 每条变更保留实际贡献者 credit，汇总贡献者名单
  不能替代逐条归因。不得因 squash 将他人工作改记为维护者或助手的贡献。
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
- Release 说明聚焦用户可感知的变化、必要兼容／操作说明和事实边界。不要把合并策略、
  单次验收指令、测试数量、智能体／审阅设置或普通成就档位、门槛微调列为独立发布亮点。
  内部计划和验证证据保留在 PR 与任务交接，不把维护者的实现清单直接变成公开发版文案。
  技术细节只在用户安全使用所必需时说明，同时保留真实的逐项贡献者署名。

## GitHub 文本归因

### 公开 PR 文案

- PR 说明直接写改动、理由、测试和限制。
- 不叙述私人对话中的要求、授权或智能体执行指令；概要、核对项、标题和审阅评论
  同样适用，不仅限于发版说明。执行／授权记录放在本地任务交接。
- 保留必要 AI 归因和真实贡献署名；通用仓库权限规则、归因免责声明不属于私人要求叙述。
- 未验证项直接说明事实，不以批准过程代替正确性或可合并性的证据。

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
- 在九份 README 中把 Claude Code 与 OpenAI Codex 记为开发工具；不得把工具放入
  Release Drafter 的人类 contributor 列表。主要撰写代码的 OpenAI Codex commit 必须
  带以下精确 trailer：

```text
Co-authored-by: OpenAI Codex <215057067+openai-codex[bot]@users.noreply.github.com>
```
- comment-only 的受控 first-pass automation 与 maintainer-only 的高权限 mention
  workflow 必须保持分离。

## Codex 工具适配

浏览器操作使用当前可用的 Codex browser／computer-use 工具；原文中的 Claude MCP
工具名称只描述操作意图，不能直接调用。提问按当前模式使用可用工具；已授权范围内的
本地小提交可保存进度，推送、PR、合并、tag 和发布仍须维护者明确授权。
