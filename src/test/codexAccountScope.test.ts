import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// Load lazily so the first TDD run reports the missing implementation as a test failure.
const load = (): typeof import('../providers/codex/codexAccountScope') =>
  require('../providers/codex/codexAccountScope');
const SALT = 'fixture-machine-salt-0123456789abcdef';

test('official account metadata is retained only as an anonymous snapshot scope', () => {
  const { CodexAccountScopeCache } = load();
  const cache = new CodexAccountScopeCache(SALT);
  const reply: any = { accountId: 'fixture-account' };
  for (const name of ['email', 'accessToken', 'refreshToken', 'idToken', 'tokens', 'account']) {
    Object.defineProperty(reply, name, { get() { assert.fail(`must not inspect ${name}`); } });
  }
  const result = cache.observe(true, 'fixture-source', reply, 1000);
  assert.equal(result?.basis, 'official-usage-snapshot');
  assert.equal(result?.usageOwnership, 'unproven');
  assert.match(result!.accountScopeKey, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('fixture-account'), false);
  assert.equal(JSON.stringify(result).includes('private@'), false);
  assert.equal(JSON.stringify(result).includes('fixture-source'), false);
  assert.deepEqual(cache.read(true, 'fixture-source', 1001), result);
  assert.deepEqual(Object.keys(result!).sort(), [
    'accountScopeKey', 'sourceScopeKey', 'observedAtMs', 'expiresAtMs', 'basis', 'usageOwnership',
  ].sort());
  assert.equal(JSON.stringify(cache), '{}', 'private runtime state cannot be serialized');
});

test('begin binds replies to the current single-use generation without reading stale replies', () => {
  const { CodexAccountScopeCache } = load();
  const cache = new CodexAccountScopeCache(SALT);
  const old = cache.begin(true, 'source', 1000)!;
  const current = cache.begin(true, 'source', 1001)!;
  assert.notEqual(old, current);
  const unreadable = new Proxy({}, { get() { assert.fail('stale reply must not be inspected'); } });
  assert.equal(cache.observe(true, 'old-source', unreadable, 999, old), null);
  const accepted = cache.observe(true, 'source', { accountId: 'current' }, 1002, current)!;
  assert.ok(accepted);
  assert.equal(cache.observe(true, 'source', unreadable, 1003, current), null, 'one use only');
  assert.equal(cache.observe(true, 'source', unreadable, 1003, old), null);
  assert.deepEqual(cache.read(true, 'source', 1003), accepted, 'stale replies preserve newer metadata');
});

test('every invalidation revokes pending replies even after re-enabling the same source', () => {
  const { CodexAccountScopeCache, CODEX_ACCOUNT_SCOPE_TTL_MS: ttl } = load();
  const invalidators: Array<(cache: InstanceType<typeof CodexAccountScopeCache>, gen: number) => void> = [
    cache => cache.clear(),
    cache => { cache.read(false, 'source', 1001); },
    cache => { cache.observe(false, 'source', null, 1001); },
    cache => { cache.read(true, 'other-source', 1001); },
    cache => { cache.read(true, '', 1001); },
    cache => { cache.read(true, 'source', 999); },
    cache => { cache.read(true, 'source', NaN); },
    cache => { cache.read(true, 'source', 1000 + ttl); },
    (cache, gen) => { cache.observe(true, 'source', {}, 1001, gen); },
    (cache, gen) => { cache.observe(true, 'other-source', { accountId: 'one' }, 1001, gen); },
    cache => { cache.begin(false, 'source', 1001); },
    cache => { cache.begin(true, '', 1001); },
    cache => { cache.begin(true, 'source', 999); },
  ];
  for (const invalidate of invalidators) {
    const cache = new CodexAccountScopeCache(SALT);
    const old = cache.begin(true, 'source', 1000)!;
    invalidate(cache, old);
    assert.equal(cache.read(true, 'source', 1001), null);
    const current = cache.begin(true, 'source', 1002)!;
    assert.notEqual(old, current);
    const unreadable = new Proxy({}, { get() { assert.fail('revoked reply was read'); } });
    assert.equal(cache.observe(true, 'source', unreadable, 1003, old), null);
    assert.ok(cache.observe(true, 'source', { accountId: 'new' }, 1003, current));
  }
});

