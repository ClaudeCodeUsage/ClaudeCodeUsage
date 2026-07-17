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
