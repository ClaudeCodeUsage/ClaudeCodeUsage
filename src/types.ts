export interface ClaudeUsageRecord {
  timestamp: string;
  version?: string;
  message: {
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    model?: string;
    id?: string;
  };
  costUSD?: number;
  requestId?: string;
  isApiErrorMessage?: boolean;
  // --- Fields populated by the loader from each record's source .jsonl file ---
  // (a single .jsonl file == a single Claude Code conversation/session)
  _sessionId?: string;
  _projectName?: string;
  _projectPath?: string;
  _gitBranch?: string;
  // Human-readable conversation title (what `claude --resume` shows),
  // harvested from `custom-title` / `ai-title` / legacy `summary` log lines.
  _sessionTitle?: string;
  // Encoded project directory the session file lives in (where the session
  // was started), e.g. "d--Jiaming-My-Proj". Stable per session, unlike the
  // per-record cwd which wanders as work moves between folders.
  _projectDirEncoded?: string;
  // Synthetic marker record for one genuine user prompt (zero usage).
  // messageCount counts these, so "Messages" means what users typed.
  _isUserPrompt?: boolean;
  // Truncated text of a user prompt (only on _isUserPrompt records) — lets the
  // "costliest messages" panel show what triggered an expensive turn.
  _promptText?: string;
  // --- Sub-agent attribution (set when the source file sits under a
  // `subagents/` directory; see V2.1-WORKFLOW-SPEC §2) ---
  // Workflow run id ("wf_…") when the file sits under subagents/workflows/.
  _workflowId?: string;
  // Sub-agent log file basename without extension, e.g. "agent-a1b2c3".
  _agentId?: string;
  // From the sibling agent-*.meta.json: "workflow-subagent", "Explore",
  // "general-purpose", … — "unknown" when the meta file is missing/bad.
  _agentType?: string;
  // Human-readable workflow name, derived at load time from the session's
  // workflows/scripts/<name>-wf_<id>.js file (resolved once per refresh).
  _workflowName?: string;
  // First user message of a sub-agent log = the task dispatched to that
  // agent (truncated). Gives the per-agent drill-down a readable label.
  _agentTask?: string;
  // Authoritative skill / plugin attribution stamped on the usage line by
  // Claude Code ≥2.1 (`attributionSkill` / `attributionPlugin`). When present,
  // the attribution panel weights skills/plugins by the exact usage of these
  // lines instead of the <command-name>/Skill-tool heuristic.
  _skill?: string;
  _plugin?: string;
}

export interface UsageData {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  // Cost split by token type (the four sum to totalCost).
  costBreakdown: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  };
  messageCount: number;
  modelBreakdown: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cost: number;
    count: number;
  }>;
}

export interface SessionData extends UsageData {
  sessionStart: Date;
  sessionEnd: Date;
}

// Per-conversation breakdown: one entry per Claude Code session (.jsonl file).
export interface SessionUsage {
  sessionId: string;
  // Conversation title (from the session's summary line), when available.
  title?: string;
  projectName: string;
  projectPath: string;
  startTime: Date;
  endTime: Date;
  data: UsageData;
  // Largest context window observed in the session
  // (input + cache read + cache creation tokens of a single request).
  peakContextTokens: number;
}

// One expensive assistant turn, for the Content tab's "costliest messages"
// panel. A single billed response, with the user prompt that triggered it and
// the skill/plugin/model in play — so a costly turn can be understood, not just
// counted. (Content-analysis theme, alongside AI advice + the optimizer.)
export interface CostlyMessage {
  timestamp: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string; // full model id (e.g. "claude-opus-4-8"), not a family
  skill?: string;
  plugin?: string;
  prompt?: string; // truncated text of the triggering user prompt
  projectName: string;
  sessionId: string;
}

// Per-project breakdown: usage aggregated across every session of a project.
export interface ProjectUsage {
  projectName: string;
  projectPath: string;
  sessionCount: number;
  firstSeen: Date;
  lastSeen: Date;
  data: UsageData;
}

// A group of projects. Projects are grouped by their enclosing git repository
// when one exists, otherwise by their top-level project folder. Projects whose
// paths differ only in case are merged into a single child.
export interface ProjectGroup {
  groupName: string;
  groupPath: string;
  isGitRepo: boolean;
  projectCount: number;
  sessionCount: number;
  firstSeen: Date;
  lastSeen: Date;
  data: UsageData;
  children: ProjectUsage[];
}

// One slice of the content-consumption analysis (a category, or a single tool).
export interface ContentSlice {
  key: string;
  estimatedTokens: number;
  charCount: number;
  count: number;
}

