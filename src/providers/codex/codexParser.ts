import {
  NormalizedUsageEvent,
  ProviderLimitSnapshot,
  ProviderThreadRole,
  ProviderTokenCounts,
} from '../providerTypes';
import {
  isObject,
  JsonObject,
  numberField,
  parseJsonObject,
  stringField,
} from './codexSchema';
import { safeProjectIdentity } from './codexIdentity';
import { sanitizeCodexMetadataLabel } from './codexMetadataLabel';

export interface CodexRawTokenCounts {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexParserState {
  schemaVersion: 1 | 2 | 3 | 4;
  fileKey: string;
  sessionKey: string;
  treeKey?: string;
  identityLocked?: boolean;
  parentSessionKey?: string;
  projectKey?: string;
  projectName?: string;
  projectDirectoryName?: string;
  agentNickname?: string;
  currentTurnId?: string;
  model?: string;
  effort?: string;
  role: ProviderThreadRole;
  highWater?: CodexRawTokenCounts;
  snapshotSignaturesBySource?: Record<string, string>;
  previousSnapshotSignature?: string;
  qualityFlags: string[];
}

export interface CodexStructuralEvent {
  kind: 'tool' | 'patch' | 'task-complete' | 'compaction';
  name?: string;
  count?: number;
  timestamp: number;
}

export interface CodexLineOutput {
  /** Numeric envelope time only; no raw line or message is retained. */
  observedAt?: number;
  /** Current-line attribution cannot prove a paired post-baseline increment. */
  quotaPairingIncomplete?: boolean;
  /** Fixed enum only; present even when that source has no usable quota window. */
  quotaSource?: 'codex' | 'unspecified' | 'other';
  state: CodexParserState;
  events: NormalizedUsageEvent[];
  limit?: ProviderLimitSnapshot;
  structural?: CodexStructuralEvent;
  lineageBoundary?: boolean;
  lineageTokenKey?: string;
}

export function createCodexParserState(
  fileKey: string,
): CodexParserState {
  return {
    // Version 4 invalidates v2.3.0's schema-3 parser snapshots after the
    // request-level token attribution rules changed. The outer persisted
    // index remains schema 3; only each file's parser semantics are rebuilt.
    schemaVersion: 4,
    fileKey,
    sessionKey: fileKey,
    identityLocked: false,
    role: 'root',
    qualityFlags: [],
  };
}

function withFlag(state: CodexParserState, flag: string): CodexParserState {
  if (state.qualityFlags.includes(flag)) {
    return state;
  }
  return { ...state, qualityFlags: [...state.qualityFlags, flag] };
}

function rawTokenCounts(value: unknown): CodexRawTokenCounts | null {
  if (!isObject(value)) {
    return null;
  }
  const validTokenField = (key: string): number | undefined => {
    const result = numberField(value, key);
    return result !== undefined && Number.isSafeInteger(result) && result >= 0
      ? result
      : undefined;
  };
  const inputTokens = validTokenField('input_tokens');
  const outputTokens = validTokenField('output_tokens');
  if (inputTokens === undefined || outputTokens === undefined) {
    return null;
  }
  return {
    inputTokens,
    cachedInputTokens:
      validTokenField('cached_input_tokens') ??
      validTokenField('cache_read_input_tokens') ??
      0,
    outputTokens,
    reasoningOutputTokens: validTokenField('reasoning_output_tokens') ?? 0,
    totalTokens: validTokenField('total_tokens') ?? inputTokens + outputTokens,
  };
}

/** Calibration validates the original cost components before primary's
 * compatibility defaults/clamps. This never changes primary attribution. */
function calibrationLastUsageIsValid(value: unknown): boolean {
  if (!isObject(value)) return false;
  const count = (raw: unknown): raw is number => typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0;
  const input = value.input_tokens, output = value.output_tokens;
  if (!count(input) || !count(output) || !Number.isSafeInteger(input + output)) return false;
  for (const key of ['cached_input_tokens', 'cache_read_input_tokens', 'reasoning_output_tokens']) {
    if (Object.prototype.hasOwnProperty.call(value, key) && !count(value[key])) return false;
  }
  const cached = value.cached_input_tokens ?? value.cache_read_input_tokens ?? 0;
  const reasoning = value.reasoning_output_tokens ?? 0;
  if (Object.prototype.hasOwnProperty.call(value, 'cached_input_tokens') &&
    Object.prototype.hasOwnProperty.call(value, 'cache_read_input_tokens') &&
    value.cached_input_tokens !== value.cache_read_input_tokens) return false;
  // last.total_tokens is context size, not a cost component or request sum.
  return count(cached) && cached <= input && count(reasoning) && reasoning <= output;
}

function rawSignature(value: CodexRawTokenCounts | null): string {
  return value
    ? [
        value.inputTokens,
        value.cachedInputTokens,
        value.outputTokens,
        value.reasoningOutputTokens,
        value.totalTokens,
      ].join(':')
    : '-';
}

function tokenSnapshotSignature(
  total: CodexRawTokenCounts | null,
  last: CodexRawTokenCounts | null,
): string {
  return `t:${rawSignature(total)}|l:${rawSignature(last)}`;
}

function exactTokenCounts(value: CodexRawTokenCounts): ProviderTokenCounts {
  return {
    inputTotal: value.inputTokens,
    cachedInput: Math.min(value.inputTokens, value.cachedInputTokens),
    outputTotal: value.outputTokens,
    reasoningOutput: Math.min(
      value.outputTokens,
      value.reasoningOutputTokens,
    ),
    // Codex uses last_token_usage.total_tokens for the active context size.
    // Attributed processed usage remains input + output.
    sourceTotal: value.inputTokens + value.outputTokens,
  };
}

const MAX_SNAPSHOT_SOURCES = 32;

function rememberSnapshotSignature(
  current: Record<string, string> | undefined,
  source: string,
  signature: string,
): Record<string, string> {
  const next = { ...current };
  delete next[source];
  next[source] = signature;
  const keys = Object.keys(next);
  for (let index = 0; index < keys.length - MAX_SNAPSHOT_SOURCES; index += 1) {
    delete next[keys[index]];
  }
  return next;
}

function componentDelta(
  current: CodexRawTokenCounts,
  previous: CodexRawTokenCounts,
): ProviderTokenCounts {
  const inputTotal = Math.max(0, current.inputTokens - previous.inputTokens);
  const outputTotal = Math.max(0, current.outputTokens - previous.outputTokens);
  return {
    inputTotal,
    cachedInput: Math.min(
      inputTotal,
      Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    ),
    outputTotal,
    reasoningOutput: Math.min(
      outputTotal,
      Math.max(
        0,
        current.reasoningOutputTokens - previous.reasoningOutputTokens,
      ),
    ),
    sourceTotal: inputTotal + outputTotal,
  };
}

function componentDeltaNeedsClamp(
  current: CodexRawTokenCounts,
  previous: CodexRawTokenCounts,
): boolean {
  const inputTotal = Math.max(0, current.inputTokens - previous.inputTokens);
  const cachedInput = Math.max(
    0,
    current.cachedInputTokens - previous.cachedInputTokens,
  );
  const outputTotal = Math.max(0, current.outputTokens - previous.outputTokens);
  const reasoningOutput = Math.max(
    0,
    current.reasoningOutputTokens - previous.reasoningOutputTokens,
  );
  return cachedInput > inputTotal || reasoningOutput > outputTotal;
}

function containedHighWater(
  current: CodexRawTokenCounts,
  previous: CodexRawTokenCounts,
): CodexRawTokenCounts {
  return {
    inputTokens: Math.max(current.inputTokens, previous.inputTokens),
    cachedInputTokens: Math.max(
      current.cachedInputTokens,
      previous.cachedInputTokens,
    ),
    outputTokens: Math.max(current.outputTokens, previous.outputTokens),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens,
      previous.reasoningOutputTokens,
    ),
    totalTokens: Math.max(current.totalTokens, previous.totalTokens),
  };
}

