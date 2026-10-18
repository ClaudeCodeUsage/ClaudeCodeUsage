import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const shardCount = 4;
const comparePath = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const count = (n) => Number.isSafeInteger(n) && n > 0;

function relativeFile(file) {
  if (typeof file !== 'string' || !file.startsWith('tests/ui/') || file.includes('\\') ||
      /[\x00-\x1f\x7f:]/.test(file) || file.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid repository-relative UI file path');
  }
  return file;
}

function validateFiles(files, timings = false) {
  if (!Array.isArray(files)) throw new Error('Expected UI files array');
  const seen = new Set();
  for (const item of files) {
    if (!item || typeof item !== 'object') throw new Error('Invalid UI file entry');
    relativeFile(item.file);
    if (seen.has(item.file)) throw new Error(`Duplicate UI file path: ${item.file}`);
    seen.add(item.file);
    if (!count(item.tests)) throw new Error(`Invalid UI test count: ${item.file}`);
    if (timings && !positive(item.milliseconds)) throw new Error(`Invalid UI timing: ${item.file}`);
  }
}

export function parseArgs(args) {
  let shard;
  let plan = false;
  for (const arg of args) {
    const match = /^--shard=([1-4])\/4$/.exec(arg);
    if (match && shard === undefined) shard = Number(match[1]);
    else if (arg === '--plan' && !plan) plan = true;
    else throw new Error('Usage: node .github/scripts/ui-shards.mjs --shard=1/4 [--plan]');
  }
  if (shard === undefined) throw new Error('Exactly one --shard=1/4 through --shard=4/4 is required');
  return { shard, plan };
}

export function validateTimings(baseline) {
  if (!baseline || baseline.schemaVersion !== 1 || !baseline.source ||
      !count(baseline.source.runId) || typeof baseline.source.method !== 'string' ||
      !baseline.source.method.trim() || typeof baseline.source.limitations !== 'string' ||
      !baseline.source.limitations.trim()) throw new Error('Invalid UI timing baseline/provenance');
  validateFiles(baseline.files, true);
  return baseline;
}

// The pinned JSON reporter uses config.rootDir-relative locations. Read the
// top-level file suite (the require-file), not nested test declaration locations,
// so imported declarations and serial groups remain with their owning file.
export function filesFromReport(report, root = repositoryRoot) {
  if (!report || !Array.isArray(report.errors) || report.errors.length ||
      !Array.isArray(report.suites) || !report.suites.length ||
      typeof report.config?.rootDir !== 'string' || !path.isAbsolute(report.config.rootDir)) {
    throw new Error('Invalid, failed or empty Playwright discovery report');
  }
  function testsIn(suite) {
    if (!suite || !Array.isArray(suite.specs) || (suite.suites !== undefined && !Array.isArray(suite.suites))) {
      throw new Error('Malformed Playwright file suite');
    }
    let tests = 0;
    for (const spec of suite.specs) {
      if (!Array.isArray(spec.tests) || !spec.tests.length) throw new Error('Malformed Playwright test entry');
      tests += spec.tests.length;
    }
    for (const nested of suite.suites ?? []) tests += testsIn(nested);
    if (!Number.isSafeInteger(tests)) throw new Error('UI test count overflow');
    return tests;
  }
  const files = report.suites.map((suite) => {
    if (typeof suite.file !== 'string' || path.isAbsolute(suite.file) || suite.file.includes('\\') ||
        suite.file.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Invalid Playwright discovery file path');
    }
    const file = path.relative(root, path.resolve(report.config.rootDir, suite.file)).split(path.sep).join('/');
    return { file: relativeFile(file), tests: testsIn(suite) };
  });
  validateFiles(files);
  return files;
}