// Estimated thinking vs. total assistant-output tokens for one session/day.
// Share = thinking / assistantTotal. Estimated from text length.
export interface ThinkingShare {
  thinking: number;
  assistantTotal: number;
  // True when a thinking block was present but its text was empty (raw CoT not
  // exposed — Fable 5, Opus 4.8 default). We know thinking happened but can't
  // size it, so the UI shows "hidden" rather than a misleading 0%.
  hiddenThinking?: boolean;
}

// One skill / slash-command invocation, detected in the logs (assistant
// `Skill` tool_use blocks and <command-name> echo markers). estTokens is the
// text-length estimate of the matching tool result / command output.
export interface SkillUse {
  name: string;
  sessionId: string;
  day: string; // local "YYYY-MM-DD"
  ts: number; // epoch ms of the invocation (0 when unparsable)
  estTokens: number;
}

// Estimated breakdown of which conversation content consumes tokens. Token
// figures are estimated from character counts, so treat them as approximate —
// the relative shares are the reliable signal.
export interface ContentAnalysis {
  categories: ContentSlice[];
  toolResultBreakdown: ContentSlice[];
  totalEstimatedTokens: number;
  // Recent user prompts (last 30 days), for the AI-advice feature. Each carries
  // its working directory so advice can be scoped to a project.
  recentPrompts: { cwd: string; text: string }[];
  // Thinking-token share per session id and per local day ("YYYY-MM-DD"),
  // last 30 days (analysis window).
  thinkingBySession: Record<string, ThinkingShare>;
  thinkingByDay: Record<string, ThinkingShare>;
  // Raw skill invocations (last 30 days); scoping/grouping happens in
  // getUsageAttribution.
  skillUses: SkillUse[];
  // Calibration anchors (Phase 8): the EXACT billed token totals over the same
  // analysis window, from each record's message.usage. The category estimates
  // (text-length-derived) are scaled to these so absolute figures match
  // billing while within-side shares stay as estimated. Output side anchors the
  // assistant categories; input side (input + cache-creation) anchors the
  // user/tool-result categories. Undefined if calibration couldn't run.
  calibration?: {
    realOutputTokens: number;
    realInputSideTokens: number;
  };
}

// Scope of the usage-attribution panel. day = today, week = last 7 days,
// month = last 30 days; session/project narrow to one session / one project.
export interface AttributionScope {
  kind: 'day' | 'week' | 'month' | 'session' | 'project';
  sessionId?: string;
  projectPath?: string;
}

// One row of an attribution table (a skill, agent type, plugin or model).
// For skills/plugins, share = cost-weight of the session's usage at or after
// the skill's invocation ("usage that came from this skill being active",
// official /usage methodology) — entries overlap, they are not a breakdown.
export interface AttributionEntry {
  key: string;
  share: number; // 0..1 of the scope's weight
  count: number;
  estTokens?: number; // skills/plugins only: injected-prompt size estimate
}

// The "what's contributing to your usage?" panel, modelled on the official
// /usage screen but multi-provider and with more scopes. Characteristics are
// independent signals (weighted by estimated cost), NOT a breakdown.
export interface UsageAttribution {
  totalCost: number;
  totalTokens: number;
  characteristics: {
    largeContext: number;   // share of usage at >150k context
    longSessions: number;   // share from sessions with ≥8 distinct active hours
    subagentHeavy: number;  // share from sessions >50% sub-agent weight
    workflows: number;      // share from workflow (wf_*) records
  };
  skills: AttributionEntry[];
  subagents: AttributionEntry[];
  plugins: AttributionEntry[];
  models: AttributionEntry[];
}

