# 架构说明

> 本文简要说明扩展的 provider 边界、数据流与用量语义。模块职责或
> provider 行为变化时必须同步更新。英文版见
> [`ARCHITECTURE.md`](ARCHITECTURE.md)。
> 双语 [`v2.3.1 本地数据契约`](docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.zh-CN.md)
> 是字段级历史基线；[`LOCAL-DATA.zh-CN.md`](LOCAL-DATA.zh-CN.md) 是当前 2.5.0
> 数据清单与后续字段、保留、迁移、清除、导出的版本化补充。其明确的后续章节只覆盖
> 对应事项；未变化的基线隐私规则继续适用。

## 产品边界

**Claude Code Usage** 继续保持 local-first、无 runtime dependency 和 read-mostly。
v2.3.0 保留完整 Claude 体验，并增加 provider-specific 的 Codex Beta 用量与优化视图。
v2.3.1 候选在不改变 provider 计量口径的前提下，增加一套默认关闭、
local-first 的建议有效性闭环、唯一的显式 BYOK 请求边界、可持久的历史任务状态、
Codex 有界的本地每周重置观测历史，以及滚动 30 天的日期→小时投影。
v2.4 第一阶段把既有分享界面收敛为一个预览优先的工作台。呈现方式选择器可切换
综合活动热力图、旧版 Claude 分享卡与仅 Claude 的 token 热力图；全宽导出预览始终位于控制项之前。
2.5.0 版本整合 Codex 压缩日志兼容与默认开启的本地分级成就（`enableAchievements`）、
一次性升级关闭选项及证据／性能保护。GitHub 联动成就、个人回顾与可视化重设计
不在 2.5.0 范围。
本版还提供供应商／指标热力图分享、最多六项手动展示柜及默认关闭的周额度节奏。
本文描述实现契约，不是发布或验收记录。原生／F5、已安装包及性能检查需要各自的
证据，浏览器检查不能证明这些结果。
源码守卫只核对源代码契约，不证明界面状态转换已实际执行、原生 Webview 行为或已安装包验收。
Codex effort 统计及仅累计范围的金额新活动收据已完成接入。

- Claude：精确的本地 token bucket、模型成本估算和 Anthropic OAuth 5 小时/每周配额。
- Codex：本地 processed/fresh/cache/output/reasoning 指标、模型与 effort 拆分、
  thread 结构、索引 coverage、quality flag 与结构化优化建议。已知模型还会显示明确限定的
  API 等效成本估算；它绝不是账单或订阅扣费，未知模型保持未定价。
- 分享与对比（内部 provider 键仍为 `compare`）：分享与可比指标并列展示的导航／页标题，
  绝不把不同 provider 的成本、配额或 token 求和为误导性总量。

完整账单/发票对账、驱动任一 coding agent、后台 telemetry 与跨设备聚合同步不在范围内。
既有 Claude 热力图发布仍是用户明确触发、仅公开仓库且需精确确认目标的 GitHub 动作；
打开、切换、预览以及本地 SVG/Markdown 导出严格不联网，也不请求 GitHub 身份；
只有独立的发布动作可以执行该网络操作。

## 模块地图（`src/`）

| 模块 | 职责 |
|---|---|
| `extension.ts` | 激活、命令、设置、provider 生命周期、刷新编排、watcher、状态栏/webview 接线和匿名诊断。 |
| `claudeApiClient.ts` | 既有 Claude OAuth／额度请求及最近成功请求所用凭证的运行期单向身份信号；周节奏只读取该信号，不新增请求或凭证查询。 |
| `dataLoader.ts` | 为精确兼容保留的 Claude 解析、校验、归因和内容分析 primitive。 |
| `claudeIncrementalIndex.ts` | 生产环境 Claude 内存 per-file 索引：append-tail 解析、精确跨文件 response 去重、受影响 group 聚合、内容分析 contribution 和已物化 dashboard row。 |
| `achievements.ts`、`achievementSnapshot.ts`、`achievementCalendar.ts`、`achievementHours.ts` | 带版本的规则与数值 Token／日／周／小时证据；`codexAchievementCalendarProjection` 先解析全清单祖先关系，再选择有见证的日期，区分正向子集与全清单完整性。 |
| `achievementActivity.ts`、`achievementIcons.ts`、`achievementShare.ts` | 白名单内的主动本地行为枚举、随插件打包的徽章查找与明确触发的自包含 SVG 导出。 |
| `achievementGallery.ts`、`achievementOverview.ts`、`achievementRecordStore.ts` | 纯主题归属／记录投影、稳定目标、自动／手动展示选择及 ≤64 KiB 权威 v2 封套；最多六项有序手动固定，共用 v1 租约／迁移屏障。 |
| `achievementUiIcons.ts` | 纯函数渲染已知的内联 SVG 控件图标；无依赖、网络访问或额外资源文件。既有本地化标签仍由共享 Webview 渲染器提供。 |
| `achievementMoney.ts`、`achievementMoneyScopes.ts`、`achievementMoneyCatalog.ts` | 六个供应商独立主题的固定美元参考价证据；Codex 周金额子集要求绑定全清单的日期证明及完整归日的计费／模型向量。定价覆盖独立于日期覆盖及仪表盘浮动估算。 |
| `achievementMoneyOrigin.ts` | 仅运行期固定参考价增量校验、固定字段复制／经济上界及累计跨级必要／充分判断；独立于 Token 来源，不持久化为索引证明。 |
| `achievementModels.ts` | 协作／彩虹及 Claude 家族的非金额模型标签识别，独立于固定计价别名；识别不证明远端型号身份或价格。 |
| `achievementReferenceBooks.ts` | 三个明确已发布的 v1 参考价标签，用于读取已存金额记录，独立于当前价表选择与新增写入授权。 |
| `achievementTitles.ts` | 公开共用标题助手：等级单独显示时，仅移除由目录中点分隔的匹配本地化等级或其旧名后缀；ID 和固定项不变。 |
| `achievementDetailPresentation.ts`、`achievementHistoryDates.ts`、`achievementCalibration.ts` | 精确共同条件展示、仅运行期逐级日志日期归约及受 guard 保护的本地增量校准；不新增持久存储或来源解析器。 |
| `achievementEffortStatistics.ts`、`achievementCollaboration.ts` | 当前完整索引的 Codex 根任务 × effort 统计及既有联合等级条件；可选 `CodexAchievementSignals.effortStatistics` 按证明修订缓存，仅在已有 effort 广度详情显示。 |
| `apiHeatmapDaily.ts`、`pricing.ts#getCurrentEstimatePricing` | 最多 366 日只读投影，按次缓存选中型号／组件的内存单价准入；保留当前成本标量，排除通用未知型号回退覆盖，不联网、不读全量记录。 |
| `apiHeatmap.ts`、`apiHeatmapCopy.ts` | 白名单供应商／指标配置及规范本地 SVG／Markdown 产物；默认 Token、主动选择金额、供应商金额分块及八语产物文案。 |
| `quotaPace.ts`、`quotaPaceAdapters.ts`、`quotaPaceSource.ts` | 纯周期均速计算、最多 16 个窗口的数值适配及使用原始成功额度观测的运行期账号／窗口连续性所有者；无 I/O、定时器或持久历史。 |
| `providers/codex/codexHourProof.ts` | 与规范文件、已验证偏移、当前身份与谱系绑定的有界 UTC 输出小时证明；可选旧索引证明迁移不清零主用量。 |
| `providers/codex/codexAchievementOrigin.ts` | 仅运行期主尾部 Token／固定参考金额下界；已知原生逐事件计价、受影响聚合差额准入、稳定规范谱系及固定复制 worker DTO；无持久索引字段或额外正文读取。 |
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
| `providers/codex/codexZstd.ts` / `codexJsonlScanner.ts` | 有界 header 检查与原生单 frame Zstd 解码；共享 scanner 保留 decoded 字节坐标，将可取消的前缀重放计入工作量。 |
| `providers/codex/codexIndex.ts` | schema-3 的 per-file 数字聚合与重放证据持久化、有界 cold/tail parse、独立 aggregate/period/滚动 30 天小时 coverage 和原子存取。 |
| `providers/codex/codexLineage.ts` | 打包谱系 fingerprint contract 与仅运行期、迭代／记忆化的主统计深度排序；不增长递归调用栈，不新增持久字段。 |
| `providers/codex/codexQuotaHistory.ts` | 小型、账户中性的每周重置观测缓存；压缩重复本地样本，不保留凭据、账户名或原始标签。 |
| `providers/codex/codexIndexWorker.ts` / `codexIndexClient.ts` | 后台协调器、recent-first progress、cancel、resume、checkpoint 持久化和 single-flight client。 |
| `providers/codex/codexFilePassPool.ts` / `codexFilePassWorker.ts` | 未完成回填期间，用于独立 main、lineage、period、current-day 和 identity per-file pass 的自适应受限本地 pool。 |
| `providers/codex/codexProvider.ts` | 面向 extension 的 Codex snapshot facade 与 partial/unavailable/error outcome；从当前 contribution 独立的大小／偏移／前缀／时区构造仅运行期日期见证，不采信传入聚合自带的见证。 |
| `providers/codex/codexUsage.ts` | Codex 自然日 Today/小时、7 天、30 天、月度、task 与项目 view model 聚合，以及精确模型 API 等效成本。 |
| `providers/codex/codexInsights.ts` | 确定性的结构用量建议，不读 prompt/body。 |
| `codexView.ts` / `codexViewComponents.ts` | Codex 本地化文案与默认 provider contract；不负责 HTML renderer、client script 或 CSS。 |
| `settings.ts` | 权威 `SETTINGS` catalog 和 `SettingsStore`；普通值进入 configuration/globalState，BYOK 凭证只进入 SecretStorage，且绝不进入 Webview snapshot。不得散落直接读取。 |
| `statusBar.ts` / `codexStatus.ts` | Provider-specific 状态展示和通用 Claude 配额格式化；周节奏提示复用共享 I18n 文案，不改变简短文字及自定义格式。 |
| `webview.ts` | Claude/Codex 唯一一套 provider-aware dashboard shell、共享 render function／client 行为、provider tab、Compare 与分享；当前也拥有宿主成就观测／收据／提示状态，不是纯展示模块。 |
| `dashboardRefreshClient.ts` | 共享实时补丁的滚动锚点／焦点恢复，拒绝禁用控件并回退到稳定摘要；不执行供应商 I/O。 |
| `i18n.ts` | 八个 UI locale 的全部用户可见文案。 |
| `types.ts` | 共享 extension 和 Claude contract。 |

