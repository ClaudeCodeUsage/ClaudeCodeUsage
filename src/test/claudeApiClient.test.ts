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

const { ClaudeApiClient, resolveClaudeProfile } = loadApiModule();
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
