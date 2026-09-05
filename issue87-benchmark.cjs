'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');

const repo = __dirname;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function elapsed(start) {
  return performance.now() - start;
}

async function generate(root, targetMiB, fileCount) {
  const projects = path.join(root, 'projects');
  await fsp.mkdir(projects, { recursive: true });
  const targetBytes = Math.floor(targetMiB * 1024 * 1024);
  const payload = 'x'.repeat(1_700);
  const linesPerFile = Math.max(1, Math.ceil(targetBytes / fileCount / 2_200));
  let totalBytes = 0;
  let totalLines = 0;
  const base = Date.UTC(2026, 6, 1);
  for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
    const projectIndex = fileIndex % 12;
    const project = path.join(projects, `-benchmark-project-${projectIndex}`);
    await fsp.mkdir(project, { recursive: true });
    const file = path.join(project, `session-${String(fileIndex).padStart(4, '0')}.jsonl`);
    const handle = await fsp.open(file, 'w');
    try {
      const title = JSON.stringify({
        type: 'custom-title',
        timestamp: new Date(base + fileIndex * 60_000).toISOString(),
        customTitle: `Benchmark session ${fileIndex}`,
      }) + '\n';
      await handle.write(title);
      totalBytes += Buffer.byteLength(title);
      totalLines += 1;
      for (let lineIndex = 0; lineIndex < linesPerFile; lineIndex += 1) {
        const serial = fileIndex * linesPerFile + lineIndex;
        const timestamp = new Date(base + (serial % (45 * 24 * 60)) * 60_000).toISOString();
        const record = lineIndex % 11 === 0
          ? {
              type: 'user',
              timestamp,
              uuid: `user-${fileIndex}-${lineIndex}`,
              cwd: `/benchmark/project-${projectIndex}`,
              gitBranch: `branch-${fileIndex % 8}`,
              message: { role: 'user', content: `Synthetic prompt ${serial} ${payload}` },
            }
          : {
              type: 'assistant',
              timestamp,
              uuid: `assistant-${fileIndex}-${lineIndex}`,
              requestId: `request-${fileIndex}-${lineIndex}`,
              cwd: `/benchmark/project-${projectIndex}`,
              gitBranch: `branch-${fileIndex % 8}`,
              message: {
                id: `message-${fileIndex}-${lineIndex}`,
                role: 'assistant',
                model: lineIndex % 3 === 0 ? 'claude-opus-4-1' : 'claude-sonnet-4-5',
                content: [{ type: 'text', text: payload }],
                usage: {
                  input_tokens: 1_000 + (lineIndex % 500),
                  output_tokens: 100 + (lineIndex % 80),
                  cache_creation_input_tokens: lineIndex % 5 === 0 ? 300 : 0,
                  cache_read_input_tokens: lineIndex % 5 === 0 ? 700 : 0,
                },
              },
            };
        const line = JSON.stringify(record) + '\n';
        await handle.write(line);
        totalBytes += Buffer.byteLength(line);
        totalLines += 1;
      }
    } finally {
      await handle.close();
    }
  }
  process.stdout.write(JSON.stringify({ totalBytes, totalLines, fileCount }) + '\n');
}

function loadWebview() {
  const originalLoad = Module._load;
  const vscodeStub = new Proxy(function () {}, {
    get: (_target, property) => property === 'then' ? undefined : vscodeStub,
    apply: () => vscodeStub,
    construct: () => vscodeStub,
  });
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscodeStub;
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };
  try {
    return require(path.join(repo, 'out', 'webview.js')).UsageWebviewProvider;
  } finally {
    Module._load = originalLoad;
  }
}