`quotaFormat.ts`、`dateKeys.ts`、`shareCard.ts`、`heatmap.ts`、`conversationLog.ts`、
`miniMarkdown.ts` 等既有纯模块保持当前职责与测试。

新增计算、分组与资格规则进入既有纯领域模块；`extension.ts` 协调宿主生命周期／I/O，
`webview.ts` 整合已接收结果、既有收据与展示。不为小功能另建数据生产者、renderer 或
全语料扫描器。这些边界指导新增代码，不代表混合的旧方法已经拆出，也不要求顺带
进行无关的大规模重构。

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

已验证供应商数值证据 + 白名单内主动本地行为
  ──> 带版本成就规则 ──> 有界本地授予／峰值账本
  ──> 图标优先图鉴 ──> 主动选择徽章预览 ──> 本地 SVG 导出
核验 Claude／Codex 新追加窗口 + 同固定参考价下的已定价增量
  ──> 累计跨级必要／充分判断 ──> 独立 Token／金额收据
  ──> 守卫下原子 recordUsage ──> 首次记录日／未读 + 一个既有提示批次
完整当前规范 Codex 索引 + 证明修订
  ──> 缓存可选六行 effortStatistics ──> 仅已有 effort 广度展开区

已物化 Claude + Codex 每日聚合
  ──> 最多 366 日只读投影 ──> Claude／Codex／两者 × Token／API 等价金额
  ──> 不可变已接受 SVG + Markdown + 绑定文档的不透明句柄
  ──> 核对后明确本地导出（不跨供应商相加金额）
既有成功原始额度 + 原始 observedAt + 已核验本机账号 HMAC
  ──> 运行期连续性所有者 ──> 有界每周数值 DTO ──> 周期平均节奏
  ──> 既有刷新回调 ──> 绑定文档／供应商的页面补丁 + 状态栏提示
既有 Codex 本地额度 ──> 账号可信度未知 ──> 预测不可用
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

`dashboardAutoRefresh` 只控制两家供应商的页面交付，不停止后台收集和状态栏。
启动时可以交付一次已验证快照；手动、设置和价格更新仍是显式交付入口。暂停期间
来源修订仍会撤销过期 AI 请求。刷新失败保留已验证页面，仅发送合并后的简短失败及
最后成功时间提示。主日志、周期迁移、小时回填显示各自实际计数和持久的等待重试状态，
不把主日志的 100% 冒充整体完成。

数据面板 HTML 按供应商／页签最多保存一份；Claude 每周用量输入另用单条缓存，
避免反复遍历未变化记录。
内容归因另保存一份数据区缓存，不缓存整个「内容」页面，AI 建议和优化器控件仍实时更新；
沿用数据面板的自然日、设置和来源撤销边界。
今日数值归因另按记录、内容分析、配置自然日／时区及价格身份保存单份缓存；
跨分钟轮询可更新倒计时 HTML 而不遍历全量历史。午夜、输入或价格变化仍重新计算，
撤销来源及释放时清除旧引用。整点刷新隐藏面板时，内容周归因仍重新计算一次。
数据、设置、价格、语言、币种、主题、自然日及额度到期边界
使缓存失效；今日按分钟过期，隐藏历史按小时过期。释放或替换数据来源会释放旧引用。
Claude 只保留一份按完整结构比较的、包含时间边界的呈现契约，未变化的轮询与聚焦
交付复用其聚合引用；相同的额度／历史观测也保留对象身份。比较前仍重新计算会话
到期、工作区范围及自然日范围，不用仅 Token 总量或固定小时键掩盖真实变化。
Claude 切换来源立即撤销旧记录、索引、额度、建议句柄、已确认分享预览和成功时间，
不受页面暂停影响。异步发现、扫描与索引返回均核对来源和配置代次，撤销迟到页面交付。
独立的来源／价格代次拒绝已失效的索引结果，包含 A → B → A 切换及手动价格更新竞态。
仅显示设置变化时，已完成且验证成功的同源读取可保存到宿主索引，让后续设置刷新避免
重复冷读，但不能交付旧页面或绕过清除全部／释放边界。扩展释放后不能交付迟到清空。
同一来源的临时失败仍保留已验证统计。
Codex 只在同一解析后的数据目录内保留失败前统计；切换目录会清空旧视图、建议、成功
时间及状态栏缓存，新供应商验证前不采用共享旧检查点。异步返回后核对供应商及配置
代次，已退休任务不能改写新任务。未变化的完整呈现契约保留视图和建议的对象身份；
已完成的稳定轮询不制造回填进度，也不因切换 loading 状态重复渲染隐藏面板。

分享工作台只渲染一次：两个 provider 都有数据时位于「对比」，否则作为 Claude「所有」的
回退入口。仅有 Codex 时，在成就开启的前提下「所有」页也提供工作台；热力图本身支持
单供应商或两者。`enableShareCard` 是唯一可见的分享开关。公共命令 ID `exportShareCard`、
`exportHeatmap` 与 `publishHeatmapToGitHub` 至少保留一个版本并打开对应呈现方式，不绕过预览。
退役的 `showHeatmap` 仍保留在 catalog 中并可被清除，但隐藏且不再创建重复面板。所选呈现方式
只是本地 UI 偏好，不改变 provider 统计口径。显式兼容命令会生成 provider 生命周期内单调递增的
revision，并把它作为独立的 live intent；Webview 应用后 ACK 精确 revision，host 随即删除 live intent，
但不回退 revision 历史。因此，已确认的命令不会在普通重绘、分享重置或同一 provider 的
dispose/reopen 后重放。「重置分享偏好」复用既有的确认式本地数据动作：host 发送带 request-id 的
client action，Webview 验证十二个 allowlist localStorage key 均已删除；只有匹配 ACK 为 true 才算成功，
否则 host 报错并保留恢复 tombstone。

在窄 Webview 中，1200×680 Claude 分享卡在可键盘聚焦的局部横向滚动区内保留原始宽度，
不缩小到无法阅读。Renderer 测试逐一审计所有普通字号 SVG 标签，保证至少 4.5:1；浏览器 geometry
测试保证标签不越出各自 viewBox，且完整产物仍包含在外围 Axe 扫描中。

## Token 与 limit 语义

Claude record 带 Anthropic 的四个 token bucket。扩展对其校验、去重、求和并按模型计价。
Claude 成本仍是根据费率表的估算，不是发票。

计价诊断在整个 Extension Host 生命周期内保持有界。每个此前未知、符合模型名称格式的
标签最多提示一次；最多保留 128 个标签，每个不超过 160 个字符，另有一条停止提示的摘要。
格式异常、过长或呈路径形式的标签共用匿名占位符。刷新与标签轮换不会重置这一上限；
提示达到上限后，回退计价仍然有效。已识别的 Opus 5.5、Sonnet 5.5、GPT-6.1 Sol、
GPT-6 Sol 和 GPT-6 Luna 别名使用独立核验的 Standard 与缓存费率，不产生未知模型提示。
不同代 Sol 的缓存读取费率不同。聚合数据不能证明 OpenAI 请求是否采用 Fast、Batch、Flex，
或适用长上下文、区域附加费，因此不推测这些费率。Codex 与每周等效价值的精确定价覆盖率
排除模型家族和默认回退价；Claude 主成本保留既有估算回退行为，不增加覆盖率标记。

模型元数据为非字符串、超长标签、含控制字符或原型属性名时，在保留前统一为 `<unknown>`。
对应数字用量仍计入统计，价格为零且不归属已定价模型。缺失或 null 的模型字段保留既有跳过行为，
任意可选对象不会被强制转为字符串。工具与会话分析映射只读取自身属性，并以不触发 setter 的
方式写入自身属性；保持普通快照对象的形状，不修改共享原型。渲染阶段的会话、工作流、项目与
归因内部分组表不含继承属性；公开行和快照仍保持普通对象的形状。兼容 full loader 只输出匿名摘要，
不逐行或逐文件输出控制台错误；可选诊断详情最多保留 12 个长度有界的模型名称。

手动刷新运行时价格采用 single-flight。HTTPS 响应上限为 16 MiB 与 16,384 个目录条目，
同时设有 15 秒绝对截止时间与空闲超时。有效的有限非负数值构建新的原型安全价格目录，
仅在成功时原子替换旧目录。失败保留旧目录和获取时间；重复刷新不保留过期模型 ID。
后续新增模型必须核验官方精确 ID 与费率，加入多轮诊断及缓存、输出核对回归，
不能将模型家族推断当作精确定价覆盖。

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

### 本地成就（2.5.0）

历史日期采用冻结的 138 项规则注册清单，逐项匹配 ID、计数器、门槛、分组、规则版本、
系列、基础 ID 和金额范围。新增规则或修改口径不能默默继承日期；模块级签名覆盖实际及
已注册元数据。会话重建仅消费规范索引完整的会话准入，不把任意正输出记录视为合格会话。
会话缓存以记录数组为弱键，来源或证据退役时显式释放；日志变化后需要重新校准。
校准期间暂存独立核验的真实增量收据，UI 取消或另一来源失败不丢失其首次记录日期。
只有历史补认保持静默；完成、部分已保存、取消和失败分别报告。

图鉴全部展开／收起仅修改既有 `openDetails` 本地 UI 持久状态中的卡片项，不选择来源、
授奖或确认未读。等级显示为本地化铜／银／金（繁体銅／銀／金），旧 ID、固定项、参考价表
和门槛不变。各级条件与单位仅在完全相同时集中显示。`webview.ts` 统一渲染金额参考说明，
列出各已启用供应商的当前价表／日期及一次非账单提示。不同历史 `referencePricebook`
按价表归组并保留准确的奖项名称／等级关联；当前价表选择不改写这些关联。
卡片移除重复价表／依据说明，保留范围和计价覆盖率。
满级仍显示未截断的当前统计，证据缺失或过期时保持不可用，不以目标值或已存徽章替代。

展开等级行按各等级主题 token 渲染名称（高对比模式回退到前景色），门槛在同一标题行
加粗、右对齐。仅证据就绪时，最高已获等级的下一等级显示「进行中」；后续等级、满级及
证据待定均不显示。保留日志已核验日期仅显示 ISO 日期，来源含义在「数据依据」解释一次，
title／ARIA 保留来源说明。两种日期同时存在时仅显示已核验日期，首次记录详情保留在
title／ARIA；仅有首次记录日期时保留明确标签，未知仍为未知。此项仅调整渲染，授奖规则、
日期计算、目录及持久记录均不变。

