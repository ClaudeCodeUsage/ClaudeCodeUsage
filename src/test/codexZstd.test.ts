import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as zlib from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  inspectCodexZstdHeader, supportsCodexZstd, readCodexZstdRange,
  CodexZstdError, CodexZstdReadOptions,
} from '../providers/codex/codexZstd';

const hex = (value: string) => Buffer.from(value, 'hex');
const code = (expected: string) => (error: unknown) =>
  error instanceof CodexZstdError && error.code === expected;

test('RFC header: four-byte FCS has no 256 bias; single segment implies window size', () => {
  assert.deepEqual(inspectCodexZstdHeader(hex('28b52ffda0747305006415035ad0a3c95b90')), {
    decodedSize: 357236, windowSize: 357236, hasChecksum: false,
    singleSegment: true, headerSize: 9,
  });
});

test('RFC header: one/two/eight byte FCS, explicit window, checksum and real empty size', () => {
  assert.equal(inspectCodexZstdHeader(hex('28b52ffd2000')).decodedSize, 0);
  assert.equal(inspectCodexZstdHeader(hex('28b52ffd20ff')).decodedSize, 255);
  assert.equal(inspectCodexZstdHeader(hex('28b52ffd600000')).decodedSize, 256);
  assert.equal(inspectCodexZstdHeader(hex('28b52ffd60ffff')).decodedSize, 65791);
  assert.equal(inspectCodexZstdHeader(hex('28b52ffde0ffffffffffff1f00')).decodedSize, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(inspectCodexZstdHeader(hex('28b52ffd840b12000000')), {
    decodedSize: 18, windowSize: 2816, hasChecksum: true, singleSegment: false, headerSize: 10,
  });
  // RFC unused bit is ignored by decoders; reserved bit is not.
  assert.equal(inspectCodexZstdHeader(hex('28b52ffd3001')).decodedSize, 1);
});

test('header rejects unknown FCS, dictionaries, reserved bit, unsafe size and bad/truncated input', () => {
  for (const [bytes, expected] of [
    ['28b52ffd0000', 'unknown-size'], ['28b52ffd210001', 'dictionary'],
    ['28b52ffd2801', 'reserved'], ['28b52ffde00000000000002000', 'size-limit'],
    ['502a4d1800000000', 'malformed'], ['000000002001', 'malformed'],
  ]) assert.throws(() => inspectCodexZstdHeader(hex(bytes)), code(expected));
  const header = hex('28b52ffda074730500');
  for (let length = 0; length < header.length; length++) {
    assert.throws(() => inspectCodexZstdHeader(header.subarray(0, length)), code('malformed'));
  }
});

test('header inspection does not pretend to establish a single frame', () => {
  assert.equal(inspectCodexZstdHeader(hex('28b52ffd200001000028b52ffd2000010000')).decodedSize, 0);
});

test('missing native codec permits module load and returns a typed error before opening a file', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    Object.defineProperty(require('node:zlib'), 'createZstdDecompress', { value: undefined });
    const codec = require(${JSON.stringify(require.resolve('../providers/codex/codexZstd'))});
    assert.equal(codec.supportsCodexZstd(), false);
    codec.readCodexZstdRange('/must-not-open', 0, 0, 0).next().then(
      () => { throw new Error('expected unsupported runtime'); },
      e => assert.equal(e.code, 'codec-unavailable')
    ).catch(e => { console.error(e); process.exitCode = 1; });
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('native capability matches the current runtime (including actual Node 20)', async () => {
  assert.equal(supportsCodexZstd(), typeof zlib.createZstdDecompress === 'function');
  if (!supportsCodexZstd()) {
    await assert.rejects(readCodexZstdRange('/must-not-open', 0, 0, 0).next(), code('codec-unavailable'));
  }
});

function compressed(body: Buffer, checksum = true): Buffer {
  // Installed @types/node predates this documented runtime option.
  const options: zlib.ZstdOptions & { pledgedSrcSize: number } = {
    pledgedSrcSize: body.length,
    params: { [zlib.constants.ZSTD_c_checksumFlag]: checksum ? 1 : 0 },
  };
  return zlib.zstdCompressSync(body, options);
}

async function fixture(bytes: Buffer, run: (path: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'codex-zstd-test-'));
  const path = join(directory, 'anonymous.jsonl.zst');
  try {
    await fs.writeFile(path, bytes);
    await run(path);
    assert.deepEqual(await fs.readFile(path), bytes, 'source must remain unchanged');
    assert.deepEqual(await fs.readdir(directory), ['anonymous.jsonl.zst'], 'no decoded file/cache');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function read(path: string, start: number, end: number, size: number, options?: CodexZstdReadOptions) {
  const chunks: Buffer[] = [];
  for await (const chunk of readCodexZstdRange(path, start, end, size, options)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const native = { skip: typeof zlib.createZstdDecompress !== 'function', timeout: 10000 };
test('stream ranges use decoded byte offsets; chunks bounded; resume replays prefix', native, async () => {
  const body = Buffer.from('{"anonymous":"你好"}\n'.repeat(20000));
  await fixture(compressed(body), async path => {
    assert.deepEqual(await read(path, 0, body.length, body.length, { chunkBytes: 1024 }), body);
    assert.deepEqual(await read(path, 17, 8971, body.length, { chunkBytes: 64 }), body.subarray(17, 8971));
    assert.deepEqual(await read(path, 8971, body.length, body.length), body.subarray(8971));
    for await (const chunk of readCodexZstdRange(path, 0, body.length, body.length, { chunkBytes: 64 })) {
      assert.ok(chunk.length > 0 && chunk.length <= 64);
    }
    assert.equal((await read(path, 5, 5, body.length)).length, 0);
    assert.equal((await read(path, body.length, body.length, body.length)).length, 0);
  });
});

test('empty frame is validated, including trailing frames with zero output', native, async () => {
  const empty = compressed(Buffer.alloc(0));
  await fixture(empty, async path => assert.equal((await read(path, 0, 0, 0)).length, 0));
  for (const tail of [empty, Buffer.from([0]), hex('502a4d1800000000')]) {
    await fixture(Buffer.concat([empty, tail]), async path => {
      await assert.rejects(read(path, 0, 0, 0), code('trailing-data'));
    });
  }
});

test('full range rejects truncation, checksum damage, concatenation and size mismatch', native, async () => {
  const body = Buffer.from('anonymous\n'.repeat(30000));
  const frame = compressed(body);
  const damaged = Buffer.from(frame);
  damaged[damaged.length - 1] ^= 0xff;
  for (const invalid of [frame.subarray(0, frame.length - 1), frame.subarray(0, frame.length - 4), damaged,
    Buffer.concat([frame, compressed(Buffer.from('extra'))]),
    Buffer.concat([frame, compressed(Buffer.alloc(0))]), Buffer.concat([frame, Buffer.from([0])])]) {
    await fixture(invalid, async path => {
      await assert.rejects(read(path, 0, body.length, body.length));
    });
  }
  await fixture(frame, async path => {
    await assert.rejects(read(path, 0, body.length - 1, body.length - 1), code('size-mismatch'));
    await assert.rejects(read(path, 0, body.length + 1, body.length + 1), code('size-mismatch'));
  });
  await fixture(damaged, async path => {
    // Default native checksum validation must remain enabled, with a complete trailer.
    await assert.rejects(read(path, 0, body.length, body.length, { chunkBytes: 1024 }), code('decode-failed'));
  });
  // A lying FCS still has valid framing but must not become a successful EOF.
  const falseSize = Buffer.from(frame);
  assert.equal(falseSize[4] >>> 6, 2);
  falseSize.writeUInt32LE(body.length + 1, 5);
  await fixture(falseSize, async path => {
    await assert.rejects(read(path, 0, body.length + 1, body.length + 1));
  });
});

test('limits reject unsafe allocation, excessive replay and invalid ranges/options', native, async () => {
  const body = Buffer.alloc(10000, 97);
  await fixture(compressed(body), async path => {
    for (const options of [{ maxDecodedBytes: 9999 }, { maxWindowBytes: 9999 }, { maxCompressedBytes: 1 }]) {
      await assert.rejects(read(path, 0, 10000, 10000, options), code('size-limit'));
    }
    await assert.rejects(read(path, 200, 300, 10000, { maxReplayBytes: 199 }), code('replay-limit'));
    for (const [start, end, size] of [[-1, 2, 10000], [3, 2, 10000], [0, 10001, 10000], [0, 1, NaN], [0.5, 2, 10000]]) {
      await assert.rejects(read(path, start, end, size), code('invalid-range'));
    }
    for (const options of [{ chunkBytes: 0 }, { chunkBytes: Infinity }, { chunkBytes: 2 ** 30 }, { maxWindowBytes: Infinity }]) {
      await assert.rejects(read(path, 0, 1, 10000, options), code('invalid-options'));
    }
  });
});

test('AbortSignal and consumer return close native streams and file handles', native, async t => {
  const handles: fs.FileHandle[] = [];
  const decoders: zlib.ZstdDecompress[] = [];
  const originalOpen = fs.open;
  const originalDecoder = zlib.createZstdDecompress;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    handles.push(handle);
    return handle;
  });
  t.mock.method(zlib, 'createZstdDecompress', (...args: Parameters<typeof zlib.createZstdDecompress>) => {
    const decoder = originalDecoder(...args);
    decoders.push(decoder);
    return decoder;
  });
  const body = Buffer.from('anonymous\n'.repeat(50000));
  await fixture(compressed(body), async path => {
    const controller = new AbortController();
    const iterator = readCodexZstdRange(path, 0, body.length, body.length, { signal: controller.signal, chunkBytes: 64 });
    assert.equal((await iterator.next()).done, false);
    controller.abort();
    await assert.rejects(iterator.next(), code('aborted'));
    await assert.rejects(read(path, 0, body.length, body.length, { signal: controller.signal }), code('aborted'));
    for (let i = 0; i < 12; i++) {
      const partial = readCodexZstdRange(path, 0, body.length, body.length, { chunkBytes: 64 });
      assert.equal((await partial.next()).done, false);
      await partial.return(undefined);
      assert.deepEqual(await read(path, 0, 7, body.length), body.subarray(0, 7));
    }
  });
  assert.ok(handles.length > 0 && handles.every(handle => handle.fd === -1), 'all handles closed');
  assert.ok(decoders.length > 0 && decoders.every(decoder => decoder.destroyed && decoder.closed), 'all native streams closed');
});

test('large real-world sized headers remain inspectable, but range limits reject before decoding', native, async () => {
  const large = hex('28b52ffd805800000000'); // 2 MiB window, 4-byte FCS.
  large.writeUInt32LE(1153532159, 6);
  assert.equal(inspectCodexZstdHeader(large).decodedSize, 1153532159);
  await fixture(large, async path => {
    // It must reach frame parsing instead of rejecting the former 512 MiB cap.
    await assert.rejects(read(path, 0, 1, 1153532159), code('truncated'));
    await assert.rejects(read(path, 1153532158, 1153532159, 1153532159), code('truncated'));
  });
  const oversized = hex('28b52ffdc0580100000001000000'); // 4 GiB + 1, small window.
  const size = inspectCodexZstdHeader(oversized).decodedSize;
  assert.equal(size, 2 ** 32 + 1);
  await fixture(oversized, async path => {
    await assert.rejects(read(path, 0, 1, size), code('size-limit'));
  });
});

test('raw/RLE blocks and all structural truncation points are handled without relying on native EOF', native, async () => {
  // Anonymous RFC frames: raw last block of abc; RLE last block repeating x 3 times.
  const raw = hex('28b52ffd2003190000616263');
  const rle = hex('28b52ffd20031b000078');
  for (const [frame, expected] of [[raw, 'abc'], [rle, 'xxx']] as const) {
    await fixture(frame, async path => assert.equal((await read(path, 0, 3, 3)).toString(), expected));
    for (let end = 6; end < frame.length; end++) {
      await fixture(frame.subarray(0, end), async path => {
        await assert.rejects(read(path, 0, 3, 3), code('truncated'));
      });
    }
  }
  for (const bad of ['28b52ffd20031f000078', '28b52ffd200321000061626364']) {
    await fixture(hex(bad), async path => assert.rejects(read(path, 0, 3, 3), code('malformed')));
  }
});

test('source identity is checked before and after reads and symlinks are rejected', native, async () => {
  const body = Buffer.from('anonymous\n'.repeat(50000));
  await fixture(compressed(body), async path => {
    const expectedSource = await fs.stat(path);
    assert.deepEqual(await read(path, 0, body.length, body.length, { expectedSource }), body);
    for (const key of ['size', 'mtimeMs', 'ctimeMs', 'dev', 'ino'] as const) {
      await assert.rejects(read(path, 0, 1, body.length, {
        expectedSource: { ...expectedSource, [key]: expectedSource[key] + 1 },
      }), code('source-changed'));
    }
    const iterator = readCodexZstdRange(path, 0, body.length, body.length, { chunkBytes: 64, expectedSource });
    assert.equal((await iterator.next()).done, false);
    await fs.utimes(path, expectedSource.atime, new Date(expectedSource.mtimeMs + 10000));
    await assert.rejects(async () => { for await (const _ of iterator) { /* consume */ } }, code('source-changed'));
    const link = `${path}.link`;
    await fs.symlink(path, link);
    try {
      await assert.rejects(read(link, 0, body.length, body.length), code('source-changed'));
    } finally { await fs.unlink(link); }
  });
});

test('replay progress awaits bounded prefix deltas, including a partial boundary chunk', native, async () => {
  const body = Buffer.from('anonymous\n'.repeat(30000));
  await fixture(compressed(body), async path => {
    const deltas: number[] = [];
    let busy = false;
    const output = await read(path, 200019, 210123, body.length, {
      chunkBytes: 1024,
      onReplayProgress: async bytes => {
        assert.equal(busy, false);
        busy = true;
        assert.ok(bytes > 0 && bytes <= 1024);
        await new Promise<void>(resolve => setImmediate(resolve));
        deltas.push(bytes);
        busy = false;
      },
    });
    assert.equal(deltas.reduce((sum, value) => sum + value, 0), 200019);
    assert.deepEqual(output, body.subarray(200019, 210123));
    assert.equal(busy, false);
    await read(path, 0, 10, body.length, { onReplayProgress: async () => assert.fail('no prefix') });
    const cancelled = new Error('caller-cancelled');
    let callbacks = 0;
    await assert.rejects(read(path, 200019, 210123, body.length, {
      chunkBytes: 1024,
      onReplayProgress: async () => { callbacks++; throw cancelled; },
    }), error => error === cancelled);
    assert.equal(callbacks, 1);
  });
});
