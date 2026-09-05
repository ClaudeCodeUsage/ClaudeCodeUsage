# Codex Provider 基础设计

**日期：** 2026-07-17
**状态：** 维护者已于 2026-07-17 批准；v2.2.1 之后开始实施
**参考：** [CodexBar](https://github.com/steipete/CodexBar)
**英文原版：** [English](2026-07-17-codex-provider-foundation-design.md)

## 目标

将 Codex 作为只读且显式分离的用量来源加入系统，同时不削弱 Claude 数据的准确性，也不暗示系统能够提供尚未支持的成本／配额精度。架构必须能够支持未来的 provider，并把 provider 特有语义封装在 adapter 内部。

## 产品决策

beta 期间，现有扩展仍保持 Claude Code Usage 的产品名称。内部将获得 provider-neutral core，并在实验性 flag 后加入 Codex adapter。dashboard 提供 Claude、Codex 和 Compare 三种视图。后续 adoption review 再决定是采用统一产品名称，还是发布两个共享同一 core 的轻量 Marketplace 扩展。

## 架构

```text
ClaudeLogAdapter ─┐
                  ├─ NormalizedUsageEvent ─ Aggregator ─ Claude | Codex | Compare
CodexAdapter ─────┘

ClaudeLimitSource ─┐
                   ├─ ProviderLimitSnapshot ─ provider-specific quota UI
CodexLimitSource ──┘
```

历史 token 事实、时间点配额快照和货币估算属于不同契约。它们不会合并为一个大型 snapshot。

```ts
interface NormalizedUsageEvent {
  provider: 'claude' | 'codex';
  sourceKind: 'local-jsonl' | 'otel' | 'cli-rpc' | 'oauth';
  schemaVariant: string;
  timestamp: number;
  sessionId: string;
  parentSessionId?: string;
  projectPath?: string;
  model?: string;
  tokens: {
    inputTotal: number;
    uncachedInput?: number;
    cacheRead?: number;
    cacheWrite?: number;
    outputTotal: number;
    reasoningOutput?: number;
  };
  cost?: {
    usd: number;
    basis: 'reported' | 'api-equivalent-estimate';
    pricingVersion: string;
  };
  confidence: 'exact' | 'estimated' | 'partial' | 'unknown';
  qualityFlags: string[];
}
```

`ProviderLimitSnapshot` 存储观测时间、来源、窗口、重置时间和置信度。配额值绝不参与跨设备或跨 provider 求和。

## Provider 语义

- Claude 的 input、cache-read 和 cache-write bucket 互斥且可相加。
- Codex 的 `cached_input` 包含在 input 内，reasoning output 包含在 output 内。绝不重复相加。
- 重复出现的 Codex 累计计数器使用 lineage／high-water 逻辑，而不是逐行求和。
- fork 和 subagent session 保留 parent baseline 与 parent identifier。
- 缺失 parent 和未知 schema variant 会产生 quality flag；UI 明确降级为 partial／unknown，而不是静默虚构精度。
- source product 通过 adapter／path／schema 识别，而不是通过 model name 识别。

## Codex 摄取阶段

### 实验性本地 adapter

- 在 `CODEX_HOME` 下发现带版本的本地 session／rollout 文件，但不读取 `auth.json`、内部账户数据库或浏览器状态。
- 为 CLI、IDE/Desktop、resume、archive、fork/subagent、compaction、truncation 和 interleaved counter 维护 fixture。
- 把本地 rollout 格式视为不稳定接口，并设置 schema guard 和诊断。
- 使用 v2.2.1 的逐文件索引以及 single-flight scan executor。

### 可选的受支持遥测路径

OpenAI 的 opt-in OTel 输出是未来的高级数据源。它默认保持禁用、保持关闭 prompt logging，并要求用户明确配置本地 collector 或 bridge。在用户体验达到实用水平之前，它不会取代零配置的本地 beta。

## UI 与聚合

Compare 只能聚合语义兼容的指标：

- total tokens；
- output tokens；
- sessions；
- active time。

provider 特有视图保留：

- cache composition 与 efficiency；
- quota windows；
- monetary cost 或 API-equivalent estimates；
- message／turn counts；
- source-specific workflow diagnostics。

订阅用量绝不显示为实际美元支出。未知 model 的价格显示为不可用，而不是回退到猜测的 family price。

## 采用的 CodexBar 经验

CodexBar 作为架构参考使用，不会被整体复制：

- provider descriptor 与有序 fetch strategy；
- 每个 source 的 outcome 与 diagnostics；
- 逐文件 `mtime + size + parsed contribution` 缓存；
- single-flight／coalesced expensive scan；
- 分离的本地 token／cost pipeline 与远程 quota pipeline；
- 显式 confidence 与 quality flag；
- fork／interleaved-counter fixture。

具体参考包括 CodexBar 的 [provider authoring guide](https://github.com/steipete/CodexBar/blob/main/docs/provider.md)、[refresh loop](https://github.com/steipete/CodexBar/blob/main/docs/refresh-loop.md)，以及 [issue #1392](https://github.com/steipete/CodexBar/issues/1392) 中的大型数据集性能调查。后者也提醒我们不能臆测最终热点：在其最大规模的 profile 之一中，占主导的是 metadata validation，而不是 JSON parsing。

不采用其中的 browser-cookie scraping、private backend call、直接处理 auth-file、大型统一 snapshot，以及隐含的 subscription-cost assumption。任何后续实质性的代码移植都必须保留 CodexBar 的 MIT notice。

## Opt-in 跨设备同步

跨设备同步只安排在 Codex beta 和 normalized schema 稳定之后，暂定为 v2.4.x。

- 使用 VS Code 内置的 GitHub authentication provider 进行身份认证；不在扩展中嵌入 OAuth client secret。
- GitHub authentication 与 storage 相互分离。优先采用专用 sync service；private Gist 最多只作为高级实验，不作为默认数据库。
- 只同步以 device、provider、day 和 model 为键的聚合数据。
- 绝不上传 prompt、response、raw log、path、credential、raw session ID 或本地 username。
- 使用带有 `schemaVersion`、pseudonymous device ID、revision 和 deletion tombstone 的幂等 upsert。
- quota sync 只存储最新观测，绝不跨设备求和。
- consent 默认关闭，并提供首次上传预览、数据导出、远程删除、设备撤销以及即时禁用开关。
- retention、encryption、account deletion、endpoint ownership、incident response 和 privacy copy 是发布门槛，不是发布后的补做事项。

## 版本顺序

1. v2.2.1：稳定扫描机制与仓库／流程安全。
2. v2.3：引入 provider contract，并在不改变结果的前提下重构 Claude adapter。
3. v2.3.x：发布只读 Codex beta 和 Compare 视图。
4. v2.4：发布一组小型、provider-neutral 的本地成就。
5. v2.4.x：在 privacy 和 deletion control 通过审阅后，预览 opt-in、经 GitHub 认证的聚合同步。
6. v2.5+：将 telemetry、dynamic pricing 和显式安全写入分别作为独立项目评估。

## Codex beta 验收标准

- fixture 覆盖每个受支持的 Codex surface 和 lifecycle event。
- 增量扫描与冷扫描产生一致的 normalized total。
- provider total 与其 source-native total 一致，或通过 quality flag 明确降级。
- 不重复计算 cached-input 或 reasoning-output。
- 当 sync、telemetry 和 remote quota 均关闭时，不发起网络请求。
- 不访问 credential file。
- Compare 视图绝不合计 cost 或 quota。
- 诊断导出不包含 prompt、raw path 或 raw session identifier。

## 非目标

- 立即更改产品名称；
- 为不受支持的 Codex quota 或 subscription cost 提供功能对等；
- 自动读取 OpenAI credential；
- 将 raw log 同步到云端；
- 将 GitHub Gist 作为生产同步数据库；
- 在 provider 语义稳定前实现成就功能。
