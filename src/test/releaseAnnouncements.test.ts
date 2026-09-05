import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  announcementForUpgrade,
  latestAnnouncementVersion,
} from '../releaseAnnouncements';

const catalog = { '2.3.0': { version: '2.3.0' } };

test('upgrade resolves only the exact current version', () => {
  assert.deepEqual(
    announcementForUpgrade('2.3.0', '2.2.1', true, catalog),
    catalog['2.3.0'],
  );
  assert.equal(announcementForUpgrade('2.3.1', '2.3.0', true, catalog), null);
  assert.equal(announcementForUpgrade('2.2.9', '2.1.0', true, catalog), null);
});

test('fresh install, already-seen, and disabled announcements do not show', () => {
  assert.equal(announcementForUpgrade('2.3.0', undefined, true, catalog), null);
  assert.equal(announcementForUpgrade('2.3.0', '2.3.0', true, catalog), null);
  assert.equal(announcementForUpgrade('2.3.0', '2.2.1', false, catalog), null);
});

test('preview selects the greatest full semantic version', () => {
  assert.equal(
    latestAnnouncementVersion({ '2.3.0': {}, '2.10.0': {}, '2.9.5': {} }),
    '2.10.0',
  );
});
