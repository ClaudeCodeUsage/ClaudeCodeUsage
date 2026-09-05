import { open } from 'node:fs/promises';
import * as path from 'node:path';

import {
  scanUsageManifest,
  sortUsageFilesByEarliestTimestamp,
  UsageFileFingerprint,
  UsageManifest,
} from './claudeUsageFiles';
import {
  AnalysisAcc,
  analyzeLine,
  ClaudeDataLoader,
  finalizeAnalysisWithCalibration,
  mergeAnalysisAcc,
  newAnalysisAcc,
  validateUsageRecord,
} from './dataLoader';
import { dayKeyInZone, monthKeyInZone } from './dateKeys';
import { I18n } from './i18n';
import { isRetryDuplicatePrompt } from './promptDedup';
import {
  defaultCodexJsonlReader,
  scanCodexJsonlLines,
} from './providers/codex/codexJsonlScanner';
import { CodexRuntimeManifestEntry } from './providers/codex/codexManifest';
import { LoadUsageDiagnostics } from './refreshDiagnostics';
import {
  BranchUsage,
  ClaudeUsageRecord,
  ContentAnalysis,
  ContextWindowInfo,
  CostlyMessage,
  ProjectGroup,
  ProjectUsage,
  SessionData,
  SessionUsage,
  UsageData,
  WorkflowUsage,
} from './types';

const TAIL_SIGNATURE_BYTES = 64;

interface OrderedText {
  text: string;
  endOffset: number;
}

interface IndexedRecord {
  localKey: string;
  fileId: string;
  endOffset: number;
  fileTimestampMs: number;
  discoveryIndex: number;
  record: ClaudeUsageRecord;
}

interface ClaudeUsageFileContribution {
  fileId: string;
  path: string;
  fingerprint: UsageFileFingerprint;
  offset: number;
  tailSignature: string;
  firstTimestampMs: number;
  recentPrompts: Map<string, number>;
  usage: Map<string, IndexedRecord>;
  prompts: Map<string, IndexedRecord>;
  aiTitle?: OrderedText;
  customTitle?: OrderedText;
  agentTask?: string;
  analysis: AnalysisAcc | null;
  analysisAllUuids: Set<string>;
}

interface UsageAggregates {
  allTime: UsageData;
  byDay: Map<string, UsageData>;
  byMonth: Map<string, UsageData>;
  byLocalDay: Map<string, UsageData>;
  byLocalHour: Map<string, UsageData>;
  bySession: Map<string, UsageData>;
  byProject: Map<string, UsageData>;
  byBranch: Map<string, UsageData>;
  byWorkflow: Map<string, UsageData>;
}

interface DirtyGroups {
  sessions: Set<string>;
  projects: Set<string>;
  branches: Set<string>;
  workflows: Set<string>;
}

interface CopyOnWriteKeys {
  candidateMessages: Set<string>;
  candidateDirect: Set<string>;
  visibleSessions: Set<string>;
  visibleProjects: Set<string>;
  visibleBranches: Set<string>;
  visibleWorkflows: Set<string>;
  visibleLocalDays: Set<string>;
}

export interface ClaudeUsageIndex {
  files: Map<string, ClaudeUsageFileContribution>;
  manifest: UsageManifest | null;
  candidatesByMessage: Map<string, Map<string, IndexedRecord>>;
  candidatesByDirectIdentity: Map<string, Map<string, IndexedRecord>>;
  canonicalByIdentity: Map<string, IndexedRecord>;
  canonicalIdentitiesByMessage: Map<string, Set<string>>;
  visibleRecords: Map<string, ClaudeUsageRecord>;
  visibleKeysBySession: Map<string, Set<string>>;
  visibleKeysByProject: Map<string, Set<string>>;
  visibleKeysByBranch: Map<string, Set<string>>;
  visibleKeysByWorkflow: Map<string, Set<string>>;
  visibleKeysByLocalDay: Map<string, Set<string>>;
  sessionRows: Map<string, SessionUsage>;
  projectRows: Map<string, ProjectUsage>;
  projectSessionIds: Map<string, Set<string>>;
  branchRows: Map<string, BranchUsage>;
  workflowRows: Map<string, WorkflowUsage>;
  costliestBySession: Map<string, CostlyMessage[]>;
  latestContextBySession: Map<string, ClaudeUsageRecord>;
  sessionWorkspaceKeys: Map<string, Set<string>>;
  dirtyGroups: DirtyGroups;
  copyOnWrite: CopyOnWriteKeys;
  aggregates: UsageAggregates;
  contentAnalysis: ContentAnalysis | null;
  analyzeContent: boolean;
  windowDays: number;
  analysisCutoffMs: number;
}

export interface ClaudeUsageIndexDiagnostics extends LoadUsageDiagnostics {
  bodyReads: number;
  aggregateMutations: number;
  changed: {
    append: number;
    rebuild: number;
    move: number;
    delete: number;
  };
}

export interface ClaudeUsageIndexUpdateOptions {
  analyzeContent?: boolean;
  windowDays?: number;
  manifest?: UsageManifest;
  beforeBodyReads?: () => Promise<void>;
  log?: (line: string) => void;
}

export interface ClaudeUsageIndexUpdateResult {
  index: ClaudeUsageIndex;
  records: ClaudeUsageRecord[];
  contentAnalysis: ContentAnalysis | null;
  diagnostics: ClaudeUsageIndexDiagnostics;
}

export interface ClaudeUsageAggregateSnapshot {
  today: UsageData;
  month: UsageData;
  allTime: UsageData;
  dailyForMonth: { date: string; data: UsageData }[];
  monthlyForAllTime: { date: string; data: UsageData }[];
  hourlyForToday: { hour: string; data: UsageData }[];
}

export interface ClaudeUsageDashboardSnapshot extends ClaudeUsageAggregateSnapshot {
  session: SessionData | null;
  workspaceToday: UsageData | null;
  sessions: SessionUsage[];
  projects: ProjectGroup[];
  branches: BranchUsage[];
  workflows: WorkflowUsage[];
  costliestMessages: CostlyMessage[];
  context: ContextWindowInfo | null;
}

interface FilePlan {
  kind: 'append' | 'rebuild';
  entry: UsageFileFingerprint;
  fileId: string;
  prior?: ClaudeUsageFileContribution;
  replacedFileId?: string;
}

interface ParsedPlan extends FilePlan {
  contribution: ClaudeUsageFileContribution;
  bytesRead: number;
  linesParsed: number;
}

function emptyUsageData(): UsageData {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCost: 0,
    costBreakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    messageCount: 0,
    modelBreakdown: {},
  };
}

function emptyAggregates(): UsageAggregates {
  return {
    allTime: emptyUsageData(),
    byDay: new Map(),
    byMonth: new Map(),
    byLocalDay: new Map(),
    byLocalHour: new Map(),
    bySession: new Map(),
    byProject: new Map(),
    byBranch: new Map(),
    byWorkflow: new Map(),
  };
}

function emptyDirtyGroups(): DirtyGroups {
  return {
    sessions: new Set(),
    projects: new Set(),
    branches: new Set(),
    workflows: new Set(),
  };
}

function emptyCopyOnWriteKeys(): CopyOnWriteKeys {
  return {
    candidateMessages: new Set(),
    candidateDirect: new Set(),
    visibleSessions: new Set(),
    visibleProjects: new Set(),
    visibleBranches: new Set(),
    visibleWorkflows: new Set(),
    visibleLocalDays: new Set(),
  };
}

