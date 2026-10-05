import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACHIEVEMENT_DEFINITIONS } from '../achievements';

const root = resolve(__dirname, '../..');
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8');

test('all nine README editions document the 2.4.2 candidate and its canonical opt-out', () => {
  for (const suffix of ['', '-en', '-de-DE', '-zh-CN', '-zh-TW', '-ja', '-ko', '-pt-BR', '-id']) {
    const doc = read(`README${suffix}.md`);
    assert.match(doc, /2\.4\.2/, `README${suffix}.md must identify the unreleased candidate`);
    assert.match(doc, /enableAchievements/, `README${suffix}.md must show the disable setting`);
  }
  for (const file of ['README.md', 'README-en.md']) {
    assert.match(read(file), new RegExp(`${ACHIEVEMENT_DEFINITIONS.length} (?:level conditions|levels)`));
    assert.match(read(file), /historical unlocks.*quiet/i);
  }
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
  }
});
