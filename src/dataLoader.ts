import * as fs from 'fs';
import { readFile } from 'node:fs/promises';
import * as os from 'os';
import * as path from 'path';
// Removed tinyglobby dependency - using native fs instead
// Removed zod dependency - using native validation instead
import { calculateCostBreakdown } from './pricing';
import {
  AttributionEntry,
  AttributionScope,
  BranchUsage,
  ClaudeUsageRecord,
  ContentAnalysis,
  ContextWindowInfo,
  ContentSlice,
  ProjectGroup,
  ProjectUsage,
  SessionData,
  SessionUsage,
  SkillUse,
  ThinkingShare,
  UsageAttribution,
  UsageData,
  WorkflowUsage,
} from './types';

// Constants
const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';
const CLAUDE_PROJECTS_DIR_NAME = 'projects';
const DEFAULT_CLAUDE_CODE_PATH = '.claude';
const USAGE_DATA_GLOB_PATTERN = '**/*.jsonl';
const USER_HOME_DIR = os.homedir();

// XDG config directory
const XDG_CONFIG_DIR = process.env.XDG_CONFIG_HOME || path.join(USER_HOME_DIR, '.config');
const DEFAULT_CLAUDE_CONFIG_PATH = path.join(XDG_CONFIG_DIR, 'claude');

// Native file search function to replace tinyglobby
async function findJsonlFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function searchRecursively(currentDir: string) {
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await searchRecursively(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore permission errors and continue
      console.warn(`Cannot read directory ${currentDir}:`, error);
    }
  }

  await searchRecursively(dir);
  return files;
}

// Identify usage records by structural shape only.
//
// Previously we dropped any record whose secondary fields had an unexpected
// type (e.g. `model` is null, `requestId` is a number). That cost us records
// from proxies and from new Claude Code features (xhigh / ultracode /
// workflow) that occasionally write atypical field types. Now we accept any
// record that has the minimum it takes to count tokens — timestamp + the
// numeric token fields — and downstream code is responsible for coercing the
// optional fields safely.
//
// The companion function `validationDropReason` lets the loader log *why* a
// record was rejected so users can spot format drift without us guessing.
function validateUsageRecord(data: any): data is ClaudeUsageRecord {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.timestamp !== 'string') return false;
  if (!data.message || typeof data.message !== 'object') return false;
  if (!data.message.usage || typeof data.message.usage !== 'object') return false;
  const usage = data.message.usage;
  // We require both token fields to be numbers — they are the whole point of
  // the record. Anything else is best-effort: a missing model, a null
  // requestId, an isApiErrorMessage that's "true" (string) — they get
  // accepted now, and the aggregators treat the value as 0/undefined.
  if (typeof usage.input_tokens !== 'number') return false;
  if (typeof usage.output_tokens !== 'number') return false;
  return true;
}

function validationDropReason(data: any): string {
  if (!data || typeof data !== 'object') return 'not-an-object';
  if (typeof data.timestamp !== 'string') return 'timestamp-missing-or-non-string';
  if (!data.message || typeof data.message !== 'object') return 'message-missing';
  if (!data.message.usage || typeof data.message.usage !== 'object') return 'usage-missing';
  if (typeof data.message.usage.input_tokens !== 'number') return 'input_tokens-not-a-number';
  if (typeof data.message.usage.output_tokens !== 'number') return 'output_tokens-not-a-number';
  return 'other';
}

// --- Content-consumption analysis helpers ---
// These estimate which conversation content uses tokens. Token figures are
// derived from character counts, so they are approximate; the relative shares
// between categories are the dependable signal.

interface AnalysisBucket {
  tokens: number;
  chars: number;
  count: number;
}

interface AnalysisAcc {
  cat: Record<string, AnalysisBucket>;
  tools: Record<string, AnalysisBucket>;
  toolIdToName: Record<string, string>;
  seenUuids: Set<string>;
  cutoffMs: number;
  prompts: { cwd: string; text: string }[];
  // Estimated thinking vs. total assistant-output tokens, per session and per
  // local day ("YYYY-MM-DD") — feeds the thinking-share column / Today line.
  thinkingBySession: Record<string, ThinkingShare>;
  thinkingByDay: Record<string, ThinkingShare>;
  // Skill / slash-command invocations (capped) + tool_use_id → skillUses index
  // so the matching tool result's size can be attributed to the skill.
  skillUses: SkillUse[];
  skillByToolId: Record<string, number>;
}

// cutoffMs: ignore log lines older than this (0 = no cutoff).
function newAnalysisAcc(cutoffMs: number): AnalysisAcc {
  return {
    cat: {},
    tools: {},
    toolIdToName: {},
    seenUuids: new Set<string>(),
    cutoffMs,
    prompts: [],
    thinkingBySession: {},
    thinkingByDay: {},
    skillUses: [],
    skillByToolId: {},
  };
}

const MAX_SKILL_USES = 5000;

// Session-management slash commands: invoking them says nothing about what
// the usage was for, but the at-or-after attribution rule would credit them
// with everything that follows. Real skills (from the Skill tool) and
// substantive commands like /code-review are never filtered.
const TRIVIAL_COMMANDS = new Set([
  '/model', '/clear', '/compact', '/help', '/config', '/status', '/cost',
  '/doctor', '/login', '/logout', '/exit', '/resume', '/usage',
  '/usage-credits', '/extra-usage', '/context', '/memory', '/goal',
  '/todos', '/release-notes', '/fast', '/effort', '/permissions', '/hooks',
  '/mcp', '/agents', '/export', '/rewind', '/init', '/add-dir', '/ide',
]);

