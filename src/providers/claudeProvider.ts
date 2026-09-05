import { ClaudeDataLoader } from '../dataLoader';
import { ClaudeUsageRecord, UsageData } from '../types';

export interface ClaudeProviderSnapshot {
  provider: 'claude';
  confidence: 'exact';
  legacyUsage: UsageData;
}

/** Preserve the established Claude aggregate as the first provider adapter. */
export function buildClaudeProviderSnapshot(
  records: ClaudeUsageRecord[],
): ClaudeProviderSnapshot {
  return {
    provider: 'claude',
    confidence: 'exact',
    legacyUsage: ClaudeDataLoader.getAllTimeData(records),
  };
}
