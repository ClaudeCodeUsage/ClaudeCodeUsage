'use strict';

// Opt-in native-test safety guard, not production extension code.
// No launch, global profile discovery, credential read or network in this module.
const fs = require('node:fs/promises');
const path = require('node:path');
const directories = Object.freeze({
  userData: 'user-data', extensions: 'extensions', sharedData: 'shared-data',
  agentPlugins: 'agent-plugins', agentsUserData: 'agents-user-data',
  agentsExtensions: 'agents-extensions', workspace: 'workspace',
  developmentExtension: 'development-extension', claudeHome: 'claude-home',
  codexHome: 'codex-home',
});
function fail(reason) { throw new Error('native-test-isolation:' + reason); }
function buildNativeIsolationPlan(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) ||
      path.resolve(root) !== root || !/^ccu-native-v242-[a-zA-Z0-9-]{6,64}$/.test(path.basename(root))) {
    fail('invalid-root');
  }
  return Object.freeze({ version: 1, root, directories: Object.freeze(
    Object.fromEntries(Object.entries(directories).map(([key, name]) => [key, path.join(root, name)])),
  ) });
}
function validate(plan) {
  let expected;
  try { expected = buildNativeIsolationPlan(plan?.root); } catch { fail('invalid-plan'); }
  if (plan.version !== 1 || Object.keys(plan).sort().join('|') !== 'directories|root|version' ||
      !plan.directories || Object.keys(plan.directories).sort().join('|') !== Object.keys(directories).sort().join('|') ||
      Object.keys(directories).some(key => plan.directories[key] !== expected.directories[key])) {
    fail('invalid-plan');
  }
  return expected;
}
function nativeLaunchArguments(plan) {
  const p = validate(plan).directories;
  return ['--new-window', '--disable-extensions', '--disable-updates', '--disable-telemetry',
    '--use-inmemory-secretstorage', '--skip-add-to-recently-opened',
    '--disable-crash-reporter', '--disable-experiments',
    '--sync', 'off',
    '--disable-workspace-trust', '--skip-release-notes', '--skip-welcome',
    '--user-data-dir', p.userData, '--extensions-dir', p.extensions,
    '--shared-data-dir', p.sharedData, '--agent-plugins-dir', p.agentPlugins,
    '--agents-user-data-dir', p.agentsUserData, '--agents-extensions-dir', p.agentsExtensions,
    '--extensionDevelopmentPath', p.developmentExtension,
    '--extensionTestsPath', path.join(p.developmentExtension, 'native-runner.cjs'), p.workspace];
}
function within(directory, candidate) {
  return typeof candidate === 'string' && path.isAbsolute(candidate) &&
    path.resolve(candidate) === candidate && (candidate === directory || candidate.startsWith(directory + path.sep));
}
async function noSymlinks(root, candidate) {
  if (!within(root, candidate)) fail('invalid-context');
  const suffix = path.relative(root, candidate).split(path.sep).filter(Boolean);
  let current = root;
  for (const component of ['', ...suffix]) {
    if (component) current = path.join(current, component);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) fail('symlink-path');
      if (!stat.isDirectory()) fail('invalid-context');
    } catch (error) {
      if (error.code === 'ENOENT') break; // Host-managed child storage may not exist yet.
      throw error;
    }
  }
}
async function assertNativeActivationIsolation(plan, actual) {
  const p = validate(plan).directories;
  if (actual?.extensionMode !== 3) fail('non-test-mode');
  if (actual.userDataPath !== p.userData || actual.extensionPath !== p.developmentExtension ||
      actual.claudeDataDirectory !== p.claudeHome || actual.codexDataDirectory !== p.codexHome ||
      !within(path.join(p.userData, 'User/globalStorage'), actual.globalStoragePath) ||
      !within(path.join(p.userData, 'User/workspaceStorage'), actual.workspaceStoragePath)) {
    fail('invalid-context');
  }
  await noSymlinks(plan.root, plan.root);
  for (const directory of Object.values(p)) {
    await noSymlinks(plan.root, directory);
    if (!(await fs.lstat(directory)).isDirectory()) fail('invalid-context');
  }
  for (const key of ['globalStoragePath', 'workspaceStoragePath']) {
    await noSymlinks(plan.root, actual[key]);
  }
}
const safeSeed = Object.freeze({
  'ccu.setting.usageLimitTracking': false,
  'ccu.setting.releaseAnnouncements': false,
  'ccu.setting.advice.effectiveness.enabled': false,
  'ccu.setting.advice.optimizer.enabled': false,
  'ccu.setting.fileWatchSeconds': '0',
  'ccu.setting.codex.fileWatchSeconds': '0',
  'ccu.setting.refreshInterval': 60,
  'ccu.setting.dashboardAutoRefresh': true,
  'ccu.setting.enableContentAnalysis': true,
  'ccu.setting.enableAchievements': true,
  'ccu.setting.codex.enabled': true,
  'ccu.setting.timezone': 'UTC',
});
async function guardAndSeedNativeActivation(plan, actual, globalState) {
  await assertNativeActivationIsolation(plan, actual);
  if (typeof globalState?.update !== 'function') fail('invalid-context');
  for (const [key, value] of Object.entries(safeSeed)) await globalState.update(key, value);
}
module.exports = { buildNativeIsolationPlan, nativeLaunchArguments,
  assertNativeActivationIsolation, guardAndSeedNativeActivation };
