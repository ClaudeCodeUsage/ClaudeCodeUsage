import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import { CodexIndexProgress } from './codexIndex';
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
  requestId: string;
  promise: Promise<CodexWorkerResult>;
  resolve: (result: CodexWorkerResult) => void;
  reject: (error: CodexWorkerError) => void;
  progressListeners: Array<(progress: CodexIndexProgress) => void>;
  cancelSent: boolean;
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

  constructor(private readonly workerFactory: CodexWorkerFactory = defaultWorkerFactory) {}

  refresh(
    input: CodexWorkerRefreshInput,
    onProgress?: (progress: CodexIndexProgress) => void,
  ): Promise<CodexWorkerResult> {
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
      requestId,
      promise,
      resolve,
      reject,
      progressListeners: onProgress ? [onProgress] : [],
      cancelSent: false,
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

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.active) {
      this.active.reject(
        new CodexWorkerError('disposed', 'Codex index client is disposed'),
      );
      this.active = null;
    }
    void this.worker?.terminate();
    this.worker = null;
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
    this.active = null;
    if (message.type === 'result') {
      active.resolve(message.result);
    } else {
      active.reject(new CodexWorkerError(message.error.code, message.error.message));
    }
  }

  private handleWorkerFailure(): void {
    if (this.active) {
      this.active.reject(
        new CodexWorkerError(
          'worker-failed',
          'Codex index worker stopped unexpectedly',
        ),
      );
      this.active = null;
    }
    this.worker = null;
  }
}
