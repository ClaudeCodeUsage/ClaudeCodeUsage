import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { codexModelSignals, evaluateAchievements, AchievementFacts, AchievementId } from '../achievements';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
import { AchievementRecordRepository } from '../achievementRecordStore';
import { mkdtemp, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

function file(key: string, parent?: string, output = 20_000): CodexFileAggregate {
  const tokens = {inputTotal:0,outputTotal:output};
  return {total:{...tokens},byModel:{'gpt-6.1-sol':{...tokens}},byEffort:{},byDay:{},
    session:{sessionKey:key,role:parent ? 'subagent':'root',...(parent ? {parentSessionKey:parent}:{})},
    structural:{patchCalls:0,toolCalls:0,postPatchToolCalls:0,compactCount:0,taskCompleteCount:0}};
}
function teams(count: number, members = 8, output = 20_000): CodexFileAggregate[] {
  return Array.from({length:count},(_,i)=>[
    file('task-'+i),...Array.from({length:members},(_,j)=>file('member-'+i+'-'+j,'task-'+i,output)),
  ]).flat();
}
const facts = (files: CodexFileAggregate[] = []): AchievementFacts =>
  ({claudeTokens:0,codexTokens:0,activeDays:0,claudeFamilies:[],codex:codexModelSignals(files)});
const row = (value: AchievementFacts, id: AchievementId) => evaluateAchievements(value).find(rule=>rule.id===id)!;

test('old max-agent and effort counters cannot authorize the joint rules without new aligned evidence', () => {
  const value = facts();
  Object.assign(value.codex,{maxVerifiedAgentsPerRoot:100,maxRealModelsPerRoot:100,multiAgentRootCount:200,
    verifiedChildCount:5_000,multiModelRootCount:1_000,effortProcessedTokens:{low:1e12,medium:1e12,high:1e12,xhigh:1e12,max:1e12,ultra:1e12}});
  for (const id of ['agent-team-gold','same-root-models-gold','agent-conductor-gold',
    'agent-participation-gold','model-relay-roots-gold','effort-spectrum'] as const) assert.equal(row(value,id).unlocked,false,id);
});

test('one large tree is a single experience, not a repeated-team gold achievement', () => {
  const value = facts(teams(1,100,1_000_000));
  assert.equal(row(value,'agent-standup').unlocked,false);
  assert.equal(row(value,'agent-team-gold').unlocked,false);
  assert.equal(row(value,'agent-team-gold').progress,1);
});

test('team repetitions unlock exactly at 5/20/50 only with tier-aligned output and member width', () => {
  for (const [tasks,id,target] of [[5,'agent-standup',5],[20,'tiny-ai-company',20],[50,'agent-team-gold',50]] as const) {
    const below = row(facts(teams(tasks-1)),id),exact = row(facts(teams(tasks)),id);
    assert.equal(below.unlocked,false); assert.equal(exact.unlocked,true); assert.equal(exact.target,target);
  }
  assert.equal(row(facts(teams(50,8,4_999)),'agent-team-gold').unlocked,false);
});

test('input-only families and tiny token encounters cannot finish the output-qualified rainbow', () => {
  const value: AchievementFacts = {...facts(),claudeFamilyTokens:{sonnet:10_000_000,opus:10_000_000,haiku:10_000_000}};
  assert.equal(row(value,'model-rainbow-bronze').unlocked,false);
  Object.assign(value,{claudeFamilyOutputTokens:{sonnet:20_000,opus:19_999,haiku:0}});
  assert.equal(row(value,'model-rainbow-bronze').progress,1);
  Object.assign(value,{claudeFamilyOutputTokens:{sonnet:20_000,opus:20_000,haiku:0}});
  assert.equal(row(value,'model-rainbow-bronze').unlocked,true);
});

test('a migrated old team gold is not reissued as current gold by an old-criteria snapshot', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'ccu-joint-reissue-'));
  try {
    const old = new AchievementRecordRepository(path.join(directory,'achievements-v1.json'));
    await old.initialize(['agent-team-gold']);
    const current = new AchievementRecordRepository(path.join(directory,'achievements-v2.json'));
    let saved = await current.initialize([]);
    const value = facts(teams(1,10,1));
    const additions = evaluateAchievements(value).filter(rule=>rule.unlocked && !saved.records.some(item=>item.id===rule.id));
    saved = (await current.append(saved.generation,additions.map(rule=>
      ({id:rule.id,origin:'history' as const,recordedDay:null,timeZone:null})))).store;
    assert.ok(!saved.records.some(item=>item.id==='agent-team-gold'));
    assert.ok(saved.legacyRecords?.some(item=>item.id==='agent-team-gold'));
  } finally { await rm(directory,{recursive:true,force:true}); }
});
