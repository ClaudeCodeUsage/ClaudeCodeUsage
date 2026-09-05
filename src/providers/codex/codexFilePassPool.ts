import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  CodexFilePassBatchRunner,
  CodexFilePassOutcome,
  CodexFilePassTask,
  CodexIndexCancelledError,
} from './codexIndex';
import {
  CodexFilePassWorkerRequest,
  CodexFilePassWorkerResponse,
} from './codexFilePassWorker';

export interface CodexFilePassWorkerLike {
  postMessage(request: CodexFilePassWorkerRequest): void;
  on(
    event: 'message',
    listener: (response: CodexFilePassWorkerResponse) => void,
  ): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  terminate(): Promise<number> | number;
}

export type CodexFilePassWorkerFactory = () => CodexFilePassWorkerLike;

export function recommendedCodexBackfillWorkers(
  logicalCpus = os.cpus().length,
): number {
  if (!Number.isFinite(logicalCpus) || logicalCpus <= 1) {
    return 1;
  }
  // Leave roughly half the logical CPUs to VS Code and the operating system,
  // while allowing high-end machines to accelerate one-time rebuilds.
  return Math.max(1, Math.min(6, Math.floor(logicalCpus / 2)));
}

function defaultWorkerFactory(): CodexFilePassWorkerLike {
  return new Worker(path.join(__dirname, 'codexFilePassWorker.js'));
}

interface WorkerSlot {
  worker: CodexFilePassWorkerLike;
  sequence?: number;
}

interface ActiveBatch {
  tasks: readonly CodexFilePassTask[];
  onOutcome: (outcome: CodexFilePassOutcome) => Promise<void>;
  shouldCancel?: () => boolean;
  nextDispatch: number;
  completed: number;
  nextApply: number;
  buffered: Map<number, CodexFilePassOutcome>;
  flushing: boolean;
  settled: boolean;
  cancellationTimer: NodeJS.Timeout;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class CodexFilePassPool {
  private readonly workerLimit: number;
  private readonly workerFactory: CodexFilePassWorkerFactory;
  private workers: WorkerSlot[] = [];
  private active: ActiveBatch | null = null;
  private disposed = false;

  readonly run: CodexFilePassBatchRunner = async (
    tasks,
    onOutcome,
    shouldCancel,
  ) => {
    if (this.disposed) {
      throw new Error('Codex file pass pool is disposed');
    }
    if (this.active) {
      throw new Error('Codex file pass pool already has active work');
    }
    if (tasks.length === 0) {
      return;
    }
    if (shouldCancel?.()) {
      throw new CodexIndexCancelledError();
    }
    this.ensureWorkers(Math.min(this.workerLimit, tasks.length));
    await new Promise<void>((resolve, reject) => {
      const cancellationTimer = setInterval(() => {
        if (this.active?.shouldCancel?.()) {
          this.failActive(new CodexIndexCancelledError());
        }
      }, 100);
      cancellationTimer.unref?.();
      this.active = {
        tasks,
        onOutcome,
        shouldCancel,
        nextDispatch: 0,
        completed: 0,
        nextApply: 0,
        buffered: new Map(),
        flushing: false,
        settled: false,
        cancellationTimer,
        resolve,
        reject,
      };
      for (const slot of this.workers) {
        this.dispatch(slot);
      }
    });
  };

  constructor(
    workerLimit = recommendedCodexBackfillWorkers(),
    workerFactory: CodexFilePassWorkerFactory = defaultWorkerFactory,
  ) {
    this.workerLimit = Math.max(1, Math.floor(workerLimit));
    this.workerFactory = workerFactory;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.active) {
      this.failActive(new CodexIndexCancelledError());
    }
    const workers = this.workers.splice(0);
    await Promise.all(workers.map(async ({ worker }) => {
      try {
        await worker.terminate();
      } catch {
        // Best-effort local worker cleanup.
      }
    }));
  }

  private ensureWorkers(count: number): void {
    while (this.workers.length < count) {
      const slot: WorkerSlot = { worker: this.workerFactory() };
      slot.worker.on('message', (response) => this.handleOutcome(slot, response));
      slot.worker.on('error', () => {
        this.failActive(new Error('Codex file pass worker failed'));
      });
      slot.worker.on('exit', (code) => {
        if (!this.disposed && code !== 0 && slot.sequence !== undefined) {
          this.failActive(new Error('Codex file pass worker stopped'));
        }
      });
      this.workers.push(slot);
    }
  }

  private dispatch(slot: WorkerSlot): void {
    const active = this.active;
    if (!active || active.settled || slot.sequence !== undefined) {
      return;
    }
    if (active.shouldCancel?.()) {
      this.failActive(new CodexIndexCancelledError());
      return;
    }
    const sequence = active.nextDispatch;
    if (sequence >= active.tasks.length) {
      return;
    }
    active.nextDispatch += 1;
    slot.sequence = sequence;
    slot.worker.postMessage({
      type: 'run',
      sequence,
      task: active.tasks[sequence],
    });
  }

  private handleOutcome(
    slot: WorkerSlot,
    response: CodexFilePassWorkerResponse,
  ): void {
    const active = this.active;
    if (
      !active ||
      active.settled ||
      response.type !== 'outcome' ||
      slot.sequence !== response.sequence
    ) {
      return;
    }
    slot.sequence = undefined;
    active.completed += 1;
    active.buffered.set(response.sequence, response.outcome);
    this.flushOutcomes();
    this.dispatch(slot);
  }

  private flushOutcomes(): void {
    const active = this.active;
    if (!active || active.flushing || active.settled) {
      return;
    }
    active.flushing = true;
    void (async () => {
      try {
        while (!active.settled) {
          const outcome = active.buffered.get(active.nextApply);
          if (!outcome) {
            break;
          }
          active.buffered.delete(active.nextApply);
          await active.onOutcome(outcome);
          active.nextApply += 1;
        }
        active.flushing = false;
        if (
          active.completed === active.tasks.length &&
          active.nextApply === active.tasks.length
        ) {
          this.completeActive();
        }
      } catch (error) {
        this.failActive(
          error instanceof Error
            ? error
            : new Error('Codex file pass outcome failed'),
        );
      }
    })();
  }

  private completeActive(): void {
    const active = this.active;
    if (!active || active.settled) {
      return;
    }
    active.settled = true;
    clearInterval(active.cancellationTimer);
    this.active = null;
    active.resolve();
  }

  private failActive(error: Error): void {
    const active = this.active;
    if (!active || active.settled) {
      return;
    }
    active.settled = true;
    clearInterval(active.cancellationTimer);
    this.active = null;
    const workers = this.workers.splice(0);
    for (const { worker } of workers) {
      void worker.terminate();
    }
    active.reject(error);
  }
}
