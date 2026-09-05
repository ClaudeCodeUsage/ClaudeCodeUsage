import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const serverPath = fileURLToPath(
  new URL('../../tests/ui/support/server.mjs', import.meta.url),
);
const uiTestPort = Number(process.env.CCU_UI_TEST_PORT ?? 4173);

function request(path) {
  return new Promise((resolve, reject) => {
    const call = get({ hostname: '127.0.0.1', port: uiTestPort, path }, (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    call.on('error', reject);
  });
}

async function waitForServer(child, stderr) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`UI server exited before health check: ${stderr()}`);
    }
    try {
      const response = await request('/health');
      if (response.status === 200) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (child.exitCode !== null) {
          throw new Error(`UI server exited after health check: ${stderr()}`);
        }
        return;
      }
    } catch (error) {
      if (child.exitCode !== null) throw error;
      // Server startup is asynchronous; retry the real health endpoint.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`UI server health check timed out: ${stderr()}`);
}

test('UI harness returns a generic 500 body without stack or local path disclosure', async (t) => {
  let stderr = '';
  const child = spawn(process.execPath, [serverPath], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGTERM');
  });

  await waitForServer(child, () => stderr);
  await t.test('dark rendering exposes the VS Code foreground token', async () => {
    const response = await request('/?theme=dark');
    assert.equal(response.status, 200);
    assert.match(response.body, /<body class="vscode-dark\b/);
    assert.match(response.body, /--vscode-foreground:#CCCCCC/);
  });
  await t.test('light rendering exposes the VS Code foreground token', async () => {
    const response = await request('/?theme=light');
    assert.equal(response.status, 200);
    assert.match(response.body, /<body class="vscode-light\b/);
    assert.match(response.body, /--vscode-foreground:#616161/);
  });
  const response = await request('//[');
  assert.equal(response.status, 500);
  assert.equal(response.body, 'Internal Server Error');
  assert.doesNotMatch(response.body, /\/private\//);
  assert.doesNotMatch(response.body, /\bat .*server\.mjs/);
});
