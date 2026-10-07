'use strict';

// Opt-in synthetic Node worker/pool evidence, not native Extension Host/F5,
// Webview, Windows OOM or proof of an exact instantaneous memory peak.
// node --expose-gc tests/perf/measure-codex-worker-lifecycle.cjs
// Optional --out points to an already-compiled immutable comparison cohort.
// Every source/index/lease write is confined to this run's fresh temp directory.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { serialize } = require('node:v8');
const threads = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const RealWorker = threads.Worker;
const marker = '__ccuSyntheticWorkerPerf';

if (!threads.isMainThread) {
  // The production entry runs unchanged; instrumentation retains counters only.
  const send = threads.parentPort.postMessage.bind(threads.parentPort);
  const telemetry = event => send({ [marker]: event });
  let outgoingMessages = 0, outgoingBytes = 0, maxOutgoingBytes = 0;
  threads.parentPort.postMessage = message => {
    const bytes = serialize(message).byteLength;
    outgoingMessages++; outgoingBytes += bytes;
    maxOutgoingBytes = Math.max(maxOutgoingBytes, bytes);
    send(message);
  };
  threads.Worker = class extends RealWorker {
    constructor(filename, options) {
      super(__filename, { ...options, workerData: { entry: filename } });
      const id = this.threadId;
      telemetry({ kind: 'child-start', id });
      this.on('message', message => {
        if (message?.[marker]) telemetry({ kind: 'child-sample', id, ...message[marker] });
        else telemetry({ kind: 'child-message', id, bytes: serialize(message).byteLength });
      });
      this.once('exit', () => telemetry({ kind: 'child-exit', id }));
    }
    postMessage(message) {
      telemetry({ kind: 'child-request', id: this.threadId, bytes: serialize(message).byteLength });
      super.postMessage(message);
    }
  };
  const sample = () => {
    const memory = process.memoryUsage();
    telemetry({ kind: 'sample', heapUsed: memory.heapUsed, external: memory.external,
      outgoingMessages, outgoingBytes, maxOutgoingBytes });
  };
  const sampler = setInterval(sample, 50);
  sampler.unref();
  sample();
  require(threads.workerData.entry);
} else {
  function option(name, fallback) {
    const at = process.argv.indexOf(name);
    return at < 0 ? fallback : process.argv[at + 1];
  }
  const compiled = path.resolve(option('--out', path.resolve(__dirname, '../../out')));
  const label = option('--label', 'candidate');
  const rowsPerFile = Number(option('--rows', '5000'));
  const fileCount = Number(option('--files', '12'));
  const rounds = Number(option('--rounds', '3'));
  assert.match(label, /^[a-zA-Z0-9.-]{1,64}$/);
  assert.ok(Number.isInteger(rowsPerFile) && rowsPerFile >= 1000 && rowsPerFile <= 20000);
  assert.ok(Number.isInteger(fileCount) && fileCount >= 8 && fileCount <= 48);
  assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 3);
  assert.equal(typeof global.gc, 'function', 'run with --expose-gc for post-GC measurements');
  const { CodexIndexClient } = require(path.join(compiled, 'providers/codex/codexIndexClient.js'));
  const entry = path.join(compiled, 'providers/codex/codexIndexWorker.js');
  const ownedWorkers = new Set();
  const summaries = [];
  const started = performance.now();
  const limits = { rssBytes: 2 * 1024 ** 3, workerHeapBytes: 2 * 1024 ** 3,
    fileWorkersPerController: 6, settledHeapGrowthBytes: 64 * 1024 ** 2,
    settledExternalGrowthBytes: 32 * 1024 ** 2, elapsedMs: 8 * 60_000 };
  let budgetFailure, peakRssBytes = process.memoryUsage().rss;
  let maxWorkerHeapBytes = 0, maxWorkerExternalBytes = 0, maxFileWorkers = 0;
  let controllersCreated = 0, controllersExited = 0, parsedWorkersCreated = 0, parsedWorkersExited = 0;
  const parserTraffic = { requests: 0, requestBytes: 0, messages: 0, bytes: 0, maxBytes: 0 };
  let outgoingMessages = 0, outgoingBytes = 0, maxOutgoingBytes = 0;
  let requestMessages = 0, requestBytes = 0;
  let activeGroup = null, maxSettledHeapBytes = 0, maxSettledExternalBytes = 0;
  const observations = new Map();
  const sample = () => {
    const memory = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    let heap = 0, external = 0;
    for (const observation of observations.values()) {
      for (const value of [observation.controller, ...observation.children.values()]) {
        heap += value?.heapUsed ?? 0; external += value?.external ?? 0;
      }
    }
    maxWorkerHeapBytes = Math.max(maxWorkerHeapBytes, heap);
    maxWorkerExternalBytes = Math.max(maxWorkerExternalBytes, external);
    if (activeGroup) {
      activeGroup.peakRssBytes = Math.max(activeGroup.peakRssBytes, memory.rss);
      activeGroup.maxWorkerHeapBytes = Math.max(activeGroup.maxWorkerHeapBytes, heap);
    }
    if (memory.rss > limits.rssBytes || heap > limits.workerHeapBytes ||
        performance.now() - started > limits.elapsedMs) {
      budgetFailure ??= new Error('synthetic worker lifecycle exceeded frozen resources/time');
      for (const worker of ownedWorkers) void worker.terminate();
    }
  };
  const sampler = setInterval(sample, 50);
  const controller = () => {
    const worker = new RealWorker(__filename, { workerData: { entry } });
    controllersCreated++;
    ownedWorkers.add(worker);
    const observation = { controller: null, children: new Map() };
    observations.set(worker, observation);
    worker.on('message', message => {
      const telemetry = message?.[marker];
      if (telemetry) {
        if (telemetry.kind === 'child-start') {
          parsedWorkersCreated++;
          observation.children.set(telemetry.id, null);
          maxFileWorkers = Math.max(maxFileWorkers, observation.children.size);
          if (observation.children.size > limits.fileWorkersPerController) {
            budgetFailure ??= new Error('too many synthetic file workers');
            void worker.terminate();
          }
        } else if (telemetry.kind === 'child-exit') {
          parsedWorkersExited++;
          observation.children.delete(telemetry.id);
        } else if (telemetry.kind === 'child-message') {
          parserTraffic.messages++; parserTraffic.bytes += telemetry.bytes;
          parserTraffic.maxBytes = Math.max(parserTraffic.maxBytes, telemetry.bytes);
        } else if (telemetry.kind === 'child-request') {
          parserTraffic.requests++; parserTraffic.requestBytes += telemetry.bytes;
        }
        else if (telemetry.id !== undefined) observation.children.set(telemetry.id, telemetry);
        else observation.controller = telemetry;
        sample();
      } else {
        const bytes = serialize(message).byteLength;
        outgoingMessages++; outgoingBytes += bytes;
        maxOutgoingBytes = Math.max(maxOutgoingBytes, bytes);
      }
    });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = request => {
      requestMessages++; requestBytes += serialize(request).byteLength;
      post(request);
    };
    worker.once('exit', () => {
      controllersExited++;
      ownedWorkers.delete(worker); observations.delete(worker);
    });
    return worker;
  };
  const afterTurn = () => new Promise(resolve => setImmediate(resolve));
  async function settledMemory() {
    await afterTurn();
    global.gc?.();
    await afterTurn();
    sample();
    const memory = process.memoryUsage();
    maxSettledHeapBytes = Math.max(maxSettledHeapBytes, memory.heapUsed);
    maxSettledExternalBytes = Math.max(maxSettledExternalBytes, memory.external);
    return memory;
  }
  async function bounded(work) {
    let timer;
    try {
      return await Promise.race([work, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('synthetic worker refresh timeout')), 30_000);
      })]);
    } finally { clearTimeout(timer); }
  }
  function seed(index) {
    const lines = [
      { timestamp: '2026-07-20T00:00:00.000Z', type: 'session_meta',
        payload: { id: 'synthetic-session-' + index, cwd: '/fixture/worker-lifecycle' } },
      { timestamp: '2026-07-20T00:00:00.000Z', type: 'turn_context',
        payload: { model: 'gpt-6.1-sol', effort: 'max' } },
    ];
    for (let i = 1; i <= rowsPerFile; i++) lines.push({
      timestamp: new Date(Date.parse('2026-07-20T00:00:00.000Z') + i * 1000).toISOString(),
      type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
        input_tokens: i, cached_input_tokens: Math.floor(i / 2),
        output_tokens: Math.floor(i / 5) + 1, reasoning_output_tokens: 0,
        total_tokens: i + Math.floor(i / 5) + 1,
      } } },
    });
    return lines.map(line => JSON.stringify(line)).join('\n') + '\n';
  }
  (async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccu-worker-lifecycle-'));
    const salt = 'synthetic-worker-lifecycle';
    const fixtureHash = createHash('sha256');
    let fixtureBytes = 0;
    try {
      const sessions = path.join(root, 'home', 'sessions');
      await fs.mkdir(sessions, { recursive: true });
      for (let i = 0; i < fileCount; i++) {
        const body = seed(i);
        fixtureHash.update(body); fixtureBytes += Buffer.byteLength(body);
        await fs.writeFile(path.join(sessions, 'rollout-' + i + '.jsonl'), body);
      }
      const initialMemory = await settledMemory();
      for (let round = 1; round <= rounds; round++) for (const proof of [false, true]) {
        const client = new CodexIndexClient(controller);
        const indexPath = path.join(root, 'cache', `${round}-${proof}.json`);
        const input = { codexHome: path.join(root, 'home'), indexPath, salt, timeZone: 'UTC',
          allowAchievementHourProof: proof };
        const groupStarted = performance.now();
        activeGroup = { peakRssBytes: 0, maxWorkerHeapBytes: 0 };
        const groupWorkersBefore = parsedWorkersCreated;
        try {
          let current = await bounded(client.refresh(input));
          assert.equal(current.failedFiles, 0);
          assert.equal(current.index.coverage.complete, true);
          assert.equal(current.index.aggregate.total.inputTotal, rowsPerFile * fileCount);
          assert.equal(ownedWorkers.size, 0, 'terminal replies wait for controller termination');
          // Construct an incomplete legacy period projection in our synthetic
          // cache, to exercise expedited production migration and its parser pool.
          let legacy = JSON.parse(await fs.readFile(indexPath, 'utf8'));
          for (const value of Object.values(legacy.files)) {
            delete value.aggregate.period; delete value.periodMigration;
          }
          legacy.coverage.complete = false;
          legacy.coverage.period.allTime.complete = false;
          await fs.writeFile(indexPath, JSON.stringify(legacy));
          legacy = null; // Do not retain the fixture rewrite as an old snapshot.
          const workersBefore = parsedWorkersCreated;
          current = await bounded(client.refresh(input));
          assert.equal(current.index.coverage.period.allTime.complete, true);
          assert.equal(current.index.aggregate.total.inputTotal, rowsPerFile * fileCount);
          assert.ok(parsedWorkersCreated > workersBefore, 'period migration must use real parser workers');
          assert.equal(parsedWorkersExited, parsedWorkersCreated, 'all started parser workers must report exit');
          const warmStarted = await settledMemory();
          let peakSettledHeapGrowth = 0, peakSettledExternalGrowth = 0;
          for (let pass = 0; pass < 20; pass++) {
            current = await bounded(client.refresh(input));
            assert.equal(current.bodyReads, 0);
            assert.equal(current.migration.bytesRead, 0);
            assert.equal(current.indexChanged, false);
            assert.equal(ownedWorkers.size, 0);
            assert.equal(observations.size, 0);
            const memory = await settledMemory();
            peakSettledHeapGrowth = Math.max(peakSettledHeapGrowth, memory.heapUsed - warmStarted.heapUsed);
            peakSettledExternalGrowth = Math.max(peakSettledExternalGrowth, memory.external - warmStarted.external);
          }
          assert.ok(peakSettledHeapGrowth <= Math.max(limits.settledHeapGrowthBytes, warmStarted.heapUsed / 10));
          assert.ok(peakSettledExternalGrowth <= limits.settledExternalGrowthBytes);
          // Dispose during a real worker request, then verify later requests are rejected.
          const pending = client.refresh(input);
          const rejected = assert.rejects(pending, { code: 'disposed' });
          await bounded(client.dispose()); await rejected;
          await assert.rejects(client.refresh(input), { code: 'disposed' });
          await afterTurn();
          assert.equal(ownedWorkers.size, 0);
          assert.equal(observations.size, 0);
          summaries.push({ round, achievementHourProofRequested: proof, warmPasses: 20,
            warmBodyReads: 0, warmBytesRead: 0, controllerAndParserReleaseObserved: true,
            peakSettledHeapGrowth, peakSettledExternalGrowth,
            parserWorkersCreated: parsedWorkersCreated - groupWorkersBefore, ...activeGroup,
            elapsedMs: Math.round(performance.now() - groupStarted) });
          process.stdout.write(JSON.stringify({ phase: 'group', ...summaries.at(-1) }) + '\n');
        } finally { await client.dispose(); activeGroup = null; }
      }
      const finalMemory = await settledMemory();
      assert.equal(controllersCreated, controllersExited);
      assert.equal(parsedWorkersCreated, parsedWorkersExited);
      assert.equal(ownedWorkers.size, 0);
      assert.ok(maxSettledHeapBytes - initialMemory.heapUsed <=
        Math.max(limits.settledHeapGrowthBytes, initialMemory.heapUsed / 10));
      assert.ok(maxSettledExternalBytes - initialMemory.external <= limits.settledExternalGrowthBytes);
      assert.ok(!process.getActiveResourcesInfo().includes('MessagePort'), 'no worker MessagePorts remain');
      if (budgetFailure) throw budgetFailure;
      process.stdout.write(JSON.stringify({ phase: 'summary', outcome: 'pass', label,
        kind: 'synthetic-production-worker-pool-not-native-or-OOM-proof', runtime: process.version,
        fixture: { fileCount, rowsPerFile, fixtureBytes, sha256: fixtureHash.digest('hex') },
        samplingMs: 50, serializedMessageBytesAreProxy: true,
        peakRssBytes, maxWorkerHeapBytes, maxWorkerExternalBytes, maxFileWorkers,
        controllersCreated, controllersExited, parsedWorkersCreated, parsedWorkersExited,
        parserTraffic,
        controllerOutgoing: { messages: outgoingMessages, bytes: outgoingBytes, maxBytes: maxOutgoingBytes },
        hostRequests: { messages: requestMessages, bytes: requestBytes },
        initialMemory, finalMemory, maxSettledHeapBytes, maxSettledExternalBytes, limits, groups: summaries,
      }) + '\n');
    } finally {
      clearInterval(sampler);
      await Promise.all([...ownedWorkers].map(worker => worker.terminate()));
      assert.ok(path.basename(root).startsWith('ccu-worker-lifecycle-'));
      await fs.rm(root, { recursive: true, force: true });
    }
  })().catch(error => {
    clearInterval(sampler);
    process.stderr.write(JSON.stringify({ phase: 'summary', outcome: 'failure', label,
      reason: error instanceof assert.AssertionError ? 'assertion' : 'runtime-or-budget',
      message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
