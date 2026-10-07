import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// Pure guard tests; this suite never starts Code or reads normal profiles.
function helper(): any {
  return require(path.resolve(__dirname, '../../tests/native/isolation.cjs'));
}
async function owned(t: TestContext): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ccu-native-v242-')));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
async function prepared(t: TestContext): Promise<{ root: string; plan: any; actual: any }> {
  const root = await owned(t), plan = helper().buildNativeIsolationPlan(root);
  for (const directory of Object.values(plan.directories) as string[]) {
    await fs.mkdir(directory, { recursive: true });
  }
  const actual = { extensionMode: 3, userDataPath: plan.directories.userData,
    globalStoragePath: path.join(plan.directories.userData, 'User/globalStorage/growthjack.claude-code-usage'),
    workspaceStoragePath: path.join(plan.directories.userData, 'User/workspaceStorage/test'),
    extensionPath: plan.directories.developmentExtension,
    claudeDataDirectory: plan.directories.claudeHome, codexDataDirectory: plan.directories.codexHome };
  return { root, plan, actual };
}

test('native test isolation plans distinct persistent stores and synthetic sources', async t => {
  const { root, plan } = await prepared(t);
  assert.equal(new Set(Object.values(plan.directories)).size, 10);
  assert.equal(plan.version, 1);
  for (const directory of Object.values(plan.directories) as string[]) {
    assert.ok(directory.startsWith(root + path.sep));
  }
});

test('native test isolation rejects broad, relative and lookalike roots without disclosing them', () => {
  const { buildNativeIsolationPlan } = helper();
  for (const root of ['/', os.homedir(), os.tmpdir(), 'ccu-native-v242-abcdef', '/tmp/not-owned-abcdef']) {
    assert.throws(() => buildNativeIsolationPlan(root), /^Error: native-test-isolation:invalid-root$/);
  }
});

test('native test CLI includes shared and agents stores as well as user and extensions stores', async t => {
  const { plan } = await prepared(t), args: string[] = helper().nativeLaunchArguments(plan);
  for (const [flag, key] of [['--user-data-dir', 'userData'], ['--extensions-dir', 'extensions'],
    ['--shared-data-dir', 'sharedData'], ['--agent-plugins-dir', 'agentPlugins'],
    ['--agents-user-data-dir', 'agentsUserData'], ['--agents-extensions-dir', 'agentsExtensions']]) {
    const at = args.indexOf(flag);
    assert.ok(at >= 0); assert.equal(args[at + 1], plan.directories[key]);
    assert.equal(args.filter(argument => argument === flag).length, 1);
  }
  assert.ok(args.includes('--disable-extensions'));
  assert.ok(args.includes('--disable-updates'));
  assert.ok(args.includes('--disable-telemetry'));
  assert.ok(!args.some(argument => /(^|-)install-extension|publish|sync.*on/.test(argument)));
});

test('native test isolation rejects modified or missing directory plans', async t => {
  const { plan } = await prepared(t), { nativeLaunchArguments } = helper();
  const altered = structuredClone(plan);
  altered.directories.sharedData = '/not-owned/shared';
  assert.throws(() => nativeLaunchArguments(altered), /native-test-isolation:invalid-plan/);
  delete altered.directories.sharedData;
  assert.throws(() => nativeLaunchArguments(altered), /native-test-isolation:invalid-plan/);
});

test('native activation guard proves real paths and Test mode before any setting write', async t => {
  const { plan, actual } = await prepared(t);
  const writes: unknown[] = [], memento = { update: async (...args: unknown[]) => { writes.push(args); } };
  await helper().guardAndSeedNativeActivation(plan, actual, memento);
  assert.ok(writes.length > 0);
  for (const key of ['globalStoragePath', 'workspaceStoragePath', 'extensionPath',
    'userDataPath', 'claudeDataDirectory', 'codexDataDirectory', 'extensionMode']) {
    const changed = { ...actual, [key]: key === 'extensionMode' ? 1 : '/not-owned/location' };
    writes.length = 0;
    await assert.rejects(helper().guardAndSeedNativeActivation(plan, changed, memento),
      /native-test-isolation:(invalid-context|non-test-mode)/);
    assert.equal(writes.length, 0);
  }
});

test('native activation guard rejects symlink escape inside an apparently isolated root', async t => {
  const { root, plan, actual } = await prepared(t);
  const target = path.join(root, 'external-fixture');
  await fs.mkdir(target);
  const link = path.join(plan.directories.userData, 'User');
  await fs.symlink(target, link, 'dir');
  await assert.rejects(helper().assertNativeActivationIsolation(plan, actual),
    /native-test-isolation:symlink-path/);
});

test('native activation guard rejects a symlink root rather than accepting its owned-looking name', async t => {
  const root = await owned(t), linked = root + '-alias';
  await fs.symlink(root, linked, 'dir');
  t.after(async () => { await fs.unlink(linked); });
  const plan = helper().buildNativeIsolationPlan(linked);
  await assert.rejects(helper().assertNativeActivationIsolation(plan, {
    extensionMode: 3, userDataPath: plan.directories.userData,
    globalStoragePath: path.join(plan.directories.userData, 'User/globalStorage/growthjack.claude-code-usage'),
    workspaceStoragePath: path.join(plan.directories.userData, 'User/workspaceStorage/test'),
    extensionPath: plan.directories.developmentExtension,
    claudeDataDirectory: plan.directories.claudeHome, codexDataDirectory: plan.directories.codexHome,
  }), /native-test-isolation:symlink-path/);
});

test('native safety settings are stored before activation, bounded and contain no credential values', async t => {
  const { plan, actual } = await prepared(t), writes = new Map<string, unknown>();
  await helper().guardAndSeedNativeActivation(plan, actual, {
    update: async (key: string, value: unknown) => { writes.set(key, value); },
  });
  assert.equal(writes.get('ccu.setting.usageLimitTracking'), false);
  assert.equal(writes.get('ccu.setting.releaseAnnouncements'), false);
  assert.equal(writes.get('ccu.setting.advice.effectiveness.enabled'), false);
  assert.equal(writes.get('ccu.setting.advice.optimizer.enabled'), false);
  assert.equal(writes.get('ccu.setting.fileWatchSeconds'), '0');
  assert.equal(writes.get('ccu.setting.codex.fileWatchSeconds'), '0');
  assert.equal(writes.get('ccu.setting.enableAchievements'), true);
  assert.ok(writes.size <= 20);
  assert.ok([...writes.keys()].every(key => !/apiKey|secret|token|credential/i.test(key)));
});

test('native safety setup propagates the first storage failure and stops remaining seed writes', async t => {
  const { plan, actual } = await prepared(t); let calls = 0;
  await assert.rejects(helper().guardAndSeedNativeActivation(plan, actual, {
    update: async () => { calls++; throw new Error('synthetic-storage-failure'); },
  }), /synthetic-storage-failure/);
  assert.equal(calls, 1);
});
