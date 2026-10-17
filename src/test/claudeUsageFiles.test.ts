import { after, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  diffUsageManifests,
  isMissingPathError,
  mapWithConcurrency,
  readEarliestTimestamp,
  scanUsageManifest,
  sortUsageFilesByEarliestTimestamp,
} from '../claudeUsageFiles';

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-files-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-tmp-demo');
  await mkdir(project, { recursive: true });
  return { root, file: path.join(project, 'a.jsonl') };
}

test('manifest scanning tolerates only disappearance races', () => {
  assert.equal(isMissingPathError(Object.assign(new Error('gone'), { code: 'ENOENT' })), true);
  assert.equal(isMissingPathError(Object.assign(new Error('denied'), { code: 'EACCES' })), false);
  assert.equal(isMissingPathError(Object.assign(new Error('io'), { code: 'EIO' })), false);
  assert.equal(isMissingPathError(new Error('unknown')), false);
});

test('manifest scanning fails closed on permission errors but tolerates stat ENOENT', async () => {
  const { root, file } = await fixture();
  await writeFile(file, '{"timestamp":"2026-01-01T00:00:00.000Z"}\n');
  const readDirectory = (dir: string) => readdir(dir, { withFileTypes: true });
  await assert.rejects(
    () => scanUsageManifest([root], {
      readdir: readDirectory,
      stat: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    }),
    (error: NodeJS.ErrnoException) => error.code === 'EACCES',
  );
  const missing = await scanUsageManifest([root], {
    readdir: readDirectory,
    stat: async () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); },
  });
  assert.equal(missing.entries.size, 0);
});

test('manifest scanning stats files concurrently and keeps discovery order', { timeout: 10_000 }, async () => {
  const { root, file } = await fixture();
  const project = path.dirname(file);
  const names = Array.from({ length: 20 }, (_, index) => `session-${String(index).padStart(2, '0')}.jsonl`);
  for (const name of names) {
    await writeFile(path.join(project, name), '{"timestamp":"2026-01-01T00:00:00.000Z"}\n');
  }
  let inFlight = 0;
  let maxInFlight = 0;
  let started = 0;
  const admissions = new Map<number, () => void>();
  const waitForStarted = (count: number): Promise<void> => started >= count
    ? Promise.resolve()
    : new Promise((resolve) => admissions.set(count, resolve));
  const pending: Array<() => void> = [];
  const manifestPromise = scanUsageManifest([root], {
    readdir: (dir: string) => readdir(dir, { withFileTypes: true }),
    stat: (filePath: string) => new Promise((resolve) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      pending.push(() => {
        inFlight -= 1;
        resolve(stat(filePath));
      });
      started += 1;
      admissions.get(started)?.();
      admissions.delete(started);
    }),
  });
  // Observe actual worker admission rather than racing a fixed number of
  // event-loop turns against filesystem completion on a loaded CI runner.
  await waitForStarted(8);
  assert.equal(pending.length, 8);
  assert.equal(maxInFlight, 8, 'the eight-worker ceiling is reached, not exceeded');
  // Releasing one worker must admit exactly one more, and never past the ceiling.
  pending.pop()!();
  await waitForStarted(9);
  assert.equal(pending.length, 8);
  assert.equal(maxInFlight, 8);
  while (pending.length > 0) {
    const nextAdmission = started + 1;
    // Reverse of start order, so a completion-order leak cannot pass as discovery order.
    pending.pop()!();
    if (started < names.length) await waitForStarted(nextAdmission);
  }
  assert.deepEqual(
    [...(await manifestPromise).entries.keys()],
    names.map((name) => path.join(project, name)),
  );
  assert.equal(started, names.length, 'every discovered file is statted exactly once');
  assert.equal(maxInFlight, 8, 'the ceiling holds through the entire drain');
});

