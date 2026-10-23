import { isCodexForwardHistoricalQualityFlag } from './codexParser';

/** Reset diagnostics describe discarded old bytes, not the rebuilt parser.
 * Only a current-source proof may recover them for a future baseline. The
 * scanner separately checks physical identity before issuing later tail proof. */
export function isCodexForwardFileQualityFlag(flag: string, currentSource: boolean): boolean {
  return isCodexForwardHistoricalQualityFlag(flag) ||
    currentSource && (flag === 'replaced-jsonl' || flag === 'truncated-jsonl');
}
