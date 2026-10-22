import type { ProviderTokenCounts } from '../providerTypes';
import { sanitizeCodexMetadataLabel } from './codexMetadataLabel';

/** Per scan, never a retained event history or a partial-prefix allowance. */
export const CODEX_FORWARD_SLICES_MAX_SLICES = 128;
export const CODEX_FORWARD_SLICES_MAX_BYTES = 65_536;

export interface CodexForwardUsageSlice {
  readonly from: number;
  readonly through: number;
  readonly model: string;
  readonly tokens: Readonly<ProviderTokenCounts>;
  readonly quota?: Readonly<{ observedAt: number; resetAt: number; usedPercent: number }>;
}

const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const time = (v: unknown): v is number => count(v) && v > 0;
const record = (v: unknown): v is object => typeof v === 'object' && v !== null && !Array.isArray(v);
// Copy data properties only; untrusted accessors/toJSON must never run here.
function own(v: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(v, key);
  if (descriptor && !('value' in descriptor)) throw new Error('Accessor is not numeric evidence');
  return descriptor?.value;
}

/** Reconstruct a bounded, deeply immutable numeric DTO. No identifiers, bodies,
 * cumulative counters or caller-owned objects survive. Validation is all-or-none;
 * this shape alone conveys no scan, lineage or monetary admission authority. */
export function copyCodexForwardSlices(value: unknown): readonly CodexForwardUsageSlice[] | undefined {
  try {
    if (!Array.isArray(value) || value.length > CODEX_FORWARD_SLICES_MAX_SLICES) return;
    const result: CodexForwardUsageSlice[] = [];
    let previousThrough: number | undefined;
    let bytes = 2; // JSON array brackets; count the reconstructed UTF-8 JSON only.
    for (let i = 0; i < value.length; i++) {
      const raw = own(value, String(i));
      if (!record(raw)) return;
      const from = own(raw, 'from'), through = own(raw, 'through'), model = own(raw, 'model');
      if (!time(from) || !time(through) || from > through ||
        (previousThrough !== undefined && from < previousThrough) ||
        typeof model !== 'string' || model === 'unknown' || sanitizeCodexMetadataLabel(model) !== model) return;
      const rawTokens = own(raw, 'tokens');
      if (!record(rawTokens)) return;
      const inputTotal = own(rawTokens, 'inputTotal'), outputTotal = own(rawTokens, 'outputTotal');
      const rawCached = own(rawTokens, 'cachedInput'), rawReasoning = own(rawTokens, 'reasoningOutput');
      const cachedInput = rawCached === undefined ? 0 : rawCached, reasoningOutput = rawReasoning === undefined ? 0 : rawReasoning;
      const cacheWriteInput = own(rawTokens, 'cacheWriteInput'), sourceTotal = own(rawTokens, 'sourceTotal');
      if (!count(inputTotal) || !count(outputTotal) || !count(cachedInput) || !count(reasoningOutput) ||
        !time(inputTotal + outputTotal) || cachedInput > inputTotal || reasoningOutput > outputTotal ||
        (cacheWriteInput !== undefined && cacheWriteInput !== 0) ||
        (sourceTotal !== undefined && sourceTotal !== inputTotal + outputTotal)) return;
      const tokens = Object.freeze({ inputTotal, cachedInput, outputTotal, reasoningOutput,
        sourceTotal: inputTotal + outputTotal });
      const rawQuota = own(raw, 'quota');
      let quota: CodexForwardUsageSlice['quota'];
      if (rawQuota !== undefined) {
        if (!record(rawQuota)) return;
        const observedAt = own(rawQuota, 'observedAt'), resetAt = own(rawQuota, 'resetAt');
        const usedPercent = own(rawQuota, 'usedPercent');
        const provider = own(rawQuota, 'provider'), seriesKey = own(rawQuota, 'seriesKey');
        if (observedAt !== through || !time(resetAt) || resetAt <= through ||
          typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100 ||
          (provider !== undefined && provider !== 'codex') || (seriesKey !== undefined && seriesKey !== 'codex')) return;
        quota = Object.freeze({ observedAt: through, resetAt, usedPercent });
      }
      const slice: CodexForwardUsageSlice = Object.freeze({ from, through, model, tokens, ...(quota ? { quota } : {}) });
      bytes += Buffer.byteLength(JSON.stringify(slice), 'utf8') + (i > 0 ? 1 : 0);
      if (bytes > CODEX_FORWARD_SLICES_MAX_BYTES) return;
      result.push(slice);
      previousThrough = through;
    }
    return Object.freeze(result);
  } catch { return; }
}
