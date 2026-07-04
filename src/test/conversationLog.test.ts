// Tests for the read-only conversation viewer's .jsonl parser.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { parseConversation } from '../conversationLog';

const line = (o: unknown): string => JSON.stringify(o);

const SAMPLE = [
  line({ type: 'custom-title', customTitle: 'My session' }),
  line({ type: 'summary', summary: 'ignored because custom wins' }),
  line({
    type: 'user',
    uuid: 'u1',
    timestamp: '2026-07-01T10:00:00Z',
    message: { role: 'user', content: 'Fix the login bug' },
  }),
  line({
    type: 'assistant',
    uuid: 'a1',
    timestamp: '2026-07-01T10:00:05Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-4-8',
      content: [
        { type: 'thinking', thinking: 'Let me look at auth.ts' },
        { type: 'text', text: 'I will check auth.ts.' },
        { type: 'tool_use', name: 'Read', input: { file_path: 'src/auth.ts' } },
      ],
    },
  }),
  line({
    type: 'user',
    uuid: 'u2',
    timestamp: '2026-07-01T10:00:06Z',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'file contents...', is_error: false }] },
  }),
  line({
    type: 'assistant',
    uuid: 'a2',
    timestamp: '2026-07-01T10:00:10Z',
    message: { role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'Found it: line 42.' }] },
  }),
].join('\n');

test('parses titles, prompts, text, thinking and tool turns in order', () => {
  const r = parseConversation(SAMPLE);
  assert.equal(r.title, 'My session');
  assert.equal(r.promptCount, 1);
  const kinds = r.turns.map((t) => t.kind);
  assert.deepEqual(kinds, ['prompt', 'thinking', 'text', 'tool_use', 'tool_result', 'text']);
  assert.equal(r.turns[0].text, 'Fix the login bug');
  assert.equal(r.turns[3].toolName, 'Read');
  assert.equal(r.turns[3].text, 'src/auth.ts');
  assert.equal(r.turns[5].model, 'claude-opus-4-8');
  assert.equal(r.firstTs, '2026-07-01T10:00:00Z');
  assert.equal(r.lastTs, '2026-07-01T10:00:10Z');
});

test('skips meta and sidechain lines, and dedupes by uuid', () => {
  const txt = [
    line({ type: 'user', uuid: 'm', isMeta: true, message: { role: 'user', content: '<command stdout>' } }),
    line({ type: 'assistant', uuid: 's', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'subagent' }] } }),
    line({ type: 'user', uuid: 'dup', message: { role: 'user', content: 'hello' } }),
    line({ type: 'user', uuid: 'dup', message: { role: 'user', content: 'hello again (same uuid)' } }),
  ].join('\n');
  const r = parseConversation(txt);
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].text, 'hello');
});

test('malformed lines are skipped, not fatal', () => {
  const txt = ['not json', '', '   ', line({ type: 'user', uuid: 'x', message: { role: 'user', content: 'ok' } })].join('\n');
  const r = parseConversation(txt);
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].text, 'ok');
});

test('maxTurns keeps the most recent turns; totalTurns reports the full count', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    line({ type: 'user', uuid: 'u' + i, message: { role: 'user', content: 'msg ' + i } })
  ).join('\n');
  const r = parseConversation(many, { maxTurns: 3 });
  assert.equal(r.totalTurns, 10);
  assert.equal(r.turns.length, 3);
  assert.deepEqual(r.turns.map((t) => t.text), ['msg 7', 'msg 8', 'msg 9']);
});

test('maxCharsPerTurn truncates and flags it', () => {
  const long = 'x'.repeat(2000);
  const r = parseConversation(line({ type: 'user', uuid: 'u', message: { role: 'user', content: long } }), {
    maxCharsPerTurn: 100,
  });
  assert.equal(r.turns[0].text.length, 100);
  assert.equal(r.turns[0].truncated, true);
});

test('includeThinking / includeTools filters drop those turns', () => {
  const r = parseConversation(SAMPLE, { includeThinking: false, includeTools: false });
  const kinds = r.turns.map((t) => t.kind);
  assert.deepEqual(kinds, ['prompt', 'text', 'text']);
});

test('ai-title is used when no custom-title is present', () => {
  const txt = [
    line({ type: 'ai-title', aiTitle: 'Auto title' }),
    line({ type: 'user', uuid: 'u', message: { role: 'user', content: 'hi' } }),
  ].join('\n');
  assert.equal(parseConversation(txt).title, 'Auto title');
});
