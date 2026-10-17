import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const policy = name => readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

test('visual policy preserves plugin interaction scope and restrained analysis', () => {
  const en = policy('AGENTS.md');
  const zh = policy('AGENTS.zh-CN.md');
  assert.match(en, /### Plugin-scoped visual changes/);
  assert.match(en, /Preserve existing navigation, tabs, interactions and compact plugin density/);
  assert.match(en, /Claude content analysis is the baseline for Codex advice/);
  assert.match(en, /Do not reuse achievement artwork, rank ornaments or decorative mascots/);
  assert.match(en, /separate future opt-in/);
  assert.match(zh, /### 插件范围内的视觉优化/);
  assert.match(zh, /保留现有导航、标签页、交互方式和紧凑插件密度/);
  assert.match(zh, /以现有 Claude 内容分析为 Codex 优化建议的对齐基准/);
  assert.match(zh, /不得复用成就插画、等级饰件或装饰性吉祥物/);
  assert.match(zh, /未来单独的可选方案/);
});

test('README policy separates concise release summaries from engineering detail', () => {
  assert.match(policy('AGENTS.md'), /README release summaries follow the existing minor-version What's New format/);
  assert.match(policy('AGENTS.md'), /Detailed rules, storage contracts and verification belong in linked documentation/);
  assert.match(policy('AGENTS.zh-CN.md'), /README 版本概要沿用既有按 minor 版本组织的 What's New 格式/);
  assert.match(policy('AGENTS.zh-CN.md'), /详细规则、存储约定和验证证据放入所链接的文档/);
});

test('product policy prioritizes restrained usage statistics and optional extras', () => {
  const en = policy('AGENTS.md').replace(/\s+/g, ' ');
  const zh = policy('AGENTS.zh-CN.md').replace(/\s+/g, ' ');
  assert.match(en, /pure, restrained geek aesthetic/);
  assert.match(en, /Unrelated new extras default off/);
  assert.match(en, /usage habits need an optional switch/);
  assert.match(en, /documentation changes do not silently change shipped defaults/);
  assert.match(zh, /纯粹、克制的极客风/);
  assert.match(zh, /无关的新增附加功能默认关闭/);
  assert.match(zh, /可选开关并保留熟悉路径/);
});
