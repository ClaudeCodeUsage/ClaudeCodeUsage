# 架构说明

> 本文简要说明扩展的 provider 边界、数据流与用量语义。模块职责或
> provider 行为变化时必须同步更新。英文版见
> [`ARCHITECTURE.md`](ARCHITECTURE.md)。
> 持久数据清单、保留、迁移、清除和网络边界的规范来源是双语
> [`v2.3.1 本地数据契约`](docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.zh-CN.md)。

## 产品边界

**Claude Code Usage** 继续保持 local-first、无 runtime dependency 和 read-mostly。
v2.3.0 保留完整 Claude 体验，并增加 provider-specific 的 Codex Beta 用量与优化视图。
v2.3.1 候选在不改变 provider 计量口径的前提下，增加一套默认关闭、
local-first 的建议有效性闭环、唯一的显式 BYOK 请求边界、可持久的历史任务状态、
Codex 有界的本地每周重置观测历史，以及滚动 30 天的日期→小时投影。
v2.4 第一阶段把既有分享界面收敛为一个预览优先的工作台。呈现方式选择器可切换
综合活动热力图、旧版 Claude 分享卡与仅 Claude 的 token 热力图；全宽导出预览始终位于控制项之前。

- Claude：精确的本地 token bucket、模型成本估算和 Anthropic OAuth 5 小时/每周配额。
- Codex：本地 processed/fresh/cache/output/reasoning 指标、模型与 effort 拆分、
  thread 结构、索引 coverage、quality flag 与结构化优化建议。已知模型还会显示明确限定的
  API 等效成本估算；它绝不是账单或订阅扣费，未知模型保持未定价。
- Compare：只并列可比指标，绝不把不同 provider 的成本、配额或 token 求和为误导性总量。

完整账单/发票对账、驱动任一 coding agent、后台 telemetry 与跨设备聚合同步不在范围内。
既有 Claude 热力图发布仍是用户明确触发、仅公开仓库且需精确确认目标的 GitHub 动作；
打开、切换、预览以及本地 SVG/Markdown 导出严格不联网，也不请求 GitHub 身份；
只有独立的发布动作可以执行该网络操作。

## 模块地图（`src/`）

