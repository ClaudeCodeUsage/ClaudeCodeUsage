import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const editions = {
  'README.md': "What's new in 2.5",
  'README-en.md': "What's new in v2.5",
  'README-de-DE.md': 'Neu in v2.5',
  'README-zh-CN.md': '2.5 新功能',
  'README-zh-TW.md': 'v2.5 新功能',
  'README-ja.md': 'v2.5 の新機能',
  'README-ko.md': 'v2.5 새로운 기능',
  'README-pt-BR.md': 'Novidades da v2.5',
  'README-id.md': 'Yang baru di v2.5',
};

for (const [file, heading] of Object.entries(editions)) {
  test(`${file}: one concise minor-version 2.5 feature summary`, () => {
    const doc = readFileSync(new URL(file, root), 'utf8');
    const releases = [...doc.matchAll(/^## .*2\.5\b.*$/gm)];
    assert.equal(releases.length, 1, 'use one v2.5 section, without separate feature appendices');
    assert.equal(releases[0][0], `## ${heading}`, 'follow the localized minor-version format');
    const start = releases[0].index;
    const end = doc.indexOf('\n## ', start + releases[0][0].length);
    const section = doc.slice(start, end < 0 ? doc.length : end).trim();
    assert.doesNotMatch(doc.slice(0, start), /(?:^|[^\d])v?2\.5(?:\.0)?(?!\d)/,
      'do not duplicate the v2.5 introduction before the release summary');
    assert.ok([...section].length <= 2600, 'keep the summary within 2,600 characters across locales');
    assert.ok(section.split('\n').length <= 26, 'keep the section short, including hidden content');
    const bullets = section.match(/^- .*(?:\n {2,}[^\n]+)*/gm) ?? [];
    assert.ok(bullets.length >= 4 && bullets.length <= 6, 'summarize four to six features');
    assert.ok(bullets.every(bullet => [...bullet].length <= 550), 'keep each feature brief');
    assert.match(section, /\]\(CHANGELOG\.md(?:#[^)]*)?\)/);
    assert.match(section, /\]\(LOCAL-DATA(?:\.zh-CN)?\.md(?:#[^)]*)?\)/);
    assert.doesNotMatch(section, /<details|^#{3,}|\|.*\|/m, 'do not hide a rule catalog in an appendix');
    assert.doesNotMatch(section,
      /ccu\.|api-reference-\d|schemaVersion|HMAC|single-flight|CSP|ARIA|\d+\s*(?:KiB|px|award conditions|rules|themes)|(?:100M|500M)\s*[→/]|approval-reviewer/i,
      'keep storage recipes, threshold ladders and implementation details in the linked references');
  });
}

for (const file of Object.keys(editions).filter(file => !['README-de-DE.md', 'README-pt-BR.md'].includes(file))) {
  test(`${file}: v2.4 is a collapsed historical release`, () => {
    const doc = readFileSync(new URL(file, root), 'utf8');
    const heading = doc.match(/^## .*2\.4\b.*$/m);
    assert.ok(heading, 'preserve the existing v2.4 release section');
    const end = doc.indexOf('\n## ', heading.index + heading[0].length);
    const section = doc.slice(heading.index, end < 0 ? doc.length : end);
    assert.match(section, /^<details>$/m, 'collapse the older release like other historical entries');
    assert.doesNotMatch(section, /<details\s+open\b/);
    const summary = section.match(/<summary>(.*?)<\/summary>/)?.[1] ?? '';
    assert.match(summary, /2\.4\b/, 'identify the historical version in the summary');
    assert.doesNotMatch(summary, /Current release|当前版本|目前版本|最新リリース|최신 릴리스|rilis terbaru/i);
  });
}
