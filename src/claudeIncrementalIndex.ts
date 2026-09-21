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
  AnalysisBucket,
  AnalysisStructuralEvent,
  analyzeLine,
  ClaudeDataLoader,
  finalizeAnalysis,
  mergeAnalysisAcc,
  newAnalysisAcc,
  validateUsageRecord,
} from './dataLoader';
import {
  dayKeyInZone,
  formatHourLabel,
  monthKeyInZone,
  resolveTimeZone,
  rollingDayKeys,
} from './dateKeys';
import { I18n } from './i18n';
import { isRetryDuplicatePrompt } from './promptDedup';
import {
  buildProjectUsageMatrixSnapshot,
  ProjectUsageMatrixSnapshot,
} from './projectUsageMatrix';
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
const ANALYSIS_PROMPT_ACC_LIMIT = 600;
const ANALYSIS_SKILL_USE_LIMIT = 5_000;
const ANALYSIS_UUID_LAYER_LIMIT = 64;

type AnalysisPrompt = AnalysisAcc['prompts'][number];
type AnalysisSkillUse = AnalysisAcc['skillUses'][number];

interface TaggedAnalysisPrompt {
  fileId: string;
  position: number;
  value: AnalysisPrompt;
}

interface TaggedAnalysisSkillUse {
  fileId: string;
  position: number;
  baseValue: AnalysisSkillUse;
  value: AnalysisSkillUse;
  preambleCount: number;
  toolId?: string;
}

type AnalysisToolEvent = Exclude<AnalysisStructuralEvent, { kind: 'command' }>;

interface TaggedAnalysisToolEvent {
  fileId: string;
  position: number;
  value: AnalysisToolEvent;
}

interface ResolvedToolBucket {
  bucket: AnalysisBucket;
  firstEvent: TaggedAnalysisToolEvent;
}

interface ToolBucketContributor {
  toolId: string;
  firstEvent: TaggedAnalysisToolEvent;
}

interface AnalysisCalibration {
  realOutputTokens: number;
  realInputSideTokens: number;
}

/**
 * Transient, process-local state for the materialized content view. Keeping it
 * outside the exported index contract preserves the established public types
 * and avoids retaining any new raw conversation content.
 */
interface AnalysisRuntimeState {
  asOfDay: string;
  cutoffMs: number;
  orderedFileIds: string[];
  filePositionById: ReadonlyMap<string, number>;
  merged: AnalysisAcc;
  promptTail: TaggedAnalysisPrompt[];
  skillHead: TaggedAnalysisSkillUse[];
  calibration: AnalysisCalibration;
  calibrationOldestTimestampMs?: number;
  uuidLayers: ReadonlySet<string>[];
  firstUuidFileByUuid: ReadonlyMap<string, string>;
  toolEventsById: ReadonlyMap<string, readonly TaggedAnalysisToolEvent[]>;
  toolBucketsById: ReadonlyMap<string, ReadonlyMap<string, ResolvedToolBucket>>;
  firstToolResultByName: ReadonlyMap<string, TaggedAnalysisToolEvent>;
  toolContributorsByName: ReadonlyMap<string, readonly ToolBucketContributor[]>;
}

const analysisRuntimeByIndex = new WeakMap<ClaudeUsageIndex, AnalysisRuntimeState>();

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
  acceptedValidEof: boolean;
  firstTimestampMs: number;
  recentPrompts: Map<string, number>;
  usage: Map<string, IndexedRecord>;
  prompts: Map<string, IndexedRecord>;
  aiTitle?: OrderedText;
  customTitle?: OrderedText;
  agentTask?: string;
  analysis: AnalysisAcc | null;
  analysisAllUuids: Set<string>;
  /** Complete timestamp envelope for lines that can affect analysis or UUID
   * ownership. It lets a moving cutoff clear/retain whole files without a body
   * read; older in-memory indexes without this marker take one rebuild pass. */
  analysisRangeComplete: boolean;
  analysisFirstTimestampMs?: number;
  analysisLastTimestampMs?: number;
  /** Oldest finite timestamp that was actually admitted by the contribution's
   * cutoff and UUID ownership state. A newer cutoff can reuse the contribution
   * until it crosses this timestamp. */
  analysisOldestIncludedTimestampMs?: number;
  analysisHasUnboundedTimestamp: boolean;
}

interface UsageAggregates {
  allTime: UsageData;
  byDay: Map<string, UsageData>;
  byMonth: Map<string, UsageData>;
  byLocalDay: Map<string, UsageData>;
  byLocalHour: Map<string, UsageData>;
  /** Bounded configured-day project buckets used by the Projects matrix. */
  byProjectDay: Map<string, UsageData>;
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

interface ConfiguredTimeKeyers {
  formatter: Intl.DateTimeFormat;
  hourWindowStartDay: string;
  projectWindowStartDay: string;
}

export interface ClaudeUsageIndex {
  /** Canonical configured zone used by every materialized calendar bucket. */
  timeZone: string;
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
  /** Transient formatter/cache state; never persisted with the index. */
  timeKeyers: ConfiguredTimeKeyers;
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
  /** Rolling 30 local calendar days, including the snapshot day. This is kept
   * separate from `month` because the status bar's monthly-cost metric is a
   * true calendar-month total while the dashboard range is rolling. */
  last30Days: UsageData;
  month: UsageData;
  allTime: UsageData;
  dailyForLast30Days: { date: string; data: UsageData }[];
  dailyForMonth: { date: string; data: UsageData }[];
  monthlyForAllTime: { date: string; data: UsageData }[];
  hourlyForToday: { hour: string; data: UsageData }[];
  /** Sparse, already-materialized hours for active days in the rolling
   * 30-day dashboard range. The Webview may complete the 24-hour presentation
   * without asking the host to regroup records when a day is expanded. */
  hourlyForLast30DaysByDay: Record<string, { hour: string; data: UsageData }[]>;
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
  projectUsageMatrix: ProjectUsageMatrixSnapshot;
  /** Present only for the default-off advice capability; built from materialized aggregates. */
  adviceWindow?: {
    windowDays: number;
    aggregate: UsageData;
    totalSessions: number;
    longSessionCount: number;
    largeContextSessionCount: number;
  };
}

interface FilePlan {
  kind: 'append' | 'rebuild';
  analysisReason?: 'source' | 'cutoff' | 'ownership' | 'full';
  entry: UsageFileFingerprint;
  fileId: string;
  orderTimestampMs?: number;
  prior?: ClaudeUsageFileContribution;
  replacedFileId?: string;
}

function sameAnalysisPayload(
  left: ClaudeUsageFileContribution,
  right: ClaudeUsageFileContribution,
): boolean {
  if (!left.analysis || !right.analysis) return left.analysis === right.analysis;
  // Metadata-only cutoff rebases shallow-copy AnalysisAcc and retain every
  // payload collection. An empty/changed contribution gets fresh collections.
  return left.analysis.cat === right.analysis.cat &&
    left.analysis.tools === right.analysis.tools &&
    left.analysis.seenUuids === right.analysis.seenUuids &&
    left.analysis.prompts === right.analysis.prompts &&
    left.analysis.skillUses === right.analysis.skillUses;
}

interface ParsedPlan extends FilePlan {
  contribution: ClaudeUsageFileContribution;
  analysisTouchedUuids: Set<string>;
  analysisTouchedToolIds: Set<string>;
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
    byProjectDay: new Map(),
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

function createConfiguredTimeKeyers(timeZone: string, now = Date.now()): ConfiguredTimeKeyers {
  const resolved = resolveTimeZone(timeZone);
  return {
    formatter: new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: resolved,
    }),
    hourWindowStartDay: rollingDayKeys(now, resolved, 30)[0] ?? '',
    projectWindowStartDay: rollingDayKeys(now, resolved, 90)[0] ?? '',
  };
}

