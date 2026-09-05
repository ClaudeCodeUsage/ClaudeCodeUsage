import { parentPort } from 'node:worker_threads';

import {
  CODEX_REFRESH_BACKFILL_MAX_BYTES,
  CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES,
  CODEX_REFRESH_BACKGROUND_MAX_BYTES,
  CODEX_REFRESH_BACKGROUND_MAX_FILE_PASSES,
  CODEX_REFRESH_FOREGROUND_MAX_BYTES,
  CODEX_REFRESH_FOREGROUND_MAX_FILE_PASSES,
  CodexIndexCancelledError,
  CodexIndexRecovery,
  loadCodexIndex,
  saveCodexIndexAtomic,
  updateCodexIndex,
} from './codexIndex';
import { scanCodexManifest } from './codexManifest';
import {
  CodexWorkerMessage,
  CodexWorkerRequest,
  CodexWorkerResult,
} from './codexWorkerProtocol';
import {
  CodexIndexLeaseBusyError,
  CodexIndexLeaseCancelledError,
  acquireCodexIndexLease,
} from './codexIndexLease';
import { CodexFilePassPool } from './codexFilePassPool';

const cancelled = new Set<string>();
let activeRequestId: string | null = null;

function needsExpeditedBackfill(
  previous: Awaited<ReturnType<typeof loadCodexIndex>>,
  manifestFiles: number,
): boolean {
  const firstNonEmptyIndex =
    manifestFiles > 0 && Object.keys(previous.files).length === 0;
  return firstNonEmptyIndex ||
    !previous.coverage.complete ||
    !previous.coverage.period.allTime.complete;
}

function post(message: CodexWorkerMessage): void {
  parentPort?.postMessage(message);
}

function safeError(
  requestId: string,
  error: unknown,
): Extract<CodexWorkerMessage, { type: 'error' }> {
  if (
    error instanceof CodexIndexCancelledError ||
    error instanceof CodexIndexLeaseCancelledError
  ) {
    return {
      type: 'error',
      requestId,
      error: { code: 'cancelled', message: 'Codex indexing was cancelled' },
    };
  }
  if (error instanceof CodexIndexLeaseBusyError) {
    return {
      type: 'error',
      requestId,
      error: {
        code: 'busy',
        message: 'Another Codex usage refresh is already running',
      },
    };
  }
  return {
    type: 'error',
    requestId,
    error: {
      code: 'refresh-failed',
      message: 'Codex usage refresh could not be completed',
    },
  };
}

export interface CodexWorkerRefreshRuntime {
  isCancelled(): boolean;
  post(message: CodexWorkerMessage): void;
  acquireCodexIndexLease: typeof acquireCodexIndexLease;
  loadCodexIndex: typeof loadCodexIndex;
  scanCodexManifest: typeof scanCodexManifest;
  updateCodexIndex: typeof updateCodexIndex;
  saveCodexIndexAtomic: typeof saveCodexIndexAtomic;
  createCodexFilePassPool?: () => Pick<CodexFilePassPool, 'run' | 'dispose'>;
  now?: () => number;
}

export async function runCodexWorkerRefresh(
  request: Extract<CodexWorkerRequest, { type: 'refresh' }>,
  runtime: CodexWorkerRefreshRuntime,
): Promise<void> {
  const now = runtime.now ?? Date.now;
  try {
    const lease = await runtime.acquireCodexIndexLease(request.indexPath, {
      shouldCancel: runtime.isCancelled,
    });
    let result: CodexWorkerResult;
    try {
      let indexRecovery: CodexIndexRecovery | undefined;
      const metadataStarted = now();
      const [previous, manifest] = await Promise.all([
        runtime.loadCodexIndex(request.indexPath, request.timeZone, (event) => {
          indexRecovery = event;
        }),
        runtime.scanCodexManifest(request.codexHome, request.salt),
      ]);
      const metadataMs = now() - metadataStarted;
      const parseStarted = now();
      const foreground = request.profile === 'foreground';
      const expeditedBackfill = needsExpeditedBackfill(
        previous,
        manifest.files.length,
      );
      const filePassPool = expeditedBackfill
        ? runtime.createCodexFilePassPool?.()
        : undefined;
      let checkpointWrites = 0;
      let updated;
      try {
        updated = await runtime.updateCodexIndex(previous, manifest, {
          salt: request.salt,
          timeZone: request.timeZone,
          now,
          budget: {
            maxFilePasses: expeditedBackfill
              ? CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES
              : foreground
              ? CODEX_REFRESH_FOREGROUND_MAX_FILE_PASSES
              : CODEX_REFRESH_BACKGROUND_MAX_FILE_PASSES,
            maxBytes: expeditedBackfill
              ? CODEX_REFRESH_BACKFILL_MAX_BYTES
              : foreground
              ? CODEX_REFRESH_FOREGROUND_MAX_BYTES
              : CODEX_REFRESH_BACKGROUND_MAX_BYTES,
          },
          shouldCancel: runtime.isCancelled,
          onCheckpoint: async (index) => {
            await runtime.saveCodexIndexAtomic(request.indexPath, index);
            checkpointWrites += 1;
          },
          onProgress: (progress) =>
            runtime.post({
              type: 'progress',
              requestId: request.requestId,
              progress,
            }),
          ...(filePassPool ? { filePassBatch: filePassPool.run } : {}),
        });
      } finally {
        await filePassPool?.dispose();
      }
      if (runtime.isCancelled()) {
        throw new CodexIndexCancelledError();
      }
      if ((updated.indexChanged || indexRecovery) && checkpointWrites === 0) {
        await runtime.saveCodexIndexAtomic(request.indexPath, updated.index);
      }
      if (runtime.isCancelled()) {
        throw new CodexIndexCancelledError();
      }
      result = {
        ...updated,
        ...(indexRecovery ? { indexRecovery } : {}),
        metadataMs,
        parseMs: now() - parseStarted,
      };
    } finally {
      await lease.release();
    }
    runtime.post({
      type: 'result',
      requestId: request.requestId,
      result,
    });
  } catch (error) {
    runtime.post(safeError(request.requestId, error));
  }
}

async function runRefresh(
  request: Extract<CodexWorkerRequest, { type: 'refresh' }>,
): Promise<void> {
  if (activeRequestId) {
    post({
      type: 'error',
      requestId: request.requestId,
      error: {
        code: 'busy',
        message: 'A Codex usage refresh is already running',
      },
    });
    return;
  }
  activeRequestId = request.requestId;
  try {
    await runCodexWorkerRefresh(request, {
      isCancelled: () => cancelled.has(request.requestId),
      post,
      acquireCodexIndexLease,
      loadCodexIndex,
      scanCodexManifest,
      updateCodexIndex,
      saveCodexIndexAtomic,
      createCodexFilePassPool: () => new CodexFilePassPool(),
    });
  } finally {
    cancelled.delete(request.requestId);
    activeRequestId = null;
  }
}

parentPort?.on('message', (request: CodexWorkerRequest) => {
  if (request.type === 'cancel') {
    cancelled.add(request.requestId);
    return;
  }
  void runRefresh(request);
});
