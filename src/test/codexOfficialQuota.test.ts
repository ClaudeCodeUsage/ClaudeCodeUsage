import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, createHmac } from 'node:crypto';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';

const load = (): typeof import('../providers/codex/codexOfficialQuota') =>
  require('../providers/codex/codexOfficialQuota');
const SALT = 'official-quota-fixture-salt-0123456789abcdef';
const NOW = 1_800_000_000_000;
const context = { source: '/fixture/codex-home', machineSalt: SALT, requestedAt: NOW, observedAt: NOW + 10 };
const weekly = (usedPercent = 40) => ({ usedPercent, windowDurationMins: 10080, resetsAt: NOW / 1000 + 3600 });
const snapshot = () => ({ limitId: 'codex', primary: weekly(), secondary: null });
const reply = () => ({ accountId: 'fixture-account', rateLimits: snapshot() });

function serverFrame(payload: Buffer | string): Buffer {
  const bytes = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const header = Buffer.alloc(bytes.length < 126 ? 2 : bytes.length < 65536 ? 4 : 10);
  header[0] = 0x81;
  if (header.length === 2) header[1] = bytes.length;
  else if (header.length === 4) { header[1] = 126; header.writeUInt16BE(bytes.length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(bytes.length), 2); }
  return Buffer.concat([header, bytes]);
}

class ProxyStub extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Array<{ id?: number; method: string; params?: unknown }> = [];
  readonly kills: unknown[] = [];
  readonly pid = 12345;
  wireBytes = 0;
  handshake = '';
  upgradeTransform?: (response: Buffer) => Buffer;
  private closed = false;
  readonly stdin: Writable;
  constructor(onRequest?: (request: ProxyStub['requests'][number], child: ProxyStub) => void) {
    super();
    this.stdout.on('data', (bytes: Buffer) => { this.wireBytes += bytes.length; });
    this.stderr.on('data', (bytes: Buffer) => { this.wireBytes += bytes.length; });
    this.stdin = new Writable({ write: (chunk, _encoding, done) => {
      if (!this.handshake) {
        this.handshake = chunk.toString();
        const key = /Sec-WebSocket-Key: ([^\r]+)\r\n/.exec(this.handshake)![1];
        const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        done();
        const response = Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' +
          'Connection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
        queueMicrotask(() => this.stdout.write(this.upgradeTransform?.(response) ?? response));
        return;
      }
      assert.equal(chunk[0], 0x81, 'every RPC is a final text frame');
      assert.ok(chunk[1] & 128, 'client frames must be masked');
      const marker = chunk[1] & 127, offset = marker < 126 ? 2 : marker === 126 ? 4 : 10;
      const payload = Buffer.from(chunk.subarray(offset + 4));
      for (let i = 0; i < payload.length; i++) payload[i] ^= chunk[offset + i % 4];
      assert.notEqual(payload[payload.length - 1], 10, 'RPC has no NDJSON newline');
      const request = JSON.parse(payload.toString());
      this.requests.push(request);
      done();
      // Child replies arrive asynchronously, after the client's write returns.
      queueMicrotask(() => onRequest?.(request, this));
    } });
  }
  send(value: unknown): void { this.stdout.write(serverFrame(JSON.stringify(value))); }
  kill(signal: unknown): boolean {
    this.kills.push(signal);
    if (!this.closed) {
      this.closed = true;
      queueMicrotask(() => {
        this.stdout.end(); this.stderr.end(); this.emit('close', null, signal);
      });
    }
    return true;
  }
}

