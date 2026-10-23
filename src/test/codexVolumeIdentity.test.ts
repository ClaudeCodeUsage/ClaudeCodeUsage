import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  CODEX_VOLUME_IDENTITY_LIMITS,
  CodexVolumeIdentityDependencies,
  createCodexVolumeIdentityResolver,
  isCodexVolumeKey,
} from '../providers/codex/codexVolumeIdentity';

const ROOT = '/synthetic/codex/sessions';
const DEVICE = '/dev/disk3s5';
const UUID = '01234567-89AB-CDEF-0123-456789ABCDEF';
const SALT = 'synthetic-machine-salt';
const df = (device = DEVICE) => `Filesystem 512-blocks Used Available Capacity Mounted on\n${device} 100000 1000 99000 1% /Volumes/Private Disk\n`;
const plist = (value = UUID) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>VolumeName</key><string>Private Disk</string>
<key>VolumeUUID</key><string>${value}</string></dict></plist>`;

function harness(
  overrides: Partial<CodexVolumeIdentityDependencies> = {},
  dfOptions: { output?: string; elapsedMs?: number; error?: Error } = {},
) {
  let time = 1_000;
  let dev = 11;
  let ino = 22;
  let calls = 0;
  let dfCalls = 0;
  const commands: Array<{ file: string; args: readonly string[]; timeout: number }> = [];
  const diskutil: CodexVolumeIdentityDependencies['execFile'] = overrides.execFile ?? (async (file, args, options) => {
    calls++;
    assert.equal(file, '/usr/sbin/diskutil');
    assert.deepEqual(args, ['info', '-plist', DEVICE]);
    assert.deepEqual(options, {
      encoding: 'utf8', timeout: 3_000 - (dfOptions.elapsedMs ?? 0), maxBuffer: 64 * 1024, killSignal: 'SIGKILL',
    });
    return plist();
  });
  const dependencies: CodexVolumeIdentityDependencies = {
    platform: 'darwin',
    now: () => time,
    lstat: async () => ({ dev, ino, isDirectory: () => true, isSymbolicLink: () => false }),
    ...overrides,
    execFile: async (file, args, options) => {
      commands.push({ file, args: [...args], timeout: options.timeout });
      if (file !== '/bin/df') return diskutil(file, args, options);
      dfCalls++;
      assert.equal(args[0], '-P');
      assert.equal(args.length, 2);
      assert.equal(options.maxBuffer, 64 * 1024);
      assert.equal(options.encoding, 'utf8');
      assert.equal(options.killSignal, 'SIGKILL');
      time += dfOptions.elapsedMs ?? 0;
      if (dfOptions.error) throw dfOptions.error;
      return dfOptions.output ?? df();
    },
  };
  return {
    resolve: createCodexVolumeIdentityResolver(dependencies),
    calls: () => calls,
    dfCalls: () => dfCalls,
    commands: () => commands,
    advance: (ms: number) => { time += ms; },
    setStat: (nextDev: number, nextIno = ino) => { dev = nextDev; ino = nextIno; },
  };
}

test('volume inspection is bounded, exact-root-only and retains only a domain-separated HMAC', async () => {
  const h = harness();
  const result = await h.resolve(ROOT, SALT);
  const expected = createHmac('sha256', SALT).update('volume-v1\0').update(UUID.toLowerCase()).digest('hex');
  assert.deepEqual(result, { dev: 11, key: expected });
  assert.ok(isCodexVolumeKey(result?.key));
  assert.equal(JSON.stringify(result).includes(UUID), false);
  assert.doesNotMatch(JSON.stringify(result), /Private Disk|synthetic|VolumeUUID/);
  assert.notEqual(result?.key, createHmac('sha256', SALT).update(UUID.toLowerCase()).digest('hex'));
  assert.notEqual((await h.resolve(ROOT, 'another-salt'))?.key, result?.key);
  assert.equal(h.calls(), 2);
});

test('arbitrary descendant root resolves its device before diskutil instead of passing an unsupported path', async () => {
  const h = harness({ execFile: async (file, args) => {
    // Mirrors diskutil rejecting a directory below the mount point with exit 1.
    if (args[2] === ROOT) throw new Error('plistError: unsupported descendant');
    assert.equal(file, '/usr/sbin/diskutil');
    assert.deepEqual(args, ['info', '-plist', DEVICE]);
    return plist();
  } });
  assert.ok(await h.resolve(ROOT, SALT));
  assert.deepEqual(h.commands(), [
    { file: '/bin/df', args: ['-P', ROOT], timeout: 3_000 },
    { file: '/usr/sbin/diskutil', args: ['info', '-plist', DEVICE], timeout: 3_000 },
  ]);
});

test('device resolution rejects ambiguous, malformed, non-disk and oversized df output without diskutil', async () => {
  for (const output of [
    '', 'not df', DEVICE, 'Filesystem\n', df() + df(),
    df().replace('\n', '\n\n'),
    df('/dev/disk3s5/../../private'), df('/dev/disk3s5;echo'), df('/dev/rdisk3s5'),
    df('/dev/disk'), df('/dev/disk3s'), df('/dev/disk3s5junk'), df('/private/path'),
    df('--help'), df('server:/private'), df() + `${DEVICE} 1 1 1 1% /\n`,
    df() + ' '.repeat(64 * 1024),
    df().replace(DEVICE, `${DEVICE}\0`),
  ]) {
    let diskutilCalls = 0;
    const h = harness({ execFile: async () => { diskutilCalls++; return plist(); } }, { output });
    assert.equal(await h.resolve(ROOT, SALT), undefined);
    assert.equal(diskutilCalls, 0);
  }
  for (const device of ['/dev/disk0', '/dev/disk12s3', '/dev/disk12s3s4']) {
    const h = harness({ execFile: async (_file, args) => {
      assert.deepEqual(args, ['info', '-plist', device]);
      return plist();
    } }, { output: df(device) });
    assert.ok(await h.resolve(ROOT, SALT));
  }
});

test('both commands share one deadline and df failures never reach diskutil', async () => {
  const partial = harness({}, { elapsedMs: 1_250 });
  assert.ok(await partial.resolve(ROOT, SALT));
  assert.deepEqual(partial.commands().map(command => command.timeout), [3_000, 1_750]);
  for (const elapsedMs of [3_000, 3_001, 10_000]) {
    const expired = harness({}, { elapsedMs });
    assert.equal(await expired.resolve(ROOT, SALT), undefined);
    assert.equal(expired.commands().length, 1);
  }
  for (const code of ['ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ENOENT']) {
    const h = harness({}, { error: Object.assign(new Error('private df output'), { code }) });
    assert.equal(await h.resolve(ROOT, SALT), undefined);
    assert.equal(h.commands().length, 1);
    assert.equal(await h.resolve(ROOT, SALT), undefined);
    assert.equal(h.dfCalls(), 1);
  }
  let advance: (ms: number) => void;
  const expiredDiskutil = harness({ execFile: async () => { advance(3_000); return plist(); } });
  advance = expiredDiskutil.advance;
  assert.equal(await expiredDiskutil.resolve(ROOT, SALT), undefined);
});

test('volume UUID case normalizes but another UUID or salt produces another identity', async () => {
  const upper = harness();
  const lower = harness({ execFile: async () => plist(UUID.toLowerCase()) });
  const other = harness({ execFile: async () => plist('11111111-2222-3333-4444-555555555555') });
  assert.deepEqual(await upper.resolve(ROOT, SALT), await lower.resolve(ROOT, SALT));
  assert.notEqual((await upper.resolve(ROOT, SALT))?.key, (await other.resolve(ROOT, SALT))?.key);
});

test('non-darwin, relative paths, non-allowlisted roots and symlink roots never invoke diskutil', async () => {
  let calls = 0;
  const failExec = async () => { calls++; throw new Error('must not execute'); };
  for (const platform of ['linux', 'win32'] as const) {
    assert.equal(await harness({ platform, execFile: failExec }).resolve(ROOT, SALT), undefined);
  }
  for (const root of ['sessions', '/synthetic/codex', '/synthetic/codex/unknown', `${ROOT}/nested`]) {
    assert.equal(await harness({ execFile: failExec }).resolve(root, SALT), undefined);
  }
  for (const stat of [
    { dev: 1, ino: 2, isDirectory: () => true, isSymbolicLink: () => true },
    { dev: 1, ino: 2, isDirectory: () => false, isSymbolicLink: () => false },
    { dev: 0, ino: 2, isDirectory: () => true, isSymbolicLink: () => false },
  ]) {
    assert.equal(await harness({ lstat: async () => stat, execFile: failExec }).resolve(ROOT, SALT), undefined);
  }
  assert.equal(calls, 0);
});

test('malformed, duplicate, spoofed, missing and oversized UUID responses fall back without errors', async () => {
  const malformed = [
    '', 'not XML', plist('not-a-uuid'), plist(''), plist(`${UUID}x`),
    plist().replace('<key>VolumeUUID</key>', '<key>APFSContainerUUID</key>'),
    plist().replace('</dict>', `<key>VolumeUUID</key><string>${UUID}</string></dict>`),
    plist().replace('</dict>', '<key>VolumeUUID</key><integer>12</integer></dict>'),
    plist().replace('<string>' + UUID + '</string>', '<integer>12</integer>'),
    plist().replace('<key>VolumeUUID</key>', '<!-- <key>VolumeUUID</key> -->'),
    plist().replace('<key>VolumeUUID</key>', '<key>Note</key><dict><key>VolumeUUID</key>')
      .replace('</dict></plist>', '</dict></dict></plist>'),
    plist().replace('</plist>', ''),
    plist().replace('</plist>', '</plist><dict/>'),
    plist().replace('<dict>', '<!ENTITY bad "private"><dict>'),
    plist().replace(UUID, `<![CDATA[${UUID}]]>`),
    plist().replace(UUID, `&#48;${UUID.slice(1)}`),
    plist() + ' '.repeat(64 * 1024),
  ];
  for (const xml of malformed) {
    const h = harness({ execFile: async () => xml });
    assert.equal(await h.resolve(ROOT, SALT), undefined);
  }
  for (const code of ['ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ENOENT']) {
    const h = harness({ execFile: async () => { throw Object.assign(new Error('private output'), { code }); } });
    assert.equal(await h.resolve(ROOT, SALT), undefined);
  }
  assert.equal(await harness({ lstat: async () => { throw new Error('private path'); } }).resolve(ROOT, SALT), undefined);
});