function zeroCounts(): CodexRawTokenCounts {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function hasRegression(
  current: CodexRawTokenCounts,
  previous: CodexRawTokenCounts,
): boolean {
  return (
    current.inputTokens < previous.inputTokens ||
    current.cachedInputTokens < previous.cachedInputTokens ||
    current.outputTokens < previous.outputTokens ||
    current.reasoningOutputTokens < previous.reasoningOutputTokens
  );
}

function hasUsage(tokens: ProviderTokenCounts): boolean {
  return (
    tokens.inputTotal > 0 ||
    (tokens.cachedInput ?? 0) > 0 ||
    tokens.outputTotal > 0 ||
    (tokens.reasoningOutput ?? 0) > 0
  );
}

function timestampOf(entry: JsonObject): number {
  const timestamp = stringField(entry, 'timestamp');
  if (!timestamp) {
    return 0;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resetTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parsePrimaryLimit(
  payload: JsonObject,
  info: JsonObject,
  observedAt: number,
): ProviderLimitSnapshot | undefined {
  const rateLimits = isObject(payload.rate_limits)
    ? payload.rate_limits
    : isObject(info.rate_limits)
      ? info.rate_limits
      : null;
  if (!rateLimits) {
    return undefined;
  }
  const windows = ['primary', 'secondary']
    .flatMap((label) => {
      const raw = rateLimits[label];
      if (!isObject(raw)) {
        return [];
      }
      const usedPercent = numberField(raw, 'used_percent');
      if (usedPercent === undefined) {
        return [];
      }
      return [{
        label,
        usedPercent,
        windowMinutes: numberField(raw, 'window_minutes'),
        resetsAt: resetTimestamp(raw.resets_at),
      }];
    });
  if (windows.length === 0) {
    return undefined;
  }
  const credits = isObject(rateLimits.credits) ? rateLimits.credits : undefined;
  const balance = credits?.balance;

  const limitId = stringField(rateLimits, 'limit_id');
  const limitName = stringField(rateLimits, 'limit_name');
  return {
    provider: 'codex',
    ...(limitId ? { limitId } : {}),
    ...(limitName ? { limitName } : {}),
    observedAt,
    source: 'local-log',
    confidence: 'last-observed',
    windows,
    ...(credits
      ? {
          credits: {
            ...(typeof credits.has_credits === 'boolean'
              ? { hasCredits: credits.has_credits }
              : {}),
            ...(typeof credits.unlimited === 'boolean'
              ? { unlimited: credits.unlimited }
              : {}),
            ...(typeof balance === 'string' || typeof balance === 'number'
              ? { balance: String(balance) }
              : {}),
          },
        }
      : {}),
  };
}

function parseTurnContext(
  entry: JsonObject,
  state: CodexParserState,
): CodexLineOutput {
  if (!isObject(entry.payload)) {
    return { state: withFlag(state, 'invalid-turn-context'), events: [] };
  }
  const model = Object.prototype.hasOwnProperty.call(entry.payload, 'model')
    ? sanitizeCodexMetadataLabel(entry.payload.model)
    : state.model;
  const effortEvidence = explicitReasoningEffort(entry.payload);
  const effort = effortEvidence.present ? effortEvidence.value : state.effort;
  return {
    state: {
      ...state,
      model,
      effort,
    },
    events: [],
  };
}

const CODEX_REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);

function normalizedReasoningEffort(value: unknown): string | undefined {
  const label = sanitizeCodexMetadataLabel(value)?.toLowerCase();
  return label && CODEX_REASONING_EFFORTS.has(label) ? label : undefined;
}

function explicitReasoningEffort(payload: JsonObject): {
  present: boolean;
  value?: string;
} {
  const raw: unknown[] = [];
  const collect = (object: JsonObject | undefined, key: string): void => {
    if (object && Object.prototype.hasOwnProperty.call(object, key)) {
      raw.push(object[key]);
    }
  };
  collect(payload, 'effort');
  const collaborationMode = isObject(payload.collaboration_mode)
    ? payload.collaboration_mode
    : undefined;
  const collaborationSettings = collaborationMode &&
    isObject(collaborationMode.settings)
    ? collaborationMode.settings
    : undefined;
  collect(collaborationSettings, 'reasoning_effort');
  const threadSettings = isObject(payload.thread_settings)
    ? payload.thread_settings
    : undefined;
  collect(threadSettings, 'reasoning_effort');
  const threadCollaboration = threadSettings &&
    isObject(threadSettings.collaboration_mode)
    ? threadSettings.collaboration_mode
    : undefined;
  const threadCollaborationSettings = threadCollaboration &&
    isObject(threadCollaboration.settings)
    ? threadCollaboration.settings
    : undefined;
  collect(threadCollaborationSettings, 'reasoning_effort');
  const item = isObject(payload.item) ? payload.item : undefined;
  collect(item, 'reasoning_effort');
  if (raw.length === 0) {
    return { present: false };
  }
  const normalized = raw.map(normalizedReasoningEffort);
  const values = new Set(
    normalized.filter((value): value is string => value !== undefined),
  );
  return normalized.some((value) => value === undefined) || values.size !== 1
    ? { present: true }
    : { present: true, value: [...values][0] };
}

function nestedObject(
  object: JsonObject,
  ...keys: string[]
): JsonObject | undefined {
  let current: unknown = object;
  for (const key of keys) {
    if (!isObject(current) || !isObject(current[key])) {
      return undefined;
    }
    current = current[key];
  }
  return isObject(current) ? current : undefined;
}

function roleFromMetadata(
  rawRole: string | undefined,
  hasParent: boolean,
): ProviderThreadRole {
  if (
    rawRole === 'codex-auto-review' ||
    rawRole === 'approval-reviewer' ||
    rawRole === 'guardian'
  ) {
    return 'approval-reviewer';
  }
  if (hasParent) {
    return 'subagent';
  }
  return 'root';
}

function parseSessionMetadata(
  entry: JsonObject,
  state: CodexParserState,
  pseudonymize?: (raw: string) => string,
): CodexLineOutput {
  if (!isObject(entry.payload)) {
    return { state: withFlag(state, 'invalid-session-meta'), events: [] };
  }
  const payload = entry.payload;
  const subagent = nestedObject(payload, 'source', 'subagent');
  const spawn = nestedObject(payload, 'source', 'subagent', 'thread_spawn');
  const rawSession = stringField(payload, 'id');
  const rawTree =
    stringField(payload, 'session_id') ?? stringField(payload, 'sessionId');
  const rawParent =
    stringField(payload, 'parent_thread_id') ??
    stringField(payload, 'forked_from_id') ??
    (spawn ? stringField(spawn, 'parent_thread_id') : undefined);
  const rawProject = stringField(payload, 'cwd');
  const git = isObject(payload.git) ? payload.git : undefined;
  const repositoryUrl = git
    ? stringField(git, 'repository_url')
    : undefined;
  const projectIdentity = safeProjectIdentity(rawProject, repositoryUrl);
  const agentNickname =
    sanitizeCodexMetadataLabel(stringField(payload, 'agent_nickname')) ??
    sanitizeCodexMetadataLabel(
      spawn ? stringField(spawn, 'agent_nickname') : undefined,
    );
  const rawRole =
    stringField(payload, 'agent_role') ??
    (spawn ? stringField(spawn, 'agent_role') : undefined) ??
    (subagent ? stringField(subagent, 'other') : undefined);
  const parentSessionKey =
    rawParent && pseudonymize
      ? pseudonymize(rawParent)
      : state.parentSessionKey;
  const role =
    rawRole === undefined && state.role === 'approval-reviewer'
      ? state.role
      : roleFromMetadata(rawRole, Boolean(parentSessionKey));

  let nextState = state;
  if (
    !pseudonymize &&
    (rawSession || rawTree || rawParent || projectIdentity.keySource)
  ) {
    nextState = withFlag(nextState, 'missing-pseudonymizer');
  }
  const sessionKey = rawSession && pseudonymize
    ? pseudonymize(rawSession)
    : undefined;
  if (
    state.identityLocked &&
    sessionKey &&
    sessionKey !== state.sessionKey
  ) {
    return { state: nextState, events: [] };
  }
  const locksIdentity = !state.identityLocked && sessionKey !== undefined;
  nextState = {
    ...nextState,
    sessionKey: sessionKey ?? state.sessionKey,
    treeKey:
      locksIdentity && rawTree && pseudonymize
        ? pseudonymize(rawTree)
        : state.treeKey,
    identityLocked: state.identityLocked || locksIdentity,
    parentSessionKey: locksIdentity || sessionKey === state.sessionKey
      ? parentSessionKey
      : state.parentSessionKey,
    projectKey: projectIdentity.keySource && pseudonymize
      ? pseudonymize(projectIdentity.keySource)
      : state.projectKey,
    projectName: projectIdentity.name ?? state.projectName,
    projectDirectoryName:
      projectIdentity.directoryName ?? state.projectDirectoryName,
    agentNickname: agentNickname ?? state.agentNickname,
    role,
  };
  return { state: nextState, events: [] };
}

function structuralFromEventMessage(
  entry: JsonObject,
  payload: JsonObject,
): CodexStructuralEvent | undefined {
  const payloadType = stringField(payload, 'type');
  if (payloadType === 'context_compacted' || payloadType === 'compaction') {
    return { kind: 'compaction', timestamp: timestampOf(entry) };
  }
  if (payloadType === 'task_complete') {
    return { kind: 'task-complete', timestamp: timestampOf(entry) };
  }
  return undefined;
}

function structuralFromResponseItem(
  entry: JsonObject,
): CodexStructuralEvent | undefined {
  if (!isObject(entry.payload)) {
    return undefined;
  }
  const payload = entry.payload;
  if (stringField(payload, 'type') !== 'function_call') {
    return undefined;
  }
  const name = stringField(payload, 'name');
  if (!name) {
    return undefined;
  }
  return {
    kind: name === 'apply_patch' ? 'patch' : 'tool',
    name,
    timestamp: timestampOf(entry),
  };
}

function parseTokenCount(
  entry: JsonObject,
  payload: JsonObject,
  state: CodexParserState,
  pseudonymize?: (raw: string) => string,
): CodexLineOutput {
  const observedAt = timestampOf(entry);
  const info = isObject(payload.info) ? payload.info : {};
  const limit = parsePrimaryLimit(payload, info, observedAt);
  const rateLimits = isObject(payload.rate_limits)
    ? payload.rate_limits
    : isObject(info.rate_limits) ? info.rate_limits : undefined;
  const rawSource = rateLimits ? stringField(rateLimits, 'limit_id') : undefined;
  const normalizedSource = rawSource?.trim().toLowerCase();
  const sourceName = rateLimits ? stringField(rateLimits, 'limit_name')?.trim().toLowerCase() : undefined;
  const quotaSource: CodexLineOutput['quotaSource'] = rateLimits
    ? normalizedSource ? normalizedSource === 'codex' ? 'codex' : 'other'
      : sourceName && sourceName !== 'codex' ? 'other' : 'unspecified'
    : undefined;
  if (!isObject(payload.info)) {
    return { state: limit ? state : withFlag(state, 'missing-token-info'), events: [], limit, quotaSource,
      ...(!limit ? { quotaPairingIncomplete: true } : {}) };
  }
  const current = rawTokenCounts(info.total_token_usage);
  const last = rawTokenCounts(info.last_token_usage);
  if (!current && !last) {
    return { state: limit ? state : withFlag(state, 'invalid-token-count'), events: [], limit, quotaSource,
      ...((!limit || info.last_token_usage != null || info.total_token_usage != null)
        ? { quotaPairingIncomplete: true } : {}) };
  }
  const source = rawSource
    ? pseudonymize?.(`rate-limit:${rawSource}`) ?? 'unknown-source'
    : 'default';
  const signature = tokenSnapshotSignature(current, last);
  const duplicate = Boolean(
    current &&
    (
      state.snapshotSignaturesBySource?.[source] === signature ||
      state.previousSnapshotSignature === signature
    )
  );
  const previous = state.highWater ?? zeroCounts();
  const regressed = current ? hasRegression(current, previous) : false;
  const nextHighWater = current
    ? containedHighWater(current, previous)
    : state.highWater;
  const tokens = duplicate
    ? componentDelta(previous, previous)
    : last
      ? exactTokenCounts(last)
      : componentDelta(nextHighWater!, previous);
  const componentClamped = Boolean(
    !duplicate && !last && nextHighWater &&
    componentDeltaNeedsClamp(nextHighWater, previous),
  );
  const flaggedState = componentClamped
    ? withFlag(
        regressed ? withFlag(state, 'counter-regression') : state,
        'component-delta-clamped',
      )
    : regressed
      ? withFlag(state, 'counter-regression')
      : state;
  let nextState: CodexParserState = {
    ...flaggedState,
    ...(nextHighWater ? { highWater: nextHighWater } : {}),
    previousSnapshotSignature: signature,
  };
  if (current) {
    nextState = {
      ...nextState,
      snapshotSignaturesBySource: rememberSnapshotSignature(
        state.snapshotSignaturesBySource,
        source,
        signature,
      ),
    };
  }
  const lineageTokenKey = signature;
  const hasExplicitLast = info.last_token_usage !== undefined && info.last_token_usage !== null;
  const quotaPairingIncomplete =
    (hasExplicitLast && !calibrationLastUsageIsValid(info.last_token_usage)) ||
    (!last && (regressed || componentClamped || !state.highWater));
  if (!hasUsage(tokens)) {
    return { state: nextState, events: [], limit, lineageTokenKey, quotaSource,
      ...(quotaPairingIncomplete ? { quotaPairingIncomplete: true } : {}) };
  }

  const event: NormalizedUsageEvent = {
    provider: 'codex',
    sourceKind: 'local-jsonl',
    schemaVariant: 'codex-token-count-v1',
    timestamp: observedAt,
    sessionKey: state.sessionKey,
    parentSessionKey: state.parentSessionKey,
    projectKey: state.projectKey,
    model: state.model,
    effort: state.effort,
    role: state.role,
    tokens,
    confidence: nextState.qualityFlags.length > 0 ? 'partial' : 'exact',
    qualityFlags: [...nextState.qualityFlags],
  };
  return { state: nextState, events: [event], limit, lineageTokenKey, quotaSource,
    ...(quotaPairingIncomplete ? { quotaPairingIncomplete: true } : {}) };
}

export function parseCodexLine(
  line: string,
  state: CodexParserState,
  pseudonymize?: (raw: string) => string,
): CodexLineOutput {
  const entry = parseJsonObject(line);
  if (!entry) {
    return { state: withFlag(state, 'invalid-json'), events: [], quotaPairingIncomplete: true };
  }
  return { ...parseCodexEntry(entry, state, pseudonymize), observedAt: timestampOf(entry) };
}

function parseCodexEntry(
  entry: JsonObject, state: CodexParserState, pseudonymize?: (raw: string) => string,
): CodexLineOutput {
  const type = stringField(entry, 'type');
  if (type === 'turn_context') {
    return parseTurnContext(entry, state);
  }
  if (type === 'session_meta') {
    return parseSessionMetadata(entry, state, pseudonymize);
  }
  if (type === 'event_msg') {
    if (!isObject(entry.payload)) {
      return { state: withFlag(state, 'invalid-event-payload'), events: [] };
    }
    const effortEvidence = explicitReasoningEffort(entry.payload);
    const eventState = effortEvidence.present
      ? { ...state, effort: effortEvidence.value }
      : state;
    if (stringField(entry.payload, 'type') === 'token_count') {
      return parseTokenCount(entry, entry.payload, eventState, pseudonymize);
    }
    if (stringField(entry.payload, 'type') === 'task_started') {
      return { state: eventState, events: [], lineageBoundary: true };
    }
    return {
      state: eventState,
      events: [],
      structural: structuralFromEventMessage(entry, entry.payload),
    };
  }
  if (type === 'response_item') {
    return { state, events: [], structural: structuralFromResponseItem(entry) };
  }
  if (
    type === 'world_state' ||
    type === 'compacted' ||
    type === 'inter_agent_communication_metadata'
  ) {
    return { state, events: [] };
  }
  return { state: withFlag(state, 'unknown-event'), events: [] };
}
