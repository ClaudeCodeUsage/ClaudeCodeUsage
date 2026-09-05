import { parentPort } from 'node:worker_threads';

import {
  CodexFilePassOutcome,
  CodexFilePassTask,
  runCodexFilePass,
} from './codexIndex';

export interface CodexFilePassWorkerRequest {
  type: 'run';
  sequence: number;
  task: CodexFilePassTask;
}

export interface CodexFilePassWorkerResponse {
  type: 'outcome';
  sequence: number;
  outcome: CodexFilePassOutcome;
}

parentPort?.on('message', async (request: CodexFilePassWorkerRequest) => {
  if (request.type !== 'run') {
    return;
  }
  let outcome: CodexFilePassOutcome;
  try {
    outcome = await runCodexFilePass(request.task);
  } catch {
    // File paths and parser errors stay inside the local worker. The
    // coordinator needs only the pseudonymous task ID and failure state.
    outcome = { taskId: request.task.taskId, ok: false };
  }
  const response: CodexFilePassWorkerResponse = {
    type: 'outcome',
    sequence: request.sequence,
    outcome,
  };
  parentPort?.postMessage(response);
});