export function balanceFiles(currentFiles, baseline) {
  validateTimings(baseline);
  validateFiles(currentFiles);
  if (currentFiles.length < shardCount) throw new Error('Cannot populate all four UI shards; refusing an empty shard');
  const historical = new Map(baseline.files.map((item) => [item.file, item]));
  // Unknown files use the slowest observed per-file average (at least 1s/test),
  // including deleted historical files. Never use the baseline as an allowlist.
  const fallback = Math.max(1000, ...baseline.files.map((item) => item.milliseconds / item.tests));
  const weighted = currentFiles.map(({ file, tests }) => {
    const previous = historical.get(file);
    const milliseconds = previous ? previous.milliseconds * (tests / previous.tests) : fallback * tests;
    if (!positive(milliseconds)) throw new Error('UI timing weight must be finite and positive (overflow)');
    return { file, tests, milliseconds };
  }).sort((a, b) => b.milliseconds - a.milliseconds || comparePath(a.file, b.file));
  const shards = Array.from({ length: shardCount }, (_, i) => ({ shard: i + 1, tests: 0, milliseconds: 0, files: [] }));
  for (const file of weighted) {
    let target = shards[0];
    for (const shard of shards) if (shard.milliseconds < target.milliseconds) target = shard;
    target.files.push(file);
    target.tests += file.tests;
    target.milliseconds += file.milliseconds;
    if (!positive(target.milliseconds) || !count(target.tests)) throw new Error('UI shard total overflow');
  }
  for (const shard of shards) shard.files.sort((a, b) => comparePath(a.file, b.file));
  return shards;
}

export function exactFilePattern(root, file) {
  relativeFile(file);
  // Playwright 1.64.1 positional filters are regexes over absolute paths.
  // Its forceRegExp treats bare regexes as gi; explicit /.../ uses no flags,
  // preserving exact case on Linux. Escaping ':' avoids :line:column syntax.
  return '/^' + path.resolve(root, file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(':', '\\x3a') + '$/';
}

function childStatus(result) {
  if (result.error) throw result.error;
  if (Number.isInteger(result.status) && result.status >= 0) return result.status;
  if (result.signal) return 128 + (constants.signals[result.signal] ?? 1);
  throw new Error('Playwright child exited without a status or signal');
}

export function run(args, { root = repositoryRoot, baseline, spawn = spawnSync, log = console.log } = {}) {
  const options = parseArgs(args);
  baseline ??= JSON.parse(readFileSync(path.join(root, '.github/scripts/ui-timings.json'), 'utf8'));
  validateTimings(baseline);
  const cli = path.join(root, 'node_modules/@playwright/test/cli.js');
  const installed = JSON.parse(readFileSync(path.join(root, 'node_modules/@playwright/test/package.json'), 'utf8'));
  if (installed.version !== '1.64.1') throw new Error('UI shard runner requires pinned local Playwright 1.64.1');
  const env = { ...process.env };
  // Force discovery JSON to stdout, even if a caller configured a reporter file.
  for (const key of ['PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_DIR']) delete env[key];
  const discovery = spawn(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
    cwd: root, shell: false, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const discoveryStatus = childStatus(discovery);
  if (discoveryStatus !== 0) return discoveryStatus;
  const shards = balanceFiles(filesFromReport(JSON.parse(discovery.stdout), root), baseline);
  const selected = shards[options.shard - 1];
  if (!selected.files.length || !selected.tests) throw new Error('Refusing empty UI shard');
  if (options.plan) {
    log(JSON.stringify({ approximate: true, sourceRun: baseline.source.runId,
      selectedShard: options.shard, tests: shards.reduce((n, s) => n + s.tests, 0), shards }, null, 2));
    return 0;
  }
  log(`UI shard ${selected.shard}/4: ${selected.files.length} files, ${selected.tests} tests; approximate historical cost ${Math.round(selected.milliseconds)}ms`);
  // No Playwright sharding/fully-parallel override: whole files and their serial
  // groups stay together. Retain configured retries/reporters and failure rules.
  return childStatus(spawn(process.execPath, [cli, 'test', '--workers=1',
    ...selected.files.map((file) => exactFilePattern(root, file.file))], {
    cwd: root, shell: false, stdio: 'inherit',
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    console.error(`UI sharding failed: ${error.message}`);
    process.exitCode = 1;
  }
}
