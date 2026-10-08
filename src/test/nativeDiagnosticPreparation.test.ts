import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// Preparation-only tests: no native launch, real credentials or normal profiles.
function preparation(): any { return require(path.resolve(__dirname, '../../tests/native/prepare.cjs')); }
async function fixture(t: TestContext): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ccu-native-source-')));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.join(root, 'out/test'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets/achievements'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests/native'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'claude-code-usage', publisher: 'GrowthJack', version: '2.1.1', main: './out/extension.js',
  }));
  await fs.writeFile(path.join(root, 'out/extension.js'), "exports.activate = async () => {};\n");
  await fs.writeFile(path.join(root, 'out/extension.js.map'), 'not-a-runtime-file');
  await fs.writeFile(path.join(root, 'out/test/excluded.js'), 'not-a-runtime-test');
  await fs.writeFile(path.join(root, 'media/fixture.png'), 'synthetic-icon');
  await fs.writeFile(path.join(root, 'assets/achievements/fixture.png'), 'synthetic-achievement-icon');
  for (const file of ['isolation.cjs', 'bootstrap.cjs', 'runner.cjs', 'soak.cjs', 'background.cjs']) {
    await fs.writeFile(path.join(root, 'tests/native', file), 'synthetic-' + file);
  }
  return root;
}
async function prepared(t: TestContext): Promise<any> {
  const result = await preparation().prepareNativeDiagnostic({ repository: await fixture(t), sourceHead: 'a3d631d' });
  t.after(async () => { await fs.rm(result.plan.root, { recursive: true, force: true }); });
  return result;
}

test('native background preparation stages explicit options without modifying the production runtime', async t => {
  const source = await fixture(t);
  const result = await preparation().prepareNativeDiagnostic({ repository: source,
    sourceHead: '3752f76', mode: 'background', durationMs: 120000 });
  t.after(async () => { await fs.rm(result.plan.root, { recursive: true, force: true }); });
  const stage = result.plan.directories.developmentExtension;
  assert.equal(result.manifest.nativeTestMode, 'background');
  assert.equal(await fs.readFile(path.join(stage, 'native-background.cjs'), 'utf8'), 'synthetic-background.cjs');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(stage, 'native-background-options.json'), 'utf8')),
    { durationMs: 120000 });
  await assert.rejects(fs.stat(path.join(stage, 'native-soak-options.json')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(stage, 'out/extension.js'), 'utf8'), "exports.activate = async () => {};\n");
});

test('native diagnostic preparation always owns a fresh root and never replaces the source package', async t => {
  const source = await fixture(t), before = await fs.readFile(path.join(source, 'package.json'));
  const first = await preparation().prepareNativeDiagnostic({ repository: source, sourceHead: 'a3d631d' });
  const second = await preparation().prepareNativeDiagnostic({ repository: source, sourceHead: 'a3d631d' });
  t.after(async () => {
    await fs.rm(first.plan.root, { recursive: true, force: true });
    await fs.rm(second.plan.root, { recursive: true, force: true });
  });
  assert.notEqual(first.plan.root, second.plan.root);
  assert.match(path.basename(first.plan.root), /^ccu-native-v242-/);
  assert.deepEqual(await fs.readFile(path.join(source, 'package.json')), before);
});

test('native diagnostic macOS roots keep the observed IPC socket below the 103-character limit', async t => {
  if (process.platform !== 'darwin') { t.skip('macOS IPC path limit'); return; }
  const { plan } = await prepared(t);
  assert.ok(plan.root.startsWith('/private/tmp/ccu-native-v242-'));
  assert.ok(path.join(plan.directories.userData, '1.14-main.sock').length <= 103);
});

test('native diagnostic stage contains unchanged runtime modules but excludes maps and Node unit tests', async t => {
  const { plan, manifest } = await prepared(t), stage = plan.directories.developmentExtension;
  assert.equal(await fs.readFile(path.join(stage, 'out/extension.js'), 'utf8'), "exports.activate = async () => {};\n");
  await assert.rejects(fs.stat(path.join(stage, 'out/extension.js.map')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(stage, 'out/test')), { code: 'ENOENT' });
  assert.equal(manifest.compiledFiles.length, 1);
  assert.match(manifest.compiledFiles[0].sha256, /^[a-f0-9]{64}$/);
});

test('native diagnostic wrapper remains explicitly test-only and does not masquerade as a final VSIX', async t => {
  const { plan, manifest } = await prepared(t);
  const pkg = JSON.parse(await fs.readFile(path.join(plan.directories.developmentExtension, 'package.json'), 'utf8'));
  assert.equal(pkg.main, './native-bootstrap.cjs');
  assert.equal(pkg.version, '2.1.1');
  assert.equal(manifest.sourceHead, 'a3d631d');
  assert.equal(manifest.kind, 'isolated-native-diagnostic-not-final-vsix');
  assert.equal(manifest.nativeExecuted, false);
  assert.equal(manifest.finalInstallF5Passed, false);
});

