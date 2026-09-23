import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

type SettingsModule = typeof import('../settings');

interface FakeConfiguration {
  values: {
    global?: unknown;
    workspace?: unknown;
    folder?: unknown;
  };
  updates: Array<{ key: string; value: unknown; target: number }>;
  get<T>(key: string, fallback: T): T;
  inspect<T>(key: string): {
    globalValue?: T;
    workspaceValue?: T;
    workspaceFolderValue?: T;
  };
  update(key: string, value: unknown, target: number): Promise<void>;
}

function fakeConfiguration(initial: FakeConfiguration['values'] = {}): FakeConfiguration {
  const config: FakeConfiguration = {
    values: { ...initial },
    updates: [],
    get<T>(_key: string, fallback: T): T {
      return (config.values.folder ?? config.values.workspace ?? config.values.global ?? fallback) as T;
    },
    inspect<T>(_key: string) {
      return {
        globalValue: config.values.global as T | undefined,
        workspaceValue: config.values.workspace as T | undefined,
        workspaceFolderValue: config.values.folder as T | undefined,
      };
    },
    async update(key: string, value: unknown, target: number): Promise<void> {
      config.updates.push({ key, value, target });
      const slot = target === 3 ? 'folder' : target === 2 ? 'workspace' : 'global';
      config.values[slot] = value;
    },
  };
  return config;
}

let activeConfiguration = fakeConfiguration();
let activeWorkspaceFolders: Array<{ uri: string }> = [];
let activeFolderConfigurations = new Map<string, FakeConfiguration>();