test('stale replies cannot cross an A to B to A source switch', () => {
  const { CodexAccountScopeCache } = load();
  const cache = new CodexAccountScopeCache(SALT);
  const a = cache.begin(true, 'a', 1000)!;
  const b = cache.begin(true, 'b', 1001)!;
  const aAgain = cache.begin(true, 'a', 1002)!;
  assert.equal(cache.observe(true, 'a', { accountId: 'old-a' }, 1003, a), null);
  assert.equal(cache.observe(true, 'b', { accountId: 'old-b' }, 1003, b), null);
  assert.ok(cache.observe(true, 'a', { accountId: 'new-a' }, 1003, aAgain));
  assert.equal(cache.read(true, 'b', 1004), null);
  assert.equal(cache.read(true, 'a', 1004), null, 'the previous source is not retained');
});

test('snapshot time is fixed, reads do not renew TTL, and expiry also revokes pending requests', () => {
  const { CodexAccountScopeCache, CODEX_ACCOUNT_SCOPE_TTL_MS: ttl } = load();
  assert.equal(ttl, 30_000);
  const cache = new CodexAccountScopeCache(SALT);
  const gen = cache.begin(true, 'source', 1000)!;
  const snapshot = cache.observe(true, 'source', Object.freeze({ accountId: 'one' }), 1100, gen)!;
  assert.equal(snapshot.observedAtMs, 1100);
  assert.equal(snapshot.expiresAtMs, 1100 + ttl);
  assert.deepEqual(cache.read(true, 'source', 1100 + ttl - 1), snapshot);
  assert.equal(cache.read(true, 'source', 1100 + ttl), null);
  assert.equal(cache.read(true, 'source', 1100), null, 'expired data cannot reappear');
  const pending = cache.begin(true, 'source', 40_000)!;
  assert.equal(cache.observe(true, 'source', { accountId: 'late' }, 40_000 + ttl, pending), null);
  assert.equal(cache.observe(true, 'source', { accountId: 'late' }, 40_001, pending), null);
});

test('frozen input is never enumerated or retained, and returned copies cannot alter metadata', () => {
  const { CodexAccountScopeCache } = load();
  const cache = new CodexAccountScopeCache(SALT);
  const input = new Proxy(Object.freeze({ accountId: 'one', email: 'private@example.invalid' }), {
    get(target, key) {
      assert.equal(key, 'accountId');
      return Reflect.get(target, key);
    },
    ownKeys() { assert.fail('must not enumerate a response'); },
    getOwnPropertyDescriptor() { assert.fail('must not inspect unrelated descriptors'); },
  });
  const snapshot = cache.observe(true, 'source', input, 1000)!;
  const baseline = { ...snapshot };
  snapshot.accountScopeKey = 'tampered';
  snapshot.sourceScopeKey = 'tampered';
  snapshot.observedAtMs = 0;
  snapshot.expiresAtMs = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(cache.read(true, 'source', 1001), baseline);
  const copy = cache.read(true, 'source', 1002)!;
  assert.notEqual(copy, snapshot);
  copy.accountScopeKey = 'tampered-again';
  assert.deepEqual(cache.read(true, 'source', 1003), baseline);
  const mutable = { accountId: 'one' };
  cache.observe(true, 'source', mutable, 1004);
  mutable.accountId = 'two';
  assert.equal(cache.read(true, 'source', 1005)!.accountScopeKey, baseline.accountScopeKey);
});

test('unbound observations cannot race bound requests and OFF revokes even with a stale token', () => {
  const { CodexAccountScopeCache } = load();
  const cache = new CodexAccountScopeCache(SALT);
  const gen = cache.begin(true, 'source', 1000)!;
  assert.equal(cache.observe(true, 'source', { accountId: 'unbound' }, 1001), null);
  assert.equal(cache.observe(true, 'source', { accountId: 'late' }, 1002, gen), null);
  const current = cache.begin(true, 'source', 1003)!;
  const unreadable = new Proxy({}, { get() { assert.fail('OFF must not read a reply'); } });
  assert.equal(cache.observe(false, 'source', unreadable, 1004, gen), null);
  assert.equal(cache.observe(true, 'source', unreadable, 1005, current), null);
});

test('invalid or unreadable IDs revoke metadata and never substitute other response fields', () => {
  const { CodexAccountScopeCache } = load();
  const cache = new CodexAccountScopeCache(SALT);
  const badReplies = [null, undefined, [], 'one', 42, {},
    { accountId: false }, { accountId: {} }, { accountId: ' one' }, { accountId: 'one ' },
    { accountId: '\n' }, { accountId: 'one\u0000two' }, { accountId: '\ud800' },
    { accountId: '\u200b' }, { accountId: '\u00a0' },
    { get accountId() { throw new Error('unreadable'); } },
  ];
  for (const reply of badReplies) {
    assert.ok(cache.observe(true, 'source', { accountId: 'one' }, 1000));
    assert.equal(cache.observe(true, 'source', reply, 1001), null);
    assert.equal(cache.read(true, 'source', 1001), null);
    cache.clear();
  }
});