test('valid nested unrelated fields are ignored and cannot supply a nested volume identity', async () => {
  const xml = plist().replace('<key>VolumeUUID</key>',
    '<key>Other</key><array><dict><key>Name</key><string>private</string></dict><true/><integer>1</integer></array><key>VolumeUUID</key>');
  assert.ok(await harness({ execFile: async () => xml }).resolve(ROOT, SALT));
});

test('cache reuses successes, coalesces pending calls, and changes with root, device, inode or salt', async () => {
  let calls = 0;
  const h = harness({ execFile: async () => { calls++; return plist(); } });
  const [a, b] = await Promise.all([h.resolve(ROOT, SALT), h.resolve(ROOT, SALT)]);
  assert.deepEqual(a, b);
  await h.resolve(ROOT, SALT);
  assert.equal(calls, 1);
  await h.resolve('/synthetic/codex/archived_sessions', SALT);
  assert.equal(calls, 2);
  h.setStat(12);
  assert.deepEqual(await h.resolve(ROOT, SALT), { dev: 12, key: a?.key });
  h.setStat(12, 23);
  await h.resolve(ROOT, SALT);
  await h.resolve(ROOT, 'new-salt');
  assert.equal(calls, 5);
  h.advance(CODEX_VOLUME_IDENTITY_LIMITS.cacheTtlMs + 1);
  await h.resolve(ROOT, 'new-salt');
  assert.equal(calls, 6);
});

