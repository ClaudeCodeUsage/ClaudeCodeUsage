import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { achievementCopyFor, I18n } from '../i18n';

type Notice = { text: string; actions: string[] };
const notices: Notice[] = [];
const errors: string[] = [];
let choose: (notice: Notice) => Promise<string | undefined> = async () => undefined;
const stub: any = new Proxy(function () {}, {
  get: (_target, property) => property === 'then' || property === 'workspaceFolders' ? undefined : stub,
  apply: () => stub,
  construct: () => stub,
});
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'vscode') return new Proxy(stub, {
    get: (_target, key) => key === 'window' ? {
      showInformationMessage: (text: string, ...actions: string[]) => {
        const notice = { text, actions };
        notices.push(notice);
        return choose(notice);
      },
      showErrorMessage: async (text: string) => { errors.push(text); },
    } : stub[key],
  });
  return originalLoad.call(this, request, parent, isMain);
};
const { ClaudeCodeUsageExtension } = require('../extension') as typeof import('../extension');
(Module as any)._load = originalLoad;

function harness(state = new Map<string, unknown>([['ccu.lastSeenVersion', '2.4.1']])) {
  I18n.setLanguage('en', 'en');
  notices.length = 0;
  errors.length = 0;
  choose = async () => undefined;
  const extension: any = Object.create(ClaudeCodeUsageExtension.prototype);
  const settings = new Map<string, unknown>();
  const opened: string[] = [];
  const changes: string[] = [];
  extension.disposed = false;
  extension.initializationWrites = Promise.resolve();
  extension.initializationWriteFailure = null;
  extension.context = {
    extension: { packageJSON: { version: '2.4.2' } },
    globalState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => state.set(key, value) },
  };
  extension.settings = {
    get: (key: string) => settings.get(key) ?? true,
    set: async (key: string, value: unknown) => settings.set(key, value),
  };
  extension.getConfiguration = () => ({ enableAchievements: extension.settings.get('enableAchievements'),
    releaseAnnouncements: extension.settings.get('releaseAnnouncements') });
  extension.webviewProvider = { show: (tab: string) => opened.push(tab) };
  extension.onSettingsChangedFromPanel = (key: string) => changes.push(key);
  return { extension, state, settings, opened, changes };
}

async function settle(extension: any) {
  await extension.initializationWrites;
  await new Promise<void>(resolve => setImmediate(resolve));
}

test('2.4.2 upgrade reminds once without forcing a panel and survives reload', async () => {
  const { extension, state, opened } = harness();
  extension.maybeAnnounceWhatsNew();
  extension.maybeAnnounceWhatsNew();
  await settle(extension);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].actions.length, 2);
  assert.deepEqual(opened, []);
  assert.equal(state.get('ccu.lastSeenVersion'), '2.4.2');
  const reloaded = harness(state);
  reloaded.extension.maybeAnnounceWhatsNew();
  await settle(reloaded.extension);
  assert.equal(notices.length, 0);
});

test('upgrade disable action saves OFF, applies in place, and retains OFF after reload', async () => {
  const { extension, state, settings, opened, changes } = harness();
  choose = async notice => notice.actions[1];
  extension.maybeAnnounceWhatsNew();
  await settle(extension);
  assert.equal(settings.get('enableAchievements'), false);
  assert.deepEqual(changes, ['enableAchievements']);
  assert.deepEqual(opened, []);
  const reloaded = harness(state);
  reloaded.settings.set('enableAchievements', settings.get('enableAchievements'));
  reloaded.extension.maybeAnnounceWhatsNew();
  await settle(reloaded.extension);
  assert.equal(reloaded.settings.get('enableAchievements'), false);
  assert.equal(notices.length, 0);
});

test('prior OFF is respected, muted notices and fresh installs stay quiet', async () => {
  const off = harness();
  off.settings.set('enableAchievements', false);
  off.extension.maybeAnnounceWhatsNew();
  await settle(off.extension);
  assert.equal(off.settings.get('enableAchievements'), false);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].actions.includes((achievementCopyFor('en') as any).disableAchievements), false);
  for (const fresh of [false, true]) {
    const quiet = harness(fresh ? new Map() : undefined);
    if (!fresh) quiet.settings.set('releaseAnnouncements', false);
    quiet.extension.maybeAnnounceWhatsNew();
    await settle(quiet.extension);
    assert.equal(notices.length, 0);
    assert.equal(quiet.state.get('ccu.lastSeenVersion'), '2.4.2');
  }
});

test('version write failure never produces a repeat notice or an optimistic reminder', async () => {
  const { extension } = harness();
  let writes = 0;
  extension.context.globalState.update = async () => { writes++; throw new Error('synthetic write failure'); };
  extension.maybeAnnounceWhatsNew();
  await settle(extension);
  extension.maybeAnnounceWhatsNew();
  await settle(extension);
  assert.equal(notices.length, 0);
  assert.equal(writes, 1);
  assert.notEqual(extension.initializationWriteFailure, null);
});

test('failed disable is reported without pretending OFF; late picks after disposal are ignored', async () => {
  const failed = harness();
  failed.extension.settings.set = async () => { throw new Error('synthetic setting save failure'); };
  choose = async notice => notice.actions[1];
  failed.extension.maybeAnnounceWhatsNew();
  await settle(failed.extension);
  assert.equal(failed.extension.settings.get('enableAchievements'), true);
  assert.equal(errors.length, 1);
  assert.deepEqual(failed.changes, []);

  const late = harness();
  let pick!: (value: string | undefined) => void;
  choose = () => new Promise(resolve => { pick = resolve; });
  late.extension.maybeAnnounceWhatsNew();
  await settle(late.extension);
  late.extension.disposed = true;
  pick(notices[0].actions[1]);
  await settle(late.extension);
  assert.equal(late.extension.settings.get('enableAchievements'), true);
  assert.deepEqual(late.changes, []);
});
