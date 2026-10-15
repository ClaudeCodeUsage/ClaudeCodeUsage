import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHmac } from 'node:crypto';

import {
  CodexPersistedManifest,
  diffCodexManifest,
  pseudonymousFileKey,
  resolveCodexHome,
  scanCodexManifest,
} from '../providers/codex/codexManifest';

test('Codex discovery reads only allowlisted JSONL roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  try {
    await mkdir(path.join(root, 'sessions', '2026', '07'), { recursive: true });
    await mkdir(path.join(root, 'archived_sessions'), { recursive: true });
    await mkdir(path.join(root, 'unknown'), { recursive: true });
    await writeFile(
      path.join(root, 'sessions', '2026', '07', 'rollout-live.jsonl'),
      '{}\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'archived_sessions', 'rollout-archive.jsonl'),
      '{}\n',
      'utf8',
    );
    await writeFile(path.join(root, 'auth.json'), '{"secret":true}', 'utf8');
    await writeFile(path.join(root, 'state.sqlite'), 'private', 'utf8');
    await writeFile(path.join(root, 'unknown', 'rollout-hidden.jsonl'), '{}\n', 'utf8');
    await symlink(
      path.join(root, 'unknown'),
      path.join(root, 'sessions', 'linked-unknown'),
    );

    const manifest = await scanCodexManifest(root, 'machine-salt');

    assert.deepEqual(
      manifest.files.map((file) => file.sourceArea).sort(),
      ['archive', 'sessions'],
    );
    assert.equal(manifest.files.every((file) => path.isAbsolute(file.absolutePath)), true);
    assert.doesNotMatch(
      JSON.stringify(manifest.persistable),
      /auth\.json|state\.sqlite|rollout-|unknown|\.jsonl/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex home resolution and pseudonyms are deterministic', () => {
  assert.equal(
    resolveCodexHome('/custom/codex', { CODEX_HOME: '/env/codex' }, '/home/user'),
    path.resolve('/custom/codex'),
  );
  assert.equal(
    resolveCodexHome('', { CODEX_HOME: '/env/codex' }, '/home/user'),
    path.resolve('/env/codex'),
  );
  assert.equal(
    resolveCodexHome('', {}, '/home/user'),
    path.join('/home/user', '.codex'),
  );

  const first = pseudonymousFileKey('salt', '/private/a.jsonl');
  assert.equal(first, pseudonymousFileKey('salt', '/private/a.jsonl'));
  assert.notEqual(first, pseudonymousFileKey('salt', '/private/b.jsonl'));
  assert.doesNotMatch(first, /private|jsonl/);
});

test('manifest diff separates append, truncate, replace, archive move, and delete', () => {
  const previous: CodexPersistedManifest = {
    unchanged: { fileKey: 'unchanged', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 1 },
    append: { fileKey: 'append', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 2 },
    truncate: { fileKey: 'truncate', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 3 },
    replace: { fileKey: 'replace', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 4 },
    moveOld: { fileKey: 'moveOld', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 5 },
    deleted: { fileKey: 'deleted', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 6 },
  };
  const current: CodexPersistedManifest = {
    unchanged: { ...previous.unchanged },
    append: { ...previous.append, size: 20, mtimeMs: 2 },
    truncate: { ...previous.truncate, size: 5, mtimeMs: 2 },
    replace: { ...previous.replace, mtimeMs: 2, ino: 40 },
    moveNew: { fileKey: 'moveNew', sourceArea: 'archive', size: 10, mtimeMs: 2, dev: 1, ino: 5 },
    added: { fileKey: 'added', sourceArea: 'sessions', size: 3, mtimeMs: 2, dev: 1, ino: 7 },
  };

  assert.deepEqual(diffCodexManifest(previous, current), {
    unchanged: ['unchanged'],
    appended: ['append'],
    truncated: ['truncate'],
    replaced: ['replace'],
    moved: [{ fromKey: 'moveOld', toKey: 'moveNew' }],
    added: ['added'],
    removed: ['deleted'],
  });
});

// A valid single-segment frame containing one final raw block; no native encoder.
function rawZstd(payload = Buffer.from('{}\n')): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0xfd2fb528, 0);
  header[4] = 0xa0;
  header.writeUInt32LE(payload.length, 5);
  header.writeUIntLE((payload.length << 3) | 1, 9, 3);
  return Buffer.concat([header, payload]);
}