function loadSettingsModule(): SettingsModule {
  const moduleLoader = require('node:module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain): unknown {
    if (request === 'vscode') {
      return {
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        workspace: {
          get workspaceFolders() { return activeWorkspaceFolders; },
          getConfiguration: (_section: string, resource?: string) =>
            resource ? activeFolderConfigurations.get(resource) ?? activeConfiguration : activeConfiguration,
        },
      };
    }
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };
  try {
    return require('../settings') as SettingsModule;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

const { SettingsStore } = loadSettingsModule();

function fakeContext(options: {
  state?: Map<string, unknown>;
  secrets?: Map<string, string>;
  failSecretStore?: boolean;
} = {}): any {
  const state = options.state ?? new Map<string, unknown>();
  const secrets = options.secrets ?? new Map<string, string>();
  const secretStores: Array<{ key: string; value: string }> = [];
  const secretDeletes: string[] = [];
  return {
    globalState: {
      get: <T>(key: string, fallback?: T): T | undefined =>
        (state.has(key) ? state.get(key) : fallback) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        if (value === undefined) state.delete(key);
        else state.set(key, value);
      },
    },
    secrets: {
      get: async (key: string): Promise<string | undefined> => secrets.get(key),
      store: async (key: string, value: string): Promise<void> => {
        if (options.failSecretStore) throw new Error('synthetic secret-store failure');
        secretStores.push({ key, value });
        secrets.set(key, value);
      },
      delete: async (key: string): Promise<void> => {
        secretDeletes.push(key);
        secrets.delete(key);
      },
    },
    _state: state,
    _secrets: secrets,
    _secretStores: secretStores,
    _secretDeletes: secretDeletes,
  };
}

test('local currency selection normalizes before entering global state', async () => {
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext();
  const store = new SettingsStore(context);

  await store.set('displayCurrency', ' eur ');
  assert.equal(context._state.get('ccu.setting.displayCurrency'), 'EUR');

  await store.set('displayCurrency', '<img onerror=x>');
  assert.equal(context._state.get('ccu.setting.displayCurrency'), 'USD');
  assert.equal(store.snapshot().some((entry) => entry.key === 'usdConversionRate'), false);
});

test('early test-build currency state migrates to one preset and drops its manual rate', async () => {
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext({
    state: new Map<string, unknown>([
      ['ccu.setting.displayCurrency', ' eur '],
      ['ccu.setting.usdConversionRate', 0.92],
    ]),
  });
  const store = new SettingsStore(context);

  assert.equal(store.get('displayCurrency'), 'EUR');
  await store.migrateCurrencyPreset();

  assert.equal(context._state.get('ccu.setting.displayCurrency'), 'EUR');
  assert.equal(context._state.has('ccu.setting.usdConversionRate'), false);
  assert.equal(context._state.get('ccu.migrated.currencyPreset.v2.3.2'), true);
});

test('legacy plaintext BYOK migrates to SecretStorage and never enters a settings snapshot', async () => {
  const canary = 'sk-v2.3.1-privacy-canary';
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext({
    state: new Map([['ccu.setting.advice.apiKey', canary]]),
  });
  const store = new SettingsStore(context);

  await store.initializeSecrets();

  assert.equal(context._secrets.get('claudeCodeUsage.secret.advice.apiKey'), canary);
  assert.equal(context._state.has('ccu.setting.advice.apiKey'), false);
  assert.equal(activeConfiguration.updates.length, 0);
  assert.equal(store.get('advice.apiKey'), canary, 'the extension host can still use the key');
  const apiKeyView = store.snapshot().find((entry) => entry.key === 'advice.apiKey');
  assert.equal(apiKeyView?.configured, true);
  assert.equal(apiKeyView?.value, '');
  assert.doesNotMatch(JSON.stringify(store.snapshot()), /v2\.3\.1-privacy-canary/);
});

test('legacy settings.json secrets fail closed because the key is no longer registered', async () => {
  activeConfiguration = fakeConfiguration({
    global: 'sk-global-canary',
    workspace: 'sk-workspace-canary',
  });
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext();
  const store = new SettingsStore(context);

  await assert.rejects(
    () => store.initializeSecrets(),
    /settings-secret-migration:workspace-secret-requires-manual-migration/,
  );

  assert.equal(context._secrets.size, 0);
  assert.equal(activeConfiguration.values.global, 'sk-global-canary');
  assert.equal(activeConfiguration.values.workspace, 'sk-workspace-canary');
  assert.equal(activeConfiguration.updates.length, 0);
});

test('workspace-only secrets require explicit migration and every open folder is inspected', async () => {
  activeConfiguration = fakeConfiguration();
  const first = fakeConfiguration({ folder: 'sk-folder-one' });
  const second = fakeConfiguration({ folder: 'sk-folder-two' });
  activeWorkspaceFolders = [{ uri: 'folder-a' }, { uri: 'folder-b' }];
  activeFolderConfigurations = new Map([
    ['folder-a', first],
    ['folder-b', second],
  ]);
  const context = fakeContext();
  const store = new SettingsStore(context);

  await assert.rejects(
    () => store.initializeSecrets(),
    /settings-secret-migration:workspace-secret-requires-manual-migration/,
  );
  assert.equal(first.values.folder, 'sk-folder-one');
  assert.equal(second.values.folder, 'sk-folder-two');
  assert.equal(context._secrets.size, 0);
});

test('activation can continue without a BYOK key when workspace plaintext needs manual migration', async () => {
  const canary = 'sk-workspace-activation-canary';
  activeConfiguration = fakeConfiguration({ workspace: canary });
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext();
  const store = new SettingsStore(context);

  assert.equal(
    await store.initializeSecretsForActivation(),
    'workspace-secret-requires-manual-migration',
  );
  assert.equal(store.get('advice.apiKey'), '', 'advice stays disabled until the user migrates the key');
  assert.equal(store.snapshot().find((entry) => entry.key === 'advice.apiKey')?.configured, false);
  assert.equal(activeConfiguration.values.workspace, canary, 'the original key remains recoverable');
  assert.equal(context._secrets.size, 0, 'the workspace key is not copied to global SecretStorage');
  assert.equal(activeConfiguration.updates.length, 0);
});

test('activation loads an existing SecretStorage key when no legacy plaintext remains', async () => {
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext({ secrets: new Map([['claudeCodeUsage.secret.advice.apiKey', 'sk-existing-canary']]) });
  const store = new SettingsStore(context);

  assert.equal(await store.initializeSecretsForActivation(), null);
  assert.equal(store.get('advice.apiKey'), 'sk-existing-canary');
  assert.equal(store.snapshot().find((entry) => entry.key === 'advice.apiKey')?.configured, true);
});

test('activation continues when SecretStorage is unavailable', async () => {
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext();
  context.secrets = undefined;
  const store = new SettingsStore(context);

  assert.equal(await store.initializeSecretsForActivation(), 'secret-storage-unavailable');
  assert.equal(store.get('advice.apiKey'), '');
});

test('activation continues after SecretStorage failure without retaining a stale BYOK key', async () => {
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext({ state: new Map([['ccu.setting.advice.apiKey', 'sk-recovery-canary']]) });
  const store = new SettingsStore(context);
  await store.set('advice.apiKey', 'sk-previous-session-canary');
  context.secrets.store = async () => { throw new Error('synthetic provider detail'); };
  context.secrets.delete = async () => { throw new Error('synthetic provider detail'); };
  context._secrets.clear();

  assert.equal(await store.initializeSecretsForActivation(), 'secret-storage-failed');
  assert.equal(store.get('advice.apiKey'), '');
  assert.equal(context._state.get('ccu.setting.advice.apiKey'), 'sk-recovery-canary');
  assert.doesNotMatch(JSON.stringify(store.snapshot()), /recovery-canary|previous-session-canary/);
});

test('failed SecretStorage migration leaves legacy plaintext in place for recovery', async () => {
  const canary = 'sk-recovery-canary';
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext({
    state: new Map([['ccu.setting.advice.apiKey', canary]]),
    failSecretStore: true,
  });
  const store = new SettingsStore(context);

  await assert.rejects(
    () => store.initializeSecrets(),
    (error: unknown) => {
      assert.match(String(error), /settings-secret-migration:secret-storage-failed/);
      assert.doesNotMatch(String(error), /recovery-canary|synthetic secret-store failure/);
      return true;
    },
  );
  assert.equal(context._state.get('ccu.setting.advice.apiKey'), canary);
  assert.equal(activeConfiguration.values.global, undefined);
});

test('BYOK set and reset use only SecretStorage', async () => {
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext();
  const store = new SettingsStore(context);

  await store.set('advice.apiKey', '  sk-runtime-canary  ');
  assert.equal(store.get('advice.apiKey'), 'sk-runtime-canary');
  assert.equal(context._secrets.get('claudeCodeUsage.secret.advice.apiKey'), 'sk-runtime-canary');
  assert.equal(context._state.size, 0);
  assert.equal(activeConfiguration.updates.length, 0);

  await store.reset('advice.apiKey');
  assert.equal(store.get('advice.apiKey'), '');
  assert.equal(context._secrets.size, 0);
});

test('clear-all settings uses the exact catalog across current scopes and preserves unrelated state', async () => {
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext({
    state: new Map<string, unknown>([
      ['ccu.setting.showCost', true],
      ['ccu.setting.pauseDashboardRefresh', true],
      ['ccu.setting.fileWatching', true],
      ['ccu.setting.advice.backend', 'subscription'],
      ['ccu.setting.advice.subscriptionModel', 'legacy-model'],
      ['ccu.unrelated.canary', 'preserve'],
    ]),
    secrets: new Map([['claudeCodeUsage.secret.advice.apiKey', 'secret-canary']]),
  });
  const store = new SettingsStore(context);

  await store.resetAllOwnedData();

  assert.equal(context._state.has('ccu.setting.showCost'), false);
  assert.equal(context._state.has('ccu.setting.pauseDashboardRefresh'), false);
  assert.equal(context._state.has('ccu.setting.fileWatching'), false);
  assert.equal(context._state.has('ccu.setting.advice.backend'), false);
  assert.equal(context._state.has('ccu.setting.advice.subscriptionModel'), false);
  assert.equal(context._state.get('ccu.unrelated.canary'), 'preserve');
  assert.equal(context._secrets.size, 0);
  assert.ok(context._secretDeletes.includes('claudeCodeUsage.secret.advice.apiKey'));
  assert.equal(activeConfiguration.updates.length, 0);
});

test('BYOK and sharing resets clear only their exact owned stores and visible scopes', async () => {
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext({
    state: new Map<string, unknown>([
      ['ccu.setting.advice.apiKey', 'legacy-state-canary'],
      ['ccu.setting.showHeatmap', true],
      ['ccu.setting.enableShareCard', true],
      ['ccu.setting.showCost', true],
    ]),
    secrets: new Map([['claudeCodeUsage.secret.advice.apiKey', 'secret-canary']]),
  });
  const store = new SettingsStore(context);

  await store.clearByokOwnedData();
  assert.equal(context._secrets.has('claudeCodeUsage.secret.advice.apiKey'), false);
  assert.equal(context._state.has('ccu.setting.advice.apiKey'), false);
  assert.equal(context._state.get('ccu.setting.showHeatmap'), true);

  await store.resetSharingOwnedData();
  assert.equal(context._state.has('ccu.setting.showHeatmap'), false);
  assert.equal(context._state.has('ccu.setting.enableShareCard'), false);
  assert.equal(context._state.get('ccu.setting.showCost'), true);
  assert.equal(activeConfiguration.updates.length, 0);
});

test('unregistered legacy configuration blocks a clear before state or SecretStorage changes', async () => {
  activeConfiguration = fakeConfiguration({ global: 'legacy-plaintext-canary' });
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext({
    state: new Map([['ccu.setting.advice.apiKey', 'legacy-state-canary']]),
    secrets: new Map([['claudeCodeUsage.secret.advice.apiKey', 'secret-canary']]),
  });
  const store = new SettingsStore(context);

  await assert.rejects(
    () => store.clearByokOwnedData(),
    /settings-local-data-clear:legacy-configuration-requires-manual-removal/,
  );
  assert.equal(context._state.get('ccu.setting.advice.apiKey'), 'legacy-state-canary');
  assert.equal(context._secrets.get('claudeCodeUsage.secret.advice.apiKey'), 'secret-canary');
  assert.equal(activeConfiguration.updates.length, 0);
});

test('registered configuration clear updates only explicit valid scopes', async () => {
  activeConfiguration = fakeConfiguration({
    global: '/global/claude',
    workspace: '/workspace/claude',
  });
  const first = fakeConfiguration({ folder: '/folder/claude' });
  activeWorkspaceFolders = [{ uri: 'folder-a' }];
  activeFolderConfigurations = new Map([['folder-a', first]]);
  const store = new SettingsStore(fakeContext());

  await store.resetOwnedSettings(['dataDirectory']);

  assert.deepEqual(activeConfiguration.updates.map((entry) => entry.target).sort(), [1, 2]);
  assert.deepEqual(first.updates.map((entry) => entry.target), [3]);
  assert.ok([...activeConfiguration.updates, ...first.updates].every((entry) =>
    entry.key === 'dataDirectory' && entry.value === undefined,
  ));
});

test('registered global configuration clear does not write a workspace target in an empty window', async () => {
  activeConfiguration = fakeConfiguration({ global: '/global/claude' });
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const store = new SettingsStore(fakeContext());

  await store.resetOwnedSettings(['dataDirectory']);

  assert.deepEqual(activeConfiguration.updates, [{
    key: 'dataDirectory',
    value: undefined,
    target: 1,
  }]);
});

test('repeat activation is idempotent and secret metadata is independent of key length', async () => {
  activeConfiguration = fakeConfiguration();
  activeWorkspaceFolders = [];
  activeFolderConfigurations = new Map();
  const context = fakeContext({
    secrets: new Map([['claudeCodeUsage.secret.advice.apiKey', 'sk-short']]),
  });
  const store = new SettingsStore(context);

  await store.initializeSecrets();
  const shortView = store.snapshot().find((entry) => entry.key === 'advice.apiKey');
  await store.initializeSecrets();
  await store.set('advice.apiKey', 'sk-a-much-longer-secret-value');
  const longView = store.snapshot().find((entry) => entry.key === 'advice.apiKey');

  assert.deepEqual(shortView, longView);
  assert.deepEqual(shortView && { value: shortView.value, configured: shortView.configured }, {
    value: '',
    configured: true,
  });
  assert.equal(context._secretStores.length, 1, 'only the explicit user edit writes SecretStorage');
  assert.equal(activeConfiguration.updates.length, 0);
});

test('the extension manifest no longer contributes a plaintext API-key setting', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as any;
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      manifest.contributes.configuration.properties,
      'claudeCodeUsage.advice.apiKey',
    ),
    false,
  );
});