| 模块 | 职责 |
|---|---|
| `extension.ts` | 激活、命令、设置、provider 生命周期、刷新编排、watcher、状态栏/webview 接线和匿名诊断。 |
| `dataLoader.ts` | 为精确兼容保留的 Claude 解析、校验、归因和内容分析 primitive。 |
| `claudeIncrementalIndex.ts` | 生产环境 Claude 内存 per-file 索引：append-tail 解析、精确跨文件 response 去重、受影响 group 聚合、内容分析 contribution 和已物化 dashboard row。 |
| `adviceEffectiveness/contract.ts`、`adapters.ts`、`payload.ts` | 严格的观察/证据/建议/行动/结果契约，隐私重建型 provider adapter，以及 canonical 聚合/个性化 payload。 |
| `adviceEffectiveness/preparedRequest.ts` / `remoteAdvice.ts` | host 持有的唯一完整 HTTP Prepared 对象、精确 preview/send bytes、BYOK-only 授权、取消与严格结构化解析。 |
| `adviceEffectiveness/comparisonPairing.ts`、`comparisonResult.ts`、`versionedPersistence.ts` | 净化的可比任务配对、冻结的 measurement-version envelope 与有界的本地反馈/比较存储。 |
| `optimizerRequest.ts` | 仅用户粘贴草稿通过同一 Prepared 与严格发送边界；不回退到 advice 证据 parser。 |
| `backgroundWorkState.ts` / `resourceOwnership.ts` | 可持久的 progress/backoff/pause 状态，以及供测试核对 timer、watcher、worker、network 和 backfill 创建者/停止/真实销毁的 registry。 |
| `providers/providerTypes.ts` | Provider-neutral token、event、confidence、outcome、coverage 和 limit contract。 |
| `providers/claudeProvider.ts` | 薄兼容 adapter，不改变既有 Claude 聚合结果。 |
| `providers/codex/codexSchema.ts` | 最小安全 JSON guard，不展开或返回 message/command/tool body。 |
| `providers/codex/codexParser.ts` | Codex 精确单次请求解析及 cumulative high-water 回退、伪名 lineage metadata、结构计数、quality flag 和 last-observed limit。 |
| `providers/codex/codexManifest.ts` | Codex 允许目录发现、HMAC file key、fingerprint 和 manifest diff。 |
| `providers/codex/codexIndex.ts` | schema-3 的 per-file 数字聚合与重放证据持久化、有界 cold/tail parse、独立 aggregate/period/滚动 30 天小时 coverage 和原子存取。 |
| `providers/codex/codexQuotaHistory.ts` | 小型、账户中性的每周重置观测缓存；压缩重复本地样本，不保留凭据、账户名或原始标签。 |
| `providers/codex/codexIndexWorker.ts` / `codexIndexClient.ts` | 后台协调器、recent-first progress、cancel、resume、checkpoint 持久化和 single-flight client。 |
| `providers/codex/codexFilePassPool.ts` / `codexFilePassWorker.ts` | 未完成回填期间，用于独立 main、lineage、period、current-day 和 identity per-file pass 的自适应受限本地 pool。 |
| `providers/codex/codexProvider.ts` | 面向 extension 的 Codex snapshot facade 与 partial/unavailable/error outcome。 |
| `providers/codex/codexUsage.ts` | Codex 自然日 Today/小时、7 天、30 天、月度、task 与项目 view model 聚合，以及精确模型 API 等效成本。 |
| `providers/codex/codexInsights.ts` | 确定性的结构用量建议，不读 prompt/body。 |
| `codexView.ts` / `codexViewComponents.ts` | Codex 本地化文案与默认 provider contract；不负责 HTML renderer、client script 或 CSS。 |
| `settings.ts` | 权威 `SETTINGS` catalog 和 `SettingsStore`；普通值进入 configuration/globalState，BYOK 凭证只进入 SecretStorage，且绝不进入 Webview snapshot。不得散落直接读取。 |
| `statusBar.ts` / `codexStatus.ts` | Provider-specific 状态展示和通用 Claude 配额格式化。 |
| `webview.ts` | Claude/Codex 唯一一套 provider-aware dashboard shell、共享 render function、共享 client 行为、provider tab、Compare 展示与统一分享工作台。 |
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
  ──> per-file 数字聚合索引 + 有界账户中性的每周重置历史
  ──> 滚动稀疏 30 天小时 sidecar
  ──> CodexProviderSnapshot
  ──> Codex scope + insight
  ──> Codex 状态栏 + provider-aware dashboard render input

Claude aggregate + Codex scope ──> 同一套 `webview.ts` dashboard render stack
Claude aggregate + Codex scope ──> 并列 Compare（不跨 provider 求和）

已物化 Claude + Codex 每日聚合
  ──> 统一分享选择器 ──> 综合活动预览 ──> 显式本地 SVG/Markdown 导出
已物化 Claude 聚合
  ──> 统一分享选择器 ──> 旧版分享卡或 Claude token 热力图预览
  ──> 显式本地导出，或仅公开仓库且精确确认目标的 Claude 热力图 GitHub 发布

已物化 provider snapshot
  ──> 隐私重建型 advice adapter
  ──> 本地证据 + 确定性建议
  ──> 可选 host-owned Prepared 请求 ──> 预览 ──> 显式 BYOK 发送
  ──> 本地反馈 ──> 净化可比 pair ──> 冻结 comparison envelope
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
精确小时行与 30 天日期下钻来自下文的独立滚动 sidecar。点击已渲染日期只展开这份投影，
不要求 host 读取 JSONL。小时、每日与每月主图默认使用 API 等效成本，Token 构成图
仍独立展示。未知模型计入 Token 分母但保持未定价，因此定价 coverage 始终可见。Claude 与 Codex 的
时间序列布局使用对齐的响应式宽度，较密集的图表和表格在各自可键盘聚焦的区域内滚动。

Provider panel 的实时 patch 会保留页面 anchor，以及标签栏、图表、表格、项目矩阵、
热力图、分享区和预览区等有界 scroller 的非零水平位置。匹配只使用本次 patch 期间
驻留内存的 privacy-safe 结构 key；不会逐帧写入 Webview state，也不会发送给
Extension Host。Compare 显示的更新时间绑定到稳定的已渲染数据 snapshot，因此
数据未变化的 refresh 保持 byte-identical，不会替换整份文档。
用户连续滚动时，Webview 会将 provider panel 的更新合并到 120 ms 的静默间隔，
并以 500 ms 为最长等待边界；只应用并确认最新修订。队列只驻留内存，既不重读
源日志，也不逐帧持久化滚动位置。

