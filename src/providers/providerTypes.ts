export type UsageProvider = 'claude' | 'codex';
export type ProviderConfidence = 'exact' | 'partial' | 'estimated' | 'unknown';
export type ProviderSourceOutcome = 'success' | 'partial' | 'unavailable' | 'error';
export type ProviderThreadRole = 'root' | 'subagent' | 'approval-reviewer' | 'unknown';

export interface ProviderTokenCounts {
  inputTotal: number;
  cachedInput?: number;
  cacheWriteInput?: number;
  outputTotal: number;
  reasoningOutput?: number;
  sourceTotal?: number;
}

export interface NormalizedUsageEvent {
  provider: UsageProvider;
  sourceKind: 'local-jsonl';
  schemaVariant: string;
  timestamp: number;
  sessionKey: string;
  parentSessionKey?: string;
  projectKey?: string;
  model?: string;
  effort?: string;
  role?: ProviderThreadRole;
  tokens: ProviderTokenCounts;
  confidence: ProviderConfidence;
  qualityFlags: string[];
}

export interface ProviderLimitWindow {
  label?: string;
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
}

export interface ProviderLimitSnapshot {
  provider: UsageProvider;
  limitId?: string;
  limitName?: string;
  observedAt: number;
  source: 'oauth' | 'local-log';
  windows: ProviderLimitWindow[];
  confidence: 'exact' | 'last-observed' | 'unknown';
  credits?: {
    hasCredits?: boolean;
    unlimited?: boolean;
    balance?: string;
  };
}

export function processedTokens(tokens: ProviderTokenCounts): number {
  return Math.max(0, tokens.inputTotal) + Math.max(0, tokens.outputTotal);
}

export function freshInputPlusOutput(tokens: ProviderTokenCounts): number {
  const freshInput = Math.max(
    0,
    tokens.inputTotal - Math.max(0, tokens.cachedInput ?? 0),
  );
  return freshInput + Math.max(0, tokens.outputTotal);
}
