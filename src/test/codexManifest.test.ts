import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CodexPersistedManifest,
  diffCodexManifest,
  pseudonymousFileKey,
  resolveCodexHome,
  scanCodexManifest,
} from '../providers/codex/codexManifest';

test('Codex discovery reads only allowlisted JSONL roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-manifest-'));
  try {
    await mkdir(path.join(root, 'sessions', '2026', '07'), { recursive: true });
    await mkdir(path.join(root, 'archived_sessions'), { recursive: true });
    await mkdir(path.join(root, 'unknown'), { recursive: true });
    await writeFile(
      path.join(root, 'sessions', '2026', '07', 'rollout-live.jsonl'),
      '{}\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'archived_sessions', 'rollout-archive.jsonl'),
      '{}\n',
      'utf8',
    );
    await writeFile(path.join(root, 'auth.json'), '{"secret":true}', 'utf8');
    await writeFile(path.join(root, 'state.sqlite'), 'private', 'utf8');
    await writeFile(path.join(root, 'unknown', 'rollout-hidden.jsonl'), '{}\n', 'utf8');
    await symlink(
      path.join(root, 'unknown'),
      path.join(root, 'sessions', 'linked-unknown'),
    );

    const manifest = await scanCodexManifest(root, 'machine-salt');

    assert.deepEqual(
      manifest.files.map((file) => file.sourceArea).sort(),
      ['archive', 'sessions'],
    );
    assert.equal(manifest.files.every((file) => path.isAbsolute(file.absolutePath)), true);
    assert.doesNotMatch(
      JSON.stringify(manifest.persistable),
      /auth\.json|state\.sqlite|rollout-|unknown|\.jsonl/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex home resolution and pseudonyms are deterministic', () => {
  assert.equal(
    resolveCodexHome('/custom/codex', { CODEX_HOME: '/env/codex' }, '/home/user'),
    path.resolve('/custom/codex'),
  );
  assert.equal(
    resolveCodexHome('', { CODEX_HOME: '/env/codex' }, '/home/user'),
    path.resolve('/env/codex'),
  );
  assert.equal(
    resolveCodexHome('', {}, '/home/user'),
    path.join('/home/user', '.codex'),
  );

  const first = pseudonymousFileKey('salt', '/private/a.jsonl');
  assert.equal(first, pseudonymousFileKey('salt', '/private/a.jsonl'));
  assert.notEqual(first, pseudonymousFileKey('salt', '/private/b.jsonl'));
  assert.doesNotMatch(first, /private|jsonl/);
});

test('manifest diff separates append, truncate, replace, archive move, and delete', () => {
  const previous: CodexPersistedManifest = {
    unchanged: { fileKey: 'unchanged', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 1 },
    append: { fileKey: 'append', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 2 },
    truncate: { fileKey: 'truncate', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 3 },
    replace: { fileKey: 'replace', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 4 },
    moveOld: { fileKey: 'moveOld', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 5 },
    deleted: { fileKey: 'deleted', sourceArea: 'sessions', size: 10, mtimeMs: 1, dev: 1, ino: 6 },
  };
  const current: CodexPersistedManifest = {
    unchanged: { ...previous.unchanged },
    append: { ...previous.append, size: 20, mtimeMs: 2 },
    truncate: { ...previous.truncate, size: 5, mtimeMs: 2 },
    replace: { ...previous.replace, mtimeMs: 2, ino: 40 },
    moveNew: { fileKey: 'moveNew', sourceArea: 'archive', size: 10, mtimeMs: 2, dev: 1, ino: 5 },
    added: { fileKey: 'added', sourceArea: 'sessions', size: 3, mtimeMs: 2, dev: 1, ino: 7 },
  };

  assert.deepEqual(diffCodexManifest(previous, current), {
    unchanged: ['unchanged'],
    appended: ['append'],
    truncated: ['truncate'],
    replaced: ['replace'],
    moved: [{ fromKey: 'moveOld', toKey: 'moveNew' }],
    added: ['added'],
    removed: ['deleted'],
  });
});
