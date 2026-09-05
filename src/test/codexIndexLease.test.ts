import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CodexIndexLeaseBusyError,
  CodexIndexLeaseCancelledError,
  acquireCodexIndexLease,
} from '../providers/codex/codexIndexLease';

async function writeLeaseOwner(
  lockPath: string,
  owner: { pid: number; token: string; createdAt: number },
): Promise<void> {
  await mkdir(lockPath, { recursive: true });
  await writeFile(
    path.join(lockPath, owner.token),
    JSON.stringify(owner),
    'utf8',
  );
}

async function readOnlyLeaseOwner(lockPath: string): Promise<{
  path: string;
  contents: string;
}> {
  const entries = await readdir(lockPath);
  assert.equal(entries.length, 1);
  const ownerPath = path.join(lockPath, entries[0]);
  return {
    path: ownerPath,
    contents: await readFile(ownerPath, 'utf8'),
  };
}

test('a second Codex index lease waits until the first lease releases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-serial-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const first = await acquireCodexIndexLease(indexPath);
    let secondAcquired = false;
    const secondPending = acquireCodexIndexLease(indexPath, {
      retryDelayMs: 1,
      timeoutMs: 1_000,
    }).then((lease) => {
      secondAcquired = true;
      return lease;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(secondAcquired, false);
    await first.release();
    const second = await secondPending;
    assert.equal(secondAcquired, true);
    await second.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a dead lease owner is reclaimed without waiting for the timeout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-dead-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const lockPath = `${indexPath}.lock`;
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeLeaseOwner(
      lockPath,
      { pid: 424242, token: 'dead-owner', createdAt: 1_000 },
    );

    const lease = await acquireCodexIndexLease(indexPath, {
      now: () => 1_001,
      isProcessAlive: () => false,
      timeoutMs: 0,
    });

    assert.doesNotMatch((await readOnlyLeaseOwner(lockPath)).contents, /dead-owner/);
    await lease.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a dead legacy file lease is reclaimed during the directory-lease upgrade', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-legacy-dead-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const lockPath = `${indexPath}.lock`;
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 424242, token: 'legacy-dead', createdAt: 1_000 }),
      'utf8',
    );

    const lease = await acquireCodexIndexLease(indexPath, {
      isProcessAlive: () => false,
      timeoutMs: 0,
    });

    assert.doesNotMatch((await readOnlyLeaseOwner(lockPath)).contents, /legacy-dead/);
    await lease.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a live legacy file lease remains protected during upgrade', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-legacy-live-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const lockPath = `${indexPath}.lock`;
    const contents = JSON.stringify({
      pid: process.pid,
      token: 'legacy-live',
      createdAt: Date.now(),
    });
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(lockPath, contents, 'utf8');

    await assert.rejects(
      acquireCodexIndexLease(indexPath, {
        isProcessAlive: () => true,
        timeoutMs: 0,
      }),
      CodexIndexLeaseBusyError,
    );
    assert.equal(await readFile(lockPath, 'utf8'), contents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a symlinked lease path is never followed or reclaimed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-symlink-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const lockPath = `${indexPath}.lock`;
    const targetPath = path.join(root, 'outside-lock');
    const contents = JSON.stringify({
      pid: 424242,
      token: 'linked-dead',
      createdAt: 1_000,
    });
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(targetPath, contents, 'utf8');
    await symlink(targetPath, lockPath);

    await assert.rejects(
      acquireCodexIndexLease(indexPath, {
        isProcessAlive: () => false,
        timeoutMs: 0,
      }),
      CodexIndexLeaseBusyError,
    );
    assert.equal(await readFile(targetPath, 'utf8'), contents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent dead-owner recovery never overlaps live Codex index leases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-contended-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const lockPath = `${indexPath}.lock`;
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeLeaseOwner(
      lockPath,
      { pid: 424242, token: 'dead-owner', createdAt: 1_000 },
    );

    let activeLeases = 0;
    let maxActiveLeases = 0;
    await Promise.all(Array.from({ length: 50 }, async () => {
      const lease = await acquireCodexIndexLease(indexPath, {
        retryDelayMs: 0,
        timeoutMs: 15_000,
        isProcessAlive: (pid) => pid === process.pid,
      });
      activeLeases += 1;
      maxActiveLeases = Math.max(maxActiveLeases, activeLeases);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeLeases -= 1;
      await lease.release();
    }));

    assert.equal(maxActiveLeases, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unknown non-empty lease directory is protected as busy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-unknown-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const lockPath = `${indexPath}.lock`;
    await mkdir(lockPath, { recursive: true });
    await writeFile(path.join(lockPath, 'unknown'), '', 'utf8');

    await assert.rejects(
      acquireCodexIndexLease(indexPath, {
        timeoutMs: 0,
      }),
      CodexIndexLeaseBusyError,
    );
    assert.equal(await readFile(path.join(lockPath, 'unknown'), 'utf8'), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a live lease times out with a safe busy error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-busy-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const first = await acquireCodexIndexLease(indexPath);
    let now = 0;

    await assert.rejects(
      acquireCodexIndexLease(indexPath, {
        now: () => {
          now += 100;
          return now;
        },
        isProcessAlive: () => true,
        retryDelayMs: 0,
        timeoutMs: 150,
        sleep: async () => undefined,
      }),
      CodexIndexLeaseBusyError,
    );
    await first.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('waiting for a Codex index lease honours cancellation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-cancel-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const first = await acquireCodexIndexLease(indexPath);
    let cancelled = false;

    await assert.rejects(
      acquireCodexIndexLease(indexPath, {
        shouldCancel: () => cancelled,
        isProcessAlive: () => true,
        retryDelayMs: 0,
        sleep: async () => { cancelled = true; },
      }),
      CodexIndexLeaseCancelledError,
    );
    await first.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release never removes a lock whose ownership token changed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-token-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const lockPath = `${indexPath}.lock`;
    const lease = await acquireCodexIndexLease(indexPath);
    const previous = await readOnlyLeaseOwner(lockPath);
    await unlink(previous.path);
    await rmdir(lockPath);
    await writeLeaseOwner(
      lockPath,
      { pid: process.pid, token: 'new-owner', createdAt: Date.now() },
    );

    await lease.release();

    assert.match((await readOnlyLeaseOwner(lockPath)).contents, /new-owner/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release can be retried after a transient lock read failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lease-release-retry-'));
  try {
    const indexPath = path.join(root, 'cache', 'index.json');
    const lockPath = `${indexPath}.lock`;
    const lease = await acquireCodexIndexLease(indexPath);
    const owner = await readOnlyLeaseOwner(lockPath);
    const heldOwnerPath = `${owner.path}.held`;
    await rename(owner.path, heldOwnerPath);
    await mkdir(owner.path);

    await assert.rejects(lease.release());

    await rm(owner.path, { recursive: true, force: true });
    await rename(heldOwnerPath, owner.path);
    await lease.release();
    await assert.rejects(readdir(lockPath), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
