'use strict';

// Test-only development main. The production module loads only after actual
// ExtensionContext and configured synthetic sources pass the isolation guard.
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { guardAndSeedNativeActivation } = require('./native-isolation.cjs');
let production;
async function activate(context) {
  const plan = JSON.parse(await fs.readFile(path.join(__dirname, 'native-plan.json'), 'utf8'));
  const config = vscode.workspace.getConfiguration('claudeCodeUsage');
  const actual = {
    extensionMode: context.extensionMode, extensionPath: context.extensionPath,
    // Derive from the real context, not a test environment-variable assertion.
    userDataPath: path.resolve(context.globalStorageUri.fsPath, '../../..'),
    globalStoragePath: context.globalStorageUri.fsPath, workspaceStoragePath: context.storageUri?.fsPath,
    claudeDataDirectory: config.get('dataDirectory'), codexDataDirectory: config.get('codex.dataDirectory'),
  };
  await guardAndSeedNativeActivation(plan, actual, context.globalState);
  production = require('./out/extension.js');
  const prototype = production.ClaudeCodeUsageExtension?.prototype, original = prototype?.setupCommands;
  if (typeof original !== 'function') throw new Error('native-test-bootstrap:unsupported-capture');
  let instance;
  prototype.setupCommands = function (...args) { instance = this; return original.apply(this, args); };
  try { await production.activate(context); }
  finally { prototype.setupCommands = original; }
  if (!instance) throw new Error('native-test-bootstrap:missing-instance');
  return Object.freeze({ plan, context, instance, stop: deactivate,
    isolation: Object.freeze({ testModeVerified: true, actualStatePathsVerified: true,
      syntheticHomesVerified: true, ownSafetySeedCompleted: true }) });
}
async function deactivate() { await production?.deactivate(); }
module.exports = { activate, deactivate };