`root-portfolio` 本地化名称为「独立主任务」（Independent root tasks），ID、门槛及
已存授奖不变。`achievements.ts` 仅在根归属可核验且已识别模型桶的输入**或**输出为正时
建立 `modelsByRoot`；`verifiedRootCount` 将主任务树及其合格子任务合计一次，
不声明任务已完成，也不读取任务内容。

「分享与对比」改名不改变 `compare` provider 键或导航状态归属。徽章分享仅增加
选择项的基本等宽对齐及等级单列。本地图标修复沿用主仪表盘 CSP 的
`webview.cspSource`，允许打包资源的 `asWebviewUri`，不新增远程图片权限。
`achievementShare.ts` 嵌入固定公开锚点 `https://github.com/ClaudeCodeUsage/ClaudeCodeUsage`，
不接受输入派生目标，不获取资源、不新增遥测或个人元数据。标题、页脚及等级／门槛
在既有网格内通过换行和间距避让；输出仍确定、自包含，使用内嵌图片，预览／导出不可变约定不变。
分享页整体视觉统一／美化及持久用量归档推迟至下一版本，2.5.0 未实现这两项。

逐级历史日期是 `schemaVersion: 1` 的派生注释，绑定 `ruleVersion`、数据时区及实际目录
形状；缓存复用还依赖当前来源证据、启用供应商及计价上下文。来源、OFF、时区或价格变化
重建或撤回注释。该缓存仅存在于运行期，不是新存储；规范 v2 的原有 `recordedDay`、
未知日期和未读状态保持不变。显示的日志日期仅表示保留本地证据（含已核验子集）可确认的
最早日期，不能证明账户真实完整历史；已存首次记录日仍是独立事实。

自动日期计算复用已物化每日数据，支持通用用量、输出、缓存、模型／家族、活跃及周规则；
Codex 仅接纳严格核验且用量完整带日期的文件证据。日期语义沿用既有 evaluator：活跃日计数
及连续活跃包含当天正活动，日期为当天；合格家族／日条件仍须闭日，日期为该日加一天。
四周窗口按首个正活动日排除首个不完整周，不受更早的全零行影响。这些是既有条件的日期
投影，不是规则调整。仅显式手动校准会归约已持有、未受界面条数上限截断的 Claude 记录
内存，计算输出会话、Fable 会话及同会话 Fable／其他家族日期。日期归约仅读已物化数值或
已持有记录的 usage 元数据，不额外扫描日志正文、不检查对话内容或导出元数据。
正常本地增量刷新仍可按既有分析设置读取允许范围的新增／变更 JSONL，不强制全量重读、
不新增扫描器或网络访问；普通热刷新不为日期重聚合这些记录。

联合智能体／effort 条件、小时／夜间条件、单任务金额日期，以及缺失时间戳的迁移本地操作
没有受支持的历史日期处理器。它们保持未知或显示原有首次记录，不能补成今天。
未来规则必须显式进入日期处理器白名单并隔离规则版本，新范围默认未知；未来目录封套
继续沿用只读、fail-closed 行为，不自动改写。

手动校准仅执行本地 single-flight 增量操作，不新增 OAuth／额度、在线计价、BYOK 或其他
网络请求，不强制全量扫描或清除旧徽章。pending guard 暂停历史补认及基线推进，
真实增量收据独立暂存；通过 guard 的提交静默补认历史，不强制授奖。忙碌、当前索引全清单
未获接纳、失败及提交前取消不能报告成功。基础索引须当前 manifest 已接纳且索引完整；
独立日历、计价或子集覆盖可不完整。已核验部分历史保留下界或未知，完成不代表所有授奖
范围完整覆盖。历史补认在提交前取消不新增历史奖；guard 有效时原子提交一旦完成，
committed 标志保留真实结果，后续取消不撤销已保存记录，也不能误报未保存。
这些展示功能不改变存储
schema、来源解析器、依赖或软件包版本。

图鉴包含 50 张展示主题卡、178 个解锁条件。`enableAchievements` 默认开启，已有关闭偏好
优先；一次性非模态升级提醒可查看或关闭成就，不自动打开图鉴。历史授予先建立
静默基线，之后符合条件的新成就只短暂在面板内提示，不发声、不抢焦点；夜间与
24／48 小时输出徽章始终静默。

24 个 API 等价条件分属 Claude／Codex 各自累计、已结束周及单次会话／任务六个主题。
`achievementMoney.ts` 固定 `api-reference-2026-10-{backend}-v1`（2026-10-09），
精确十进制组件求和后才向下取整为 microUSD。仅精确型号及完整价格（含 Claude 已知
缓存写入 TTL）合格；未知型号未定价，可信已定价子集只证明下界。周范围为当前数据
时区内已结束的周一自然周；单次须为一个 Claude 会话或独立核验的 Codex 任务树。
历史补认静默；累计金额跨级已使用核验的新追加收据，已结束周及单次会话／任务金额
范围仍静默且日期未知。仪表盘浮动计价及显示币种不改变这些规则。

`claude-api-week` 与 `codex-api-week` 各有五级：铜 $100、银 $500、金 $2,500、
铂金 $10,000、传奇 $25,000。仅新增四个铂金／传奇 ID，原三级 ID／门槛、系列归属、
图案、已结束周边界及固定价表来源不变。四项显式历史注册将清单增至 138 项；受支持的
日志日期注释仍不同于已存首次记录日。旧封套拒绝新 ID，扩展前的读取器遇未知等级拒绝
操作，不改写或清除任一封套。schema／catalog 版本和 65,536 字节上限不变；已报告的
最大封套夹具为 37,374 字节。这些合成检查不构成原生／F5 验收。

`achievementModels.ts` 将协作／彩虹等非金额模型识别与 `achievementMoney.ts` 的固定计价别名分开。
Claude 家族标签仅允许明确的 `global`、`us`、`eu`、`jp`、`apac`、`in` Anthropic 前缀，
拒绝 `xx` 等任意前缀。已识别的 Codex 命名家族标签仍可能未定价；识别不增加价格或
计价别名，也不证明上游路由或可用性。

图鉴按已启用供应商分别统计系列与等级。计数之前，记录加载中、暂不可用、状态已变更及
已关闭四种状态使用八语明确说明，不显示貌似空图鉴的 `0 / 0`。已启用的 Codex 来源尚未
核验时，可信 Claude 累计小计显示为 `≥` 下界，未知 Codex 用量不视为精确零。
稳定系列键负责等级变化后的展开／焦点恢复，
兼容旧的等级键。全部／待解锁／已获得筛选仅保存本地界面枚举，不调度供应商任务。
安全的供应商枚举与一次性焦点意图用于从分享返回原图鉴。卡面展示简短下一目标，
完整各级条件放在展开区；设置入口定位已有关闭选项。
目录提供 52 套独立本地图案；同系列各等级复用徽章，以等级色和文字
体现进阶。图鉴使用向下取整的整数缩写，不把未达标进度四舍五入为达标；提示与
无障碍文本保留完整整数。数据边界放在默认收起、可恢复展开状态的说明区。导出
图片按文件名缓存，不为同系列的每个等级重复保留内嵌字节。

`achievementGallery.ts` 仅映射展示归属，不迁移规则或账本。十四日（`streak-machine`）
与首个双供应商达标日（`dual-provider-day`）里程碑放入对应的持续成长主题。每个正式规则
在详情中出现一次；里程碑保留自己的图标、状态和条件，不增加等级圆点。仅获得旧里程碑
时，卡片仍为已获得，但正式等级数为零。代表徽章、最近获得与展开别名共用此映射。
取消旧固定项后按钮若消失，已有运行期焦点回退优先返回归属主题摘要，其次成就页签。
幸存按钮仍优先保留焦点，不新增持久焦点状态。
插件探索详情只读投影已提交的 `achievementActivity` 中三个既有安全功能枚举；
按目录排列，不是行为时间线。各步标识已记录／暂无记录，不用历史奖章或待保存操作
补造证明。建议反馈与设置修改保持独立规则；不增加控件、状态字段、读取、事件或评估逻辑。
图鉴、提示及本地 SVG 共用新 `safe-feature-journey-v242.png` 映射，不再使用错误的“10X”图案；旧文件保留。
仅提示中的图标通过 CSS 执行一次 440ms 透明度／缩放变化，提示框与文字不移动。
减少动态效果及两种原生高对比度 body 类完全关闭动效。投递、冷却、关闭与 ACK 协议不变；
不增加计时器、持久状态、网络请求或重放。

`achievementGallery.ts` 白名单映射同供应商当前模型／Token 统计。共享渲染器要求已有物化数据，
模型入口还需对应家族；共享、日历、功能操作条件不以当前总量替代。客户端只由已渲染按钮
解析固定 DOM 目的地。既有 Webview UI 状态仅新增一个公开主题键及供应商枚举用于返回，
专用往返保留展开／滚动，普通标签或供应商切换取消意图；不新增宿主命令、日志扫描、日期或分享授权。
保存的固定键保持原样；旧重复固定项可在同一卡内分别取消。分享、授予 ID、日期和未读组
均不改变；渲染不写入，也不读取日志。

`achievementStages.ts` 在正式 Token 等级之间加入仅用于展示的 1／2／5 整数节点，
Token 首级前的一数量级也有展示节点，但需正向且有效的进度；金额首级前不追加，末级后均不追加。收起的卡片也显示当前／下一正式等级，适用时显示下一阶段；
待补齐／过期证据不显示这些进度。次数／设置探索不添加节点；正式 ID、门槛、获奖
数量、提示和分享选项均不变。节点只从固定目录及当前聚合计算，不新增写入、历史
扫描、定时器或权限。

`achievementOverview.ts` 从已归并、供应商已启用的条目中选择最多三枚代表徽章及
三个有当前有效正向进度的目标。目标按下一展示阶段完成比例排序，以固定目录打破
并列，同主题最多一项；代表徽章优先已获等级，再考虑当前供应商。夜间／小时目标
不主动推荐。选择键仅在本次浏览的宿主内存中保存，进入页面、切换供应商、手动刷新、
关闭或清除时重新选择，不成为分享选择。实时变化只更新数值、移除失效目标，不换位
或替补。点击打开已有、可保留的系列详情，不读日志、不发刷新请求、不保存第二份
聚合索引。固定项、记录投影及前台错过提示摘要使用下述有界权威封套，不创建第二份获奖账本。
下一目标概览使用目标名称、等级标签及等级色；图鉴已获卡片保留已获等级。
`achievementTitles.ts` 与 SVG 导出共用，仅在等级单独显示时移除由目录中点分隔的
匹配本地化等级或其旧名后缀，避免重复；其他标题文字及无等级里程碑保持原样。

