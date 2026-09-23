import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import {
  LOCAL_DATA_ACTION_TARGETS,
  LOCAL_DATA_GLOBAL_STATE_KEYS,
  LOCAL_DATA_GLOBAL_STATE_PREFIXES,
  LOCAL_DATA_SOURCE_EXCLUSIONS,
  approximateJsonBytes,
  finiteTimestampRange,
  groupQuotaAccountEpochs,
  isLocalDataAction,
  shouldClearQuotaObservation,
} from '../localDataControls';
import type {
  LocalDataAction,
  LocalDataInventoryRow,
  LocalDataQuotaScopeOption,
} from '../localDataControls';
import type {
  QuotaObservationStoreV2,
  QuotaObservationV2,
} from '../quotaObservationStore';

const DATA_ACTION_COMMANDS = [
  { action: 'rebuild-codex-index', command: 'claudeCodeUsage.rebuildCodexIndex' },
  { action: 'clear-quota-history', command: 'claudeCodeUsage.clearQuotaHistory' },
  { action: 'clear-advice-data', command: 'claudeCodeUsage.clearAdviceData' },
  { action: 'reset-ui-state', command: 'claudeCodeUsage.resetUiState' },
  { action: 'reset-sharing-preferences', command: 'claudeCodeUsage.resetSharingPreferences' },
  { action: 'clear-byok-secret', command: 'claudeCodeUsage.clearByokSecret' },
  { action: 'clear-all-derived-data', command: 'claudeCodeUsage.clearAllDerivedData' },
] as const satisfies readonly { action: LocalDataAction; command: string }[];

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');

function observation(overrides: Partial<QuotaObservationV2> = {}): QuotaObservationV2 {
  const provider = overrides.provider ?? 'codex';
  return {
    schemaVersion: 2,
    provider,
    accountFingerprint: 'acct-default-private',
    accountAttribution: 'profile-continuity',
    observedAt: 100,
    periodType: 'seven-day',
    usedFraction: 0.25,
    remainingFraction: 0.75,
    resetAt: null,
    source: provider === 'claude'
      ? 'claude-official-api'
      : 'codex-local-structured-event',
    windowId: 'window-fixture',
    providerWindowFingerprint: null,
    confidence: 'medium',
    captureReason: 'refresh',
    flags: [],
    ...overrides,
  };
}