export function createClaudeUsageIndex(): ClaudeUsageIndex {
  return {
    files: new Map(),
    manifest: null,
    candidatesByMessage: new Map(),
    candidatesByDirectIdentity: new Map(),
    canonicalByIdentity: new Map(),
    canonicalIdentitiesByMessage: new Map(),
    visibleRecords: new Map(),
    visibleKeysBySession: new Map(),
    visibleKeysByProject: new Map(),
    visibleKeysByBranch: new Map(),
    visibleKeysByWorkflow: new Map(),
    visibleKeysByLocalDay: new Map(),
    sessionRows: new Map(),
    projectRows: new Map(),
    projectSessionIds: new Map(),
    branchRows: new Map(),
    workflowRows: new Map(),
    costliestBySession: new Map(),
    latestContextBySession: new Map(),
    sessionWorkspaceKeys: new Map(),
    dirtyGroups: emptyDirtyGroups(),
    copyOnWrite: emptyCopyOnWriteKeys(),
    aggregates: emptyAggregates(),
    contentAnalysis: null,
    analyzeContent: false,
    windowDays: 30,
    analysisCutoffMs: 0,
  };
}

function stableFileId(entry: UsageFileFingerprint): string {
  return (entry.dev ?? 0) > 0 && (entry.ino ?? 0) > 0
    ? `inode:${entry.dev}:${entry.ino}`
    : `path:${entry.path}`;
}

function runtimeEntry(entry: UsageFileFingerprint, fileId: string): CodexRuntimeManifestEntry {
  return {
    fileKey: fileId,
    absolutePath: entry.path,
    nonPersisted: true,
    sourceArea: 'sessions',
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    dev: entry.dev,
    ino: entry.ino,
  };
}

async function tailSignature(filePath: string, offset: number): Promise<string> {
  if (offset <= 0) return '';
  const length = Math.min(TAIL_SIGNATURE_BYTES, offset);
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const result = await handle.read(buffer, 0, length, offset - length);
    if (result.bytesRead !== length) throw new Error('short Claude tail signature read');
    return buffer.toString('base64');
  } finally {
    await handle.close();
  }
}

async function appendPrefixStillMatches(
  prior: ClaudeUsageFileContribution,
  entry: UsageFileFingerprint,
): Promise<boolean> {
  if (prior.offset <= 0) return true;
  try {
    return await tailSignature(entry.path, prior.offset) === prior.tailSignature;
  } catch {
    return false;
  }
}

function textFromUserContent(content: unknown, separator: string): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      Boolean(block) && typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string')
    .map((block) => block.text)
    .join(separator);
}

