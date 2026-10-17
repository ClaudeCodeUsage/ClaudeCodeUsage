import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACHIEVEMENT_DEFINITIONS } from '../achievements';
import { ACHIEVEMENT_GALLERY } from '../achievementGallery';

const root = resolve(__dirname, '../..');
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8');

test('all nine README editions summarize 2.5 features and link to their detail references', () => {
  for (const suffix of ['', '-en', '-de-DE', '-zh-CN', '-zh-TW', '-ja', '-ko', '-pt-BR', '-id']) {
    const doc = read(`README${suffix}.md`);
    assert.match(doc, /^## .*2\.5\b/m, `README${suffix}.md must identify the minor release`);
    assert.match(doc, /\.jsonl\.zst/, `README${suffix}.md must identify compressed-log support`);
    assert.match(doc, /enableAchievements/, `README${suffix}.md must show the disable setting`);
    assert.match(doc, /\]\(LOCAL-DATA(?:\.zh-CN)?\.md(?:#[^)]*)?\)/,
      `README${suffix}.md must link to data and privacy boundaries`);
    assert.match(doc, /\]\(CHANGELOG\.md(?:#[^)]*)?\)/,
      `README${suffix}.md must link to release details`);
  }
});

test('linked detail documents retain achievement catalog facts and quiet historical unlocks', () => {
  for (const file of ['LOCAL-DATA.md', 'CHANGELOG.md']) {
    assert.match(read(file), new RegExp(`${ACHIEVEMENT_DEFINITIONS.length} (?:award conditions|rules)`));
    assert.match(read(file), new RegExp(`${ACHIEVEMENT_GALLERY.length} (?:icon-first )?(?:display )?themes`));
  }
  assert.match(read('LOCAL-DATA.md'), /historical unlocks.*quiet/i);
  assert.match(read('LOCAL-DATA.zh-CN.md'), /历史补认先静默保存/);
  assert.match(read('LOCAL-DATA.md'), /`enableAchievements` defaults to true/);
  assert.match(read('LOCAL-DATA.zh-CN.md'), /`enableAchievements` 默认开启/);
});

test('achievement storage and ownership are documented in the privacy inventory and both architecture copies', () => {
  for (const file of ['LOCAL-DATA.md', 'LOCAL-DATA.zh-CN.md']) {
    const inventory = read(file);
    for (const key of ['ccu.achievements.grants.v5', 'ccu.achievements.activity.v2',
      'ccu.achievements.hours.v3', 'ccu.achievements.calendarPeak.v1']) assert.ok(inventory.includes(key), `${file}: ${key}`);
    assert.match(inventory, /32,768/);
    assert.match(inventory, /524,288/);
  }
  for (const file of ['ARCHITECTURE.md', 'ARCHITECTURE-zh-CN.md']) {
    const doc = read(file);
    assert.ok(doc.includes('achievementCalendar.ts'));
    assert.ok(doc.includes('codexHourProof.ts'));
    assert.ok(doc.includes('enableAchievements'));
    assert.ok(doc.includes('achievementGallery.ts'));
  }
});
