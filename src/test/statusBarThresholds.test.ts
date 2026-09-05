// Wiring test for the fill thresholds. quotaFormat.test.ts pins the pairs
// themselves; this pins which indicator gets which, because the interesting
// failure is a correct pair handed to the wrong bar. statusBar.ts imports
// vscode, so the module is loaded against a stub (see extensionWindowActivity).

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { CONTEXT_FILL_THRESHOLDS, QUOTA_FILL_THRESHOLDS, fillLevel } from '../quotaFormat';

const GREEN = '#4caf50';
const AMBER = '#ff9800';
const RED = '#f44336';

type StatusBarModule = typeof import('../statusBar');

/** Records the id it was constructed with, so a background assertion can name
 * the theme colour rather than compare opaque stubs. */
class RecordingThemeColor {
  constructor(public readonly id: string) {}
}

function loadStatusBarModule(): StatusBarModule {
  const moduleLoader = require('node:module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const vscodeStub: any = new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === 'then') {
        return undefined;
      }
      if (property === 'ThemeColor') {
        return RecordingThemeColor;
      }
      return vscodeStub;
    },
    apply: () => vscodeStub,
    construct: () => vscodeStub,
  });
  moduleLoader._load = function (request, parent, isMain): unknown {
    if (request === 'vscode') {
      return vscodeStub;
    }
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };
  try {
    return require('../statusBar') as StatusBarModule;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

const { StatusBarManager } = loadStatusBarModule();

/** The prototype alone — the real constructor builds live status-bar items. */
function bareStatusBar(): any {
  return Object.create(StatusBarManager.prototype) as any;
}

/** The fill colour the bar paints, read back off the rendered spans. The inner
 * span carries the fill; the outer track is always #bbbbbb. */
function barColor(pct: number, thresholds?: unknown): string {
  const html: string =
    thresholds === undefined
      ? bareStatusBar().progressBarSvg(pct)
      : bareStatusBar().progressBarSvg(pct, 24, thresholds);
  const fills = [GREEN, AMBER, RED].filter((c) => html.includes(c));
  assert.equal(fills.length, 1, `expected exactly one fill colour in ${html}`);
  return fills[0];
}

test('a quota bar defaults to the quota thresholds', () => {
  // The default matters: every quota row and the credits row rely on it.
  assert.equal(barColor(74), GREEN);
  assert.equal(barColor(75), AMBER);
  assert.equal(barColor(89), AMBER);
  assert.equal(barColor(90), RED);
});

test('the context bar is explicitly given the later thresholds', () => {
  assert.equal(barColor(79, CONTEXT_FILL_THRESHOLDS), GREEN);
  assert.equal(barColor(80, CONTEXT_FILL_THRESHOLDS), AMBER);
  assert.equal(barColor(94, CONTEXT_FILL_THRESHOLDS), AMBER);
  assert.equal(barColor(95, CONTEXT_FILL_THRESHOLDS), RED);
});

test('the two bars disagree in the bands the split created', () => {
  // 77% is the whole point of the change: quota warns, context stays quiet.
  assert.equal(barColor(77, QUOTA_FILL_THRESHOLDS), AMBER);
  assert.equal(barColor(77, CONTEXT_FILL_THRESHOLDS), GREEN);
  assert.equal(barColor(92, QUOTA_FILL_THRESHOLDS), RED);
  assert.equal(barColor(92, CONTEXT_FILL_THRESHOLDS), AMBER);
});

test('the track is drawn even when the fill is empty', () => {
  const html: string = bareStatusBar().progressBarSvg(0);
  assert.ok(html.includes('#bbbbbb'), 'the gray track must survive a 0% fill');
});

test('item background follows the same level as the bar', () => {
  const bg = (pct: number, thresholds: unknown): string | undefined =>
    bareStatusBar().fillBackground(fillLevel(pct, thresholds as any))?.id;

  assert.equal(bg(74, QUOTA_FILL_THRESHOLDS), undefined);
  assert.equal(bg(75, QUOTA_FILL_THRESHOLDS), 'statusBarItem.warningBackground');
  assert.equal(bg(90, QUOTA_FILL_THRESHOLDS), 'statusBarItem.errorBackground');
  // Context keeps 80 / 95, so at 77 the item stays uncoloured.
  assert.equal(bg(77, CONTEXT_FILL_THRESHOLDS), undefined);
  assert.equal(bg(80, CONTEXT_FILL_THRESHOLDS), 'statusBarItem.warningBackground');
  assert.equal(bg(95, CONTEXT_FILL_THRESHOLDS), 'statusBarItem.errorBackground');
});