function fixture(onQuota?: (child: ProxyStub) => void) {
  const calls: Array<{ binary: string; args: string[]; options: SpawnOptionsWithoutStdio }> = [];
  const child = new ProxyStub((request, proxy) => {
    if (request.method === 'initialize') proxy.send({ id: request.id, result: {} });
    if (request.method === 'account/rateLimits/read') {
      if (onQuota) onQuota(proxy); else proxy.send({ id: request.id, result: reply() });
    }
  });
  const spawn = (binary: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams => {
    calls.push({ binary, args, options });
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  return { child, calls, options: {
    binary: '/fixture/codex', source: context.source, machineSalt: SALT,
    now: () => NOW, dependencies: { spawn },
  } };
}

test('parser accepts a primary weekly window and returns sanitized checkpoints', () => {
  const { parseCodexOfficialQuota } = load();
  const value = parseCodexOfficialQuota(reply(), context)!;
  assert.ok(value);
  assert.deepEqual(Object.keys(value).sort(), [
    'accountScopeKey', 'sourceScopeKey', 'observedAt', 'requestedAt', 'resetAt', 'usedPercent', 'windows',
  ].sort());
  assert.match(value.accountScopeKey, /^[a-f0-9]{64}$/);
  assert.match(value.sourceScopeKey, /^[a-f0-9]{64}$/);
  assert.equal(value.usedPercent, 40);
  assert.equal(value.resetAt, NOW + 3_600_000);
  assert.equal(value.requestedAt, NOW);
  assert.equal(value.observedAt, NOW + 10);
  assert.doesNotMatch(JSON.stringify(value), /fixture-account|codex-home/);
  const cache = new (require('../providers/codex/codexAccountScope').CodexAccountScopeCache)(SALT);
  assert.equal(value.accountScopeKey,
    cache.observe(true, context.source, { accountId: 'fixture-account' }, NOW)!.accountScopeKey);
});

test('all selected codex windows are retained without inferring ordinary usage permission', () => {
  const { parseCodexOfficialQuota: parse } = load();
  const value = parse({ ...reply(), rateLimits: { ...snapshot(),
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: NOW / 1000 + 60 },
    secondary: weekly(60),
  } }, context)!;
  assert.deepEqual(value.windows, {
    primary: { usedPercent: 25, windowDurationMins: 300, resetAt: NOW + 60_000 },
    secondary: { usedPercent: 60, windowDurationMins: 10080, resetAt: NOW + 3_600_000 },
  });
  assert.equal(value.usedPercent, 60);
  assert.equal(value.resetAt, NOW + 3_600_000);
  assert.equal(Object.prototype.hasOwnProperty.call(value, 'ordinaryUsageAllowed'), false);
});

const credit = (id = 'opaque-credit-canary') => ({ id, status: 'available', resetType: 'codexRateLimits',
  grantedAt: NOW / 1000 - 60, expiresAt: null });

test('optional official permissions and enum state are copied only from allowlisted own data', () => {
  const { parseCodexOfficialQuota: parse } = load();
  for (const ordinaryUsageAllowed of [true, false, null]) {
    const value = parse({ ...reply(), ordinaryUsageAllowed, rateLimits: { ...snapshot(),
      planType: 'pro', rateLimitReachedType: 'workspace_member_usage_limit_reached', spendControlReached: false,
    } }, context)!;
    assert.equal(value.ordinaryUsageAllowed, ordinaryUsageAllowed);
    assert.equal(value.planType, 'pro');
    assert.equal(value.rateLimitReachedType, 'workspace_member_usage_limit_reached');
    assert.equal(value.spendControlReached, false);
  }
  const invalid = parse({ ...reply(), ordinaryUsageAllowed: 'true', rateLimits: { ...snapshot(),
    planType: 'private-plan-canary', rateLimitReachedType: 'private-limit-canary', spendControlReached: 0,
  } }, context)!;
  for (const key of ['ordinaryUsageAllowed', 'planType', 'rateLimitReachedType', 'spendControlReached']) {
    assert.equal(Object.prototype.hasOwnProperty.call(invalid, key), false);
  }
  const inherited = Object.assign(Object.create({ ordinaryUsageAllowed: true, rateLimitResetCredits: { availableCount: 7 } }), reply());
  assert.equal(parse(inherited, context)!.ordinaryUsageAllowed, undefined);
  assert.equal(parse(inherited, context)!.rateLimitResetCredits, undefined);
});

test('unknown window metadata stays null and never becomes zero or permission to use', () => {
  const { parseCodexOfficialQuota: parse } = load();
  for (const primary of [{ usedPercent: 0 }, { usedPercent: 0, windowDurationMins: null, resetsAt: null }]) {
    const value = parse({ ...reply(), rateLimits: { ...snapshot(), primary, secondary: weekly() } }, context)!;
    assert.ok(value);
    assert.deepEqual(value.windows!.primary, { usedPercent: 0, windowDurationMins: null, resetAt: null });
    assert.equal(value.ordinaryUsageAllowed, undefined);
  }
});

test('reset-credit count is authoritative and missing, null and empty details remain distinct', () => {
  const { parseCodexOfficialQuota: parse } = load();
  assert.equal(parse(reply(), context)!.rateLimitResetCredits, undefined);
  assert.equal(parse({ ...reply(), rateLimitResetCredits: null }, context)!.rateLimitResetCredits, null);
  for (const details of [{}, { credits: null }, { credits: [] }, { credits: [credit()] }]) {
    const value = parse({ ...reply(), rateLimitResetCredits: { availableCount: 9, ...details } }, context)!.rateLimitResetCredits!;
    assert.equal(value.availableCount, 9, 'never infer count from a capped list');
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'credits'), Object.prototype.hasOwnProperty.call(details, 'credits'));
    if ('credits' in details && !Array.isArray(details.credits)) assert.equal(value.credits, null);
    if ('credits' in details && Array.isArray(details.credits)) assert.equal(value.credits!.length, details.credits.length);
  }
  assert.equal(parse({ ...reply(), rateLimitResetCredits: { availableCount: 0, credits: [credit()] } }, context)!
    .rateLimitResetCredits!.availableCount, 0, 'detail status must not override the summary');
});