export function createClaudeUsageIndex(): ClaudeUsageIndex {
  const timeZone = resolveTimeZone(I18n.getTimezone());
  return {
    timeZone,
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
    timeKeyers: createConfiguredTimeKeyers(timeZone),
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

async function appendBoundaryStillMatches(
  prior: ClaudeUsageFileContribution,
  entry: UsageFileFingerprint,
): Promise<boolean> {
  if (!prior.acceptedValidEof) return true;
  try {
    const handle = await open(entry.path, 'r');
    try {
      const buffer = Buffer.allocUnsafe(Math.min(2, entry.size - prior.offset));
      const result = await handle.read(buffer, 0, buffer.length, prior.offset);
      if (result.bytesRead < 1) return false;
      return buffer[0] === 0x0a ||
        (buffer[0] === 0x0d && result.bytesRead > 1 && buffer[1] === 0x0a);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function isValidJsonLine(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
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
    skillPreambleCounts: [...value.skillPreambleCounts],
    skillByToolId: { ...value.skillByToolId },
    frameworkOverhead: Object.fromEntries(
      Object.entries(value.frameworkOverhead).map(([key, bucket]) => [key, { ...bucket }]),
    ),
    observedInputEstimatedTokens: value.observedInputEstimatedTokens,
    userAuthoredEstimatedTokens: value.userAuthoredEstimatedTokens,
    toolResultEstimatedTokens: value.toolResultEstimatedTokens,
    ...(value.structuralEvents
      ? {
          structuralEvents: value.structuralEvents.map((event) => event.kind === 'tool-use'
            ? {
                ...event,
                ...(event.skillUse ? { skillUse: { ...event.skillUse } } : {}),
              }
            : event.kind === 'command'
              ? { ...event, skillUse: { ...event.skillUse } }
              : { ...event }),
        }
      : {}),
  };
}

class LayeredAnalysisSeenUuids extends Set<string> {
  constructor(
    private readonly layers: readonly ReadonlySet<string>[],
    readonly additions: Set<string>,
  ) {
    super();
  }

  has(value: string): boolean {
    if (this.additions.has(value)) return true;
    for (let index = this.layers.length - 1; index >= 0; index -= 1) {
      if (this.layers[index].has(value)) return true;
    }
    return false;
  }

  add(value: string): this {
    if (!this.has(value)) this.additions.add(value);
    return this;
  }
}

function analysisFilesInOrder(index: ClaudeUsageIndex): ClaudeUsageFileContribution[] {
  return [...index.files.values()].sort((left, right) =>
    left.firstTimestampMs - right.firstTimestampMs ||
    left.fingerprint.discoveryIndex - right.fingerprint.discoveryIndex,
  );
}

function mergeAnalysisWithoutUuids(target: AnalysisAcc, source: AnalysisAcc): void {
  const frameworkOverhead = { ...source.frameworkOverhead };
  delete frameworkOverhead['skill-preamble'];
  mergeAnalysisAcc(target, {
    ...source,
    tools: {},
    seenUuids: new Set<string>(),
    skillUses: [],
    skillPreambleCounts: [],
    frameworkOverhead,
  });
}

function taggedOrder(
  orderedFileIds: readonly string[],
): (left: { fileId: string; position: number }, right: { fileId: string; position: number }) => number {
  const order = new Map(orderedFileIds.map((fileId, index) => [fileId, index]));
  return (left, right) =>
    (order.get(left.fileId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.fileId) ?? Number.MAX_SAFE_INTEGER) ||
    left.position - right.position;
}

function skillKey(value: Pick<TaggedAnalysisSkillUse, 'fileId' | 'position'>): string {
  return `${value.fileId}\0${value.position}`;
}

function skillCandidates(
  fileId: string,
  analysis: AnalysisAcc,
): TaggedAnalysisSkillUse[] {
  const candidates: TaggedAnalysisSkillUse[] = [];
  for (const [position, event] of (analysis.structuralEvents ?? []).entries()) {
    const baseValue = event.kind === 'command'
      ? event.skillUse
      : event.kind === 'tool-use'
        ? event.skillUse
        : undefined;
    if (!baseValue) continue;
    candidates.push({
      fileId,
      position,
      baseValue: { ...baseValue },
      value: { ...baseValue },
      preambleCount: 0,
      ...(event.kind === 'tool-use' ? { toolId: event.toolId } : {}),
    });
  }
  return candidates;
}

function resolveToolBuckets(
  events: readonly TaggedAnalysisToolEvent[],
): Map<string, ResolvedToolBucket> {
  const resolved = new Map<string, ResolvedToolBucket>();
  let toolName = 'unknown';
  for (const event of events) {
    if (event.value.kind === 'tool-use') {
      toolName = event.value.toolName;
      continue;
    }
    if (event.value.count === 0) continue;
    const current = resolved.get(toolName) ?? {
      bucket: { tokens: 0, chars: 0, count: 0 },
      firstEvent: event,
    };
    current.bucket.tokens += event.value.tokens;
    current.bucket.chars += event.value.chars;
    current.bucket.count += event.value.count;
    resolved.set(toolName, current);
  }
  return resolved;
}

function materializeToolBuckets(
  target: AnalysisAcc,
  bucketsById: ReadonlyMap<string, ReadonlyMap<string, ResolvedToolBucket>>,
  orderedFileIds: readonly string[],
): {
  firstByName: Map<string, TaggedAnalysisToolEvent>;
  contributorsByName: Map<string, readonly ToolBucketContributor[]>;
} {
  const totals = new Map<string, AnalysisBucket>();
  const firstByName = new Map<string, TaggedAnalysisToolEvent>();
  const contributorsByName = new Map<string, ToolBucketContributor[]>();
  const compare = taggedOrder(orderedFileIds);
  for (const [toolId, buckets] of bucketsById) {
    for (const [name, resolved] of buckets) {
      const total = totals.get(name) ?? { tokens: 0, chars: 0, count: 0 };
      total.tokens += resolved.bucket.tokens;
      total.chars += resolved.bucket.chars;
      total.count += resolved.bucket.count;
      totals.set(name, total);
      const first = firstByName.get(name);
      if (!first || compare(resolved.firstEvent, first) < 0) {
        firstByName.set(name, resolved.firstEvent);
      }
      const contributors = contributorsByName.get(name) ?? [];
      contributors.push({ toolId, firstEvent: resolved.firstEvent });
      contributorsByName.set(name, contributors);
    }
  }
  target.tools = {};
  for (const [name, bucket] of [...totals].sort((left, right) =>
    compare(firstByName.get(left[0])!, firstByName.get(right[0])!))) {
    target.tools[name] = bucket;
  }
  for (const contributors of contributorsByName.values()) {
    contributors.sort((left, right) =>
      compare(left.firstEvent, right.firstEvent) || left.toolId.localeCompare(right.toolId));
  }
  return { firstByName, contributorsByName };
}

function resolveSkillPreambles(
  skillHead: TaggedAnalysisSkillUse[],
  eventsById: ReadonlyMap<string, readonly TaggedAnalysisToolEvent[]>,
  onlyToolIds?: ReadonlySet<string>,
): void {
  const selected = new Map(skillHead.map((entry) => [skillKey(entry), entry]));
  for (const entry of skillHead) {
    if (!entry.toolId || (onlyToolIds && !onlyToolIds.has(entry.toolId))) continue;
    entry.value = { ...entry.baseValue };
    entry.preambleCount = 0;
  }
  const toolIds: Iterable<string> = onlyToolIds ?? eventsById.keys();
  for (const toolId of toolIds) {
    const events = eventsById.get(toolId) ?? [];
    let active: TaggedAnalysisSkillUse | undefined;
    for (const event of events) {
      if (event.value.kind === 'tool-use') {
        const candidate = selected.get(`${event.fileId}\0${event.position}`);
        if (candidate) active = candidate;
      } else if (active) {
        active.value.estTokens += event.value.tokens;
        active.preambleCount += 1;
      }
    }
  }
}

function calibrationContribution(
  record: ClaudeUsageRecord | undefined,
  cutoffMs: number,
): AnalysisCalibration {
  if (!record || record._isUserPrompt) {
    return { realOutputTokens: 0, realInputSideTokens: 0 };
  }
  const timestamp = Date.parse(record.timestamp);
  if (!Number.isFinite(timestamp) || timestamp < cutoffMs) {
    return { realOutputTokens: 0, realInputSideTokens: 0 };
  }
  const usage = record.message.usage;
  return {
    realOutputTokens: usage.output_tokens || 0,
    realInputSideTokens: (usage.input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0),
  };
}

function calibrationFromRecords(
  records: Iterable<ClaudeUsageRecord>,
  cutoffMs: number,
): { calibration: AnalysisCalibration; oldestTimestampMs?: number } {
  const calibration = { realOutputTokens: 0, realInputSideTokens: 0 };
  let oldestTimestampMs: number | undefined;
  for (const record of records) {
    const contribution = calibrationContribution(record, cutoffMs);
    calibration.realOutputTokens += contribution.realOutputTokens;
    calibration.realInputSideTokens += contribution.realInputSideTokens;
    if (contribution.realOutputTokens > 0 || contribution.realInputSideTokens > 0) {
      const timestampMs = Date.parse(record.timestamp);
      if (Number.isFinite(timestampMs)) {
        oldestTimestampMs = oldestTimestampMs === undefined
          ? timestampMs
          : Math.min(oldestTimestampMs, timestampMs);
      }
    }
  }
  return { calibration, oldestTimestampMs };
}

function finalizeMaterializedAnalysis(state: AnalysisRuntimeState): ContentAnalysis {
  const contentAnalysis = finalizeAnalysis(state.merged);
  contentAnalysis.recentPrompts = contentAnalysis.recentPrompts.map((prompt) => ({ ...prompt }));
  contentAnalysis.thinkingBySession = Object.fromEntries(
    Object.entries(contentAnalysis.thinkingBySession).map(([key, value]) => [key, { ...value }]),
  );
  contentAnalysis.thinkingByDay = Object.fromEntries(
    Object.entries(contentAnalysis.thinkingByDay).map(([key, value]) => [key, { ...value }]),
  );
  contentAnalysis.skillUses = contentAnalysis.skillUses.map((use) => ({ ...use }));
  if (state.calibration.realOutputTokens > 0 || state.calibration.realInputSideTokens > 0) {
    contentAnalysis.calibration = { ...state.calibration };
  }
  return contentAnalysis;
}

function buildAnalysisRuntimeState(
  index: ClaudeUsageIndex,
  asOfDay: string,
  cutoffMs: number,
): AnalysisRuntimeState {
  const merged = newAnalysisAcc(cutoffMs);
  const promptTail: TaggedAnalysisPrompt[] = [];
  const skillHead: TaggedAnalysisSkillUse[] = [];
  const seenUuids = new Set<string>();
  const orderedFiles = analysisFilesInOrder(index);
  const orderedFileIds = orderedFiles.map((file) => file.fileId);
  const filePositionById = new Map(orderedFileIds.map((fileId, position) => [fileId, position]));
  const firstUuidFileByUuid = new Map<string, string>();
  const toolEventsById = new Map<string, TaggedAnalysisToolEvent[]>();
  for (const file of orderedFiles) {
    if (!file.analysis) continue;
    mergeAnalysisWithoutUuids(merged, file.analysis);
    for (const [position, value] of file.analysis.prompts.entries()) {
      promptTail.push({ fileId: file.fileId, position, value: { ...value } });
      if (promptTail.length > ANALYSIS_PROMPT_ACC_LIMIT) promptTail.shift();
    }
    for (const uuid of file.analysis.seenUuids) {
      if (!firstUuidFileByUuid.has(uuid)) firstUuidFileByUuid.set(uuid, file.fileId);
    }
    for (const [position, event] of (file.analysis.structuralEvents ?? []).entries()) {
      if (event.kind === 'command') continue;
      const tagged: TaggedAnalysisToolEvent = { fileId: file.fileId, position, value: event };
      const events = toolEventsById.get(event.toolId) ?? [];
      events.push(tagged);
      toolEventsById.set(event.toolId, events);
    }
    if (skillHead.length < ANALYSIS_SKILL_USE_LIMIT) {
      skillHead.push(...skillCandidates(file.fileId, file.analysis)
        .slice(0, ANALYSIS_SKILL_USE_LIMIT - skillHead.length));
    }
    for (const uuid of file.analysis.seenUuids) seenUuids.add(uuid);
  }
  const toolBucketsById = new Map<string, ReadonlyMap<string, ResolvedToolBucket>>();
  for (const [toolId, events] of toolEventsById) {
    toolBucketsById.set(toolId, resolveToolBuckets(events));
  }
  const toolMaterialization = materializeToolBuckets(
    merged,
    toolBucketsById,
    orderedFileIds,
  );
  resolveSkillPreambles(skillHead, toolEventsById);
  merged.seenUuids = new Set<string>();
  merged.prompts = promptTail.map((entry) => ({ ...entry.value }));
  applySkillHead(merged, skillHead);
  const calibrationState = calibrationFromRecords(index.visibleRecords.values(), cutoffMs);
  return {
    asOfDay,
    cutoffMs,
    orderedFileIds,
    filePositionById,
    merged,
    promptTail,
    skillHead,
    calibration: calibrationState.calibration,
    calibrationOldestTimestampMs: calibrationState.oldestTimestampMs,
    uuidLayers: [seenUuids],
    firstUuidFileByUuid,
    toolEventsById,
    toolBucketsById,
    firstToolResultByName: toolMaterialization.firstByName,
    toolContributorsByName: toolMaterialization.contributorsByName,
  };
}

function addBucketDelta(
  target: Record<string, { tokens: number; chars: number; count: number }>,
  before: Readonly<Record<string, { tokens: number; chars: number; count: number }>>,
  after: Readonly<Record<string, { tokens: number; chars: number; count: number }>>,
): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const prior = before[key] ?? { tokens: 0, chars: 0, count: 0 };
    const next = after[key] ?? { tokens: 0, chars: 0, count: 0 };
    const current = target[key] ?? { tokens: 0, chars: 0, count: 0 };
    current.tokens += next.tokens - prior.tokens;
    current.chars += next.chars - prior.chars;
    current.count += next.count - prior.count;
    if (current.tokens === 0 && current.chars === 0 && current.count === 0) delete target[key];
    else target[key] = current;
  }
}

function addThinkingDelta(
  target: AnalysisAcc['thinkingBySession'],
  before: AnalysisAcc['thinkingBySession'],
  after: AnalysisAcc['thinkingBySession'],
): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const prior = before[key] ?? { thinking: 0, assistantTotal: 0 };
    const next = after[key] ?? { thinking: 0, assistantTotal: 0 };
    const current = target[key] ?? { thinking: 0, assistantTotal: 0 };
    current.thinking += next.thinking - prior.thinking;
    current.assistantTotal += next.assistantTotal - prior.assistantTotal;
    if (next.hiddenThinking) current.hiddenThinking = true;
    if (current.thinking === 0 && current.assistantTotal === 0 && !current.hiddenThinking) delete target[key];
    else target[key] = current;
  }
}

