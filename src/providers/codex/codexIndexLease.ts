import { randomUUID } from 'node:crypto';
import {
  mkdir,
  lstat,
  open,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
} from 'node:fs/promises';
import * as path from 'node:path';

const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_MS = 30 * 60_000;

interface CodexIndexLeaseOwner {
  pid: number;
  token: string;
  createdAt: number;
}

interface CodexIndexLeaseObservation {
  legacyFile?: boolean;
  owner?: CodexIndexLeaseOwner;
  ownerFile?: string;
  stale: boolean;
}

export interface CodexIndexLease {
  release(): Promise<void>;
}

export interface CodexIndexLeaseOptions {
  now?: () => number;
  shouldCancel?: () => boolean;
  retryDelayMs?: number;
  timeoutMs?: number;
  staleMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  isProcessAlive?: (pid: number) => boolean;
}

export class CodexIndexLeaseBusyError extends Error {
  readonly code = 'busy';

  constructor() {
    super('Another Codex usage refresh is already running');
    this.name = 'CodexIndexLeaseBusyError';
  }
}

export class CodexIndexLeaseCancelledError extends Error {
  readonly code = 'cancelled';

  constructor() {
    super('Codex indexing was cancelled');
    this.name = 'CodexIndexLeaseCancelledError';
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function isPublishConflict(error: unknown): boolean {
  return (
    isErrorCode(error, 'EEXIST') ||
    isErrorCode(error, 'ENOTEMPTY') ||
    isErrorCode(error, 'EISDIR') ||
    isErrorCode(error, 'ENOTDIR')
  );
}

function parseOwner(value: string): CodexIndexLeaseOwner | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<CodexIndexLeaseOwner>;
    if (
      Number.isInteger(parsed.pid) &&
      (parsed.pid ?? 0) > 0 &&
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.createdAt === 'number' &&
      Number.isFinite(parsed.createdAt)
    ) {
      return parsed as CodexIndexLeaseOwner;
    }
  } catch {
    // A malformed owner is treated as busy rather than deleting unknown data.
  }
  return undefined;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrorCode(error, 'ESRCH');
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function observeLease(
  lockPath: string,
  now: number,
  staleMs: number,
  isProcessAlive: (pid: number) => boolean,
): Promise<CodexIndexLeaseObservation | undefined> {
  let lockInfo;
  try {
    lockInfo = await lstat(lockPath);
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
  if (lockInfo.isSymbolicLink()) {
    return { stale: false };
  }
  if (!lockInfo.isDirectory()) {
    if (!lockInfo.isFile()) {
      return { stale: false };
    }
    let owner: CodexIndexLeaseOwner | undefined;
    try {
      owner = parseOwner(await readFile(lockPath, 'utf8'));
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) {
        return undefined;
      }
      throw error;
    }
    if (!owner) {
      return { stale: false };
    }
    return {
      legacyFile: true,
      owner,
      ownerFile: lockPath,
      stale: (
        now - owner.createdAt >= staleMs ||
        !isProcessAlive(owner.pid)
      ),
    };
  }

  let entries;
  try {
    entries = await readdir(lockPath, { withFileTypes: true });
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    if (isErrorCode(error, 'ENOTDIR')) {
      // The path changed between lstat() and readdir(); fail closed for this
      // attempt and let the next retry observe one coherent lease shape.
      return { stale: false };
    }
    throw error;
  }

  const candidates: Array<{
    owner: CodexIndexLeaseOwner;
    ownerFile: string;
  }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const ownerFile = path.join(lockPath, entry.name);
    let owner: CodexIndexLeaseOwner | undefined;
    try {
      owner = parseOwner(await readFile(ownerFile, 'utf8'));
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) {
        continue;
      }
      throw error;
    }
    if (owner?.token === entry.name) {
      candidates.push({ owner, ownerFile });
    }
  }

  // A valid directory lease has exactly one token-named owner file. Unknown
  // or partially modified directories stay busy rather than being destroyed.
  if (candidates.length !== 1 || entries.length !== 1) {
    return { stale: false };
  }
  const candidate = candidates[0];
  return {
    ...candidate,
    stale: (
      now - candidate.owner.createdAt >= staleMs ||
      !isProcessAlive(candidate.owner.pid)
    ),
  };
}