function tokenSum(value: IndexedRecord): number {
  const usage = value.record.message.usage;
  return (usage.input_tokens || 0) + (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
}

function orderedBefore(left: IndexedRecord, right: IndexedRecord): boolean {
  return left.fileTimestampMs < right.fileTimestampMs ||
    (left.fileTimestampMs === right.fileTimestampMs &&
      (left.discoveryIndex < right.discoveryIndex ||
        (left.discoveryIndex === right.discoveryIndex && left.endOffset < right.endOffset)));
}

function bestCandidate(values: Iterable<IndexedRecord>): IndexedRecord | undefined {
  let best: IndexedRecord | undefined;
  for (const candidate of values) {
    if (!best || tokenSum(candidate) > tokenSum(best) ||
      (tokenSum(candidate) === tokenSum(best) && orderedBefore(candidate, best))) {
      best = candidate;
    }
  }
  return best;
}

function cloneFile(prior: ClaudeUsageFileContribution, entry: UsageFileFingerprint): ClaudeUsageFileContribution {
  return {
    ...prior,
    path: entry.path,
    fingerprint: entry,
    recentPrompts: new Map(prior.recentPrompts),
    usage: new Map(prior.usage),
    prompts: new Map(prior.prompts),
    analysis: prior.analysis ? cloneAnalysisAcc(prior.analysis) : null,
    analysisAllUuids: new Set(prior.analysisAllUuids),
  };
}

function cloneAnalysisAcc(value: AnalysisAcc): AnalysisAcc {
  return {
    cat: Object.fromEntries(Object.entries(value.cat).map(([key, bucket]) => [key, { ...bucket }])),
    tools: Object.fromEntries(Object.entries(value.tools).map(([key, bucket]) => [key, { ...bucket }])),
    toolIdToName: { ...value.toolIdToName },
    seenUuids: new Set(value.seenUuids),
    cutoffMs: value.cutoffMs,
    prompts: value.prompts.map((prompt) => ({ ...prompt })),
    thinkingBySession: Object.fromEntries(
      Object.entries(value.thinkingBySession).map(([key, share]) => [key, { ...share }]),
    ),
    thinkingByDay: Object.fromEntries(
      Object.entries(value.thinkingByDay).map(([key, share]) => [key, { ...share }]),
    ),
    skillUses: value.skillUses.map((use) => ({ ...use })),
    skillByToolId: { ...value.skillByToolId },
  };
}

async function parsePlan(
  plan: FilePlan,
  agentTypeCache: Map<string, string>,
  workflowNameCache: Map<string, string>,
  analyzeContent: boolean,
  analysisCutoffMs: number,
  analysisSeenUuids?: Set<string>,
): Promise<ParsedPlan> {
  const rankDiscoveryIndex = plan.kind === 'append' && plan.prior
    ? plan.prior.fingerprint.discoveryIndex
    : plan.entry.discoveryIndex;
  const base = plan.kind === 'append' && plan.prior
    ? cloneFile(plan.prior, plan.entry)
    : {
        fileId: plan.fileId,
        path: plan.entry.path,
        fingerprint: plan.entry,
        offset: 0,
        tailSignature: '',
        firstTimestampMs: 0,
        recentPrompts: new Map<string, number>(),
        usage: new Map<string, IndexedRecord>(),
        prompts: new Map<string, IndexedRecord>(),
        analysis: analyzeContent ? newAnalysisAcc(analysisCutoffMs) : null,
        analysisAllUuids: new Set<string>(),
      };
  if (!analyzeContent) base.analysis = null;
  else if (!base.analysis || base.analysis.cutoffMs !== analysisCutoffMs) {
    base.analysis = newAnalysisAcc(analysisCutoffMs);
  }
  const ownedAnalysisUuids = new Set(base.analysis?.seenUuids ?? []);
  if (base.analysis && analysisSeenUuids) {
    base.analysis.seenUuids = analysisSeenUuids;
  }
  const sessionInfo = ClaudeDataLoader.parseSessionInfo(plan.entry.path);
  const isSubagentFile = /[\\/]subagents[\\/]/.test(plan.entry.path);
  let agentInfo: {
    agentId: string;
    agentType: string;
    workflowId?: string;
    workflowName?: string;
  } | null = null;
  if (isSubagentFile) {
    const agentId = path.basename(plan.entry.path, '.jsonl');
    const agentType = await ClaudeDataLoader.readAgentType(plan.entry.path, agentTypeCache);
    const workflowMatch = plan.entry.path.match(/[\\/]subagents[\\/]workflows[\\/](wf_[^\\/]+)[\\/]/);
    if (workflowMatch) {
      const workflowId = workflowMatch[1];
      const workflowName = await ClaudeDataLoader.resolveWorkflowName(
        plan.entry.path,
        workflowId,
        workflowNameCache,
      );
      agentInfo = { agentId, agentType, workflowId, workflowName };
    } else {
      agentInfo = { agentId, agentType };
    }
  }

  let linesParsed = 0;
  const scan = await scanCodexJsonlLines(
    runtimeEntry(plan.entry, plan.fileId),
    defaultCodexJsonlReader,
    { offset: base.offset, discardingOversizedLine: false },
    plan.entry.size,
    (line, endOffset) => {
      linesParsed += 1;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed.uuid === 'string') base.analysisAllUuids.add(parsed.uuid);
        if (base.analysis) {
          const uuid = typeof parsed.uuid === 'string' ? parsed.uuid : undefined;
          const alreadySeen = uuid ? base.analysis.seenUuids.has(uuid) : false;
          analyzeLine(parsed, base.analysis, isSubagentFile, sessionInfo.sessionId);
          if (uuid && !alreadySeen && base.analysis.seenUuids.has(uuid)) {
            ownedAnalysisUuids.add(uuid);
          }
        }
        if (base.firstTimestampMs === 0 && typeof parsed.timestamp === 'string') {
          const timestampMs = Date.parse(parsed.timestamp);
          if (Number.isFinite(timestampMs)) base.firstTimestampMs = timestampMs;
        }
        if (parsed.type === 'ai-title' && typeof parsed.aiTitle === 'string') {
          base.aiTitle = { text: parsed.aiTitle, endOffset };
        } else if (parsed.type === 'custom-title' && typeof parsed.customTitle === 'string') {
          base.customTitle = { text: parsed.customTitle, endOffset };
        } else if (parsed.type === 'summary' && typeof parsed.summary === 'string') {
          base.aiTitle = { text: parsed.summary, endOffset };
        }

        const message = parsed.message && typeof parsed.message === 'object'
          ? parsed.message as { role?: unknown; content?: unknown }
          : undefined;
        const role = message?.role ?? parsed.type;
        if (agentInfo && base.agentTask === undefined && role === 'user') {
          const task = textFromUserContent(message?.content, ' ').replace(/\s+/g, ' ').trim();
          if (task) base.agentTask = task.slice(0, 200);
        }

        if (!isSubagentFile && role === 'user' && !parsed.isMeta && !parsed.isSidechain &&
          typeof parsed.timestamp === 'string') {
          const text = textFromUserContent(message?.content, '');
          if (text.trim() && !ClaudeDataLoader.isSyntheticUserText(text) &&
            !isRetryDuplicatePrompt(text.trim(), Date.parse(parsed.timestamp), base.recentPrompts)) {
            const record: ClaudeUsageRecord = {
              timestamp: parsed.timestamp,
              message: { usage: { input_tokens: 0, output_tokens: 0 } },
              _isUserPrompt: true,
              _promptText: text.trim().slice(0, 4000),
              _sessionId: sessionInfo.sessionId,
              _projectDirEncoded: sessionInfo.projectPath,
            };
            const cwd = parsed.cwd;
            if (typeof cwd === 'string' && cwd.trim()) {
              record._projectPath = cwd;
              record._projectName = ClaudeDataLoader.lastPathSegment(cwd);
            } else {
              record._projectPath = sessionInfo.projectPath;
              record._projectName = sessionInfo.projectName;
            }
            const branch = parsed.gitBranch;
            record._gitBranch = typeof branch === 'string' && branch.trim() ? branch : undefined;
            const localKey = `${plan.fileId}:${endOffset}:prompt`;
            base.prompts.set(localKey, {
              localKey,
              fileId: plan.fileId,
              endOffset,
              fileTimestampMs: base.firstTimestampMs,
              discoveryIndex: rankDiscoveryIndex,
              record,
            });
            return;
          }
        }

        if (!validateUsageRecord(parsed)) return;
        const record = parsed as unknown as ClaudeUsageRecord;
        record._sessionId = sessionInfo.sessionId;
        record._projectDirEncoded = sessionInfo.projectPath;
        const cwd = parsed.cwd;
        if (typeof cwd === 'string' && cwd.trim()) {
          record._projectPath = cwd;
          record._projectName = ClaudeDataLoader.lastPathSegment(cwd);
        } else {
          record._projectPath = sessionInfo.projectPath;
          record._projectName = sessionInfo.projectName;
        }
        const branch = parsed.gitBranch;
        record._gitBranch = typeof branch === 'string' && branch.trim() ? branch : undefined;
        const skill = parsed.attributionSkill;
        const plugin = parsed.attributionPlugin;
        record._skill = typeof skill === 'string' && skill.trim() ? skill : undefined;
        record._plugin = typeof plugin === 'string' && plugin.trim() ? plugin : undefined;
        if (agentInfo) {
          record._agentId = agentInfo.agentId;
          record._agentType = agentInfo.agentType;
          record._workflowId = agentInfo.workflowId;
          record._workflowName = agentInfo.workflowName;
          record._agentTask = base.agentTask;
        }
        const localKey = `${plan.fileId}:${endOffset}:usage`;
        base.usage.set(localKey, {
          localKey,
          fileId: plan.fileId,
          endOffset,
          fileTimestampMs: base.firstTimestampMs,
          discoveryIndex: rankDiscoveryIndex,
          record,
        });
      } catch {
        // The established loader treats an invalid JSON line as local damage,
        // not a reason to discard every verified record in the file.
      }
    },
    undefined,
    Number.POSITIVE_INFINITY,
  );
  if (!scan.reachedEnd) throw new Error('Claude log changed during bounded read');
  base.offset = scan.cursor.offset;
  base.fingerprint = plan.entry;
  base.path = plan.entry.path;
  base.tailSignature = await tailSignature(plan.entry.path, base.offset);
  if (base.analysis) base.analysis.seenUuids = ownedAnalysisUuids;
  if (plan.kind === 'rebuild') {
    for (const value of base.usage.values()) {
      value.fileTimestampMs = base.firstTimestampMs;
      value.discoveryIndex = rankDiscoveryIndex;
    }
    for (const value of base.prompts.values()) {
      value.fileTimestampMs = base.firstTimestampMs;
      value.discoveryIndex = rankDiscoveryIndex;
    }
  }
  return { ...plan, contribution: base, bytesRead: scan.bytesRead, linesParsed };
}

function directIdentity(value: IndexedRecord): string | null {
  const messageId = value.record.message.id;
  const requestId = value.record.requestId;
  if (messageId) return null;
  return requestId ? `no-msg:${String(requestId)}` : `line:${value.localKey}`;
}

function resolvedMessageIdentity(value: IndexedRecord, requestIds: ReadonlySet<string>): string {
  const messageId = String(value.record.message.id);
  let requestId = value.record.requestId ? String(value.record.requestId) : '';
  if (!requestId && requestIds.size === 1) requestId = requestIds.values().next().value ?? '';
  return `message:${messageId}:${requestId || 'no-req'}`;
}

function cloneUsageData(value: UsageData): UsageData {
  return {
    ...value,
    costBreakdown: { ...value.costBreakdown },
    modelBreakdown: Object.fromEntries(
      Object.entries(value.modelBreakdown).map(([key, model]) => [key, { ...model }]),
    ),
  };
}

function localDayKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addUsageData(target: UsageData, source: UsageData, sign: 1 | -1): void {
  target.totalInputTokens += sign * source.totalInputTokens;
  target.totalOutputTokens += sign * source.totalOutputTokens;
  target.totalCacheCreationTokens += sign * source.totalCacheCreationTokens;
  target.totalCacheReadTokens += sign * source.totalCacheReadTokens;
  target.totalCost += sign * source.totalCost;
  target.messageCount += sign * source.messageCount;
  target.costBreakdown.input += sign * source.costBreakdown.input;
  target.costBreakdown.output += sign * source.costBreakdown.output;
  target.costBreakdown.cacheWrite += sign * source.costBreakdown.cacheWrite;
  target.costBreakdown.cacheRead += sign * source.costBreakdown.cacheRead;
  for (const [model, part] of Object.entries(source.modelBreakdown)) {
    const current = target.modelBreakdown[model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cost: 0,
      count: 0,
    };
    current.inputTokens += sign * part.inputTokens;
    current.outputTokens += sign * part.outputTokens;
    current.cacheCreationTokens += sign * part.cacheCreationTokens;
    current.cacheReadTokens += sign * part.cacheReadTokens;
    current.cost += sign * part.cost;
    current.count += sign * part.count;
    if (current.count === 0 && current.inputTokens === 0 && current.outputTokens === 0 &&
      current.cacheCreationTokens === 0 && current.cacheReadTokens === 0) {
      delete target.modelBreakdown[model];
    } else {
      target.modelBreakdown[model] = current;
    }
  }
}