async function benchmark(root, label, repeats = 3) {
  const fsPromisesModule = require('node:fs/promises');
  const originalReadFile = fsPromisesModule.readFile;
  const originalJsonParse = JSON.parse;
  let readFileMs = 0;
  let readFileCalls = 0;
  let jsonParseMs = 0;
  let jsonParseCalls = 0;

  fsPromisesModule.readFile = async function (...args) {
    const start = performance.now();
    try {
      return await originalReadFile.apply(this, args);
    } finally {
      readFileMs += elapsed(start);
      readFileCalls += 1;
    }
  };
  JSON.parse = function (...args) {
    const start = performance.now();
    try {
      return originalJsonParse.apply(this, args);
    } finally {
      jsonParseMs += elapsed(start);
      jsonParseCalls += 1;
    }
  };

  const { scanUsageManifest } = require(path.join(repo, 'out', 'claudeUsageFiles.js'));
  const { ClaudeDataLoader } = require(path.join(repo, 'out', 'dataLoader.js'));
  const UsageWebviewProvider = loadWebview();

  const manifestRuns = [];
  let manifest;
  for (let i = 0; i < repeats; i += 1) {
    const start = performance.now();
    manifest = await scanUsageManifest([root]);
    manifestRuns.push(elapsed(start));
  }

  const loadRuns = [];
  const loadWithoutAnalysisRuns = [];
  const loadMetrics = [];
  const loadWithoutAnalysisMetrics = [];
  let loaded;
  for (let i = 0; i < repeats; i += 1) {
    readFileMs = 0;
    readFileCalls = 0;
    jsonParseMs = 0;
    jsonParseCalls = 0;
    const start = performance.now();
    loaded = await ClaudeDataLoader.loadUsageRecords(root, {
      manifest,
      analyzeContent: true,
      windowDays: 365,
    });
    const loadWallMs = elapsed(start);
    loadRuns.push(loadWallMs);
    loadMetrics.push({
      wallMs: loadWallMs,
      readMs: readFileMs,
      readCalls: readFileCalls,
      parseMs: jsonParseMs,
      parseCalls: jsonParseCalls,
    });

    readFileMs = 0;
    readFileCalls = 0;
    jsonParseMs = 0;
    jsonParseCalls = 0;
    const noAnalysisStart = performance.now();
    await ClaudeDataLoader.loadUsageRecords(root, {
      manifest,
      analyzeContent: false,
      windowDays: 365,
    });
    const noAnalysisWallMs = elapsed(noAnalysisStart);
    loadWithoutAnalysisRuns.push(noAnalysisWallMs);
    loadWithoutAnalysisMetrics.push({
      wallMs: noAnalysisWallMs,
      readMs: readFileMs,
      readCalls: readFileCalls,
      parseMs: jsonParseMs,
      parseCalls: jsonParseCalls,
    });
  }

  fsPromisesModule.readFile = originalReadFile;
  JSON.parse = originalJsonParse;

  const records = loaded.records;
  const dedupRuns = [];
  const createUniqueHash = ClaudeDataLoader.createUniqueHash.bind(ClaudeDataLoader);
  const tokenSum = ClaudeDataLoader.tokenSum.bind(ClaudeDataLoader);
  for (let i = 0; i < repeats; i += 1) {
    const seen = new Map();
    const start = performance.now();
    for (const record of records) {
      const hash = createUniqueHash(record);
      if (!hash) continue;
      const current = seen.get(hash);
      const tokens = tokenSum(record);
      if (current === undefined || tokens > current) seen.set(hash, tokens);
    }
    dedupRuns.push(elapsed(start));
  }
  const workspace = '/benchmark/project-0';
  const aggregators = [
    ['currentSession', () => ClaudeDataLoader.getCurrentSessionData(records, workspace)],
    ['today', () => ClaudeDataLoader.getTodayData(records)],
    ['thisMonth', () => ClaudeDataLoader.getThisMonthData(records)],
    ['allTime', () => ClaudeDataLoader.getAllTimeData(records)],
    ['dailyMonth', () => ClaudeDataLoader.getDailyDataForMonth(records)],
    ['dailyAllTime', () => ClaudeDataLoader.getDailyDataForAllTime(records)],
    ['hourlyToday', () => ClaudeDataLoader.getHourlyDataForToday(records)],
    ['sessions', () => ClaudeDataLoader.getSessionBreakdown(records)],
    ['projects', () => ClaudeDataLoader.getProjectBreakdown(records)],
    ['branches', () => ClaudeDataLoader.getBranchBreakdown(records)],
    ['workflows', () => ClaudeDataLoader.getWorkflowBreakdown(records)],
    ['costliestMessages', () => ClaudeDataLoader.getCostliestMessages(records)],
  ];
  const aggregateResults = {};
  const aggregateTimings = {};
  for (const [name, fn] of aggregators) {
    const times = [];
    let value;
    for (let i = 0; i < repeats; i += 1) {
      const start = performance.now();
      value = fn();
      times.push(elapsed(start));
    }
    aggregateTimings[name] = median(times);
    aggregateResults[name] = value;
  }

  const provider = new UsageWebviewProvider({ subscriptions: [] });
  provider.updateData(
    aggregateResults.currentSession,
    aggregateResults.today,
    aggregateResults.thisMonth,
    aggregateResults.allTime,
    aggregateResults.dailyMonth,
    aggregateResults.dailyAllTime,
    aggregateResults.hourlyToday,
    undefined,
    root,
    records,
    aggregateResults.sessions,
    aggregateResults.projects,
    loaded.contentAnalysis,
    aggregateResults.branches,
    aggregateResults.workflows,
    aggregateResults.costliestMessages,
  );
  const renderRuns = [];
  let html = '';
  for (let i = 0; i < repeats; i += 1) {
    const start = performance.now();
    html = provider.getMainContent();
    renderRuns.push(elapsed(start));
  }

  const aggregateTotalMs = Object.values(aggregateTimings).reduce((sum, value) => sum + value, 0);
  const withAnalysis = {
    wallMs: median(loadMetrics.map((value) => value.wallMs)),
    readMs: median(loadMetrics.map((value) => value.readMs)),
    readCalls: median(loadMetrics.map((value) => value.readCalls)),
    parseMs: median(loadMetrics.map((value) => value.parseMs)),
    parseCalls: median(loadMetrics.map((value) => value.parseCalls)),
  };
  const withoutAnalysis = {
    wallMs: median(loadWithoutAnalysisMetrics.map((value) => value.wallMs)),
    readMs: median(loadWithoutAnalysisMetrics.map((value) => value.readMs)),
    readCalls: median(loadWithoutAnalysisMetrics.map((value) => value.readCalls)),
    parseMs: median(loadWithoutAnalysisMetrics.map((value) => value.parseMs)),
    parseCalls: median(loadWithoutAnalysisMetrics.map((value) => value.parseCalls)),
  };
  const withAnalysisCpuRemainder = Math.max(
    0,
    withAnalysis.wallMs - withAnalysis.readMs - withAnalysis.parseMs,
  );
  const withoutAnalysisCpuRemainder = Math.max(
    0,
    withoutAnalysis.wallMs - withoutAnalysis.readMs - withoutAnalysis.parseMs,
  );
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    aggregateResults,
    contentAnalysis: loaded.contentAnalysis,
  })).digest('hex');
  const totalBytes = [...manifest.entries.values()].reduce((sum, entry) => sum + entry.size, 0);
  process.stdout.write(JSON.stringify({
    label,
    files: manifest.entries.size,
    totalBytes,
    records: records.length,
    linesParsed: loaded.diagnostics.linesParsed,
    manifestMs: median(manifestRuns),
    loadWithAnalysisMs: median(loadRuns),
    loadWithoutAnalysisMs: median(loadWithoutAnalysisRuns),
    withAnalysis,
    withoutAnalysis,
    contentAnalysisCpuDeltaMs: Math.max(
      0,
      withAnalysisCpuRemainder - withoutAnalysisCpuRemainder,
    ),
    loaderStructureAndDedupMs: withoutAnalysisCpuRemainder,
    standaloneDedupMs: median(dedupRuns),
    aggregateTimings,
    aggregateTotalMs,
    renderHtmlMs: median(renderRuns),
    htmlBytes: Buffer.byteLength(html),
    digest,
  }) + '\n');
}

