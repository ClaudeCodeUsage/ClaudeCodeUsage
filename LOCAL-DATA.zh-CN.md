# 本地数据与隐私

Claude Code Usage 采用本地优先设计。插件只读取供应商拥有的本地用量日志，
并保留快速刷新、重置识别和额度估算所必需的有界派生状态；API 等效成本始终
只是估算，不是账单。

本文是 v2.3.x 开发线面向用户的数据清单。v2.3.1 字段级规范见
[`docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.zh-CN.md`](docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.zh-CN.md)。

## 插件读取和保留什么

| 数据类别 | 来源 | 插件保留的内容 | 保留与清除 | 远程交互 |
|---|---|---|---|---|
| Claude 用量记录 | Claude Code 本地 `projects/**/*.jsonl` | 运行时用量记录和内存中的逐文件索引；仅在启用内容分析时保留有界提示样本 | 窗口重载/退出即释放。本地数据控制绝不触碰源日志；另行启用的“会话操作”可把一个精确确认的日志移入系统回收站（可恢复） | 默认无；只有用户另行预览并发送建议请求时才可能包含获准内容 |
| Codex 用量记录 | `$CODEX_HOME/sessions/**/*.jsonl` 与 `archived_sessions/**/*.jsonl` | 版本化增量索引：匿名文件键、偏移量、数值用量、日期、模型/effort 和已净化结构聚合 | 保留到重建、明确清除、schema 替换或宿主移除 | 无 |
| Codex 标题 | 仅 `$CODEX_HOME/session_index.jsonl` | 流式读取 `id → thread_name` 供运行时显示；标题不写入索引 | 仅运行时 | 无 |
| 额度观测 | Claude 官方额度响应或 Codex 结构化 rate-limit 事件 | 供应商、本机匿名账号 epoch、观测/重置时间、周期、已用/剩余比例、匿名窗口标识、来源、可信度和质量标志 | 保留不超过 180 天；边界保护压缩后每个供应商/账号/周期最多 512 条；可单独或随全部派生数据清除 | 启用时 Claude 额度查询会访问 Anthropic；过期 token 会经 Anthropic 刷新并写回原凭证来源。Codex 额度证据只来自本地 |
| 设置与 UI 偏好 | 用户选择 | 类型化设置、标签页/筛选、有限后台任务状态、分享呈现方式、分享卡未应用的控件草稿、热力图标题/范围/隐私预览，以及可选显示币种预设 | 保留到重置、清除或卸载；普通 VS Code 设置可能参与 Settings Sync | 插件不主动传输，也不查询汇率 |
| 分享目标 | 用户输入的 GitHub 目标 | 单个版本化 `ccu.heatmapDestination.v1` 对象，包含可选 `owner/repository/path`；不保存 GitHub 凭据 | 保留到重置分享偏好 | 仅在用户明确发布并确认精确目标后发生；即使保存此便利偏好失败，成功写入仍会如实报告 |
| 建议证据 | 本地派生聚合与明确反馈 | 粗粒度观察、建议、评分、暂停、可比任务指标、覆盖率和版本 | 有界本地台账；可独立清除 | 默认不发送；只有单独确认后才发送精确预览过的请求 |
| 建议 API Key | 用户自备密钥 | 仅存于 VS Code SecretStorage | 保留到清除密钥或全部派生数据 | 只作为用户明确配置端点的授权凭据 |

## 绝不缓存什么

- 插件自有派生存储中不会缓存 OAuth access/refresh token、cookie、authorization
  header 或 GitHub 凭据。为查询 Claude 额度而刷新 OAuth token 时，Claude
  自有的凭证文件或 macOS 钥匙串项目可能会被更新。
- VS Code SecretStorage 之外的 API key。
- 完整账号标识、邮箱、显示名或订阅名称。账号连续性只用本机 HMAC
  fingerprint 或隔离的未归属 epoch。
- 原始提示/响应正文、工具参数、命令、完整 CLI 输出、源日志绝对路径、
  仓库 remote 或持久化线程标题。

启用 Claude 额度跟踪后，插件用所选 Claude 资料的现有 access token 查询
`api.anthropic.com/api/oauth/usage`。如该 token 过期，会把现有 refresh token
发送到 `console.anthropic.com/v1/oauth/token`，并将新 access token 写回该资料的
凭证文件或 macOS 钥匙串项目。这与可选的自备密钥 AI 建议分开；后者不会使用
Claude 订阅凭据。

不同匿名账号 fingerprint 不会合并。如果本地 Codex 日志无法证明属于同一账号
和同一窗口，仪表盘只显示已用 API 等效价值，并说明为何不能声称账号级未用额度。

显示币种换算只作用于呈现层。定价、聚合、持久化、排序和比较仍全部以 USD 为基准。
插件只保存一个通过校验的币种预设代码，并使用日期为 2026-09-09 的内置参考汇率；
汇率不可调整，也不会联网查询。换算后的估算值统一标记 `≈`，供应商原生金额
（例如真实 usage credits）继续按其上报币种显示。币种兑 USD 数值由
[欧洲央行欧元参考汇率](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)
换算得到。