`achievementLongTerm.ts` 给15个既有 Claude／持续活动系列追加30个固定高等级，
原三级 ID、门槛与证据不变；新 ID 复用明确基础规则的计数、图案和本语种名称／等级。
不追加连续活跃日等级或扫描器。家族活跃日归活动主题，自动代表不再必然挤掉模型用量。
旧 ID 和v1系列固定词汇独立冻结，不能从新版系列成员反推旧资格。新等级不能作为v1
证明导入；v2 可读取旧 144 项封套，当前最多 178 项，仍不超过 64 KiB。旧二进制可以拒绝
未知ID，但不能覆盖权威封套。高阶输出／缓存沿用原生尾部因果核验，会话／日期补认
保持静默且日期未知；分享选择不自动升级。

`codexAchievementRevision.ts` 的运行期 v3 摘要绑定全清单、独立的索引／全局日期／
时区边界、contribution 见证及 period 游标／日期向量。仅游标、见证或边界变化也会
退役日期／金额缓存，即使显示计数相同。复用既有摘要／缓存路径，不增加 I/O、
定时器、存储或持久索引字段。

供应商每次先重建当前全清单与独立见证，再与上次发布的快照精确比较。只有相等、
与原数据分离且深度不可变、由 `immutableCodexAchievementFiles` 登记的副本，才能在
独立边界仍一致时复用摘要及日期投影缓存。`indexChanged`、零正文读取、总量相等或
调用方提供的摘要均不能替代此比较。可变／异常输入继续走普通验证；不修改 worker
拥有的聚合或先前快照。金额范围绑定复用内部已核验投影，避免重复日期计算，但不信任
任意传入的投影。

20,000 文件 × 每文件三个日期的合成测量包含快照构建：暖评估中位数约为
348 → 109 ms，变化评估约为 2,110 → 1,460 ms。该规模的变化／追加仍约需 1.5 秒，
复杂度仍为 O(files)；即使缓存复用也须比较全清单。这些本机测量不包括 worker 解析、
文件发现或仪表板渲染，不代表端到端刷新、原生响应或通用延迟保证。

`codexAchievementCalendarProjection` 要求当前清单已验证、主索引完整。供应商从
contribution 自身大小、偏移、预期谱系前缀及时区构造仅运行期见证：EOF 必须与
period 游标一致，前缀／时区须符合当前 period 语义，且无 period 迁移、超长行丢弃或谱系
对账。传入聚合自带见证被剥离；刷新失败后不能沿用见证作为授权。投影先解析全清单
祖先关系，再选日期，排除冲突分支及后代。可信正向日期分量即使存在未归日余量或
全局日期边界不完整，仍可作为活跃、模型家族及单周 Token 规则的 `verified-subset`
下界。子集不能证明完整／零用量历史、四个已结束周的周均值或保留日历峰值；
双供应商同日规则也保留既有完整证明门。

`codexAchievementMoneyScopes` 获取原始全清单的已核验投影，仅对上述不可变快照复用，
核对 `sourceRevision`、完整性／
范围及数值日期／模型签名后，才选择完整归日文件。每个入选文件的所有计费计数和
模型／日期向量必须精确相等，仅 Token 包含关系不足以证明金额。此子集中已结束的
周一始自然周正金额仅为下界，覆盖标为部分并附运行期 `scopeLowerBound`；部分范围
的纯零值／空值仍待补齐。正金额按精确单位判断，即使整数 microUSD 向下取整为零。
定价覆盖独立于日期／清单覆盖：未知型号仍未定价，溢出金额
仍不可用。累计及任务范围不变。不新增价格或规则；复用既有八语证据说明，更新文案
以涵盖无法核验的 Codex 谱系或日期用量。即使身份覆盖完整，存在日期／周金额范围
下界时页脚也显示该说明。见证／摘要不把原始身份带入渲染、导出或持久索引状态。

顶部采用宽度受限的横向卡片，少量徽章不再平分桌面全宽；卡内固定按钮仍是独立按钮，
下一目标的细条仅辅助已有带标签数值。保留三档大小、图案、主题变量和状态持久化。
`modelRainbowNextEligibility` 排除超过当前供应商家族容量的下一目标（Claude 四家族、
Codex 三家族），不改变正式条件、固定项或图鉴可见性。

正向综合日期规则从各供应商独立验证的日期派生有界、运行期的逐规则下界集合。
另一方不完整时，活跃日、连续活跃、活跃周、单周 Token 峰值及已证明的三家族同日
仍可显示 `≥`；部分证据的零计数仍未知，双供应商同日与四周平均保留完整证明门。
此集合不打开综合域提示基线，也不伪造历史授予日期。`normalizeClaudeNativeUsage`
仅由两个明确、安全的已知 TTL 分项恢复缺失的缓存写入总数，不改源记录；全量和
紧凑／增量 reducer 共用此逻辑，矛盾或未知 TTL 仍不能成为金额证明。

启用成就证明时，缺少当前谱系标记但可兼容读取的旧 Codex period 进入既有有界日期
迁移，不再永远暖刷新跳过。canonical 文件重验完成前全部时间证明覆盖仍不完整，
可读兼容片仍服务普通展示；保存游标支持取消／恢复，完成后暖刷新正文零读取。
关闭成就时跳过这项额外重验。

`achievementEvidence.ts` 将规则分为九个独立的运行期证据域。有效、待补齐与过期证据
独立于已保存获奖身份：待补齐／过期卡片保留已获等级，不显示数值进度，不进入待解锁
筛选。各域首次或恢复证明时建立静默基线，日期证明不足不再压住后续可信 Token 奖项。
供应商退役只重置受影响的域。用量域静默校准历史后，迁移复核集合不再永久压住其
后续等级提示。这些状态只在内存中，不等同于持久化错过提示记录或跨宿主协调。

Claude 索引使用仅运行期尾追加来源合同。异步工作前复制明确的已接受观测
窗口，在内容分析计划扩大前沿用既有物理文件／前缀／EOF 验证的偏移。全局响应去重
后，只有偏移后的新增规范赢家、窗口内事件时间和安全原生 Token 数值才进入固定的
总量／输出／缓存读取／缓存创建／四模型家族下界。冷构建、新发现导入、替换、未完成尾部及
时区退役不提供新活动来源；混合历史只保留独立可证明的新增部分。结果不含来源身份，
不持久化索引字段，不增加正文读取或定时器。等级助手复用正式门槛，逐等级要求新增
部分足以使旧进度达标，且从新进度扣除它后不再达标；不据总量推断日历／会话／协作。
宿主现于解析前读取权威获奖代次／序号，先提交已接受索引，再交接已有物化引用，
不依赖重绘。四模型家族、输出、缓存读取、缓存创建及累计跨级进入原子用量授奖；
累计金额使用下述独立证明路径；其他用量规则仍待各自来源证明，保持静默。
创建、读取、输出必须为安全整数，分量和
不得超过已处理总量；原生向量中的缓存创建仅计一次。手动重建不提供新活动窗口。仅呈现代次
退役不丢弃可信来源提交；来源、失败、清除、OFF、时区及销毁守卫会使证明退役。
显示时区的用量收据不把其他时区的日历证据重新标记。

Codex 已补上对应的 producer／worker 基础。仅完整旧主索引中、物理身份已建立的
文件追加收到明确且已复制的观测窗口。正常主解析器累计窗口内输入＋输出、输出、
缓存输入和三模型家族数值；去重及谱系处理后，新旧快照都须验证相同物理／会话身份
和稳定继承前缀，每个接收字段不得超过该文件实际聚合增长。无关身份冲突只排除
自身分支，不压住可信新增。冷构建／导入／替换、未完成尾部、时区变化、计数回退及
未稳定前缀不提供新活动证明。`providers/codex/codexAchievementOrigin.ts` 管理此运行期
下界、谱系接收与严格窗口／DTO 重建；不增加持久字段或正文读取。
主文件 worker、coordinator 和 client 重建固定数值 DTO，外来窗口／请求、重复任务回复、
恢复／旧缓存沿用及取消不能提供证明，最终原子保存失败不交付成功结果。证明只存在
于运行期，零正文读取的暖刷新不重放。逐等级助手使用既有正式门槛及必要／充分判断，
不推断日历、effort 广度、会话或协作授奖。
Codex facade 在异步工作前复制窗口，仅返回匹配的成功证明。每次观测前，webview
所有者在共享 lease 内重读权威获奖代次／序号；扩展交接已接受快照不依赖重绘，
暂停页面更新时仍可授奖。单独的已接受引用进入评估器，不改显示快照。来源、设置、
时区、清除及销毁守卫退役证明；无关 Claude 失败不取消可信 Codex 新增量。
固定的 Token 跨级集合经 `recordUsage` 保存首次记录日／时区及未读状态。只有选定
奖项且序号晚于观测基线的历史补认可被替代；已有历史、本地操作及用量来源不改写。
替代会递增序号，旧显示确认不能读掉新记录。写入失败保留最多图鉴 ID 数量的
运行期收据，供普通刷新重试；退役收据释放来源守卫。不增加索引字段、正文读取、
监听或定时器。前台提示复用共享冷却与确认守卫。Claude 复用相同的有界收据队列与
lease；任一供应商失败只退役自身证明。其他用量范围仍静默补认，直到各自来源接入；
累计金额采用下述独立运行期路径。

`achievementMoneyOrigin.ts` 只接收每家供应商四个累计金额等级跨级，要求全范围前后
证据及新增金额使用同一
固定参考价。增量既须足以使旧总量跨过既有门槛，又须是新总量达标的必要部分。
Claude 正常解析／索引只纳入额外已接受响应身份，参考价缓存 TTL 证据须完整，支持
两个固定 Claude 后端价表；Codex 真实 worker／facade 使用 OpenAI 参考价给已知原生
事件计价，并由受影响文件的已定价聚合差额限制增量。无已接受窗口或关闭成就时不做
额外金额来源计算；主解析计量语义不变。

可选运行期金额证明只含供应商／后端／公开价表版本、最多 64 位十进制精确单位字符串、
microUSD 及合格已处理 Token。IPC 边界固定字段重建，固定价表最大逐 Token 单价作为
经济上界；无效金额只撤回金额证明，不污染 Token 证明。新增金额来源证明的金额、
精确单位、合格 Token 计数、原始事件／来源 ID 及证明均不写入索引或获奖文件；
金额奖章仅在普通有界记录字段之外保留公开 `referencePricebook` 版本，既有用量聚合
仍遵守原存储合同。
金额来源只使用固定参考价，不使用当前浮动单价。

