import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');

test('public PR guidance describes changes without private request or approval narration', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /Public PR descriptions/);
  assert.match(agents, /Describe changes, rationale, tests and limitations directly/);
  assert.match(agents, /Do not narrate private user or maintainer requests, approvals or agent instructions/);
  assert.match(agents, /Keep required AI attribution/);
  assert.match(read('AGENTS.zh-CN.md'), /PR 说明直接写改动、理由、测试和限制/);
  assert.match(read('AGENTS.zh-CN.md'), /不叙述私人对话中的要求、授权或智能体执行指令/);
  assert.match(read('CONTRIBUTING.md'), /Describe changes directly; omit private request and approval narratives/);
  assert.match(read('.github/PULL_REQUEST_TEMPLATE.md'), /Describe changes directly; omit private request and approval narratives/);
  assert.match(read('.github/TEMPLATES.zh-CN.md'), /直接写改动、理由、测试和限制/);
});
