import * as path from 'node:path';

import {
  scanUsageManifest,
  UsageFileFingerprint,
} from './claudeUsageFiles';
import {
  defaultCodexJsonlReader,
  scanCodexJsonlLines,
} from './providers/codex/codexJsonlScanner';
import { CodexRuntimeManifestEntry } from './providers/codex/codexManifest';

export interface ClaudePrototypeSummary {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  messages: number;
  contentChars: number;
  records: number;
}

interface ClaudePrototypeRecord extends ClaudePrototypeSummary {
  key: string;
  timestamp: number;
  day: string;
  session: string;
  project: string;
  branch: string;
  workflow?: string;
}

interface ClaudePrototypeFile {
  fileId: string;
  path: string;
  fingerprint: UsageFileFingerprint;
  offset: number;
  records: Map<string, ClaudePrototypeRecord>;
}

interface ClaudePrototypeAggregates {
  allTime: ClaudePrototypeSummary;
  byDay: Map<string, ClaudePrototypeSummary>;
  bySession: Map<string, ClaudePrototypeSummary>;
  byProject: Map<string, ClaudePrototypeSummary>;
  byBranch: Map<string, ClaudePrototypeSummary>;
  byWorkflow: Map<string, ClaudePrototypeSummary>;
}

export interface ClaudePrototypeIndex {
  files: Map<string, ClaudePrototypeFile>;
  owners: Map<string, Map<string, ClaudePrototypeRecord>>;
  canonical: Map<string, ClaudePrototypeRecord>;
  aggregates: ClaudePrototypeAggregates;
}

export interface ClaudePrototypeDiagnostics {
  bodyReads: number;
  bytesRead: number;
  linesParsed: number;
  aggregateMutations: number;
  changed: {
    append: number;
    rebuild: number;
    move: number;
    delete: number;
  };
}

export interface ClaudePrototypeUpdateOptions {
  afterManifest?: () => Promise<void>;
}

export interface ClaudePrototypeUpdateResult {
  index: ClaudePrototypeIndex;
  diagnostics: ClaudePrototypeDiagnostics;
}

export interface ClaudePrototypeSnapshot {
  today: ClaudePrototypeSummary;
  month: ClaudePrototypeSummary;
  allTime: ClaudePrototypeSummary;
  days: Record<string, ClaudePrototypeSummary>;
  sessions: Record<string, ClaudePrototypeSummary>;
  projects: Record<string, ClaudePrototypeSummary>;
  branches: Record<string, ClaudePrototypeSummary>;
  workflows: Record<string, ClaudePrototypeSummary>;
}

interface FilePlan {
  kind: 'append' | 'rebuild';
  entry: UsageFileFingerprint;
  fileId: string;
  prior?: ClaudePrototypeFile;
  replacedFileId?: string;
}

interface ParsedPlan extends FilePlan {
  contribution: ClaudePrototypeFile;
  touchedKeys: Set<string>;
  bytesRead: number;
  linesParsed: number;
}

interface OwnerUpdate {
  key: string;
  fileId: string;
  record?: ClaudePrototypeRecord;
}

function emptySummary(): ClaudePrototypeSummary {
  return {
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
    messages: 0,
    contentChars: 0,
    records: 0,
  };
}

function cloneSummary(value?: ClaudePrototypeSummary): ClaudePrototypeSummary {
  return value ? { ...value } : emptySummary();
}

function emptyAggregates(): ClaudePrototypeAggregates {
  return {
    allTime: emptySummary(),
    byDay: new Map(),
    bySession: new Map(),
    byProject: new Map(),
    byBranch: new Map(),
    byWorkflow: new Map(),
  };
}

export function createClaudePrototypeIndex(): ClaudePrototypeIndex {
  return {
    files: new Map(),
    owners: new Map(),
    canonical: new Map(),
    aggregates: emptyAggregates(),
  };
}

function stableFileId(entry: UsageFileFingerprint): string {
  return (entry.dev ?? 0) > 0 && (entry.ino ?? 0) > 0
    ? `inode:${entry.dev}:${entry.ino}`
    : `path:${entry.path}`;
}

function sameFingerprint(
  previous: UsageFileFingerprint,
  current: UsageFileFingerprint,
): boolean {
  return previous.size === current.size && previous.mtimeMs === current.mtimeMs;
}