function usageIsZero(value: UsageData): boolean {
  return value.totalInputTokens === 0 && value.totalOutputTokens === 0 &&
    value.totalCacheCreationTokens === 0 && value.totalCacheReadTokens === 0 &&
    value.messageCount === 0 && Object.keys(value.modelBreakdown).length === 0;
}

function applyBucket(
  buckets: Map<string, UsageData>,
  key: string | undefined,
  contribution: UsageData,
  sign: 1 | -1,
): void {
  if (!key) return;
  const value = cloneUsageData(buckets.get(key) ?? emptyUsageData());
  addUsageData(value, contribution, sign);
  if (usageIsZero(value)) buckets.delete(key);
  else buckets.set(key, value);
}

function applyAggregate(index: ClaudeUsageIndex, record: ClaudeUsageRecord, sign: 1 | -1): void {
  const contribution = ClaudeDataLoader.calculateUsageData([record]);
  addUsageData(index.aggregates.allTime, contribution, sign);
  const date = new Date(record.timestamp);
  const day = dayKeyInZone(date, I18n.getTimezone());
  const month = monthKeyInZone(date, I18n.getTimezone());
  const localDay = localDayKey(date);
  const localHour = localDay
    ? `${localDay}\0${String(date.getHours()).padStart(2, '0')}:00`
    : '';
  const project = record._projectPath || record._projectName || 'unknown';
  const branch = record._gitBranch && record._gitBranch.trim() ? record._gitBranch : '-';
  applyBucket(index.aggregates.byDay, day, contribution, sign);
  applyBucket(index.aggregates.byMonth, month, contribution, sign);
  applyBucket(index.aggregates.byLocalDay, localDay, contribution, sign);
  applyBucket(index.aggregates.byLocalHour, localHour, contribution, sign);
  applyBucket(index.aggregates.bySession, record._sessionId || 'unknown', contribution, sign);
  applyBucket(index.aggregates.byProject, project.toLowerCase(), contribution, sign);
  applyBucket(index.aggregates.byBranch, `${record._projectName || 'unknown'}\0${branch}`, contribution, sign);
  applyBucket(index.aggregates.byWorkflow, record._workflowId, contribution, sign);
}

function membershipKeys(record: ClaudeUsageRecord): {
  session: string;
  project: string;
  branch: string;
  workflow?: string;
  localDay: string;
} {
  const session = record._sessionId || 'unknown';
  const rawProject = record._projectPath || record._projectName || 'unknown';
  const project = ClaudeDataLoader.normalizePath(rawProject);
  const branchName = record._gitBranch && record._gitBranch.trim() ? record._gitBranch : '-';
  const branch = `${record._projectName || 'unknown'}\0${branchName}`;
  const workflow = record._workflowId || (record._agentId ? `adhoc:${session}` : undefined);
  return { session, project, branch, workflow, localDay: localDayKey(new Date(record.timestamp)) };
}

function writableSet(
  map: Map<string, Set<string>>,
  key: string,
  copied: Set<string>,
): Set<string> {
  let keys = map.get(key);
  if (!keys) {
    keys = new Set();
    map.set(key, keys);
    copied.add(key);
  } else if (!copied.has(key)) {
    keys = new Set(keys);
    map.set(key, keys);
    copied.add(key);
  }
  return keys;
}

function addMembership(
  map: Map<string, Set<string>>,
  key: string | undefined,
  visibleKey: string,
  copied: Set<string>,
): void {
  if (!key) return;
  writableSet(map, key, copied).add(visibleKey);
}

function removeMembership(
  map: Map<string, Set<string>>,
  key: string | undefined,
  visibleKey: string,
  copied: Set<string>,
): void {
  if (!key) return;
  if (!map.has(key)) return;
  const keys = writableSet(map, key, copied);
  keys?.delete(visibleKey);
  if (keys?.size === 0) map.delete(key);
}

function markDirty(index: ClaudeUsageIndex, record: ClaudeUsageRecord): void {
  const keys = membershipKeys(record);
  index.dirtyGroups.sessions.add(keys.session);
  index.dirtyGroups.projects.add(keys.project);
  index.dirtyGroups.branches.add(keys.branch);
  if (keys.workflow) index.dirtyGroups.workflows.add(keys.workflow);
}

function addVisibleMembership(index: ClaudeUsageIndex, visibleKey: string, record: ClaudeUsageRecord): void {
  const keys = membershipKeys(record);
  addMembership(index.visibleKeysBySession, keys.session, visibleKey, index.copyOnWrite.visibleSessions);
  addMembership(index.visibleKeysByProject, keys.project, visibleKey, index.copyOnWrite.visibleProjects);
  addMembership(index.visibleKeysByBranch, keys.branch, visibleKey, index.copyOnWrite.visibleBranches);
  addMembership(index.visibleKeysByWorkflow, keys.workflow, visibleKey, index.copyOnWrite.visibleWorkflows);
  addMembership(index.visibleKeysByLocalDay, keys.localDay, visibleKey, index.copyOnWrite.visibleLocalDays);
  markDirty(index, record);
}

function removeVisibleMembership(index: ClaudeUsageIndex, visibleKey: string, record: ClaudeUsageRecord): void {
  const keys = membershipKeys(record);
  removeMembership(index.visibleKeysBySession, keys.session, visibleKey, index.copyOnWrite.visibleSessions);
  removeMembership(index.visibleKeysByProject, keys.project, visibleKey, index.copyOnWrite.visibleProjects);
  removeMembership(index.visibleKeysByBranch, keys.branch, visibleKey, index.copyOnWrite.visibleBranches);
  removeMembership(index.visibleKeysByWorkflow, keys.workflow, visibleKey, index.copyOnWrite.visibleWorkflows);
  removeMembership(index.visibleKeysByLocalDay, keys.localDay, visibleKey, index.copyOnWrite.visibleLocalDays);
  markDirty(index, record);
}

function setVisible(
  index: ClaudeUsageIndex,
  visibleKey: string,
  next: ClaudeUsageRecord | undefined,
): number {
  const previous = index.visibleRecords.get(visibleKey);
  if (previous === next) return 0;
  if (previous) {
    applyAggregate(index, previous, -1);
    removeVisibleMembership(index, visibleKey, previous);
  }
  if (next) {
    index.visibleRecords.set(visibleKey, next);
    applyAggregate(index, next, 1);
    addVisibleMembership(index, visibleKey, next);
  } else {
    index.visibleRecords.delete(visibleKey);
  }
  return 1;
}

function candidateMessageId(value: IndexedRecord): string | null {
  const messageId = value.record.message.id;
  return messageId ? String(messageId) : null;
}

function addCandidate(index: ClaudeUsageIndex, value: IndexedRecord): void {
  const messageId = candidateMessageId(value);
  if (messageId) {
    let values = index.candidatesByMessage.get(messageId);
    if (!values) {
      values = new Map();
      index.candidatesByMessage.set(messageId, values);
      index.copyOnWrite.candidateMessages.add(messageId);
    } else if (!index.copyOnWrite.candidateMessages.has(messageId)) {
      values = new Map(values);
      index.candidatesByMessage.set(messageId, values);
      index.copyOnWrite.candidateMessages.add(messageId);
    }
    values.set(value.localKey, value);
    return;
  }
  const identity = directIdentity(value)!;
  let values = index.candidatesByDirectIdentity.get(identity);
  if (!values) {
    values = new Map();
    index.candidatesByDirectIdentity.set(identity, values);
    index.copyOnWrite.candidateDirect.add(identity);
  } else if (!index.copyOnWrite.candidateDirect.has(identity)) {
    values = new Map(values);
    index.candidatesByDirectIdentity.set(identity, values);
    index.copyOnWrite.candidateDirect.add(identity);
  }
  values.set(value.localKey, value);
}