宿主保存有界、独立金额收据，由来源、身份、范围、日期／时区、清除代次及关闭成就
守卫保护。租约提交时再次核对当前参考价及合格全累计范围；仅金额价表／范围失效时
只撤回金额，不取消独立有效的 Token 收据。共同的来源／索引、清除、OFF 及销毁守卫
仍适用于两者；Claude 后端切换还会使索引代次失效，可退役待保存的 Token 证明。
保存失败保留可重试运行期证明，不乐观显示日期。
`recordUsage` 原子保存 `usage` 来源、首次记录日／时区及未读；仅同价表且序号晚于
已接受基线的其他窗口历史可修复并生成新序号，不同价表或已有历史保留原依据／日期。
同次已接受更新的 Token／金额写入合并为一个既有五分钟提示批次，不新增定时器；
隐藏面板／未读摘要行为不变。已结束周、单次会话／任务及其他未支持新活动范围仍静默且日期未知。

`CodexAchievementSignals.effortStatistics` 是完整当前规范索引的可选证据。
`extension.ts` 只在证明修订变化时计算；未变化暖更新复用同一信号对象／结果，不再次
调用助手。关闭成就跳过计算，来源／配置替换或索引不完整撤回为未知，不补六行零值。
纯助手先汇总非 approval-reviewer 的根任务 × effort，只接收该组合自身有正输出的
用量。low／medium／high／xhigh／max／ultra 六行仅位于已有 effort 广度卡片展开区，
沿用下一既有等级的三个联合条件；渲染与授奖共用 `EFFORT_PROCESSED`、
`EFFORT_OUTPUT` 及 `EFFORT_ROOTS`：

| 既有等级 | 每 effort 已处理 Token | 每 effort 输出 Token | 每 effort 合格根任务 |
|---|---|---|---|
| 铜 | 1 亿 | 10 万 | 5 |
| 银 | 5 亿 | 50 万 | 10 |
| 金 | 20 亿 | 200 万 | 30 |

每行进度取三个条件完成比例的最小值，最多 100%。仅供参考的小计／覆盖率使用固定
美元 `api-reference-2026-10-openai-v1`（2026-10-09），不随显示币种变动，也不参与
effort 资格判断。独立模型／effort 边际不能证明交叉归属，不按比例分配；只有单模型
或单 effort 完整价格组件对账
才能接收已知已定价子集，其余 Token 未定价。空、未定价、部分、无效、溢出分别处理，
不安全金额撤回。DTO 不输出身份／型号标签／精确单位字符串，不保存历史，不增加
规则、门槛、导航或偏好；目前 Claude 日志不提供此处的 effort 归属。

主动分享可包含已关闭供应商的保留徽章；图鉴及新增固定按已启用供应商筛选。
保留记录不提供当前用量进度，也不授予新的解锁权限；分享不会重新开启供应商或读取其日志。

徽章分享仅保留一份已接受 SVG 及不透明运行期句柄。客户端标识与请求序号拒绝过期
回复；回复可移除不再可用的勾选项，但不得新增徽章。界面恢复复用匹配的已接受内容。
导出要求句柄、有序 ID 与界面语言一致，在单次保存对话框前固定字节。成功、取消、
匿名写入失败均在面板内反馈；已开始保存的字节不受后续语言变化影响。失效的选择有
明确提示，不会自动升级勾选。替换、清除、关闭功能或面板
都会退役保留产物；生成失败也会废弃旧句柄，仅返回匿名失败标记。

