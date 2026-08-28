# 架构说明

> 本文简要说明扩展的 provider 边界、数据流与用量语义。模块职责或
> provider 行为变化时必须同步更新。英文版见
> [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 产品边界

**Claude Code Usage** 继续保持 local-first、无 runtime dependency 和 read-mostly。
v2.3.0 保留完整 Claude 体验，并增加 provider-specific 的 Codex Beta 用量与优化视图。

- Claude：精确的本地 token bucket、模型成本估算和 Anthropic OAuth 5 小时/每周配额。
- Codex Beta：本地 processed/fresh/cache/output/reasoning 指标、模型与 effort 拆分、
  thread 结构、索引 coverage、quality flag 与结构化优化建议。已知模型还会显示明确限定的
  API 等效成本估算；它绝不是账单或订阅扣费，未知模型保持未定价。
- Compare：只并列可比指标，绝不把不同 provider 的成本、配额或 token 求和为误导性总量。

完整账单/发票对账、驱动任一 coding agent 与后台 telemetry 不在范围内。
Opt-in GitHub 认证和跨设备聚合同步延后到 v2.4.x，届时单独做隐私审阅。

## 模块地图（`src/`）

| 模块 | 职责 |
|---|---|
| `extension.ts` | 激活、命令、设置、provider 生命周期、刷新编排、watcher、状态栏/webview 接线和匿名诊断。 |
| `dataLoader.ts` | 为精确兼容保留的 Claude 解析、校验、归因和内容分析 primitive。 |
| `claudeIncrementalIndex.ts` | 生产环境 Claude 内存 per-file 索引：append-tail 解析、精确跨文件 response 去重、受影响 group 聚合、内容分析 contribution 和已物化 dashboard row。 |
| `providers/providerTypes.ts` | Provider-neutral token、event、confidence、outcome、coverage 和 limit contract。 |
| `providers/claudeProvider.ts` | 薄兼容 adapter，不改变既有 Claude 聚合结果。 |
| `providers/codex/codexSchema.ts` | 最小安全 JSON guard，不展开或返回 message/command/tool body。 |
| `providers/codex/codexParser.ts` | Codex 精确单次请求解析及 cumulative high-water 回退、伪名 lineage metadata、结构计数、quality flag 和 last-observed limit。 |
| `providers/codex/codexManifest.ts` | Codex 允许目录发现、HMAC file key、fingerprint 和 manifest diff。 |
| `providers/codex/codexIndex.ts` | schema-3 的 per-file 数字聚合与重放证据持久化、有界 cold/tail parse、独立 aggregate/period/current-day coverage 和原子存取。 |
| `providers/codex/codexIndexWorker.ts` / `codexIndexClient.ts` | 后台协调器、recent-first progress、cancel、resume、checkpoint 持久化和 single-flight client。 |
| `providers/codex/codexFilePassPool.ts` / `codexFilePassWorker.ts` | 未完成回填期间，用于独立 main、lineage、period、current-day 和 identity per-file pass 的自适应受限本地 pool。 |
| `providers/codex/codexProvider.ts` | 面向 extension 的 Codex snapshot facade 与 partial/unavailable/error outcome。 |
| `providers/codex/codexUsage.ts` | Codex 自然日 Today/小时、7 天、30 天、月度、task 与项目 view model 聚合，以及精确模型 API 等效成本。 |
| `providers/codex/codexInsights.ts` | 确定性的结构用量建议，不读 prompt/body。 |
| `codexView.ts` / `codexViewComponents.ts` | Codex 本地化文案与默认 provider contract；不负责 HTML renderer、client script 或 CSS。 |
| `settings.ts` | 权威 `SETTINGS` catalog 和 `SettingsStore`；不得散落直接读取。 |
| `statusBar.ts` / `codexStatus.ts` | Provider-specific 状态展示和通用 Claude 配额格式化。 |
| `webview.ts` | Claude/Codex 唯一一套 provider-aware dashboard shell、共享 render function、共享 client 行为、provider tab 与 Compare 展示。 |
| `i18n.ts` | 八个 UI locale 的全部用户可见文案。 |
| `types.ts` | 共享 extension 和 Claude contract。 |

`quotaFormat.ts`、`dateKeys.ts`、`shareCard.ts`、`heatmap.ts`、`conversationLog.ts`、
`miniMarkdown.ts` 等既有纯模块保持当前职责与测试。

## Provider 数据流

```text
Claude JSONL
  ──> manifest metadata
  ──> 内存 per-file 增量索引
  ──> 精确全局 response identity + 受影响 aggregate group
  ──> 已物化 Claude 状态栏/dashboard input
  ──> Claude adapter

允许的 Codex JSONL
  ──> manifest metadata
  ──> background worker
  ──> schema guard + 精确单次请求 parser（lineage high-water 回退）
  ──> per-file 数字聚合索引 + 定向的当日小时 sidecar
  ──> CodexProviderSnapshot
  ──> Codex scope + insight
  ──> Codex 状态栏 + provider-aware dashboard render input

Claude aggregate + Codex scope ──> 同一套 `webview.ts` dashboard render stack
Claude aggregate + Codex scope ──> 并列 Compare（不跨 provider 求和）
```

任一 provider unavailable 或 partial 时，不清空另一 provider 最近验证的 snapshot。
Claude-only 保持 v2.2.1 行为；Codex-only 默认显示 Codex；两者都有时 dashboard 默认 Claude。
Codex 数据源可用性与已索引数据可用性分开判断：只要检测到允许的本地 home，Codex 标签
就立即出现，首次建立索引期间由页面实时显示精确文件数、百分比与已处理容量；只有两个
provider 都已有真实数据时才显示「对比」。worker 启动前先装载最近一次原子检查点；全新
索引生成第一个检查点后也会在 worker 继续运行时立即采用。因此，进度只是完整「已索引小计」
仪表盘上的状态说明，不会替代卡片和表格。worker 进度最多每 250 ms 触发一次重绘，且只有
选中 Codex 时才重绘 Webview；refresh 返回后仍会用已验证 snapshot 做最后一次渲染。

Codex 的「今天」指配置时区中的当前自然日，而不是最近任务。汇总来自该日已验证的 period slice；
精确小时行来自下文所述的独立当日 sidecar。小时、每日与每月主图默认使用 API 等效成本，Token 构成图
仍独立展示。未知模型计入 Token 分母但保持未定价，因此定价 coverage 始终可见。Claude 与 Codex 的
时间序列布局使用对齐的响应式宽度，较密集的图表和表格在各自可键盘聚焦的区域内滚动。

## Token 与 limit 语义

Claude record 带 Anthropic 的四个 token bucket。扩展对其校验、去重、求和并按模型计价。
Claude 成本仍是根据费率表的估算，不是发票。

Codex 使用以下规则：

- processed = `input total + output total`
- fresh input + output = `max(0, input total - cached input) + output total`
- cached input 是 input 子集，reasoning output 是 output 子集
- 两个子集都不再次加入 processed total
- fresh input + output 是优化行为的辅助指标，不与成本/配额等价

每条有效的 Codex `token_count` 通常都带 `last_token_usage`；其中 input、cached input、
output 与 reasoning component 是精确的单次请求归因。`last_token_usage.total_tokens` 表示
活跃上下文大小，不作为该请求用量。只有 total 与 last 两份 snapshot 的完整数字签名与
同一伪名 rate-limit 来源或紧邻的上一条记录一致时，才判定为重放。这个窄证明不会把另一条
交错来源在合法 reset 后的记录静默合并掉。

若缺少 `last_token_usage`，则把 cumulative `total_token_usage` 作为回退；它可能包含继承的
parent baseline，因此该路径按 component 与 lineage 维护 high-water。Unknown parent、counter
regression 和 schema drift 产生 quality flag，不生成负用量或伪造精度。

本地日志中的 Codex `rate_limits.primary` 只是 last-observed snapshot，到 reset 时间后隐藏。
v2.3.0 不读 Codex credential，也不发网络请求刷新它。

## 隐私与持久化

Codex 发现仅限：

- `$CODEX_HOME/sessions/**/*.jsonl`
- `$CODEX_HOME/archived_sessions/**/*.jsonl`
- 默认 `$CODEX_HOME`：`~/.codex`

绝不读取 `auth.json`、SQLite、config secret、keychain、浏览器状态或未知文件。
Raw path/session/parent ID 只留在本地 worker 的短期内存。磁盘只持久化 machine-salted 伪名 key
和按 day/model/effort/session 聚合的数字，绝不存 prompt、response、command、tool arguments、
raw line 或 raw path。

Machine salt 存在 VS Code `globalState`，不写入索引。Worker progress/result/error 与 diagnostics
只含匿名计数与时间，不含 path 或 ID。

### Schema 3 索引契约

内部 schema 3 继续使用既有的 `globalStorage` 文件名 `codex-index-v1.json`；文件名是兼容路径，
不是 JSON schema 版本声明。持久化 DTO 使用明确的 allowlist：只能写入数字 aggregate、enum、
伪名 key、清洗后的 label，以及仅由数字 token 计数向量生成的不透明指纹。v3 不保存未完成原始行，
也不保存 carry buffer。旧字段只在明确命名的 schema-1 legacy migration 边界被读取；该迁移会先
丢弃 carry，之后才保存 v3 索引。schema 1 与 schema 2 索引都会被标记为需要执行有界 lineage 重扫；
旧总量不会保留后再叠加到重建结果。若 schema 3 容器里的 per-file parser state 仍早于精确单次请求
语义，也会执行一次 reset，绝不混合不兼容 aggregate。Parser state 只允许持久化有界的 total-plus-last
数字签名、对应的 machine-salted 伪名 key，以及紧邻的上一条数字签名。

每个物理 rollout 锁定首个可靠的 session 与 tree 身份。随后用有序的数字事件指纹，在已验证父节点
中定位 child 复制的前缀，同时保留每个独立 sibling 的后缀。多层 fork 与不同 fork epoch 各自只扣除
一次复制前缀。若声明的 parent 缺失，child 会保守地按全量计入，并在 UI 显示 `missing-parent` 质量警告，
不会静默扣除。计数器回退仍按精确 last usage 计入并标为 partial；cumulative 回退路径使用按 component
的 high-water containment，不产生负 delta，也不会重复计入 reset gap。同一伪名 session 的
active/archive 副本若存在已验证的有序重叠，该段也只计一次；若身份元数据
互相冲突，identity coverage 仍保持 incomplete。

这里有两个相互独立的可信度层。all-time 视图来自 canonical file contribution 的已验证的
aggregate；按日的期间切片则独立晋升，因此 partial migration 不能覆盖、放大或替代 all-time 的
已验证 aggregate。期间 coverage 以目标时区的 `asOfDay` 为锚点，分别报告 7 天、30 天和
all-time 的状态。7 天与 30 天只累加自然日内发生的 event；不会因为 Session 的最后活动落在范围内，
就把该 Session 的整段较早历史吸收进来。

当日小时索引是 schema 3 的增量 sidecar，不是第三份 all-time 事实来源。只有经重复分类选为 canonical，
且已验证 period slice 已包含 `asOfDay` 的文件才会进入候选集。每个文件的小时晋升状态与处理中 cursor
都会写入 checkpoint，因此取消后可从已验证 offset 续传。日期或时区变化时会丢弃过期 sidecar，改为
目标新自然日；该路径既不使主 aggregate 失效，也不会触发全历史重建。

Identity 同样是一份 coverage 契约。Git 的 SCP 形式 SSH URL 与 HTTPS URL 在 host/path 一致时
会规范化为同一个 repository identity。Root title 采用可信的最新 `updated_at` title；subagent
保留其报告的 nickname 及 parent title；project 优先显示 canonical repository name，才回退到目录名；
最近任务排序使用完整 lineage 上观察到的最大活动时间。只有 active/archive 的严格精确副本——两侧
都已验证且安全 signature 完全一致——才去重；任何其他重复 Session 都标为歧义，并使 identity
coverage 保持 incomplete，而不是猜测。
这种稳定歧义属于数据质量状态，不是未完成 I/O：base 与必要 period coverage 完成后，
dashboard 不再因此一直标为「仍在索引」。

五个结构调用代理量是 `patchCalls`、`toolCalls`、`postPatchToolCalls`、`compactCount` 与
`taskCompleteCount`。它们只描述观察到的结构 envelope，不是文件、命令或审阅次数；不会产生美元成本，
也绝不由 prompt、response、command body 或 tool argument 内容推导。

## 刷新与规模

Claude polling 始终遵守 `refreshInterval`，file watcher 使用配置的 quiet debounce。
生产 Claude 路径维护内存 per-file 索引：unchanged refresh 的 JSONL body read 为 0，
append 只读已验证 tail，truncate/replace/move/delete 只重建受影响文件和 aggregate group。
内容分析 contribution 与既有跨文件 response-identity 规则通过同一原子路径更新。新的
Extension Host 会执行一次冷内存建索引；watcher 驱动的刷新不会重读、重聚合整个语料。
Codex 使用独立 quiet debounce（默认 30 秒，可选 Off/10/30/60/120/300）。

Codex 按多 GiB 本地历史设计：

- 发现与解析在 Extension Host 之外的 worker 中执行；
- recent-first 索引，支持 progress 与 cancel；未完成回填最多使用可用逻辑 CPU 的一半，
  并把本地 file-pass worker 上限设为 6；索引完成后回到单一低功耗协调路径；
- unchanged warm refresh 不读 JSONL body；
- 首次非空索引或尚未完成的旧索引迁移会获得一次受限的 16,384 次文件遍历 / 64 GiB
  流式上限；这不是预先分配的内存，并保留取消与原子续传 checkpoint。收敛后，自动任务使用
  64 次文件遍历 / 128 MiB，始终可见的手动「刷新」使用 512 次文件遍历 / 2 GiB。
  安全下限为 1 MiB + 1 byte，读取 chunk 为 1 MiB，单条 Codex JSONL line 上限为 1 MiB；
- 实时 progress 保持高频，但大型持久 snapshot 最多约每 10 秒、2 GiB 或 256 个完成的
  file pass 写入一次，并在最终阶段边界保存。这样既限制崩溃后的重做量，也避免反复写入
  数十 MB snapshot 主导高速回填耗时；
- 只有可能改变 lineage 的阶段才重新 reconcile；period 和稳定阶段复用已验证关系，
  不再反复扫描完整索引；
- 当日小时任务仅处理 period slice 已证明包含 `asOfDay` 的 canonical 文件；它独立 checkpoint/续传，
  不会重置主索引；
- append refresh 只读新 tail；未完成行只留在 scanner 的短期内存，从 safe cursor 重试，绝不写入 v3；
- truncate/replacement 只重解析受影响文件；
- cancel checkpoint 会原子保存 per-file contribution 与 migration progress，下一轮从已验证 cursor resume；
- 并发 refresh 共享同一 worker run。

每周 API 等效价值历史只从已经聚合的 Token 用量生成。有真实每周重置观测时，七天窗口按该重置
对齐；没有时，仅已用历史按 UTC 周一至周一的自然周分组。Token 日志能够证明已用价值，但不能证明
历史订阅总额度，因此总额度与未用额度仅在存在真实额度用量比例观测时生成。Codex 的仅已用历史可能
合并同一 home 中的多个登录，而额度推算行仍绑定其实际观测的重置序列。

v2.3.0 不推断 20、100 或 200 美元的订阅档位。本地 Codex 日志没有可靠的账号与套餐身份，
后续比较必须采用用户明确选择的 opt-in 账号映射，不能猜测后绑定价格。

## 发布不变量

- 根据变更风险执行 strict TypeScript、red-green TDD、完整 `node:test`、F5 smoke test
  和安装 VSIX smoke test。
- 用户可见字符串覆盖 `en`、`de-DE`、`zh-TW`、`zh-CN`、`ja`、`ko`、`pt-BR`、`id`；
  七份 README 同步。
- 不手工修改 `package.json` 版本。发布已审阅的 Release Drafter draft 后才创建 tag，
  publish workflow 再从 tag 写入包版本。
- 通过合并贡献者原 PR，或经授权先修改该 PR 分支再合并，保留贡献归属。