function removeCandidate(index: ClaudeUsageIndex, value: IndexedRecord): void {
  const messageId = candidateMessageId(value);
  if (messageId) {
    let values = index.candidatesByMessage.get(messageId);
    if (values && !index.copyOnWrite.candidateMessages.has(messageId)) {
      values = new Map(values);
      index.candidatesByMessage.set(messageId, values);
      index.copyOnWrite.candidateMessages.add(messageId);
    }
    values?.delete(value.localKey);
    if (values?.size === 0) index.candidatesByMessage.delete(messageId);
    return;
  }
  const identity = directIdentity(value)!;
  let values = index.candidatesByDirectIdentity.get(identity);
  if (values && !index.copyOnWrite.candidateDirect.has(identity)) {
    values = new Map(values);
    index.candidatesByDirectIdentity.set(identity, values);
    index.copyOnWrite.candidateDirect.add(identity);
  }
  values?.delete(value.localKey);
  if (values?.size === 0) index.candidatesByDirectIdentity.delete(identity);
}

function recomputeMessage(index: ClaudeUsageIndex, messageId: string): number {
  let mutations = 0;
  const priorIdentities = index.canonicalIdentitiesByMessage.get(messageId) ?? new Set<string>();
  for (const identity of priorIdentities) {
    index.canonicalByIdentity.delete(identity);
    mutations += setVisible(index, `usage:${identity}`, undefined);
  }
  const values = index.candidatesByMessage.get(messageId);
  if (!values || values.size === 0) {
    index.canonicalIdentitiesByMessage.delete(messageId);
    return mutations;
  }
  const requestIds = new Set<string>();
  for (const value of values.values()) {
    if (value.record.requestId) requestIds.add(String(value.record.requestId));
  }
  const groups = new Map<string, IndexedRecord[]>();
  for (const value of values.values()) {
    const identity = resolvedMessageIdentity(value, requestIds);
    const group = groups.get(identity) ?? [];
    group.push(value);
    groups.set(identity, group);
  }
  const nextIdentities = new Set<string>();
  for (const [identity, group] of groups) {
    const winner = bestCandidate(group)!;
    index.canonicalByIdentity.set(identity, winner);
    nextIdentities.add(identity);
    mutations += setVisible(index, `usage:${identity}`, winner.record);
  }
  index.canonicalIdentitiesByMessage.set(messageId, nextIdentities);
  return mutations;
}

function recomputeDirectIdentity(index: ClaudeUsageIndex, identity: string): number {
  const previous = index.canonicalByIdentity.get(identity);
  const next = bestCandidate(index.candidatesByDirectIdentity.get(identity)?.values() ?? []);
  if (previous === next) return 0;
  if (next) index.canonicalByIdentity.set(identity, next);
  else index.canonicalByIdentity.delete(identity);
  return setVisible(index, `usage:${identity}`, next?.record);
}

function retagMovedFile(
  prior: ClaudeUsageFileContribution,
  entry: UsageFileFingerprint,
): ClaudeUsageFileContribution {
  const next = cloneFile(prior, entry);
  const oldInfo = ClaudeDataLoader.parseSessionInfo(prior.path);
  const newInfo = ClaudeDataLoader.parseSessionInfo(entry.path);
  const retag = (value: IndexedRecord): IndexedRecord => {
    const record = { ...value.record, message: value.record.message };
    record._sessionId = newInfo.sessionId;
    record._projectDirEncoded = newInfo.projectPath;
    if (record._projectPath === oldInfo.projectPath) {
      record._projectPath = newInfo.projectPath;
      record._projectName = newInfo.projectName;
    }
    return { ...value, discoveryIndex: entry.discoveryIndex, record };
  };
  next.usage = new Map([...prior.usage].map(([key, value]) => [key, retag(value)]));
  next.prompts = new Map([...prior.prompts].map(([key, value]) => [key, retag(value)]));
  return next;
}

function titleForSession(index: ClaudeUsageIndex, sessionId: string): string | undefined {
  let ai: { value: OrderedText; file: ClaudeUsageFileContribution } | undefined;
  let custom: { value: OrderedText; file: ClaudeUsageFileContribution } | undefined;
  const later = (
    left: { value: OrderedText; file: ClaudeUsageFileContribution } | undefined,
    right: { value: OrderedText; file: ClaudeUsageFileContribution },
  ): typeof right => {
    if (!left) return right;
    if (right.file.firstTimestampMs !== left.file.firstTimestampMs) {
      return right.file.firstTimestampMs > left.file.firstTimestampMs ? right : left;
    }
    if (right.file.fingerprint.discoveryIndex !== left.file.fingerprint.discoveryIndex) {
      return right.file.fingerprint.discoveryIndex > left.file.fingerprint.discoveryIndex ? right : left;
    }
    return right.value.endOffset > left.value.endOffset ? right : left;
  };
  for (const file of index.files.values()) {
    if (ClaudeDataLoader.parseSessionInfo(file.path).sessionId !== sessionId) continue;
    if (file.aiTitle) ai = later(ai, { value: file.aiTitle, file });
    if (file.customTitle) custom = later(custom, { value: file.customTitle, file });
  }
  return custom?.value.text ?? ai?.value.text;
}

function refreshSessionTitle(index: ClaudeUsageIndex, sessionId: string): void {
  const title = titleForSession(index, sessionId);
  for (const key of index.visibleKeysBySession.get(sessionId) ?? []) {
    const record = index.visibleRecords.get(key);
    if (!record) continue;
    if (record._sessionTitle === title) continue;
    const next = { ...record };
    if (title) next._sessionTitle = title;
    else delete next._sessionTitle;
    index.visibleRecords.set(key, next);
  }
}

function cloneIndexForCommit(previous: ClaudeUsageIndex): ClaudeUsageIndex {
  return {
    ...previous,
    files: new Map(previous.files),
    candidatesByMessage: new Map(previous.candidatesByMessage),
    candidatesByDirectIdentity: new Map(previous.candidatesByDirectIdentity),
    canonicalByIdentity: new Map(previous.canonicalByIdentity),
    canonicalIdentitiesByMessage: new Map(previous.canonicalIdentitiesByMessage),
    visibleRecords: new Map(previous.visibleRecords),
    visibleKeysBySession: new Map(previous.visibleKeysBySession),
    visibleKeysByProject: new Map(previous.visibleKeysByProject),
    visibleKeysByBranch: new Map(previous.visibleKeysByBranch),
    visibleKeysByWorkflow: new Map(previous.visibleKeysByWorkflow),
    visibleKeysByLocalDay: new Map(previous.visibleKeysByLocalDay),
    sessionRows: new Map(previous.sessionRows),
    projectRows: new Map(previous.projectRows),
    projectSessionIds: new Map(previous.projectSessionIds),
    branchRows: new Map(previous.branchRows),
    workflowRows: new Map(previous.workflowRows),
    costliestBySession: new Map(previous.costliestBySession),
    latestContextBySession: new Map(previous.latestContextBySession),
    sessionWorkspaceKeys: new Map(previous.sessionWorkspaceKeys),
    dirtyGroups: emptyDirtyGroups(),
    copyOnWrite: emptyCopyOnWriteKeys(),
    aggregates: {
      allTime: cloneUsageData(previous.aggregates.allTime),
      byDay: new Map(previous.aggregates.byDay),
      byMonth: new Map(previous.aggregates.byMonth),
      byLocalDay: new Map(previous.aggregates.byLocalDay),
      byLocalHour: new Map(previous.aggregates.byLocalHour),
      bySession: new Map(previous.aggregates.bySession),
      byProject: new Map(previous.aggregates.byProject),
      byBranch: new Map(previous.aggregates.byBranch),
      byWorkflow: new Map(previous.aggregates.byWorkflow),
    },
  };
}

