import { createHash } from 'node:crypto';
import type { CodexLineOutput } from './codexParser';
import { isObject, JsonObject } from './codexSchema';
import { sanitizeCodexMetadataLabel } from './codexMetadataLabel';

type Usage = readonly [number, number, number, number];
export interface CodexUsageRecordPairMarker {
  readonly kind: 'record' | 'response' | 'count';
  /** Raw JSON envelope ordinal, never inferred from physical position. */
  readonly ordinal: number;
  readonly scanOrdinal: number;
  readonly observedAt: number;
  readonly contextKey: string;
  readonly usage?: Usage;
  readonly model?: string;
}
export interface CodexUsageRecordPairDecision {
  readonly waiveRecordFailure: boolean;
  readonly unsafe: boolean;
  readonly bounds?: Readonly<{ from: number; through: number }>;
}
const issued = new WeakSet<object>();
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const time = (v: unknown): v is number => count(v) && v > 0;
const own = (v: object, key: string): unknown => Object.getOwnPropertyDescriptor(v, key)?.value;
const hasOnly = (v: object, keys: readonly string[]) => Object.keys(v).every(key => keys.includes(key));
const vectorKeys = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
  'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const envelopeKeys = ['type', 'timestamp', 'ordinal', 'payload'];
const payloadKeys = ['thread_id', 'turn_id', 'session_id', 'root_turn_id', 'response_id',
  'usage', 'turn_token_usage', 'thread_token_usage', 'model'];
const idKeys = ['thread_id', 'turn_id', 'session_id', 'root_turn_id', 'response_id'];
function usage(raw: unknown, primaryLast = false): Usage | undefined {
  if (!isObject(raw) || !hasOnly(raw, primaryLast ? [...vectorKeys, 'cache_read_input_tokens'] : vectorKeys)) return;
  const input = own(raw, 'input_tokens'), output = own(raw, 'output_tokens');
  const cached = own(raw, 'cached_input_tokens') ?? (primaryLast ? own(raw, 'cache_read_input_tokens') : undefined);
  const reasoning = own(raw, 'reasoning_output_tokens'), total = own(raw, 'total_tokens');
  const writes = own(raw, 'cache_write_input_tokens');
  if (![input, output, cached, reasoning].every(count) || !count(input) || !count(output) ||
    !count(cached) || !count(reasoning) || !count(input + output) || cached > input || reasoning > output ||
    (primaryLast ? writes !== undefined && writes !== 0 : writes !== 0) ||
    (primaryLast ? total !== undefined && !count(total) : !count(total) || total !== input + output)) return;
  if (primaryLast && own(raw, 'cache_read_input_tokens') !== undefined && own(raw, 'cache_read_input_tokens') !== cached) return;
  return Object.freeze([input, cached, output, reasoning] as const);
}
function validResponse(payload: JsonObject): boolean {
  const type = own(payload, 'type');
  if (type === 'message') return hasOnly(payload, ['type', 'id', 'role', 'content', 'phase', 'status', 'end_turn']) &&
    own(payload, 'role') === 'assistant' && Array.isArray(own(payload, 'content'));
  if (type === 'reasoning') return hasOnly(payload, ['type', 'id', 'summary', 'content', 'encrypted_content', 'status']) &&
    Array.isArray(own(payload, 'summary')) && (own(payload, 'content') === undefined || Array.isArray(own(payload, 'content')));
  if (type === 'function_call') return hasOnly(payload, ['type', 'id', 'call_id', 'name', 'arguments', 'status']) &&
    typeof own(payload, 'name') === 'string' && (own(payload, 'name') as string).length > 0 &&
    typeof own(payload, 'arguments') === 'string' && typeof own(payload, 'call_id') === 'string';
  return false;
}

/** Forward-only evidence from the ALREADY parsed envelope. No IDs, bodies or
 * cumulative counters escape this helper. Existing primary output is not changed.
 * This recognizes one observed rollout layout, not universal request identity. */