test('native diagnostic copies the actual bundled assets layout used by achievementImagePath', async t => {
  const { plan } = await prepared(t), stage = plan.directories.developmentExtension;
  assert.equal(await fs.readFile(path.join(stage, 'assets/achievements/fixture.png'), 'utf8'), 'synthetic-achievement-icon');
  await assert.rejects(fs.stat(path.join(stage, 'media')), { code: 'ENOENT' });
});

test('native diagnostic launch guards in-memory secrets, recent folders, crashes and experiments', async t => {
  const { launchArguments } = await prepared(t);
  for (const flag of ['--use-inmemory-secretstorage', '--skip-add-to-recently-opened',
    '--disable-crash-reporter', '--disable-experiments']) assert.ok(launchArguments.includes(flag), flag);
  const sync = launchArguments.indexOf('--sync');
  assert.ok(sync >= 0);
  assert.equal(launchArguments[sync + 1], 'off');
});

test('native diagnostic settings point only to synthetic homes and disable app-level online services', async t => {
  const { plan } = await prepared(t);
  const settings = JSON.parse(await fs.readFile(path.join(plan.directories.userData, 'User/settings.json'), 'utf8'));
  assert.equal(settings['claudeCodeUsage.dataDirectory'], plan.directories.claudeHome);
  assert.equal(settings['claudeCodeUsage.codex.dataDirectory'], plan.directories.codexHome);
  assert.equal(settings['extensions.autoUpdate'], false);
  assert.equal(settings['extensions.autoCheckUpdates'], false);
  assert.equal(settings['update.mode'], 'none');
  assert.equal(settings['telemetry.telemetryLevel'], 'off');
  assert.equal(settings['chat.disableAIFeatures'], true);
  assert.equal(settings['git.enabled'], false);
  assert.ok(!Object.keys(settings).some(key => /apiKey|credential|secret/i.test(key)));
});

test('native diagnostic fixtures are bounded anonymous local logs without credentials', async t => {
  const { plan, manifest } = await prepared(t);
  assert.equal(manifest.fixture.files, 6);
  assert.ok(manifest.fixture.bytes > 0 && manifest.fixture.bytes < 2 * 1024 * 1024);
  assert.match(manifest.fixture.sha256, /^[a-f0-9]{64}$/);
  for (const home of [plan.directories.claudeHome, plan.directories.codexHome]) {
    await assert.rejects(fs.stat(path.join(home, 'auth.json')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(home, '.credentials.json')), { code: 'ENOENT' });
  }
  const files = await fs.readdir(path.join(plan.directories.codexHome, 'sessions'));
  assert.equal(files.length, 3);
  const rows = (await fs.readFile(path.join(plan.directories.codexHome, 'sessions', files[0]), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].type, 'session_meta');
  assert.match(rows[0].payload.id, /^synthetic-native-/);
  assert.equal(rows[rows.length - 1].payload.type, 'token_count');
});

test('native diagnostic preparation rejects symlinked compiled code instead of copying its target', async t => {
  const source = await fixture(t);
  const target = path.join(source, 'synthetic-target.js');
  await fs.writeFile(target, 'outside-compiled-fixture');
  await fs.unlink(path.join(source, 'out/extension.js'));
  await fs.symlink(target, path.join(source, 'out/extension.js'));
  await assert.rejects(preparation().prepareNativeDiagnostic({ repository: source, sourceHead: 'a3d631d' }),
    /^Error: native-test-preparation:nonregular-source$/);
});

test('native diagnostic preparation rejects invalid identity and provenance before staging', async t => {
  const source = await fixture(t);
  await assert.rejects(preparation().prepareNativeDiagnostic({ repository: source, sourceHead: 'not-a-commit' }),
    /native-test-preparation:invalid-input/);
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'different-extension' }));
  await assert.rejects(preparation().prepareNativeDiagnostic({ repository: source, sourceHead: 'a3d631d' }),
    /native-test-preparation:invalid-input/);
});

test('native soak staging is explicit and retains the same guarded launch paths', async t => {
  const result = await preparation().prepareNativeDiagnostic({ repository: await fixture(t), sourceHead: '231e1ed', mode: 'soak', durationMs: 500 });
  t.after(async () => { await fs.rm(result.plan.root, { recursive: true, force: true }); });
  assert.equal(result.manifest.nativeTestMode, 'soak');
  const stage = result.plan.directories.developmentExtension;
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(stage, 'native-soak-options.json'), 'utf8')), { durationMs: 500 });
  assert.equal(await fs.readFile(path.join(stage, 'native-soak.cjs'), 'utf8'), 'synthetic-soak.cjs');
  assert.ok(result.launchArguments.includes(path.join(stage, 'native-runner.cjs')));
});

test('native soak staging rejects invalid modes and unsafe durations before creating any owned profile', async t => {
  const repository = await fixture(t);
  await assert.rejects(preparation().prepareNativeDiagnostic({ repository, sourceHead: '231e1ed', mode: 'unknown' }), /invalid-input/);
  await assert.rejects(preparation().prepareNativeDiagnostic({ repository, sourceHead: '231e1ed', mode: 'soak', durationMs: Infinity }), /invalid-options/);
});
