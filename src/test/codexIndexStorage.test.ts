import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexProvider } from '../providers/codex/codexProvider';
import { codexIndexStoragePath } from '../providers/codex/codexIndexStorage';
import { createEmptyCodexIndex, saveCodexIndexAtomic } from '../providers/codex/codexIndex';

async function fixture(home: string, count: number): Promise<void> {
  await mkdir(path.join(home, 'sessions'), { recursive: true });
  for (let n = 0; n < count; n += 1) {
    await writeFile(path.join(home, 'sessions', `${n}.jsonl`), [
      { type: 'session_meta', timestamp: '2026-10-04T00:00:00Z', payload: { id: `fixture-${n}` } },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'max' } },
      { type: 'event_msg', timestamp: '2026-10-04T00:01:00Z', payload: {
        type: 'token_count', info: { last_token_usage: {
          input_tokens: 100, cached_input_tokens: 80, output_tokens: 10,
        } },
      } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
  }
}

function provider(storage: string, home: string, salt = 'fixture-salt', legacyIndexPath?: string): CodexProvider {
  return new CodexProvider({
    enabled: true, codexHome: home, salt, timeZone: 'UTC',
    indexPath: codexIndexStoragePath(storage, home, salt, 'UTC'),
    ...(legacyIndexPath ? { legacyIndexPath } : {}),
  });
}

test('an owned legacy index is adopted once without rereading unchanged source bodies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-index-adopt-'));
  const home = path.join(root, 'home');
  const legacyPath = path.join(root, 'storage', 'codex-index-v1.json');
  const old = new CodexProvider({ enabled: true, codexHome: home, indexPath: legacyPath, salt: 'fixture-salt', timeZone: 'UTC' });
  const next = provider(path.dirname(legacyPath), home, 'fixture-salt', legacyPath);
  try {
    await fixture(home, 2);
    const initial = await old.refresh();
    assert.equal(initial.snapshot.coverage.complete, true);
    const before = await readFile(legacyPath, 'utf8');
    const adopted = await next.refresh();
    assert.equal(adopted.diagnostic?.bodyReads, 0);
    assert.deepEqual(adopted.snapshot.total, initial.snapshot.total);
    assert.equal(await readFile(legacyPath, 'utf8'), before, 'migration must preserve rollback input');
    await next.dispose();
    const restarted = provider(path.dirname(legacyPath), home, 'fixture-salt', legacyPath);
    try { assert.equal((await restarted.refresh()).diagnostic?.bodyReads, 0); }
    finally { await restarted.dispose(); }
  } finally { await old.dispose(); await next.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('shared storage survives concurrent different homes, restart, and A-B-A switching', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-index-isolation-'));
  const storage = path.join(root, 'storage');
  const a = provider(storage, path.join(root, 'a'));
  const b = provider(storage, path.join(root, 'b'));
  try {
    await fixture(path.join(root, 'a'), 2);
    await fixture(path.join(root, 'b'), 1);
    const [firstA, firstB] = await Promise.all([a.refresh(), b.refresh()]);
    assert.equal(firstA.snapshot.coverage.totalFiles, 2);
    assert.equal(firstB.snapshot.coverage.totalFiles, 1);
    const aPath = codexIndexStoragePath(storage, path.join(root, 'a'), 'fixture-salt', 'UTC');
    const beforeA = await readFile(aPath, 'utf8');
    await b.refresh();
    assert.equal(await readFile(aPath, 'utf8'), beforeA);
    await a.dispose();
    const again = provider(storage, path.join(root, 'a'));
    try {
      const warm = await again.refresh();
      assert.equal(warm.diagnostic?.bodyReads, 0);
      assert.deepEqual(warm.snapshot.total, firstA.snapshot.total);
    } finally { await again.dispose(); }
  } finally { await a.dispose(); await b.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('a foreign or malformed legacy cache is never hydrated, copied, or quarantined', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-index-foreign-'));
  const storage = path.join(root, 'storage');
  const legacyPath = path.join(storage, 'codex-index-v1.json');
  const old = new CodexProvider({ enabled: true, codexHome: path.join(root, 'other'), indexPath: legacyPath, salt: 'fixture-salt', timeZone: 'UTC' });
  try {
    await fixture(path.join(root, 'other'), 2);
    await old.refresh();
    const foreign = await readFile(legacyPath, 'utf8');
    const key = Object.keys(JSON.parse(foreign).files)[0];
    const invalidOwned = JSON.stringify({ schemaVersion: 3, files: { [key]: { fileKey: key } } });
    for (const [n, contents] of [foreign, '{malformed', invalidOwned].entries()) {
      const home = path.join(root, `new-${n}`);
      await fixture(home, 1);
      await writeFile(legacyPath, contents);
      const next = provider(storage, home, 'fixture-salt', legacyPath);
      try {
        assert.equal(await next.loadPersistedSnapshot(), null);
        const result = await next.refresh();
        assert.equal(result.snapshot.coverage.totalFiles, 1);
        assert.ok((result.diagnostic?.bodyReads ?? 0) > 0);
        assert.equal(await readFile(legacyPath, 'utf8'), contents);
      } finally { await next.dispose(); }
    }
  } finally { await old.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('explicit scoped rebuild cannot resurrect an old legacy index or its quota history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-index-rebuild-'));
  const home = path.join(root, 'home');
  const legacyPath = path.join(root, 'storage', 'codex-index-v1.json');
  const old = new CodexProvider({ enabled: true, codexHome: home, indexPath: legacyPath, salt: 'fixture-salt', timeZone: 'UTC' });
  const next = provider(path.dirname(legacyPath), home, 'fixture-salt', legacyPath);
  try {
    await fixture(home, 1);
    await old.refresh();
    await saveCodexIndexAtomic(next.indexPath, createEmptyCodexIndex('UTC'));
    assert.ok(((await next.refresh()).diagnostic?.bodyReads ?? 0) > 0);
    assert.doesNotMatch(await readFile(next.indexPath, 'utf8'), /fixture-salt|fixture-0|home/);
  } finally { await old.dispose(); await next.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('ownership proof does not trust a shared container quota history or an invalid owned schema', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-index-owned-guards-'));
  const home = path.join(root, 'home');
  const storage = path.join(root, 'storage');
  const legacyPath = path.join(storage, 'codex-index-v1.json');
  const old = new CodexProvider({ enabled: true, codexHome: home, indexPath: legacyPath, salt: 'fixture-salt', timeZone: 'UTC' });
  try {
    await fixture(home, 1);
    await old.refresh();
    const raw = JSON.parse(await readFile(legacyPath, 'utf8'));
    raw.quotaHistory = [{ provider: 'codex', observedAt: Date.now(),
      resetAt: Date.now() + 7 * 86_400_000, usedPercent: 91 }];
    await writeFile(legacyPath, JSON.stringify(raw));
    const adopted = provider(storage, home, 'fixture-salt', legacyPath);
    try {
      const result = await adopted.refresh();
      assert.equal(result.diagnostic?.bodyReads, 0);
      assert.deepEqual(JSON.parse(await readFile(adopted.indexPath, 'utf8')).quotaHistory ?? [], []);
    } finally { await adopted.dispose(); }
    const indexPath = codexIndexStoragePath(storage, home, 'fixture-salt', 'UTC');
    await rm(indexPath);
    const key = Object.keys(raw.files)[0];
    await writeFile(legacyPath, JSON.stringify({ schemaVersion: 3, files: { [key]: { fileKey: key } } }));
    const invalid = provider(storage, home, 'fixture-salt', legacyPath);
    try {
      const before = await readFile(legacyPath, 'utf8');
      const result = await invalid.refresh();
      assert.notEqual(result.outcome, 'error');
      assert.ok((result.diagnostic?.bodyReads ?? 0) > 0);
      assert.equal(await readFile(legacyPath, 'utf8'), before);
    } finally { await invalid.dispose(); }
  } finally { await old.dispose(); await rm(root, { recursive: true, force: true }); }
});