function recordsOf(index: ClaudeUsageIndex): ClaudeUsageRecord[] {
  return [...index.visibleRecords.values()];
}

function recordsForKeys(index: ClaudeUsageIndex, keys?: ReadonlySet<string>): ClaudeUsageRecord[] {
  if (!keys || keys.size === 0) return [];
  const records: ClaudeUsageRecord[] = [];
  for (const key of keys) {
    const record = index.visibleRecords.get(key);
    if (record) records.push(record);
  }
  return records;
}

function contextTokens(record: ClaudeUsageRecord): number {
  const usage = record.message.usage;
  return (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0);
}

function recomputeDerivedRows(index: ClaudeUsageIndex): void {
  for (const sessionId of index.dirtyGroups.sessions) {
    const records = recordsForKeys(index, index.visibleKeysBySession.get(sessionId));
    const row = ClaudeDataLoader.getSessionBreakdown(records, 1)[0];
    if (row) index.sessionRows.set(sessionId, row);
    else index.sessionRows.delete(sessionId);
    const costliest = ClaudeDataLoader.getCostliestMessages(records, 10);
    if (costliest.length > 0) index.costliestBySession.set(sessionId, costliest);
    else index.costliestBySession.delete(sessionId);

    const workspaceKeys = new Set<string>();
    for (const record of records) {
      if (record._projectDirEncoded) workspaceKeys.add(`encoded:${record._projectDirEncoded.toLowerCase()}`);
      if (record._projectPath) workspaceKeys.add(`path:${ClaudeDataLoader.normalizePath(record._projectPath)}`);
    }
    if (workspaceKeys.size > 0) index.sessionWorkspaceKeys.set(sessionId, workspaceKeys);
    else index.sessionWorkspaceKeys.delete(sessionId);

    const contextRecords = records.filter((record) => contextTokens(record) > 0);
    const main = contextRecords.filter((record) => !record._agentId && !record._workflowId);
    const pool = main.length > 0 ? main : contextRecords;
    let latest: ClaudeUsageRecord | undefined;
    for (const record of pool) {
      if (!latest || Date.parse(record.timestamp) > Date.parse(latest.timestamp)) latest = record;
    }
    if (latest) index.latestContextBySession.set(sessionId, latest);
    else index.latestContextBySession.delete(sessionId);
  }

  for (const projectKey of index.dirtyGroups.projects) {
    const records = recordsForKeys(index, index.visibleKeysByProject.get(projectKey));
    if (records.length === 0) {
      index.projectRows.delete(projectKey);
      index.projectSessionIds.delete(projectKey);
      continue;
    }
    const timestamps = records.map((record) => Date.parse(record.timestamp)).filter(Number.isFinite);
    const first = records[0];
    const sessions = new Set(records.map((record) => record._sessionId || 'unknown'));
    index.projectSessionIds.set(projectKey, sessions);
    index.projectRows.set(projectKey, {
      projectName: first._projectName || 'unknown',
      projectPath: first._projectPath || first._projectName || 'unknown',
      sessionCount: sessions.size,
      firstSeen: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date(0),
      lastSeen: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date(0),
      data: ClaudeDataLoader.calculateUsageData(records),
    });
  }

  for (const branchKey of index.dirtyGroups.branches) {
    const records = recordsForKeys(index, index.visibleKeysByBranch.get(branchKey));
    const row = ClaudeDataLoader.getBranchBreakdown(records, 1)[0];
    if (row) index.branchRows.set(branchKey, row);
    else index.branchRows.delete(branchKey);
  }

  for (const workflowKey of index.dirtyGroups.workflows) {
    const records = recordsForKeys(index, index.visibleKeysByWorkflow.get(workflowKey));
    const row = ClaudeDataLoader.getWorkflowBreakdown(records, 50)
      .find((candidate) => candidate.workflowId === workflowKey);
    if (row) index.workflowRows.set(workflowKey, row);
    else index.workflowRows.delete(workflowKey);
  }
  index.dirtyGroups = emptyDirtyGroups();
}

function buildProjectGroups(
  index: ClaudeUsageIndex,
  mode: 'git' | 'folder' | 'flat',
  limit: number = 60,
): ProjectGroup[] {
  const projects = [...index.projectRows.entries()];
  if (projects.length === 0) return [];
  const segmentLists = projects.map(([key]) => key.split('/').filter(Boolean));
  const commonRootLen = ClaudeDataLoader.commonPrefixLength(segmentLists);
  const gitCache = new Map<string, string | null>();
  const groups = new Map<string, {
    displayPath: string;
    isGitRepo: boolean;
    children: ProjectUsage[];
    sessions: Set<string>;
    data: UsageData;
    firstSeen: Date;
    lastSeen: Date;
  }>();

  projects.forEach(([projectKey, project], indexInList) => {
    const segments = segmentLists[indexInList];
    let groupKey: string;
    let displayPath: string;
    let isGitRepo = false;
    if (mode === 'flat') {
      groupKey = segments.join('/');
      displayPath = project.projectPath;
    } else {
      const gitRoot = mode === 'git'
        ? ClaudeDataLoader.resolveGitRoot(project.projectPath, gitCache)
        : null;
      if (gitRoot) {
        groupKey = ClaudeDataLoader.normalizePath(gitRoot);
        displayPath = gitRoot;
        isGitRepo = true;
      } else {
        const groupLength = commonRootLen === 0
          ? segments.length
          : Math.min(segments.length, commonRootLen + 1);
        groupKey = segments.slice(0, groupLength).join('/');
        displayPath = ClaudeDataLoader.deriveGroupDisplayPath(project.projectPath, groupKey);
      }
    }
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        displayPath,
        isGitRepo,
        children: [],
        sessions: new Set(),
        data: emptyUsageData(),
        firstSeen: project.firstSeen,
        lastSeen: project.lastSeen,
      };
      groups.set(groupKey, group);
    }
    group.children.push(project);
    for (const session of index.projectSessionIds.get(projectKey) ?? []) group.sessions.add(session);
    addUsageData(group.data, project.data, 1);
    if (project.firstSeen < group.firstSeen) group.firstSeen = project.firstSeen;
    if (project.lastSeen > group.lastSeen) group.lastSeen = project.lastSeen;
  });

  return [...groups.values()]
    .map((group): ProjectGroup => {
      const pathSegments = group.displayPath.split(/[\\/]/).filter(Boolean);
      return {
        groupName: pathSegments[pathSegments.length - 1] || group.displayPath,
        groupPath: group.displayPath,
        isGitRepo: group.isGitRepo,
        projectCount: group.children.length,
        sessionCount: group.sessions.size,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
        data: group.data,
        children: group.children.sort((left, right) => right.lastSeen.getTime() - left.lastSeen.getTime()),
      };
    })
    .filter((group) => group.data.messageCount > 0)
    .sort((left, right) => right.lastSeen.getTime() - left.lastSeen.getTime())
    .slice(0, limit);
}

function recordMatchesWorkspace(record: ClaudeUsageRecord, workspacePath: string): boolean {
  const normalizedWorkspace = ClaudeDataLoader.normalizePath(workspacePath);
  const encoded = workspacePath.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  if ((record._projectDirEncoded || '').toLowerCase() === encoded) return true;
  const projectPath = ClaudeDataLoader.normalizePath(record._projectPath || '');
  return projectPath.startsWith(normalizedWorkspace) || projectPath === encoded;
}