test('a fatal stat stops scheduling files that have not started', async () => {
  const { root, file } = await fixture();
  const project = path.dirname(file);
  const names = Array.from({ length: 40 }, (_, index) => `session-${String(index).padStart(2, '0')}.jsonl`);
  for (const name of names) {
    await writeFile(path.join(project, name), '{"timestamp":"2026-01-01T00:00:00.000Z"}\n');
  }
  let started = 0;
  const blockers: Array<() => void> = [];
  const scan = scanUsageManifest([root], {
    readdir: (dir: string) => readdir(dir, { withFileTypes: true }),
    stat: async () => {
      const call = started;
      started += 1;
      if (call === 0) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      await new Promise<void>((resolve) => blockers.push(resolve));
      return stat(file);
    },
  });
  await assert.rejects(scan, (error: NodeJS.ErrnoException) => error.code === 'EACCES');
  const startedAtRejection = started;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(startedAtRejection <= 8, `scheduled ${startedAtRejection} stats after a fatal error`);
  assert.equal(started, startedAtRejection, 'no stat starts after the scan has rejected');
  for (const release of blockers) release();
});

test('manifest diff reports changed, reused, and removed without exposing them in counters', async () => {
  const { root, file } = await fixture();
  await writeFile(file, '{"timestamp":"2026-01-01T00:00:00.000Z"}\n');
  const first = await scanUsageManifest([root]);
  const cold = diffUsageManifests(null, first);
  assert.equal(cold.changed.length, 1);
  assert.equal(cold.reused.length, 0);

  const second = await scanUsageManifest([root]);
  assert.equal(diffUsageManifests(first, second).reused.length, 1);

  await writeFile(file, '{"timestamp":"2026-01-02T00:00:00.000Z"}\nlonger\n');
  const third = await scanUsageManifest([root]);
  assert.equal(diffUsageManifests(second, third).changed.length, 1);

  const replacement = `${file}.replacement`;
  await writeFile(replacement, '{"timestamp":"2026-01-03T00:00:00.000Z"}\nlonger\n');
  await rename(replacement, file);
  const fourth = await scanUsageManifest([root]);
  assert.equal(diffUsageManifests(third, fourth).changed.length, 1);

  await rm(file);
  const fifth = await scanUsageManifest([root]);
  assert.equal(diffUsageManifests(fourth, fifth).removed.length, 1);
});

test('inode detects an atomic replacement with unchanged size and mtime', async (t) => {
  const { root, file } = await fixture();
  const original = '{"timestamp":"2026-01-01T00:00:00.000Z"}\n';
  const replacementBody = '{"timestamp":"2026-01-02T00:00:00.000Z"}\n';
  assert.equal(Buffer.byteLength(original), Buffer.byteLength(replacementBody));
  await writeFile(file, original);
  const beforeManifest = await scanUsageManifest([root]);
  const before = await stat(file);

  const replacement = `${file}.replacement`;
  await writeFile(replacement, replacementBody);
  await utimes(replacement, before.atime, before.mtime);
  const prepared = await stat(replacement);
  assert.equal(prepared.size, before.size);
  if (prepared.mtimeMs !== before.mtimeMs) {
    t.skip('filesystem cannot preserve the exact mtime for this identity fixture');
    return;
  }
  await rename(replacement, file);
  const afterStat = await stat(file);
  if (!(before.dev > 0 && before.ino > 0 && afterStat.dev > 0 && afterStat.ino > 0 &&
        (before.dev !== afterStat.dev || before.ino !== afterStat.ino))) {
    t.skip('filesystem does not expose a reliable changed file identity');
    return;
  }

  const afterManifest = await scanUsageManifest([root]);
  assert.equal(diffUsageManifests(beforeManifest, afterManifest).changed.length, 1);
});

test('earliest timestamp stops after the first valid JSONL record', async () => {
  const { file } = await fixture();
  const first = '{"timestamp":"2026-02-03T04:05:06.000Z"}\n';
  await writeFile(file, first + 'x'.repeat(512 * 1024));
  const result = await readEarliestTimestamp(file);
  assert.equal(result.timestampMs, Date.parse('2026-02-03T04:05:06.000Z'));
  assert.ok(result.bytesRead < 64 * 1024, `read ${result.bytesRead} bytes`);
});

