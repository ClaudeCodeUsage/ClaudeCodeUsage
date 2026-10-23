import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexRootTimestampWitness } from '../providers/codex/codexRootTimestampWitness';

const iso = '2026-10-20T00:00:02.000Z', timestamp = Date.parse(iso);
function witness(text: string, width = 1) {
  const bytes = Buffer.from(text), parser = new CodexRootTimestampWitness();
  for (let offset = 0; offset < bytes.length; offset += width) parser.feed(bytes.subarray(offset, offset + width));
  return parser.finish();
}
test('stream witness accepts unique escaped root timestamp and validates unrelated nested values', () => {
  assert.equal(witness(`{"time\\u0073tamp":"${iso}","body":[{"timestamp":"other","x":"汉字😀\\\"{}[]"},true,false,null,-1.2e+3]}`), timestamp);
  assert.equal(witness(JSON.stringify({ body: '\\"[]{}\n'.repeat(1000), timestamp: iso }), 17), timestamp);
});
test('root duplicate aliases, nested-only timestamps and malformed or trailing JSON never witness time', () => {
  for (const text of [
    `{"timestamp":"${iso}","time\\u0073tamp":"${iso}"}`,
    `{"x":{"timestamp":"${iso}"}}`, `{"timestamp":"${iso}",}`, `{"timestamp":"${iso}","x":[1,]}`,
    `{"timestamp":"${iso}"} {}`, `{"timestamp":"${iso}","x":01}`, `{"timestamp":"${iso}","x":1e}`,
    `{"timestamp":"${iso}","x":"\\q"}`, `{"timestamp":"${iso}","x":"unterminated}`, `{"timestamp":2}`,
  ]) assert.equal(witness(text), undefined, text);
});
test('depth, key size/count and UTF-8 bounds fail closed without body retention', () => {
  assert.equal(witness(`{"timestamp":"${iso}","x":${'['.repeat(65)}0${']'.repeat(65)}}`), undefined);
  assert.equal(witness(JSON.stringify({ timestamp: iso, ['x'.repeat(129)]: 1 })), undefined);
  assert.equal(witness(`{"timestamp":"${iso}","x":{${Array.from({ length: 4096 }, (_, i) => `"k${i}":0`).join(',')}}}`), undefined);
  const parser = new CodexRootTimestampWitness();
  parser.feed(Buffer.concat([Buffer.from(`{"timestamp":"${iso}","x":"`), Buffer.from([0xc0, 0xaf]), Buffer.from('"}') ]));
  assert.equal(parser.finish(), undefined);
});
