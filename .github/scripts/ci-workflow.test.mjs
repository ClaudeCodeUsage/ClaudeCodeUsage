import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../workflows/test.yml', import.meta.url), 'utf8');
function job(source, id) {
  const matches = [...source.matchAll(new RegExp(`^  ${id}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'gm'))];
  assert.equal(matches.length, 1, id);
  return matches[0][1];
}
function check(source) {
  assert.match(source, /^concurrency:\n  group: \$\{\{ github.workflow \}\}-\$\{\{ github.event.pull_request.number \|\| github.ref \}\}\n  cancel-in-progress: true$/m);
  assert.doesNotMatch(source, /paths-ignore:|pull_request_target:|continue-on-error:|\|\| true/);
  const scope = job(source, 'scope');
  assert.match(scope, /fetch-depth: 0/);
  assert.match(scope, /ui_required: \$\{\{ steps.scope.outputs.ui_required \}\}/);
  assert.match(scope, /run: node \.github\/scripts\/ci-scope.mjs$/m);
  assert.doesNotMatch(scope, /^\s+if:/m);
  const shards = job(source, 'ui_shards');
  assert.match(shards, /^    needs: \[scope\]$/m);
  assert.match(shards, /^    if: needs.scope.outputs.ui_required == 'true'$/m);
  assert.match(shards, /^        shard: \[1, 2, 3, 4\]$/m);
  assert.doesNotMatch(shards, /exclude:|include:|--grep|--only-changed|--last-failed/);
  assert.match(shards, /run: npm run compile/);
  assert.match(shards, /run: node \.github\/scripts\/ui-shards.mjs --shard=\$\{\{ matrix.shard \}\}\/4$/m);
  const gate = job(source, 'ui');
  assert.match(gate, /^    name: UI Test$/m);
  assert.match(gate, /^    needs: \[scope, ui_shards\]$/m);
  assert.match(gate, /^    if: always\(\)$/m);
  for (const [name, value] of [['SCOPE_RESULT', 'needs.scope.result'],
    ['UI_REQUIRED', 'needs.scope.outputs.ui_required'], ['SHARDS_RESULT', 'needs.ui_shards.result']]) {
    assert.ok(gate.includes(`${name}: \${{ ${value} }}`));
  }
  assert.match(gate, /run: node \.github\/scripts\/ci-scope.mjs --gate$/m);
  assert.match(job(source, 'package'), /^    needs: \[test, ui\]$/m);
  assert.match(job(source, 'package'), /^    if: \$\{\{ !cancelled\(\) && needs.test.result == 'success' && needs.ui.result == 'success' \}\}$/m);
  assert.doesNotMatch(job(source, 'test'), /^\s+if:/m);
}

test('CI cancels only obsolete same-ref tests, uses verified docs scope and retains stable gates', () => check(workflow));
test('CI rejects bypassed classification, incomplete shards, cancelled gate masking and package shortcuts', () => {
  for (const [before, after] of [
    ['github.event.pull_request.number || github.ref', "'all-prs'"],
    ['fetch-depth: 0', 'fetch-depth: 1'],
    ["if: needs.scope.outputs.ui_required == 'true'", 'if: false'],
    ['shard: [1, 2, 3, 4]', 'shard: [1, 2, 3]'],
    ['shard: [1, 2, 3, 4]', 'shard: [1, 2, 3, 4]\n        exclude: [{ shard: 4 }]'],
    ['--shard=${{ matrix.shard }}/4', '--shard=1/4'],
    ['--shard=${{ matrix.shard }}/4', '--shard=${{ matrix.shard }}/4 --grep smoke'],
    ['needs: [scope, ui_shards]', 'needs: [ui_shards]'],
    ['if: always()', 'if: success()'],
    ['SCOPE_RESULT: ${{ needs.scope.result }}', 'SCOPE_RESULT: success'],
    ['UI_REQUIRED: ${{ needs.scope.outputs.ui_required }}', 'UI_REQUIRED: false'],
    ['SHARDS_RESULT: ${{ needs.ui_shards.result }}', 'SHARDS_RESULT: success'],
    ['needs: [test, ui]', 'needs: [test]'],
    ["!cancelled() && needs.test.result == 'success' && needs.ui.result == 'success'", "always()"],
    ["!cancelled() && needs.test.result == 'success' && needs.ui.result == 'success'", "needs.test.result == 'success' && needs.ui.result == 'success'"],
    ['run: node .github/scripts/ci-scope.mjs --gate', 'run: true'],
  ]) {
    assert.ok(workflow.includes(before), before);
    assert.throws(() => check(workflow.replace(before, after)), before);
  }
});

test('package condition accepts successful docs gates despite skipped UI ancestors, never failed or cancelled runs', () => {
  const condition = job(workflow, 'package').match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(condition, 'an explicit status function is required to bypass implicit transitive success()');
  assert.match(condition, /!cancelled\(\)/);
  const values = ['success', 'failure', 'cancelled', 'skipped', '', 'unknown'];
  for (const node of values) for (const ui of values) for (const wasCancelled of [false, true]) {
    const observed = runInNewContext(condition.replace('cancelled()', 'wasCancelled'), {
      needs: { test: { result: node }, ui: { result: ui } }, wasCancelled,
    }, { timeout: 100 });
    assert.equal(observed, !wasCancelled && node === 'success' && ui === 'success', `${node}/${ui}/${wasCancelled}`);
  }
});
