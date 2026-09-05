import {
  CodexIndexRecovery,
  CodexIndexProgress,
  CodexIndexUpdateResult,
  CodexIndexV1,
} from './codexIndex';

export interface CodexWorkerRefreshInput {
  codexHome: string;
  indexPath: string;
  salt: string;
  timeZone: string;
  /** Controls the steady-state budget after any first-time/migration backfill. */
  profile?: 'background' | 'foreground';
}

export type CodexWorkerRequest =
  | ({ type: 'refresh'; requestId: string } & CodexWorkerRefreshInput)
  | { type: 'cancel'; requestId: string };

export interface CodexWorkerResult {
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