function sessionInfo(filePath: string): { session: string; encodedProject: string } {
  const parts = filePath.split(/[\\/]/);
  const projectsAt = parts.lastIndexOf('projects');
  if (projectsAt >= 0 && projectsAt + 1 < parts.length - 1) {
    return {
      session: projectsAt + 2 < parts.length - 1
        ? parts[projectsAt + 2]
        : path.basename(filePath, '.jsonl'),
      encodedProject: parts[projectsAt + 1],
    };
  }
  return {
    session: path.basename(filePath, '.jsonl'),
    encodedProject: path.basename(path.dirname(filePath)),
  };
}

function textLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + textLength(item), 0);
  }
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  return Object.entries(record).reduce(
    (sum, [key, item]) => key === 'text' || key === 'content'
      ? sum + textLength(item)
      : sum,
    0,
  );
}

function finiteToken(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function recordWeight(record: ClaudePrototypeRecord): number {
  return record.input + record.output + record.cacheCreation + record.cacheRead;
}

function parsePrototypeLine(
  line: string,
  endOffset: number,
  fileId: string,
  filePath: string,
): ClaudePrototypeRecord | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const timestampText = typeof parsed.timestamp === 'string' ? parsed.timestamp : '';
  const timestamp = Date.parse(timestampText);
  if (!Number.isFinite(timestamp)) return null;
  const day = new Date(timestamp).toISOString().slice(0, 10);
  const fallback = sessionInfo(filePath);
  const message = parsed.message && typeof parsed.message === 'object'
    ? parsed.message as Record<string, unknown>
    : {};
  const role = typeof message.role === 'string' ? message.role : parsed.type;
  const project = typeof parsed.cwd === 'string' && parsed.cwd.trim() !== ''
    ? parsed.cwd
    : fallback.encodedProject;
  const branch = typeof parsed.gitBranch === 'string' && parsed.gitBranch.trim() !== ''
    ? parsed.gitBranch
    : 'unknown';
  const workflow = typeof parsed.workflowId === 'string' && parsed.workflowId.trim() !== ''
    ? parsed.workflowId
    : undefined;

  if (role === 'user') {
    return {
      key: `line:${fileId}:${endOffset}`,
      timestamp,
      day,
      session: fallback.session,
      project,
      branch,
      workflow,
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
      messages: 1,
      contentChars: textLength(message.content),
      records: 1,
    };
  }

  const usage = message.usage && typeof message.usage === 'object'
    ? message.usage as Record<string, unknown>
    : null;
  if (!usage || typeof usage.input_tokens !== 'number' || typeof usage.output_tokens !== 'number') {
    return null;
  }
  const messageId = typeof message.id === 'string' ? message.id : '';
  const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : '';
  const key = messageId || requestId
    ? `${messageId || 'no-msg'}-${requestId || 'no-req'}`
    : `line:${fileId}:${endOffset}`;
  return {
    key,
    timestamp,
    day,
    session: fallback.session,
    project,
    branch,
    workflow,
    input: finiteToken(usage.input_tokens),
    output: finiteToken(usage.output_tokens),
    cacheCreation: finiteToken(usage.cache_creation_input_tokens),
    cacheRead: finiteToken(usage.cache_read_input_tokens),
    messages: 0,
    contentChars: textLength(message.content),
    records: 1,
  };
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

async function parsePlan(plan: FilePlan): Promise<ParsedPlan> {
  const base = plan.kind === 'append' && plan.prior
    ? {
        ...plan.prior,
        path: plan.entry.path,
        fingerprint: plan.entry,
        records: new Map(plan.prior.records),
      }
    : {
        fileId: plan.fileId,
        path: plan.entry.path,
        fingerprint: plan.entry,
        offset: 0,
        records: new Map<string, ClaudePrototypeRecord>(),
      };
  const touchedKeys = new Set<string>();
  let linesParsed = 0;
  const scan = await scanCodexJsonlLines(
    runtimeEntry(plan.entry, plan.fileId),
    defaultCodexJsonlReader,
    { offset: base.offset, discardingOversizedLine: false },
    plan.entry.size,
    (line, endOffset) => {
      linesParsed += 1;
      const record = parsePrototypeLine(line, endOffset, plan.fileId, plan.entry.path);
      if (!record) return;
      const existing = base.records.get(record.key);
      if (!existing || recordWeight(record) >= recordWeight(existing)) {
        base.records.set(record.key, record);
        touchedKeys.add(record.key);
      }
    },
  );
  if (!scan.reachedEnd) {
    throw new Error('Claude prototype file changed during bounded read');
  }
  base.offset = scan.cursor.offset;
  base.fingerprint = plan.entry;
  base.path = plan.entry.path;
  return {
    ...plan,
    contribution: base,
    touchedKeys,
    bytesRead: scan.bytesRead,
    linesParsed,
  };
}

function summaryIsZero(summary: ClaudePrototypeSummary): boolean {
  return Object.values(summary).every((value) => value === 0);
}

function applySummary(
  target: ClaudePrototypeSummary,
  source: ClaudePrototypeSummary,
  sign: 1 | -1,
): void {
  target.input += sign * source.input;
  target.output += sign * source.output;
  target.cacheCreation += sign * source.cacheCreation;
  target.cacheRead += sign * source.cacheRead;
  target.messages += sign * source.messages;
  target.contentChars += sign * source.contentChars;
  target.records += sign * source.records;
}

function applyBucket(
  buckets: Map<string, ClaudePrototypeSummary>,
  key: string | undefined,
  record: ClaudePrototypeRecord,
  sign: 1 | -1,
): void {
  if (!key) return;
  const bucket = cloneSummary(buckets.get(key));
  applySummary(bucket, record, sign);
  if (summaryIsZero(bucket)) buckets.delete(key);
  else buckets.set(key, bucket);
}

function applyCanonical(
  aggregates: ClaudePrototypeAggregates,
  record: ClaudePrototypeRecord,
  sign: 1 | -1,
): void {
  applySummary(aggregates.allTime, record, sign);
  applyBucket(aggregates.byDay, record.day, record, sign);
  applyBucket(aggregates.bySession, record.session, record, sign);
  applyBucket(aggregates.byProject, record.project, record, sign);
  applyBucket(aggregates.byBranch, `${record.project}\u0000${record.branch}`, record, sign);
  applyBucket(aggregates.byWorkflow, record.workflow, record, sign);
}

function bestOwner(owners?: Map<string, ClaudePrototypeRecord>): ClaudePrototypeRecord | undefined {
  if (!owners || owners.size === 0) return undefined;
  return [...owners.entries()]
    .sort(([leftId, left], [rightId, right]) =>
      recordWeight(right) - recordWeight(left) || leftId.localeCompare(rightId),
    )[0]?.[1];
}

function ownerUpdatesForPlan(plan: ParsedPlan): OwnerUpdate[] {
  if (plan.kind === 'append' && plan.prior) {
    return [...plan.touchedKeys].map((key) => ({
      key,
      fileId: plan.fileId,
      record: plan.contribution.records.get(key),
    }));
  }
  const updates: OwnerUpdate[] = [];
  if (plan.prior) {
    for (const key of plan.prior.records.keys()) {
      updates.push({ key, fileId: plan.prior.fileId });
    }
  }
  for (const [key, record] of plan.contribution.records) {
    updates.push({ key, fileId: plan.fileId, record });
  }
  return updates;
}

function cloneAggregateMaps(value: ClaudePrototypeAggregates): ClaudePrototypeAggregates {
  return {
    allTime: cloneSummary(value.allTime),
    byDay: new Map(value.byDay),
    bySession: new Map(value.bySession),
    byProject: new Map(value.byProject),
    byBranch: new Map(value.byBranch),
    byWorkflow: new Map(value.byWorkflow),
  };
}

export async function updateClaudePrototypeIndex(
  previous: ClaudePrototypeIndex,
  root: string,
  options: ClaudePrototypeUpdateOptions = {},
): Promise<ClaudePrototypeUpdateResult> {
  const manifest = await scanUsageManifest([root]);
  const currentEntries = [...manifest.entries.values()];
  const previousByPath = new Map(
    [...previous.files.values()].map((file) => [file.path, file]),
  );
  const seenPrevious = new Set<string>();
  const plans: FilePlan[] = [];
  const moves: Array<{ fileId: string; entry: UsageFileFingerprint }> = [];
  const changed = { append: 0, rebuild: 0, move: 0, delete: 0 };

  for (const entry of currentEntries) {
    const fileId = stableFileId(entry);
    const sameIdentity = previous.files.get(fileId);
    if (sameIdentity) {
      seenPrevious.add(fileId);
      if (sameIdentity.path !== entry.path) {
        moves.push({ fileId, entry });
        changed.move += 1;
      }
      if (sameFingerprint(sameIdentity.fingerprint, entry)) {
        continue;
      }
      if (entry.size > sameIdentity.fingerprint.size) {
        plans.push({ kind: 'append', entry, fileId, prior: sameIdentity });
        changed.append += 1;
      } else {
        plans.push({ kind: 'rebuild', entry, fileId, prior: sameIdentity });
        changed.rebuild += 1;
      }
      continue;
    }

    const replaced = previousByPath.get(entry.path);
    if (replaced && !seenPrevious.has(replaced.fileId)) {
      seenPrevious.add(replaced.fileId);
      plans.push({
        kind: 'rebuild',
        entry,
        fileId,
        prior: replaced,
        replacedFileId: replaced.fileId,
      });
    } else {
      plans.push({ kind: 'rebuild', entry, fileId });
    }
    changed.rebuild += 1;
  }

  const deletions = [...previous.files.values()].filter(
    (file) => !seenPrevious.has(file.fileId),
  );
  changed.delete = deletions.length;
  await options.afterManifest?.();

  const parsedPlans: ParsedPlan[] = [];
  let bytesRead = 0;
  let linesParsed = 0;
  for (const plan of plans) {
    const parsed = await parsePlan(plan);
    parsedPlans.push(parsed);
    bytesRead += parsed.bytesRead;
    linesParsed += parsed.linesParsed;
  }

  const files = new Map(previous.files);
  const ownerUpdates: OwnerUpdate[] = [];
  for (const deletion of deletions) {
    files.delete(deletion.fileId);
    for (const key of deletion.records.keys()) {
      ownerUpdates.push({ key, fileId: deletion.fileId });
    }
  }
  for (const move of moves) {
    const contribution = files.get(move.fileId);
    if (contribution) {
      files.set(move.fileId, {
        ...contribution,
        path: move.entry.path,
        fingerprint: move.entry,
      });
    }
  }
  for (const plan of parsedPlans) {
    if (plan.replacedFileId && plan.replacedFileId !== plan.fileId) {
      files.delete(plan.replacedFileId);
    }
    files.set(plan.fileId, plan.contribution);
    ownerUpdates.push(...ownerUpdatesForPlan(plan));
  }

  const owners = previous.owners;
  const canonical = previous.canonical;
  const aggregates = cloneAggregateMaps(previous.aggregates);
  const affectedKeys = new Set(ownerUpdates.map((update) => update.key));
  const previousCanonical = new Map(
    [...affectedKeys].map((key) => [key, canonical.get(key)]),
  );
  for (const update of ownerUpdates) {
    let candidates = owners.get(update.key);
    if (!candidates) {
      candidates = new Map();
      owners.set(update.key, candidates);
    }
    if (update.record) candidates.set(update.fileId, update.record);
    else candidates.delete(update.fileId);
    if (candidates.size === 0) owners.delete(update.key);
  }

  let aggregateMutations = 0;
  for (const key of affectedKeys) {
    const before = previousCanonical.get(key);
    const after = bestOwner(owners.get(key));
    if (before === after) continue;
    if (before) applyCanonical(aggregates, before, -1);
    if (after) {
      canonical.set(key, after);
      applyCanonical(aggregates, after, 1);
    } else {
      canonical.delete(key);
    }
    aggregateMutations += 1;
  }

  return {
    index: { files, owners, canonical, aggregates },
    diagnostics: {
      bodyReads: parsedPlans.length,
      bytesRead,
      linesParsed,
      aggregateMutations,
      changed,
    },
  };
}

export async function rebuildClaudePrototypeIndex(
  root: string,
): Promise<ClaudePrototypeUpdateResult> {
  return updateClaudePrototypeIndex(createClaudePrototypeIndex(), root);
}

function mapSnapshot(
  value: Map<string, ClaudePrototypeSummary>,
): Record<string, ClaudePrototypeSummary> {
  return Object.fromEntries(
    [...value.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, summary]) => [key, cloneSummary(summary)]),
  );
}

export function prototypeSnapshot(
  index: ClaudePrototypeIndex,
  nowMs: number = Date.now(),
): ClaudePrototypeSnapshot {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const monthPrefix = day.slice(0, 7);
  const month = emptySummary();
  for (const [key, summary] of index.aggregates.byDay) {
    if (key.startsWith(monthPrefix)) {
      applySummary(month, summary, 1);
    }
  }
  return {
    today: cloneSummary(index.aggregates.byDay.get(day)),
    month,
    allTime: cloneSummary(index.aggregates.allTime),
    days: mapSnapshot(index.aggregates.byDay),
    sessions: mapSnapshot(index.aggregates.bySession),
    projects: mapSnapshot(index.aggregates.byProject),
    branches: mapSnapshot(index.aggregates.byBranch),
    workflows: mapSnapshot(index.aggregates.byWorkflow),
  };
}
