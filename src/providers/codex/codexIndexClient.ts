import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import { CodexIndexProgress } from './codexIndex';
import { CodexAchievementUsageWindow, copyCodexUsageWindow, copyCodexUsageDelta } from './codexAchievementOrigin';
import {
  CodexWorkerMessage,
  CodexWorkerRefreshInput,
  CodexWorkerRequest,
  CodexWorkerResult,
} from './codexWorkerProtocol';

export interface CodexWorkerLike {
  postMessage(request: CodexWorkerRequest): void;
  on(
    event: 'message',
    listener: (message: CodexWorkerMessage) => void,
  ): this;
  on(event: 'error', listener: (error: Error) => void): this;
  terminate(): Promise<number> | number;
}

export class CodexWorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CodexWorkerError';
  }
}

interface ActiveRefresh {
  achievementUsageWindow?: CodexAchievementUsageWindow;
  requestId: string;
  promise: Promise<CodexWorkerResult>;
  resolve: (result: CodexWorkerResult) => void;
  reject: (error: CodexWorkerError) => void;
  progressListeners: Array<(progress: CodexIndexProgress) => void>;
  cancelSent: boolean;
  finishing: boolean;
  profile: 'background' | 'foreground';
}

export type CodexWorkerFactory = () => CodexWorkerLike;

let requestSequence = 0;

function defaultWorkerFactory(): CodexWorkerLike {
  return new Worker(path.join(__dirname, 'codexIndexWorker.js'));
}

export class CodexIndexClient {
  private worker: CodexWorkerLike | null = null;
  private active: ActiveRefresh | null = null;
  private disposed = false;
  private termination: Promise<void> | null = null;
  private terminationFailure: unknown = null;
  private disposal: Promise<void> | null = null;

  constructor(private readonly workerFactory: CodexWorkerFactory = defaultWorkerFactory) {}

  refresh(
    input: CodexWorkerRefreshInput,
    onProgress?: (progress: CodexIndexProgress) => void,
  ): Promise<CodexWorkerResult> {
    input = { ...input, achievementUsageWindow: copyCodexUsageWindow(input.achievementUsageWindow) };
    if (this.disposed) {
      return Promise.reject(
        new CodexWorkerError('disposed', 'Codex index client is disposed'),
      );
    }
    if (this.active) {
      if (
        input.profile === 'foreground' &&
        this.active.profile !== 'foreground'
      ) {
        // A manual refresh must not be swallowed by a watcher scan that was
        // already in flight. Let the bounded background pass checkpoint, then
        // immediately run one accelerated pass.
        return this.active.promise.then(() => this.refresh(input, onProgress));
      }
      if (onProgress) {
        this.active.progressListeners.push(onProgress);
      }
      return this.active.promise;
    }

    const worker = this.ensureWorker();
    const requestId = `codex-index-${Date.now()}-${++requestSequence}`;
    let resolve!: (result: CodexWorkerResult) => void;
    let reject!: (error: CodexWorkerError) => void;
    const promise = new Promise<CodexWorkerResult>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    this.active = {
      achievementUsageWindow: copyCodexUsageWindow(input.achievementUsageWindow),
      requestId,
      promise,
      resolve,
      reject,
      progressListeners: onProgress ? [onProgress] : [],
      cancelSent: false,
      finishing: false,
      profile: input.profile ?? 'background',
    };
    worker.postMessage({ type: 'refresh', requestId, ...input });
    return promise;
  }

  cancel(): void {
    if (!this.active || this.active.cancelSent || !this.worker) {
      return;
    }
    this.active.cancelSent = true;
    this.worker.postMessage({
      type: 'cancel',
      requestId: this.active.requestId,
    });
  }

  async whenIdle(): Promise<void> {
    const active = this.active;
    if (active) {
      try {
        await active.promise;
      } catch {
        // Idle is a lifecycle condition, independent of the refresh outcome.
      }
    }
    if (this.termination) {
      try {
        await this.termination;
      } catch {
        // A terminal refresh already surfaces termination failure to callers.
      }
    }
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    const active = this.active;
    if (active) {
      active.reject(
        new CodexWorkerError('disposed', 'Codex index client is disposed'),
      );
      this.active = null;
    }
    const worker = this.worker;
    this.worker = null;
    const terminating = worker
      ? Promise.resolve(worker.terminate())
          .then(() => undefined)
          .catch((error: unknown) => {
            this.terminationFailure ??= error;
            throw error;
          })
      : Promise.resolve();
    this.disposal = Promise.all([
      terminating,
      this.termination ?? Promise.resolve(),
    ]).then(() => {
      if (this.terminationFailure) throw this.terminationFailure;
    });
    return this.disposal;
  }

  private ensureWorker(): CodexWorkerLike {
    if (this.worker) {
      return this.worker;
    }
    const worker = this.workerFactory();
    worker.on('message', (message) => this.handleMessage(message));
    worker.on('error', () => this.handleWorkerFailure());
    this.worker = worker;
    return worker;
  }

  private handleMessage(message: CodexWorkerMessage): void {
    const active = this.active;
    if (!active || message.requestId !== active.requestId) {
      return;
    }
    if (message.type === 'progress') {
      for (const listener of active.progressListeners) {
        listener(message.progress);
      }
      return;
    }
    if (active.finishing) return;
    active.finishing = true;
    const terminal = message;
    void this.terminateSettledWorker()
      .then(() => {
        if (this.active === active) this.active = null;
        if (terminal.type === 'result') {
          const { achievementUsageDelta: rawDelta, ...committed } = terminal.result;
          const achievementUsageDelta = !active.cancelSent
            ? copyCodexUsageDelta(rawDelta, active.achievementUsageWindow) : undefined;
          active.resolve({ ...committed, ...(achievementUsageDelta ? { achievementUsageDelta } : {}) });
        } else {
          active.reject(new CodexWorkerError(terminal.error.code, terminal.error.message));
        }
      })
      .catch(() => {
        if (this.active === active) this.active = null;
        active.reject(new CodexWorkerError(
          'worker-failed',
          'Codex index worker could not be stopped safely',
        ));
      });
  }

  /** A worker owns no steady-state responsibility after one terminal reply. */
  private async terminateSettledWorker(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    const termination = worker
      ? Promise.resolve(worker.terminate()).then(() => undefined)
      : Promise.resolve();
    this.termination = termination;
    try {
      await termination;
    } catch (error) {
      this.terminationFailure ??= error;
      throw error;
    } finally {
      if (this.termination === termination) this.termination = null;
    }
  }

  private handleWorkerFailure(): void {
    const active = this.active;
    if (!active || active.finishing) return;
    active.finishing = true;
    const settle = (): void => {
      if (this.active === active) this.active = null;
      active.reject(
        new CodexWorkerError(
          'worker-failed',
          'Codex index worker stopped unexpectedly',
        ),
      );
    };
    void this.terminateSettledWorker().then(settle, settle);
  }
}
