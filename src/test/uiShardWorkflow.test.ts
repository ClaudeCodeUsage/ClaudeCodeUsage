import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as path from 'node:path';
test('canonical UI shards cover the full suite and retain a fail-closed stable gate',()=>{
  const file=readFileSync(path.resolve(__dirname,'../../.github/workflows/test.yml'),'utf8');
  assert.match(file,/ui_shards:[\s\S]*shard: \[1, 2, 3, 4\]/);
  assert.match(file,/fail-fast: false/);
  assert.match(file,/image: mcr\.microsoft\.com\/playwright:v1\.64\.1-noble@sha256:[a-f0-9]{64}/);
  assert.match(file,/PLAYWRIGHT_BROWSERS_PATH: \/ms-playwright/);
  assert.ok(file.includes('npm run test:ui -- --fully-parallel --workers=1 --shard=$'+'{{ matrix.shard }}/4'));
  const aggregate=file.slice(file.indexOf('\n  ui:\n'),file.indexOf('\n  package:\n'));
  assert.match(aggregate,/name: UI Test/);
  assert.match(aggregate,/needs: \[ui_shards\]/);
  assert.match(aggregate,/if: always\(\)/);
  assert.ok(aggregate.includes("test '$"+"{{ needs.ui_shards.result }}' = 'success'"));
  assert.match(file,/needs: \[test, ui\]/);
});