test('credit details contain only salted scoped HMAC, enums and numeric timestamps; free text is unread', () => {
  const { parseCodexOfficialQuota: parse } = load();
  const row = credit();
  for (const key of ['title', 'description', 'credentials']) {
    Object.defineProperty(row, key, { get() { assert.fail(`must not read credit ${key}`); } });
  }
  const response = { ...reply(), rateLimitResetCredits: { availableCount: 2, credits: [row] } };
  const value = parse(response, context)!, detail = value.rateLimitResetCredits!.credits![0];
  assert.deepEqual(Object.keys(detail).sort(), ['creditKey', 'status', 'resetType', 'grantedAt', 'expiresAt'].sort());
  assert.match(detail.creditKey, /^[a-f0-9]{64}$/);
  assert.equal(detail.creditKey, createHmac('sha256', SALT)
    .update(JSON.stringify(['codex-official-reset-credit-v1', value.accountScopeKey, row.id])).digest('hex'));
  assert.equal(detail.status, 'available');
  assert.equal(detail.resetType, 'codexRateLimits');
  assert.equal(detail.grantedAt, NOW - 60_000);
  assert.equal(detail.expiresAt, null);
  assert.doesNotMatch(JSON.stringify(value), /opaque-credit-canary|fixture-account|codex-home/);
  const key = (r: unknown, c = context) => parse(r, c)!.rateLimitResetCredits!.credits![0].creditKey;
  assert.equal(key(response), detail.creditKey);
  assert.notEqual(key(response, { ...context, machineSalt: SALT + '-other' }), detail.creditKey);
  assert.notEqual(key({ ...response, accountId: 'different-account' }), detail.creditKey);
  assert.notEqual(key(response, { ...context, source: '/different-home' }), detail.creditKey);
  for (const status of ['available', 'redeeming', 'redeemed', 'unknown']) {
    const result = parse({ ...reply(), rateLimitResetCredits: { availableCount: 1,
      credits: [{ ...credit(), status, resetType: 'unknown', expiresAt: NOW / 1000 + 10 }],
    } }, context)!.rateLimitResetCredits!.credits![0];
    assert.equal(result.status, status);
    assert.equal(result.resetType, 'unknown');
    assert.equal(result.expiresAt, NOW + 10_000);
    assert.equal(result.creditKey, detail.creditKey, 'status changes preserve credit identity');
  }
});

test('invalid optional reset proof cannot invent available counts or fetched-empty detail lists', () => {
  const { parseCodexOfficialQuota: parse } = load();
  for (const summary of [{ credits: [credit()] }, { availableCount: null }, { availableCount: '2' },
    { availableCount: -1 }, { availableCount: 1.5 }, { availableCount: Infinity },
    { availableCount: Number.MAX_SAFE_INTEGER + 1 }, [], true]) {
    assert.equal(parse({ ...reply(), rateLimitResetCredits: summary }, context)!.rateLimitResetCredits, undefined);
  }
  for (const credits of ['bad', [null], [{ ...credit(), id: '' }], [{ ...credit(), id: 'x'.repeat(513) }],
    [{ ...credit(), id: 'bad\nID' }], [{ ...credit(), status: 'private-status-canary' }],
    [{ ...credit(), resetType: 'private-type-canary' }], [{ ...credit(), grantedAt: '1' }],
    [{ ...credit(), expiresAt: Number.MAX_SAFE_INTEGER }], [credit(), credit()],
    new Array(129).fill(credit())]) {
    const value = parse({ ...reply(), rateLimitResetCredits: { availableCount: 3, credits } }, context)!.rateLimitResetCredits!;
    assert.equal(value.availableCount, 3);
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'credits'), false);
  }
  const { expiresAt: _unused, ...withoutExpiry } = credit();
  const details = parse({ ...reply(), rateLimitResetCredits: { availableCount: 1, credits: [withoutExpiry] } }, context)!
    .rateLimitResetCredits!.credits![0];
  assert.equal(Object.prototype.hasOwnProperty.call(details, 'expiresAt'), false);
});