export function codexUsageRecordPairMarker(entry: JsonObject, parsed: CodexLineOutput,
  scanOrdinal: number | undefined, pseudonymize?: (raw: string) => string): CodexUsageRecordPairMarker | undefined {
  try {
    if (!time(scanOrdinal) || !hasOnly(entry, envelopeKeys) || !count(own(entry, 'ordinal')) ||
      !time(parsed.observedAt) || !isObject(own(entry, 'payload'))) return;
    const type = own(entry, 'type'), payload = own(entry, 'payload') as JsonObject;
    if (type !== 'token_usage_record' && type !== 'response_item' &&
      !(type === 'event_msg' && own(payload, 'type') === 'token_count')) return;
    const s = parsed.state;
    if (s.identityLocked !== true || !/^[a-f0-9]{64}$/.test(s.sessionKey) || s.role === 'unknown') return;
    const model = s.model === undefined ? undefined : sanitizeCodexMetadataLabel(s.model);
    if (s.model !== undefined && model !== s.model) return;
    let kind: CodexUsageRecordPairMarker['kind'], vector: Usage | undefined;
    if (type === 'token_usage_record') {
      if (!hasOnly(payload, payloadKeys) || !pseudonymize ||
        idKeys.some(key => typeof own(payload, key) !== 'string' || (own(payload, key) as string).length === 0 ||
          (own(payload, key) as string).length > 512 || /[\p{Cc}\p{Cf}]/u.test(own(payload, key) as string)) ||
        pseudonymize(own(payload, 'thread_id') as string) !== s.sessionKey) return;
      // session_id is intentionally NOT used as thread identity.
      vector = usage(own(payload, 'usage'));
      if (!vector || !usage(own(payload, 'turn_token_usage')) || !usage(own(payload, 'thread_token_usage'))) return;
      const explicitModel = own(payload, 'model');
      if (explicitModel !== undefined && (sanitizeCodexMetadataLabel(explicitModel) !== explicitModel || explicitModel !== model)) return;
      kind = 'record';
    } else if (type === 'response_item') {
      if (parsed.forwardCalibrationIncomplete || !validResponse(payload)) return;
      kind = 'response';
    } else {
      if (parsed.forwardCalibrationIncomplete || parsed.quotaPairingIncomplete || parsed.quotaSource === 'other' ||
        parsed.events.length !== 1 || !parsed.lineageTokenKey || !isObject(own(payload, 'info'))) return;
      vector = usage(own(own(payload, 'info') as JsonObject, 'last_token_usage'), true);
      const event = parsed.events[0], tokens = event.tokens;
      if (!vector || tokens.inputTotal + tokens.outputTotal <= 0 || event.sessionKey !== s.sessionKey || event.model !== model ||
        [tokens.inputTotal, tokens.cachedInput ?? 0, tokens.outputTotal, tokens.reasoningOutput ?? 0].some((v, i) => v !== vector![i])) return;
      kind = 'count';
    }
    const contextKey = createHash('sha256').update(JSON.stringify([s.sessionKey, s.parentSessionKey, s.treeKey, s.role])).digest('hex');
    const marker = Object.freeze({ kind, ordinal: own(entry, 'ordinal') as number, scanOrdinal,
      observedAt: parsed.observedAt, contextKey, ...(vector ? { usage: vector } : {}), ...(model ? { model } : {}) });
    issued.add(marker); return marker;
  } catch { return; }
}

const idle: CodexUsageRecordPairDecision = Object.freeze({ waiveRecordFailure: false, unsafe: false });
const unsafe: CodexUsageRecordPairDecision = Object.freeze({ waiveRecordFailure: false, unsafe: true });
/** One pending fixed-size record, at most two following physical lines, five
 * seconds. No queue/search, after-order matching, persistence or prefix replay. */
export class CodexUsageRecordPairGuard {
  private pending?: { record: CodexUsageRecordPairMarker; responseAt?: number };
  private failed = false;
  private lastScanOrdinal = 0;
  private lastRawOrdinal = -1;
  get complete(): boolean { return !this.failed && this.pending === undefined; }
  invalidate(): void { this.pending = undefined; this.failed = true; }
  observe(scanOrdinal: number, marker?: CodexUsageRecordPairMarker): CodexUsageRecordPairDecision {
    if (this.failed) return unsafe;
    if (!time(scanOrdinal) || scanOrdinal <= this.lastScanOrdinal || marker &&
      (!issued.has(marker) || marker.scanOrdinal !== scanOrdinal)) { this.invalidate(); return unsafe; }
    this.lastScanOrdinal = scanOrdinal;
    if (!this.pending && marker?.kind === 'record' && marker.ordinal <= this.lastRawOrdinal) {
      this.invalidate(); return unsafe;
    }
    if (marker) this.lastRawOrdinal = Math.max(this.lastRawOrdinal, marker.ordinal);
    if (this.pending) {
      const { record, responseAt } = this.pending, slot = responseAt === undefined ? 1 : 2;
      if (!marker || marker.scanOrdinal !== record.scanOrdinal + slot || marker.ordinal !== record.ordinal + slot ||
        marker.contextKey !== record.contextKey || marker.model !== record.model ||
        marker.observedAt < (responseAt ?? record.observedAt) || marker.observedAt - record.observedAt > 5000 ||
        marker.kind !== (slot === 1 ? 'response' : 'count')) { this.invalidate(); return unsafe; }
      if (slot === 1) { this.pending.responseAt = marker.observedAt; return idle; }
      if (!marker.usage || !record.usage || marker.usage.some((v, i) => v !== record.usage![i])) { this.invalidate(); return unsafe; }
      this.pending = undefined;
      return { waiveRecordFailure: false, unsafe: false, bounds: Object.freeze({ from: record.observedAt, through: marker.observedAt }) };
    }
    if (marker?.kind === 'record') {
      this.pending = { record: marker };
      return { waiveRecordFailure: true, unsafe: false };
    }
    return idle;
  }
}
