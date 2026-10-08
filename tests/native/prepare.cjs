'use strict';

// Opt-in staging only. Does not launch Code, install a VSIX, inspect normal
// profiles, set HOME/CODEX_HOME, fetch dependencies or copy real provider logs.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { buildNativeIsolationPlan, nativeLaunchArguments } = require('./isolation.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(reason) { throw new Error('native-test-preparation:' + reason); }
async function regularBytes(file) {
  if (!(await fs.lstat(file)).isFile()) fail('nonregular-source');
  return fs.readFile(file);
}
async function copyTree(source, destination, prefix, filter, inventory, budget) {
  if (!(await fs.lstat(source)).isDirectory()) fail('nonregular-source');
  await fs.mkdir(destination, { recursive: true });
  for (const entry of (await fs.readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (!filter(relative, entry.isDirectory())) continue;
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) fail('nonregular-source');
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, relative, filter, inventory, budget);
    else {
      const bytes = await regularBytes(from);
      budget.files++; budget.bytes += bytes.length;
      if (budget.files > 2000 || budget.bytes > 256 * 1024 ** 2) fail('stage-budget');
      await fs.writeFile(to, bytes, { flag: 'wx' });
      inventory.push({ filename: relative, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
}
async function seedFixtures(plan) {
  const p = plan.directories, hash = createHash('sha256');
  const day = new Date().toISOString().slice(0, 10), start = Date.parse(day + 'T00:00:00.000Z');
  let bytes = 0, files = 0;
  await fs.mkdir(path.join(p.claudeHome, 'projects', 'synthetic-native'), { recursive: true });
  await fs.mkdir(path.join(p.codexHome, 'sessions'), { recursive: true });
  for (let file = 0; file < 3; file++) {
    const id = 'synthetic-native-' + file;
    const claude = [], codex = [
      { timestamp: new Date(start).toISOString(), type: 'session_meta', payload: { id, cwd: p.workspace } },
      { timestamp: new Date(start).toISOString(), type: 'turn_context',
        payload: { model: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'][file], effort: 'max' } },
    ];
    for (let i = 1; i <= 200; i++) {
      const timestamp = new Date(start + i * 1000).toISOString();
      claude.push({ type: 'assistant', timestamp, cwd: p.workspace, sessionId: id,
        requestId: id + '-request-' + i, message: { id: id + '-message-' + i, role: 'assistant',
          model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Synthetic native output.' }],
          usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 500 } } });
      codex.push({ type: 'event_msg', timestamp, payload: { type: 'token_count', info: {
        total_token_usage: { input_tokens: i * 1000, cached_input_tokens: i * 500,
          output_tokens: i * 100, reasoning_output_tokens: i * 25, total_tokens: i * 1100 } } } });
    }
    for (const [target, rows] of [
      [path.join(p.claudeHome, 'projects/synthetic-native', id + '.jsonl'), claude],
      [path.join(p.codexHome, 'sessions', 'rollout-' + file + '.jsonl'), codex],
    ]) {
      const body = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
      const data = Buffer.from(body);
      bytes += data.length; files++; hash.update(data);
      await fs.writeFile(target, data, { flag: 'wx' });
    }
  }
  return { files, bytes, sha256: hash.digest('hex'), clockDayUtc: day,
    meaning: 'six small anonymous synthetic logs, not a large-history or user-crash reproduction' };
}
async function prepareNativeDiagnostic({ repository, sourceHead, mode = 'diagnostic', durationMs = 1800000 } = {}) {
  if (!['diagnostic', 'soak', 'background'].includes(mode)) fail('invalid-input');
  const soak = mode !== 'diagnostic' ? require('./soak.cjs').validateSoakOptions({ durationMs }) : undefined;
  if (typeof repository !== 'string' || !path.isAbsolute(repository) || path.resolve(repository) !== repository ||
      typeof sourceHead !== 'string' || !/^[a-f0-9]{7,40}$/.test(sourceHead)) fail('invalid-input');
  const pkg = JSON.parse((await regularBytes(path.join(repository, 'package.json'))).toString('utf8'));
  if (pkg.name !== 'claude-code-usage' || pkg.publisher !== 'GrowthJack' || typeof pkg.version !== 'string' ||
      pkg.main !== './out/extension.js') fail('invalid-input');
  await regularBytes(path.join(repository, 'out/extension.js'));
  for (const file of ['isolation.cjs', 'bootstrap.cjs', 'runner.cjs']) {
    await regularBytes(path.join(repository, 'tests/native', file));
  }
  // macOS's per-user temp path can exceed the observed 103-character IPC
  // socket limit once Code adds user-data/1.14-main.sock. Use its canonical
  // short temp directory, without altering HOME or the ordinary app profile.
  const temporaryParent = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();
  const root = await fs.realpath(await fs.mkdtemp(path.join(temporaryParent, 'ccu-native-v242-')));
  const plan = buildNativeIsolationPlan(root), p = plan.directories;
  try {
    for (const directory of Object.values(p)) await fs.mkdir(directory);
    const stage = p.developmentExtension, compiledFiles = [], assetFiles = [], budget = { files: 0, bytes: 0 };
    await copyTree(path.join(repository, 'out'), path.join(stage, 'out'), '',
      (relative, directory) => relative !== 'test' && !relative.startsWith('test/') && (directory || relative.endsWith('.js')),
      compiledFiles, budget);
    await copyTree(path.join(repository, 'assets'), path.join(stage, 'assets'), '', () => true, assetFiles, budget);
    for (const [source, target] of [['isolation.cjs', 'native-isolation.cjs'],
      ['bootstrap.cjs', 'native-bootstrap.cjs'], ['runner.cjs', 'native-runner.cjs']]) {
      await fs.writeFile(path.join(stage, target), await regularBytes(path.join(repository, 'tests/native', source)), { flag: 'wx' });
    }
    if (soak) {
      await fs.writeFile(path.join(stage, 'native-soak.cjs'), await regularBytes(path.join(repository, 'tests/native/soak.cjs')), { flag: 'wx' });
      const optionsName = mode === 'background' ? 'native-background-options.json' : 'native-soak-options.json';
      await fs.writeFile(path.join(stage, optionsName), JSON.stringify(soak) + '\n', { flag: 'wx' });
      if (mode === 'background') {
        await fs.writeFile(path.join(stage, 'native-background.cjs'),
          await regularBytes(path.join(repository, 'tests/native/background.cjs')), { flag: 'wx' });
      }
    }
    const stagedPackage = { ...pkg, displayName: 'CCU 2.4.2 Isolated Native Diagnostic',
      main: './native-bootstrap.cjs', activationEvents: ['onStartupFinished'] };
    if (pkg.icon) {
      if (pkg.icon !== 'icon.png') fail('invalid-input');
      await fs.writeFile(path.join(stage, 'icon.png'), await regularBytes(path.join(repository, 'icon.png')), { flag: 'wx' });
    }
    const settings = {
      'claudeCodeUsage.dataDirectory': p.claudeHome, 'claudeCodeUsage.codex.dataDirectory': p.codexHome,
      'claudeCodeUsage.language': 'en', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
      'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'workbench.enableExperiments': false,
      'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
      'window.title': 'CCU 2.4.2 Native Diagnostic — isolated', 'git.enabled': false,
      'chat.disableAIFeatures': true, 'workbench.settings.enableNaturalLanguageSearch': false,
    };
    await fs.mkdir(path.join(p.userData, 'User'));
    const fixture = await seedFixtures(plan), launchArguments = nativeLaunchArguments(plan);
    const manifest = { kind: 'isolated-native-diagnostic-not-final-vsix', sourceHead, nativeTestMode: mode,
      packageVersion: pkg.version, nativeExecuted: false, finalInstallF5Passed: false,
      compiledFiles, assetFiles, fixture, stagedAt: new Date().toISOString() };
    for (const [target, value] of [
      [path.join(stage, 'package.json'), stagedPackage], [path.join(stage, 'native-plan.json'), plan],
      [path.join(p.userData, 'User/settings.json'), settings], [path.join(root, 'launch-plan.json'), { plan, launchArguments }],
      [path.join(root, 'native-stage-manifest.json'), manifest],
    ]) await fs.writeFile(target, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    return Object.freeze({ plan, launchArguments, manifest });
  } catch (error) {
    // Only this function's fresh synthetic mkdtemp is removed on preparation
    // failure; never a caller-specified workspace/profile.
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { prepareNativeDiagnostic };