test('credit detail bounds avoid getters, enumeration and list traversal beyond the limit', () => {
  const { parseCodexOfficialQuota: parse } = load();
  const parseRows = (credits: unknown) => parse({ ...reply(), rateLimitResetCredits: { availableCount: 200, credits } }, context)!;
  const maximum = Array.from({ length: 128 }, (_, i) => credit('opaque-' + i));
  assert.equal(parseRows(maximum).rateLimitResetCredits!.credits!.length, 128);
  assert.equal(parseRows([credit('x'.repeat(512))]).rateLimitResetCredits!.credits!.length, 1);
  const oversized = new Array(129);
  Object.defineProperty(oversized, 0, { get() { assert.fail('oversized rows must stay unread'); } });
  assert.equal(parseRows(oversized).rateLimitResetCredits!.credits, undefined);
  const guarded = new Proxy([credit()], {
    get() { assert.fail('must not execute array getters'); },
    ownKeys() { assert.fail('must not enumerate detail fields'); },
  });
  assert.equal(parseRows(guarded).rateLimitResetCredits!.credits!.length, 1);
  const sparse = new Array(1);
  assert.equal(parseRows(sparse).rateLimitResetCredits!.credits, undefined);
  const optionalGetters = reply();
  for (const key of ['ordinaryUsageAllowed', 'rateLimitResetCredits']) {
    Object.defineProperty(optionalGetters, key, { get() { assert.fail(`must not execute optional ${key}`); } });
  }
  assert.ok(parse(optionalGetters, context));
});

test('own codex map entry wins; a present invalid or missing codex map never falls back to legacy', () => {
  const { parseCodexOfficialQuota: parse } = load();
  assert.equal(parse({ accountId: 'fixture-account', rateLimitsByLimitId: { codex: snapshot() },
    get rateLimits() { return assert.fail('must not inspect legacy with a map'); } }, context)!.usedPercent, 40);
  for (const map of [undefined, null, [], {}, { other: snapshot() }, Object.create({ codex: snapshot() }),
    { codex: { ...snapshot(), limitId: 'other' } }]) {
    assert.equal(parse({ ...reply(), rateLimitsByLimitId: map }, context), null);
  }
  assert.ok(parse({ ...reply(), rateLimits: { ...snapshot(), limitId: undefined } }, context));
  assert.equal(parse({ ...reply(), rateLimits: { ...snapshot(), limitId: 'other' } }, context), null);
});

test('parser selects secondary weekly windows and refuses contradictory weekly windows', () => {
  const { parseCodexOfficialQuota: parse } = load();
  assert.equal(parse({ ...reply(), rateLimits: { ...snapshot(), primary: { ...weekly(), windowDurationMins: 300 },
    secondary: weekly(60) } }, context)!.usedPercent, 60);
  assert.ok(parse({ ...reply(), rateLimits: { ...snapshot(), secondary: weekly() } }, context));
  for (const secondary of [weekly(50), { ...weekly(), resetsAt: weekly().resetsAt + 1 }]) {
    assert.equal(parse({ ...reply(), rateLimits: { ...snapshot(), secondary } }, context), null);
  }
  assert.equal(parse({ ...reply(), rateLimits: { ...snapshot(), primary: { ...weekly(), windowDurationMins: 300 } } }, context), null);
});

