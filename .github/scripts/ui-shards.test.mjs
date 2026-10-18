import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  balanceFiles, exactFilePattern, filesFromReport, parseArgs, run, validateTimings,
} from './ui-shards.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cli = path.join(root, 'node_modules/@playwright/test/cli.js');
const baseline = JSON.parse(readFileSync(new URL('./ui-timings.json', import.meta.url)));
const entry = (name, tests = 1, milliseconds = 1000) => ({ file: `tests/ui/${name}.spec.mjs`, tests, milliseconds });
const timing = (files) => ({ ...baseline, files });
const report = (files) => ({ config: { rootDir: path.join(root, 'tests/ui') }, errors: [],
  suites: files.map(({ file, tests }) => ({ file: path.relative('tests/ui', file), specs: [],
    suites: [{ specs: Array.from({ length: tests }, () => ({ tests: [{ projectId: 'chromium' }] })) }] })) });
const discover = () => {
  const result = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test('bounded CLI accepts exactly one shard and optional evidence-only plan', () => {
  for (let i = 1; i <= 4; i++) assert.deepEqual(parseArgs([`--shard=${i}/4`]), { shard: i, plan: false });
  assert.deepEqual(parseArgs(['--plan', '--shard=2/4']), { shard: 2, plan: true });
  for (const args of [[], ['--plan'], ['--shard=0/4'], ['--shard=5/4'], ['--shard=1/5'],
    ['--shard=01/4'], ['--shard=1/4', '--shard=2/4'], ['--shard=1/4', '--plan', '--plan'],
    ['--shard=1/4', '--grep=x'], ['--shard=1/4', '--pass-with-no-tests'], ['--shard=1/4', 'x']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('deterministic file LPT balances heterogeneous costs and ties by path then shard', () => {
  const files = [9, 8, 7, 6, 5, 4, 3, 2].map((ms, i) => entry(String(i), 1, ms));
  const plan = balanceFiles(files, timing(files));
  assert.deepEqual(plan.map((s) => s.milliseconds), [11, 11, 11, 11]);
  assert.deepEqual(balanceFiles([...files].reverse(), timing(files)), plan);
  const equal = ['d', 'c', 'b', 'a'].map((s) => entry(s));
  assert.deepEqual(balanceFiles(equal, timing(equal)).map((s) => s.files[0].file), [...equal].reverse().map((s) => s.file));
});

test('new and renamed files use conservative nonzero costs; deleted files never enter plan', () => {
  const old = [entry('a', 2, 4000), entry('deleted', 1, 9000)];
  const current = [entry('a', 4), entry('renamed'), entry('new'), entry('fourth')];
  const files = balanceFiles(current, timing(old)).flatMap((s) => s.files);
  assert.equal(files.find((f) => f.file === current[0].file).milliseconds, 8000);
  assert.equal(files.find((f) => f.file === current[1].file).milliseconds, 9000);
  assert.deepEqual(files.map((f) => f.file).sort(), current.map((f) => f.file).sort());
  assert.equal(balanceFiles(current, timing([])).flatMap((s) => s.files).every((f) => f.milliseconds > 0), true);
  assert.equal(balanceFiles([entry('a', 1), ...current.slice(1)], timing(old)).flatMap((s) => s.files).find((f) => f.file === old[0].file).milliseconds, 2000);
});

test('invalid timing schema, paths, duplicates and nonpositive/nonfinite numeric data fail explicitly', () => {
  for (const bad of [null, {}, { ...baseline, schemaVersion: 2 }, { ...baseline, source: {} },
    timing({}), timing([entry('a'), entry('a')]), timing([{ ...entry('a'), file: '/private/x' }]),
    timing([{ ...entry('a'), file: 'tests/ui/../a' }]), timing([{ ...entry('a'), file: 'tests\\ui\\a' }])]) {
    assert.throws(() => validateTimings(bad));
  }
  for (const field of ['tests', 'milliseconds']) for (const value of [0, -1, NaN, Infinity, '1', null]) {
    assert.throws(() => validateTimings(timing([{ ...entry('a'), [field]: value }])));
  }
  assert.throws(() => validateTimings(timing([entry('a', 1.5)])));
  const files = ['a', 'b', 'c', 'd'].map((s) => entry(s));
  assert.throws(() => balanceFiles([...files, files[0]], timing(files)), /duplicate/i);
  assert.throws(() => balanceFiles([entry('a', Number.MAX_SAFE_INTEGER), ...files.slice(1)], timing([entry('a', 1, Number.MAX_VALUE)])), /finite|overflow/i);
});

test('manifest rejects errors, malformed/empty files, duplicate paths and empty suite', () => {
  for (const bad of [{}, { errors: [], suites: [] }, { ...report([entry('a')]), errors: [{ message: 'broken' }] },
    report([entry('a'), entry('a')]), report([entry('a', 0)]),
    { ...report([entry('a')]), suites: [{ file: '../escape', specs: [] }] }]) {
    assert.throws(() => filesFromReport(bad, root));
  }
  const r = report([entry('a')]);
  r.suites[0].suites[0].specs[0].tests.push({ projectId: 'second' });
  assert.equal(filesFromReport(r, root)[0].tests, 2);
});

test('absolute exact patterns escape every regex metacharacter and cannot match adjacent paths', () => {
  for (const file of ['tests/ui/a [x](y)+$^{}|?.spec.mjs', 'tests/ui/a.*.spec.mjs', 'tests/ui/a space.spec.mjs']) {
    const absolute = path.resolve(root, file);
    const pattern = exactFilePattern(root, file);
    assert.ok(pattern.startsWith('/^') && pattern.endsWith('$/'));
    const re = new RegExp(pattern.slice(1, -1));
    assert.equal(re.test(absolute), true);
    for (const other of [absolute + '.bak', absolute + '/child', 'prefix' + absolute, absolute.replace('.spec', 'Xspec'), absolute.toUpperCase()]) assert.equal(re.test(other), false);
  }
});

test('current pinned unfiltered manifest is a disjoint all-file union with no test omissions', () => {
  const current = filesFromReport(discover(), root);
  const shards = balanceFiles(current, baseline);
  const selected = shards.flatMap((s) => s.files);
  assert.equal(new Set(selected.map((f) => f.file)).size, current.length);
  assert.deepEqual(selected.map((f) => [f.file, f.tests]).sort(), current.map((f) => [f.file, f.tests]).sort());
  assert.equal(selected.reduce((n, f) => n + f.tests, 0), current.reduce((n, f) => n + f.tests, 0));
  assert.equal(shards.every((s) => s.files.length > 0), true);
});

test('actual pinned CLI exact file filters rediscover all selected tests in each shard', () => {
  const shards = balanceFiles(filesFromReport(discover(), root), baseline);
  for (const shard of shards) {
    const patterns = shard.files.map((f) => exactFilePattern(root, f.file));
    const result = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json', ...patterns],
      { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const selected = filesFromReport(JSON.parse(result.stdout), root);
    assert.deepEqual(selected.map((f) => [f.file, f.tests]).sort(), shard.files.map((f) => [f.file, f.tests]).sort());
  }
});

test('exact CLI patterns are case-sensitive even though bare Playwright regexes default to gi', () => {
  const pattern = exactFilePattern(root, 'tests/ui/ACHIEVEMENT-CALENDAR-SUBSET.SPEC.MJS');
  const result = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json', pattern],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 1, 'A case-only different path must not select the original file');
});

test('actual CLI selects only the literal metacharacter/space/case path in an isolated manifest', (t) => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'ccu-ui [exact]+-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  mkdirSync(path.join(temporary, 'tests/ui'), { recursive: true });
  const config = path.join(temporary, 'playwright.config.mjs');
  writeFileSync(config, 'export default { testDir: "./tests/ui", workers: 1 };');
  const files = ['a [x](y)+$^{}|.spec.mjs', 'a space.spec.mjs', 'UPPER.spec.mjs', 'lower.spec.mjs'];
  for (const file of files) writeFileSync(path.join(temporary, 'tests/ui', file),
    `import { test } from ${JSON.stringify(path.join(root, 'node_modules/@playwright/test/index.mjs'))}; test('literal', () => {});`);
  for (const file of files) {
    const relative = `tests/ui/${file}`;
    const result = spawnSync(process.execPath, [cli, 'test', '--config', config, '--list', '--reporter=json', exactFilePattern(temporary, relative)],
      { cwd: temporary, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.status, 0, `${file}: ${result.stderr}\n${result.stdout}`);
    assert.deepEqual(filesFromReport(JSON.parse(result.stdout), temporary), [{ file: relative, tests: 1 }]);
  }
});

test('corrupt on-disk timing JSON fails before starting Playwright', (t) => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'ccu-ui-corrupt-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  mkdirSync(path.join(temporary, '.github/scripts'), { recursive: true });
  writeFileSync(path.join(temporary, '.github/scripts/ui-timings.json'), '{broken');
  let calls = 0;
  assert.throws(() => run(['--shard=1/4', '--plan'], { root: temporary, spawn: () => { calls++; } }), SyntaxError);
  assert.equal(calls, 0);
});

test('baseline contains only approximate relative-file aggregates from the complete 876-test run', () => {
  assert.equal(baseline.source.runId, 39041847767);
  assert.equal(baseline.source.tests, 876);
  assert.equal(baseline.files.reduce((n, f) => n + f.tests, 0), 876);
  assert.equal(baseline.source.jobs.reduce((n, j) => n + j.tests, 0), 876);
  assert.equal(baseline.files.reduce((n, f) => n + f.milliseconds, 0), baseline.source.jobs.reduce((n, j) => n + j.milliseconds, 0));
  for (const f of baseline.files) assert.deepEqual(Object.keys(f).sort(), ['file', 'milliseconds', 'tests']);
  assert.match(baseline.source.method, /[Aa]pproximate/);
  assert.match(baseline.source.limitations, /not exact/);
});

test('runner discovers unfiltered, executes exact files with one worker and propagates failure', () => {
  const files = ['a', 'b', 'c', 'd'].map((s) => entry(s));
  const calls = [];
  const status = run(['--shard=1/4'], { root, baseline: timing(files), log: () => {}, spawn: (command, args, options) => {
    calls.push({ command, args, options });
    return calls.length === 1 ? { status: 0, stdout: JSON.stringify(report(files)) } : { status: 17 };
  } });
  assert.equal(status, 17);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args.slice(1), ['test', '--list', '--reporter=json']);
  assert.deepEqual(calls[1].args.slice(1), ['test', '--workers=1', exactFilePattern(root, files[0].file)]);
  for (const call of calls) assert.equal(call.options.shell, false);
});

test('discovery failure, signal, spawn error, corrupt JSON or no tests cannot succeed', () => {
  for (const failure of [{ status: 23 }, { status: null, signal: 'SIGTERM' }, { status: null, error: Error('spawn failed') }]) {
    let calls = 0;
    const invoke = () => run(['--shard=1/4'], { root, baseline, log: () => {}, spawn: () => { calls++; return failure; } });
    if (failure.status) assert.equal(invoke(), 23);
    else if (failure.signal) assert.equal(invoke(), 143);
    else assert.throws(invoke, /spawn failed/);
    assert.equal(calls, 1);
  }
  for (const output of ['not json', JSON.stringify(report([])), JSON.stringify(report([entry('a')]))]) {
    let calls = 0;
    assert.throws(() => run(['--shard=4/4'], { root, baseline, log: () => {}, spawn: () => { calls++; return { status: 0, stdout: output }; } }));
    assert.equal(calls, 1);
  }
});

test('execution status, signal and spawn errors propagate after successful discovery', () => {
  const files = ['a', 'b', 'c', 'd'].map((s) => entry(s));
  for (const failure of [{ status: 0 }, { status: 19 }, { status: null, signal: 'SIGTERM' }, { error: Error('execution spawn failed') }]) {
    let calls = 0;
    const invoke = () => run(['--shard=1/4'], { root, baseline: timing(files), log: () => {}, spawn: () => {
      calls++;
      return calls === 1 ? { status: 0, stdout: JSON.stringify(report(files)) } : failure;
    } });
    if (failure.error) assert.throws(invoke, /execution spawn failed/);
    else assert.equal(invoke(), failure.status ?? 143);
    assert.equal(calls, 2);
  }
});

test('plan mode still requires nonempty discovery and valid timings, but never runs tests', () => {
  let calls = 0;
  assert.equal(run(['--shard=1/4', '--plan'], { root, baseline, log: () => {}, spawn: () => {
    calls++; return { status: 0, stdout: JSON.stringify(report(['a', 'b', 'c', 'd'].map((s) => entry(s)))) };
  } }), 0);
  assert.equal(calls, 1);
  assert.throws(() => run(['--shard=1/4', '--plan'], { root, baseline: timing([{ ...entry('bad'), milliseconds: -1 }]), log: () => {}, spawn: () => { throw Error('should not spawn'); } }), /timing/i);
});