test('compressed pseudonyms normalize only the final .jsonl.zst suffix', () => {
  const plain = '/anonymous/sessions/a.jsonl';
  assert.equal(pseudonymousFileKey('salt', plain), createHmac('sha256', 'salt').update(plain).digest('hex'));
  assert.equal(pseudonymousFileKey('salt', `${plain}.zst`), pseudonymousFileKey('salt', plain));
  assert.notEqual(pseudonymousFileKey('salt', '/anonymous/a.zst'), pseudonymousFileKey('salt', '/anonymous/a'));
});

test('compressed discovery keeps logical length and physical fingerprints in both roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  try {
    for (const area of ['sessions', 'archived_sessions']) {
      const directory = path.join(root, area, 'nested');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'plain.jsonl'), '{}\n');
      await writeFile(path.join(directory, 'packed.jsonl.zst'), rawZstd());
    }
    const manifest = await scanCodexManifest(root, 'salt');
    assert.equal(manifest.files.length, 4);
    for (const file of manifest.files) {
      const physical = await fs.lstat(file.absolutePath);
      assert.equal(file.size, 3);
      assert.equal(file.mtimeMs, physical.mtimeMs);
      assert.equal(file.dev, physical.dev);
      assert.equal(file.ino, physical.ino);
      if (file.absolutePath.endsWith('.zst')) {
        assert.equal(file.compression, 'zstd');
        assert.equal(file.storageSize, 15);
        assert.equal(file.storageCtimeMs, physical.ctimeMs);
        assert.equal(manifest.persistable[file.fileKey].compression, 'zstd');
        assert.equal(manifest.persistable[file.fileKey].storageSize, 15);
        assert.equal(manifest.persistable[file.fileKey].storageCtimeMs, physical.ctimeMs);
      } else {
        for (const field of ['compression', 'storageSize', 'storageCtimeMs']) {
          assert.equal(Object.prototype.hasOwnProperty.call(file, field), false);
          assert.equal(Object.prototype.hasOwnProperty.call(manifest.persistable[file.fileKey], field), false);
        }
      }
    }
    assert.doesNotMatch(JSON.stringify(manifest.persistable), /anonymous|packed|plain|absolutePath|\.jsonl/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plain canonical source wins in either enumeration order without reading the losing compressed header', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  const originalReaddir = fs.readdir;
  let reverse = false;
  t.mock.method(fs, 'readdir', async (...args: Parameters<typeof fs.readdir>) => {
    const entries = await originalReaddir(...args);
    return reverse ? entries.reverse() : entries;
  });
  const openSpy = t.mock.method(fs, 'open');
  try {
    const directory = path.join(root, 'sessions');
    await mkdir(directory);
    const plain = path.join(directory, 'same.jsonl');
    await writeFile(plain, '{}\n');
    // Canonical selection does not assert the two representations have equal data.
    await writeFile(`${plain}.zst`, 'invalid compressed representation');
    for (reverse of [false, true]) {
      const manifest = await scanCodexManifest(root, 'salt');
      assert.deepEqual(manifest.files.map(file => file.absolutePath), [plain]);
      assert.equal(manifest.files[0].size, 3);
      assert.equal(openSpy.mock.callCount(), 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical compressed/plain transitions replace the same key in both directions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    const plain = path.join(root, 'sessions', 'same.jsonl');
    await writeFile(`${plain}.zst`, rawZstd());
    const compressed = await scanCodexManifest(root, 'salt');
    await writeFile(plain, '{}\n');
    const expanded = await scanCodexManifest(root, 'salt');
    const key = pseudonymousFileKey('salt', plain);
    assert.equal(compressed.files[0]?.fileKey, key);
    for (const [before, after] of [[compressed, expanded], [expanded, compressed]]) {
      assert.deepEqual(diffCodexManifest(before.persistable, after.persistable), {
        unchanged: [], appended: [], truncated: [], replaced: [key], moved: [], added: [], removed: [],
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compressed encoding, physical size and ctime changes always replace before logical comparisons', () => {
  const packed = { fileKey: 'key', sourceArea: 'sessions' as const, size: 10, mtimeMs: 1, dev: 1, ino: 2,
    compression: 'zstd' as const, storageSize: 22, storageCtimeMs: 1 };
  const plain = { fileKey: 'key', sourceArea: 'sessions' as const, size: 10, mtimeMs: 1, dev: 1, ino: 2 };
  const changes = [
    { ...packed, storageSize: 23 },
    { ...packed, storageCtimeMs: 2 },
    { ...packed, mtimeMs: 2 },
    { ...packed, size: 20 },
    { ...packed, size: 5 },
    plain,
  ];
  for (const changed of changes) {
    for (const [before, after] of [[packed, changed], [changed, packed]]) {
      assert.deepEqual(diffCodexManifest({ key: before }, { key: after }), {
        unchanged: [], appended: [], truncated: [], replaced: ['key'], moved: [], added: [], removed: [],
      });
    }
  }
  assert.deepEqual(diffCodexManifest({ key: packed }, { key: { ...packed } }).unchanged, ['key']);
});

test('a compressed archive move retains inode-based move detection', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    await mkdir(path.join(root, 'archived_sessions'));
    const source = path.join(root, 'sessions', 'move.jsonl.zst');
    const target = path.join(root, 'archived_sessions', 'move.jsonl.zst');
    await writeFile(source, rawZstd());
    const before = await scanCodexManifest(root, 'salt');
    await fs.rename(source, target);
    const after = await scanCodexManifest(root, 'salt');
    assert.equal(after.files[0]?.sourceArea, 'archive');
    const diff = diffCodexManifest(before.persistable, after.persistable);
    assert.deepEqual(diff.moved, [{
      fromKey: pseudonymousFileKey('salt', source), toKey: pseudonymousFileKey('salt', target),
    }]);
    assert.deepEqual(diff.replaced, before.files[0].storageCtimeMs === after.files[0].storageCtimeMs
      ? [] : [pseudonymousFileKey('salt', target)]);
    assert.deepEqual(diff.appended, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compressed moves with changed physical versions explicitly replace the destination', () => {
  const before = { fileKey: 'old', sourceArea: 'sessions' as const, size: 10, mtimeMs: 1, dev: 1, ino: 2,
    compression: 'zstd' as const, storageSize: 22, storageCtimeMs: 1 };
  const moved = { ...before, fileKey: 'new', sourceArea: 'archive' as const };
  for (const after of [
    { ...moved, storageSize: 23 },
    { ...moved, storageCtimeMs: 2 },
    { ...moved, compression: undefined, storageSize: undefined, storageCtimeMs: undefined },
  ]) {
    assert.deepEqual(diffCodexManifest({ old: before }, { new: after }), {
      unchanged: [], appended: [], truncated: [], replaced: ['new'],
      moved: [{ fromKey: 'old', toKey: 'new' }], added: [], removed: [],
    });
  }
  assert.deepEqual(diffCodexManifest({ old: before }, { new: moved }).replaced, []);
});

test('same-inode same-size compressed overwrite with restored mtime invalidates via ctime', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    const target = path.join(root, 'sessions', 'overwritten.jsonl.zst');
    await writeFile(target, rawZstd(Buffer.from('1\n')));
    const fixedTime = new Date('2026-01-01T00:00:00.000Z');
    await fs.utimes(target, fixedTime, fixedTime);
    const before = await scanCodexManifest(root, 'salt');
    await writeFile(target, rawZstd(Buffer.from('2\n')));
    await fs.utimes(target, fixedTime, fixedTime);
    const after = await scanCodexManifest(root, 'salt');
    assert.equal(after.files[0].ino, before.files[0].ino);
    assert.equal(after.files[0].size, before.files[0].size);
    assert.equal(after.files[0].storageSize, before.files[0].storageSize);
    assert.equal(after.files[0].mtimeMs, before.files[0].mtimeMs);
    assert.notEqual(after.files[0].storageCtimeMs, before.files[0].storageCtimeMs);
    const diff = diffCodexManifest(before.persistable, after.persistable);
    assert.deepEqual(diff.replaced, [before.files[0].fileKey]);
    assert.deepEqual(diff.appended, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compressed discovery rejects symlinks and nonregular candidates and ignores unknown files/roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    await mkdir(path.join(root, 'unknown'));
    await mkdir(path.join(root, 'sessions', 'directory.jsonl.zst'));
    await writeFile(path.join(root, 'unknown', 'private.jsonl.zst'), 'invalid');
    for (const name of ['unknown.zst', 'extra.jsonl.zst.bak', 'upper.JSONL.ZST', 'auth.json']) {
      await writeFile(path.join(root, 'sessions', name), 'invalid');
    }
    await symlink(path.join(root, 'unknown'), path.join(root, 'archived_sessions'));
    await symlink(path.join(root, 'unknown'), path.join(root, 'sessions', 'linked'));
    await symlink(path.join(root, 'unknown', 'private.jsonl.zst'), path.join(root, 'sessions', 'linked.jsonl.zst'));
    await symlink(path.join(root, 'unknown', 'private.jsonl.zst'), path.join(root, 'sessions', 'valid.jsonl'));
    await writeFile(path.join(root, 'sessions', 'valid.jsonl.zst'), rawZstd());
    const manifest = await scanCodexManifest(root, 'salt');
    assert.deepEqual(manifest.files.map(file => path.basename(file.absolutePath)), ['valid.jsonl.zst']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid, unknown-size, dictionary and future headers fail the whole scan with a path-free error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    await writeFile(path.join(root, 'sessions', 'good.jsonl'), '{}\n');
    const previous = await scanCodexManifest(root, 'salt');
    const invalidHeaders = [
      Buffer.from('private invalid bytes'),
      rawZstd().subarray(0, 7),
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00]),
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa1, 0x01, 0x03, 0, 0, 0]),
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa8, 0x03, 0, 0, 0]),
      Buffer.from([0x29, 0xb5, 0x2f, 0xfd, 0xa0, 0x03, 0, 0, 0]),
    ];
    for (const header of invalidHeaders) {
      await writeFile(path.join(root, 'sessions', 'private.jsonl.zst'), header);
      let retained = previous;
      await assert.rejects(async () => { retained = await scanCodexManifest(root, 'salt'); }, (error: Error) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes(root));
        assert.doesNotMatch(error.message, /private|\.jsonl|sessions/);
        return true;
      });
      assert.equal(retained, previous);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('discovery opens compressed files read-only and reads at most 18 bytes without decoding bodies', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  const originalOpen = fs.open;
  let readSpy: ReturnType<typeof t.mock.method> | undefined;
  let closed = false;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    const close = handle.close.bind(handle);
    readSpy = t.mock.method(handle, 'read');
    t.mock.method(handle, 'close', async () => { closed = true; await close(); });
    return handle;
  });
  try {
    await mkdir(path.join(root, 'sessions'));
    const target = path.join(root, 'sessions', 'large.jsonl.zst');
    const fixture = rawZstd(Buffer.alloc(4096, 0x20));
    await writeFile(target, fixture);
    const before = await fs.stat(target);
    const manifest = await scanCodexManifest(root, 'salt');
    assert.equal(manifest.files[0]?.size, 4096);
    assert.ok(readSpy);
    assert.equal(readSpy.mock.callCount(), 1);
    const args = readSpy.mock.calls[0].arguments;
    assert.ok(Buffer.isBuffer(args[0]));
    assert.equal(args[0].length, 18);
    assert.equal(args[1], 0);
    assert.equal(args[2], 18);
    assert.equal(args[3], 0);
    assert.equal(closed, true);
    assert.deepEqual(await fs.readFile(target), fixture);
    const after = await fs.stat(target);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.ctimeMs, before.ctimeMs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('open/fstat identity or size races reject safely before reading and always close the handle', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  const originalOpen = fs.open;
  let changed: 'ino' | 'dev' | 'size' = 'ino';
  let closed = 0;
  let reads = 0;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    const stat = handle.stat.bind(handle);
    const read = handle.read.bind(handle);
    const close = handle.close.bind(handle);
    t.mock.method(handle, 'stat', async () => {
      const actual = await stat();
      return Object.assign(actual, { [changed]: Number(actual[changed]) + 1 });
    });
    t.mock.method(handle, 'read', (...readArgs: Parameters<typeof read>) => { reads++; return read(...readArgs); });
    t.mock.method(handle, 'close', async () => { closed++; await close(); });
    return handle;
  });
  try {
    await mkdir(path.join(root, 'sessions'));
    await writeFile(path.join(root, 'sessions', 'race.jsonl.zst'), rawZstd());
    for (changed of ['ino', 'dev', 'size'] as const) {
      await assert.rejects(scanCodexManifest(root, 'salt'), (error: Error) => {
        assert.ok(!error.message.includes(root));
        assert.doesNotMatch(error.message, /race|\.jsonl/);
        return true;
      });
    }
    assert.equal(reads, 0);
    assert.equal(closed, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