function addFrameworkDelta(
  target: AnalysisAcc['frameworkOverhead'],
  before: AnalysisAcc['frameworkOverhead'],
  after: AnalysisAcc['frameworkOverhead'],
): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof typeof target>) {
    if (key === 'skill-preamble') continue;
    const prior = before[key] ?? { tokens: 0, count: 0 };
    const next = after[key] ?? { tokens: 0, count: 0 };
    const current = target[key] ?? { tokens: 0, count: 0 };
    current.tokens += next.tokens - prior.tokens;
    current.count += next.count - prior.count;
    if (current.tokens === 0 && current.count === 0) delete target[key];
    else target[key] = current;
  }
}

function applySkillHead(
  target: AnalysisAcc,
  skillHead: readonly TaggedAnalysisSkillUse[],
): void {
  target.skillUses = skillHead.map((entry) => ({ ...entry.value }));
  target.skillPreambleCounts = skillHead.map((entry) => entry.preambleCount);
  delete target.frameworkOverhead['skill-preamble'];
  for (const entry of skillHead) {
    if (entry.preambleCount <= 0) continue;
    const current = target.frameworkOverhead['skill-preamble'] ?? { tokens: 0, count: 0 };
    current.tokens += entry.value.estTokens;
    current.count += entry.preambleCount;
    target.frameworkOverhead['skill-preamble'] = current;
  }
}

function addAppendAnalysisDelta(
  target: AnalysisAcc,
  before: AnalysisAcc,
  after: AnalysisAcc,
): void {
  addBucketDelta(target.cat, before.cat, after.cat);
  addThinkingDelta(target.thinkingBySession, before.thinkingBySession, after.thinkingBySession);
  addThinkingDelta(target.thinkingByDay, before.thinkingByDay, after.thinkingByDay);
  addFrameworkDelta(target.frameworkOverhead, before.frameworkOverhead, after.frameworkOverhead);
  target.observedInputEstimatedTokens +=
    after.observedInputEstimatedTokens - before.observedInputEstimatedTokens;
  target.userAuthoredEstimatedTokens +=
    after.userAuthoredEstimatedTokens - before.userAuthoredEstimatedTokens;
  target.toolResultEstimatedTokens +=
    after.toolResultEstimatedTokens - before.toolResultEstimatedTokens;
}

function refreshedPromptTail(
  state: AnalysisRuntimeState,
  appended: ReadonlyMap<string, AnalysisAcc>,
): TaggedAnalysisPrompt[] {
  const order = new Map(state.orderedFileIds.map((fileId, index) => [fileId, index]));
  const candidates = state.promptTail.filter((entry) => !appended.has(entry.fileId));
  for (const [fileId, analysis] of appended) {
    for (const [position, value] of analysis.prompts.entries()) {
      candidates.push({ fileId, position, value: { ...value } });
    }
  }
  candidates.sort((left, right) =>
    (order.get(left.fileId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.fileId) ?? Number.MAX_SAFE_INTEGER) ||
    left.position - right.position,
  );
  return candidates.slice(-ANALYSIS_PROMPT_ACC_LIMIT);
}

function refreshedSkillHead(
  state: AnalysisRuntimeState,
  appended: ReadonlyMap<string, AnalysisAcc>,
): TaggedAnalysisSkillUse[] {
  const compare = taggedOrder(state.orderedFileIds);
  const candidates = state.skillHead
    .filter((entry) => !appended.has(entry.fileId))
    .map((entry) => ({
      ...entry,
      baseValue: { ...entry.baseValue },
      value: { ...entry.value },
    }));
  for (const [fileId, analysis] of appended) {
    candidates.push(...skillCandidates(fileId, analysis));
  }
  candidates.sort(compare);
  return candidates.slice(0, ANALYSIS_SKILL_USE_LIMIT);
}

function resolvedBucketRecord(
  buckets: ReadonlyMap<string, ResolvedToolBucket> | undefined,
): Record<string, AnalysisBucket> {
  return Object.fromEntries(
    [...(buckets ?? [])].map(([name, value]) => [name, value.bucket]),
  );
}