test('a valid first JSONL record larger than 1 MiB keeps its timestamp', async () => {
  const { file } = await fixture();
  const body = JSON.stringify({
    timestamp: '2026-02-03T04:05:06.000Z',
    message: { content: '中🙂'.repeat(180_000) },
  }) + '\n';
  await writeFile(file, body + '{"timestamp":"2026-03-01T00:00:00.000Z"}\n');
  const result = await readEarliestTimestamp(file);
  assert.equal(result.timestampMs, Date.parse('2026-02-03T04:05:06.000Z'));
  assert.ok(result.bytesRead > 1024 * 1024);
});

test('timestamp probing is bounded when no valid timestamp exists', async () => {
  const { file } = await fixture();
  const content = 'not-json\n'.repeat(150_000);
  await writeFile(file, content);
  await assert.rejects(
    () => readEarliestTimestamp(file),
    { name: 'TimestampProbeLimitError' },
  );
});

test('mapWithConcurrency never starts more than eight readers', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency(
    Array.from({ length: 32 }, (_, i) => i),
    8,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return value * 2;
    },
  );
  assert.equal(peak, 8);
  assert.deepEqual(result, Array.from({ length: 32 }, (_, i) => i * 2));
});

test('equal or invalid timestamps preserve v2.2.0 discovery order', async () => {
  const { root } = await fixture();
  const project = path.join(root, 'projects', '-tmp-demo');
  const z = path.join(project, 'z.jsonl');
  const a = path.join(project, 'a.jsonl');
  const invalid = path.join(project, 'invalid.jsonl');
  const invalid2 = path.join(project, 'invalid-2.jsonl');
  await writeFile(z, '{"timestamp":"2026-01-01T00:00:00.000Z"}\n');
  await writeFile(a, '{"timestamp":"2026-01-01T00:00:00.000Z"}\n');
  await writeFile(invalid, '{"timestamp":"not-a-date"}\n');
  await writeFile(invalid2, 'not-json\n');

  const make = async (file: string, discoveryIndex: number) => {
    const fileStat = await stat(file);
    return {
      path: file,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      discoveryIndex,
      dev: fileStat.dev > 0 && fileStat.ino > 0 ? fileStat.dev : undefined,
      ino: fileStat.dev > 0 && fileStat.ino > 0 ? fileStat.ino : undefined,
    };
  };

  const equal = await sortUsageFilesByEarliestTimestamp([
    await make(z, 0),
    await make(a, 1),
  ]);
  assert.deepEqual(equal.files, [z, a]);

  const invalidPair = await sortUsageFilesByEarliestTimestamp([
    await make(invalid, 0),
    await make(invalid2, 1),
  ]);
  assert.deepEqual(invalidPair.files, [invalid, invalid2]);
});

test('a single unprobeable file does not abort ordering the rest', async () => {
  const { root } = await fixture();
  const project = path.join(root, 'projects', '-tmp-demo');
  const good = path.join(project, 'good.jsonl');
  const journal = path.join(project, 'journal.jsonl');
  await writeFile(good, '{"timestamp":"2026-01-01T00:00:00.000Z"}\n');
  // A large workflow journal.jsonl: >1 MiB of records that never carry a
  // `timestamp`, which makes readEarliestTimestamp throw TimestampProbeLimitError.
  await writeFile(journal, '{"type":"result","key":"k","agentId":"a"}\n'.repeat(40_000));
  await assert.rejects(
    () => readEarliestTimestamp(journal),
    { name: 'TimestampProbeLimitError' },
  );

  const make = async (file: string, discoveryIndex: number) => {
    const fileStat = await stat(file);
    return {
      path: file,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      discoveryIndex,
      dev: fileStat.dev > 0 && fileStat.ino > 0 ? fileStat.dev : undefined,
      ino: fileStat.dev > 0 && fileStat.ino > 0 ? fileStat.ino : undefined,
    };
  };

  // Before the fix this rejected — one unprobeable file zeroed the whole load.
  // Now it resolves and keeps every file, the unprobeable one stamped 0 so it
  // sorts ahead of the real timestamp by discovery order.
  const sorted = await sortUsageFilesByEarliestTimestamp([
    await make(journal, 0),
    await make(good, 1),
  ]);
  assert.deepEqual(sorted.files, [journal, good]);
});