export interface ExtensionConfig {
  refreshInterval: number;
  dataDirectory: string;
  language: string;
  decimalPlaces: number;
  // Decimals for compact token display only (1.2M / 345.6K).
  tokenDecimalPlaces: number;
  compactNumbers: boolean;
  // IANA timezone name (e.g. "Asia/Hong_Kong") used for date display, or ''
  // to use the system timezone. Useful for users in devcontainers or
  // sandboxes whose system zone doesn't match their actual zone.
  timezone: string;
  // Show today's cost item in the status bar.
  showCost: boolean;
  // Show the current session's context-window fill in the status bar.
  showContext: boolean;
  // Manual context-window size override in tokens (0 = auto-detect).
  contextWindowOverride: number;
  // First status-bar item: today's cost, this month's cost, or today's total token count.
  statusBarMetric: 'cost' | 'monthly-cost' | 'tokens';
  // Opt-in: append the weekly Opus limit (opus:NN%) to the quota item (PR #38).
  showOpusWeekly: boolean;
  // Quota status-bar display (V2.2): inline reset countdown; 5h-only.
  showResetInStatusBar: boolean;
  quotaFiveHourOnly: boolean;
  // Fetch real 5-hour / weekly limit utilisation via Claude Code's OAuth session.
  usageLimitTracking: boolean;
  // LLM "usage advice" feature (OpenAI-compatible endpoint, e.g. DeepSeek).
  adviceApiKey: string;
  adviceApiUrl: string;
  adviceModel: string;
  // Reasoning effort for advice models that support it ('', 'high', 'max').
  adviceReasoningEffort: string;
  // Free-text background about the user/project; when set, the advice ends
  // with a "Personalised for this project" section calibrated against it.
  adviceUserContext: string;
  // Advice/optimizer transport (v2.1 Phase 9). backend: 'subscription' reuses
  // the Claude Code OAuth session (no key, prefers haiku); 'api' uses a key.
  // apiFormat: 'anthropic' (default) or 'openai'-compatible.
  adviceBackend: 'subscription' | 'api';
  adviceApiFormat: 'anthropic' | 'openai';
  adviceSubscriptionModel: string;
  // How many days of prompts/content the advice analysis samples (default 30).
  advicePromptWindowDays: number;
  // Run the (CPU-heavy) content/prompt-token analysis. When false the Content
  // tab is hidden and the analysis is skipped during refresh.
  enableContentAnalysis: boolean;
  // How the Projects tab groups working directories:
  //   - 'git'    group by enclosing git repository (default; current behaviour)
  //   - 'folder' group by the heuristic top-level project folder only
  //   - 'flat'   no grouping; every working directory is its own row
  projectGroupingMode: 'git' | 'folder' | 'flat';
  // Watch log files and refresh within ~1.5s of each new message. When false
  // the extension falls back to the interval-based refresh, which is calmer
  // but lags behind real-time.
  fileWatching: boolean;
  // Skip the dashboard webview on auto-refreshes (status bar still updates).
  // Use when the constantly-reloading dashboard interferes with reading
  // numbers while an agent is actively writing.
  dashboardAutoRefresh: boolean;
}

export interface ModelPricing {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
}

export type SupportedLanguage = 'en' | "de-DE" | 'zh-TW' | 'zh-CN' | 'ja' | 'ko' | 'pt-BR';

// One multi-agent run. Two kinds (verified on disk 2026-06-12):
//  - a dynamic-workflow run (wf_<id> dir; trigger word "ultracode"), or
//  - an ad-hoc sub-agent batch: ≥2 generic Task-tool agents in one session
//    with no wf_ dir — what ultracode produces when the dynamic-workflow
//    feature isn't engaged (observed with proxy/DeepSeek routing).
export interface WorkflowUsage {
  workflowId: string;          // "wf_fcfc35cc-5d5" or "adhoc:<sessionId>"
  name: string;                // derived human name, or the id when unknown
  // True for ad-hoc batches (no wf_ dir; grouped per session).
  isAdHoc?: boolean;
  sessionId: string;           // parent session
  projectPath: string;
  projectName: string;
  startTime: Date;             // min record timestamp across agents
  endTime: Date;               // max record timestamp
  agentCount: number;
  data: UsageData;             // aggregated across all agent files
  // Main-session orchestration spend that bracketed this run: same session,
  // non-sub-agent records within [startTime, endTime]. For native-Claude runs
  // the expensive Opus/Fable orchestration lives HERE (the main thread), not in
  // the cheap-model agent files — so without this a run's true cost/models are
  // invisible. Heuristic (timestamp-bracketing); undefined when none, zero, or
  // ambiguous (the window overlaps another run in the same session).
  orchestration?: UsageData;
  agents: {
    agentId: string;
    // Task text dispatched to the agent (first user message, truncated).
    task?: string;
    data: UsageData;
    startTime: Date;
    endTime: Date;
  }[];
}

// Per-git-branch usage aggregate.
export interface BranchUsage {
  branch: string;
  projectName: string;
  projectPath: string;
  sessionCount: number;
  lastSeen: Date;
  data: UsageData;
}

// Context-window fill of the current conversation, estimated from the
// session's most recent log record (mirrors what /context shows).
export interface ContextWindowInfo {
  contextTokens: number;
  windowTokens: number;
  model: string;
  // True when the window size is a conservative guess (unrecognised / proxied
  // model and no user override) rather than a known value — surfaced as a "~"
  // marker so the percentage isn't presented as exact.
  estimated: boolean;
  // Input-side composition of the latest request — lets the tooltip show a
  // /context-style breakdown instead of a single percentage.
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// OAuth credentials stored by Claude Code at ~/.claude/.credentials.json or in
// the macOS Keychain.
export interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
}

// One limit window from api.anthropic.com/api/oauth/usage.
export interface ClaudeUsageLimit {
  utilization: number; // 0-100
  resets_at: string; // ISO timestamp
}

// Response from the OAuth usage endpoint (mirrors what /usage shows).
export interface ClaudeApiUsageResponse {
  five_hour?: ClaudeUsageLimit;
  seven_day?: ClaudeUsageLimit;
  seven_day_opus?: ClaudeUsageLimit;
}
