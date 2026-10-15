import { parentPort } from 'node:worker_threads';

import {
  CodexFilePassOutcome,
  CodexFilePassTask,
  runCodexFilePass,
  codexFilePassFailureCode,
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
  } catch (error) {
    // File paths and parser errors stay inside the local worker. The
    // coordinator receives only a fixed codec enum, never native error data.
    const failureCode = codexFilePassFailureCode(error);
    outcome = { taskId: request.task.taskId, ok: false, ...(failureCode ? { failureCode } : {}) };
  }
  const response: CodexFilePassWorkerResponse = {
    type: 'outcome',
    sequence: request.sequence,
    outcome,
  };
  parentPort?.postMessage(response);
});
