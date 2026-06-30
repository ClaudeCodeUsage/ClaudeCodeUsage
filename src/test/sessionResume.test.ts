// Tests for the session-resume guards.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { isValidSessionId, isUsableCwd, buildResumeCommand, isUnderDir } from '../sessionResume';

test('isValidSessionId accepts UUID-shaped ids and sub-agent suffixes', () => {
  assert.ok(isValidSessionId('3f2504e0-4f89-41d3-9a0c-0305e82c3301'));
  assert.ok(isValidSessionId('abc123_DEF-456'));
});

test('isValidSessionId rejects shell-injection and junk', () => {
  const bad = ['', 'id; rm -rf /', 'a b', '$(whoami)', 'a`b`', 'a/b', '../x', 42, null, undefined];
  for (const v of bad) {
    assert.equal(isValidSessionId(v as unknown), false, `should reject ${String(v)}`);
  }
});

test('isUsableCwd only accepts absolute filesystem paths', () => {
  assert.ok(isUsableCwd('/Users/ozn/dev/ccp'));
  assert.ok(isUsableCwd('C:\\Users\\ozn'));
  assert.ok(isUsableCwd('D:/proj'));
  const bad = ['', '   ', 'd--Jiaming-My-Proj', 'relative/path', null, 5];
  for (const v of bad) {
    assert.equal(isUsableCwd(v as unknown), false, `should reject ${String(v)}`);
  }
});

test('buildResumeCommand builds only for valid ids', () => {
  assert.equal(buildResumeCommand('abc-123'), 'claude --resume abc-123');
  assert.equal(buildResumeCommand('bad; ls'), null);
  assert.equal(buildResumeCommand(''), null);
});

test('isUnderDir matches same dir and nested children, separator-agnostic', () => {
  assert.ok(isUnderDir('/Users/ozn/dev/ccp', '/Users/ozn/dev/ccp'));      // same
  assert.ok(isUnderDir('/Users/ozn/dev/ccp/src', '/Users/ozn/dev/ccp'));  // nested
  assert.ok(isUnderDir('/Users/ozn/dev/ccp/', '/Users/ozn/dev/ccp'));     // trailing slash
  assert.ok(isUnderDir('C:\\proj\\a', 'C:\\proj'));                       // windows
  assert.equal(isUnderDir('/Users/ozn/dev/ccp2', '/Users/ozn/dev/ccp'), false);
  assert.equal(isUnderDir('/other', '/Users/ozn/dev/ccp'), false);
  assert.equal(isUnderDir('/x', ''), false);
});