分享工作台只渲染一次：两个 provider 都有数据时位于「对比」，否则作为 Claude「所有」的
回退入口。`enableShareCard` 是唯一可见的分享开关。公共命令 ID `exportShareCard`、
`exportHeatmap` 与 `publishHeatmapToGitHub` 至少保留一个版本并打开对应呈现方式，不绕过预览。
退役的 `showHeatmap` 仍保留在 catalog 中并可被清除，但隐藏且不再创建重复面板。所选呈现方式
只是本地 UI 偏好，不改变 provider 统计口径。显式兼容命令会生成 provider 生命周期内单调递增的
revision，并把它作为独立的 live intent；Webview 应用后 ACK 精确 revision，host 随即删除 live intent，
但不回退 revision 历史。因此，已确认的命令不会在普通重绘、分享重置或同一 provider 的
dispose/reopen 后重放。「重置分享偏好」复用既有的确认式本地数据动作：host 发送带 request-id 的
client action，Webview 验证八个 allowlist localStorage key 均已删除；只有匹配 ACK 为 true 才算成功，
否则 host 报错并保留恢复 tombstone。

在窄 Webview 中，1200×680 Claude 分享卡在可键盘聚焦的局部横向滚动区内保留原始宽度，
不缩小到无法阅读。Renderer 测试逐一审计所有普通字号 SVG 标签，保证至少 4.5:1；浏览器 geometry
测试保证标签不越出各自 viewBox，且完整产物仍包含在外围 Axe 扫描中。

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

本地日志中的 Codex `rate_limits` 只是 last-observed snapshot，到 reset 时间后隐藏。
v2.3.1 候选还会保留一份有界、账户中性的 account-wide 每周观测历史：同一重置边界的
重复样本只保留一个代表，真正不同的重置时刻则分别保留。这份历史用于对齐和复核每周
估算，不是账户注册表；如果某次重置从未出现在本地日志行里，插件也无法凭空发现它。
v2.3.0 不读 Codex credential，也不发网络请求刷新它。

## 隐私与持久化

Codex 发现仅限：

- `$CODEX_HOME/sessions/**/*.jsonl`
- `$CODEX_HOME/archived_sessions/**/*.jsonl`
- 默认 `$CODEX_HOME`：`~/.codex`

绝不读取 `auth.json`、SQLite、config secret、keychain、浏览器状态或未知文件。
Raw path/session/parent ID 只留在本地 worker 的短期内存。磁盘只持久化 machine-salted 伪名 key、
按 day/model/effort/session 聚合的数字，以及上面所述的有界账户中性额度历史；绝不存 prompt、
response、command、tool arguments、raw line、raw path、账户名、凭据或原始 provider label。

Advice 只消费已物化聚合，不重读 JSONL，也不重遍历保留的 records。远程默认为
aggregate-only；prompt sample 与可选 user context 需单独明确同意，并必须原样出现在精确请求预览中。
host 保管 Prepared 对象和 API key；webview 只拿到预览与不透明 handle。第二次点击才把同一 bytes 对象
发给用户配置的 BYOK endpoint。Feedback、comparable pair 与 comparison envelope 全部保持本地，
不接受 prompt、response、path、session、title、endpoint 或 credential 字段。

Advice 同意变更会立即作废 Prepared handle。host 的 pending-write 计数器在全部排队同意
写入结束前阻止新预览与发送；持久化失败保持关闭。聚合或提示授权撤回还会通过既有 network
owner 取消在途建议请求，与仅含用户草稿的 Optimizer 请求隔离。取消不能追回已传出的字节。

Machine salt 存在 VS Code `globalState`，不写入索引。Worker progress/result/error 与 diagnostics
只含匿名计数与时间，不含 path 或 ID。`refresh:` diagnostics 包含受限的 trigger、Claude
watcher/coalescing 计数，以及操作系统未提供 filename 的 quota watcher 事件数。`codex-index`
diagnostics 还会记录实际 refresh trigger、watcher/debounce 计数、历史 backfill 模式与
foreground/background worker profile；通用失败路径无法确认模式时明确记为 `unknown`，不作猜测。