async function benchmarkNoop(root, label, repeats = 5) {
  const { scanUsageManifest, diffUsageManifests } = require(path.join(repo, 'out', 'claudeUsageFiles.js'));
  const { ClaudeDataLoader } = require(path.join(repo, 'out', 'dataLoader.js'));
  const initialManifest = await scanUsageManifest([root]);
  const loaded = await ClaudeDataLoader.loadUsageRecords(root, {
    manifest: initialManifest,
    analyzeContent: false,
    windowDays: 365,
  });
  const runs = [];
  for (let index = 0; index < repeats; index += 1) {
    const started = performance.now();
    const manifest = await scanUsageManifest([root]);
    const delta = diffUsageManifests(initialManifest, manifest);
    ClaudeDataLoader.getCurrentContextInfo(loaded.records, '/benchmark/project-0');
    runs.push({
      wallMs: elapsed(started),
      changed: delta.changed.length,
      removed: delta.removed.length,
      reused: delta.reused.length,
    });
  }
  process.stdout.write(JSON.stringify({
    label,
    files: initialManifest.entries.size,
    records: loaded.records.length,
    medianWallMs: median(runs.map((run) => run.wallMs)),
    runs,
  }) + '\n');
}

async function main() {
  const [command, root, arg1, arg2] = process.argv.slice(2);
  if (command === 'generate') {
    await generate(path.resolve(root), Number(arg1), Number(arg2));
    return;
  }
  if (command === 'benchmark') {
    await benchmark(path.resolve(root), arg1 || 'corpus', Number(arg2 || 3));
    return;
  }
  if (command === 'noop') {
    await benchmarkNoop(path.resolve(root), arg1 || 'corpus', Number(arg2 || 5));
    return;
  }
  throw new Error('usage: issue87-benchmark.cjs generate <root> <MiB> <files> | benchmark <root> <label> [repeats] | noop <root> <label> [repeats]');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
