'use strict';
// Bounded opt-in current-only production indexes/worker/facade/host adoption.
// Adapts private measure-equal-byte-density and measure-5000-codex-index inputs.
// No native app, normal provider state, dependency install, network or Git writes.
// node --expose-gc this.cjs --out /private/tmp/ccu-v242-perf-cohort-XXXXXX/out
//   --provider claude|codex --case low-one|low-5000|dense-one|dense-20
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const Module = require('node:module');
const {createHash} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const threads = require('node:worker_threads');
const {serialize} = require('node:v8');
const RealWorker = threads.Worker;
const MARK = '__ccuMoneyScopePerf';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const round2 = n => +n.toFixed(2);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blankIo = () => ({sourceReadCalls:0, sourceBytesRead:0, sourceFiles:{},
  stateReadCalls:0, stateBytesRead:0, otherReadCalls:0, otherBytesRead:0,
  metadataCalls:0, writeCalls:0});
const counterNames = ['priceAchievementModelBucket','normalizeAchievementMoneyModel',
  'calculateAchievementMicroUsd','claudeAchievementMoneyScopes','codexAchievementMoneyScopes',
  'claudeMoneyEvidenceFromModels','codexMoneyEvidenceFromModels'];
function instrumentation(root, compiled) {
  let io = blankIo(), pricing = Object.fromEntries(counterNames.map(n => [n,0]));
  const coverage = {};
  const within = value => typeof value === 'string' &&
    (value === root || value.startsWith(root + path.sep));
  const read = (file, bytes) => {
    if (!within(file)) { io.otherReadCalls++; io.otherBytesRead += bytes; return; }
    if (file.endsWith('.jsonl')) {
      io.sourceReadCalls++; io.sourceBytesRead += bytes;
      const key = path.relative(root,file);
      io.sourceFiles[key] = (io.sourceFiles[key] ?? 0) + bytes;
    } else { io.stateReadCalls++; io.stateBytesRead += bytes; }
  };
  const originalOpen = fsp.open;
  fsp.open = async (...args) => {
    const handle = await originalOpen(...args), file = args[0];
    const originalRead = handle.read.bind(handle);
    handle.read = async (...values) => {
      const result = await originalRead(...values); read(file,result.bytesRead); return result;
    };
    const originalReadFile = handle.readFile.bind(handle);
    handle.readFile = async (...values) => {
      const value = await originalReadFile(...values);
      read(file,Buffer.byteLength(value)); return value;
    };
    for (const method of ['write','writeFile']) {
      const original = handle[method].bind(handle);
      handle[method] = async (...values) => { if(within(file))io.writeCalls++;return original(...values); };
    }
    return handle;
  };
  const originalReadFile = fsp.readFile;
  fsp.readFile = async (...args) => {
    const value = await originalReadFile(...args);read(args[0],Buffer.byteLength(value));return value;
  };
  const originalStream = fs.createReadStream;
  fs.createReadStream = (...args) => {
    const stream = originalStream(...args);
    const iterate = stream[Symbol.asyncIterator].bind(stream);
    stream[Symbol.asyncIterator] = async function*() {
      for await(const value of iterate()) { read(args[0],value.length);yield value; }
    };
    return stream;
  };
  for(const method of ['stat','lstat','readdir']) {
    const original = fsp[method];
    fsp[method] = async (...args) => {if(within(args[0]))io.metadataCalls++;return original(...args);};
  }
  for(const method of ['writeFile','appendFile','rename','unlink','mkdir']) {
    const original = fsp[method];
    fsp[method] = async (...args) => {if(within(args[0]))io.writeCalls++;return original(...args);};
  }
  // Hooks cover exported reference-price computation and scopes. Calls internal
  // to the same module are not separately counted; scope hooks cover that path.
  for(const moduleName of ['achievementMoney','achievementMoneyScopes']) {
    const modulePath = path.join(compiled,moduleName + '.js');
    if(!fs.existsSync(modulePath)) continue;
    const exports = require(modulePath);
    for(const name of counterNames) if(typeof exports[name] === 'function') {
      coverage[name] = true;
      const original = exports[name];
      exports[name] = (...args) => {pricing[name]++;return original(...args);};
    }
  }
  return {coverage, reset() {io=blankIo();pricing=Object.fromEntries(counterNames.map(n=>[n,0]));},
    snapshot() {return {io:structuredClone(io),pricing:{...pricing},pricingCoverage:{...coverage},
      uninstrumentedPricingWork:null};}};
}
global.fetch = async () => {throw new Error('network prohibited in money-scope benchmark');};