test('invalidation during an accountId getter cannot resurrect a revoked request', () => {
  const { CodexAccountScopeCache } = load();
  for (const throwing of [false, true]) {
    const cache = new CodexAccountScopeCache(SALT);
    const old = cache.begin(true, 'source', 1000)!;
    let current: number;
    const reply = { get accountId() {
      cache.clear();
      current = cache.begin(true, 'source', 1002)!;
      if (throwing) { throw new Error('old getter failed'); }
      return 'revoked';
    } };
    assert.equal(cache.observe(true, 'source', reply, 1001, old), null);
    assert.ok(cache.observe(true, 'source', { accountId: 'new' }, 1003, current!));
  }
});

test('a reentrant accountId getter cannot overwrite or clear an already accepted newer snapshot', () => {
  const { CodexAccountScopeCache } = load();
  for (const bound of [false, true]) {
    for (const throwing of [false, true]) {
      const cache = new CodexAccountScopeCache(SALT);
      const gen = bound ? cache.begin(true, 'source', 1000)! : undefined;
      let newer: ReturnType<typeof cache.observe>;
      const reply = { get accountId() {
        newer = cache.observe(true, 'source', { accountId: 'newer' }, 1001, gen);
        if (throwing) { throw new Error('old getter failed'); }
        return 'older';
      } };
      assert.equal(cache.observe(true, 'source', reply, 1001, gen), null);
      assert.ok(newer!);
      assert.deepEqual(cache.read(true, 'source', 1002), newer!);
    }
  }
});

test('HMAC keys are machine-salted, source-bound and separated by domain and tuple boundaries', () => {
  const { CodexAccountScopeCache } = load();
  const cache = new CodexAccountScopeCache(SALT);
  const first = cache.observe(true, 'source', { accountId: 'one' }, 1000)!;
  const hmac = (parts: string[]) => createHmac('sha256', SALT).update(JSON.stringify(parts)).digest('hex');
  assert.equal(first.sourceScopeKey, hmac(['codex-official-usage-scope-v1', 'source', 'source']));
  assert.equal(first.accountScopeKey,
    hmac(['codex-official-usage-scope-v1', 'account', first.sourceScopeKey, 'one']));
  assert.notEqual(first.accountScopeKey, first.sourceScopeKey);
  const same = new CodexAccountScopeCache(SALT).observe(true, 'source', { accountId: 'one' }, 0)!;
  assert.equal(first.accountScopeKey, same.accountScopeKey);
  for (const [salt, source, id] of [[SALT + '-different', 'source', 'one'],
    [SALT, 'source-other', 'one'], [SALT, 'source', 'two']]) {
    const changed = new CodexAccountScopeCache(salt).observe(true, source, { accountId: id }, 0)!;
    assert.notEqual(first.accountScopeKey, changed.accountScopeKey);
  }
  const a = new CodexAccountScopeCache(SALT).observe(true, 'a', { accountId: 'bc' }, 0)!;
  const b = new CodexAccountScopeCache(SALT).observe(true, 'ab', { accountId: 'c' }, 0)!;
  assert.notEqual(a.accountScopeKey, b.accountScopeKey);
});