// Local "YYYY-MM-DD" key for a log line's timestamp ('' when unparsable).
function localDayKey(timestamp: unknown): string {
  const ts = typeof timestamp === 'string' ? new Date(timestamp) : null;
  if (!ts || isNaN(ts.getTime())) {
    return '';
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}`;
}

// Collect an actual user prompt (capped + truncated) for the AI-advice feature.
function collectPrompt(acc: AnalysisAcc, cwd: string, text: string): void {
  const trimmed = text.trim();
  if (trimmed.length < 4) {
    return;
  }
  // Agent-framework scaffolding is not something the user typed: interrupt
  // notices and kebab-case XML-ish wrappers (<command-name>, <system-reminder>,
  // <local-command-stdout>, …). Plain HTML a user pastes (<div>, <p>) survives.
  if (/^\[Request interrupted/i.test(trimmed) || /^<[a-z][a-z0-9]*(-[a-z0-9]+)+[\s>/]/i.test(trimmed)) {
    return;
  }
  acc.prompts.push({ cwd, text: trimmed.slice(0, 2500) });
  if (acc.prompts.length > 600) {
    acc.prompts.shift();
  }
}

// Detect a slash-command echo (<command-name>/foo</command-name>…) and record
// it as a skill use; the echo block's size approximates the injected prompt.
function collectCommandUse(acc: AnalysisAcc, text: string, sessionId: string, timestamp: unknown): void {
  if (acc.skillUses.length >= MAX_SKILL_USES || !text.startsWith('<command-name>')) {
    return;
  }
  const m = text.match(/^<command-name>([^<]{1,80})<\/command-name>/);
  if (!m) {
    return;
  }
  const name = m[1].trim();
  if (TRIVIAL_COMMANDS.has(name.toLowerCase())) {
    return;
  }
  const ts = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  acc.skillUses.push({
    name,
    sessionId,
    day: localDayKey(timestamp),
    ts: isNaN(ts) ? 0 : ts,
    estTokens: estimateTokens(text),
  });
}

// Rough token estimate from text length (CJK characters are denser than ASCII).
function estimateTokens(text: string): number {
  const len = text.length;
  if (len === 0) {
    return 0;
  }
  if (len > 200000) {
    return Math.round(len / 4);
  }
  let cjk = 0;
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x3000 && code <= 0x9fff) {
      cjk++;
    }
  }
  return Math.round(cjk / 1.5 + (len - cjk) / 4);
}

// Flatten a content value (string, or array of blocks) to plain text.
function blockText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    let text = '';
    for (const block of content) {
      if (typeof block === 'string') {
        text += block;
      } else if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
        text += (block as { text: string }).text;
      }
    }
    return text;
  }
  return '';
}

function addToBucket(map: Record<string, AnalysisBucket>, key: string, text: string): void {
  if (!text) {
    return;
  }
  if (!map[key]) {
    map[key] = { tokens: 0, chars: 0, count: 0 };
  }
  map[key].tokens += estimateTokens(text);
  map[key].chars += text.length;
  map[key].count += 1;
}

// Accumulate one raw log line into the content analysis.
// isSubagentFile: lines from sub-agent / workflow logs still count toward the
// token-consumption buckets, but their "user" lines are agent-framework task
// dispatches — never harvest them as prompt samples for the AI-advice feature.
// sessionId: parent session of the source file (for the thinking-share maps).
function analyzeLine(parsed: any, acc: AnalysisAcc, isSubagentFile = false, sessionId = ''): void {
  if (!parsed || typeof parsed !== 'object') {
    return;
  }
  // Scope the analysis to a recent window so it reflects current habits.
  if (acc.cutoffMs > 0) {
    const ts = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : NaN;
    if (!isNaN(ts) && ts < acc.cutoffMs) {
      return;
    }
  }
  const uuid = typeof parsed.uuid === 'string' ? parsed.uuid : null;
  if (uuid) {
    if (acc.seenUuids.has(uuid)) {
      return;
    }
    acc.seenUuids.add(uuid);
  }

  const message = parsed.message;
  if (!message || typeof message !== 'object') {
    return;
  }
  const role = message.role || parsed.type;
  const content = message.content;
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : '';

  if (role === 'assistant') {
    // Thinking share: estimated thinking tokens vs. all assistant output
    // (text + thinking + tool-call JSON), per session and per local day.
    const trackThinking = (thinkingTokens: number, totalTokens: number): void => {
      if (totalTokens <= 0) {
        return;
      }
      const add = (map: Record<string, ThinkingShare>, key: string): void => {
        if (!key) {
          return;
        }
        if (!map[key]) {
          map[key] = { thinking: 0, assistantTotal: 0 };
        }
        map[key].thinking += thinkingTokens;
        map[key].assistantTotal += totalTokens;
      };
      add(acc.thinkingBySession, sessionId);
      add(acc.thinkingByDay, localDayKey(parsed.timestamp));
    };
    if (Array.isArray(content)) {
      let thinkingTokens = 0;
      let totalTokens = 0;
      for (const block of content) {
        if (!block || typeof block !== 'object') {
          continue;
        }
        if (block.type === 'text' && typeof block.text === 'string') {
          addToBucket(acc.cat, 'assistantText', block.text);
          totalTokens += estimateTokens(block.text);
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          addToBucket(acc.cat, 'assistantThinking', block.thinking);
          const est = estimateTokens(block.thinking);
          thinkingTokens += est;
          totalTokens += est;
        } else if (block.type === 'tool_use') {
          if (typeof block.id === 'string' && typeof block.name === 'string') {
            acc.toolIdToName[block.id] = block.name;
            // Skill invocations: remember the tool_use_id so the matching
            // tool result's size can be attributed to the skill.
            const skillName = (block.input as { skill?: unknown } | undefined)?.skill;
            if (block.name === 'Skill' && typeof skillName === 'string' && acc.skillUses.length < MAX_SKILL_USES) {
              acc.skillByToolId[block.id] = acc.skillUses.length;
              const skillTs = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : NaN;
              acc.skillUses.push({
                name: skillName,
                sessionId,
                day: localDayKey(parsed.timestamp),
                ts: isNaN(skillTs) ? 0 : skillTs,
                estTokens: 0,
              });
            }
          }
          const inputJson = JSON.stringify(block.input || {});
          addToBucket(acc.cat, 'toolCalls', inputJson);
          totalTokens += estimateTokens(inputJson);
        }
      }
      trackThinking(thinkingTokens, totalTokens);
    } else if (typeof content === 'string') {
      addToBucket(acc.cat, 'assistantText', content);
      trackThinking(0, estimateTokens(content));
    }
  } else if (role === 'user') {
    // Prompt samples must be genuine top-level user messages: nothing from
    // sub-agent logs, meta lines (command echoes) or sidechain dispatches.
    const allowPromptSample = !isSubagentFile && !parsed.isMeta && !parsed.isSidechain;
    if (typeof content === 'string') {
      addToBucket(acc.cat, 'userPrompts', content);
      collectCommandUse(acc, content, sessionId, parsed.timestamp);
      if (allowPromptSample) {
        collectPrompt(acc, cwd, content);
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') {
          continue;
        }
        if (block.type === 'tool_result') {
          const text = blockText(block.content);
          addToBucket(acc.cat, 'toolResults', text);
          addToBucket(acc.tools, acc.toolIdToName[block.tool_use_id] || 'unknown', text);
          // The injected skill prompt comes back as the Skill tool's result —
          // its size is the best available estimate of the skill's footprint.
          const skillIdx = acc.skillByToolId[block.tool_use_id];
          if (skillIdx !== undefined && acc.skillUses[skillIdx]) {
            acc.skillUses[skillIdx].estTokens += estimateTokens(text);
          }
        } else if (block.type === 'text' && typeof block.text === 'string') {
          addToBucket(acc.cat, 'userPrompts', block.text);
          collectCommandUse(acc, block.text, sessionId, parsed.timestamp);
          if (allowPromptSample) {
            collectPrompt(acc, cwd, block.text);
          }
        }
      }
    }
  }
}

function finalizeAnalysis(acc: AnalysisAcc): ContentAnalysis {
  const toSlices = (map: Record<string, AnalysisBucket>): ContentSlice[] =>
    Object.keys(map)
      .map((key) => ({ key, estimatedTokens: map[key].tokens, charCount: map[key].chars, count: map[key].count }))
      .sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  const categories = toSlices(acc.cat);
  return {
    categories,
    toolResultBreakdown: toSlices(acc.tools),
    totalEstimatedTokens: categories.reduce((sum, c) => sum + c.estimatedTokens, 0),
    recentPrompts: acc.prompts.slice(-300),
    thinkingBySession: acc.thinkingBySession,
    thinkingByDay: acc.thinkingByDay,
    skillUses: acc.skillUses,
  };
}

export class ClaudeDataLoader {
  static getClaudePaths(): string[] {
    const paths: string[] = [];
    const normalizedPaths = new Set<string>();

    // Check environment variable first (supports comma-separated paths)
    const envPaths = (process.env[CLAUDE_CONFIG_DIR_ENV] ?? '').trim();
    if (envPaths !== '') {
      const envPathList = envPaths
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '');
      for (const envPath of envPathList) {
        const normalizedPath = path.resolve(envPath);
        if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isDirectory()) {
          const projectsPath = path.join(normalizedPath, CLAUDE_PROJECTS_DIR_NAME);
          if (fs.existsSync(projectsPath) && fs.statSync(projectsPath).isDirectory()) {
            if (!normalizedPaths.has(normalizedPath)) {
              normalizedPaths.add(normalizedPath);
              paths.push(normalizedPath);
            }
          }
        }
      }
    }

    // Add default paths if they exist
    const defaultPaths = [DEFAULT_CLAUDE_CONFIG_PATH, path.join(USER_HOME_DIR, DEFAULT_CLAUDE_CODE_PATH)];

    for (const defaultPath of defaultPaths) {
      const normalizedPath = path.resolve(defaultPath);
      if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isDirectory()) {
        const projectsPath = path.join(normalizedPath, CLAUDE_PROJECTS_DIR_NAME);
        if (fs.existsSync(projectsPath) && fs.statSync(projectsPath).isDirectory()) {
          if (!normalizedPaths.has(normalizedPath)) {
            normalizedPaths.add(normalizedPath);
            paths.push(normalizedPath);
          }
        }
      }
    }

    return paths;
  }

  static async findClaudeDataDirectory(customPath?: string): Promise<string | null> {
    if (customPath) {
      const projectsPath = path.join(customPath, CLAUDE_PROJECTS_DIR_NAME);
      if (fs.existsSync(projectsPath) && fs.statSync(projectsPath).isDirectory()) {
        return customPath;
      }
      return null;
    }

    const claudePaths = this.getClaudePaths();
    return claudePaths.length > 0 ? claudePaths[0] : null;
  }

  /** Locate the .jsonl log file(s) and sub-agent dir for a session id. */
  static async findSessionFiles(sessionId: string, dataDirectory?: string | null): Promise<string[]> {
    if (!sessionId || /[\\/]/.test(sessionId) || sessionId === 'unknown') { return []; }
    const roots = new Set<string>(this.getClaudePaths());
    if (dataDirectory) { roots.add(dataDirectory); }
    const fileName = sessionId + '.jsonl';
    const matches: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === sessionId) {
            matches.push(full); // session's sub-agent container — remove whole
          } else {
            await walk(full);
          }
        } else if (e.isFile() && e.name === fileName) {
          matches.push(full);
        }
      }
    };
    for (const root of roots) {
      const projectsDir = path.join(root, CLAUDE_PROJECTS_DIR_NAME);
      if (fs.existsSync(projectsDir)) {
        await walk(projectsDir);
      }
    }
    return matches;
  }

  static async loadUsageRecords(
    dataDirectory?: string,
    options?: { analyzeContent?: boolean; windowDays?: number; log?: (line: string) => void }
  ): Promise<{ records: ClaudeUsageRecord[]; contentAnalysis: ContentAnalysis | null }> {
    const analyzeContent = options?.analyzeContent !== false; // default true
    // How many days back the content analysis (and its prompt sample) looks.
    // Configurable via advice.promptWindowDays; defaults to 30.
    const windowDays = Math.min(365, Math.max(1, Math.round(options?.windowDays ?? 30)));
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const log = options?.log;
    try {
      const claudePaths = dataDirectory ? [dataDirectory] : this.getClaudePaths();
      const allFiles: string[] = [];

      for (const claudePath of claudePaths) {
        const claudeDir = path.join(claudePath, CLAUDE_PROJECTS_DIR_NAME);
        if (fs.existsSync(claudeDir)) {
          const files = await findJsonlFiles(claudeDir);
          allFiles.push(...files);
        }
      }

      const sortedFiles = await this.sortFilesByTimestamp(allFiles);
      // hash → records[] index. Some proxies (mimo / CC Switch) write two
      // records per message: a tokens=0 placeholder when streaming starts,
      // and the real values when the response finishes. Both records share
      // the same messageId, so they hash identically. We keep whichever
      // record has the higher total token sum (issue #18).
      const processedHashes = new Map<string, number>();
      const records: ClaudeUsageRecord[] = [];
      // sessionId → conversation title. Current Claude Code writes
      // `custom-title` (user-set) and `ai-title` (auto) lines; older versions
      // wrote `summary`. A custom title always wins over an AI one.
      const aiTitleBySession: Record<string, string> = {};
      const customTitleBySession: Record<string, string> = {};
      // Content analysis (last `windowDays` days, default 30) is optional —
      // skipped when the user disables it via claudeCodeUsage.enableContentAnalysis.
      const analysis = analyzeContent ? newAnalysisAcc(Date.now() - windowMs) : null;
      // Per-refresh caches for sub-agent attribution lookups: agent type from
      // agent-*.meta.json (keyed by meta path) and workflow display name from
      // the session's workflows/scripts dir (keyed by workflow id).
      const agentTypeCache = new Map<string, string>();
      const workflowNameCache = new Map<string, string>();
      let fileIndex = 0;
      // Diagnostic counters so the "Show Diagnostic Logs" command can explain
      // how many records were seen / rejected / deduped without speculation.
      const stats = {
        files: sortedFiles.length,
        linesScanned: 0,
        parseErrors: 0,
        rejected: {} as Record<string, number>,
        replacedByDedup: 0,
        skippedByDedup: 0,
        kept: 0,
        userPrompts: 0,
        // model name → { count, totalTokens }. totalTokens lets us tell whether
        // records exist but are all zeros (proxy-placeholder only).
        models: {} as Record<string, { count: number; tokens: number }>,
      };

      for (const file of sortedFiles) {
        try {
          const content = await readFile(file, 'utf-8');
          const lines = content
            .trim()
            .split('\n')
            .filter((line) => line.trim() !== '');

          // Each .jsonl file is one Claude Code conversation/session.
          const sessionInfo = this.parseSessionInfo(file);
          // Sub-agent / workflow logs: count their usage, but never harvest
          // user prompts from them (their "user" lines are agent-framework
          // task dispatches, not something the user typed).
          const isSubagentFile = /[\\/]subagents[\\/]/.test(file);
          // Sub-agent attribution, derived from the file path — NOT from cwd:
          // worktree-isolated agents have a cwd pointing at a temporary git
          // worktree (see docs/V2.1-WORKFLOW-SPEC.md §2.2).
          let agentInfo: {
            agentId: string;
            agentType: string;
            workflowId?: string;
            workflowName?: string;
            task?: string;
          } | null = null;
          if (isSubagentFile) {
            const agentId = path.basename(file, '.jsonl');
            const agentType = await this.readAgentType(file, agentTypeCache);
            const wfMatch = file.match(/[\\/]subagents[\\/]workflows[\\/](wf_[^\\/]+)[\\/]/);
            if (wfMatch) {
              const workflowId = wfMatch[1];
              const workflowName = await this.resolveWorkflowName(file, workflowId, workflowNameCache);
              agentInfo = { agentId, agentType, workflowId, workflowName };
            } else {
              agentInfo = { agentId, agentType };
            }
          }

          for (const line of lines) {
            stats.linesScanned += 1;
            try {
              const parsed = JSON.parse(line) as unknown;

              // Feed every line into the content analysis (not only usage records).
              if (analysis) {
                analyzeLine(parsed, analysis, isSubagentFile, sessionInfo.sessionId);
              }

              // Conversation title lines. Keep the last seen of each kind —
              // titles get refreshed as the chat evolves.
              const lineAny = parsed as Record<string, unknown>;
              if (lineAny.type === 'ai-title' && typeof lineAny.aiTitle === 'string') {
                aiTitleBySession[sessionInfo.sessionId] = lineAny.aiTitle;
              } else if (lineAny.type === 'custom-title' && typeof lineAny.customTitle === 'string') {
                customTitleBySession[sessionInfo.sessionId] = lineAny.customTitle;
              } else if (lineAny.type === 'summary' && typeof lineAny.summary === 'string') {
                // Legacy location (older Claude Code versions).
                aiTitleBySession[sessionInfo.sessionId] = lineAny.summary;
              }

              // A sub-agent log's first user message is the task that was
              // dispatched to the agent — capture it (truncated) as the
              // agent's display label for the Workflows drill-down.
              if (agentInfo && agentInfo.task === undefined) {
                const role =
                  (lineAny.message as { role?: unknown } | undefined)?.role ?? lineAny.type;
                if (role === 'user') {
                  const content = (lineAny.message as { content?: unknown } | undefined)?.content;
                  const text =
                    typeof content === 'string'
                      ? content
                      : Array.isArray(content)
                        ? content
                            .filter(
                              (b: { type?: unknown; text?: unknown }) =>
                                b?.type === 'text' && typeof b.text === 'string'
                            )
                            .map((b: { text: string }) => b.text)
                            .join(' ')
                        : '';
                  const trimmed = text.replace(/\s+/g, ' ').trim();
                  if (trimmed.length > 0) {
                    agentInfo.task = trimmed.slice(0, 200);
                  }
                }
              }

              // Genuine user prompts become synthetic zero-usage records so
              // "Messages" counts what the user actually typed (not API
              // calls). Excludes meta lines (command output), sidechain
              // dispatches and anything inside sub-agent logs.
              if (
                !isSubagentFile &&
                (lineAny.type === 'user' || (lineAny.message as { role?: unknown } | undefined)?.role === 'user') &&
                !lineAny.isMeta &&
                !lineAny.isSidechain &&
                typeof lineAny.timestamp === 'string'
              ) {
                const content = (lineAny.message as { content?: unknown } | undefined)?.content;
                const text =
                  typeof content === 'string'
                    ? content
                    : Array.isArray(content)
                      ? content
                          .filter((b: { type?: unknown; text?: unknown }) => b?.type === 'text' && typeof b.text === 'string')
                          .map((b: { text: string }) => b.text)
                          .join('')
                      : '';
                if (text.trim().length > 0 && !this.isSyntheticUserText(text)) {
                  const prompt: ClaudeUsageRecord = {
                    timestamp: lineAny.timestamp,
                    message: { usage: { input_tokens: 0, output_tokens: 0 } },
                    _isUserPrompt: true,
                    _sessionId: sessionInfo.sessionId,
                    _projectDirEncoded: sessionInfo.projectPath,
                  };
                  const pcwd = lineAny.cwd;
                  if (typeof pcwd === 'string' && pcwd.trim() !== '') {
                    prompt._projectPath = pcwd;
                    prompt._projectName = this.lastPathSegment(pcwd);
                  } else {
                    prompt._projectPath = sessionInfo.projectPath;
                    prompt._projectName = sessionInfo.projectName;
                  }
                  const pBranch = lineAny.gitBranch;
                  prompt._gitBranch = typeof pBranch === 'string' && pBranch.trim() !== '' ? pBranch : undefined;
                  records.push(prompt);
                  stats.userPrompts += 1;
                  continue;
                }
              }

              if (!validateUsageRecord(parsed)) {
                const reason = validationDropReason(parsed);
                stats.rejected[reason] = (stats.rejected[reason] || 0) + 1;
                continue;
              }

              const data = parsed;
              const uniqueHash = this.createUniqueHash(data);

              // Tag the record with the session/project it came from.
              // Prefer the real working directory (`cwd`) recorded in the log line
              // over the lossy, dash-encoded folder name when it is available.
              const record = data as ClaudeUsageRecord;
              record._sessionId = sessionInfo.sessionId;
              record._projectDirEncoded = sessionInfo.projectPath;
              const cwd = (parsed as { cwd?: unknown }).cwd;
              if (typeof cwd === 'string' && cwd.trim() !== '') {
                record._projectPath = cwd;
                record._projectName = this.lastPathSegment(cwd);
              } else {
                record._projectPath = sessionInfo.projectPath;
                record._projectName = sessionInfo.projectName;
              }
              const gitBranch = (parsed as { gitBranch?: unknown }).gitBranch;
              record._gitBranch = typeof gitBranch === 'string' && gitBranch.trim() !== '' ? gitBranch : undefined;
              // Authoritative skill/plugin attribution: Claude Code ≥2.1 stamps
              // these on the assistant usage line itself (far better than the
              // <command-name> heuristic). See ARCHITECTURE "Log-format facts".
              const attrSkill = (parsed as { attributionSkill?: unknown }).attributionSkill;
              const attrPlugin = (parsed as { attributionPlugin?: unknown }).attributionPlugin;
              record._skill = typeof attrSkill === 'string' && attrSkill.trim() !== '' ? attrSkill : undefined;
              record._plugin = typeof attrPlugin === 'string' && attrPlugin.trim() !== '' ? attrPlugin : undefined;
              if (agentInfo) {
                record._agentId = agentInfo.agentId;
                record._agentType = agentInfo.agentType;
                record._workflowId = agentInfo.workflowId;
                record._workflowName = agentInfo.workflowName;
                record._agentTask = agentInfo.task;
              }

              if (uniqueHash && processedHashes.has(uniqueHash)) {
                // Duplicate — keep whichever record has more tokens. This
                // resolves the proxy "placeholder + real value" pair from
                // issue #18 without needing to detect the proxy.
                const existingIndex = processedHashes.get(uniqueHash)!;
                if (this.tokenSum(record) > this.tokenSum(records[existingIndex])) {
                  records[existingIndex] = record;
                  stats.replacedByDedup += 1;
                } else {
                  stats.skippedByDedup += 1;
                }
                continue;
              }

              records.push(record);
              stats.kept += 1;
              const modelName =
                typeof record.message?.model === 'string' ? record.message.model : '<no-model>';
              if (!stats.models[modelName]) {
                stats.models[modelName] = { count: 0, tokens: 0 };
              }
              stats.models[modelName].count += 1;
              stats.models[modelName].tokens += this.tokenSum(record);
              if (uniqueHash) {
                processedHashes.set(uniqueHash, records.length - 1);
              }
            } catch (parseError) {
              stats.parseErrors += 1;
              console.warn(`Failed to parse line in ${file}:`, parseError);
            }
          }
        } catch (fileError) {
          console.warn(`Failed to read file ${file}:`, fileError);
        }

        // Yield to the event loop every so often so a large history does not
        // block the extension host (keeps VS Code and Claude Code responsive).
        if (++fileIndex % 25 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      // Attach harvested conversation titles (custom beats AI). A post-pass
      // because a session's title lines and its usage records can sit in
      // different files (sub-agent logs share the parent session's id).
      for (const record of records) {
        if (!record._sessionId) {
          continue;
        }
        const title = customTitleBySession[record._sessionId] || aiTitleBySession[record._sessionId];
        if (title) {
          record._sessionTitle = title;
        }
      }

      if (log) {
        const rejectedSummary = Object.entries(stats.rejected)
          .map(([reason, count]) => `${reason}=${count}`)
          .join(', ') || 'none';
        // List models sorted by kept-record count desc, with each entry's
        // total token sum. If a model shows up with N records but 0 tokens
        // it means every record for that model was a proxy zero-placeholder
        // and the real values were never written — that's the missing-Flash
        // story.
        const fmt = (n: number): string =>
          n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
          : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K`
          : `${n}`;
        const modelsSummary = Object.entries(stats.models)
          .sort(([, a], [, b]) => b.count - a.count)
          .map(([name, m]) => `${name}=${m.count}/${fmt(m.tokens)}`)
          .join(', ') || 'none';
        log(
          `loader: ${stats.files} files, ${stats.linesScanned} lines | ` +
            `kept=${stats.kept}, user-prompts=${stats.userPrompts}, ` +
            `dedup-replaced=${stats.replacedByDedup}, ` +
            `dedup-skipped=${stats.skippedByDedup}, parse-errors=${stats.parseErrors} | ` +
            `rejected: ${rejectedSummary}`
        );
        log(`loader: models seen: ${modelsSummary}`);
      }
      const contentAnalysis = analysis ? finalizeAnalysis(analysis) : null;
      if (contentAnalysis) {
        // Calibration anchors (Phase 8): exact billed token totals over the
        // analysis window (same cutoff the analyzer used), so the text-length
        // category estimates can be scaled to billing reality.
        const calibrationCutoff = Date.now() - windowMs;
        let realOutputTokens = 0;
        let realInputSideTokens = 0;
        for (const r of records) {
          if (r._isUserPrompt) {
            continue;
          }
          const t = Date.parse(r.timestamp);
          if (isNaN(t) || t < calibrationCutoff) {
            continue;
          }
          const u = r.message.usage;
          realOutputTokens += u.output_tokens || 0;
          realInputSideTokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        }
        if (realOutputTokens > 0 || realInputSideTokens > 0) {
          contentAnalysis.calibration = { realOutputTokens, realInputSideTokens };
        }
      }
      return { records, contentAnalysis };
    } catch (error) {
      console.error('Error loading usage records:', error);
      return { records: [], contentAnalysis: null };
    }
  }

  private static createUniqueHash(data: any): string | null {
    const messageId = data.message?.id;
    const requestId = data.requestId;

    if (!messageId && !requestId) {
      return null;
    }

    return `${messageId || 'no-msg'}-${requestId || 'no-req'}`;
  }

  /** Total tokens recorded on a usage record, across all four buckets. Used
   * to decide which of two records sharing the same uniqueHash to keep
   * (issue #18 — proxy writes placeholder then real values). */
  private static tokenSum(r: any): number {
    const u = r?.message?.usage || {};
    return (u.input_tokens || 0) + (u.output_tokens || 0)
      + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  }

  /**
   * Derive session + project info from a usage log file path.
   * Claude Code stores logs as: <claudeDir>/projects/<encoded-cwd>/<session-id>.jsonl
   * The encoded-cwd folder is the working directory with path separators replaced by '-'.
   */
  private static parseSessionInfo(filePath: string): { sessionId: string; projectName: string; projectPath: string } {
    // Layouts under ~/.claude/projects/:
    //   <proj-encoded>/<session-id>.jsonl                                 (main conversation)
    //   <proj-encoded>/<session-id>/subagents/workflows/<wf>/agent-*.jsonl (workflow sub-agents)
    // Walk up from the 'projects' directory so sub-agent files resolve to
    // their parent session and real project — the old basename-only logic
    // attributed them to a 'wf_xxx' pseudo-project with an 'agent-xxx'
    // session id, fragmenting Sessions/Projects aggregation.
    const parts = filePath.split(/[\\/]/);
    const projIdx = parts.lastIndexOf(CLAUDE_PROJECTS_DIR_NAME);
    let projectPath: string;
    let sessionId = path.basename(filePath, '.jsonl');
    if (projIdx >= 0 && projIdx + 1 < parts.length - 1) {
      projectPath = parts[projIdx + 1];
      if (projIdx + 2 < parts.length - 1) {
        // File is nested below a session directory: the session is that
        // directory's name, not the (agent-xxx / journal) file name.
        sessionId = parts[projIdx + 2];
      }
    } else {
      projectPath = path.basename(path.dirname(filePath));
    }
    // Use the last meaningful segment of the encoded path as a friendly project name.
    const segments = projectPath.split('-').filter((s) => s.length > 0);
    const projectName = segments.length > 0 ? segments[segments.length - 1] : projectPath || 'unknown';
    return { sessionId, projectName, projectPath };
  }

  /** True if a `user` line's text is a Claude Code system marker rather than
   * something the user actually typed: an interruption notice, or the echo of
   * a slash command (`/model`, `/clear`, …) and its output. These otherwise
   * inflate the "Messages" count (one session showed 106 vs ~80 real prompts:
   * `[Request interrupted by user]` ×3, `<command-name>/model…` ×8, etc.). */
  private static isSyntheticUserText(text: string): boolean {
    const t = text.trim();
    if (/^\[Request interrupted/i.test(t)) {
      return true;
    }
    // Slash-command echo blocks wrap the invocation/output in these tags.
    if (
      t.startsWith('<command-name>') ||
      t.startsWith('<command-message>') ||
      t.includes('<local-command-stdout>') ||
      t.includes('<local-command-caveat>')
    ) {
      return true;
    }
    return false;
  }

  /** Last segment of a path, handling both '/' and '\\' separators. */
  private static lastPathSegment(p: string): string {
    const parts = p.split(/[\\/]/).filter((s) => s.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : p;
  }

  /**
   * Context-window size for a single request: every token on the input side
   * (fresh input + cache reads + cache writes). Mirrors what Claude Code's
   * /context command summarises.
   */
  private static recordContextTokens(record: ClaudeUsageRecord): number {
    const usage = record.message.usage;
    return (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  }

  private static async getEarliestTimestamp(filePath: string): Promise<Date | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      for (const line of lines) {
        if (line.trim() === '') continue;

        try {
          const json = JSON.parse(line) as Record<string, unknown>;
          if (typeof json.timestamp === 'string') {
            const date = new Date(json.timestamp);
            if (!isNaN(date.getTime())) {
              return date;
            }
          }
        } catch {
          // Skip invalid lines
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private static async sortFilesByTimestamp(files: string[]): Promise<string[]> {
    const filesWithTimestamps = await Promise.all(
      files.map(async (file) => {
        const timestamp = await this.getEarliestTimestamp(file);
        return {
          file,
          timestamp: timestamp || new Date(0),
        };
      })
    );

    return filesWithTimestamps.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).map((item) => item.file);
  }

  static calculateUsageData(records: ClaudeUsageRecord[]): UsageData {
    const data: UsageData = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalCost: 0,
      costBreakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      messageCount: 0,
      modelBreakdown: {},
    };

    for (const record of records) {
      // Synthetic user-prompt markers: count towards Messages and nothing else.
      // "Messages" therefore means messages the user typed, not API calls.
      if (record._isUserPrompt) {
        data.messageCount++;
        continue;
      }
      // Only count records with usage and model (typically assistant type)
      if (!record.message.usage || !record.message.model) {
        continue;
      }

      const usage = record.message.usage;
      const model = record.message.model;

      // Skip error records and invalid records
      if (model === '<synthetic>' || record.isApiErrorMessage) {
        continue;
      }

      // Skip records where all tokens are 0
      const tokenSum = usage.input_tokens + usage.output_tokens + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      if (tokenSum === 0) {
        continue;
      }

      // Cost split by token type; the total is the sum of the four components.
      const costParts = calculateCostBreakdown(usage, model);
      const calculatedCost = costParts.input + costParts.output + costParts.cacheWrite + costParts.cacheRead;

      data.totalInputTokens += usage.input_tokens;
      data.totalOutputTokens += usage.output_tokens;
      data.totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
      data.totalCacheReadTokens += usage.cache_read_input_tokens || 0;
      data.totalCost += calculatedCost;
      data.costBreakdown.input += costParts.input;
      data.costBreakdown.output += costParts.output;
      data.costBreakdown.cacheWrite += costParts.cacheWrite;
      data.costBreakdown.cacheRead += costParts.cacheRead;
      // messageCount intentionally NOT incremented here — it counts the
      // synthetic user-prompt markers above, i.e. messages the user typed.

      if (!data.modelBreakdown[model]) {
        data.modelBreakdown[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0,
          count: 0,
        };
      }

      const modelData = data.modelBreakdown[model];
      modelData.inputTokens += usage.input_tokens;
      modelData.outputTokens += usage.output_tokens;
      modelData.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
      modelData.cacheReadTokens += usage.cache_read_input_tokens || 0;
      modelData.cost += calculatedCost;
      modelData.count++;
    }

    return data;
  }

  /**
   * The "current session" shown next to today's cost in the status bar — the
   * single most-recently-active conversation (one `.jsonl` / `_sessionId`),
   * scoped to the current workspace when one is given.
   *
   * Previously this aggregated *all* records from the last 5 hours across every
   * project, so every VS Code window showed the same number regardless of which
   * workspace it was. Now each window reflects its own workspace's current
   * conversation. Returns null if there's been no activity in the last 5 hours
   * (so a stale session doesn't masquerade as "current").
   *
   * @param workspacePath optional current workspace folder; records whose cwd
   *   sits under it are preferred. Falls back to all records if the workspace
   *   has no matching records (e.g. a brand-new folder).
   */
  /** Records belonging to the given workspace folder.
   *
   * Primary match: the session's home project directory (`_projectDirEncoded`,
   * derived from where the .jsonl lives = where the session was started)
   * equals the workspace folder encoded the same way Claude Code does
   * (`D:\Jiaming\My_Proj` → `d--Jiaming-My-Proj`). This attributes the WHOLE
   * conversation to its workspace even though per-record `cwd` wanders as
   * work moves between folders mid-session (observed: one session split
   * 10/71 across two cwds, fragmenting the per-project figure).
   *
   * Secondary match: the record's cwd sits under the folder — catches
   * sessions started elsewhere that did work inside this workspace.
   *
   * Returns all records when no workspace is given. */
  static filterByWorkspace(records: ClaudeUsageRecord[], workspacePath?: string): ClaudeUsageRecord[] {
    if (!workspacePath) {
      return records;
    }
    const norm = (p: string): string => (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const wp = norm(workspacePath);
    const encoded = workspacePath.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return records.filter((r) => {
      if ((r._projectDirEncoded || '').toLowerCase() === encoded) {
        return true;
      }
      const p = norm(r._projectPath || '');
      return p.startsWith(wp) || p === encoded;
    });
  }

  static getCurrentSessionData(records: ClaudeUsageRecord[], workspacePath?: string): SessionData | null {
    if (records.length === 0) {
      return null;
    }

    let pool = records;
    if (workspacePath) {
      const scoped = this.filterByWorkspace(records, workspacePath);
      if (scoped.length > 0) {
        pool = scoped;
      }
    }

    // The most recent record identifies the current session.
    let latest = pool[0];
    for (const r of pool) {
      if (new Date(r.timestamp).getTime() > new Date(latest.timestamp).getTime()) {
        latest = r;
      }
    }

    // Recency guard: if the latest activity is older than the 5-hour window,
    // there is no "current" session to show.
    if (Date.now() - new Date(latest.timestamp).getTime() > 5 * 60 * 60 * 1000) {
      return null;
    }

    const sessionId = latest._sessionId;
    const sessionRecords = pool.filter((r) => r._sessionId === sessionId);
    if (sessionRecords.length === 0) {
      return null;
    }

    const usageData = this.calculateUsageData(sessionRecords);
    const times = sessionRecords.map((r) => new Date(r.timestamp).getTime());
    return {
      ...usageData,
      sessionStart: new Date(Math.min(...times)),
      sessionEnd: new Date(Math.max(...times)),
    };
  }

  /**
   * Context-window fill of the current conversation — the input-side token
   * count of the session's most recent request vs the model's window size.
   * Mirrors what Claude Code's /context shows, estimated from the logs: after
   * /clear or a compaction the figure only corrects on the next message.
   * Same workspace scoping and 5-hour recency rule as getCurrentSessionData.
   * (Merged from PR #31, @ScherbakovAl.)
   */
  static getCurrentContextInfo(
    records: ClaudeUsageRecord[],
    workspacePath?: string,
    windowOverride: number = 0
  ): ContextWindowInfo | null {
    let pool = records;
    if (workspacePath) {
      const scoped = this.filterByWorkspace(records, workspacePath);
      if (scoped.length > 0) {
        pool = scoped;
      }
    }
    // Main thread only: sub-agent / workflow records carry _agentId / _workflowId
    // and would otherwise hijack "current context" with a sub-agent's own (often
    // smaller) window while a workflow runs. Fall back to the full pool only if
    // there are no main-thread records at all.
    const mainThread = pool.filter((r) => !r._agentId && !r._workflowId);
    const base = mainThread.length > 0 ? mainThread : pool;
    // Only real assistant requests carry context information — synthetic
    // user-prompt markers and API-error records have zero usage.
    const withCtx = base.filter((r) => this.recordContextTokens(r) > 0);
    if (withCtx.length === 0) {
      return null;
    }

    let latest = withCtx[0];
    for (const r of withCtx) {
      if (new Date(r.timestamp).getTime() > new Date(latest.timestamp).getTime()) {
        latest = r;
      }
    }
    // Show the most-recent session's context on startup too (opening a window
    // in the morning shouldn't blank it). Hide only once it is genuinely stale.
    if (Date.now() - new Date(latest.timestamp).getTime() > 24 * 60 * 60 * 1000) {
      return null;
    }

    const model = latest.message.model || '';
    const usage = latest.message.usage;
    const win = this.contextWindowFor(model, windowOverride);
    return {
      contextTokens: this.recordContextTokens(latest),
      windowTokens: win.tokens,
      estimated: win.estimated,
      model,
      inputTokens: usage.input_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    };
  }

  /** Model context-window size in tokens, plus whether it's a guess. Current
   * Claude (Opus 4.6+, Sonnet 4.6+, Sonnet 5+, Fable/Mythos 5) is 1M; Haiku
   * and older Claude are 200K; a "[1m]" suffix forces 1M (the marker
   * pricing.ts strips). A user override (>0) wins outright and is treated as
   * exact. Unrecognised / proxied models fall back to 200K and are flagged
   * `estimated` so the UI can mark the percentage as approximate.
   * Sonnet 5 (`claude-sonnet-5`) verified 2026-07-01 —
   * https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5
   * ("1M tokens is both the default and the maximum; there is no smaller
   * context variant"). */
  private static contextWindowFor(
    model: string,
    override: number = 0
  ): { tokens: number; estimated: boolean } {
    if (override && override > 0) {
      return { tokens: override, estimated: false };
    }
    const m = (model || '').toLowerCase();
    if (/\[1m\]/.test(m)) {
      return { tokens: 1_000_000, estimated: false };
    }
    if (/fable|mythos/.test(m)) {
      return { tokens: 1_000_000, estimated: false };
    }
    // Opus 4.6+ and Sonnet 4.6+ are 1M; earlier 4.x and 3.x are 200K.
    if (/opus-4-(?:[6-9]|\d\d)\b/.test(m) || /sonnet-4-(?:[6-9]|\d\d)\b/.test(m)) {
      return { tokens: 1_000_000, estimated: false };
    }
    // Sonnet 5.x+ (e.g. "claude-sonnet-5") has no "-4-" segment to match
    // above, so check the major version directly. (Opus 5 doesn't exist yet —
    // don't guess its window size here.)
    if (/sonnet-(?:[5-9]|\d\d)(?:-|\b)/.test(m)) {
      return { tokens: 1_000_000, estimated: false };
    }
    if (/haiku/.test(m) || /opus|sonnet/.test(m)) {
      return { tokens: 200_000, estimated: false };
    }
    if (/deepseek/.test(m)) {
      return { tokens: 128_000, estimated: false };
    }
    // Unknown / proxied model — conservative default, flagged as a guess.
    return { tokens: 200_000, estimated: true };
  }

  static getTodayData(records: ClaudeUsageRecord[]): UsageData {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayRecords = records.filter((record) => {
      const recordDate = new Date(record.timestamp);
      return recordDate >= today;
    });

    return this.calculateUsageData(todayRecords);
  }

  static getThisMonthData(records: ClaudeUsageRecord[]): UsageData {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthRecords = records.filter((record) => {
      const recordDate = new Date(record.timestamp);
      return recordDate >= monthStart;
    });

    return this.calculateUsageData(monthRecords);
  }

  static getDailyDataForMonth(records: ClaudeUsageRecord[]): { date: string; data: UsageData }[] {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthRecords = records.filter((record) => {
      const recordDate = new Date(record.timestamp);
      return recordDate >= monthStart;
    });

    // Group records by date
    const recordsByDate: Record<string, ClaudeUsageRecord[]> = {};

    monthRecords.forEach((record) => {
      const recordDate = new Date(record.timestamp);
      const dateKey = recordDate.toISOString().split('T')[0]; // YYYY-MM-DD

      if (!recordsByDate[dateKey]) {
        recordsByDate[dateKey] = [];
      }
      recordsByDate[dateKey].push(record);
    });

    // Calculate usage data for each day and sort by date (newest first)
    const dailyData = Object.entries(recordsByDate)
      .map(([date, dayRecords]) => ({
        date,
        data: this.calculateUsageData(dayRecords),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return dailyData;
  }

  static getAllTimeData(records: ClaudeUsageRecord[]): UsageData {
    return this.calculateUsageData(records);
  }

  /**
   * Group records by their source session (.jsonl file) and aggregate usage per session.
   * Returns sessions with billable usage, sorted by most recent activity first.
   * @param records All loaded usage records
   * @param limit Maximum number of sessions to return (default 50)
   */
  static getSessionBreakdown(records: ClaudeUsageRecord[], limit: number = 50): SessionUsage[] {
    const recordsBySession: Record<string, ClaudeUsageRecord[]> = {};

    for (const record of records) {
      const sessionId = record._sessionId || 'unknown';
      if (!recordsBySession[sessionId]) {
        recordsBySession[sessionId] = [];
      }
      recordsBySession[sessionId].push(record);
    }

    const sessions: SessionUsage[] = Object.entries(recordsBySession).map(([sessionId, sessionRecords]) => {
      const timestamps = sessionRecords
        .map((r) => new Date(r.timestamp).getTime())
        .filter((t) => !isNaN(t));
      const startTime = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date(0);
      const endTime = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date(0);
      const first = sessionRecords[0];
      const peakContextTokens = sessionRecords.reduce((peak, r) => Math.max(peak, this.recordContextTokens(r)), 0);

      const title = sessionRecords.find((r) => r._sessionTitle)?._sessionTitle;

      return {
        sessionId,
        title,
        projectName: first._projectName || 'unknown',
        projectPath: first._projectPath || '',
        startTime,
        endTime,
        data: this.calculateUsageData(sessionRecords),
        peakContextTokens,
      };
    });

    return sessions
      // messageCount now means user-typed prompts; keep sessions that have
      // real spend even if no prompt landed in the window (e.g. continuations).
      .filter((s) => s.data.messageCount > 0 || s.data.totalCost > 0)
      .sort((a, b) => b.endTime.getTime() - a.endTime.getTime())
      .slice(0, limit);
  }

  /** Agent type from the sibling agent-*.meta.json ("unknown" when absent). */
  private static async readAgentType(jsonlPath: string, cache: Map<string, string>): Promise<string> {
    const metaPath = jsonlPath.replace(/\.jsonl$/i, '.meta.json');
    const cached = cache.get(metaPath);
    if (cached !== undefined) {
      return cached;
    }
    let agentType = 'unknown';
    try {
      const parsed = JSON.parse(await readFile(metaPath, 'utf-8')) as { agentType?: unknown };
      if (typeof parsed.agentType === 'string' && parsed.agentType.trim() !== '') {
        agentType = parsed.agentType.trim();
      }
    } catch {
      // Missing or malformed meta file — journal.jsonl has none, for example.
    }
    cache.set(metaPath, agentType);
    return agentType;
  }

  /**
   * Human-readable workflow name, derived from the generated script file
   * `<session-dir>/workflows/scripts/<name>-wf_<id>.js`. Falls back to the
   * workflow id when no script matches (the wf_*.json shape is not a stable
   * API, so the script filename is the dependable source).
   */
  private static async resolveWorkflowName(
    agentFilePath: string,
    workflowId: string,
    cache: Map<string, string>
  ): Promise<string> {
    const cached = cache.get(workflowId);
    if (cached !== undefined) {
      return cached;
    }
    let name = workflowId;
    const m = agentFilePath.match(/^(.*)[\\/]subagents[\\/]workflows[\\/]/);
    if (m) {
      const scriptsDir = path.join(m[1], 'workflows', 'scripts');
      try {
        const entries = await fs.promises.readdir(scriptsDir);
        const suffix = `-${workflowId}.js`;
        const hit = entries.find((e) => e.endsWith(suffix));
        if (hit) {
          name = hit.slice(0, -suffix.length);
        }
      } catch {
        // No scripts directory — keep the id.
      }
    }
    cache.set(workflowId, name);
    return name;
  }

  /**
   * Group sub-agent records into multi-agent runs and aggregate usage per
   * run, with a per-agent breakdown for drill-down. Covers both true
   * dynamic-workflow runs (wf_<id>) and ad-hoc batches — ≥2 generic
   * Task-tool agents in one session without a wf_ dir (what ultracode
   * produces when the dynamic-workflow feature isn't engaged, e.g. with
   * proxy/DeepSeek routing). Sorted by most recent activity first.
   * @param records All loaded usage records
   * @param limit Maximum number of runs to return (default 50)
   */
  static getWorkflowBreakdown(records: ClaudeUsageRecord[], limit: number = 50): WorkflowUsage[] {
    const recordsByWorkflow: Record<string, ClaudeUsageRecord[]> = {};
    const adHocAgentsBySession: Record<string, Set<string>> = {};
    for (const record of records) {
      if (!record._workflowId) {
        // Generic sub-agent records become ad-hoc batches, one per session.
        if (record._agentId) {
          const sessionId = record._sessionId || 'unknown';
          const batchId = 'adhoc:' + sessionId;
          if (!recordsByWorkflow[batchId]) {
            recordsByWorkflow[batchId] = [];
            adHocAgentsBySession[batchId] = new Set<string>();
          }
          recordsByWorkflow[batchId].push(record);
          adHocAgentsBySession[batchId].add(record._agentId);
        }
        continue;
      }
      if (!recordsByWorkflow[record._workflowId]) {
        recordsByWorkflow[record._workflowId] = [];
      }
      recordsByWorkflow[record._workflowId].push(record);
    }
    // A single stray agent is not a batch — drop those pseudo-groups.
    for (const [batchId, agentIds] of Object.entries(adHocAgentsBySession)) {
      if (agentIds.size < 2) {
        delete recordsByWorkflow[batchId];
      }
    }

    const timeRange = (rs: ClaudeUsageRecord[]): { start: Date; end: Date } => {
      const timestamps = rs.map((r) => new Date(r.timestamp).getTime()).filter((t) => !isNaN(t));
      return {
        start: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date(0),
        end: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date(0),
      };
    };

    const workflows: WorkflowUsage[] = Object.entries(recordsByWorkflow).map(([workflowId, wfRecords]) => {
      const recordsByAgent: Record<string, ClaudeUsageRecord[]> = {};
      for (const r of wfRecords) {
        const agentId = r._agentId || 'unknown';
        if (!recordsByAgent[agentId]) {
          recordsByAgent[agentId] = [];
        }
        recordsByAgent[agentId].push(r);
      }
      const agents = Object.entries(recordsByAgent)
        .map(([agentId, agentRecords]) => {
          const range = timeRange(agentRecords);
          return {
            agentId,
            task: agentRecords.find((r) => r._agentTask)?._agentTask,
            data: this.calculateUsageData(agentRecords),
            startTime: range.start,
            endTime: range.end,
          };
        })
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

      const first = wfRecords[0];
      const range = timeRange(wfRecords);
      const isAdHoc = workflowId.startsWith('adhoc:');
      // Ad-hoc batches have no script-derived name; the session title is the
      // best available description of what the run was for.
      const name = isAdHoc
        ? first._sessionTitle || (first._sessionId || workflowId).slice(0, 8)
        : first._workflowName || workflowId;
      return {
        workflowId,
        name,
        isAdHoc: isAdHoc || undefined,
        sessionId: first._sessionId || 'unknown',
        projectPath: first._projectPath || '',
        projectName: first._projectName || 'unknown',
        startTime: range.start,
        endTime: range.end,
        agentCount: agents.length,
        data: this.calculateUsageData(wfRecords),
        agents,
      };
    });

    // Phase 7c — main-session orchestration cost. For each run, find the
    // session's *main-thread* records (not under subagents/) that fall inside
    // the run's time window. This surfaces the expensive native-Claude
    // orchestration that lives in the main session, not the agent files.
    // To avoid double-counting when two runs of the same session overlap, a
    // record is attributed only if exactly one run's window contains it.
    const mainBySession: Record<string, ClaudeUsageRecord[]> = {};
    for (const r of records) {
      if (r._agentId || r._workflowId || r._isUserPrompt) {
        continue;
      }
      const sid = r._sessionId || 'unknown';
      (mainBySession[sid] ||= []).push(r);
    }
    const windowsBySession: Record<string, { start: number; end: number }[]> = {};
    for (const wf of workflows) {
      (windowsBySession[wf.sessionId] ||= []).push({
        start: wf.startTime.getTime(),
        end: wf.endTime.getTime(),
      });
    }
    // Real runs are a focused burst (minutes to ~1 h). An ad-hoc "batch" that
    // groups a session's agents across days would otherwise claim *all* the
    // session's main-thread work as orchestration — meaningless. Cap the window.
    const MAX_ORCH_WINDOW_MS = 3 * 60 * 60 * 1000;
    for (const wf of workflows) {
      const mains = mainBySession[wf.sessionId];
      if (!mains || mains.length === 0) {
        continue;
      }
      const windows = windowsBySession[wf.sessionId];
      const start = wf.startTime.getTime();
      const end = wf.endTime.getTime();
      if (end - start > MAX_ORCH_WINDOW_MS) {
        continue;
      }
      const orchestrationRecords = mains.filter((r) => {
        const t = new Date(r.timestamp).getTime();
        if (isNaN(t) || t < start || t > end) {
          return false;
        }
        // Drop if another run of this session also contains t (ambiguous).
        const containing = windows.filter((w) => t >= w.start && t <= w.end).length;
        return containing === 1;
      });
      if (orchestrationRecords.length > 0) {
        const orch = this.calculateUsageData(orchestrationRecords);
        if (orch.totalCost > 0) {
          wf.orchestration = orch;
        }
      }
    }

    return workflows.sort((a, b) => b.endTime.getTime() - a.endTime.getTime()).slice(0, limit);
  }

  /** Estimated cost of one record, with the same skip rules calculateUsageData
   * applies (synthetic markers, error records, zero-token placeholders → 0). */
  private static recordCost(record: ClaudeUsageRecord): number {
    if (record._isUserPrompt || !record.message.usage || !record.message.model) {
      return 0;
    }
    if (record.message.model === '<synthetic>' || record.isApiErrorMessage) {
      return 0;
    }
    if (this.tokenSum(record) === 0) {
      return 0;
    }
    const parts = calculateCostBreakdown(record.message.usage, record.message.model);
    return parts.input + parts.output + parts.cacheWrite + parts.cacheRead;
  }

  /**
   * "What's contributing to your usage?" — modelled on the official /usage
   * screen, but covering every model/provider in the logs and five scopes
   * (day / week / month / one session / one project). Characteristics are
   * independent signals weighted by estimated cost, NOT a breakdown; the
   * skills/plugins tables are weighted by estimated tokens (text length).
   */
  static getUsageAttribution(
    records: ClaudeUsageRecord[],
    analysis: ContentAnalysis | null,
    scope: AttributionScope
  ): UsageAttribution {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const minTs =
      scope.kind === 'day' ? startOfDay
      : scope.kind === 'week' ? now.getTime() - 7 * 24 * 60 * 60 * 1000
      : scope.kind === 'month' ? now.getTime() - 30 * 24 * 60 * 60 * 1000
      : 0;
    const normScope = scope.projectPath ? this.normalizePath(scope.projectPath) : '';

    const scoped = records.filter((r) => {
      if (r._isUserPrompt) {
        return false;
      }
      if (scope.kind === 'session') {
        return r._sessionId === scope.sessionId;
      }
      if (scope.kind === 'project') {
        return this.normalizePath(r._projectPath || '').startsWith(normScope);
      }
      const t = Date.parse(r.timestamp);
      return !isNaN(t) && t >= minTs;
    });

    // Skill / plugin activation points. A skill's usage share is the weight
    // of all scoped records in the same session at or after its (earliest)
    // invocation — the official /usage methodology ("usage that came from
    // this skill"); shares overlap by design. Plugins use the earliest
    // invocation among their skills, so a plugin never double-counts itself.
    type SkillStart = { key: string; ts: number; isPlugin: boolean };
    const startsBySession: Record<string, SkillStart[]> = {};
    const skillMeta: Record<string, { count: number; estTokens: number }> = {};
    const pluginMeta: Record<string, { count: number; estTokens: number }> = {};
    const skillW: Record<string, number> = {};
    const pluginW: Record<string, number> = {};
    if (analysis && analysis.skillUses.length > 0) {
      let uses = analysis.skillUses;
      if (scope.kind === 'session') {
        uses = uses.filter((u) => u.sessionId === scope.sessionId);
      } else if (scope.kind === 'project') {
        const sessionIds = new Set(scoped.map((r) => r._sessionId));
        uses = uses.filter((u) => sessionIds.has(u.sessionId));
      } else {
        // "YYYY-MM-DD" compares correctly as a string.
        const minDay = localDayKey(new Date(minTs).toISOString());
        uses = uses.filter((u) => u.day >= minDay);
      }
      // key → session → earliest invocation ts (skills and plugins separately)
      const skillEarliest: Record<string, Record<string, number>> = {};
      const pluginEarliest: Record<string, Record<string, number>> = {};
      const note = (
        key: string,
        u: SkillUse,
        meta: Record<string, { count: number; estTokens: number }>,
        earliest: Record<string, Record<string, number>>
      ): void => {
        if (!meta[key]) {
          meta[key] = { count: 0, estTokens: 0 };
        }
        meta[key].count += 1;
        meta[key].estTokens += u.estTokens;
        if (!earliest[key]) {
          earliest[key] = {};
        }
        const prev = earliest[key][u.sessionId];
        if (prev === undefined || u.ts < prev) {
          earliest[key][u.sessionId] = u.ts;
        }
      };
      for (const u of uses) {
        note(u.name, u, skillMeta, skillEarliest);
        const colon = u.name.indexOf(':');
        if (colon > 0) {
          note(u.name.slice(0, colon), u, pluginMeta, pluginEarliest);
        }
      }
      const pushStarts = (earliest: Record<string, Record<string, number>>, isPlugin: boolean): void => {
        for (const [key, sessions] of Object.entries(earliest)) {
          for (const [sessionId, ts] of Object.entries(sessions)) {
            if (!startsBySession[sessionId]) {
              startsBySession[sessionId] = [];
            }
            startsBySession[sessionId].push({ key, ts, isPlugin });
          }
        }
      };
      pushStarts(skillEarliest, false);
      pushStarts(pluginEarliest, true);
    }

    // One pass: total weight, characteristic weights, per-session aggregates
    // (for the long-session / subagent-heavy signals), the model split and
    // the skill/plugin activation weights.
    let totalCost = 0;
    let totalTokens = 0;
    let largeContextW = 0;
    let workflowW = 0;
    const bySession: Record<string, { weight: number; subagentWeight: number; hours: Set<number> }> = {};
    const byAgentType: Record<string, { weight: number; count: number }> = {};
    const byModel: Record<string, { weight: number; count: number }> = {};
    // Authoritative skill/plugin attribution from the log fields (Phase 7a):
    // exact cost-weight + token-sum of the lines Claude Code stamped. Preferred
    // over the <command-name> heuristic whenever any record carries the fields.
    const skillExactW: Record<string, { weight: number; count: number; tokens: number }> = {};
    const pluginExactW: Record<string, { weight: number; count: number; tokens: number }> = {};
    for (const r of scoped) {
      const w = this.recordCost(r);
      if (w <= 0) {
        continue;
      }
      totalCost += w;
      totalTokens += this.tokenSum(r);
      if (r._skill) {
        if (!skillExactW[r._skill]) {
          skillExactW[r._skill] = { weight: 0, count: 0, tokens: 0 };
        }
        skillExactW[r._skill].weight += w;
        skillExactW[r._skill].count += 1;
        skillExactW[r._skill].tokens += this.tokenSum(r);
      }
      if (r._plugin) {
        if (!pluginExactW[r._plugin]) {
          pluginExactW[r._plugin] = { weight: 0, count: 0, tokens: 0 };
        }
        pluginExactW[r._plugin].weight += w;
        pluginExactW[r._plugin].count += 1;
        pluginExactW[r._plugin].tokens += this.tokenSum(r);
      }
      if (this.recordContextTokens(r) > 150_000) {
        largeContextW += w;
      }
      if (r._workflowId) {
        workflowW += w;
      }
      const sessionId = r._sessionId || 'unknown';
      if (!bySession[sessionId]) {
        bySession[sessionId] = { weight: 0, subagentWeight: 0, hours: new Set<number>() };
      }
      const sess = bySession[sessionId];
      sess.weight += w;
      if (r._agentId) {
        sess.subagentWeight += w;
        const agentType = r._agentType || 'unknown';
        if (!byAgentType[agentType]) {
          byAgentType[agentType] = { weight: 0, count: 0 };
        }
        byAgentType[agentType].weight += w;
        byAgentType[agentType].count += 1;
      }
      const t = Date.parse(r.timestamp);
      if (!isNaN(t)) {
        sess.hours.add(Math.floor(t / 3_600_000));
        // Usage at or after a skill/plugin invocation counts toward it.
        const starts = startsBySession[sessionId];
        if (starts) {
          for (const start of starts) {
            if (t >= start.ts) {
              const target = start.isPlugin ? pluginW : skillW;
              target[start.key] = (target[start.key] || 0) + w;
            }
          }
        }
      }
      const model = r.message.model as string;
      if (!byModel[model]) {
        byModel[model] = { weight: 0, count: 0 };
      }
      byModel[model].weight += w;
      byModel[model].count += 1;
    }

    let longSessionW = 0;
    let subagentHeavyW = 0;
    for (const sess of Object.values(bySession)) {
      if (sess.hours.size >= 8) {
        longSessionW += sess.weight;
      }
      if (sess.subagentWeight > sess.weight * 0.5) {
        subagentHeavyW += sess.weight;
      }
    }

    const shareOfCost = (w: number): number => (totalCost > 0 ? w / totalCost : 0);
    const toEntries = (map: Record<string, { weight: number; count: number }>): AttributionEntry[] =>
      Object.entries(map)
        .map(([key, v]) => ({ key, share: shareOfCost(v.weight), count: v.count }))
        .sort((a, b) => b.share - a.share);

    // Skills / plugins: prefer the authoritative log-field attribution (exact
    // cost-weight of the stamped lines); fall back to the <command-name> +
    // at/after-invocation heuristic only when no record carried the fields
    // (older Claude Code logs). Picking one source per scope avoids double count.
    const exactEntries = (
      map: Record<string, { weight: number; count: number; tokens: number }>
    ): AttributionEntry[] =>
      Object.entries(map)
        .map(([key, m]) => ({ key, share: shareOfCost(m.weight), count: m.count, estTokens: m.tokens }))
        .sort((a, b) => b.share - a.share || b.count - a.count);
    const heuristicEntries = (
      weights: Record<string, number>,
      meta: Record<string, { count: number; estTokens: number }>
    ): AttributionEntry[] =>
      Object.entries(meta)
        .map(([key, m]) => ({ key, share: shareOfCost(weights[key] || 0), count: m.count, estTokens: m.estTokens }))
        .sort((a, b) => b.share - a.share || b.count - a.count);
    const skills =
      Object.keys(skillExactW).length > 0 ? exactEntries(skillExactW) : heuristicEntries(skillW, skillMeta);
    const plugins =
      Object.keys(pluginExactW).length > 0 ? exactEntries(pluginExactW) : heuristicEntries(pluginW, pluginMeta);

    return {
      totalCost,
      totalTokens,
      characteristics: {
        largeContext: shareOfCost(largeContextW),
        longSessions: shareOfCost(longSessionW),
        subagentHeavy: shareOfCost(subagentHeavyW),
        workflows: shareOfCost(workflowW),
      },
      skills,
      subagents: toEntries(byAgentType),
      plugins,
      models: toEntries(byModel),
    };
  }

  /** Normalise a path for case-insensitive comparison and grouping. */
  private static normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  /** Number of leading path segments shared by every segment list. */
  private static commonPrefixLength(lists: string[][]): number {
    if (lists.length === 0) {
      return 0;
    }
    const first = lists[0];
    let len = 0;
    for (let i = 0; i < first.length; i++) {
      if (lists.every((l) => i < l.length && l[i] === first[i])) {
        len++;
      } else {
        break;
      }
    }
    return len;
  }

  /** Original-casing display path for a group, derived from a child's path. */
  private static deriveGroupDisplayPath(childOriginalPath: string, groupKey: string): string {
    const groupSegCount = groupKey.split('/').filter((s) => s.length > 0).length;
    const sep = childOriginalPath.includes('\\') ? '\\' : '/';
    const originalSegments = childOriginalPath.split(/[\\/]/).filter((s) => s.length > 0);
    return originalSegments.slice(0, groupSegCount).join(sep);
  }

  /** Resolve the enclosing git repository root for a path, or null. Walks up the tree. */
  private static resolveGitRoot(startPath: string, cache: Map<string, string | null>): string | null {
    const visited: string[] = [];
    let dir = startPath;
    for (let i = 0; i < 80; i++) {
      if (cache.has(dir)) {
        const cached = cache.get(dir) ?? null;
        for (const v of visited) {
          cache.set(v, cached);
        }
        return cached;
      }
      visited.push(dir);
      let isRepo = false;
      try {
        isRepo = fs.existsSync(path.join(dir, '.git'));
      } catch {
        isRepo = false;
      }
      if (isRepo) {
        for (const v of visited) {
          cache.set(v, dir);
        }
        return dir;
      }
      const parent = path.dirname(dir);
      if (!parent || parent === dir) {
        break;
      }
      dir = parent;
    }
    for (const v of visited) {
      cache.set(v, null);
    }
    return null;
  }

  /**
   * Group records by project (working directory), then group those projects by
   * their enclosing git repository — or, when a project is not inside a repo, by
   * its top-level project folder. Paths that differ only in case are merged.
   * @param records All loaded usage records
   * @param limit Maximum number of project groups to return (default 60)
   */
  static getProjectBreakdown(
    records: ClaudeUsageRecord[],
    limit: number = 60,
    mode: 'git' | 'folder' | 'flat' = 'git'
  ): ProjectGroup[] {
    // 1. Group records per project, merging paths that differ only in case.
    const recordsByKey: Record<string, ClaudeUsageRecord[]> = {};
    const displayPathByKey: Record<string, string> = {};

    for (const record of records) {
      const rawPath = record._projectPath || record._projectName || 'unknown';
      const key = this.normalizePath(rawPath);
      if (!recordsByKey[key]) {
        recordsByKey[key] = [];
        displayPathByKey[key] = rawPath;
      }
      recordsByKey[key].push(record);
    }

    const keys = Object.keys(recordsByKey);
    if (keys.length === 0) {
      return [];
    }

    // 2. Common root — the grouping fallback for projects not inside a git repo.
    const segmentLists = keys.map((k) => k.split('/').filter((s) => s.length > 0));
    const commonRootLen = this.commonPrefixLength(segmentLists);

    // 3. Build a project per key and assign it to a group (git repo, else folder).
    const groups: Record<
      string,
      { records: ClaudeUsageRecord[]; children: ProjectUsage[]; displayPath: string; isGitRepo: boolean }
    > = {};
    const gitCache = new Map<string, string | null>();

    keys.forEach((key, idx) => {
      const projectRecords = recordsByKey[key];
      const originalPath = displayPathByKey[key];
      const segments = segmentLists[idx];

      let groupKey: string;
      let groupDisplayPath: string;
      let isGitRepo = false;

      if (mode === 'flat') {
        // Every working directory is its own group.
        groupKey = segments.join('/');
        groupDisplayPath = originalPath;
      } else {
        let gitRoot: string | null = null;
        if (mode === 'git') {
          gitRoot = this.resolveGitRoot(originalPath, gitCache);
        }
        if (gitRoot) {
          groupKey = this.normalizePath(gitRoot);
          groupDisplayPath = gitRoot;
          isGitRepo = true;
        } else {
          // No git repo (or 'folder' mode): top-level project folder heuristic.
          const groupLen = commonRootLen === 0 ? segments.length : Math.min(segments.length, commonRootLen + 1);
          groupKey = segments.slice(0, groupLen).join('/');
          groupDisplayPath = this.deriveGroupDisplayPath(originalPath, groupKey);
        }
      }

      const timestamps = projectRecords.map((r) => new Date(r.timestamp).getTime()).filter((t) => !isNaN(t));
      const first = projectRecords[0];
      const project: ProjectUsage = {
        projectName: first._projectName || 'unknown',
        projectPath: displayPathByKey[key],
        sessionCount: new Set(projectRecords.map((r) => r._sessionId || 'unknown')).size,
        firstSeen: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date(0),
        lastSeen: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date(0),
        data: this.calculateUsageData(projectRecords),
      };

      if (!groups[groupKey]) {
        groups[groupKey] = { records: [], children: [], displayPath: groupDisplayPath, isGitRepo };
      }
      groups[groupKey].records.push(...projectRecords);
      groups[groupKey].children.push(project);
    });

    // 4. Aggregate each group.
    const result: ProjectGroup[] = Object.values(groups).map((g) => {
      const timestamps = g.records.map((r) => new Date(r.timestamp).getTime()).filter((t) => !isNaN(t));
      const sessionCount = new Set(g.records.map((r) => r._sessionId || 'unknown')).size;
      const children = g.children.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
      const pathSegments = g.displayPath.split(/[\\/]/).filter((s) => s.length > 0);
      const groupName = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : g.displayPath;

      return {
        groupName,
        groupPath: g.displayPath,
        isGitRepo: g.isGitRepo,
        projectCount: children.length,
        sessionCount,
        firstSeen: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date(0),
        lastSeen: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date(0),
        data: this.calculateUsageData(g.records),
        children,
      };
    });

    return result
      .filter((g) => g.data.messageCount > 0)
      .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
      .slice(0, limit);
  }

  /**
   * Group records by git branch (within each project) and aggregate usage.
   * Returns branches with billable usage, sorted by cost descending.
   * @param records All loaded usage records
   * @param limit Maximum number of branches to return (default 60)
   */
  static getBranchBreakdown(records: ClaudeUsageRecord[], limit: number = 60): BranchUsage[] {
    const byKey: Record<string, ClaudeUsageRecord[]> = {};
    for (const record of records) {
      const branch = record._gitBranch && record._gitBranch.trim() !== '' ? record._gitBranch : '-';
      const key = (record._projectName || 'unknown') + '\u0000' + branch;
      if (!byKey[key]) {
        byKey[key] = [];
      }
      byKey[key].push(record);
    }

    const result: BranchUsage[] = Object.values(byKey).map((recs) => {
      const first = recs[0];
      const branch = first._gitBranch && first._gitBranch.trim() !== '' ? first._gitBranch : '-';
      const timestamps = recs.map((r) => new Date(r.timestamp).getTime()).filter((t) => !isNaN(t));
      return {
        branch,
        projectName: first._projectName || 'unknown',
        projectPath: first._projectPath || '',
        sessionCount: new Set(recs.map((r) => r._sessionId || 'unknown')).size,
        lastSeen: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date(0),
        data: this.calculateUsageData(recs),
      };
    });

    return result
      .filter((b) => b.data.messageCount > 0)
      .sort((a, b) => b.data.totalCost - a.data.totalCost)
      .slice(0, limit);
  }

  /**
   * Newest modification time (ms) across all usage log files. Used to skip
   * pointless reloads when nothing has changed since the last load.
   */
  static async getLatestModifiedTime(dataDirectory?: string): Promise<number> {
    try {
      const claudePaths = dataDirectory ? [dataDirectory] : this.getClaudePaths();
      let latest = 0;
      for (const claudePath of claudePaths) {
        const claudeDir = path.join(claudePath, CLAUDE_PROJECTS_DIR_NAME);
        if (!fs.existsSync(claudeDir)) {
          continue;
        }
        const files = await findJsonlFiles(claudeDir);
        for (const file of files) {
          try {
            const stat = await fs.promises.stat(file);
            if (stat.mtimeMs > latest) {
              latest = stat.mtimeMs;
            }
          } catch {
            // Ignore unreadable files.
          }
        }
      }
      return latest;
    } catch {
      return 0;
    }
  }

  static getDailyDataForSpecificMonth(records: ClaudeUsageRecord[], monthDateString: string): { date: string; data: UsageData }[] {
    // monthDateString format: YYYY-MM-01 (first day of the month)
    const monthDate = new Date(monthDateString);
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0); // Last day of the month

    const monthRecords = records.filter((record) => {
      const recordDate = new Date(record.timestamp);
      return recordDate >= monthStart && recordDate <= monthEnd;
    });

    // Group records by date
    const recordsByDate: Record<string, ClaudeUsageRecord[]> = {};

    monthRecords.forEach((record) => {
      const recordDate = new Date(record.timestamp);
      const dateKey = recordDate.toISOString().split('T')[0]; // YYYY-MM-DD

      if (!recordsByDate[dateKey]) {
        recordsByDate[dateKey] = [];
      }
      recordsByDate[dateKey].push(record);
    });

    // Convert to array and sort by date
    return Object.keys(recordsByDate)
      .sort()
      .map((dateKey) => ({
        date: dateKey,
        data: this.calculateUsageData(recordsByDate[dateKey]),
      }));
  }

  static getDailyDataForAllTime(records: ClaudeUsageRecord[]): { date: string; data: UsageData }[] {
    // Group all records by month for all-time view
    const recordsByMonth: Record<string, ClaudeUsageRecord[]> = {};

    records.forEach((record) => {
      const recordDate = new Date(record.timestamp);
      const monthKey = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM

      if (!recordsByMonth[monthKey]) {
        recordsByMonth[monthKey] = [];
      }
      recordsByMonth[monthKey].push(record);
    });

    // Calculate usage data for each month and sort by month (newest first)
    const monthlyData = Object.entries(recordsByMonth)
      .map(([month, monthRecords]) => ({
        date: month + '-01', // Set to first day of month for date sorting
        data: this.calculateUsageData(monthRecords),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return monthlyData;
  }

  static getHourlyDataForToday(records: ClaudeUsageRecord[]): { hour: string; data: UsageData }[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayRecords = records.filter((record) => {
      const recordDate = new Date(record.timestamp);
      return recordDate >= today;
    });

    // Group records by hour
    const recordsByHour: Record<string, ClaudeUsageRecord[]> = {};

    todayRecords.forEach((record) => {
      const recordDate = new Date(record.timestamp);
      const hourKey = `${recordDate.getHours().toString().padStart(2, '0')}:00`; // HH:00 format

      if (!recordsByHour[hourKey]) {
        recordsByHour[hourKey] = [];
      }
      recordsByHour[hourKey].push(record);
    });

    // Calculate usage data for each hour and sort by hour
    const hourlyData = Object.entries(recordsByHour)
      .map(([hour, hourRecords]) => ({
        hour,
        data: this.calculateUsageData(hourRecords),
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    return hourlyData;
  }

  static getHourlyDataForDate(records: ClaudeUsageRecord[], dateString: string): { hour: string; data: UsageData }[] {
    const targetDate = new Date(dateString);
    targetDate.setHours(0, 0, 0, 0);

    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const dateRecords = records.filter((record) => {
      const recordDate = new Date(record.timestamp);
      return recordDate >= targetDate && recordDate < nextDate;
    });

    // Group records by hour
    const recordsByHour: Record<string, ClaudeUsageRecord[]> = {};

    dateRecords.forEach((record) => {
      const recordDate = new Date(record.timestamp);
      const hourKey = `${recordDate.getHours().toString().padStart(2, '0')}:00`; // HH:00 format

      if (!recordsByHour[hourKey]) {
        recordsByHour[hourKey] = [];
      }
      recordsByHour[hourKey].push(record);
    });

    // Calculate usage data for each hour and sort by hour
    const hourlyData = Object.entries(recordsByHour)
      .map(([hour, hourRecords]) => ({
        hour,
        data: this.calculateUsageData(hourRecords),
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    return hourlyData;
  }
}
