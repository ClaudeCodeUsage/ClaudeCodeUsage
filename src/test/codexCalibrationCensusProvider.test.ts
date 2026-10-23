import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createEmptyCodexIndex, updateCodexIndex } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { CodexProvider } from '../providers/codex/codexProvider';
import { isCodexCalibrationCensus } from '../providers/codex/codexCalibrationCensus';

test('a fresh verified provider publishes branded source proof and withdraws it on refresh failure', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-census-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'));
  const now = Date.now() - 60_000, reset = now + 6 * 86400000, salt = 'synthetic-census-provider';
  const rows = [{ type: 'turn_context', timestamp: new Date(now).toISOString(), payload: { model: 'gpt-5' } },
    ...[0, 1].map(n => ({ type: 'event_msg', timestamp: new Date(now + n * 1000).toISOString(), payload: {
      type: 'token_count', info: { last_token_usage: { input_tokens: 100, output_tokens: 2 } },
      rate_limits: { limit_id: 'codex', secondary: { used_percent: 20 + n * 10, window_minutes: 10080, resets_at: reset } },
    } }))];
  await writeFile(path.join(root, 'sessions', 'synthetic.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const indexed = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(root, salt),
    { salt, timeZone: 'UTC', now: () => now + 5000, allowAchievementHourProof: false });
  let fail = false;
  let verificationClock = Date.now();
  const verificationBeganAt = verificationClock;
  t.mock.method(Date, 'now', () => verificationClock);
  const provider = new CodexProvider({ enabled: true, codexHome: root, salt, timeZone: 'UTC',
    indexPath: path.join(root, 'unused.json'), allowAchievementHourProof: false }, () => ({
      refresh: async () => {
        if (fail) throw new Error('synthetic-refresh-failure');
        verificationClock += 10 * 60_000; // A slow cold parse must not look newly verified at publication.
        return { ...indexed, failedFiles: 0, metadataMs: 0, parseMs: 0 };
      }, dispose() {},
    }));
  t.after(() => provider.dispose());
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => {
    verificationClock += 60_000;
    return new Map();
  });
  const first = await provider.refresh();
  assert.equal(first.snapshot.currentManifestVerified, true);
  const census = first.snapshot.weeklyValueInputs?.codexCalibrationCensus;
  assert.equal(isCodexCalibrationCensus(census), true);
  assert.equal(census?.sources.length, 1);
  assert.equal(census?.verifiedAt, verificationBeganAt,
    'parsing/title latency cannot manufacture fresh authority for an older source census');
  assert.equal(isCodexCalibrationCensus(JSON.parse(JSON.stringify(census))), false);
  fail = true;
  const failed = await provider.refresh();
  assert.equal(failed.snapshot.currentManifestVerified, false);
  assert.equal(failed.snapshot.weeklyValueInputs?.codexCalibrationCensus, undefined,
    'display-only snapshots cannot keep an old authority capable of waiving uncertainty');
});