function store(observations: QuotaObservationV2[]): QuotaObservationStoreV2 {
  return {
    schemaVersion: 2,
    fingerprintAlgorithm: 'hmac-sha256-v1',
    observations,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceSlice(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function sourceStringArray(source: string, variableName: string): string[] {
  const match = source.match(new RegExp(
    `var\\s+${escapeRegExp(variableName)}\\s*=\\s*\\[([\\s\\S]*?)\\];`,
  ));
  assert.ok(match, `missing client allowlist: ${variableName}`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

test('local-data action validation accepts exactly the seven declared actions', () => {
  const accepted = DATA_ACTION_COMMANDS.map(({ action }) => action);
  assert.deepEqual(
    Object.keys(LOCAL_DATA_ACTION_TARGETS).sort(),
    [...accepted].sort(),
  );
  for (const action of accepted) {
    assert.equal(isLocalDataAction(action), true, action);
  }

  const rejected: unknown[] = [
    undefined,
    null,
    '',
    ' rebuild-codex-index',
    'rebuild-codex-index ',
    'REBUILD-CODEX-INDEX',
    'clear-provider-logs',
    'clear-all',
    {},
    [],
    new String('reset-ui-state'),
  ];
  for (const candidate of rejected) {
    assert.equal(isLocalDataAction(candidate), false, String(candidate));
  }
});

test('source exclusions and clear-all allowlists cannot target provider logs or credentials', () => {
  const exclusions = LOCAL_DATA_SOURCE_EXCLUSIONS.join('\n');
  assert.match(exclusions, /Claude provider-owned source logs/);
  assert.match(exclusions, /Codex provider-owned source logs/);
  assert.match(exclusions, /provider-owned OAuth credentials and cookies/);

  const clearAllTargets = LOCAL_DATA_ACTION_TARGETS['clear-all-derived-data'].join('\n');
  assert.doesNotMatch(
    clearAllTargets,
    /provider-owned source logs|provider-owned OAuth credentials|provider-owned cookies/i,
  );

  const allowlistedState = new Set<string>([
    ...LOCAL_DATA_GLOBAL_STATE_KEYS,
    ...LOCAL_DATA_GLOBAL_STATE_PREFIXES,
  ]);
  assert.ok(allowlistedState.size > 0);
  for (const key of allowlistedState) {
    assert.match(key, /^ccu\./);
    assert.doesNotMatch(key, /oauth|cookie|provider.?credential|provider.?log/i);
    assert.notEqual(key, 'ccu.', 'a blanket ccu.* prefix is forbidden');
    assert.equal(key.includes('*'), false, 'wildcard deletion is forbidden');
  }
  assert.equal(allowlistedState.has('claudeCodeUsage.dataDirectory'), false);
  assert.equal(allowlistedState.has('claudeCodeUsage.codex.dataDirectory'), false);
});

test('approximateJsonBytes reports UTF-8 JSON bytes and fails closed', () => {
  const value = { label: '额度', count: 3, enabled: true };
  const serialized = JSON.stringify(value);
  assert.equal(
    approximateJsonBytes(value),
    Buffer.byteLength(serialized, 'utf8'),
  );
  assert.equal(approximateJsonBytes(undefined), null);

  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.equal(approximateJsonBytes(circular), null);
  assert.equal(approximateJsonBytes(1n), null);
});

test('finiteTimestampRange filters invalid and negative timestamps', () => {
  assert.deepEqual(
    finiteTimestampRange([
      undefined,
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      42,
      0,
      7,
    ]),
    { oldestAt: 0, newestAt: 42 },
  );
  assert.deepEqual(
    finiteTimestampRange([undefined, null, Number.NaN, -1]),
    { oldestAt: null, newestAt: null },
  );
});

test('quota account epochs group deterministically while public scope fixtures hide fingerprints', () => {
  const observations = [
    observation({
      provider: 'codex',
      accountFingerprint: 'acct-codex-private-canary',
      observedAt: 200,
    }),
    observation({
      provider: 'claude',
      accountFingerprint: 'acct-claude-z-private-canary',
      observedAt: 300,
    }),
    observation({
      provider: 'claude',
      accountFingerprint: 'acct-claude-a-private-canary',
      observedAt: 250,
    }),
    observation({
      provider: 'claude',
      accountFingerprint: 'acct-claude-z-private-canary',
      observedAt: 100,
    }),
  ];

  const grouped = groupQuotaAccountEpochs(store(observations));
  const groupedFromReverseInput = groupQuotaAccountEpochs(store([...observations].reverse()));
  assert.deepEqual(groupedFromReverseInput, grouped);
  assert.deepEqual(grouped, [
    {
      provider: 'claude',
      accountFingerprint: 'acct-claude-a-private-canary',
      itemCount: 1,
      oldestAt: 250,
      newestAt: 250,
    },
    {
      provider: 'claude',
      accountFingerprint: 'acct-claude-z-private-canary',
      itemCount: 2,
      oldestAt: 100,
      newestAt: 300,
    },
    {
      provider: 'codex',
      accountFingerprint: 'acct-codex-private-canary',
      itemCount: 1,
      oldestAt: 200,
      newestAt: 200,
    },
  ]);

  const epochNumber = new Map<'claude' | 'codex', number>();
  const publicOptions: LocalDataQuotaScopeOption[] = grouped.map((epoch) => {
    const number = (epochNumber.get(epoch.provider) ?? 0) + 1;
    epochNumber.set(epoch.provider, number);
    return {
      token: `scope-${epoch.provider}-${number}`,
      label: `${epoch.provider} local anonymous account epoch ${number}`,
      provider: epoch.provider,
      itemCount: epoch.itemCount,
      oldestAt: epoch.oldestAt,
      newestAt: epoch.newestAt,
    };
  });
  for (const option of publicOptions) {
    assert.deepEqual(Object.keys(option).sort(), [
      'itemCount',
      'label',
      'newestAt',
      'oldestAt',
      'provider',
      'token',
    ]);
  }
  const serializedPublicOptions = JSON.stringify(publicOptions);
  assert.doesNotMatch(serializedPublicOptions, /accountFingerprint/);
  assert.doesNotMatch(serializedPublicOptions, /acct-(?:claude|codex)-.*private-canary/);
});

test('shouldClearQuotaObservation applies all, provider, account, and exact scopes', () => {
  const claudeA = observation({
    provider: 'claude',
    accountFingerprint: 'acct-a',
  });
  const claudeB = observation({
    provider: 'claude',
    accountFingerprint: 'acct-b',
  });
  const codexA = observation({
    provider: 'codex',
    accountFingerprint: 'acct-a',
  });

  assert.equal(shouldClearQuotaObservation(claudeA, {}), true);
  assert.equal(shouldClearQuotaObservation(codexA, {}), true);

  assert.equal(shouldClearQuotaObservation(claudeA, { provider: 'claude' }), true);
  assert.equal(shouldClearQuotaObservation(claudeB, { provider: 'claude' }), true);
  assert.equal(shouldClearQuotaObservation(codexA, { provider: 'claude' }), false);

  assert.equal(shouldClearQuotaObservation(claudeA, { accountFingerprint: 'acct-a' }), true);
  assert.equal(shouldClearQuotaObservation(codexA, { accountFingerprint: 'acct-a' }), true);
  assert.equal(shouldClearQuotaObservation(claudeB, { accountFingerprint: 'acct-a' }), false);

  assert.equal(shouldClearQuotaObservation(claudeA, {
    provider: 'claude',
    accountFingerprint: 'acct-a',
  }), true);
  assert.equal(shouldClearQuotaObservation(claudeB, {
    provider: 'claude',
    accountFingerprint: 'acct-a',
  }), false);
  assert.equal(shouldClearQuotaObservation(codexA, {
    provider: 'claude',
    accountFingerprint: 'acct-a',
  }), false);
});

test('source policy keeps controls out of Settings while preserving safe command allowlists', () => {
  const extensionSource = readFileSync(path.join(REPOSITORY_ROOT, 'src', 'extension.ts'), 'utf8');
  const webviewSource = readFileSync(path.join(REPOSITORY_ROOT, 'src', 'webview.ts'), 'utf8');
  const controlsSource = readFileSync(
    path.join(REPOSITORY_ROOT, 'src', 'localDataControls.ts'),
    'utf8',
  );
  const packageJson = JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  ) as { contributes?: { commands?: Array<{ command?: string }> } };
  const contributedCommands = packageJson.contributes?.commands ?? [];
  const setupCommands = sourceSlice(
    extensionSource,
    'private setupCommands',
    'private async derivedFileFamilyNames',
  );
  const settingsDataSurface = sourceSlice(
    webviewSource,
    'private renderLocalDataControls',
    '/** One row in the settings panel',
  );

  assert.doesNotMatch(webviewSource, /html \+= this\.renderLocalDataControls\(\);/);
  for (const { action, command } of DATA_ACTION_COMMANDS) {
    assert.equal(
      contributedCommands.filter((entry) => entry.command === command).length,
      1,
      `${command} must be contributed exactly once`,
    );
    assert.equal(
      setupCommands.split(`registerCommand('${command}'`).length - 1,
      1,
      `${command} must be registered exactly once`,
    );
    const commandHandler = action === 'clear-quota-history'
      ? new RegExp(
        `registerCommand\\('${escapeRegExp(command)}'[\\s\\S]{0,300}?clearQuotaHistoryFromCommandPalette\\(\\)`,
      )
      : new RegExp(
        `registerCommand\\('${escapeRegExp(command)}'[\\s\\S]{0,300}?runLocalDataActionInteractive\\('${escapeRegExp(action)}'\\)`,
      );
    assert.match(setupCommands, commandHandler, `${command} must dispatch ${action}`);
    assert.equal(
      settingsDataSurface.split(`runLocalDataAction(\\'${action}\\')`).length - 1,
      1,
      `${action} must appear exactly once in Settings/Data`,
    );
  }

  const publicRowInterface = controlsSource.match(
    /export interface LocalDataInventoryRow \{([\s\S]*?)\n\}/,
  );
  assert.ok(publicRowInterface);
  assert.doesNotMatch(
    publicRowInterface[1],
    /\b(?:path|fsPath|absolutePath|accountFingerprint)\??\s*:/,
  );

  const inventoryBuilder = sourceSlice(
    extensionSource,
    'private async buildLocalDataInventory',
    'private async clearQuotaHistoryFromCommandPalette',
  );
  assert.doesNotMatch(
    inventoryBuilder,
    /(?:^|[,{]\s*)(?:path|fsPath|absolutePath|accountFingerprint)\s*:/m,
  );
  assert.doesNotMatch(webviewSource, /row\.(?:path|fsPath|absolutePath|accountFingerprint)\b/);

  const publicRow: LocalDataInventoryRow = {
    id: 'P2',
    category: 'Quota observation history',
    locationClass: 'Extension global storage / quota observations',
    schema: 'schema 2',
    approximateBytes: 256,
    itemCount: 2,
    oldestAt: 100,
    newestAt: 200,
    networkInteraction: 'None for this fixture',
    clearability: 'Scoped clear',
  };
  assert.doesNotMatch(JSON.stringify(publicRow), /accountFingerprint|"(?:path|fsPath|absolutePath)"/);
  for (const value of Object.values(publicRow)) {
    if (typeof value === 'string') {
      assert.doesNotMatch(value, /^(?:\/|[A-Za-z]:[\\/])/);
    }
  }

  const uiKeys = sourceStringArray(webviewSource, '__ccuUiPreferenceKeys');
  const sharingKeys = sourceStringArray(webviewSource, '__ccuSharingPreferenceKeys');
  assert.ok(uiKeys.length > 0);
  assert.ok(sharingKeys.length > 0);
  assert.deepEqual(
    uiKeys.filter((key) => sharingKeys.includes(key)),
    [],
    'UI and sharing client allowlists must remain disjoint',
  );
  assert.doesNotMatch(webviewSource, /__ccuSharingSessionKeys|ccu\.sharing\.commandRevision/);
  assert.doesNotMatch(
    LOCAL_DATA_ACTION_TARGETS['reset-sharing-preferences'].join('\n'),
    /ccu\.sharing\.commandRevision/,
  );

  const clearAll = sourceSlice(
    extensionSource,
    'private async clearAllExtensionDerivedData',
    'private async refreshPricing',
  );
  assert.match(clearAll, /resetAllOwnedData\(\)/);
  assert.match(clearAll, /quotaObservationRepository\.clear\(\{\}\)/);
  assert.match(clearAll, /verifyClearAllPostcondition\(\)/);
  assert.match(clearAll, /LOCAL_DATA_EXACT_GLOBAL_STATE_KEYS\.includes/);
  assert.match(clearAll, /LOCAL_DATA_GLOBAL_STATE_PREFIXES\.some/);
  assert.doesNotMatch(clearAll, /key\.startsWith\(\s*['"]ccu\.['"]\s*\)/);
  assert.doesNotMatch(clearAll, /['"]ccu\.\*['"]/);
});
