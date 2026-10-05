import { RefreshTrigger } from './refreshPolicy';
import { ProviderSourceOutcome } from './providers/providerTypes';
import { CodexIndexRecoveryReason } from './providers/codex/codexIndex';
import { CodexIndexErrorCode, safeCodexIndexErrorCode } from './providers/codex/codexWorkerProtocol';
import type { CodexProviderFailureCode } from './providers/codex/codexProvider';

export interface LoadUsageDiagnostics {
  filesDiscovered: number;
  filesFailed: number;
  bytesRead: number;
  linesParsed: number;
  readParseMs: number;
}

export interface RefreshDiagnostic extends LoadUsageDiagnostics {
  trigger: RefreshTrigger;
  filesChanged: number;
  filesReused: number;
  filesRemoved: number;
  watcherEvents: number;
  coalescedTriggers: number;
  quotaWatcherMissingFilenameEvents: number;
  manifestMs: number;
  aggregateRenderMs: number;
  totalMs: number;
  bodyReads?: number;
  aggregateMutations?: number;
}

const ms = (value: number | null): string => value === null ? 'unknown' : value.toFixed(1);
const observedCount = (value: number | null): string => value === null ? 'unknown' : String(value);

const KNOWN_REFRESH_TRIGGERS = new Set<string>([
  'startup',
  'poll',
  'credentials',
  'watch',
  'focus',
  'workspace',
  'settings',
  'pricing',
  'manual',
]);
const KNOWN_PROVIDER_OUTCOMES = new Set<string>([
  'success',
  'partial',
  'unavailable',
  'error',
]);
const KNOWN_BACKFILL_MODES = new Set<string>(['steady', 'historical', 'unknown']);
const KNOWN_WORKER_MODES = new Set<string>(['background', 'foreground', 'unknown']);
const KNOWN_CODEX_FAILURE_CODES = new Set<string>([
  'cancelled', 'busy', 'worker-failed', 'disposed', 'refresh-failed',
]);
const KNOWN_CODEX_COVERAGE_SOURCES = new Set<string>(['current-scan', 'last-snapshot', 'unknown']);

function safeEnum(value: unknown, allowed: ReadonlySet<string>): string {
  return typeof value === 'string' && allowed.has(value) ? value : 'unknown';
}

const KNOWN_CODEX_QUALITY_FLAGS = new Set([
  'counter-regression',
  'invalid-event-payload',
  'invalid-event-timestamp',
  'invalid-json',
  'invalid-session-meta',
  'invalid-token-count',
  'invalid-turn-context',
  'missing-pseudonymizer',
  'missing-token-info',
  'oversized-jsonl-line',
  'replaced-jsonl',
  'stale-file',
  'stale-reset-required',
  'truncated-jsonl',
  'unknown-event',
]);

export function formatRefreshDiagnostic(value: RefreshDiagnostic): string {
  const incremental = value.bodyReads === undefined && value.aggregateMutations === undefined
    ? ''
    : `incremental(bodies=${value.bodyReads ?? 0} ` +
      `aggregate-mutations=${value.aggregateMutations ?? 0}) `;
  return `refresh: trigger=${safeEnum(value.trigger, KNOWN_REFRESH_TRIGGERS)} ` +
    `files(discovered=${value.filesDiscovered} changed=${value.filesChanged} ` +
    `reused=${value.filesReused} removed=${value.filesRemoved} failed=${value.filesFailed}) ` +
    `io(bytes=${value.bytesRead} lines=${value.linesParsed}) ${incremental}` +
    `events(watcher=${value.watcherEvents} coalesced=${value.coalescedTriggers} ` +
    `quota-unnamed=${value.quotaWatcherMissingFilenameEvents}) ` +
    `ms(manifest=${ms(value.manifestMs)} read-parse=${ms(value.readParseMs)} ` +
    `aggregate-render=${ms(value.aggregateRenderMs)} total=${ms(value.totalMs)})`;
}

export interface CodexIndexDiagnostic {
  trigger: RefreshTrigger;
  outcome: ProviderSourceOutcome;
  watcherEvents: number;
  coalescedTriggers: number;
  backfillMode: 'steady' | 'historical' | 'unknown';
  workerMode: 'background' | 'foreground' | 'unknown';
  coverageSource?: 'current-scan' | 'last-snapshot' | 'unknown';
  indexedFiles: number | null;
  totalFiles: number | null;
  indexedBytes: number | null;
  totalBytes: number | null;
  periodMigratedBytes: number | null;
  periodTotalBytes: number | null;
  migrationPending: boolean | null;
  indexRecovery?: CodexIndexRecoveryReason | null;
  errorCode?: CodexIndexErrorCode;
  failureCode?: CodexProviderFailureCode;
  bodyReads: number | null;
  failedFiles: number | null;
  metadataMs: number | null;
  parseMs: number | null;
  qualityFlags: Record<string, number>;
}

function safeFlagCounts(flags: Record<string, number>): string {
  const safe: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(flags)) {
    const name = KNOWN_CODEX_QUALITY_FLAGS.has(key) ? key : 'unknown';
    const count = Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0;
    safe[name] = (safe[name] ?? 0) + count;
  }
  const entries = Object.entries(safe)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0
    ? entries.map(([name, count]) => `${name}:${count}`).join(',')
    : 'none';
}

export function formatCodexIndexDiagnostic(value: CodexIndexDiagnostic): string {
  const recovery =
    value.indexRecovery === 'invalid-json' ||
    value.indexRecovery === 'unsupported-schema'
      ? value.indexRecovery
      : value.indexRecovery === null ? 'unknown' : 'none';
  const trigger = safeEnum(value.trigger, KNOWN_REFRESH_TRIGGERS);
  const outcome = safeEnum(value.outcome, KNOWN_PROVIDER_OUTCOMES);
  const backfillMode = safeEnum(value.backfillMode, KNOWN_BACKFILL_MODES);
  const workerMode = safeEnum(value.workerMode, KNOWN_WORKER_MODES);
  const failure = value.failureCode === undefined
    ? ''
    : `failure=${safeEnum(value.failureCode, KNOWN_CODEX_FAILURE_CODES)} `;
  const coverage = value.coverageSource === undefined
    ? ''
    : `coverage=${safeEnum(value.coverageSource, KNOWN_CODEX_COVERAGE_SOURCES)} `;
  const migrationPending = value.migrationPending === true ? 'true'
    : value.migrationPending === false ? 'false' : 'unknown';
  return (
    `codex-index trigger=${trigger} outcome=${outcome} ` +
    `mode(backfill=${backfillMode} worker=${workerMode}) ` +
    `events(watcher=${value.watcherEvents} coalesced=${value.coalescedTriggers}) ` +
    coverage + `files=${observedCount(value.indexedFiles)}/${observedCount(value.totalFiles)} ` +
    `bytes=${observedCount(value.indexedBytes)}/${observedCount(value.totalBytes)} ` +
    `periodBytes=${observedCount(value.periodMigratedBytes)}/${observedCount(value.periodTotalBytes)} ` +
    `migrationPending=${migrationPending} ` +
    `recovery=${recovery} ` + failure +
    (value.errorCode === undefined ? '' : `errorCode=${safeCodexIndexErrorCode(value.errorCode)} `) +
    `bodyReads=${observedCount(value.bodyReads)} failed=${observedCount(value.failedFiles)} ` +
    `metadataMs=${ms(value.metadataMs)} parseMs=${ms(value.parseMs)} ` +
    `flags=${safeFlagCounts(value.qualityFlags)}`
  );
}
