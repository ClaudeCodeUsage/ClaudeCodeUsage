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

type MockRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

const refreshedPayload = { access_token: 'synthetic-new-access', expires_in: 3600 };
const syntheticUsage = { five_hour: { utilization: 12, resets_at: null } };

function refreshFixture(
  responseBody = JSON.stringify(refreshedPayload),
  responseStatus = 200,
) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-issue145-'));
  tempRoots.push(profile);
  const credentialsPath = path.join(profile, '.credentials.json');
  const original = {
    claudeAiOauth: {
      accessToken: 'synthetic-old-access',
      refreshToken: 'synthetic-old-refresh',
      expiresAt: Date.now() - 120_000,
      scopes: ['user:profile', 'user:inference'],
      subscriptionType: 'synthetic-subscription',
    },
    unrelatedMetadata: { retained: true },
  };
  const originalText = JSON.stringify(original);
  fs.writeFileSync(credentialsPath, originalText);
  const client = new ClaudeApiClient(null, profile, 'synthetic-machine-salt') as any;
  // All I/O is confined to this synthetic profile and these mocked boundaries.
  client.loadCredentialsFromKeychain = () => {
    throw new Error('Unexpected Keychain access in synthetic profile test');
  };
  const requests: { url: string; opts: MockRequestOptions }[] = [];
  client.request = async (url: string, opts: MockRequestOptions) => {
    requests.push({ url, opts });
    return opts.method === 'POST'
      ? { status: responseStatus, body: responseBody }
      : { status: 200, body: JSON.stringify(syntheticUsage) };
  };
  let saves = 0;
  const save = client.saveCredentials.bind(client);
  client.saveCredentials = async (credentials: unknown, source?: 'file' | 'keychain' | null) => {
    saves += 1;
    await save(credentials, source);
  };
  return {
    client, original, originalText, credentialsPath, requests,
    get saves() { return saves; },
    read: () => JSON.parse(fs.readFileSync(credentialsPath, 'utf8')),
  };
}

test('issue145: expired getAccessToken posts the public client identity to the current OAuth endpoint', async () => {
  const f = refreshFixture();
  const before = Date.now();
  assert.equal(await f.client.getAccessToken(), refreshedPayload.access_token);
  const after = Date.now();

  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, 'https://platform.claude.com/v1/oauth/token');
  assert.equal(f.requests[0].opts.method, 'POST');
  assert.equal(f.requests[0].opts.headers?.['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(f.requests[0].opts.body!), {
    grant_type: 'refresh_token',
    refresh_token: f.original.claudeAiOauth.refreshToken,
    client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  });
  const stored = f.read();
  assert.equal(f.saves, 1);
  assert.ok(stored.claudeAiOauth.expiresAt >= before + 3_600_000);
  assert.ok(stored.claudeAiOauth.expiresAt <= after + 3_600_000);
  assert.deepEqual(stored, {
    ...f.original,
    claudeAiOauth: {
      ...f.original.claudeAiOauth,
      accessToken: refreshedPayload.access_token,
      expiresAt: stored.claudeAiOauth.expiresAt,
    },
  });
});

test('issue145: refresh rotates credentials and scopes before usage and quota identity are recorded', async () => {
  const f = refreshFixture(JSON.stringify({
    ...refreshedPayload,
    refresh_token: 'synthetic-rotated-refresh',
    scope: '  user:profile\tuser:inference\nuser:sessions  ',
  }));
  assert.deepEqual(await f.client.fetchUsageLimits(), syntheticUsage);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(f.requests[1].opts.method, 'GET');
  assert.equal(f.requests[1].opts.headers?.Authorization, 'Bearer synthetic-new-access');
  const stored = f.read();
  assert.equal(f.saves, 1);
  assert.deepEqual(stored, {
    ...f.original,
    claudeAiOauth: {
      ...f.original.claudeAiOauth,
      accessToken: refreshedPayload.access_token,
      refreshToken: 'synthetic-rotated-refresh',
      scopes: ['user:profile', 'user:inference', 'user:sessions'],
      expiresAt: stored.claudeAiOauth.expiresAt,
    },
  });
  const expectedIdentity = claudeQuotaIdentitySignal('synthetic-machine-salt', 'synthetic-rotated-refresh');
  assert.equal(f.client.getLastQuotaIdentitySignal(), expectedIdentity);
  assert.equal(await f.client.currentQuotaIdentitySignal(), expectedIdentity);
});