分享预览只消费已经物化的聚合。综合活动仅在明确的活动可视化中把 Claude processed 与
Codex processed 相加；Codex cached input 与 reasoning 子集不会重复计入，也不声称成本、额度、
能力或生产率等价。Claude 分享卡与 Claude 热力图仍只属于 Claude。本地预览/导出不联网；
也不存在 GitHub authentication、profile、头像或名称查询。Claude 热力图发布是独立的显式动作，
继续遵守本地数据契约中的公开仓库探测，以及精确 branch/path 与创建／覆盖确认边界。

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

滚动 30 天小时索引是 schema 3 的增量 sidecar，不是第三份 all-time 事实来源。只有经重复分类选为
canonical，且已验证 period slice 与配置自然日窗口相交的文件才会进入候选集。每个文件的小时晋升状态与
处理中 cursor 都会写入 checkpoint，因此取消后可从已验证 offset 续传。窗口前移时淘汰第 31 天；
时区改变只请求一次定向迁移。该路径既不使主 aggregate 失效，也不会触发无关的全历史重建。

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
内容分析 contribution 与既有跨文件 response-identity 规则通过同一原子路径更新。内容分析维护
process-local 的已物化 accumulator，其 cutoff 与 `ClaudeDataLoader` 一样按毫秒连续滚动，而不是
用本地午夜近似。每个文件记录“已纳入 contribution 的最早时间戳”，校准也记录最早 record，二者
作为 frontier：cutoff 在 frontier 之间移动不会改变结果，也无需读取正文；可证明整文件保留或
整文件过期时同样只用元数据 rebase。cutoff 跨过 frontier 时，只重读受影响的边界文件，以及
first-owner 可能变化的 UUID claimant。

已完整落盘但格式错误的 JSONL 行是稳定的忽略项，不会使 cutoff 元数据失效，也不会造成反复正文
读取。尚未完整的 JSON fragment 留在安全 cursor 之后等待续写；若 EOF 处已经是语法有效的 JSON，
即使没有末尾换行也会被接纳，后续 append 则必须先证明原 record 边界仍成立。内容分析关闭期间可以
在内存中按新时区重分普通用量；再次开启时，所有依赖日期的分析 contribution 必须先重建再发布，
因此跨 DST 切换也不会沿用旧时区的 day key。

普通的单文件 append 会先只读已验证 tail、应用变化文件 delta，并只重校准受影响的 canonical
response identity。仅含数字的结构摘要按全局文件顺序保留 legacy accumulator 的
`tool_use` → `tool_result` 映射和 Skill preamble 归因；warm append 只重放被触及的 tool ID。
UUID membership 最多查询 64 个 immutable layer，并通过 direct first-owner map 判断本次 UUID
是否可继续走增量路径，无需搜索排序更后的每个文件；偶发的 O(U) 压实替代每次 append 都重建完整
UUID set。若 tail 抢占了更后文件的 UUID owner，则丢弃 provisional 结果，并按 full loader 的
完整文件顺序重建分析。

该 canonical 顺序直接保留 bounded timestamp probe 的结果：若文件开头超过 1 MiB 的完整行均无
时间戳，即使 full parse 随后遇到时间戳，该文件仍使用 loader 的 neutral timestamp 与 discovery
rank。时间戳相同的文件若 `discoveryIndex` 相对顺序改变，也属于语义 reorder。新建/替换文件、
多文件 append、move、delete、cutoff 向后移动，以及普通无时间戳文件 append 后首次出现 probe
可见时间戳，都走同一 correctness-first 有序重建。每文件 Skill candidate 保留匹配 result 的数字
证据；全局 5,000 次上限及早期文件造成的 boundary displacement 只在有序物化时应用。

