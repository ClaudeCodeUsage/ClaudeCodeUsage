import { after, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type ApiModule = typeof import('../claudeApiClient');

function loadApiModule(): ApiModule {
  const moduleLoader = require('node:module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const vscodeStub: any = new Proxy(function () {}, {
    get: (_target, property) => property === 'then' ? undefined : vscodeStub,
    apply: () => vscodeStub,
    construct: () => vscodeStub,
  });
  moduleLoader._load = function (request, parent, isMain): unknown {
    if (request === 'vscode') return vscodeStub;
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };
  try {
    return require('../claudeApiClient') as ApiModule;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

const {
  ClaudeApiClient,
  claudeQuotaIdentitySignal,
  resolveClaudeProfile,
} = loadApiModule();
const tempRoots: string[] = [];

after(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('explicit dataDirectory wins over CLAUDE_CONFIG_DIR', () => {
  const resolved = resolveClaudeProfile(
    '/profiles/explicit',
    { CLAUDE_CONFIG_DIR: '/profiles/environment' },
    '/users/test',
    () => true,
  );
  assert.equal(resolved.configDirectory, path.resolve('/profiles/explicit'));
  assert.equal(resolved.source, 'explicit');
  assert.equal(resolved.allowKeychainFallback, false);
});

test('the first valid CLAUDE_CONFIG_DIR entry wins before the default profile', () => {
  const valid = path.resolve('/profiles/valid');
  const resolved = resolveClaudeProfile(
    '',
    { CLAUDE_CONFIG_DIR: `/profiles/missing, ${valid}, /profiles/later` },
    '/users/test',
    (candidate) => candidate === valid,
  );
  assert.equal(resolved.configDirectory, valid);
  assert.equal(resolved.source, 'environment');
  assert.equal(resolved.allowKeychainFallback, false);
});

test('the default profile retains the macOS Keychain fallback', () => {
  const resolved = resolveClaudeProfile('', {}, '/users/test', () => false);
  assert.equal(resolved.configDirectory, path.resolve('/users/test/.claude'));
  assert.equal(resolved.source, 'default');
  assert.equal(resolved.allowKeychainFallback, true);
});

test('quota identity follows refresh-token continuity without exposing the token', () => {
  const first = claudeQuotaIdentitySignal('machine-salt', 'refresh-token-a');
  const repeated = claudeQuotaIdentitySignal('machine-salt', 'refresh-token-a');
  const rotated = claudeQuotaIdentitySignal('machine-salt', 'refresh-token-b');

  assert.equal(first, repeated);
  assert.notEqual(first, rotated);
  assert.equal(first.includes('refresh-token-a'), false);
});

test('successful quota fetch records only the safe account continuity signal', async () => {
  const client = new ClaudeApiClient(null, undefined, 'machine-salt') as any;
  client.getValidCredentials = async () => ({
    claudeAiOauth: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 60_000,
    },
  });
  client.callUsageApi = async () => ({
    status: 200,
    body: JSON.stringify({
      seven_day: {
        utilization: 25,
        resets_at: '2026-09-07T03:24:00.000Z',
      },
    }),
  });

  assert.ok(await client.fetchUsageLimits());
  assert.equal(
    client.getLastQuotaIdentitySignal(),
    claudeQuotaIdentitySignal('machine-salt', 'refresh-token'),
  );
  assert.equal(client.getLastQuotaIdentitySignal().includes('refresh-token'), false);
});

test('a custom profile without a credentials file never falls back to Keychain', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-profile-'));
  tempRoots.push(profile);
  const client = new ClaudeApiClient(null, profile) as any;
  let keychainReads = 0;
  client.loadCredentialsFromKeychain = () => {
    keychainReads += 1;
    return {
      claudeAiOauth: { accessToken: 'wrong-account', refreshToken: 'wrong', expiresAt: Date.now() + 60_000 },
    };
  };

  assert.equal(await client.getAccessToken(), null);
  assert.equal(keychainReads, 0);
});

test('refreshed credentials are written back to the selected profile', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-claude-profile-save-'));
  tempRoots.push(profile);
  const client = new ClaudeApiClient(null, profile) as any;
  const credentials = {
    claudeAiOauth: {
      accessToken: 'selected-access',
      refreshToken: 'selected-refresh',
      expiresAt: Date.now() + 60_000,
    },
  };

  await client.saveCredentials(credentials);

  const stored = JSON.parse(fs.readFileSync(path.join(profile, '.credentials.json'), 'utf8'));
  assert.deepEqual(stored, credentials);
});

test('quota fetch forwards caller cancellation through the active request', async () => {
  const client = new ClaudeApiClient(null) as any;
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  client.getValidCredentials = async () => ({
    claudeAiOauth: {
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      expiresAt: Date.now() + 60_000,
    },
  });
  client.callUsageApi = (_token: string, signal?: AbortSignal) =>
    new Promise((_resolve, reject) => {
      observedSignal = signal;
      signal?.addEventListener(
        'abort',
        () => reject(new Error('Request cancelled')),
        { once: true },
      );
    });

  const pending = client.fetchUsageLimits(controller.signal);
  await Promise.resolve();
  controller.abort();

  assert.equal(await pending, null);
  assert.strictEqual(observedSignal, controller.signal);
  assert.equal(observedSignal?.aborted, true);
});

for (const expired of [false, true]) {
  test(`a failed fresh credential read cannot reuse the previous account (expired=${expired})`, async () => {
    const client = new ClaudeApiClient(null) as any;
    client.credentials = { claudeAiOauth: {
      accessToken: 'synthetic-previous-access', refreshToken: 'synthetic-previous-refresh',
      expiresAt: expired ? 0 : Date.now() + 3600_000,
    } };
    client.loadCredentials = async () => null;
    let refreshes = 0;
    let requests = 0;
    client.refreshAccessToken = async () => { refreshes++; return client.credentials; };
    client.callUsageApi = async () => { requests++; return { status: 200, body: '{}' }; };
    assert.equal(await client.getAccessToken(), null);
    assert.equal(await client.fetchUsageLimits(), null);
    assert.equal(refreshes, 0);
    assert.equal(requests, 0);
  });
}

test('an expired token cannot refresh after the second fresh credential read fails', async () => {
  const client = new ClaudeApiClient(null) as any;
  let reads = 0;
  client.loadCredentials = async () => ++reads === 1 ? { claudeAiOauth: {
    accessToken: 'synthetic-expired', refreshToken: 'synthetic-refresh', expiresAt: 0,
  } } : null;
  let refreshes = 0;
  client.refreshAccessToken = async () => { refreshes++; return null; };
  assert.equal(await client.getAccessToken(), null);
  assert.equal(reads, 2);
  assert.equal(refreshes, 0, 'a failed reread must fail closed');
});

test('consecutive fresh credential reads follow account switches without a new login', async () => {
  const client = new ClaudeApiClient(null, undefined, 'synthetic-salt') as any;
  let account = 'a';
  const requested: string[] = [];
  client.loadCredentials = async () => ({ claudeAiOauth: {
    accessToken: `synthetic-${account}`, refreshToken: `synthetic-refresh-${account}`,
    expiresAt: Date.now() + 3600_000,
  } });
  client.callUsageApi = async (token: string) => {
    requested.push(token);
    return { status: 200, body: '{"seven_day":{"utilization":25}}' };
  };
  for (account of ['a', 'b', 'c']) assert.ok(await client.fetchUsageLimits());
  assert.deepEqual(requested, ['synthetic-a', 'synthetic-b', 'synthetic-c']);
});