test('parser never enumerates unknown fields or accesses credentials, and handles throwing allowed getters', () => {
  const { parseCodexOfficialQuota: parse } = load();
  const selected = snapshot();
  for (const name of ['accountId', 'email', 'accessToken', 'refreshToken', 'idToken', 'tokens', 'credits', 'planType']) {
    Object.defineProperty(selected, name, { get() { assert.fail(`must not access ${name}`); } });
  }
  const guarded = new Proxy(Object.freeze(selected), { ownKeys() { assert.fail('must not enumerate reply fields'); } });
  assert.ok(parse(Object.freeze({ ...reply(), rateLimits: guarded }), context));
  for (const field of ['primary', 'secondary', 'limitId']) {
    const value = snapshot();
    Object.defineProperty(value, field, { get() { throw new Error('sensitive-canary'); } });
    assert.equal(parse({ ...reply(), rateLimits: value }, context), null);
  }
  assert.equal(parse({ get rateLimitsByLimitId() { throw new Error('sensitive-canary'); } }, context), null);
});

test('IDs, numeric fields and timestamps fail closed without coercion; optional missing ID yields null', () => {
  const { parseCodexOfficialQuota: parse } = load();
  for (const accountId of [undefined, null, 42, '', ' ', 'x'.repeat(513)]) {
    assert.equal(parse({ ...reply(), accountId }, context), null);
  }
  assert.ok(parse({ accountId: 'root-id', rateLimits: { limitId: 'codex', primary: weekly() } }, context));
  for (const change of [{ usedPercent: NaN }, { usedPercent: Infinity }, { usedPercent: -1 },
    { usedPercent: 101 }, { usedPercent: '40' }, { resetsAt: '1800003600' }, { resetsAt: 0 },
    { resetsAt: NOW / 1000 }, { resetsAt: Number.MAX_SAFE_INTEGER }, { windowDurationMins: '10080' }]) {
    assert.equal(parse({ ...reply(), rateLimits: { ...snapshot(), primary: { ...weekly(), ...change } } }, context), null);
  }
  assert.equal(parse(reply(), { ...context, observedAt: NOW - 1 }), null);
  assert.equal(parse(reply(), { ...context, observedAt: NOW + 30_000 }), null);
  assert.equal(parse(reply(), { ...context, machineSalt: '' }), null);
  assert.equal(parse(reply(), { ...context, source: '' }), null);
  assert.equal(parse({ ...reply(), error: { message: 'sensitive-canary' } }, context), null);
  const other = parse(reply(), { ...context, machineSalt: SALT + '-other' })!;
  assert.notEqual(other.accountScopeKey, parse(reply(), context)!.accountScopeKey);
  const switched = parse(reply(), { ...context, source: '/other-home' })!;
  assert.notEqual(switched.accountScopeKey, parse(reply(), context)!.accountScopeKey);
});

test('account scope comes only from an own root ID, never an unknown nested ID or getter', () => {
  const { parseCodexOfficialQuota: parse } = load();
  for (const mapped of [false, true]) {
    let nestedReads = 0;
    const selected = snapshot();
    Object.defineProperty(selected, 'accountId', { get() { nestedReads++; throw new Error('must remain unread'); } });
    const response = mapped ? { rateLimitsByLimitId: { codex: selected } } : { rateLimits: selected };
    const valid = parse({ ...response, accountId: 'root-id' }, context);
    assert.ok(valid);
    assert.deepEqual(valid, parse({ accountId: 'root-id', rateLimits: snapshot() }, context));
    assert.equal(parse(response, context), null, 'missing root ID is unavailable, even with a nested ID');
    assert.equal(nestedReads, 0);
    const inherited = Object.assign(Object.create({ accountId: 'root-id' }), response);
    assert.equal(parse(inherited, context), null, 'inherited root ID is not schema evidence');
    assert.equal(parse({ ...response, get accountId() { throw new Error('unreadable root'); } }, context), null);
    assert.equal(nestedReads, 0);
  }
  assert.equal(parse({ rateLimits: { ...snapshot(), accountId: 'nested-only' } }, context), null);
  assert.equal(parse({ accountId: null, rateLimits: { ...snapshot(), accountId: 'nested-only' } }, context), null);
  assert.ok(parse({ accountId: 'root-id', rateLimits: { ...snapshot(), accountId: 'different-nested-id' } }, context));
});