async function reapObservedLease(
  lockPath: string,
  observed: CodexIndexLeaseObservation,
): Promise<boolean> {
  if (!observed.stale || !observed.ownerFile) {
    return false;
  }
  try {
    // The token is part of the pathname, so a delayed reaper can only remove
    // the owner it observed. A replacement lease has a different UUID file.
    await unlink(observed.ownerFile);
  } catch (error) {
    if (
      isErrorCode(error, 'ENOENT') ||
      (
        observed.legacyFile &&
        (isErrorCode(error, 'EISDIR') || isErrorCode(error, 'EPERM'))
      )
    ) {
      return false;
    }
    throw error;
  }
  try {
    await rmdir(lockPath);
  } catch (error) {
    if (
      isErrorCode(error, 'ENOENT') ||
      isErrorCode(error, 'ENOTEMPTY') ||
      isErrorCode(error, 'EEXIST')
    ) {
      return true;
    }
    throw error;
  }
  return true;
}

export async function acquireCodexIndexLease(
  indexPath: string,
  options: CodexIndexLeaseOptions = {},
): Promise<CodexIndexLease> {
  const lockPath = `${indexPath}.lock`;
  const now = options.now ?? Date.now;
  const shouldCancel = options.shouldCancel ?? (() => false);
  const retryDelayMs = Math.max(
    0,
    Math.floor(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS),
  );
  const timeoutMs = Math.max(
    0,
    Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  );
  const staleMs = Math.max(
    1,
    Math.floor(options.staleMs ?? DEFAULT_STALE_MS),
  );
  const sleep = options.sleep ?? delay;
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  const startedAt = now();
  await mkdir(path.dirname(indexPath), { recursive: true });

  while (true) {
    if (shouldCancel()) {
      throw new CodexIndexLeaseCancelledError();
    }
    const owner: CodexIndexLeaseOwner = {
      pid: process.pid,
      token: randomUUID(),
      createdAt: now(),
    };
    const pendingPath = `${lockPath}.pending-${owner.token}`;
    const pendingOwnerPath = path.join(pendingPath, owner.token);
    let ownerHandle: Awaited<ReturnType<typeof open>> | undefined;
    let acquired = false;
    try {
      // Build a complete, non-empty lease directory before publishing it.
      // rename() then exposes the directory atomically, so no contender can
      // observe an empty owner-creation window.
      await mkdir(pendingPath, { mode: 0o700 });
      ownerHandle = await open(pendingOwnerPath, 'wx', 0o600);
      await ownerHandle.writeFile(JSON.stringify(owner), 'utf8');
      await ownerHandle.sync();
      await ownerHandle.close();
      ownerHandle = undefined;
      await rename(pendingPath, lockPath);
      acquired = true;

      let released = false;
      let ownerRemoved = false;
      return {
        async release(): Promise<void> {
          if (released) {
            return;
          }
          if (!ownerRemoved) {
            try {
              await unlink(path.join(lockPath, owner.token));
              ownerRemoved = true;
            } catch (error) {
              if (isErrorCode(error, 'ENOENT')) {
                released = true;
                return;
              }
              throw error;
            }
          }
          try {
            await rmdir(lockPath);
          } catch (error) {
            if (
              isErrorCode(error, 'ENOENT') ||
              isErrorCode(error, 'ENOTEMPTY') ||
              isErrorCode(error, 'EEXIST')
            ) {
              released = true;
              return;
            }
            throw error;
          }
          released = true;
        },
      };
    } catch (error) {
      await ownerHandle?.close().catch(() => undefined);
      const observed = await observeLease(
        lockPath,
        now(),
        staleMs,
        isProcessAlive,
      );
      if (!observed) {
        // The owner that made rename() fail can release before our follow-up
        // inspection. That is a normal retry, not an acquisition failure.
        if (isPublishConflict(error)) {
          continue;
        }
        throw error;
      }
      if (await reapObservedLease(lockPath, observed)) {
        continue;
      }
      if (now() - startedAt >= timeoutMs) {
        throw new CodexIndexLeaseBusyError();
      }
      await sleep(retryDelayMs);
    } finally {
      if (!acquired) {
        await rm(pendingPath, { recursive: true, force: true })
          .catch(() => undefined);
      }
    }
  }
}