function sessionMatchesWorkspace(index: ClaudeUsageIndex, sessionId: string, workspacePath: string): boolean {
  const normalizedWorkspace = ClaudeDataLoader.normalizePath(workspacePath);
  const encoded = workspacePath.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  for (const key of index.sessionWorkspaceKeys.get(sessionId) ?? []) {
    if (key === `encoded:${encoded}`) return true;
    if (key.startsWith('path:') && key.slice(5).startsWith(normalizedWorkspace)) return true;
  }
  return false;
}

export function claudeUsageAggregateSnapshot(
  index: ClaudeUsageIndex,
  now: Date = new Date(),
): ClaudeUsageAggregateSnapshot {
  const localToday = localDayKey(now);
  const configuredMonth = monthKeyInZone(now, I18n.getTimezone());
  const dailyForMonth = [...index.aggregates.byDay.entries()]
    .filter(([day]) => day.startsWith(configuredMonth))
    .map(([date, data]) => ({ date, data: cloneUsageData(data) }))
    .sort((left, right) => right.date.localeCompare(left.date));
  const monthlyForAllTime = [...index.aggregates.byMonth.entries()]
    .map(([month, data]) => ({ date: `${month}-01`, data: cloneUsageData(data) }))
    .sort((left, right) => right.date.localeCompare(left.date));
  const hourlyForToday = [...index.aggregates.byLocalHour.entries()]
    .filter(([key]) => key.startsWith(`${localToday}\0`))
    .map(([key, data]) => ({ hour: key.slice(localToday.length + 1), data: cloneUsageData(data) }))
    .sort((left, right) => left.hour.localeCompare(right.hour));
  return {
    today: cloneUsageData(index.aggregates.byLocalDay.get(localToday) ?? emptyUsageData()),
    month: cloneUsageData(index.aggregates.byMonth.get(configuredMonth) ?? emptyUsageData()),
    allTime: cloneUsageData(index.aggregates.allTime),
    dailyForMonth,
    monthlyForAllTime,
    hourlyForToday,
  };
}

export function claudeUsageDashboardSnapshot(
  index: ClaudeUsageIndex,
  options: {
    workspacePath?: string;
    projectGroupingMode?: 'git' | 'folder' | 'flat';
    contextWindowOverride?: number;
    now?: Date;
  } = {},
): ClaudeUsageDashboardSnapshot {
  const now = options.now ?? new Date();
  const aggregates = claudeUsageAggregateSnapshot(index, now);
  const sessions = [...index.sessionRows.values()]
    .sort((left, right) => right.endTime.getTime() - left.endTime.getTime())
    .slice(0, 1000);
  const scopedSessions = options.workspacePath
    ? sessions.filter((session) => sessionMatchesWorkspace(index, session.sessionId, options.workspacePath!))
    : sessions;
  const currentRow = scopedSessions[0] ?? sessions[0];
  const session = currentRow && now.getTime() - currentRow.endTime.getTime() <= 5 * 60 * 60 * 1000
    ? {
        ...cloneUsageData(currentRow.data),
        sessionStart: currentRow.startTime,
        sessionEnd: currentRow.endTime,
      }
    : null;

  let workspaceToday: UsageData | null = null;
  if (options.workspacePath) {
    const todayRecords = recordsForKeys(
      index,
      index.visibleKeysByLocalDay.get(localDayKey(now)),
    ).filter((record) => recordMatchesWorkspace(record, options.workspacePath!));
    workspaceToday = ClaudeDataLoader.calculateUsageData(todayRecords);
  }

  let contexts = [...index.latestContextBySession.entries()];
  if (options.workspacePath) {
    const scoped = contexts.filter(([sessionId]) =>
      sessionMatchesWorkspace(index, sessionId, options.workspacePath!),
    );
    if (scoped.length > 0) contexts = scoped;
  }
  const mainContexts = contexts.filter(([, record]) => !record._agentId && !record._workflowId);
  if (mainContexts.length > 0) contexts = mainContexts;
  const latestContext = contexts
    .map(([, record]) => record)
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  const context = latestContext
    ? ClaudeDataLoader.getCurrentContextInfo(
        [latestContext],
        undefined,
        options.contextWindowOverride ?? 0,
      )
    : null;

  const costliestMessages = [...index.costliestBySession.values()]
    .flat()
    .sort((left, right) => right.cost - left.cost)
    .slice(0, 10);
  return {
    ...aggregates,
    session,
    workspaceToday,
    sessions,
    projects: buildProjectGroups(index, options.projectGroupingMode ?? 'git'),
    branches: [...index.branchRows.values()]
      .sort((left, right) => right.data.totalCost - left.data.totalCost)
      .slice(0, 60),
    workflows: [...index.workflowRows.values()]
      .sort((left, right) => right.endTime.getTime() - left.endTime.getTime())
      .slice(0, 50),
    costliestMessages,
    context,
  };
}

