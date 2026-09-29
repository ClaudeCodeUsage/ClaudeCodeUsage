import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexFilePassTask } from '../providers/codex/codexIndex';
import { CodexFilePassPool, CodexFilePassWorkerLike } from '../providers/codex/codexFilePassPool';
import { CodexFilePassWorkerRequest } from '../providers/codex/codexFilePassWorker';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

class BudgetWorker extends EventEmitter implements CodexFilePassWorkerLike {
  dispatched = 0;
  heldFirst: CodexFilePassWorkerRequest | null = null;
  terminated = false;

  constructor(private readonly holdFirst: boolean) { super(); }

  postMessage(request: CodexFilePassWorkerRequest): void {
    this.dispatched += 1;
    if (this.holdFirst && request.sequence === 0) this.heldFirst = request;
    else queueMicrotask(() => this.finish(request));
  }

  finish(request: CodexFilePassWorkerRequest): void {
    if (!this.terminated) this.emit('message', {
      type: 'outcome', sequence: request.sequence,
      outcome: { taskId: request.task.taskId, ok: false },
    });
  }

  terminate(): Promise<number> { this.terminated = true; return Promise.resolve(0); }
}

function tasks(count: number): CodexFilePassTask[] {
  // Workers are synthetic and inspect only task IDs, not log files.
  return Array.from({ length: count }, (_, index) => ({ taskId: String(index) } as CodexFilePassTask));
}

test('a slow first file cannot retain every later file outcome in memory', async () => {
  const workers: BudgetWorker[] = [];
  const pool = new CodexFilePassPool(3, () => {
    const worker = new BudgetWorker(workers.length === 0);
    workers.push(worker);
    return worker;
  });
  const applied: string[] = [];
  const run = pool.run(tasks(2_000), async outcome => { applied.push(outcome.taskId); });
  void run.catch(() => {});
  try {
    await tick();
    assert.ok(workers.reduce((total, worker) => total + worker.dispatched, 0) <= 6,
      'dispatch must stop at two outcomes per worker ahead of ordered apply');
    assert.equal(applied.length, 0);
    assert.ok(workers[0].heldFirst);
    workers[0].finish(workers[0].heldFirst!);
    await run;
    assert.deepEqual(applied, Array.from({ length: 2_000 }, (_, index) => String(index)));
  } finally { await pool.dispose(); }
});

test('a slow checkpoint callback backpressures workers without losing ordered results', async () => {
  const workers: BudgetWorker[] = [];
  const pool = new CodexFilePassPool(3, () => {
    const worker = new BudgetWorker(false);
    workers.push(worker);
    return worker;
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const applied: string[] = [];
  const run = pool.run(tasks(2_000), async outcome => {
    if (outcome.taskId === '0') await gate;
    applied.push(outcome.taskId);
  });
  void run.catch(() => {});
  try {
    await tick();
    assert.ok(workers.reduce((total, worker) => total + worker.dispatched, 0) <= 6);
    release();
    await run;
    assert.deepEqual(applied, Array.from({ length: 2_000 }, (_, index) => String(index)));
  } finally { release(); await pool.dispose(); }
});
