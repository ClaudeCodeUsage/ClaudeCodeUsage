import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const json = path => JSON.parse(read(path));
const require = createRequire(import.meta.url);

function compatible(manifest, lock, config, nodeMajor) {
  const deps = manifest.devDependencies;
  assert.match(deps.typescript, /^6\.\d+\.\d+$/);
  assert.match(deps['@types/node'], new RegExp(`^${nodeMajor}\\.\\d+\\.\\d+$`));
  const floor = /^\^(\d+)\.(\d+)\.\d+$/.exec(manifest.engines.vscode);
  assert.ok(floor, 'preserve the explicit VS Code compatibility floor');
  assert.match(deps['@types/vscode'], new RegExp(`^${floor[1]}\\.${floor[2]}\\.\\d+$`));
  for (const name of ['typescript', '@types/node', '@types/vscode']) {
    assert.equal(lock.packages[''].devDependencies[name], deps[name]);
    assert.equal(lock.packages[`node_modules/${name}`].version, deps[name]);
    assert.match(lock.packages[`node_modules/${name}`].integrity, /^sha512-/);
    assert.equal(lock.packages[`node_modules/${name}`].deprecated, undefined, `${name} must not use a deprecated compatibility mismatch`);
  }
  assert.equal(config.compilerOptions.module, 'commonjs');
  assert.equal(config.compilerOptions.esModuleInterop, false);
  assert.equal(config.compilerOptions.target, 'ES2020');
  assert.equal(config.compilerOptions.rootDir, 'src');
  assert.equal(config.compilerOptions.outDir, 'out');
  assert.equal(config.compilerOptions.strict, true);
  assert.deepEqual(config.compilerOptions.types, ['node']);
  // TS6 is the compatible legacy-API bridge. Keep existing CommonJS resolution
  // until a separately tested module migration, rather than changing lazy imports.
  assert.equal(config.compilerOptions.ignoreDeprecations, '6.0');
  assert.equal(config.compilerOptions.skipLibCheck, undefined);
  assert.deepEqual(manifest.dependencies ?? {}, {});
}

test('compiler batch retains Node and VS Code API compatibility with a synchronized exact lock', () => {
  compatible(json('package.json'), json('package-lock.json'), json('tsconfig.json'), read('.nvmrc').trim());
});

test('compiler compatibility rejects major drift, implicit globals, stale locks and weakened checks', () => {
  const manifest = json('package.json'), lock = json('package-lock.json'), config = json('tsconfig.json');
  const node = read('.nvmrc').trim();
  compatible(manifest, lock, config, node);
  for (const mutate of [
    p => { p.devDependencies.typescript = '7.0.2'; },
    p => { p.devDependencies['@types/node'] = '26.6.5'; },
    p => { p.devDependencies['@types/vscode'] = '1.140.0'; },
    p => { p.dependencies = { typescript: '6.0.3' }; },
  ]) {
    const changed = structuredClone(manifest); mutate(changed);
    const changedLock = structuredClone(lock);
    for (const name of ['typescript', '@types/node', '@types/vscode']) {
      changedLock.packages[''].devDependencies[name] = changed.devDependencies[name];
      changedLock.packages[`node_modules/${name}`].version = changed.devDependencies[name];
    }
    assert.throws(() => compatible(changed, changedLock, config, node));
  }
  for (const mutate of [
    p => { delete p.compilerOptions.types; },
    p => { p.compilerOptions.types = ['*']; },
    p => { p.compilerOptions.strict = false; },
    p => { p.compilerOptions.skipLibCheck = true; },
    p => { p.compilerOptions.module = 'nodenext'; },
    p => { delete p.compilerOptions.esModuleInterop; },
  ]) {
    const changed = structuredClone(config); mutate(changed);
    assert.throws(() => compatible(manifest, lock, changed, node));
  }
  const stale = structuredClone(lock); stale.packages['node_modules/typescript'].version = '5.9.3';
  assert.throws(() => compatible(manifest, stale, config, node));
  const patchManifest = structuredClone(manifest), patchLock = structuredClone(lock);
  patchManifest.devDependencies['@types/vscode'] = '1.74.1';
  patchLock.packages[''].devDependencies['@types/vscode'] = '1.74.1';
  patchLock.packages['node_modules/@types/vscode'].version = '1.74.1';
  patchLock.packages['node_modules/@types/vscode'].deprecated = 'Contains types for VS Code 1.75, not 1.74';
  assert.throws(() => compatible(patchManifest, patchLock, config, node));
});

test('installed compiler retains the AST API, parents and CommonJS lazy import used by policy gates', () => {
  const ts = require('typescript');
  assert.equal(ts.version, json('package.json').devDependencies.typescript);
  for (const name of ['createSourceFile', 'parseJsonConfigFileContent', 'forEachChild',
    'isInterfaceDeclaration', 'isTypeAliasDeclaration', 'isIdentifier', 'isCallExpression']) {
    assert.equal(typeof ts[name], 'function', name);
  }
  const file = ts.createSourceFile('guard.ts', 'interface Guard { safe: string }', ts.ScriptTarget.ES2020, true);
  assert.ok(ts.isInterfaceDeclaration(file.statements[0]));
  assert.equal(file.statements[0].parent, file);
  const parsed = ts.parseJsonConfigFileContent(json('tsconfig.json'), ts.sys, fileURLToPath(root));
  assert.deepEqual(parsed.errors, []);
  const emitted = ts.transpileModule('import * as https from "node:https"; export const get = https.get; export async function load() { return import("./dataLoader"); }', {
    compilerOptions: parsed.options, fileName: fileURLToPath(new URL('src/guard.ts', root)), reportDiagnostics: true,
  });
  assert.deepEqual(emitted.diagnostics ?? [], []);
  assert.match(emitted.outputText, /require\(["']\.\/dataLoader["']\)/);
  assert.match(emitted.outputText, /exports\.load\s*=/);
  assert.doesNotMatch(emitted.outputText, /\bimport\s*\(/);
  assert.doesNotMatch(emitted.outputText, /__importStar|__createBinding/);
  assert.match(emitted.outputText, /const https = require\(["']node:https["']\)/);
});