export async function updateClaudeUsageIndex(
  previous: ClaudeUsageIndex,
  root: string,
  options: ClaudeUsageIndexUpdateOptions = {},
): Promise<ClaudeUsageIndexUpdateResult> {
  const started = performance.now();
  const analyzeContent = options.analyzeContent !== false;
  const windowDays = Math.min(365, Math.max(1, Math.round(options.windowDays ?? 30)));
  const analysisCutoffMs = analyzeContent && previous.analyzeContent &&
    previous.windowDays === windowDays && previous.analysisCutoffMs > 0
    ? previous.analysisCutoffMs
    : Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const manifest = options.manifest ?? await scanUsageManifest([root]);
  const currentEntries = [...manifest.entries.values()];
  const previousByPath = new Map([...previous.files.values()].map((file) => [file.path, file]));
  const seenPrevious = new Set<string>();
  const plans: FilePlan[] = [];
  const moves: Array<{ prior: ClaudeUsageFileContribution; entry: UsageFileFingerprint }> = [];
  const changed = { append: 0, rebuild: 0, move: 0, delete: 0 };

  for (const entry of currentEntries) {
    const fileId = stableFileId(entry);
    const sameIdentity = previous.files.get(fileId);
    if (sameIdentity) {
      seenPrevious.add(fileId);
      if (sameIdentity.path !== entry.path) {
        moves.push({ prior: sameIdentity, entry });
        changed.move += 1;
      }
      const needsAnalysisBody = analyzeContent &&
        (!sameIdentity.analysis || sameIdentity.analysis.cutoffMs !== analysisCutoffMs);
      if (sameIdentity.fingerprint.size === entry.size &&
        sameIdentity.fingerprint.mtimeMs === entry.mtimeMs && !needsAnalysisBody) continue;
      if (needsAnalysisBody) {
        plans.push({ kind: 'rebuild', entry, fileId, prior: sameIdentity });
        changed.rebuild += 1;
        continue;
      }
      const append = entry.size > sameIdentity.fingerprint.size &&
        await appendPrefixStillMatches(sameIdentity, entry);
      plans.push({ kind: append ? 'append' : 'rebuild', entry, fileId, prior: sameIdentity });
      changed[append ? 'append' : 'rebuild'] += 1;
      continue;
    }
    const replaced = previousByPath.get(entry.path);
    if (replaced && !seenPrevious.has(replaced.fileId)) {
      seenPrevious.add(replaced.fileId);
      plans.push({ kind: 'rebuild', entry, fileId, prior: replaced, replacedFileId: replaced.fileId });
    } else {
      plans.push({ kind: 'rebuild', entry, fileId });
    }
    changed.rebuild += 1;
  }
  const deletions = [...previous.files.values()].filter((file) => !seenPrevious.has(file.fileId));
  changed.delete = deletions.length;

  if (analyzeContent) {
    const removedOwnedUuids = new Set<string>();
    for (const file of deletions) {
      for (const uuid of file.analysis?.seenUuids ?? []) removedOwnedUuids.add(uuid);
    }
    for (const plan of plans) {
      if (plan.kind !== 'rebuild') continue;
      for (const uuid of plan.prior?.analysis?.seenUuids ?? []) removedOwnedUuids.add(uuid);
    }
    if (removedOwnedUuids.size > 0) {
      const plannedIds = new Set(plans.map((plan) => plan.fileId));
      const deletedIds = new Set(deletions.map((file) => file.fileId));
      for (const entry of currentEntries) {
        const fileId = stableFileId(entry);
        if (plannedIds.has(fileId) || deletedIds.has(fileId)) continue;
        const prior = previous.files.get(fileId);
        if (!prior) continue;
        const canRestoreOwnership = [...prior.analysisAllUuids]
          .some((uuid) => removedOwnedUuids.has(uuid));
        if (!canRestoreOwnership) continue;
        plans.push({ kind: 'rebuild', entry, fileId, prior });
        plannedIds.add(fileId);
      }
    }
  }

  await options.beforeBodyReads?.();
  const parsedPlans: ParsedPlan[] = [];
  let bytesRead = 0;
  let linesParsed = 0;
  try {
    const agentTypeCache = new Map<string, string>();
    const workflowNameCache = new Map<string, string>();
    const analysisSeenUuids = new Set<string>();
    if (analyzeContent) {
      const excluded = new Set<string>([
        ...deletions.map((file) => file.fileId),
        ...plans.flatMap((plan) => plan.kind === 'rebuild' && plan.prior ? [plan.prior.fileId] : []),
      ]);
      for (const file of previous.files.values()) {
        if (excluded.has(file.fileId)) continue;
        for (const uuid of file.analysis?.seenUuids ?? []) analysisSeenUuids.add(uuid);
      }
      const rebuildPlans = plans.filter((plan) => plan.kind === 'rebuild');
      if (rebuildPlans.length > 0) {
        const sorted = await sortUsageFilesByEarliestTimestamp(rebuildPlans.map((plan) => plan.entry));
        const order = new Map(sorted.files.map((file, index) => [file, index]));
        plans.sort((left, right) => {
          if (left.kind !== right.kind) return left.kind === 'rebuild' ? -1 : 1;
          if (left.kind === 'append') return 0;
          return (order.get(left.entry.path) ?? 0) - (order.get(right.entry.path) ?? 0);
        });
      }
    }
    for (const plan of plans) {
      const parsed = await parsePlan(
        plan,
        agentTypeCache,
        workflowNameCache,
        analyzeContent,
        analysisCutoffMs,
        analyzeContent ? analysisSeenUuids : undefined,
      );
      parsedPlans.push(parsed);
      bytesRead += parsed.bytesRead;
      linesParsed += parsed.linesParsed;
    }
  } catch (error) {
    options.log?.(`incremental loader retained the previous snapshot: ${error instanceof Error ? error.name : 'read-error'}`);
    return {
      index: previous,
      records: recordsOf(previous),
      contentAnalysis: previous.contentAnalysis,
      diagnostics: {
        filesDiscovered: manifest.entries.size,
        filesFailed: 1,
        bytesRead,
        linesParsed,
        readParseMs: performance.now() - started,
        bodyReads: parsedPlans.length + 1,
        aggregateMutations: 0,
        changed,
      },
    };
  }

  const next = cloneIndexForCommit(previous);
  next.manifest = manifest;
  next.analyzeContent = analyzeContent;
  next.windowDays = windowDays;
  next.analysisCutoffMs = analyzeContent ? analysisCutoffMs : 0;
  const affectedMessages = new Set<string>();
  const affectedDirect = new Set<string>();
  const affectedSessions = new Set<string>();
  let aggregateMutations = 0;
  const removeFile = (file: ClaudeUsageFileContribution): void => {
    next.files.delete(file.fileId);
    affectedSessions.add(ClaudeDataLoader.parseSessionInfo(file.path).sessionId);
    for (const value of file.usage.values()) {
      const messageId = candidateMessageId(value);
      if (messageId) affectedMessages.add(messageId);
      else affectedDirect.add(directIdentity(value)!);
      removeCandidate(next, value);
    }
    for (const value of file.prompts.values()) {
      aggregateMutations += setVisible(next, `prompt:${value.localKey}`, undefined);
    }
  };
  const addFile = (file: ClaudeUsageFileContribution): void => {
    next.files.set(file.fileId, file);
    affectedSessions.add(ClaudeDataLoader.parseSessionInfo(file.path).sessionId);
    for (const value of file.usage.values()) {
      const messageId = candidateMessageId(value);
      if (messageId) affectedMessages.add(messageId);
      else affectedDirect.add(directIdentity(value)!);
      addCandidate(next, value);
    }
    for (const value of file.prompts.values()) {
      aggregateMutations += setVisible(next, `prompt:${value.localKey}`, value.record);
    }
  };

  for (const deletion of deletions) removeFile(deletion);
  for (const move of moves) {
    if (plans.some((plan) => plan.fileId === move.prior.fileId)) continue;
    removeFile(move.prior);
    addFile(retagMovedFile(move.prior, move.entry));
  }
  for (const plan of parsedPlans) {
    if (plan.kind === 'append' && plan.prior) {
      next.files.set(plan.fileId, plan.contribution);
      affectedSessions.add(ClaudeDataLoader.parseSessionInfo(plan.contribution.path).sessionId);
      for (const [key, value] of plan.contribution.usage) {
        if (plan.prior.usage.has(key)) continue;
        const messageId = candidateMessageId(value);
        if (messageId) affectedMessages.add(messageId);
        else affectedDirect.add(directIdentity(value)!);
        addCandidate(next, value);
      }
      for (const [key, value] of plan.contribution.prompts) {
        if (plan.prior.prompts.has(key)) continue;
        aggregateMutations += setVisible(next, `prompt:${value.localKey}`, value.record);
      }
    } else {
      if (plan.prior) removeFile(plan.prior);
      if (plan.replacedFileId && plan.replacedFileId !== plan.fileId) {
        next.files.delete(plan.replacedFileId);
      }
      addFile(plan.contribution);
    }
  }
  for (const messageId of affectedMessages) aggregateMutations += recomputeMessage(next, messageId);
  for (const identity of affectedDirect) aggregateMutations += recomputeDirectIdentity(next, identity);
  for (const sessionId of affectedSessions) {
    refreshSessionTitle(next, sessionId);
    next.dirtyGroups.sessions.add(sessionId);
  }
  recomputeDerivedRows(next);

  if (!analyzeContent) {
    next.contentAnalysis = null;
  } else {
    const merged = newAnalysisAcc(analysisCutoffMs);
    const orderedFiles = [...next.files.values()].sort((left, right) =>
      left.firstTimestampMs - right.firstTimestampMs ||
      left.fingerprint.discoveryIndex - right.fingerprint.discoveryIndex,
    );
    for (const file of orderedFiles) {
      if (file.analysis) mergeAnalysisAcc(merged, file.analysis);
    }
    next.contentAnalysis = finalizeAnalysisWithCalibration(
      merged,
      recordsOf(next),
      analysisCutoffMs,
    );
  }

  options.log?.(
    `incremental loader: bodies=${parsedPlans.length}, bytes=${bytesRead}, ` +
    `lines=${linesParsed}, aggregate-mutations=${aggregateMutations}`,
  );
  return {
    index: next,
    records: recordsOf(next),
    contentAnalysis: next.contentAnalysis,
    diagnostics: {
      filesDiscovered: manifest.entries.size,
      filesFailed: 0,
      bytesRead,
      linesParsed,
      readParseMs: performance.now() - started,
      bodyReads: parsedPlans.length,
      aggregateMutations,
      changed,
    },
  };
}
