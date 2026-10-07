import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// Only async helper contracts use synthetic events here. This is not native
// Code/WebviewPanel acceptance; runner.run() still requires the real VS Code API.
function helper(): any { return require(path.resolve(__dirname, '../../tests/native/runner.cjs')); }

test('native panel helper awaits the disposal event rather than assuming a fixed paint delay', async () => {
  let listener: (() => void) | undefined, released = false, finished = false;
  const view: any = { panel: {
    onDidDispose: (callback: () => void) => { listener = callback; return { dispose: () => { released = true; listener = undefined; } }; },
    dispose: () => { setTimeout(() => { view.panel = undefined; finished = true; listener?.(); }, 10); },
  } };
  const work = helper().disposePanelAndWait(view, 1000);
  assert.equal(finished, false);
  await work;
  assert.equal(finished, true);
  assert.equal(view.panel, undefined);
  assert.equal(released, true);
});

test('native panel helper releases its event subscription when native acknowledgement times out', async () => {
  let released = false;
  const view = { panel: {
    onDidDispose: () => ({ dispose: () => { released = true; } }), dispose: () => {},
  } };
  await assert.rejects(helper().disposePanelAndWait(view, 5), /native-test-runner:panel-dispose-timeout/);
  assert.equal(released, true);
});

test('native panel helper releases its event subscription on a synchronous disposal failure', async () => {
  let released = false;
  const view = { panel: {
    onDidDispose: () => ({ dispose: () => { released = true; } }),
    dispose: () => { throw new Error('synthetic-dispose-failure'); },
  } };
  await assert.rejects(helper().disposePanelAndWait(view, 50), /synthetic-dispose-failure/);
  assert.equal(released, true);
});

test('native cache check uses the real single preview artifact rather than a nonexistent Map size', () => {
  const { AchievementSharePreview } = require('../achievementShare');
  const view = { dataPanelCache: new Map(), pendingAchievementNotice: new Set(),
    acceptedAchievementPreview: new AchievementSharePreview() };
  assert.equal((view.acceptedAchievementPreview as any).size, undefined);
  assert.doesNotThrow(() => helper().assertNativePanelCachesCleared(view));
});

test('native cache check rejects a retained actual preview and passes only after it is retired', () => {
  const { AchievementSharePreview } = require('../achievementShare');
  const view = { dataPanelCache: new Map(), pendingAchievementNotice: new Set(),
    acceptedAchievementPreview: new AchievementSharePreview() };
  view.acceptedAchievementPreview.accept(['astra-regular'], '<svg>synthetic-test-only</svg>', 'en');
  assert.throws(() => helper().assertNativePanelCachesCleared(view));
  view.acceptedAchievementPreview.clear();
  assert.doesNotThrow(() => helper().assertNativePanelCachesCleared(view));
});

test('native cache check rejects retained map and notice entries independently', () => {
  const { AchievementSharePreview } = require('../achievementShare');
  const view = { dataPanelCache: new Map(), pendingAchievementNotice: new Set(),
    acceptedAchievementPreview: new AchievementSharePreview() };
  view.dataPanelCache.set('synthetic', 1);
  assert.throws(() => helper().assertNativePanelCachesCleared(view));
  view.dataPanelCache.clear(); view.pendingAchievementNotice.add('synthetic');
  assert.throws(() => helper().assertNativePanelCachesCleared(view));
});