test('activation reports a fixed localized migration failure without echoing provider errors', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'extension.ts'), 'utf8');
  const activation = source.slice(source.indexOf('export async function activate('));
  assert.match(activation, /initializeSecretsForActivation\(\)/);
  assert.match(activation, /void vscode\.window\.showWarningMessage\([\s\S]*secretMigrationWorkspace[\s\S]*secretMigrationFailed/);
  assert.doesNotMatch(activation, /await vscode\.window\.showWarningMessage/);
  assert.doesNotMatch(activation, /secretMigrationFailed[^;]*\.message/);
});

test('the tracked bilingual data contract covers quota, retention, clearing, and remote boundaries', () => {
  const root = path.join(__dirname, '..', '..');
  const documents = [
    'docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.md',
    'docs/superpowers/specs/2026-09-02-v2.3.1-local-data-contract.zh-CN.md',
  ].map((relative) => fs.readFileSync(path.join(root, relative), 'utf8'));

  for (const document of documents) {
    for (const required of [
      'schemaVersion',
      'provider',
      'accountFingerprint',
      'observedAt',
      'periodType',
      'usedFraction',
      'remainingFraction',
      'resetAt',
      'source',
      'windowId',
      'confidence',
      'SecretStorage',
      '180',
      '512',
      'ccu.heatmapRepo',
      'ccu.heatmapPath',
      'ccu.heatmapDestination.v1',
      'ccu.sharing.template',
      'enableShareCard',
      'showHeatmap',
      'ccu.combinedHeatmap.title',
      'ccu.combinedHeatmap.range',
      'ccu.combinedHeatmap.privacyPreview',
      'ccu.combinedHeatmap.intensityMode',
      'ccu.combinedHeatmap.palette',
      'ccu.combinedHeatmap.customAccent',
      'Codex processed',
      'public_repo',
    ]) {
      assert.match(document, new RegExp(required.replace('.', '\\.')));
    }
    assert.match(document, /OAuth token/i);
    assert.match(document, /cookie/i);
    assert.match(document, /API key/i);
    assert.match(document, /clear|清除/i);
    assert.match(document, /remote|network|远程|网络/i);
  }
});