## 分享工作台与导出

预览优先的分享工作台直接复用已物化的供应商聚合，不会再次扫描日志，也不会新增第二套
统计缓存。记住的呈现方式只是本地枚举 `ccu.sharing.template`：综合活动热力图、Claude
分享卡或 Claude token 热力图。`enableShareCard` 是唯一可见的开关。退役的 `showHeatmap`
仍保留在 catalog 中，以便执行有界清除并维持一个版本的兼容性，但不再生成第二个面板。
显式旧命令的协调仅存在于运行时：host 把 provider 生命周期内单调递增的 revision 与唯一
live intent 分开保存，并在 Webview ACK 精确 revision 后删除 live intent。浏览器存储不保存
命令 revision。

分享卡的项目或会话范围可能包含原始本地路径或会话标识，因此这些值只保留在内存中，
Webview 关闭即消失。浏览器存储只保留不具识别性的呈现控件，例如范围、主题、显示区块、
数字格式和所选呈现方式。

```text
Claude processed = input + cache creation + cache read + output
Codex processed  = input total + output total
综合活动量 = Claude processed + Codex processed
```

Codex 的 cached input 已包含在 input total 中，reasoning 已包含在 output total 中，
因此均不得重复相加。综合活动量只代表本地 Token 活动，不代表生产率、账单、模型能力
或两个供应商的能力等价。

本地 SVG 与 Markdown 导出只含有界标题、所选日期范围、每日 Claude/Codex/综合聚合、
标签和免责声明；不含账号、项目、线程标题、路径、提示或日志内容。
Claude 分享卡和 Claude token 热力图只消费 Claude 聚合，不暗示 Codex 具有等价字段。
预览与本地导出严格不联网，也不请求 GitHub authentication、profile、头像或名称数据。

直接发布到 GitHub 是独立的可选动作，且绝不在后台运行。它仅请求 `public_repo`，
先验证仓库公开性和默认分支，再要求用户确认精确的
`owner/repository/branch/path` 以及创建或覆盖动作。私有仓库应改用本地 SVG +
Markdown，不会静默索取更宽权限。GitHub 接受写入后，插件会先如实报告成功；若原子化
目的地偏好保存失败，再另行显示警告。

## 清除与迁移

命令面板提供独立维护动作：重建 Codex 派生索引、清除额度历史、清除建议数据、重置
UI 或分享偏好、移除 BYOK 密钥。“清除全部扩展派生数据”会先列出精确目标。这些动作
不进入仪表盘设置页，以保持插件设置简洁；同时均不删除 Claude/Codex 源日志或供应商
拥有的凭据。

清除全部额度历史时，插件会在同一个跨进程 lease 内把额度存储原子替换为一个合法的
空 schema-2 文档，并只删除该文件族中精确匹配的隔离/中断写入文件。若隔离数据或尚未
完成的旧版迁移无法安全归属到 provider/账号，范围清除会安全拒绝；用户可再明确选择
清除全部额度历史。

“清除全部”按已发布的精确 setting/state 名称清单删除，不会泛删所有
`ccu.setting.*`；未知或未来键会保留。任何修改之前，插件先检查当前可见配置作用域；
若发现 VS Code 已无法安全更新的未注册旧设置，整个操作会在零删除状态下停止，并提示
手动移除。激活期排队写入会先排空，删除后再验证精确后置条件。若 Webview 未能确认其
白名单浏览器状态已清除，插件会保存一个不含数据值的待重试动作，在下次打开面板时重放，
而不会误报成功。分享工作台内部的重置按钮也复用同一条 host request → 带 request-id 的
client reset → ACK 路径；浏览器存储删除失败会明确报错，且只有 allowlist 删除成功后才应用
默认值。

这个清除边界与另行选择启用的“会话操作”相互独立。后者只有在用户针对单个 Claude
会话日志完成模态确认后，才会把它移入系统回收站（可恢复）；它不会参与“清除全部”。

v2.3.1 会先验证并原子迁移已知旧版额度/配置状态，成功后才移除旧副本。损坏或未来
schema 会安全失败；替代文件通过验证前不会覆盖旧的有效文件。卸载后宿主可能保留
扩展存储，因此明确的清除命令才是可靠删除路径。

VS Code 只允许当前运行的插件检查 Global、当前 Workspace 及当前已打开的 Workspace
Folder 配置作用域。只存在于关闭工作区中的旧值会继续保留，直到打开该工作区后再次
运行清除控制（或手动删除该设置）。

## 已知限制

- 从未出现在官方响应或本地结构化事件中的重置无法重建；只有日粒度的 Codex 证据
  会降低边界可信度。
- 同一 Codex home 可能包含多个登录。归属重叠不清时只显示已用值，绝不虚构账号拆分。
- API 等效价值按当前已知公开 API 单价和定价覆盖率估算，不是供应商账单或订阅价格。
- 源日志保留期由 Claude Code 和 Codex 控制，不由本插件控制。