旧 globalState 精确账本只含白名单规则 ID、29 个安全设置键与四个本地功能枚举、
上限为 48 的小时连续输出最大值，以及一个带语境的四周周均数值峰值。不保存设置值、
账户／来源标识、提示词、凭据、操作时间戳或导出历史。审计及可恢复迁移状态进入
Clear All 的精确白名单。完整字段与上限见[本地数据说明](LOCAL-DATA.md#local-achievements-250)。

Claude 在 Sessions 页 1,000 行显示上限之前计算会话成就证据。平铺的
`projects/<project>/agent-*.jsonl` 缺少路径可证明的父会话，仅从会话成就证据中排除，
不把记录的 `sessionId`／`isSidechain` 元数据提升为归属契约。Token 总量、计价、每日
聚合及可见会话行不变，嵌套代理保留既有父目录契约。这一仅运行期筛选不改源日志，
也不删除缓存或已保存的徽章。

`achievementRecordStore.ts` 单独管理扩展全局存储中的权威获奖封套
`achievements-v2.json`，不与运行期基线混淆。总序列化大小不超过 64 KiB，最多
178 个当前规则 ID；含单调序号／代次、原因枚举及可选首次记录日／时区。
v1 文件在明确清除之外只作只读迁移输入；已保存的 21 个改变过的模型／团队／effort／
彩虹条件归入最多 48 条旧规则记录，不用于证明新条件，旧金级不能证明新规则。
固定价奖项可保存公开参考价版本，不保存个人金额。
读取已保存的金额记录时，接收该供应商当前价表及 `achievementReferenceBooks.ts` 中三个
明确已发布的 v1 标签：Claude 的 `api-reference-2026-10-anthropic-v1`、
`api-reference-2026-10-aws-bedrock-in-region-v1`，及 Codex 的
`api-reference-2026-10-openai-v1`。当前价表选择改变不重写已存标签；新增 `append` 或
`recordUsage` 草稿必须使用当前供应商价表，可读的历史标签本身不能授权新授奖。
这是明确的已发布历史登记，不按字符串模式放行未来价表，不新增价格、ID、存储字段或
schema。未知且非当前的价表安全拒绝，整个封套保留不动，清除全部也不改写。

schema／catalog 版本、自动／手动模式、有序固定项、固定修订及有界旧文件边界共用此封套。
两份文件共用既有 v1 租约；
清除先保存 v2 墓碑，再保存空 v1 降级屏障，中断清除在同一租约内续办。
通过旧审计的奖章只在文件不存在时静默迁入，日期未知；已有文件优先于旧 globalState。
每次事务在既有文件 lease 内重读、合并，刷新私有临时文件后原子替换，不覆盖其他
宿主的奖章。清除在同一 lease 内删除精确相关旧键，再保存空代次／序号屏障；旧宿主
在重新加载前安全停止回写。本地操作、小时及日历写入均核对已接收代次。
未知、未来、过大或符号链接输入保留不动，不回退到旧获奖镜像；关闭成就不初始化
新文件。真实已保存的本地操作保留未读记录，不因隐藏或投递失败丢失。可证明的
Claude／Codex Token 跨级和同一冻结参考价下的累计 API 等价跨级，也通过独立收据
保存未读与首次记录日。单次／任务、日历／结构等奖章若没有各自可验证的新活动来源，
仍静默补认且日期未知；只有证据域增长或价格变化不能证明来自新增活动。封套也管理原有
有界行为／小时／日历证据：29 个安全设置键与四个枚举取并集，小时最大值上限 48，
日历峰值只在相同测量语境内合并。仅 Claude 的保留峰值忽略无关的 Codex parser／period
版本；规则、时区、供应商存在位及完整当前证据门仍适用，任何包含 Codex 的语境仍核对
这两个版本。旧 Memento 辅助字段只作迁移输入，不作运行期
镜像；恢复始终接收权威证据，包括清除后的空证明。引导期间用最多 33 个不同键
合并主动操作，恢复完成后才重放，避免旧窗口整对象缓存复活。插件动作来源比较
lease 内真实保存前后的行为差异，不会把其他宿主导入的进度当作本窗口新行为。
主动操作与它新跨过的插件奖章在一次事务内保存，避免其他窗口历史补认抢先占用
这些奖章的来源／日期／未读状态。
实时提示在同一 lease 内预留跨窗口五分钟冷却，但不标记已读。复用现有原生窗口状态
所有者判定前台；面板可见／就绪、OFF／清除代次及文档替换共同约束投递与确认。
运行期匿名句柄将显示确认绑定到本批实际代表的 ID 与发出时的最大序号，其他或后续
未读保留。投递 false／失败／缓慢不会阻塞奖章保存或清除。客户端只在可见插入后
确认，不抢焦点；悬浮／键盘操作期间暂停六秒自动关闭。错过的批次不重放实时提示。
前台未读摘要现提供明确的有界确认；未支持的用量新活动范围仍待接入，分享仍须明确同意。

`showAchievementNotices` 是默认开启的本地呈现偏好，与成就总开关分开。关闭它不退役
来源证据、不停止授奖、不删除未读、不消耗提示冷却。单独的运行期偏好代次拒绝排队
预留及旧确认，包括快速 OFF→ON；可见客户端立即关闭提示，在保存后的宿主页面
重新启用前拒绝过期提示。重新开启不补弹错过的提示。设置路由只更新页面呈现，
不重启供应商或扫描；这个关闭偏好不计入插件体验成就的设置白名单。

恢复页面的就绪握手现报告实际供应商／页签，宿主只接受当前供应商的合法页签，
对比页仅有 `all`；普通切页使用同一白名单。恢复不计作功能体验、不启用其他
供应商、不授奖或标记已读。未读展示的准备投影从完整有界封套选择最多六个
精确非历史等级，不受三十条历史显示上限影响；其他窗口新增不扩大原组的
ID／序号，成员隐藏、已读或替换时重新选组。投影复制记录，不写确认。
默认折叠「新增 N 项」使用运行期匿名组句柄及文档身份；只有同一就绪／可见／聚焦
成就页的明确「标记本组已读」才排队保存。共享 lease 提交边界再次复核来源开启、
供应商、清除代次及组身份，仅确认宿主保存的精确 ID／序号，不接受客户端任意 ID。
重读合并保留其他窗口后来新增；失败仅给固定本地化反馈，保存后的渲染失败不误报
保存失败。移除组后焦点回到摘要或成就页签；浏览／固定／分享不确认。
没有新增定时器、日志扫描或持久字段。完整文档替换及补丁失败回退更新文档身份，
拒绝旧页面就绪／切页／已读消息；普通数据补丁保留身份。失焦／关闭／清除／销毁／
切换供应商或页签退役组所有权，不重放错过提示。

`achievementOverview.ts` 已准备只读记录投影：最多三个非历史最近系列、三十条按
首次记录序号排列的记录及当前可见等级的精确未读 ID。记录顺序不冒充原始达成时间，
投影淘汰不删除奖章。自动模式推荐最多三个已获主题；手动模式只显示选中的最多六项，
不自动补位，不改变下一目标。收起卡片的固定控件及可搜索编辑器在共享租约内保存选择／
顺序／模式；批量选择及排序核对当前固定修订，拒绝旧窗口覆盖其他窗口选择。
`setPinned` 在文件 lease 内施加单项幂等意图，拒绝未获系列，最多六个位置，不以旧
整份列表覆盖其他窗口的固定项。记录投影已呈现最多三个最近系列及折叠的三十条
记录；每条保留精确公开等级、首次记录日／时区或明确的历史未知日期。点击仅打开
现有规则，不标记已读、不选择分享；折叠状态跨页面替换保持。已获徽章详情发送单项
带代次的固定／取消意图，只在成就开启、前台面板可见／就绪时受理。成功保存后经
既有仪表盘补丁更新按钮状态及展示柜，不改变下一目标或分享。稳定控件 ID 保持
焦点／滚动锚点；保存失败保留旧选择并使用本地化行内反馈。渲染失败不冒充保存失败。
关闭供应商只阻止新增固定，不阻止明确取消已保存的公开键。折叠入口最多列出六个
隐藏固定项，共享 lease 下仅移除选中项，不启用供应商、不读日志、不改变奖章、
未读及分享。按钮消失后焦点回到组摘要，列表消失则回到成就页签，不新增客户端状态。

Claude 在会话列表 1000 行显示截断前物化全会话计数。Codex Token／模型／协作里程碑
要求当前清单索引完整，并逐谱系核验规范化证据。身份冲突只排除相关分支及后代，
不阻断无关谱系的正向证明。筛选与根会话定位采用迭代／记忆化；无效数值、孤立／
循环／未知角色及不安全求和均不授予。日期选择沿用上述全清单祖先解析及运行期见证
合同；只有全清单完整性才能证明零值、四周周均及保留峰值。
UTC 正输出小时在正常解析时同步获取；旧索引使用有界、可保存
检查点的证明迁移，保留主用量。关闭成就只停止这项额外迁移，不停止普通用量解析。
宿主另保留一个仅运行期的 SHA-256 成就证明版本：规范化身份、六种 Token 计数、
模型／推理档位桶、period 谱系标记／游标、运行期 contribution 见证与日期桶，以及
独立的索引／全局日期／时区边界。证明单独变化
时，即使仪表板完整渲染合同相同，也更新成就信号；证明不变及纯标题／结构显示变化
复用信号。摘要从已有聚合逐项计算，不另留完整数据副本、不读取 JSONL、不增加持久
键或定时器，亦不记录或导出。关闭成就完全跳过摘要和信号计算并退役内存证明；
重新开启后在下次已接受快照采用当前证据。来源替换也退役版本和信号。不撤回历史
奖项，也不自动把旧 period 当作完整日期证明。
刷新失败立即撤销新授予权限，不重绘或丢弃上次显示的数据；暂停自动刷新也不能绕过。
用量证据版本与清除／活动版本分别保护排队写入，退役供应商不能授予新成就。首次
历史对账保持静默。

插件操作来源通过正式规则评估器比较已提交账本的前后状态；只有新跨过门槛的插件
规则进入最多六个 ID 的运行期集合，读取／导入旧账本不进入。授予保存成功后消费 ID，
失败保留可重试证明；关闭／清除退役。操作账本成功保存后，无可见／就绪面板也评估
并保存奖项，不渲染隐藏页面。排队的用量 ID 仍检查供应商证据代次，插件 ID 检查独立
清除／活动代次，避免供应商证明退役误删本地操作证明。不新增持久字段或时间戳，
这尚不是跨宿主协调。

Claude 项目／会话／分支／工作流的无上限时间范围改为单次遍历计算，不用参数展开；
项目合并亦逐项追加。这消除了独立复现的 15 万条记录 V8 调用栈溢出，不改变去重
和数值计量口径。
密集工具结果追加也逐项合并结构事件：同一工具 ID 的结果 envelope 没有数量上限，
不能用数组参数展开。15 万条结果追加回归核对完整内容分析一致性，并保留暖刷新零正文读取。
Claude 刷新失败仅报告固定阶段／原因枚举与实际观测到的匿名计数；无法确认的计数和耗时
明确记为 `unknown`，区分读取／解析、聚合与内容分析。任意异常名称、正文、调用栈和路径
不进入日志。同一净化阶段／原因对在 Extension Host 生命周期内只报告一次，上限为 60 对；
既有已验证统计继续保持权威。
Claude 同一失败版本的自动重试等待 30／60／120／240／480 秒，再以 15 分钟封顶；
手动重试保留 5 秒最小冷却。该运行时门使用单调时钟，只保留当前一个版本，不增加
定时器、扫描器或持久化历史。来源／价格／解析权限变化可立即尝试；展示设置、watcher
突发与已排队刷新不能绕过。退役任务不能重置其他版本的退避，只有已验证的索引成功
才恢复普通暖刷新节奏。额度请求继续沿用独立策略。被冷却的手动重试仍提供简短失败
反馈，不替换已验证用量，也不读取日志正文。
Codex 主统计的谱系深度排序使用显式 DFS frame 与一个活跃路径集合，保留既有
memo 优先于循环检测、父分支顺序、孤立节点与根节点语义。不再递归、复制祖先集合或
展开父节点数组为函数参数。保存／重载后的 1 万层主统计重算回归保持零正文读取；
受限小图对照核对原排序语义。这与成就证据遍历是两条路径，不改变索引 schema、
fingerprint、前缀扣除或供应商 Token／成本／额度语义。

AI 密钥初始化在激活前完成一次协议兼容迁移。已有密钥而没有明确的 state／旧配置协议时，
保留旧 Anthropic 默认；明确的协议不变，新安装无密钥时采用 OpenAI 兼容默认。
旧 VS Code 配置只在通用设置迁移前读取，恢复默认后不会让过时协议重新生效。
`ccu.migrated.adviceDefaultFormat.v2.4.1` 只保存兼容协议枚举，不保存密钥、账户或地址，
普通恢复默认不会移除它；匿名库存及确认式「清除全部派生数据」的精确 allowlist 包含它。
不匹配的地址在准备请求前拒绝，不更换主机。迁移写入失败会清空本次激活已加载的密钥，
保留可恢复的 SecretStorage 内容，且不阻断用量页面。

Codex 发现仅限：

- `$CODEX_HOME/sessions/**/*.jsonl` 与 `sessions/**/*.jsonl.zst`
- `$CODEX_HOME/archived_sessions/**/*.jsonl` 与 `archived_sessions/**/*.jsonl.zst`
- 默认 `$CODEX_HOME`：`~/.codex`

绝不读取 `auth.json`、SQLite、config secret、keychain、浏览器状态或未知文件。
Raw path/session/parent ID 只留在本地 worker 的短期内存。磁盘只持久化 machine-salted 伪名 key、
按 day/model/effort/session 聚合的数字，以及上面所述的有界账户中性额度历史；绝不存 prompt、
response、command、tool arguments、raw line、raw path、账户名、凭据或原始 provider label。

2.5.0 中的 `.jsonl.zst` 是原始 JSONL 的无损 Zstd 存储，不是 LLM 摘要；
磁盘文件变小不会改变日志中的 token 计数。发现阶段拒绝符号链接与非普通文件。
同目录同 basename 的 `.jsonl` 优先于 `.jsonl.zst`，HMAC 文件键只剥离末尾 `.zst`。
这是规范来源选择，不声称两份表示字节相同；跨活动／归档区的副本仍通过完整清单的
lineage 去重。源文件只读，解压明文不落地。

Manifest `size`、parser 游标与 migration offset 继续使用解压后的字节坐标。
仅压缩记录新增 `compression: 'zstd'`、`storageSize`（物理字节数）与 `storageCtimeMs`；
`mtimeMs`／`dev`／`ino` 同样描述物理文件。schema 3 以附加字段保留这些指纹及
`compressionVerified: true` 持久标记，不提升 schema 版号；缺少这些字段的旧记录仍按 plain 处理。
该标记要求核验帧 EOF，不能仅凭 `offset === size` 建立。编码或物理版本变化须定向重读
历史，包括同 inode、同大小覆写后恢复 mtime。压缩文件移动且指纹变化时，也将目标键
标为 replacement；这些历史重整静默进行，不产生新的 live usage receipt。

确定性的正文解码失败以带版本的 `compressionFailure` 允许列表枚举及物理指纹
替换整份临时贡献，不保留 token、lineage、额度或日历证明。同一失败版本不反复解码
或写 checkpoint，也不视为 pending 工作，但 `failedFiles` 及未完成覆盖仍明确保留。
物理指纹／编码变化会作废失败状态；临时 I/O、取消和来源竞争仍可重试。
未知持久化失败版本须重新验证，不取得权威性。Header 发现错误仍使本轮刷新失败，
保留上次有效 snapshot。
逐文件额度观测须在压缩帧验证成功后才合入保留的全局历史，中途 draft checkpoint 不提升该证据。

压缩 frame 的 EOF 核验成功后，没有换行符的有效末条 JSON 记录只解析一次。
非法尾片段标记 `invalid-json`，超长末行标记 `oversized-jsonl-line`；这几种情况均将
游标推进到真实 decoded EOF，避免不可追加的尾部反复触发整帧重放。这些 JSONL
质量标记不豁免 frame 损坏，也不证明用量覆盖完整；active plain 日志的未终止行语义不变。

发现阶段通过只读句柄读取最多 18 字节 header，将 fstat 身份／大小与 lstat 核对，
并检查读取期间是否发生变化。Codec 只接受显式 Frame Content Size（FCS）、无 dictionary-ID
字段的单 frame；无效／未知大小、损坏、额外 frame、尾随字节或大小不符明确失败。
Header 本身不证明正文有效或读取完成。硬上限为解压数据 4 GiB、前缀重放 4 GiB、
物理数据 2 GiB、window 64 MiB。解码使用 [Node 原生 Zstd API](https://nodejs.org/api/zlib.html#zlibcreatezstddecompressoptions)，
22.x 从 22.15.0、23.x 从 23.8.0 提供，不新增依赖；以实际扩展宿主能力为准。
不支持的宿主明确报错并保留上次已验证 snapshot，不冒充完成。

同一物理版本已完整验证时，warm refresh 只核对 metadata／header，正文解压量为零。
Resume 从 frame 起点重放到 decoded 游标，丢弃的前缀计入工作量且可取消。
每轮最多允许首个历史压缩文件在 codec 硬上限内超出 soft byte budget，避免永久延后。
含压缩来源的回填最多使用两个 file-pass worker。数字索引仍是可重建缓存而非备份：
真正消失的来源会移除贡献，仍存在的压缩／归档表示则重新核对。
以上是实现契约，不是本机恢复或验收证据。

Advice 只消费已物化聚合，不重读 JSONL，也不重遍历保留的 records。远程默认为
aggregate-only；prompt sample 与可选 user context 需单独明确同意，并必须原样出现在精确请求预览中。
host 保管 Prepared 对象和 API key；webview 只拿到预览与不透明 handle。第二次点击才把同一 bytes 对象
发给用户配置的 BYOK endpoint。Feedback、comparable pair 与 comparison envelope 全部保持本地，
不接受 prompt、response、path、session、title、endpoint 或 credential 字段。

预览同时显示解析后的 HTTP(S) 目标地址、API 格式和模型。规范化可以追加协议路径，
但不更换配置的主机或代理前缀；不匹配的直接供应商协议拒绝发送。URL 中的凭据、查询
参数和片段在预览前拒绝，避免泄密。私有 WeakMap 完整性快照绑定全部目标元数据和
原始请求字节对象，重新计算公开 hash 不能授权改换目标。恢复普通默认设置保留
SecretStorage 中的密钥；删除密钥只能走另行确认的清除入口。

Advice 同意变更会立即作废 Prepared handle。host 的 pending-write 计数器在全部排队同意
写入结束前阻止新预览与发送；持久化失败保持关闭。聚合或提示授权撤回还会通过既有 network
owner 取消在途建议请求，与仅含用户草稿的 Optimizer 请求隔离。取消不能追回已传出的字节。

Machine salt 存在 VS Code `globalState`，不写入索引。Worker progress/result/error 与 diagnostics
只含匿名计数与时间，不含 path 或 ID。`refresh:` diagnostics 包含受限的 trigger、Claude
watcher/coalescing 计数，以及操作系统未提供 filename 的 quota watcher 事件数。`codex-index`
diagnostics 还会记录实际 refresh trigger、watcher/debounce 计数、历史 backfill 模式与
foreground/background worker profile；通用失败路径无法确认模式时明确记为 `unknown`，不作猜测。

分享预览只消费已经物化的聚合。分享卡在供应商生命周期内仅保留一份不可变 SVG、
不透明预览 ID 和允许字段配置摘要；修改控件后须重新接受预览，过期回复不能接受新的
草稿。导出在异步保存对话框之前捕获已确认 SVG，不重新计算不同内容，不保留产物
历史，也不额外联网或重读源日志。

热力图白名单配置为 `provider=claude|codex|both` 与 `metric=tokens|apiEquivalent`；
金额必须同时 `showAmounts=true`，否则规范化为 Token。`apiHeatmapDaily.ts` 在倒序
每日数组中以对数级日期键查找定位范围，只投影选中日期的 payload；调用方提供自然日
边界及分桶时区，不重新分桶、不读全量记录、不重算旧每日／模型成本、不调用 API。
仅对选中 Claude 型号行调用 `getCurrentEstimatePricing` 查询既有内存单价，每次投影
按型号缓存。通用未知型号 Sonnet 回退不证明已知覆盖；缺失必要组件单价为未定价，
显式零价有效，部分覆盖只计单价已知组件。运行期／家族价保持估算；旧 1 小时转
5 分钟缓存估算不等同于固定参考价定义。一般成本计量不变，最多物化 366 日。
相同日期行去重；冲突行撤回金额，仅保留最大观测 Token 下界，不相加重复总量。

金额使用当前每日浮动估算，不用成就固定参考价。Claude 保留当前后端／回退／覆盖价
估算；Codex 只保留精确已知型号的已定价 Token 子集。无数据、未定价活动、部分定价
及真实已定价零值彼此区分；来源覆盖不完整明确标示，已定价小计仅证明下界。
两者模式分别渲染 Claude／Codex 金额，不计算联合金额。隐藏金额恢复 Token 的颜色、
标签、标题／提示、元数据及 Markdown；Token 模式不查单价或每日金额／质量 getter。
产物身份只含白名单配置、数值质量、来源／价格／显示修订及内置币种元数据；内部签名不导出。

宿主保留一份不可变已接受产物、不透明预览 ID、文档身份及已物化来源引用。修改控件
即退役；请求序号及文档检查拒绝旧回复。来源、价格、时区、语言／币种／显示变更作废
接受状态；价格刷新待完成时不接受金额预览。导出在单次保存对话框前后复核，以已确认
SVG 原字节写入，不重新构建；复制 Markdown 也须有有效产物。不新增全量记录副本、导出历史、认证或联网。

`showWeeklyQuotaPace` 为默认 false 的 STATE 设置，Claude／Codex 共用。关闭时宿主
在来源 getter、时钟／缓存／client 访问及投影前退出；开启不会启用额度跟踪。开启后
仅消费既有成功原始缓存、原始 `observedAt` 及既有请求中已核验的账号 HMAC 信号，
只存内存，不把 profile／home／窗口标签当作账号证明。运行期所有者按响应保留原始
元数据，跨开关检查计数／重置／窗口连续性。账号／来源变化、下降或异常重置锁住不可信
状态，直到核验正常的七天滚动重置；重绘或恢复较高计数不能解除。当前 Codex 本地
日志快照始终为账号可信度未知，预测不可用。

纯公式为起点 = 重置减七天，参考 = 原始观测时刻的已过周期比例，预测 = 已用比例／
已过比例。因此已用 29%、已过 25% 得出 116%，偏离为 +4 个百分点。它代表账号级
周期平均消耗，包含其他设备／成员。前六小时显示样本不足；超过三十分钟或重置后
撤回预测。凭证失效把成功缓存时间清零即立即撤回。既有刷新回调发送绑定文档／供应商
的最小宿主补丁，暂停自动刷新仍可更新；客户端不乐观重绘预测。不新增请求、定时器、
历史扫描或持久字段。仪表盘与状态栏提示共用八语 `weeklyQuotaPaceCopy`，简短状态栏及自定义格式不变。

图鉴工具列先于展示柜／概览。小／中／大设置图鉴图标为 56／80／112 px，展示柜为
56／72／96 px，保留字号及点击区域。固定错误位于对应控件附近；控件禁用或消失
时回退到稳定摘要。既有图鉴／API 浏览器检查只证明浏览器行为，不证明原生／F5、
新 VSIX 或性能已经验证。
样式契约逐一核对实际使用的全部 47 个 VS Code 变量是否在对应注册 fixture 主题中声明，
注册的 null 颜色明确设为 CSS `initial`。未注册粉色变量改为其原有精确端点
`#d16ba5`，不改变配色／外观，也不表示更广的视觉重设计；自动检查不替代用户主观视觉审阅。

共享渲染器在大于 960 px 时让徽章栏按内容收缩，上限为
`2 * --achievement-overview-width + 8px`；下一目标栏填满剩余空间，两栏间距 16 px，
避免单个徽章仍占用半幅空白栏。960 px 及以下直接上下堆叠，间距 12 px。
辅助历史区统一放在两者之后。`achievementUiIcons` 为既有
分享／设置／筛选／尺寸／编辑／信息本地化标签提供装饰性内联 SVG 图标，汇总计数使用
紧凑标签。此次展示调整保留控件 ID、状态保存、资格判断及宿主／客户端消息协议。
早期数据证据仍在调查；此布局调整不证明数据已修复，也不新增运行期／原生验收结论。

待补齐／已过期卡片详情通过 I18n 八语文案说明日期、模型归属、金额及当前来源的要求，
说明旁带信息图标；这是范围要求，不是精确根因分类，不暴露原始来源／错误详情，
也不赋予新的证据效力。

`extension.ts` 的提前返回
仅当 `codexWorkerCancellationRequested` 为 true、结果为 `error`、
`failureCode === 'cancelled'` 且严格满足 `result.diagnostic?.failedFiles === 0` 时生效。
缺失计数仍是未知，继续走失败／证据撤销路径。零计数检查是防御性守卫：当前生产端
在终止取消／抛错时因没有最终逐文件诊断而报告 `failedFiles: 0`，并不证明取消前
没有文件失败。
宿主忽略该取消结果，不应用快照、不记录成功时间、不生成新的接纳收据；保留先前失败状态
及最后成功时间，待新的扫描成功后恢复处理。中断结果不授权新授奖，后续仅历史补认
仍按 import-only 处理，不生成实时日期或提示。`codexProvider.ts` 将所有错误结果的
清单标记为不完整。报告的非零／缺失失败计数、其他错误及非宿主拥有的取消仍走
失败／证据撤销路径。假设取消结果报告非零计数的测试只覆盖宿主防御分支，
不是当前生产端提供的失败文件统计。

有效的周期迁移检查点在 `tokenEventsSeen` 尚未达到继承前缀时也可续跑，前提是
`days` 为空。有界游标可跨批次、持久化／重启及取消继续推进。续跑本身不提升日期证据：
仍须通过完整前缀、EOF 及当前时区见证检查。已审阅回归覆盖分批、持久化、取消、
EOF 反例及未变化热刷新读取零正文。无日期、超大行或冲突证据仍保守保持待补齐，
此次修正不表示所有缺失日期均已解决。

综合活动仅在明确的活动可视化中把 Claude processed 与
Codex processed 相加；Codex cached input 与 reasoning 子集不会重复计入，也不声称成本、额度、
能力或生产率等价。Claude 分享卡与 Claude 热力图仍只属于 Claude。本地预览/导出不联网；
也不存在 GitHub authentication、profile、头像或名称查询。Claude 热力图发布是独立的显式动作，
继续遵守本地数据契约中的公开仓库探测，以及精确 branch/path 与创建／覆盖确认边界。

### Schema 3 索引契约

内部 schema 3 使用来源隔离的 `globalStorage` 文件 `codex-index-v1-<HMAC>.json`。
HMAC 绑定解析后的 Codex 日志目录、配置内的本地盐和数据时区；它只是本地缓存命名空间，
不是账号标识。VS Code 配置可能共用扩展存储目录，写入锁不能替代来源隔离。
旧 `codex-index-v1.json` 只作为只读迁移输入。当前白名单元数据清单须用相同盐证明每个
已保存文件键的归属，才能在独立索引锁与旧索引锁内沿用一次，不重读未变化日志。
无法证明归属（含已删除的键）、损坏、不支持或超过 256 MiB 的旧输入不沿用、不修改。
旧共享容器的顶层额度历史不可信，只接收已证明归属的逐文件观测，独立 P2 历史不清除。

新时区目标不存在时，可只读沿用文件名与当前清单均证明属于同一目录／盐的完整
兄弟检查点。最多检查 16 个较新候选，共享 256 MiB 读取预算，通过打开句柄固定原子
文件，不锁定或修改兄弟输入。主用量保持已索引，日期／小时由现有定向迁移补算。
已有目标（包括空重建检查点）优先；否则仍回退为旧单文件迁移。

重建只清理当前独立文件族，并写入空 schema-3 检查点防止旧缓存复活。清单与明确确认的
全部清除覆盖当前扩展存储中的精确 canonical、恢复和中断写入文件族，不处理锁、
相似文件名或源日志。路径、盐和命名空间指纹不进入诊断或导出。

持久化 DTO 使用明确的 allowlist：只能写入数字 aggregate、enum、
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
普通已验证单文件 append 从 tail 和受影响 aggregate group 开始。内容分析开启时，
不安全 truncate/replace/move/delete、来源顺序或 UUID 所有权变化可能按下文触发更广的
有序重放，不能保证只读变化文件。内容分析 contribution 与既有跨文件 response-identity
规则通过同一原子路径更新。内容分析维护
process-local 的已物化 accumulator，其 cutoff 与 `ClaudeDataLoader` 一样按毫秒连续滚动，而不是
用本地午夜近似。两个 loader 共用精确截止点 helper；完整 loader 只采样一次截止点，同时用于内容
分析与校准，避免解析期间时钟前移导致两者的窗口不一致。每个文件记录“已纳入 contribution 的最早
时间戳”，校准也记录最早 record，二者
作为 frontier：cutoff 在 frontier 之间移动不会改变结果，也无需读取正文；可证明整文件保留或
整文件过期时同样只用元数据 rebase。cutoff 跨过 frontier 时，只重读受影响的边界文件，以及
first-owner 可能变化的 UUID claimant。

已完整落盘但格式错误的 JSONL 行是稳定的忽略项，不会使 cutoff 元数据失效，也不会造成反复正文
读取。尚未完整的 JSON fragment 留在安全 cursor 之后等待续写；若 EOF 处已经是语法有效的 JSON，
即使没有末尾换行也会被接纳，后续 append 则必须先证明原 record 边界仍成立。内容分析关闭期间可以
在内存中按新时区重分普通用量；再次开启时，所有依赖日期的分析 contribution 必须先重建再发布，
因此跨 DST 切换也不会沿用旧时区的 day key。

普通的单文件 append 会先只读已验证 tail、应用变化文件 delta，并只重校准受影响的 canonical
response identity。聚合桶使用本次事务内的 copy-on-write 所有权，每个被触及的桶只复制一次，
而不是每条记录或每个模型标签复制一次；已发布的快照保持不可变。供应商 UI 同步错误在整个
Extension Host 生命周期内最多报告一次，不能中断 Codex 供应商工作或使刷新 drain 拒绝，
不能阻止 Claude 在新快照渲染失败后提交已经核验的索引，也不能让任一刷新 gate 永久占用。
仅含数字的结构摘要按全局文件顺序保留 legacy accumulator 的
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
Claude 目录发现使用独立于已安装 watcher 的 setup generation。同目录的重复 setup 不会
使现有事件或错误回调失效；更新的目录查询会淘汰旧查询。关闭 watcher 会同时使待完成
查询和已退役回调失效，避免失焦、关闭功能、切换来源或销毁后的迟到查询重新挂载。
如果失败的 credentials watcher 重试时 profile directory 暂时不存在，同一有界链只会在窗口聚焦且
额度跟踪仍启用时继续；目录重建后只恢复一个 watcher。只有 credentials watcher 接受操作系统省略
filename 的事件，因为这可能表示 credential file 被原子替换；该类事件仅以匿名计数进入诊断。

Codex 按多 GiB 本地历史设计：

- 发现与解析在 Extension Host 之外的 worker 中执行；
- recent-first 索引，支持 progress 与 cancel；未完成回填最多使用可用逻辑 CPU 的一半，
  并把本地 file-pass worker 上限设为 6（含压缩来源时最多 2 个）；索引完成后回到单一低功耗协调路径；
- 按顺序应用的 file-pass frontier 将执行中、缓冲中和应用中的结果总数限制在 worker 数的两倍，
  6 个 worker 时最多 12 个。慢文件或 checkpoint 会让空闲 worker 等待，避免保留整批结果；
  顺序、取消与续传行为保持不变；
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

已完成的控制状态遇到已验证快照覆盖率回退时会重新补齐，不要求代次变化或损坏标记。
用户暂停与失败退避仍保留。刷新失败只记录固定白名单错误代码，不记录任意报错、
路径或调用栈。

可选诊断 `tests/perf/measure-codex-worker-lifecycle.cjs` 使用新建的合成 home、
索引和 lease 目录，运行已编译的生产索引／file-pass worker。三轮分别请求成就小时
证明回填 ON/OFF，构造明确不完整的旧 period 投影，每组执行 20 次零正文暖刷新，
再在真实请求期间 dispose。这个参数是回填请求，不是完整成就／界面开关；旧版本
可能没有实现它。诊断观察线程退出、线程共享的进程 RSS、按 isolate 采样的 heap／
external 和 V8 序列化消息字节代理，不保留消息或 heap dump。冻结资源／时间保护
只终止测试所属 worker；`--out` 可选择不可变编译版本进行对照。这些是 Node
诊断，不是原生 Extension Host、面板生命周期、多窗口或 Windows OOM 验收证据。

原生诊断启动另有可选安全守卫 `tests/native/isolation.cjs`：从测试所属根目录
派生十个不同目录，显式包括 user/extensions/shared、agent 资料和合成
Claude/Codex home。在任何设置种子写入前核验 Test 模式、Extension Host 的
实际存储／配置路径与无符号链接逃逸；随后调用者才可在该测试 context 的
globalState 中先关闭额度／建议相关网络入口，再激活生产代码。仅设置
settings.json 不能控制目录中以 globalState 为存储的设置。写入失败即停止。
纯 `nativeTestIsolation.test.ts` 不启动 Code；该守卫不是沙箱、凭据扫描器，
也不是原生激活成功或安装 VSIX／F5 的实测证明。测试文件继续排除出 VSIX。

tests/native/prepare.cjs 可在全新临时根目录中复制不改动的编译模块／assets，
并生成六份有界合成日志。测试专用 main 先执行真实 context 守卫，再激活生产
扩展；原生 runner 使用真实 API 验证刷新／面板／dispose。显式 CLI 参数还选择
内存 SecretStorage，并关闭最近目录记录、崩溃上报和实验功能。准备器单测不启动
Code。这个小语料开发宿主诊断不代表最终 VSIX、像素、手动 F5、长测、多窗口或
Windows 验收；正常实例前后状态核对和后台启动要求见辅助模块 README。

每周 API 等效价值历史只从已经聚合的 Token 用量生成。最新有效的重置观测用于锚定互不重叠的七天
展示窗口；没有观测时，仅已用历史按 UTC 周一至周一的自然周分组。真实的额度用量比例观测可以支持
历史窗口的总额度近似，而不只支持当前窗口。Codex 的 account-wide `codex` series 会纳入同一 home
中所有符合条件的本地文件，因为文件键不是账号身份。重置时间如果偏离七天网格，则按观测时间映射到
对应展示窗口；来源不确定、重置漂移或日切片跨边界时降低可信度并标注为近似。
每条用量仍只进入一个窗口。

每个有效周期内观测按“截至该观测时点的本地已定价用量”，而不是截至当前时刻的全部用量，
生成候选：

```text
candidateFullEquivalent = pricedUsedEquivalentThroughObservedAt / usedFraction
```

只接受正的本地等价值和 `0 < usedFraction <= 1`。多个候选按定价覆盖、观测可信度／账号
归属、边界标记和观测时点做加权中位数。当前周期即使账号归属不明，也可保留低可信本地估算：
把同一本地 home／窗口的合格 Codex 用量与最近适用的额度观测簇对照，不拆分为各账号事实。
当前重叠／竞争系列强制低可信。只有多个不同 `seriesKey` 映射到同一已结束 Codex
展示窗口时才撤下总额／未用估算；单一未归属或带账号歧义标记的系列，结束后仍可保留低可信估算。

有有效汇总候选时，展示总等价值不低于当前已定价的已用等价值，未用等价值为两者非负差。
若累计已知已用等价值已经超过汇总候选，则保留已用值作为低可信下界，撤下未用值，
不伪造零。这里比较的是累计值而非仅观测后的新增量，候选是加权中位数而非单个样本。
无有效候选时只显示已用。这些数值是 API 等价估算，不是实付金额、官方账号余额
或可继续使用多少订阅额度的承诺。它不是 `showWeeklyQuotaPace` 按已过时间比例计算的预测，
后者的可信账号／窗口规则不变。

维护者于 2026-10-11 明确保留这个现有当前周期估算方式。准确按账号归属计算属于后续
多账户兼容范围，2.5.0 未实现或承诺该能力。

v2.3.0 不推断 20、100 或 200 美元的订阅档位。本地 Codex 日志没有可靠的账号与套餐身份，
后续比较必须采用用户明确选择的 opt-in 账号映射，不能猜测后绑定价格。

## 发布不变量

- 默认 **Squash and merge**：开发期间保留本地提交及验证证据，最终每个 PR 在 `main`
  落为一个 squash commit。仅维护者显式例外可使用普通 merge；不为追溯应用此原则而
  改写已发布 Git 历史。
- 根据变更风险执行 strict TypeScript、red-green TDD、完整 `node:test`、F5 smoke test
  和安装 VSIX smoke test。
- CI 的标准浏览器门禁使用四个隔离分片，各一个 worker、35 分钟时限。稳定的
  `UI Test` 汇总以 `if: always()` 运行，仅在全部分片成功时通过；失败、取消或跳过
  任一分片均按失败处理。`Node Tests` 与 `Release Package` 检查名称不变，打包仍依赖
  Node 及汇总 UI 门禁成功。此配置本身不证明某次 CI 运行已通过。
- 用户可见字符串覆盖 `en`、`de-DE`、`zh-TW`、`zh-CN`、`ja`、`ko`、`pt-BR`、`id`；
  九份 README（首页加八份语言版）同步。
- dormant 的 preparation/experiment 模块与仅供评审的 v2.3.1 文档必须保持不可从生产 command graph 到达，并排除出 VSIX。
- 不手工修改 `package.json` 版本。发布已审阅的 Release Drafter draft 后才创建 tag，
  publish workflow 再从 tag 写入包版本。
- 通过合并贡献者原 PR，或经授权先修改该 PR 分支再合并，保留贡献归属。