test('GitHub heatmap publication is public-only, exact-target confirmed, and atomically persists its destination after success', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'extension.ts'), 'utf8');
  const start = source.indexOf('private async publishHeatmapToGitHub');
  const end = source.indexOf('private async getAdvice', start);
  const publish = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(publish, /GITHUB_PUBLIC_REPO_SCOPE/);
  assert.doesNotMatch(publish, /\['repo'\]/);
  assert.match(publish, /probePublicGitHubPublishTarget/);
  assert.match(publish, /githubPublishConfirmationDetail/);
  assert.match(publish, /Confirm the exact GitHub write/);
  const write = publish.indexOf('publishPublicGitHubFile');
  const complete = publish.indexOf('completeSuccessfulGitHubPublish');
  assert.ok(write >= 0 && complete > write);
  assert.match(publish, /globalState\.update\(key, destination\)/);
  assert.doesNotMatch(publish.slice(write), /globalState\.update\('ccu\.heatmap(?:Repo|Path)'/);
  assert.match(publish, /publishPreferenceSaveWarning/);
});

test('reset sharing preferences host step clears only sharing-owned state and remembered GitHub destination', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'extension.ts'), 'utf8');
  const start = source.indexOf('private async resetSharingPreferencesHost');
  const end = source.indexOf('private pendingClientReset', start);
  const reset = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(reset, /settings\.resetSharingOwnedData\(\)/);
  assert.match(reset, /globalState\.update\(GITHUB_HEATMAP_DESTINATION_KEY, undefined\)/);
  assert.match(reset, /globalState\.update\('ccu\.heatmapRepo', undefined\)/);
  assert.match(reset, /globalState\.update\('ccu\.heatmapPath', undefined\)/);
  assert.doesNotMatch(reset, /quota|index|secret|token|cookie|log/i);
});
