import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {appendFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import Module = require('node:module');
import {createClaudeUsageIndex,updateClaudeUsageIndex,claudeUsageDashboardSnapshot,type ClaudeUsageIndex} from '../claudeIncrementalIndex';
import {ACHIEVEMENT_RECORD_FILE,loadAchievementRecords,type AchievementRecord} from '../achievementRecordStore';
import {I18n} from '../i18n';
import {CodexProvider} from '../providers/codex/codexProvider';
import {buildCodexUsageView} from '../providers/codex/codexUsage';
import {codexModelSignals} from '../achievements';
import {codexAchievementTokenEvidence} from '../achievementCalendar';
import {codexAchievementMoneyScopes} from '../achievementMoneyScopes';
const {freezeClock}=require(path.resolve(__dirname,'../../tests/ui/support/frozen-clock.cjs'));
const T=Date.parse('2026-10-10T12:00:00Z');
// A real worker has an independent wall clock. Its accepted window cannot
// borrow the accelerated fixture clock used by the in-process Claude tests.
const systemNow=Date.now.bind(Date);
async function settle(host:any) {for(let i=0;i<3;i++) {
  await Promise.all([host.achievementWrite,host.achievementActivityWrite,host.achievementHourWrite,host.achievementCalendarWrite,host.achievementNoticeWrite]);
  await new Promise<void>(resolve=>setImmediate(resolve));
}}
function deferred() {let resolve!:()=>void;return {promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};}
async function owner(run:(h:{host:any;root:string;file:string;messages:any[];clock:(n:number)=>void;disable:()=>void})=>Promise<void>) {
  const root=await mkdtemp(path.join(os.tmpdir(),'ccu-money-live-owner-'));
  let restoreClock=freezeClock(T),host:any,enabled=true;
  const locale=I18n.getLocale(),zone=I18n.getTimezone();
  const originalLoad=(Module as any)._load;
  (Module as any)._load=function(name:string,...args:unknown[]) {return name==='vscode'?{
    workspace:{workspaceFolders:[]},Uri:{file:(fsPath:string)=>({fsPath})},
  }:originalLoad.call(this,name,...args);};
  try {
    I18n.setLanguage('en');I18n.setTimezone('UTC');
    const {UsageWebviewProvider}=require('../webview');
    const state=new Map<string,unknown>(['structural','token','bucket','manifest','calendar','calibration']
      .map(a=>['ccu.achievements.'+a+'Audit.v1',true] as [string,unknown]));
    host=new UsageWebviewProvider({extensionPath:path.resolve(__dirname,'../..'),globalStorageUri:{fsPath:root},globalState:{
      get:(key:string)=>state.get(key),update:async(key:string,v:unknown)=>{if(v===undefined)state.delete(key);else state.set(key,v);},
    }});await settle(host);
    host.settings={get:(key:string)=>key==='enableAchievements'?enabled:key==='pricingBackend'?'anthropic':
      ['enableShareCard','showAchievementNotices'].includes(key)};
    const messages:any[]=[];host.panel={visible:false,webview:{postMessage:async(m:any)=>{messages.push(m);return true;}}};
    host.updateWebview=()=>undefined;host.webviewClientReady=true;host.setAchievementWindowFocused(true);
    host.providerAvailability={claude:true,codex:false,codexData:false};
    await run({host,root,file:path.join(root,ACHIEVEMENT_RECORD_FILE),messages,
      clock:(n:number)=>{restoreClock();restoreClock=freezeClock(n);},disable:()=>{enabled=false;}});
  } finally {
    if(host)await settle(host);(Module as any)._load=originalLoad;
    I18n.setLanguage(locale as any);I18n.setTimezone(zone);restoreClock();await rm(root,{recursive:true,force:true});
  }
}
const line=(id:string,input:number,time:number)=>JSON.stringify({type:'assistant',timestamp:new Date(time).toISOString(),requestId:'synthetic-'+id,
  message:{id:'synthetic-'+id,model:'claude-haiku-4-5',usage:{input_tokens:input,output_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0}}})+'\n';
function snapshot(index:ClaudeUsageIndex) {
  const data=claudeUsageDashboardSnapshot(index,{now:new Date(),achievementMoneyBackend:'anthropic'});
  return {allTime:data.allTime,days:data.dailyForAllTime,sessions:data.sessions,sessionEvidence:data.achievementSessionEvidence,
    records:[],timeZone:'UTC',money:data.achievementMoney};
}
async function baseline(host:any,root:string) {
  const directory=path.join(root,'claude-source','projects','synthetic');await mkdir(directory,{recursive:true});
  const file=path.join(directory,'session.jsonl');await writeFile(file,line('history',99_000_000,T-60_000));
  const result=await updateClaudeUsageIndex(createClaudeUsageIndex(),path.join(root,'claude-source'),{analyzeContent:false});
  const handle=await host.beginClaudeAchievementObservation(()=>true);assert.equal(handle?.window,undefined);
  host.acceptClaudeAchievementSnapshot(snapshot(result.index),handle,result.achievementUsageDelta);await settle(host);
  return {result,file};
}
async function growth(host:any,root:string,base:Awaited<ReturnType<typeof baseline>>,clock:(n:number)=>void) {
  clock(T+15*60_000);const handle=await host.beginClaudeAchievementObservation(()=>true);assert.ok(handle?.window);
  const tail=line('live',1_000_000,T+10*60_000);await appendFile(base.file,tail);
  const result=await updateClaudeUsageIndex(base.result.index,path.join(root,'claude-source'),{
    analyzeContent:false,achievementUsageWindow:handle.window});
  assert.equal(result.diagnostics.bodyReads,1);assert.equal(result.diagnostics.bytesRead,Buffer.byteLength(tail));
  assert.equal(result.achievementUsageDelta?.money?.anthropic?.microUsd,1_000_000);
  return {result,handle};
}
test('partial positive API subtotals below one dollar never combine greater-than and less-than signs',async()=>owner(async h=>{
  const directory=path.join(h.root,'claude-source','projects','synthetic');await mkdir(directory,{recursive:true});
  const known=JSON.parse(line('tiny',1,T-60_000)),unknown=JSON.parse(line('unknown',1,T-60_000));
  unknown.message.model='unknown-private-model';
  await writeFile(path.join(directory,'tiny.jsonl'),[known,unknown].map(row=>JSON.stringify(row)+'\n').join(''));
  const result=await updateClaudeUsageIndex(createClaudeUsageIndex(),path.join(h.root,'claude-source'),{analyzeContent:false});
  const data=snapshot(result.index);assert.equal(data.money!.coverage.cumulative.status,'partial');
  assert.equal(data.money!.coverage.cumulative.amountPositive,true);
  const handle=await h.host.beginClaudeAchievementObservation(()=>true);
  h.host.acceptClaudeAchievementSnapshot(data,handle,result.achievementUsageDelta);await settle(h.host);
  const html=h.host.renderAchievementData();assert.match(html,/&lt;\$1/);
  assert.doesNotMatch(html,/≥&lt;\$1/,'the card, exact tooltip and next-target overview must show the known positive subtotal');
}));
test('real Claude append records cumulative API and Token crossings while hidden; session money remains quiet',async()=>owner(async h=>{
  const base=await baseline(h.host,h.root),live=await growth(h.host,h.root,base,h.clock);
  h.host.acceptClaudeAchievementSnapshot(snapshot(live.result.index),live.handle,live.result.achievementUsageDelta);await settle(h.host);
  const saved=await loadAchievementRecords(h.file);assert.ok(saved);
  for(const id of ['claude-api-total-bronze','hundred-million-club']) {
    const row:AchievementRecord|undefined=saved.records.find(r=>r.id===id);assert.ok(row,id);assert.equal(row.origin,'usage');assert.equal(row.unread,true);
    assert.equal(row.recordedDay,'2026-10-10');assert.equal(row.timeZone,'UTC');
  }
  assert.equal(saved.records.find(r=>r.id==='claude-api-total-bronze')!.referencePricebook,snapshot(live.result.index).money!.pricebookVersion);
  const session=saved.records.find(r=>r.id==='claude-api-session-silver');assert.ok(session);assert.equal(session.origin,'history');
  assert.equal(session.recordedDay,null);assert.equal(session.unread,false);
  assert.equal(h.messages.some(m=>m.command==='achievementUnlockNotice'),false,'hidden receipt does not force a notice');
  assert.doesNotMatch(JSON.stringify(saved),/exactMicroUsdUnits|eligibleProcessed|money-live-owner|synthetic-live|99_000_000/);
}));
test('a book change before the lease preserves the independent Token receipt but withdraws money dating',async()=>owner(async h=>{
  const base=await baseline(h.host,h.root),live=await growth(h.host,h.root,base,h.clock),hold=deferred();
  h.host.achievementWrite=hold.promise;h.host.acceptClaudeAchievementSnapshot(snapshot(live.result.index),live.handle,live.result.achievementUsageDelta);
  const changed=claudeUsageDashboardSnapshot(live.result.index,{now:new Date(),achievementMoneyBackend:'aws-bedrock-in-region'}).achievementMoney;
  h.host.achievementMoneyFacts={claude:changed};hold.resolve();await settle(h.host);
  const saved=await loadAchievementRecords(h.file);assert.ok(saved);
  assert.equal(saved.records.find(r=>r.id==='hundred-million-club')?.origin,'usage');
  assert.notEqual(saved.records.find(r=>r.id==='claude-api-total-bronze')?.origin,'usage');
}));
test('one visible accepted append coalesces independent Token and API receipts into one confirmed notice batch',async()=>owner(async h=>{
  const base=await baseline(h.host,h.root),live=await growth(h.host,h.root,base,h.clock);
  h.host.panel.visible=true;
  h.host.acceptClaudeAchievementSnapshot(snapshot(live.result.index),live.handle,live.result.achievementUsageDelta);await settle(h.host);
  const notices=h.messages.filter(m=>m.command==='achievementUnlockNotice');
  assert.equal(notices.length,1,'one source update uses the existing shared notice budget once');
  assert.ok(h.host.achievementNoticeInFlight.ids.includes('hundred-million-club'));
  assert.ok(h.host.achievementNoticeInFlight.ids.includes('claude-api-total-bronze'),'same-batch money cannot be lost behind its independent Token save');
  assert.doesNotMatch(JSON.stringify(notices),/exactMicroUsdUnits|eligibleProcessed|referencePricebooks/);
}));
test('a failed money save keeps bounded retryable same-book proof without optimistic dating',async()=>owner(async h=>{
  const base=await baseline(h.host,h.root),live=await growth(h.host,h.root,base,h.clock),repository=h.host.achievementRecordRepository;
  const original=repository.recordUsage.bind(repository);let failed=false;
  repository.recordUsage=async(...args:any[])=>{
    if(!failed&&args[2].includes('claude-api-total-bronze')) {failed=true;throw new Error('synthetic-save');}
    return original(...args);
  };
  h.host.acceptClaudeAchievementSnapshot(snapshot(live.result.index),live.handle,live.result.achievementUsageDelta);await settle(h.host);
  assert.equal(failed,true,'actual monetary receipt reaches the atomic store');
  assert.notEqual((await loadAchievementRecords(h.file))?.records.find(r=>r.id==='claude-api-total-bronze')?.origin,'usage');
  assert.ok(h.host.usageAchievementReceipts.has('claude-api-total-bronze'));
  h.clock(T+20*60_000);await h.host.beginClaudeAchievementObservation(()=>true);await settle(h.host);
  const row=(await loadAchievementRecords(h.file))?.records.find(r=>r.id==='claude-api-total-bronze');
  assert.equal(row?.origin,'usage');assert.equal(row?.unread,true);assert.equal(row?.recordedDay,'2026-10-10');
  assert.equal(h.host.usageAchievementReceipts.has('claude-api-total-bronze'),false);
}));
test('retired source and OFF reject queued monetary provenance with no later replay',async()=>{
  for(const action of ['source','off'])await owner(async h=>{
    const base=await baseline(h.host,h.root),live=await growth(h.host,h.root,base,h.clock),hold=deferred();
    h.host.achievementWrite=hold.promise;h.host.acceptClaudeAchievementSnapshot(snapshot(live.result.index),live.handle,live.result.achievementUsageDelta);
    if(action==='source')h.host.invalidateAchievementEvidence('claude');else{h.disable();h.host.retireAchievementUsageObservations();}
    hold.resolve();await settle(h.host);
    assert.equal((await loadAchievementRecords(h.file))?.records.some(r=>r.id==='claude-api-total-bronze'),false);
    assert.equal(h.host.usageAchievementReceipts.has('claude-api-total-bronze'),false);
  });
});
test('real Codex worker and facade deliver a frozen cumulative money receipt; warm refresh has zero bodies',async()=>owner(async h=>{
  const workerStart=systemNow();h.clock(workerStart);
  const workerDay=new Date(workerStart).toISOString().slice(0,10);
  const root=path.join(h.root,'codex-source');await mkdir(path.join(root,'sessions'),{recursive:true});
  const log=path.join(root,'sessions','usage.jsonl');
  const token=(input:number,last:number,time:number)=>JSON.stringify({type:'event_msg',timestamp:new Date(time).toISOString(),payload:{type:'token_count',info:{
    total_token_usage:{input_tokens:input,cached_input_tokens:0,output_tokens:0},
    last_token_usage:{input_tokens:last,cached_input_tokens:0,output_tokens:0}}}})+'\n';
  await writeFile(log,JSON.stringify({type:'session_meta',payload:{id:'synthetic-root',cwd:root}})+'\n'+
    JSON.stringify({type:'turn_context',payload:{model:'gpt-6-sol',effort:'high'}})+'\n'+token(49_000_000,49_000_000,workerStart-60_000));
  const provider=new CodexProvider({enabled:true,codexHome:root,indexPath:path.join(h.root,'synthetic-codex-index.json'),salt:'synthetic-money-live-salt',timeZone:'UTC'});
  const accept=(result:any,handle:any)=>{
    const view=buildCodexUsageView(result.snapshot,Date.now()),signals=codexModelSignals(result.snapshot.files);
    signals.tokenEvidence=codexAchievementTokenEvidence(result.snapshot.files,true);
    signals.money=codexAchievementMoneyScopes({backend:'openai',asOfDay:workerDay,files:result.snapshot.files,complete:true});
    h.host.providerAvailability={claude:false,codex:true,codexData:true};
    h.host.acceptCodexAchievementSnapshot(view,signals,handle,result.achievementUsageDelta);
  };
  try {
    let cold=await provider.refresh('foreground');
    for(let i=0;cold.diagnostic?.migrationPending&&i<6;i++)cold=await provider.refresh('foreground');
    assert.equal(cold.snapshot.currentManifestVerified,true);assert.equal(cold.snapshot.coverage.complete,true);
    const first=await h.host.beginCodexAchievementObservation(()=>true);assert.equal(first?.window,undefined);accept(cold,first);await settle(h.host);
    h.clock(systemNow());const handle=await h.host.beginCodexAchievementObservation(()=>true);assert.ok(handle?.window);
    await appendFile(log,token(50_000_000,1_000_000,handle.window.through));
    const live=await provider.refresh('foreground',undefined,true,handle.window);
    assert.equal(live.diagnostic?.bodyReads,1);assert.equal(live.achievementUsageDelta?.money?.openai?.microUsd,2_000_000,
      JSON.stringify({delta:live.achievementUsageDelta,diagnostic:live.diagnostic,quality:live.snapshot.qualityFlags,
        complete:live.snapshot.coverage.complete,processed:live.snapshot.files[0]?.total.inputTotal}));
    accept(live,handle);await settle(h.host);
    const row=(await loadAchievementRecords(h.file))?.records.find(r=>r.id==='codex-api-total-bronze');
    assert.ok(row);assert.equal(row.origin,'usage');assert.equal(row.unread,true);assert.equal(row.recordedDay,workerDay);
    assert.equal(row.referencePricebook,'api-reference-2026-10-openai-v1');
    assert.equal((await provider.refresh('foreground')).diagnostic?.bodyReads,0);
  } finally {await provider.dispose();}
}));
