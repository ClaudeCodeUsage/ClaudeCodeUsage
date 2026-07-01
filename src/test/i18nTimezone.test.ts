import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';

test('a valid IANA zone is accepted', () => {
  I18n.setTimezone('Asia/Hong_Kong');
  assert.equal(I18n.getTimezone(), 'Asia/Hong_Kong');
});

test('an invalid zone falls back to system (empty), never crashes (#51)', () => {
  I18n.setTimezone('EST-5 Detroit'); // what the bug reporter typed
  assert.equal(I18n.getTimezone(), '');
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en', I18n.dateFormatOptions()));
});

test('empty stays empty (system zone)', () => {
  I18n.setTimezone('');
  assert.equal(I18n.getTimezone(), '');
});

test('isValidTimeZone distinguishes real zones from junk', () => {
  assert.equal(I18n.isValidTimeZone('America/New_York'), true);
  assert.equal(I18n.isValidTimeZone('UTC'), true);
  assert.equal(I18n.isValidTimeZone('EST-5 Detroit'), false);
});