if(!threads.isMainThread) {
  const {root,compiled,entry,now} = threads.workerData;
  assert.match(root,/^\/private\/tmp\/ccu-v242-money-scope-[A-Za-z0-9]+$/);
  const trace = instrumentation(root,compiled);
  require(path.join(path.dirname(compiled),'tests/ui/support/frozen-clock.cjs')).freezeClock(now);
  const send = threads.parentPort.postMessage.bind(threads.parentPort);
  const telemetry = value => send({[MARK]:value});
  threads.Worker = class extends RealWorker {
    constructor(filename,options) {
      super(__filename,{...options,workerData:{root,compiled,entry:filename,now}});
      telemetry({kind:'worker-start',id:this.threadId});
      this.once('exit',()=>telemetry({kind:'worker-exit',id:this.threadId}));
    }
    emit(event,...args) {
      if(event==='message' && args[0]?.[MARK]) {
        telemetry(args[0][MARK]); return true;
      }
      return super.emit(event,...args);
    }
  };
  threads.parentPort.postMessage = message => {
    if(message?.type==='result' || (Number.isInteger(message?.sequence) && message?.outcome)) {
      telemetry({kind:'trace',id:threads.threadId,...trace.snapshot(),
        memory:process.memoryUsage(),messageBytes:serialize(message).byteLength});
      trace.reset();
    }
    send(message);
  };
  const sample = setInterval(()=>telemetry({kind:'memory',id:threads.threadId,heapUsed:process.memoryUsage().heapUsed,
    external:process.memoryUsage().external}),50);sample.unref();
  require(entry);
} else {
  (async()=>{
    const compiled = path.resolve(arg('--out',''));
    const stage = path.dirname(compiled);
    assert.match(stage,/^\/private\/tmp\/ccu-v242-perf-cohort-[A-Za-z0-9]+$/);
    assert.equal(path.basename(compiled),'out');
    const manifest = JSON.parse(fs.readFileSync(path.join(stage,'cohort-manifest.json'),'utf8'));
    assert.match(manifest.commit,/^[a-f0-9]{40}$/);
    assert.notEqual(manifest.commit,'b2e4f72a84b73e1465bc09f68a8ecb5584d84c53',
      'money-scope benchmark is current-only');
    assert.equal(typeof global.gc,'function','use --expose-gc');
    const providerName = arg('--provider'), caseName = arg('--case');
    assert.ok(['claude','codex'].includes(providerName));
    const cases = {'low-one':[30000,1],'low-5000':[30000,5000],
      'dense-one':[160000,1],'dense-20':[160000,20]};
    assert.ok(Object.hasOwn(cases,caseName));
    const [rows,fileCount] = cases[caseName], totalBytes=153600000;
    const now = Date.parse('2026-10-10T12:00:00Z'), timestamp = '2026-10-10T11:00:00.000Z';
    const limits={rssBytes:2*1024**3,totalWorkerHeapBytes:2*1024**3,
      maxFileWorkers:6,warmHeapGrowthBytes:64*1024**2,warmExternalGrowthBytes:32*1024**2,
      elapsedMs:480000,refreshMs:90000};
    const root = await fsp.mkdtemp('/private/tmp/ccu-v242-money-scope-');
    const source = path.join(root,'source'), state = path.join(root,'state');
    const files=[],phases=[],ownedWorkers=new Set(),workerMem=new Map();
    let peakRssBytes=process.memoryUsage().rss,peakWorkerHeapBytes=0,workerCount=0,maxFileWorkers=0;
    let trace,workerTraces=[],messages=0,messageBytes=0,result,baselineMemory,afterWarmMemory;
    let budgetFailure,workerMemorySamples=0,pendingPhase;
    let retainedMoney,oldMoney,client,facade,index,restoreClock;
    const started=performance.now();
    const report = {kind:'bounded-synthetic-production-money-scopes-not-native-Windows-or-OOM-proof',
      runtime:process.version,execPath:process.execPath,platform:process.platform,
      commit:manifest.commit,driverSha256:sha(fs.readFileSync(__filename)),provider:providerName,
      case:caseName,rows,files:fileCount,fixtureBytes:totalBytes,moneyScope:true,
      contentAnalysis:providerName==='claude',usageLimitTracking:false,weeklyQuotaPace:false,
      limits,phases,scope:'cold,20 unchanged warm polls,append,one-file replacement,delete,final warm',
      ioCoverage:'fs/promises readFile/open/FileHandle.read + async createReadStream; metadata counted separately',
      uninstrumentedPricingWork:null};
    function sample() {
      const memory=process.memoryUsage();peakRssBytes=Math.max(peakRssBytes,memory.rss);
      const heap=[...workerMem.values()].reduce((sum,m)=>sum+m.heapUsed,0);
      peakWorkerHeapBytes=Math.max(peakWorkerHeapBytes,heap);
      assert.ok(memory.rss<limits.rssBytes,'sampled process RSS exceeded predeclared budget');
      assert.ok(heap<limits.totalWorkerHeapBytes,'sampled total worker heap exceeded budget');
      assert.ok(performance.now()-started<limits.elapsedMs,'bounded run timeout');
    }
    async function settled() {await new Promise(r=>setImmediate(r));global.gc();global.gc();sample();return process.memoryUsage();}
    async function bounded(work) {
      let timer;try{return await Promise.race([work,new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error('bounded refresh timeout')),limits.refreshMs);
      })]);}finally{clearTimeout(timer);}
    }
    function telemetry(value) {
      if(value.kind==='trace') {workerTraces.push(value);workerMem.set(value.id,value.memory);workerMemorySamples++;}
      else if(value.kind==='memory') {workerMem.set(value.id,value);workerMemorySamples++;}
      else if(value.kind==='worker-start'){workerCount++;maxFileWorkers=Math.max(maxFileWorkers,workerCount);
        assert.ok(workerCount<=limits.maxFileWorkers,'parser worker budget');}
      else if(value.kind==='worker-exit'){workerCount--;workerMem.delete(value.id);}
    }
    function factory() {
      const worker=new RealWorker(__filename,{workerData:{root,compiled,now,
        entry:path.join(compiled,'providers/codex/codexIndexWorker.js')}});
      ownedWorkers.add(worker);
      worker.on('message',message=>{
        if(message?.[MARK])telemetry(message[MARK]);
        else{messages++;messageBytes+=serialize(message).byteLength;}
      });
      const id=worker.threadId;
      worker.once('exit',()=>{ownedWorkers.delete(worker);workerMem.delete(id);});
      // Controller samples and nested parser samples are reported separately in
      // trace records. No absent worker sample is interpreted as observed zero.
      return worker;
    }
    function claudeLine(id,padding=0) {
      return JSON.stringify({type:'assistant',timestamp,requestId:'synthetic-request-'+id,
        cwd:'/fixture/project',message:{id:'synthetic-message-'+id,role:'assistant',
          model:'claude-opus-5-5',content:[{type:'text',text:'x'.repeat(padding)}],
          usage:{input_tokens:10,output_tokens:1,cache_read_input_tokens:0,
            cache_creation_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,
              ephemeral_1h_input_tokens:0}}}})+'\n';
    }
    function codexLine(sequence,padding=0) {
      return JSON.stringify({timestamp,type:'event_msg',payload:{type:'token_count',
        padding:'x'.repeat(padding),info:{total_token_usage:{input_tokens:sequence*10,
          output_tokens:sequence,cached_input_tokens:0,reasoning_output_tokens:0},
          last_token_usage:{input_tokens:10,output_tokens:1,cached_input_tokens:0,
            reasoning_output_tokens:0}}}})+'\n';
    }
    function header(n) {return providerName==='claude'?'':[
      {timestamp,type:'session_meta',payload:{id:'synthetic-session-'+n,cwd:'/fixture/project'}},
      {timestamp,type:'turn_context',payload:{model:'gpt-6-sol',effort:'high'}},
    ].map(x=>JSON.stringify(x)+'\n').join('');}
    const digest=createHash('sha256');
    let written=0,expectedRows=rows;
    const restoredLoad=Module._load;
    const sampler=setInterval(()=>{try{sample();}catch(error){budgetFailure??=error;
      for(const worker of ownedWorkers)void worker.terminate();}},50);
    try {
      const directory=path.join(source,providerName==='claude'?'projects/-fixture':'sessions');
      await fsp.mkdir(directory,{recursive:true});await fsp.mkdir(state,{recursive:true});
      const perFileRows=rows/fileCount;
      assert.ok(Number.isInteger(perFileRows));assert.ok(Number.isInteger(totalBytes/fileCount));
      for(let n=0;n<fileCount;n++){
        const file=path.join(directory,'session-'+String(n).padStart(4,'0')+'.jsonl');
        files.push(file);
        const head=header(n),remaining=totalBytes/fileCount-Buffer.byteLength(head);
        const lineBytes=Math.floor(remaining/perFileRows),extra=remaining%perFileRows;
        await fsp.writeFile(file,head,{flag:'wx'});digest.update(head);written+=Buffer.byteLength(head);
        for(let first=0;first<perFileRows;first+=1000){
          let body='';
          for(let k=first;k<Math.min(perFileRows,first+1000);k++){
            const id=n*perFileRows+k,target=lineBytes+(k<extra?1:0);
            const bare=providerName==='claude'?claudeLine(id):codexLine(k+1);
            const pad=target-Buffer.byteLength(bare);assert.ok(pad>=0,'line-density budget');
            const line=providerName==='claude'?claudeLine(id,pad):codexLine(k+1,pad);
            assert.equal(Buffer.byteLength(line),target);body+=line;
          }
          await fsp.appendFile(file,body);digest.update(body);written+=Buffer.byteLength(body);
        }
      }
      assert.equal(written,totalBytes);report.fixtureSha256=digest.digest('hex');
      trace=instrumentation(root,compiled);
      restoreClock=require(path.join(stage,'tests/ui/support/frozen-clock.cjs')).freezeClock(now);
      Module._load=function(name,parent,isMain){return name==='vscode'?{
        workspace:{workspaceFolders:[]},Uri:{file:fsPath=>({fsPath})},env:{language:'en'},
      }:restoredLoad.call(this,name,parent,isMain);};
      const {I18n}=require(path.join(compiled,'i18n.js'));I18n.setTimezone('UTC');I18n.setLanguage('en');
      const ci=require(path.join(compiled,'claudeIncrementalIndex.js'));
      const {CodexIndexClient}=require(path.join(compiled,'providers/codex/codexIndexClient.js'));
      const {CodexProvider}=require(path.join(compiled,'providers/codex/codexProvider.js'));
      const {ClaudeCodeUsageExtension}=require(path.join(compiled,'extension.js'));
      const {createEmptyQuotaObservationStore}=require(path.join(compiled,'quotaObservationStore.js'));
      const host=Object.create(ClaudeCodeUsageExtension.prototype);
      Object.assign(host,{getConfiguration:()=>({enableAchievements:true,codexDataDirectory:source,
        timezone:'UTC',pricingBackend:'anthropic',dataDirectory:source,dashboardAutoRefresh:false,
        usageLimitTracking:false,showWeeklyQuotaPace:false}),
        selectCodexSnapshotHome:()=>undefined,recordCodexQuotaObservations:async()=>undefined,
        quotaObservationStore:createEmptyQuotaObservationStore(),quotaFingerprintSalt:'synthetic-money-scope',
        codexView:null,codexInsights:{},settings:{get:()=>false}});
      index=ci.createClaudeUsageIndex();
      client=new CodexIndexClient(factory);
      facade=new CodexProvider({enabled:true,codexHome:source,indexPath:path.join(state,'index.json'),
        salt:'synthetic-money-scope',timeZone:'UTC',allowAchievementHourProof:true},()=>client);
      async function pass(label,reads,changedFiles) {
        trace.reset();workerTraces=[];messages=0;messageBytes=0;
        pendingPhase={label};
        const phaseStart=performance.now();
        let diagnostics,money,projectionIo;
        const ioDifference=(before,after)=>Object.fromEntries(Object.keys(before)
          .filter(key=>key!=='sourceFiles').map(key=>[key,after[key]-before[key]]));
        if(providerName==='claude'){
          result=await bounded(ci.updateClaudeUsageIndex(index,source,{analyzeContent:true}));
          index=result.index;diagnostics=result.diagnostics;
          assert.equal(diagnostics.filesFailed,0);assert.equal(result.records.length,expectedRows);
          if(expectedRows>0)assert.equal(result.contentAnalysis?.calibration?.realOutputTokens,expectedRows);
          const beforeProjection=trace.snapshot().io;
          const view=ci.claudeUsageDashboardSnapshot(index,{now:new Date(now),
            projectGroupingMode:'flat',achievementMoneyBackend:'anthropic'});
          projectionIo=ioDifference(beforeProjection,trace.snapshot().io);
          money=view.achievementMoney;
          assert.equal(view.allTime.totalOutputTokens,expectedRows);
        }else{
          result=await bounded(facade.refresh('foreground'));
          assert.equal(result.outcome,'success');assert.ok(result.snapshot);
          assert.equal(result.snapshot.coverage.complete,true);assert.equal(result.diagnostic?.migrationPending,false);
          assert.equal(result.snapshot.total.inputTotal,expectedRows*10);
          diagnostics=result.diagnostic;
          const beforeProjection=trace.snapshot().io;
          host.applyCodexSnapshot(result.snapshot);money=host.codexAchievementSignals.money;
          projectionIo=ioDifference(beforeProjection,trace.snapshot().io);
        }
        assert.ok(money,'actual moneyScope ON must produce proof');
        assert.equal(money.cumulative?.status,expectedRows>0?'complete':'empty');
        assert.equal(money.cumulative.totalTokens,expectedRows*11);
        const observed=trace.snapshot();
        for(const wt of workerTraces) {
          for(const key of Object.keys(observed.io))if(key!=='sourceFiles')observed.io[key]+=wt.io[key];
          for(const [file,bytes]of Object.entries(wt.io.sourceFiles))
            observed.io.sourceFiles[file]=(observed.io.sourceFiles[file]??0)+bytes;
          for(const key of counterNames)observed.pricing[key]+=wt.pricing[key];
        }
        pendingPhase={label,diagnostics,observed,projectionIo};
        assert.equal(typeof diagnostics?.bodyReads,'number','missing bodyReads is unknown');
        assert.equal(observed.pricingCoverage.claudeAchievementMoneyScopes,true,'missing pricing hook is unknown');
        assert.equal(observed.pricingCoverage.codexAchievementMoneyScopes,true,'missing pricing hook is unknown');
        if(reads!==undefined)assert.equal(diagnostics.bodyReads,reads);
        if(reads===0){
          assert.equal(observed.io.sourceReadCalls,0);assert.equal(observed.io.sourceBytesRead,0);
          assert.equal(observed.io.otherReadCalls,0,'untracked extra reads must be investigated');
        }
        if(/^(warm-|after-append-warm|final-warm)/.test(label)){
          assert.ok(counterNames.every(key=>observed.pricing[key]===0),'unchanged pricing/scopes work');
          assert.equal(money,retainedMoney,'unchanged money proof identity');
          assert.ok(Object.values(projectionIo).every(value=>value===0),'money projection adds no I/O');
        }
        if(changedFiles){
          const allowed=new Set(changedFiles.map(file=>path.relative(root,file)));
          assert.ok(Object.keys(observed.io.sourceFiles).every(file=>allowed.has(file)),
            'changed source read must stay inside affected files');
        }
        const refreshAndProjectionMs=round2(performance.now()-phaseStart);
        const memory=await settled();
        phases.push({label,elapsedMs:round2(performance.now()-phaseStart),refreshAndProjectionMs,
          emptyCorpusVerified:expectedRows===0,diagnosticBodyReads:diagnostics.bodyReads,
          diagnosticBytesRead:typeof diagnostics.bytesRead==='number'?diagnostics.bytesRead:null,
          io:observed.io,projectionIo,pricing:observed.pricing,pricingCoverage:observed.pricingCoverage,
          uninstrumentedPricingWork:null,memory,moneyDtoBytes:Buffer.byteLength(JSON.stringify(money)),
          moneyMicroUsd:money.cumulative.microUsd,messageCount:messages,messageBytes,
          liveControllers:ownedWorkers.size,workerSamples:workerTraces.map(w=>w.memory)});
        sample();if(budgetFailure)throw budgetFailure;
        assert.equal(ownedWorkers.size,0,'production client must retire controllers before terminal refresh');
        retainedMoney=money;result=null;
        pendingPhase=undefined;
        process.stderr.write(JSON.stringify({case:caseName,provider:providerName,label,
          ms:phases.at(-1).elapsedMs,bodyReads:diagnostics.bodyReads,
          sourceBytesRead:observed.io.sourceBytesRead})+'\n');
      }
      await pass('cold',fileCount,files);baselineMemory=await settled();
      for(let n=0;n<20;n++)await pass('warm-'+n,0,[]);
      afterWarmMemory=await settled();oldMoney=retainedMoney;
      const oldJson=JSON.stringify(oldMoney);
      const tail=providerName==='claude'?claudeLine(rows):codexLine(perFileRows+1);
      await fsp.appendFile(files.at(-1),tail);expectedRows++;
      await pass('append',1,[files.at(-1)]);
      assert.notEqual(retainedMoney,oldMoney);assert.equal(JSON.stringify(oldMoney),oldJson);
      await pass('after-append-warm',0,[]);
      // Content-analysis ordered ownership may rebuild on unsafe Claude edits.
      // Record that established contract explicitly; do not assert fake locality.
      await fsp.writeFile(files[0],header(0)+(providerName==='claude'?claudeLine(rows+1):codexLine(1)));
      expectedRows-=perFileRows-1+(fileCount===1?1:0);
      await pass('replace-one',providerName==='claude'?undefined:1,
        providerName==='claude'?undefined:[files[0]]);
      await fsp.unlink(files[0]);expectedRows--;
      await pass('delete-one',providerName==='claude'?undefined:0,
        providerName==='claude'?undefined:[]);
      // Empty final corpus legitimately has empty money, unlike unknown evidence.
      if(expectedRows>0)await pass('final-warm',0,[]);
      report.claudeUnsafeEditCanRebuildOrderedContent=providerName==='claude';
      report.baselineMemory=baselineMemory;report.afterWarmMemory=afterWarmMemory;
      report.warmHeapGrowthBytes=afterWarmMemory.heapUsed-baselineMemory.heapUsed;
      report.warmExternalGrowthBytes=afterWarmMemory.external-baselineMemory.external;
      assert.ok(report.warmHeapGrowthBytes<=Math.max(limits.warmHeapGrowthBytes,baselineMemory.heapUsed/10));
      assert.ok(report.warmExternalGrowthBytes<=limits.warmExternalGrowthBytes);
      report.peakSampledRssBytes=peakRssBytes;
      report.peakSampledWorkerHeapBytes=workerMemorySamples?peakWorkerHeapBytes:null;
      report.workerMemorySamples=workerMemorySamples;
      report.workerPeakMeasurement='50ms plus terminal samples; no claim of exact instantaneous worker peak';
      report.maxObservedFileWorkers=maxFileWorkers;report.elapsedMs=round2(performance.now()-started);
      report.passed=true;
      process.stdout.write(JSON.stringify(report,null,2)+'\n');
    } catch(error) {
      report.passed=false;report.failure=error.stack;report.elapsedMs=round2(performance.now()-started);
      report.failedPhase=pendingPhase;
      process.stdout.write(JSON.stringify(report,null,2)+'\n');throw error;
    } finally {
      clearInterval(sampler);
      Module._load=restoredLoad;
      await facade?.dispose();await client?.dispose();
      await Promise.allSettled([...ownedWorkers].map(worker=>worker.terminate()));
      restoreClock?.();index=undefined;result=null;
      assert.match(root,/^\/private\/tmp\/ccu-v242-money-scope-[A-Za-z0-9]+$/);
      await fsp.rm(root,{recursive:true,force:true});
    }
  })().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
}