test('issue145: omitted optional fields preserve existing refresh token and scopes independently', async (t) => {
  for (const optional of [
    {},
    { refresh_token: 'synthetic-rotation-only' },
    { scope: 'user:sessions' },
    { scope: '' },
  ]) {
    await t.test(JSON.stringify(optional), async () => {
      const f = refreshFixture(JSON.stringify({ ...refreshedPayload, ...optional }));
      assert.equal(await f.client.getAccessToken(), refreshedPayload.access_token);
      const stored = f.read();
      assert.deepEqual(stored, {
        ...f.original,
        claudeAiOauth: {
          ...f.original.claudeAiOauth,
          accessToken: refreshedPayload.access_token,
          refreshToken: 'refresh_token' in optional ? optional.refresh_token : f.original.claudeAiOauth.refreshToken,
          scopes: 'scope' in optional ? (optional.scope ? optional.scope.split(/\s+/) : []) : f.original.claudeAiOauth.scopes,
          expiresAt: stored.claudeAiOauth.expiresAt,
        },
      });
      assert.equal(f.saves, 1);
    });
  }
});

test('issue145: a fresh on-disk token discovered on the expiry re-read bypasses refresh', async () => {
  const f = refreshFixture();
  const fresh = {
    ...f.original,
    claudeAiOauth: { ...f.original.claudeAiOauth, accessToken: 'synthetic-fresh-on-disk', expiresAt: Date.now() + 3_600_000 },
  };
  const load = f.client.loadCredentials.bind(f.client);
  let reads = 0;
  f.client.loadCredentials = async () => {
    const result = await load();
    // Model Claude Code rotating the file between the two real profile reads.
    if (++reads === 1) fs.writeFileSync(f.credentialsPath, JSON.stringify(fresh));
    return result;
  };
  assert.deepEqual(await f.client.fetchUsageLimits(), syntheticUsage);
  assert.equal(reads, 2);
  assert.equal(f.saves, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].opts.method, 'GET');
  assert.equal(f.requests[0].opts.headers?.Authorization, 'Bearer synthetic-fresh-on-disk');
  assert.deepEqual(f.read(), fresh);
});

test('issue145: HTTP 400 preserves credentials and prevents the usage request', async () => {
  const f = refreshFixture(JSON.stringify({ error: 'invalid_grant' }), 400);
  assert.equal(await f.client.fetchUsageLimits(), null);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].opts.method, 'POST');
  assert.equal(f.saves, 0);
  assert.equal(fs.readFileSync(f.credentialsPath, 'utf8'), f.originalText);
  assert.equal(f.client.getLastQuotaIdentitySignal(), null);
});

test('issue145: malformed refresh payloads never persist credentials or request usage', async (t) => {
  const invalid: [string, string][] = [
    ['invalid JSON', '{'],
    ['null payload', 'null'],
    ['array payload', '[]'],
    ['missing access token', JSON.stringify({ expires_in: 3600 })],
    ...['', ' \t\n ', 42, null, {}, []].map((access_token): [string, string] => [
      `invalid access token ${JSON.stringify(access_token)}`,
      JSON.stringify({ ...refreshedPayload, access_token }),
    ]),
    ['missing expiry', JSON.stringify({ access_token: 'synthetic-new-access' })],
    ...[0, -1, '3600', null, true, 1e308, 1e20].map((expires_in): [string, string] => [
      `invalid expiry ${JSON.stringify(expires_in)}`,
      JSON.stringify({ ...refreshedPayload, expires_in }),
    ]),
    ['infinite expiry', '{"access_token":"synthetic-new-access","expires_in":1e309}'],
    ...['', ' \t\n ', 42, null, {}, []].map((refresh_token): [string, string] => [
      `invalid refresh token ${JSON.stringify(refresh_token)}`,
      JSON.stringify({ ...refreshedPayload, refresh_token }),
    ]),
    ...[42, null, {}, []].map((scope): [string, string] => [
      `invalid scope ${JSON.stringify(scope)}`,
      JSON.stringify({ ...refreshedPayload, scope }),
    ]),
  ];
  for (const [name, body] of invalid) {
    await t.test(name, async () => {
      const f = refreshFixture(body);
      const result = await f.client.fetchUsageLimits();
      // Check persistence first: a later usage failure must not hide a bad save.
      assert.equal(f.saves, 0);
      assert.equal(fs.readFileSync(f.credentialsPath, 'utf8'), f.originalText);
      assert.equal(result, null);
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].opts.method, 'POST');
      assert.equal(f.client.getLastQuotaIdentitySignal(), null);
    });
  }
});

