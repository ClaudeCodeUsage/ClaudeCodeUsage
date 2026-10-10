import { test } from 'node:test';
import * as assert from 'node:assert/strict';

test('weekly quota pace is a shared default-off state setting owned by the catalog', () => {
  const loader = require('node:module');
  const original = loader._load;
  loader._load = function (name: string, ...args: any[]): any {
    return name === 'vscode' ? {} : original.call(this, name, ...args);
  };
  let settings: typeof import('../settings');
  try { settings = require('../settings'); } finally { loader._load = original; }
  const def = settings.SETTINGS.find((item) => item.key === 'showWeeklyQuotaPace');
  assert.ok(def);
  assert.equal(def.type, 'boolean');
  assert.equal(def.default, false);
  assert.equal(def.storage, 'state');
  assert.equal(def.group, 'statusBar');
  assert.deepEqual(def.providers, ['claude', 'codex']);
  assert.match(def.help ?? '', /account|Account/);
});
