import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import { runCodexWorkerRefresh } from '../providers/codex/codexIndexWorker';
import { createEmptyCodexIndex } from '../providers/codex/codexIndex';
import { safeCodexIndexErrorCode } from '../providers/codex/codexWorkerProtocol';

test('unsupported host discovers compressed history but performs no index mutation or misleading success', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(zlib, 'createZstdDecompress');
  Object.defineProperty(zlib, 'createZstdDecompress', { value: undefined, configurable: true, writable: true });
  let releases = 0, writes = 0, updates = 0, adoptions = 0, loads = 0;
  const messages: any[] = [];
  try {
    await runCodexWorkerRefresh({ type: 'refresh', requestId: 'unsupported-fixture', codexHome: '/anonymous/source',
      indexPath: '/anonymous/derived', legacyIndexPath: '/anonymous/old-derived', salt: 'fixture', timeZone: 'UTC' }, {
      isCancelled: () => false, post: (message: any) => messages.push(message),
      acquireCodexIndexLease: async () => ({ release: async () => { releases++; } }),
      loadCodexIndex: async () => { loads++; return createEmptyCodexIndex('UTC'); },
      scanCodexManifest: async () => ({ files: [{ compression: 'zstd' }], persistable: {} }),
      updateCodexIndex: async () => { updates++; throw Error('must-not-run'); },
      saveCodexIndexAtomic: async () => { writes++; },
      adoptLegacyCodexIndex: async () => { adoptions++; return null; },
    } as any);
    assert.equal(releases, 1); assert.equal(writes, 0); assert.equal(updates, 0); assert.equal(adoptions, 0); assert.equal(loads, 0);
    assert.equal(messages.length, 1); assert.equal(messages[0].type, 'error');
    assert.equal(messages[0].error.code, 'zstd-unsupported');
    assert.doesNotMatch(JSON.stringify(messages), /anonymous|source|\.zst/);
    assert.equal(safeCodexIndexErrorCode('zstd-unsupported'), 'zstd-unsupported');
  } finally {
    if (descriptor) Object.defineProperty(zlib, 'createZstdDecompress', descriptor);
    else delete (zlib as any).createZstdDecompress;
  }
});

test('compressed cold backfill caps its worker pool separately from plain history', {
  skip: typeof zlib.createZstdDecompress !== 'function',
}, async () => {
  for (const compressed of [false, true]) {
    let limit: number | undefined = -1, disposed = 0;
    const index = createEmptyCodexIndex('UTC');
    await runCodexWorkerRefresh({ type: 'refresh', requestId: 'pool-limit', codexHome: '/anonymous/source',
      indexPath: '/anonymous/derived', salt: 'fixture', timeZone: 'UTC' }, {
      isCancelled: () => false, post: () => undefined,
      acquireCodexIndexLease: async () => ({ release: async () => undefined }),
      loadCodexIndex: async () => index,
      scanCodexManifest: async () => ({ files: [compressed ? { compression: 'zstd' } : {}], persistable: {} }),
      createCodexFilePassPool: (value: number | undefined) => { limit = value; return {
        run: async () => undefined, dispose: async () => { disposed++; },
      }; },
      updateCodexIndex: async () => ({ index, indexChanged: false, bodyReads: 0, failedFiles: 0,
        migration: { pending: false, filePasses: 0, bytesRead: 0 } }),
      saveCodexIndexAtomic: async () => undefined,
    } as any);
    assert.equal(limit, compressed ? 2 : undefined); assert.equal(disposed, 1);
  }
});