慢物化路径的内存复杂度为 O(F + A + R)（文件、保留的分析状态和校准 record）。仅 cutoff 变化时
只读取边界/claimant 文件；source order 变化时可能重读完整语料，以重新建立 first-owner、prompt
顺序和 skill cap 语义。公开结果仍按既有 contract 物化 records array，但内容校准不再额外生成
第二份全量 record 副本。新的 Extension Host 仍会执行一次冷内存建索引。Codex 使用独立 quiet
debounce（默认 30 秒，可选 Off/10/30/60/120/300）。
Claude log、Codex log 与 Claude credentials directory watcher 都只作为 `fs.watch` 加速路径：
异步 watcher error 会关闭受影响 handle，并在 polling 继续可用时按有上限的指数退避重新挂载。
如果失败的 credentials watcher 重试时 profile directory 暂时不存在，同一有界链只会在窗口聚焦且
额度跟踪仍启用时继续；目录重建后只恢复一个 watcher。只有 credentials watcher 接受操作系统省略
filename 的事件，因为这可能表示 credential file 被原子替换；该类事件仅以匿名计数进入诊断。

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
- 滚动 30 天小时任务仅处理 period slice 已证明与配置自然日窗口相交的 canonical 文件；
  它独立 checkpoint/续传，滚动淘汰第 31 天，不会重置主索引；
- append refresh 只读新 tail；未完成行只留在 scanner 的短期内存，从 safe cursor 重试，绝不写入 v3；
- truncate/replacement 只重解析受影响文件；
- cancel checkpoint 会原子保存 per-file contribution 与 migration progress，下一轮从已验证 cursor resume；
- Extension Host 的 single-flight 覆盖完整 Codex provider lifecycle，而不只是 worker call。
  一组密集 trigger 只执行当前请求，并至多补跑一次其中优先级最高的 pending trigger；所有调用者
  等待同一个 drain。异常会释放 gate，extension dispose 或本地数据清理则只排空 pending state，
  不再启动新的 provider 工作。索引 teardown 会在第一次 await 前同步升起暂停栅栏，因此排队中的
  刷新不会在清除或重建进行期间重新创建索引。成功路径会保持栅栏直到 replacement provider 安装
  完成；生命周期步骤若失败，则携带原始错误解除栅栏，避免永久阻断后续刷新。

额度历史由同一批 JSONL 解析流程顺便填充。旧的完整索引最多接受一次基于已保存
last-observed limit 的 metadata-only 播种；不会增加第二套额度扫描器、timer、网络轮询或凭据读取。
播种完成后，未变化的 warm refresh 仍然读取 0 字节用量正文。

历史任务还使用一份精简的可持久控制状态：measurement version、reason、progress、
failure streak、next eligible time 和 pause reason。成功后立即继续，不人为等待；失败或无进展后
进入 backoff，普通 refresh/watch/focus 事件不能重启同一停滞迁移。Resource registry 记录每个 timer、
watcher、worker、network request 与 backfill 的创建者，只在真实 stop callback 完成后释放 lease。
为降低首次可用延迟，有界的首次索引可在失焦后继续；但 extension dispose、provider 关闭或显式取消
仍对其终止负责。

每周 API 等效价值历史只从已经聚合的 Token 用量生成。最新有效的重置观测用于锚定互不重叠的七天
展示窗口；没有观测时，仅已用历史按 UTC 周一至周一的自然周分组。真实的额度用量比例观测可以支持
历史窗口的总额度近似，而不只支持当前窗口。Codex 的 account-wide `codex` series 会纳入同一 home
中所有符合条件的本地文件，因为文件键不是账号身份。重置时间如果偏离七天网格，则按观测时间映射到
对应展示窗口；来源不确定、重置漂移或日切片跨边界时降低可信度并标注为近似。真正不同的 quota
series 仍仅显示已用值；当前周期不显示未用值，历史周期只有在同时存在总额度近似时才显示未用值。
每条用量仍只进入一个窗口。

v2.3.0 不推断 20、100 或 200 美元的订阅档位。本地 Codex 日志没有可靠的账号与套餐身份，
后续比较必须采用用户明确选择的 opt-in 账号映射，不能猜测后绑定价格。

## 发布不变量

- 根据变更风险执行 strict TypeScript、red-green TDD、完整 `node:test`、F5 smoke test
  和安装 VSIX smoke test。
- 用户可见字符串覆盖 `en`、`de-DE`、`zh-TW`、`zh-CN`、`ja`、`ko`、`pt-BR`、`id`；
  九份 README（首页加八份语言版）同步。
- dormant 的 preparation/experiment 模块与仅供评审的 v2.3.1 文档必须保持不可从生产 command graph 到达，并排除出 VSIX。
- 不手工修改 `package.json` 版本。发布已审阅的 Release Drafter draft 后才创建 tag，
  publish workflow 再从 tag 写入包版本。
- 通过合并贡献者原 PR，或经授权先修改该 PR 分支再合并，保留贡献归属。