test('cached result cannot be mutated and a replaced or symlinked root does not inherit it', async () => {
  const h = harness();
  const first = await h.resolve(ROOT, SALT);
  assert.ok(first);
  assert.throws(() => { (first as { key: string }).key = 'a'.repeat(64); }, TypeError);
  assert.deepEqual(await h.resolve(ROOT, SALT), first);
  let symbolic = false;
  const stat = { dev: 1, ino: 2, isDirectory: () => true, isSymbolicLink: () => symbolic };
  const changing = harness({ lstat: async () => stat });
  assert.ok(await changing.resolve(ROOT, SALT));
  symbolic = true;
  assert.equal(await changing.resolve(ROOT, SALT), undefined);
});

test('failures are cached briefly, retried after expiry and invalidated by device changes', async () => {
  let calls = 0;
  let failing = true;
  const h = harness({ execFile: async () => { calls++; if (failing) throw new Error('private'); return plist(); } });
  assert.equal(await h.resolve(ROOT, SALT), undefined);
  failing = false;
  assert.equal(await h.resolve(ROOT, SALT), undefined);
  assert.equal(calls, 1);
  h.advance(CODEX_VOLUME_IDENTITY_LIMITS.failureTtlMs + 1);
  assert.ok(await h.resolve(ROOT, SALT));
  assert.equal(calls, 2);
  h.setStat(12);
  assert.ok(await h.resolve(ROOT, SALT));
  assert.equal(calls, 3);
});

test('cache entry count is bounded and evicted roots are inspected again', async () => {
  let calls = 0;
  const h = harness({ execFile: async () => { calls++; return plist(); } });
  for (let i = 0; i <= CODEX_VOLUME_IDENTITY_LIMITS.maxCacheEntries; i++) {
    assert.ok(await h.resolve(`/synthetic/${i}/sessions`, SALT));
  }
  await h.resolve('/synthetic/0/sessions', SALT);
  assert.equal(calls, CODEX_VOLUME_IDENTITY_LIMITS.maxCacheEntries + 2);
});

test('root replacement during inspection discards even a valid UUID', async () => {
  let reads = 0;
  const h = harness({ lstat: async () => ({
    dev: reads++ === 0 ? 1 : 2, ino: 2, isDirectory: () => true, isSymbolicLink: () => false,
  }) });
  assert.equal(await h.resolve(ROOT, SALT), undefined);
});

test('volume key validator accepts only canonical SHA-256 HMAC hex', () => {
  assert.equal(isCodexVolumeKey('a'.repeat(64)), true);
  for (const invalid of [undefined, null, 123, '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(64)}\n`]) {
    assert.equal(isCodexVolumeKey(invalid), false);
  }
});