test('issue145: malformed refresh JSON never leaks token fragments into diagnostic logs', async () => {
  const sensitiveToken = 'synthetic-sensitive-refresh-response';
  const f = refreshFixture(`{"access_token":"${sensitiveToken}`);
  const logs: string[] = [];
  f.client.out = { appendLine: (line: string) => logs.push(line) };
  assert.equal(await f.client.fetchUsageLimits(), null);
  assert.equal(f.saves, 0);
  assert.equal(fs.readFileSync(f.credentialsPath, 'utf8'), f.originalText);
  assert.equal(f.requests.length, 1);
  assert.ok(logs.length > 0);
  assert.equal(logs.join('\n').includes(sensitiveToken), false);
  assert.equal(logs.join('\n').includes('access_token'), false);
});

test('issue145: cancellation before refresh, on response, or during response decoding never saves or requests usage', async (t) => {
  for (const phase of ['before refresh', 'on response', 'during response decoding']) {
    await t.test(phase, async () => {
      const f = refreshFixture();
      const controller = new AbortController();
      const request = f.client.request.bind(f.client);
      f.client.request = async (url: string, opts: MockRequestOptions) => {
        const response = await request(url, opts);
        assert.strictEqual(opts.signal, controller.signal);
        if (phase === 'on response') controller.abort();
        if (phase === 'during response decoding') {
          return { status: response.status, get body() {
            controller.abort();
            return response.body;
          } };
        }
        return response;
      };
      if (phase === 'before refresh') controller.abort();
      assert.equal(await f.client.fetchUsageLimits(controller.signal), null);
      assert.equal(f.saves, 0);
      assert.equal(fs.readFileSync(f.credentialsPath, 'utf8'), f.originalText);
      assert.equal(f.requests.length, phase === 'before refresh' ? 0 : 1);
      assert.equal(f.client.getLastQuotaIdentitySignal(), null);
    });
  }
});

test('issue145: refresh pins the original file source while another read changes the cached source', async () => {
  const f = refreshFixture();
  const request = f.client.request.bind(f.client);
  f.client.request = async (url: string, opts: MockRequestOptions) => {
    assert.equal(f.client.credentialsSource, 'file');
    f.client.credentialsSource = 'keychain';
    return request(url, opts);
  };
  const saves: { credentials: any; source: unknown }[] = [];
  // Do not invoke the real saver with the deliberately changed Keychain source.
  f.client.saveCredentials = async (credentials: unknown, source?: unknown) => {
    saves.push({ credentials, source });
  };
  assert.equal(await f.client.getAccessToken(), refreshedPayload.access_token);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].source, 'file');
  assert.equal(saves[0].credentials.claudeAiOauth.accessToken, refreshedPayload.access_token);
  assert.equal(fs.readFileSync(f.credentialsPath, 'utf8'), f.originalText);
});

test('issue145: a failed Keychain write rejects without spilling credentials into the profile file', {
  skip: process.platform !== 'darwin' ? 'macOS Keychain write path' : false,
}, async () => {
  const f = refreshFixture();
  const childProcess = require('node:child_process') as typeof import('node:child_process');
  const originalExec = childProcess.execFileSync;
  let writes = 0;
  childProcess.execFileSync = (() => {
    writes += 1;
    throw new Error('Synthetic Keychain write failure');
  }) as typeof childProcess.execFileSync;
  f.client.credentialsSource = 'keychain';
  try {
    await assert.rejects(f.client.saveCredentials(f.original), {
      message: 'Credential refresh could not be saved to macOS Keychain',
    });
    assert.equal(writes, 1);
    assert.equal(fs.readFileSync(f.credentialsPath, 'utf8'), f.originalText);
  } finally {
    childProcess.execFileSync = originalExec;
  }
});