test('salt, source, account and timestamp bounds fail closed at their exact boundaries', () => {
  const {
    CodexAccountScopeCache, CODEX_ACCOUNT_SCOPE_TTL_MS: ttl,
    CODEX_ACCOUNT_SCOPE_MIN_SALT_LENGTH: minSalt, CODEX_ACCOUNT_SCOPE_MAX_SALT_LENGTH: maxSalt,
    CODEX_ACCOUNT_SCOPE_MAX_SOURCE_LENGTH: maxSource, CODEX_ACCOUNT_SCOPE_MAX_ACCOUNT_ID_LENGTH: maxId,
  } = load();
  assert.equal(maxId, 512);
  for (const salt of [null, undefined, 42, '', ' '.repeat(minSalt), 's'.repeat(minSalt - 1),
    's'.repeat(maxSalt + 1), '\ud800'.repeat(minSalt)]) {
    assert.throws(() => new CodexAccountScopeCache(salt as string), RangeError);
  }
  for (const length of [minSalt, maxSalt]) {
    const cache = new CodexAccountScopeCache('s'.repeat(length));
    assert.ok(cache.observe(true, 's'.repeat(maxSource), { accountId: 'a'.repeat(maxId) }, 0));
  }
  const cache = new CodexAccountScopeCache(SALT);
  for (const source of [null, undefined, 42, '', ' ', ' source', 'source ', 'a\u0000b',
    '\ud800', 's'.repeat(maxSource + 1)]) {
    assert.ok(cache.observe(true, 'source', { accountId: 'one' }, 1000));
    const gen = cache.begin(true, source, 1001);
    assert.equal(gen, null);
    assert.equal(cache.read(true, 'source', 1002), null);
    cache.clear();
  }
  assert.ok(cache.observe(true, 'source', { accountId: 'a'.repeat(maxId) }, 0));
  assert.equal(cache.observe(true, 'source', { accountId: 'a'.repeat(maxId + 1) }, 1), null);
  for (const now of [-1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER - ttl + 1,
    Number.MAX_VALUE, undefined, null, '1000']) {
    cache.clear();
    assert.ok(cache.observe(true, 'source', { accountId: 'one' }, 1000));
    assert.equal(cache.observe(true, 'source', { accountId: 'one' }, now as number), null);
    assert.equal(cache.read(true, 'source', 1001), null);
  }
  cache.clear();
  const lastValidTime = Number.MAX_SAFE_INTEGER - ttl;
  const snapshot = cache.observe(true, 'source', { accountId: 'one' }, lastValidTime)!;
  assert.equal(snapshot.expiresAtMs, Number.MAX_SAFE_INTEGER);
});

test('metadata cache is bounded, copied, source-bound and expires without any timer', () => {
  const { CodexAccountScopeCache, CODEX_ACCOUNT_SCOPE_TTL_MS } = load();
  const cache = new CodexAccountScopeCache(SALT);
  const first = cache.observe(true, 'source', { accountId: 'one' }, 1000)!;
  first.accountScopeKey = 'tampered';
  assert.notEqual(cache.read(true, 'source', 1001)!.accountScopeKey, 'tampered');
  assert.equal(cache.read(true, 'other-source', 1001), null);
  assert.equal(cache.read(true, 'source', 1001), null, 'a source switch revokes the old binding');
  assert.ok(cache.observe(true, 'source', { accountId: 'one' }, 1002));
  assert.equal(cache.read(true, 'source', 1002 + CODEX_ACCOUNT_SCOPE_TTL_MS), null);
  assert.ok(cache.observe(true, 'source', { accountId: 'one' }, 40_000));
  assert.equal(cache.read(true, 'source', 39_999), null, 'clock reversal revokes current eligibility');
});

test('unknown identity, OFF, disconnect and account switch never reuse stale account metadata', () => {
  const { CodexAccountScopeCache } = load();
  const cache = new CodexAccountScopeCache(SALT);
  for (const accountId of [null, undefined, '', ' ', 42, 'x'.repeat(513)]) {
    cache.clear();
    assert.ok(cache.observe(true, 'source', { accountId: 'one' }, 1000));
    assert.equal(cache.observe(true, 'source', { accountId }, 1001), null);
    assert.equal(cache.read(true, 'source', 1001), null);
  }
  cache.clear();
  const one = cache.observe(true, 'source', { accountId: 'one' }, 1000)!;
  const two = cache.observe(true, 'source', { accountId: 'two' }, 1001)!;
  assert.notEqual(one.accountScopeKey, two.accountScopeKey);
  cache.clear();
  assert.equal(cache.read(true, 'source', 1001), null);
  const unreadable = new Proxy({}, { get() { assert.fail('OFF must not read a supplied response'); } });
  assert.equal(cache.observe(false, 'source', unreadable, 1001), null);
  assert.equal(cache.read(false, 'source', 1001), null);
});

test('email, plan, routing hints or matching reset never substitute for official snapshot accountId', () => {
  const { CodexAccountScopeCache } = load();
  const cache = new CodexAccountScopeCache(SALT);
  assert.equal(cache.observe(true, 'source', { account: { type: 'chatgpt', email: 'same', planType: 'pro' },
    workspaceRouting: { chatgptAccountId: 'experimental' }, resetsAt: 9999 }, 1000), null);
  const anotherMachine = new CodexAccountScopeCache(SALT + '-different');
  assert.notEqual(cache.observe(true, 'source', { accountId: 'one' }, 1000)!.accountScopeKey,
    anotherMachine.observe(true, 'source', { accountId: 'one' }, 1000)!.accountScopeKey);
});