function lowerBoundContributor(
  values: readonly ToolBucketContributor[],
  target: ToolBucketContributor,
  compare: (left: ToolBucketContributor, right: ToolBucketContributor) => number,
): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (compare(values[middle], target) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function reorderToolBuckets(
  target: AnalysisAcc,
  firstByName: ReadonlyMap<string, TaggedAnalysisToolEvent>,
  orderedFileIds: readonly string[],
): void {
  const compare = taggedOrder(orderedFileIds);
  const ordered = Object.entries(target.tools).sort(([left], [right]) => {
    const leftEvent = firstByName.get(left);
    const rightEvent = firstByName.get(right);
    if (leftEvent && rightEvent) return compare(leftEvent, rightEvent);
    if (leftEvent) return -1;
    if (rightEvent) return 1;
    return left.localeCompare(right);
  });
  target.tools = Object.fromEntries(ordered);
}

function refreshedStructuralRuntime(
  state: AnalysisRuntimeState,
  merged: AnalysisAcc,
  appended: ReadonlyMap<string, AnalysisAcc>,
  touchedToolIds: ReadonlySet<string>,
): Pick<
  AnalysisRuntimeState,
  'skillHead' | 'toolEventsById' | 'toolBucketsById' |
  'firstToolResultByName' | 'toolContributorsByName'
> {
  const changedFileIds = new Set(appended.keys());
  const compare = taggedOrder(state.orderedFileIds);
  const compareContributor = (left: ToolBucketContributor, right: ToolBucketContributor): number =>
    compare(left.firstEvent, right.firstEvent) || left.toolId.localeCompare(right.toolId);
  const toolEventsById = new Map(state.toolEventsById);
  const toolBucketsById = new Map(state.toolBucketsById);
  const toolContributorsByName = new Map(state.toolContributorsByName);
  const copiedContributorNames = new Set<string>();
  const affectedToolNames = new Set<string>();
  const appendedEventsById = new Map<string, TaggedAnalysisToolEvent[]>();
  for (const [fileId, analysis] of appended) {
    for (const [position, event] of (analysis.structuralEvents ?? []).entries()) {
      if (event.kind === 'command' || !touchedToolIds.has(event.toolId)) continue;
      const events = appendedEventsById.get(event.toolId) ?? [];
      events.push({ fileId, position, value: event });
      appendedEventsById.set(event.toolId, events);
    }
  }
  const writableContributors = (name: string): ToolBucketContributor[] => {
    const existing = toolContributorsByName.get(name);
    if (copiedContributorNames.has(name) && existing) {
      return existing as ToolBucketContributor[];
    }
    const copied = [...(existing ?? [])];
    toolContributorsByName.set(name, copied);
    copiedContributorNames.add(name);
    return copied;
  };
  const removeContributor = (name: string, contributor: ToolBucketContributor): void => {
    const values = writableContributors(name);
    const index = lowerBoundContributor(values, contributor, compareContributor);
    if (index < values.length && compareContributor(values[index], contributor) === 0) {
      values.splice(index, 1);
    }
    if (values.length === 0) toolContributorsByName.delete(name);
    affectedToolNames.add(name);
  };
  const addContributor = (name: string, contributor: ToolBucketContributor): void => {
    const values = writableContributors(name);
    const index = lowerBoundContributor(values, contributor, compareContributor);
    values.splice(index, 0, contributor);
    affectedToolNames.add(name);
  };
  for (const toolId of touchedToolIds) {
    const priorBuckets = state.toolBucketsById.get(toolId);
    const events = (state.toolEventsById.get(toolId) ?? [])
      .filter((event) => !changedFileIds.has(event.fileId))
      .map((event) => ({ ...event, value: { ...event.value } } as TaggedAnalysisToolEvent));
    events.push(...(appendedEventsById.get(toolId) ?? []));
    events.sort(compare);
    const nextBuckets = resolveToolBuckets(events);
    addBucketDelta(
      merged.tools,
      resolvedBucketRecord(priorBuckets),
      resolvedBucketRecord(nextBuckets),
    );
    for (const [name, value] of priorBuckets ?? []) {
      removeContributor(name, { toolId, firstEvent: value.firstEvent });
    }
    for (const [name, value] of nextBuckets) {
      addContributor(name, { toolId, firstEvent: value.firstEvent });
    }
    if (events.length > 0) {
      toolEventsById.set(toolId, events);
      toolBucketsById.set(toolId, nextBuckets);
    } else {
      toolEventsById.delete(toolId);
      toolBucketsById.delete(toolId);
    }
  }

  const previousHeadByKey = new Map(state.skillHead.map((entry) => [skillKey(entry), entry]));
  const skillHead = refreshedSkillHead(state, appended);
  const affectedSkillToolIds = new Set(touchedToolIds);
  const previousKeysByTool = new Map<string, string[]>();
  const nextKeysByTool = new Map<string, string[]>();
  for (const entry of state.skillHead) {
    if (!entry.toolId) continue;
    const keys = previousKeysByTool.get(entry.toolId) ?? [];
    keys.push(skillKey(entry));
    previousKeysByTool.set(entry.toolId, keys);
  }
  for (const entry of skillHead) {
    if (!entry.toolId) continue;
    const keys = nextKeysByTool.get(entry.toolId) ?? [];
    keys.push(skillKey(entry));
    nextKeysByTool.set(entry.toolId, keys);
  }
  for (const toolId of new Set([...previousKeysByTool.keys(), ...nextKeysByTool.keys()])) {
    if ((previousKeysByTool.get(toolId) ?? []).join('\0') !==
      (nextKeysByTool.get(toolId) ?? []).join('\0')) {
      affectedSkillToolIds.add(toolId);
    }
  }
  for (const entry of skillHead) {
    if (!entry.toolId || affectedSkillToolIds.has(entry.toolId)) continue;
    const previous = previousHeadByKey.get(skillKey(entry));
    if (previous) {
      entry.value = { ...previous.value };
      entry.preambleCount = previous.preambleCount;
    }
  }
  resolveSkillPreambles(skillHead, toolEventsById, affectedSkillToolIds);

  const firstToolResultByName = new Map(state.firstToolResultByName);
  for (const name of affectedToolNames) {
    const first = toolContributorsByName.get(name)?.[0]?.firstEvent;
    if (first) firstToolResultByName.set(name, first);
    else firstToolResultByName.delete(name);
  }
  reorderToolBuckets(merged, firstToolResultByName, state.orderedFileIds);
  return {
    skillHead,
    toolEventsById,
    toolBucketsById,
    firstToolResultByName,
    toolContributorsByName,
  };
}

function appendCalibration(
  previous: ClaudeUsageIndex,
  next: ClaudeUsageIndex,
  prior: AnalysisCalibration,
  priorOldestTimestampMs: number | undefined,
  affectedMessages: ReadonlySet<string>,
  affectedDirect: ReadonlySet<string>,
  cutoffMs: number,
): { calibration: AnalysisCalibration; oldestTimestampMs?: number } {
  const keys = new Set<string>();
  for (const messageId of affectedMessages) {
    for (const identity of previous.canonicalIdentitiesByMessage.get(messageId) ?? []) {
      keys.add(`usage:${identity}`);
    }
    for (const identity of next.canonicalIdentitiesByMessage.get(messageId) ?? []) {
      keys.add(`usage:${identity}`);
    }
  }
  for (const identity of affectedDirect) keys.add(`usage:${identity}`);
  const calibration = { ...prior };
  let oldestTimestampMs = priorOldestTimestampMs;
  for (const key of keys) {
    const before = calibrationContribution(previous.visibleRecords.get(key), cutoffMs);
    const afterRecord = next.visibleRecords.get(key);
    const after = calibrationContribution(afterRecord, cutoffMs);
    calibration.realOutputTokens += after.realOutputTokens - before.realOutputTokens;
    calibration.realInputSideTokens += after.realInputSideTokens - before.realInputSideTokens;
    if (after.realOutputTokens > 0 || after.realInputSideTokens > 0) {
      const timestampMs = Date.parse(afterRecord!.timestamp);
      if (Number.isFinite(timestampMs)) {
        oldestTimestampMs = oldestTimestampMs === undefined
          ? timestampMs
          : Math.min(oldestTimestampMs, timestampMs);
      }
    }
  }
  return { calibration, oldestTimestampMs };
}

function compactUuidLayers(layers: readonly ReadonlySet<string>[]): ReadonlySet<string>[] {
  if (layers.length <= ANALYSIS_UUID_LAYER_LIMIT) return [...layers];
  // This occasional O(U) compaction bounds duplicate checks to 64 immutable
  // layers. It replaces the former O(U) Set rebuild on every small append.
  const compacted = new Set<string>();
  for (const layer of layers) {
    for (const uuid of layer) compacted.add(uuid);
  }
  return [compacted];
}

function rebaseFileAnalysisCutoff(
  prior: ClaudeUsageFileContribution,
  entry: UsageFileFingerprint,
  cutoffMs: number,
): ClaudeUsageFileContribution | null {
  if (!prior.analysis || !prior.analysisRangeComplete) return null;
  if (prior.analysis.cutoffMs === cutoffMs) return prior;
  const first = prior.analysisFirstTimestampMs;
  const last = prior.analysisLastTimestampMs;
  if (cutoffMs < prior.analysis.cutoffMs) {
    if (first !== undefined && first < prior.analysis.cutoffMs) return null;
  } else if (last !== undefined && last < cutoffMs && !prior.analysisHasUnboundedTimestamp) {
    return {
      ...prior,
      path: entry.path,
      fingerprint: entry,
      analysis: newAnalysisAcc(cutoffMs, true),
      analysisOldestIncludedTimestampMs: undefined,
    };
  } else if (prior.analysisOldestIncludedTimestampMs !== undefined &&
    prior.analysisOldestIncludedTimestampMs < cutoffMs) {
    return null;
  }
  return {
    ...prior,
    path: entry.path,
    fingerprint: entry,
    analysis: { ...prior.analysis, cutoffMs },
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
  const rankDiscoveryIndex = plan.entry.discoveryIndex;
  const priorOrderTimestampMs = plan.prior?.firstTimestampMs ?? 0;
  const orderTimestampMs = plan.orderTimestampMs ?? priorOrderTimestampMs;
  const base = plan.kind === 'append' && plan.prior
    ? cloneFile(plan.prior, plan.entry)
    : {
        fileId: plan.fileId,
        path: plan.entry.path,
        fingerprint: plan.entry,
        offset: 0,
        tailSignature: '',
        acceptedValidEof: false,
        firstTimestampMs: orderTimestampMs,
        recentPrompts: new Map<string, number>(),
        usage: new Map<string, IndexedRecord>(),
        prompts: new Map<string, IndexedRecord>(),
        analysis: analyzeContent ? newAnalysisAcc(analysisCutoffMs, true) : null,
        analysisAllUuids: new Set<string>(),
        analysisRangeComplete: analyzeContent,
        analysisOldestIncludedTimestampMs: undefined,
        analysisHasUnboundedTimestamp: false,
      };
  base.firstTimestampMs = orderTimestampMs;
  if (!analyzeContent) base.analysis = null;
  else if (!base.analysis || base.analysis.cutoffMs !== analysisCutoffMs) {
    base.analysis = newAnalysisAcc(analysisCutoffMs, true);
    base.analysisOldestIncludedTimestampMs = undefined;
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
  const analysisTouchedUuids = new Set<string>();
  const analysisTouchedToolIds = new Set<string>();
  const scan = await scanCodexJsonlLines(
    runtimeEntry(plan.entry, plan.fileId),
    defaultCodexJsonlReader,
    { offset: base.offset, discardingOversizedLine: false },
    plan.entry.size,
    (line, endOffset) => {
      if (line.trim() === '') return;
      linesParsed += 1;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const analysisRelevant = analyzeContent && (typeof parsed.uuid === 'string' ||
          (parsed.message !== null && typeof parsed.message === 'object'));
        const analysisTimestampMs = typeof parsed.timestamp === 'string'
            ? Date.parse(parsed.timestamp)
            : NaN;
        if (analysisRelevant) {
          if (Number.isFinite(analysisTimestampMs)) {
            base.analysisFirstTimestampMs = base.analysisFirstTimestampMs === undefined
              ? analysisTimestampMs
              : Math.min(base.analysisFirstTimestampMs, analysisTimestampMs);
            base.analysisLastTimestampMs = base.analysisLastTimestampMs === undefined
              ? analysisTimestampMs
              : Math.max(base.analysisLastTimestampMs, analysisTimestampMs);
          } else {
            base.analysisHasUnboundedTimestamp = true;
          }
        }
        if (typeof parsed.uuid === 'string') {
          base.analysisAllUuids.add(parsed.uuid);
          analysisTouchedUuids.add(parsed.uuid);
        }
        if (base.analysis) {
          const structuralEventStart = base.analysis.structuralEvents?.length ?? 0;
          const uuid = typeof parsed.uuid === 'string' ? parsed.uuid : undefined;
          const alreadySeen = uuid ? base.analysis.seenUuids.has(uuid) : false;
          analyzeLine(parsed, base.analysis, isSubagentFile, sessionInfo.sessionId);
          for (const event of base.analysis.structuralEvents?.slice(structuralEventStart) ?? []) {
            if (event.kind !== 'command') analysisTouchedToolIds.add(event.toolId);
          }
          const newlyOwnedUuid = Boolean(
            uuid && !alreadySeen && base.analysis.seenUuids.has(uuid),
          );
          if (uuid && newlyOwnedUuid) {
            ownedAnalysisUuids.add(uuid);
          }
          const includedWithoutUuid = !uuid && analysisRelevant &&
            (!Number.isFinite(analysisTimestampMs) || analysisTimestampMs >= analysisCutoffMs);
          if ((newlyOwnedUuid || includedWithoutUuid) && Number.isFinite(analysisTimestampMs)) {
            base.analysisOldestIncludedTimestampMs =
              base.analysisOldestIncludedTimestampMs === undefined
                ? analysisTimestampMs
                : Math.min(base.analysisOldestIncludedTimestampMs, analysisTimestampMs);
          }
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
        // not a reason to discard every verified record in the file. This
        // callback receives only completed lines, so the damage stays ignored
        // until a changed manifest fingerprint causes a bounded reread.
      }
    },
    undefined,
    Number.POSITIVE_INFINITY,
    isValidJsonLine,
  );
  if (!scan.reachedEnd) throw new Error('Claude log changed during bounded read');
  base.offset = scan.cursor.offset;
  base.acceptedValidEof = scan.finalLineAccepted;
  base.fingerprint = plan.entry;
  base.path = plan.entry.path;
  base.tailSignature = await tailSignature(plan.entry.path, base.offset);
  if (base.analysis) base.analysis.seenUuids = ownedAnalysisUuids;
  if (plan.kind === 'rebuild' || priorOrderTimestampMs !== orderTimestampMs ||
    plan.prior?.fingerprint.discoveryIndex !== rankDiscoveryIndex) {
    base.usage = new Map([...base.usage].map(([key, value]) => [key, {
      ...value,
      fileTimestampMs: base.firstTimestampMs,
      discoveryIndex: rankDiscoveryIndex,
    }]));
    base.prompts = new Map([...base.prompts].map(([key, value]) => [key, {
      ...value,
      fileTimestampMs: base.firstTimestampMs,
      discoveryIndex: rankDiscoveryIndex,
    }]));
  }
  return {
    ...plan,
    contribution: base,
    analysisTouchedUuids,
    analysisTouchedToolIds,
    bytesRead: scan.bytesRead,
    linesParsed,
  };
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

function configuredTimeKeys(
  index: ClaudeUsageIndex,
  date: Date,
): { day: string; month: string; hour: string } {
  if (isNaN(date.getTime())) return { day: '', month: '', hour: '' };
  const parts = index.timeKeyers.formatter.formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  const month = day.slice(0, 7);
  const hour = formatHourLabel(get('hour'));
  return { day, month, hour };
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

function applyConfiguredTimeAggregate(
  index: ClaudeUsageIndex,
  record: ClaudeUsageRecord,
  contribution: UsageData,
  sign: 1 | -1,
): void {
  const date = new Date(record.timestamp);
  const { day, month, hour } = configuredTimeKeys(index, date);
  const dayHour = day && hour
    ? `${day}\0${hour}`
    : '';
  applyBucket(index.aggregates.byDay, day, contribution, sign);
  applyBucket(index.aggregates.byMonth, month, contribution, sign);
  applyBucket(index.aggregates.byLocalDay, day, contribution, sign);
  if (day >= index.timeKeyers.hourWindowStartDay) {
    applyBucket(index.aggregates.byLocalHour, dayHour, contribution, sign);
  }
  if (day >= index.timeKeyers.projectWindowStartDay) {
    const rawProject = record._projectPath || record._projectName || 'unknown';
    const project = ClaudeDataLoader.normalizePath(rawProject) || 'unknown';
    applyBucket(index.aggregates.byProjectDay, `${project}\0${day}`, contribution, sign);
  }
}

function applyAggregate(index: ClaudeUsageIndex, record: ClaudeUsageRecord, sign: 1 | -1): void {
  const contribution = ClaudeDataLoader.calculateUsageData([record]);
  addUsageData(index.aggregates.allTime, contribution, sign);
  applyConfiguredTimeAggregate(index, record, contribution, sign);
  const project = record._projectPath || record._projectName || 'unknown';
  const branch = record._gitBranch && record._gitBranch.trim() ? record._gitBranch : '-';
  applyBucket(index.aggregates.bySession, record._sessionId || 'unknown', contribution, sign);
  applyBucket(index.aggregates.byProject, project.toLowerCase(), contribution, sign);
  applyBucket(index.aggregates.byBranch, `${record._projectName || 'unknown'}\0${branch}`, contribution, sign);
  applyBucket(index.aggregates.byWorkflow, record._workflowId, contribution, sign);
}

function membershipKeys(index: ClaudeUsageIndex, record: ClaudeUsageRecord): {
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
  return {
    session,
    project,
    branch,
    workflow,
    localDay: dayKeyInZone(new Date(record.timestamp), index.timeZone),
  };
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
  const keys = membershipKeys(index, record);
  index.dirtyGroups.sessions.add(keys.session);
  index.dirtyGroups.projects.add(keys.project);
  index.dirtyGroups.branches.add(keys.branch);
  if (keys.workflow) index.dirtyGroups.workflows.add(keys.workflow);
}

function addVisibleMembership(index: ClaudeUsageIndex, visibleKey: string, record: ClaudeUsageRecord): void {
  const keys = membershipKeys(index, record);
  addMembership(index.visibleKeysBySession, keys.session, visibleKey, index.copyOnWrite.visibleSessions);
  addMembership(index.visibleKeysByProject, keys.project, visibleKey, index.copyOnWrite.visibleProjects);
  addMembership(index.visibleKeysByBranch, keys.branch, visibleKey, index.copyOnWrite.visibleBranches);
  addMembership(index.visibleKeysByWorkflow, keys.workflow, visibleKey, index.copyOnWrite.visibleWorkflows);
  addMembership(index.visibleKeysByLocalDay, keys.localDay, visibleKey, index.copyOnWrite.visibleLocalDays);
  markDirty(index, record);
}

function removeVisibleMembership(index: ClaudeUsageIndex, visibleKey: string, record: ClaudeUsageRecord): void {
  const keys = membershipKeys(index, record);
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

/** Rebucket already-materialized records after an explicit timezone change. */
function rebuildConfiguredTimeAggregates(index: ClaudeUsageIndex): void {
  index.aggregates.byDay = new Map();
  index.aggregates.byMonth = new Map();
  index.aggregates.byLocalDay = new Map();
  index.aggregates.byLocalHour = new Map();
  index.aggregates.byProjectDay = new Map();
  index.visibleKeysByLocalDay = new Map();
  index.copyOnWrite.visibleLocalDays = new Set();
  for (const [visibleKey, record] of index.visibleRecords) {
    const contribution = ClaudeDataLoader.calculateUsageData([record]);
    applyConfiguredTimeAggregate(index, record, contribution, 1);
    addMembership(
      index.visibleKeysByLocalDay,
      dayKeyInZone(new Date(record.timestamp), index.timeZone),
      visibleKey,
      index.copyOnWrite.visibleLocalDays,
    );
  }
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

function retagFileOrdering(
  prior: ClaudeUsageFileContribution,
  entry: UsageFileFingerprint,
): ClaudeUsageFileContribution {
  const retag = (value: IndexedRecord): IndexedRecord => ({
    ...value,
    fileTimestampMs: prior.firstTimestampMs,
    discoveryIndex: entry.discoveryIndex,
  });
  return {
    ...prior,
    fingerprint: entry,
    usage: new Map([...prior.usage].map(([key, value]) => [key, retag(value)])),
    prompts: new Map([...prior.prompts].map(([key, value]) => [key, retag(value)])),
  };
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
      byProjectDay: new Map(previous.aggregates.byProjectDay),
      bySession: new Map(previous.aggregates.bySession),
      byProject: new Map(previous.aggregates.byProject),
      byBranch: new Map(previous.aggregates.byBranch),
      byWorkflow: new Map(previous.aggregates.byWorkflow),
    },
  };
}

function pruneHourlyBuckets(index: ClaudeUsageIndex): void {
  const cutoff = index.timeKeyers.hourWindowStartDay;
  if (!cutoff) return;
  for (const key of index.aggregates.byLocalHour.keys()) {
    if (key.slice(0, 10) < cutoff) index.aggregates.byLocalHour.delete(key);
  }
}

function pruneProjectDayBuckets(index: ClaudeUsageIndex): void {
  const cutoff = index.timeKeyers.projectWindowStartDay;
  if (!cutoff) return;
  for (const key of index.aggregates.byProjectDay.keys()) {
    const separator = key.lastIndexOf('\0');
    if (separator >= 0 && key.slice(separator + 1) < cutoff) {
      index.aggregates.byProjectDay.delete(key);
    }
  }
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

function rollingHourlyRowsByDay(
  index: ClaudeUsageIndex,
  dayKeys: readonly string[],
): Record<string, { hour: string; data: UsageData }[]> {
  const requestedDays = new Set(dayKeys);
  const activeDays = new Set(
    dayKeys.filter((day) => index.aggregates.byLocalDay.has(day)),
  );
  const buckets = new Map<string, Map<string, UsageData>>();

  for (const [key, data] of index.aggregates.byLocalHour) {
    const separator = key.indexOf('\0');
    if (separator < 0) continue;
    const day = key.slice(0, separator);
    const hour = key.slice(separator + 1);
    if (!requestedDays.has(day) || !hour) continue;
    let dayBuckets = buckets.get(day);
    if (!dayBuckets) {
      dayBuckets = new Map();
      buckets.set(day, dayBuckets);
    }
    dayBuckets.set(hour, cloneUsageData(data));
  }

  // Deterministic snapshots in tests/replay may request a historical rolling
  // window after the index has already pruned that window's hourly buckets.
  // Rebuild only those missing active days from visible in-memory records once
  // during snapshot creation. Production snapshots use the materialized map.
  const missingActiveDays = new Set(
    [...activeDays].filter((day) => !buckets.has(day)),
  );
  if (missingActiveDays.size > 0) {
    for (const record of index.visibleRecords.values()) {
      const keys = configuredTimeKeys(index, new Date(record.timestamp));
      if (!keys.day || !keys.hour || !missingActiveDays.has(keys.day)) continue;
      let dayBuckets = buckets.get(keys.day);
      if (!dayBuckets) {
        dayBuckets = new Map();
        buckets.set(keys.day, dayBuckets);
      }
      applyBucket(
        dayBuckets,
        keys.hour,
        ClaudeDataLoader.calculateUsageData([record]),
        1,
      );
    }
  }

  return Object.fromEntries(
    dayKeys.flatMap((day) => {
      const rows = [...(buckets.get(day)?.entries() ?? [])]
        .map(([hour, data]) => ({ hour, data }))
        .sort((left, right) => left.hour.localeCompare(right.hour));
      return rows.length > 0 ? [[day, rows]] : [];
    }),
  );
}

export function claudeUsageAggregateSnapshot(
  index: ClaudeUsageIndex,
  now: Date = new Date(),
): ClaudeUsageAggregateSnapshot {
  const localToday = dayKeyInZone(now, index.timeZone);
  const configuredMonth = monthKeyInZone(now, index.timeZone);
  const last30DayKeys = rollingDayKeys(now.getTime(), index.timeZone, 30);
  const last30Days = emptyUsageData();
  const dailyForLast30Days = last30DayKeys.flatMap((date) => {
    const data = index.aggregates.byLocalDay.get(date);
    if (!data) return [];
    addUsageData(last30Days, data, 1);
    return [{ date, data: cloneUsageData(data) }];
  }).sort((left, right) => right.date.localeCompare(left.date));
  const dailyForMonth = [...index.aggregates.byLocalDay.entries()]
    .filter(([day]) => day.startsWith(configuredMonth))
    .map(([date, data]) => ({ date, data: cloneUsageData(data) }))
    .sort((left, right) => right.date.localeCompare(left.date));
  const monthlyForAllTime = [...index.aggregates.byMonth.entries()]
    .map(([month, data]) => ({ date: `${month}-01`, data: cloneUsageData(data) }))
    .sort((left, right) => right.date.localeCompare(left.date));
  const hourlyForLast30DaysByDay = rollingHourlyRowsByDay(index, last30DayKeys);
  const hourlyForToday = hourlyForLast30DaysByDay[localToday] ?? [];
  return {
    today: cloneUsageData(index.aggregates.byLocalDay.get(localToday) ?? emptyUsageData()),
    last30Days,
    month: cloneUsageData(index.aggregates.byMonth.get(configuredMonth) ?? emptyUsageData()),
    allTime: cloneUsageData(index.aggregates.allTime),
    dailyForLast30Days,
    dailyForMonth,
    monthlyForAllTime,
    hourlyForToday,
    hourlyForLast30DaysByDay,
  };
}

function claudeProjectUsageMatrixSnapshot(
  index: ClaudeUsageIndex,
  now: Date,
): ProjectUsageMatrixSnapshot {
  const asOfDay = dayKeyInZone(now, index.timeZone);
  const points = [...index.aggregates.byProjectDay.entries()].flatMap(([key, data]) => {
    const separator = key.lastIndexOf('\0');
    if (separator < 0) return [];
    const projectKey = key.slice(0, separator);
    const day = key.slice(separator + 1);
    const project = index.projectRows.get(projectKey);
    const projectName = project?.projectName ||
      projectKey.split('/').filter(Boolean).pop() ||
      '';
    return [{
      projectKey: `claude:${projectKey}`,
      projectName,
      day,
      tokens: data.totalInputTokens + data.totalOutputTokens +
        data.totalCacheCreationTokens + data.totalCacheReadTokens,
      coverage: 'complete' as const,
    }];
  });
  return buildProjectUsageMatrixSnapshot('claude', points, {
    asOfDay,
    timeZone: index.timeZone,
    coverage: 'complete',
  });
}

export function claudeUsageDashboardSnapshot(
  index: ClaudeUsageIndex,
  options: {
    workspacePath?: string;
    projectGroupingMode?: 'git' | 'folder' | 'flat';
    contextWindowOverride?: number;
    adviceWindowDays?: number;
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
      index.visibleKeysByLocalDay.get(dayKeyInZone(now, index.timeZone)),
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
  let adviceWindow: ClaudeUsageDashboardSnapshot['adviceWindow'];
  if (options.adviceWindowDays !== undefined) {
    const windowDays = Math.min(365, Math.max(1, Math.round(options.adviceWindowDays)));
    const dayKeys = new Set(rollingDayKeys(now.getTime(), index.timeZone, windowDays));
    const aggregate = emptyUsageData();
    for (const day of dayKeys) {
      const value = index.aggregates.byLocalDay.get(day);
      if (value) addUsageData(aggregate, value, 1);
    }
    const windowSessions = [...index.sessionRows.values()].filter((row) =>
      dayKeys.has(dayKeyInZone(row.endTime, index.timeZone)),
    );
    adviceWindow = {
      windowDays,
      aggregate,
      totalSessions: windowSessions.length,
      longSessionCount: windowSessions.filter(
        (row) => row.endTime.getTime() - row.startTime.getTime() >= 8 * 60 * 60 * 1000,
      ).length,
      largeContextSessionCount: windowSessions.filter(
        (row) => row.peakContextTokens >= 150_000,
      ).length,
    };
  }
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
    projectUsageMatrix: claudeProjectUsageMatrixSnapshot(index, now),
    ...(adviceWindow ? { adviceWindow } : {}),
  };
}

export async function updateClaudeUsageIndex(
  previous: ClaudeUsageIndex,
  root: string,
  options: ClaudeUsageIndexUpdateOptions = {},
): Promise<ClaudeUsageIndexUpdateResult> {
  const started = performance.now();
  const configuredTimeZone = resolveTimeZone(I18n.getTimezone());
  const timeKeyers = createConfiguredTimeKeyers(configuredTimeZone);
  const timeZoneChanged = previous.timeZone !== configuredTimeZone;
  const analyzeContent = options.analyzeContent !== false;
  const windowDays = Math.min(365, Math.max(1, Math.round(options.windowDays ?? 30)));
  const nowMs = Date.now();
  const analysisAsOfDay = dayKeyInZone(new Date(nowMs), configuredTimeZone);
  const previousAnalysisRuntime = analysisRuntimeByIndex.get(previous);
  // ClaudeDataLoader uses a continuously rolling millisecond cutoff. Keep the
  // same contract here; timestamp frontiers below avoid reparsing when moving
  // the cutoff cannot yet change any materialized contribution.
  const analysisCutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const manifest = options.manifest ?? await scanUsageManifest([root]);
  const currentEntries = [...manifest.entries.values()];
  const previousByPath = new Map([...previous.files.values()].map((file) => [file.path, file]));
  const seenPrevious = new Set<string>();
  const plans: FilePlan[] = [];
  const analysisRebases = new Map<string, ClaudeUsageFileContribution>();
  const analysisPayloadRebases = new Set<string>();
  const moves: Array<{ prior: ClaudeUsageFileContribution; entry: UsageFileFingerprint }> = [];
  const metadataRetags: Array<{
    prior: ClaudeUsageFileContribution;
    entry: UsageFileFingerprint;
  }> = [];
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
      const bodyUnchanged = sameIdentity.fingerprint.size === entry.size &&
        sameIdentity.fingerprint.mtimeMs === entry.mtimeMs;
      const canRebaseAnalysis = sameIdentity.path === entry.path &&
        analyzeContent && !timeZoneChanged && sameIdentity.analysis &&
        sameIdentity.analysis.cutoffMs !== analysisCutoffMs;
      let rebasedAnalysis: ClaudeUsageFileContribution | undefined;
      if (canRebaseAnalysis) {
        const rebased = rebaseFileAnalysisCutoff(sameIdentity, entry, analysisCutoffMs);
        if (rebased) {
          rebasedAnalysis = rebased;
          if (bodyUnchanged) {
            analysisRebases.set(fileId, rebased);
            if (!sameAnalysisPayload(sameIdentity, rebased)) analysisPayloadRebases.add(fileId);
          }
        }
      }
      const needsAnalysisBody = analyzeContent &&
        (timeZoneChanged || !previous.analyzeContent || !sameIdentity.analysis ||
          (sameIdentity.analysis.cutoffMs !== analysisCutoffMs && !rebasedAnalysis));
      if (bodyUnchanged && !needsAnalysisBody) {
        if (sameIdentity.path === entry.path &&
          sameIdentity.fingerprint.discoveryIndex !== entry.discoveryIndex) {
          metadataRetags.push({ prior: sameIdentity, entry });
        }
        continue;
      }
      if (needsAnalysisBody) {
        analysisRebases.delete(fileId);
        analysisPayloadRebases.delete(fileId);
        plans.push({
          kind: 'rebuild',
          analysisReason: bodyUnchanged && !timeZoneChanged && Boolean(sameIdentity.analysis)
            ? 'cutoff'
            : 'source',
          entry,
          fileId,
          prior: sameIdentity,
        });
        changed.rebuild += 1;
        continue;
      }
      const append = entry.size > sameIdentity.fingerprint.size &&
        await appendPrefixStillMatches(sameIdentity, entry) &&
        await appendBoundaryStillMatches(sameIdentity, entry);
      const rebaseChangedPayload = Boolean(
        rebasedAnalysis && !sameAnalysisPayload(sameIdentity, rebasedAnalysis),
      );
      const plannedKind: FilePlan['kind'] = append && !rebaseChangedPayload
        ? 'append'
        : 'rebuild';
      plans.push({
        kind: plannedKind,
        analysisReason: 'source',
        entry,
        fileId,
        prior: append && rebasedAnalysis && !rebaseChangedPayload ? rebasedAnalysis : sameIdentity,
      });
      changed[plannedKind] += 1;
      continue;
    }
    const replaced = previousByPath.get(entry.path);
    if (replaced && !seenPrevious.has(replaced.fileId)) {
      seenPrevious.add(replaced.fileId);
      plans.push({
        kind: 'rebuild',
        analysisReason: 'source',
        entry,
        fileId,
        prior: replaced,
        replacedFileId: replaced.fileId,
      });
    } else {
      plans.push({ kind: 'rebuild', analysisReason: 'source', entry, fileId });
    }
    changed.rebuild += 1;
  }
  const deletions = [...previous.files.values()].filter((file) => !seenPrevious.has(file.fileId));
  changed.delete = deletions.length;
  let canonicalOrderChanged = false;
  if (metadataRetags.length > 0) {
    const previousCanonicalOrder = previousAnalysisRuntime?.orderedFileIds ??
      analysisFilesInOrder(previous).map((file) => file.fileId);
    const projectedOrder = currentEntries
      .map((entry) => ({ entry, file: previous.files.get(stableFileId(entry)) }))
      .filter((value): value is {
        entry: UsageFileFingerprint;
        file: ClaudeUsageFileContribution;
      } => Boolean(value.file))
      .sort((left, right) =>
        left.file.firstTimestampMs - right.file.firstTimestampMs ||
        left.entry.discoveryIndex - right.entry.discoveryIndex)
      .map((value) => value.file.fileId);
    canonicalOrderChanged = projectedOrder.length === currentEntries.length &&
      (projectedOrder.length !== previousCanonicalOrder.length ||
        projectedOrder.some((fileId, index) => previousCanonicalOrder[index] !== fileId));
  }

  const replaceWithFullAnalysisPlans = (): void => {
    plans.length = 0;
    analysisRebases.clear();
    analysisPayloadRebases.clear();
    for (const entry of currentEntries) {
      const fileId = stableFileId(entry);
      const sameIdentity = previous.files.get(fileId);
      const replaced = sameIdentity ? undefined : previousByPath.get(entry.path);
      plans.push({
        kind: 'rebuild',
        analysisReason: 'full',
        entry,
        fileId,
        prior: sameIdentity ?? replaced,
        ...(replaced && replaced.fileId !== fileId ? { replacedFileId: replaced.fileId } : {}),
      });
    }
    changed.rebuild = Math.max(changed.rebuild, plans.length);
  };

  let forcedFullAnalysisRebuild = false;
  if (analyzeContent) {
    const sourcePlans = plans.filter((plan) => plan.analysisReason === 'source');
    // Several sessions appending between two refreshes is the ordinary case on a
    // machine running more than one agent, not an edge case: with the fast path
    // limited to a single changed file, such a machine never took it and every
    // refresh re-read the whole history. Any number of pure tail appends is
    // safe here; the per-file UUID ownership check below still guards order.
    const appendOnlyPlans = plans.length > 0 && sourcePlans.length === plans.length &&
      plans.every((plan) => plan.kind === 'append' && plan.prior &&
        plan.prior.firstTimestampMs > 0);
    const safeTailAppend = Boolean(
      appendOnlyPlans &&
      previousAnalysisRuntime && !timeZoneChanged &&
      previous.windowDays === windowDays && analysisPayloadRebases.size === 0,
    );
    const priorAnalysisCutoffMs = previousAnalysisRuntime?.cutoffMs ??
      (previous.analyzeContent ? previous.analysisCutoffMs : undefined);
    const cutoffMovedBackward = priorAnalysisCutoffMs !== undefined &&
      analysisCutoffMs < priorAnalysisCutoffMs;
    const unsafeSourceMutation = deletions.length > 0 || moves.length > 0 ||
      (sourcePlans.length > 0 && !safeTailAppend);
    forcedFullAnalysisRebuild = cutoffMovedBackward || unsafeSourceMutation ||
      canonicalOrderChanged;
    if (forcedFullAnalysisRebuild) {
      replaceWithFullAnalysisPlans();
    }
  }

  if (analyzeContent) {
    const removedOwnedUuids = new Set<string>();
    for (const file of deletions) {
      for (const uuid of file.analysis?.seenUuids ?? []) removedOwnedUuids.add(uuid);
    }
    for (const plan of plans) {
      if (plan.kind !== 'rebuild') continue;
      for (const uuid of plan.prior?.analysis?.seenUuids ?? []) removedOwnedUuids.add(uuid);
    }
    for (const [fileId, rebased] of analysisRebases) {
      const prior = previous.files.get(fileId);
      if (!prior?.analysis) continue;
      for (const uuid of prior.analysis.seenUuids) {
        if (!rebased.analysis?.seenUuids.has(uuid)) removedOwnedUuids.add(uuid);
      }
    }
    if (removedOwnedUuids.size > 0) {
      const plannedIds = new Set(plans.map((plan) => plan.fileId));
      const deletedIds = new Set(deletions.map((file) => file.fileId));
      for (const entry of currentEntries) {
        const fileId = stableFileId(entry);
        if (plannedIds.has(fileId) || deletedIds.has(fileId)) continue;
        const prior = previous.files.get(fileId);
        if (!prior) continue;
        const candidate = analysisRebases.get(fileId) ?? prior;
        if (candidate.analysisLastTimestampMs !== undefined &&
          candidate.analysisLastTimestampMs < analysisCutoffMs &&
          !candidate.analysisHasUnboundedTimestamp) {
          continue;
        }
        const canRestoreOwnership = [...prior.analysisAllUuids]
          .some((uuid) => removedOwnedUuids.has(uuid));
        if (!canRestoreOwnership) continue;
        analysisRebases.delete(fileId);
        plans.push({ kind: 'rebuild', analysisReason: 'ownership', entry, fileId, prior });
        plannedIds.add(fileId);
        changed.rebuild += 1;
      }
    }
  }

  const calibrationCutoffIsStable = Boolean(
    previousAnalysisRuntime && analysisCutoffMs >= previousAnalysisRuntime.cutoffMs &&
    (previousAnalysisRuntime.calibrationOldestTimestampMs === undefined ||
      analysisCutoffMs <= previousAnalysisRuntime.calibrationOldestTimestampMs),
  );
  let fastAppendAnalysis = Boolean(
    analyzeContent && previousAnalysisRuntime && previous.contentAnalysis &&
    !forcedFullAnalysisRebuild && calibrationCutoffIsStable &&
    analysisPayloadRebases.size === 0 && deletions.length === 0 && moves.length === 0 &&
    plans.every((plan) => plan.kind === 'append' && Boolean(plan.prior)),
  );

  await options.beforeBodyReads?.();
  const parsedPlans: ParsedPlan[] = [];
  let bytesRead = 0;
  let linesParsed = 0;
  let bodyReads = 0;
  const analysisUuidAdditions = new Set<string>();
  try {
    const agentTypeCache = new Map<string, string>();
    const workflowNameCache = new Map<string, string>();
    const parseSelectedPlans = async (useFastUuidLayers: boolean): Promise<void> => {
      const orderProbePlans = plans.filter((plan) =>
        plan.kind === 'rebuild' || (plan.prior?.firstTimestampMs ?? 0) === 0);
      let probedOrder: Awaited<ReturnType<typeof sortUsageFilesByEarliestTimestamp>> | undefined;
      if (orderProbePlans.length > 0) {
        probedOrder = await sortUsageFilesByEarliestTimestamp(
          orderProbePlans.map((plan) => plan.entry),
        );
        bytesRead += probedOrder.bytesRead;
      }
      for (const plan of plans) {
        plan.orderTimestampMs = plan.kind === 'append' && (plan.prior?.firstTimestampMs ?? 0) > 0
          ? plan.prior!.firstTimestampMs
          : probedOrder?.timestampMsByPath.get(plan.entry.path) ?? 0;
      }
      const analysisSeenUuids: Set<string> = useFastUuidLayers && previousAnalysisRuntime
        ? new LayeredAnalysisSeenUuids(
            previousAnalysisRuntime.uuidLayers,
            analysisUuidAdditions,
          )
        : new Set<string>();
      if (analyzeContent) {
        if (!useFastUuidLayers) {
          const excluded = new Set<string>([
            ...deletions.map((file) => file.fileId),
            ...plans.flatMap((plan) => plan.kind === 'rebuild' && plan.prior ? [plan.prior.fileId] : []),
          ]);
          for (const prior of previous.files.values()) {
            if (excluded.has(prior.fileId)) continue;
            const file = analysisRebases.get(prior.fileId) ?? prior;
            for (const uuid of file.analysis?.seenUuids ?? []) analysisSeenUuids.add(uuid);
          }
        }
        // The first file to carry a UUID owns it, so parsing has to follow the
        // same order the full loader uses. With one plan the order is moot, but
        // several appends must be parsed in full-scan order — otherwise
        // ownership falls to whichever file happened to be discovered first.
        if (plans.length > 1) {
          plans.sort((left, right) => {
            if (left.kind !== right.kind) return left.kind === 'rebuild' ? -1 : 1;
            return (left.orderTimestampMs ?? 0) - (right.orderTimestampMs ?? 0) ||
              left.entry.discoveryIndex - right.entry.discoveryIndex;
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
        bodyReads += 1;
        bytesRead += parsed.bytesRead;
        linesParsed += parsed.linesParsed;
      }
    };

    await parseSelectedPlans(fastAppendAnalysis);

    // A lone append can stay incremental anywhere in the established file
    // order unless one of its new raw UUIDs also occurs in a later file. Such a
    // collision changes the full loader's first owner, so retry the analysis as
    // one globally ordered rebuild. The first tail read remains bounded and is
    // the evidence used to choose the safe path.
    if (fastAppendAnalysis && previousAnalysisRuntime && parsedPlans.length > 0 &&
      parsedPlans.every((plan) => plan.kind === 'append')) {
      let laterOwnerCollision = false;
      for (const appended of parsedPlans) {
        if (laterOwnerCollision) break;
        const filePosition = previousAnalysisRuntime.filePositionById.get(appended.fileId) ?? -1;
        if (filePosition < 0) {
          laterOwnerCollision = true;
          break;
        }
        for (const uuid of appended.analysisTouchedUuids) {
          if (laterOwnerCollision) break;
          const ownerFileId = previousAnalysisRuntime.firstUuidFileByUuid.get(uuid);
          if (!ownerFileId || ownerFileId === appended.fileId) continue;
          const ownerPosition = previousAnalysisRuntime.filePositionById.get(ownerFileId);
          if (ownerPosition === undefined) {
            laterOwnerCollision = true;
            break;
          }
          laterOwnerCollision = ownerPosition > filePosition;
        }
      }
      if (laterOwnerCollision) {
        forcedFullAnalysisRebuild = true;
        fastAppendAnalysis = false;
        replaceWithFullAnalysisPlans();
        parsedPlans.length = 0;
        analysisUuidAdditions.clear();
        await parseSelectedPlans(false);
      }
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
        bodyReads: bodyReads + 1,
        aggregateMutations: 0,
        changed,
      },
    };
  }

  const next = cloneIndexForCommit(previous);
  next.timeZone = configuredTimeZone;
  next.timeKeyers = timeKeyers;
  pruneHourlyBuckets(next);
  pruneProjectDayBuckets(next);
  if (timeZoneChanged) {
    rebuildConfiguredTimeAggregates(next);
  }
  next.manifest = manifest;
  next.analyzeContent = analyzeContent;
  next.windowDays = windowDays;
  next.analysisCutoffMs = analyzeContent ? analysisCutoffMs : 0;
  const affectedMessages = new Set<string>();
  const affectedDirect = new Set<string>();
  const affectedSessions = new Set<string>();
  let aggregateMutations = timeZoneChanged ? next.visibleRecords.size : 0;
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

  for (const [fileId, rebased] of analysisRebases) {
    next.files.set(fileId, rebased);
  }
  const plannedFileIds = new Set(plans.map((plan) => plan.fileId));
  const movedFileIds = new Set(moves.map((move) => move.prior.fileId));
  for (const metadata of metadataRetags) {
    if (plannedFileIds.has(metadata.prior.fileId) || movedFileIds.has(metadata.prior.fileId)) {
      continue;
    }
    const rebased = analysisRebases.get(metadata.prior.fileId) ?? metadata.prior;
    removeFile(metadata.prior);
    addFile(retagFileOrdering(rebased, metadata.entry));
  }
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
  } else if (fastAppendAnalysis && previousAnalysisRuntime && parsedPlans.length === 0) {
    analysisRuntimeByIndex.set(next, {
      ...previousAnalysisRuntime,
      asOfDay: analysisAsOfDay,
      cutoffMs: analysisCutoffMs,
      merged: { ...previousAnalysisRuntime.merged, cutoffMs: analysisCutoffMs },
    });
    next.contentAnalysis = previous.contentAnalysis;
  } else if (fastAppendAnalysis && previousAnalysisRuntime) {
    // Ordinary appends touch only changed per-file contributions, affected
    // calibration identities, and the already-bounded prompt/skill samples.
    const merged = cloneAnalysisAcc(previousAnalysisRuntime.merged);
    const appended = new Map<string, AnalysisAcc>();
    for (const plan of parsedPlans) {
      if (!plan.prior?.analysis || !plan.contribution.analysis) continue;
      addAppendAnalysisDelta(merged, plan.prior.analysis, plan.contribution.analysis);
      appended.set(plan.fileId, plan.contribution.analysis);
    }
    const promptTail = refreshedPromptTail(previousAnalysisRuntime, appended);
    const touchedToolIds = new Set<string>();
    for (const plan of parsedPlans) {
      for (const toolId of plan.analysisTouchedToolIds) touchedToolIds.add(toolId);
    }
    const structural = refreshedStructuralRuntime(
      previousAnalysisRuntime,
      merged,
      appended,
      touchedToolIds,
    );
    const skillHead = structural.skillHead;
    merged.prompts = promptTail.map((entry) => ({ ...entry.value }));
    applySkillHead(merged, skillHead);
    merged.seenUuids = new Set<string>();
    merged.cutoffMs = analysisCutoffMs;
    const uuidLayers = compactUuidLayers([
      ...previousAnalysisRuntime.uuidLayers,
      ...(analysisUuidAdditions.size > 0 ? [analysisUuidAdditions] : []),
    ]);
    const firstUuidFileByUuid = analysisUuidAdditions.size > 0
      ? new Map(previousAnalysisRuntime.firstUuidFileByUuid)
      : previousAnalysisRuntime.firstUuidFileByUuid;
    if (firstUuidFileByUuid instanceof Map) {
      // With more than one appended file, ownership belongs to the file that
      // comes first in the established order — not to whichever plan happened
      // to be parsed first.
      const appendedByOrder = [...parsedPlans].sort((left, right) =>
        (previousAnalysisRuntime.filePositionById.get(left.fileId) ?? 0) -
        (previousAnalysisRuntime.filePositionById.get(right.fileId) ?? 0));
      const unassigned = new Set(analysisUuidAdditions);
      for (const plan of appendedByOrder) {
        if (unassigned.size === 0) break;
        for (const uuid of plan.analysisTouchedUuids) {
          if (!unassigned.delete(uuid)) continue;
          firstUuidFileByUuid.set(uuid, plan.fileId);
        }
      }
      // A UUID no appended file claims still needs an owner, as before.
      for (const uuid of unassigned) {
        firstUuidFileByUuid.set(uuid, parsedPlans[0]?.fileId ?? '');
      }
    }
    const calibrationState = appendCalibration(
      previous,
      next,
      previousAnalysisRuntime.calibration,
      previousAnalysisRuntime.calibrationOldestTimestampMs,
      affectedMessages,
      affectedDirect,
      analysisCutoffMs,
    );
    const runtime: AnalysisRuntimeState = {
      asOfDay: analysisAsOfDay,
      cutoffMs: analysisCutoffMs,
      orderedFileIds: previousAnalysisRuntime.orderedFileIds,
      filePositionById: previousAnalysisRuntime.filePositionById,
      merged,
      promptTail,
      skillHead,
      calibration: calibrationState.calibration,
      calibrationOldestTimestampMs: calibrationState.oldestTimestampMs,
      uuidLayers,
      firstUuidFileByUuid,
      toolEventsById: structural.toolEventsById,
      toolBucketsById: structural.toolBucketsById,
      firstToolResultByName: structural.firstToolResultByName,
      toolContributorsByName: structural.toolContributorsByName,
    };
    analysisRuntimeByIndex.set(next, runtime);
    next.contentAnalysis = finalizeMaterializedAnalysis(runtime);
  } else {
    // Cold starts, unsafe source-order changes, explicit timezone changes, and
    // cutoff crossings rebuild the materialized in-memory view. Timestamp
    // frontiers keep refreshes between crossings on the append fast path.
    const runtime = buildAnalysisRuntimeState(next, analysisAsOfDay, analysisCutoffMs);
    analysisRuntimeByIndex.set(next, runtime);
    next.contentAnalysis = finalizeMaterializedAnalysis(runtime);
  }

  options.log?.(
    `incremental loader: bodies=${bodyReads}, bytes=${bytesRead}, ` +
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
      bodyReads,
      aggregateMutations,
      changed,
    },
  };
}