test('proxy transport uses exactly the allowlisted handshake and RPC, then kills only its own proxy', async () => {
  const { readCodexOfficialQuota } = load();
  const f = fixture();
  assert.ok(await readCodexOfficialQuota(f.options));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].binary, '/fixture/codex');
  assert.deepEqual(f.calls[0].args, ['app-server', 'proxy']);
  assert.equal(f.calls[0].options.shell, false);
  assert.equal(f.calls[0].options.env!.CODEX_HOME, context.source);
  assert.deepEqual(f.child.requests.map(r => r.method), ['initialize', 'initialized', 'account/rateLimits/read']);
  assert.equal(f.child.requests[1].id, undefined);
  assert.deepEqual(f.child.kills, ['SIGKILL']);
});

test('WebSocket fatal UTF-8 decoding preserves multibyte account IDs across arbitrary stdout chunks', async () => {
  const { readCodexOfficialQuota, parseCodexOfficialQuota } = load();
  const result = { accountId: 'fixture-账户', rateLimits: snapshot() };
  const f = fixture(child => {
    const bytes = serverFrame(JSON.stringify({ id: 2, result }));
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
  });
  assert.deepEqual(await readCodexOfficialQuota(f.options), parseCodexOfficialQuota(result, {
    ...context, requestedAt: NOW, observedAt: NOW,
  }));
});

test('combined output is bounded at 256 KiB including stderr, with no fallback spawn', async () => {
  const { readCodexOfficialQuota } = load();
  for (const stream of ['stdout', 'stderr'] as const) {
    const f = fixture(child => { child[stream].write(Buffer.alloc(256 * 1024 + 1, 120)); });
    assert.equal(await readCodexOfficialQuota(f.options), null);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.child.kills, ['SIGKILL']);
  }
  const combined = fixture(child => {
    child.stderr.write(Buffer.alloc(128 * 1024, 120));
    child.stdout.write(Buffer.alloc(128 * 1024, 120));
  });
  assert.equal(await readCodexOfficialQuota(combined.options), null);
});

test('abort and bounded timeout terminate the owned proxy; pre-abort and invalid options do not spawn', async () => {
  const { readCodexOfficialQuota } = load();
  const controller = new AbortController();
  controller.abort();
  const before = fixture();
  assert.equal(await readCodexOfficialQuota({ ...before.options, signal: controller.signal }), null);
  assert.equal(before.calls.length, 0);
  const active = new AbortController();
  const aborted = fixture(() => active.abort());
  assert.equal(await readCodexOfficialQuota({ ...aborted.options, signal: active.signal }), null);
  assert.deepEqual(aborted.child.kills, ['SIGKILL']);
  const timeout = fixture(() => {});
  assert.equal(await readCodexOfficialQuota({ ...timeout.options, timeoutMs: 5 }), null);
  assert.deepEqual(timeout.child.kills, ['SIGKILL']);
  for (const timeoutMs of [0, -1, NaN, 10_001]) {
    const f = fixture();
    assert.equal(await readCodexOfficialQuota({ ...f.options, timeoutMs }), null);
    assert.equal(f.calls.length, 0);
  }
});

test('RPC errors, malformed messages, unexpected response IDs and child errors return null without raw errors', async () => {
  const { readCodexOfficialQuota } = load();
  for (const action of [
    (child: ProxyStub) => child.send({ id: 2, error: { message: 'secret-canary' } }),
    (child: ProxyStub) => child.stdout.write('malformed-secret-canary\n'),
    (child: ProxyStub) => child.send({ id: 99, result: reply() }),
    (child: ProxyStub) => child.emit('error', new Error('secret-canary')),
    (child: ProxyStub) => child.emit('close', 1, null),
  ]) {
    const f = fixture(action);
    assert.equal(await readCodexOfficialQuota(f.options), null);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  assert.equal(await readCodexOfficialQuota({ ...f.options, dependencies: {
    spawn: () => { throw new Error('secret-canary'); },
  } }), null);
});

test('unsupported NDJSON, invalid upgrades and WebSocket protocol failures cannot produce a quota result', async () => {
  const { readCodexOfficialQuota } = load();
  for (const transform of [
    (_b: Buffer) => Buffer.from('{"id":1,"result":{}}\n'),
    (b: Buffer) => Buffer.from(b.toString().replace(/Sec-WebSocket-Accept: .+\r\n/, 'Sec-WebSocket-Accept: bad\r\n')),
    (_b: Buffer) => Buffer.alloc(16 * 1024 + 1, 65),
  ]) {
    const f = fixture(); f.child.upgradeTransform = transform;
    // NDJSON has no valid header terminator, so the bounded deadline rejects it.
    assert.equal(await readCodexOfficialQuota({ ...f.options, timeoutMs: 5 }), null);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.child.requests, []);
    assert.deepEqual(f.child.kills, ['SIGKILL']);
  }
  for (const bytes of [Buffer.from([0x81, 0x80]), Buffer.from([0xc1, 0]),
    serverFrame(Buffer.from([0xc3, 0x28])), Buffer.from([0x88, 0])]) {
    const f = fixture(child => child.stdout.write(bytes));
    assert.equal(await readCodexOfficialQuota(f.options), null);
    assert.deepEqual(f.child.kills, ['SIGKILL']);
  }
});

