import {
  CodexIndexRecovery,
  CodexIndexProgress,
  CodexIndexUpdateResult,
  CodexIndexV1,
} from './codexIndex';
import type { CodexAchievementUsageWindow, CodexAchievementUsageDelta } from './codexAchievementOrigin';

export type CodexIndexErrorCode = 'busy' | 'cancelled' | 'disposed' | 'worker-failed' | 'refresh-failed' | 'zstd-unsupported';
export function safeCodexIndexErrorCode(value: unknown): CodexIndexErrorCode {
  return value === 'busy' || value === 'cancelled' || value === 'disposed' || value === 'worker-failed' || value === 'zstd-unsupported'
    ? value : 'refresh-failed';
}

export interface CodexWorkerRefreshInput {
  achievementUsageWindow?: CodexAchievementUsageWindow;
  codexHome: string;
  indexPath: string;
  /** Read-only compatibility input, adopted only after manifest ownership proof. */
  legacyIndexPath?: string;
  salt: string;
  timeZone: string;
  /** Controls the steady-state budget after any first-time/migration backfill. */
  profile?: 'background' | 'foreground';
  /** False keeps changed-file/tail maintenance active but suppresses unchanged
   * historical reconciliation until the persisted eligibility time. */
  allowHistoricalBackfill?: boolean;
  /** False skips achievement-only UTC output proof migration, not usage indexing. */
  allowAchievementHourProof?: boolean;
}

export type CodexWorkerRequest =
  | ({ type: 'refresh'; requestId: string } & CodexWorkerRefreshInput)
  | { type: 'cancel'; requestId: string };

export interface CodexWorkerResult {
  achievementUsageDelta?: CodexAchievementUsageDelta;
  index: CodexIndexV1;
  indexRecovery?: CodexIndexRecovery;
  indexChanged: boolean;
  bodyReads: number;
  failedFiles: number;
  metadataMs: number;
  parseMs: number;
  migration: CodexIndexUpdateResult['migration'];
}

export type CodexWorkerMessage =
  | {
      type: 'progress';
      requestId: string;
      progress: CodexIndexProgress;
    }
  | { type: 'result'; requestId: string; result: CodexWorkerResult }
  | {
      type: 'error';
      requestId: string;
      error: { code: string; message: string };
    };