test('clock regression, frozen replies, notification frames and failed setup remain fail closed', async () => {
  const { readCodexOfficialQuota } = load();
  const f = fixture(child => {
    child.send({ method: 'unrelated/notification', params: { ignored: true } });
    child.send({ id: 2, result: reply() });
  });
  assert.ok(await readCodexOfficialQuota(f.options));
  const regressed = fixture(); let reads = 0;
  assert.equal(await readCodexOfficialQuota({ ...regressed.options, now: () => NOW - reads++ }), null);
  for (const change of [{ machineSalt: '' }, { source: '' }, { binary: '' }]) {
    const invalid = fixture();
    assert.equal(await readCodexOfficialQuota({ ...invalid.options, ...change }), null);
    assert.equal(invalid.calls.length, 0);
  }
});

test('aggregate wire limit accepts exactly 256 KiB and rejects one extra byte', async () => {
  const { readCodexOfficialQuota, CODEX_OFFICIAL_QUOTA_MAX_BYTES } = load();
  for (const excess of [0, 1]) {
    const f = fixture(child => {
      const frame = serverFrame(JSON.stringify({ id: 2, result: reply() }));
      const padding = CODEX_OFFICIAL_QUOTA_MAX_BYTES - child.wireBytes - frame.length + excess;
      assert.ok(padding > 0);
      child.stderr.write(Buffer.alloc(padding, 65));
      child.stdout.write(frame);
    });
    const result = await readCodexOfficialQuota(f.options);
    assert.equal(result !== null, excess === 0);
    assert.equal(f.child.wireBytes, CODEX_OFFICIAL_QUOTA_MAX_BYTES + excess);
    assert.deepEqual(f.child.kills, ['SIGKILL']);
  }
});

test('abort during upgrade sends no RPC, and accepted responses wait for proxy close', async () => {
  const { readCodexOfficialQuota } = load();
  const controller = new AbortController(), aborted = fixture();
  aborted.child.upgradeTransform = () => { controller.abort(); return Buffer.alloc(0); };
  assert.equal(await readCodexOfficialQuota({ ...aborted.options, signal: controller.signal }), null);
  assert.deepEqual(aborted.child.requests, []);
  assert.deepEqual(aborted.child.kills, ['SIGKILL']);

  const delayed = fixture();
  delayed.child.kill = signal => { delayed.child.kills.push(signal); return true; };
  let settled = false;
  const pending = readCodexOfficialQuota({ ...delayed.options, timeoutMs: 1000 }).then(value => {
    settled = true; return value;
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(delayed.child.kills, ['SIGKILL']);
  assert.equal(settled, false, 'ownership lasts until close, even after a valid response');
  delayed.child.emit('close', null, 'SIGKILL');
  assert.ok(await pending);
  assert.equal(delayed.child.stdout.listenerCount('data'), 1, 'only the stub byte counter remains');
  assert.equal(delayed.child.stderr.listenerCount('data'), 1);
});

test('valid maximum timeout succeeds without waiting and a throwing completion clock yields null', async () => {
  const { readCodexOfficialQuota } = load();
  const success = fixture();
  assert.ok(await readCodexOfficialQuota({ ...success.options, timeoutMs: 10_000 }));
  const failure = fixture(); let calls = 0;
  assert.equal(await readCodexOfficialQuota({ ...failure.options, now: () => {
    if (calls++) throw new Error('synthetic-clock-failure');
    return NOW;
  } }), null);
  assert.deepEqual(failure.child.kills, ['SIGKILL']);
});
