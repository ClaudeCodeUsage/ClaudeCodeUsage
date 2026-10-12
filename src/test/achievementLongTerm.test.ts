import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {ACHIEVEMENT_DEFINITIONS,ACHIEVEMENT_SERIES,evaluateAchievements,migrateCalibratedAchievementGrants} from '../achievements';
import {isLegacyAchievementId} from '../achievementRuleVersions';
import {achievementCopyFor} from '../i18n';
import {ACHIEVEMENT_IMAGE_FILES} from '../achievementIcons';
import {LONG_TERM_ACHIEVEMENT_DEFINITIONS} from '../achievementLongTerm';
import {claudeTailAchievementCrossings} from '../achievementEvidence';

const sustained = ['sonnet-main','opus-cannon','haiku-worker','fable-volume','cache-wizard',
  'claude-output','claude-cache-creation','claude-output-sessions','fable-sessions',
  'sonnet-days','opus-days','haiku-days','fable-days','active-days','active-weeks'];

test('existing Claude and nonconsecutive activity routes continue beyond Gold without changing original ranks', () => {
  for (const series of sustained) {
    const ids = ACHIEVEMENT_SERIES[series];
    assert.equal(ids.length,5,series);
    const targets = ids.map(id => ACHIEVEMENT_DEFINITIONS.find(row=>row.id===id)!.target);
    assert.ok(targets.every((value,i) => Number.isSafeInteger(value) && value>0 && (!i || value>targets[i-1])),series);
    for (const id of ids.slice(3)) assert.equal(isLegacyAchievementId(id),false,'new rank cannot be imported as v1 proof');
    for (const locale of ['en','zh-CN','zh-TW','de-DE','ja','ko','pt-BR','id']) {
      const copy=achievementCopyFor(locale);
      for (const [index,id] of ids.entries()) {
        assert.ok(copy.titles[id],`${locale}:${id}`);
        if(index>=3) assert.ok(copy.titles[id].includes(copy.levels[index]),`${locale}:${id}`);
        assert.equal(ACHIEVEMENT_IMAGE_FILES[id],ACHIEVEMENT_IMAGE_FILES[ids[0]],'reuse the series art');
      }
    }
  }
  assert.equal(ACHIEVEMENT_SERIES['active-day-streak'].length,3,'do not extend consecutive-day pressure');
  assert.equal(ACHIEVEMENT_DEFINITIONS.filter(row=>isLegacyAchievementId(row.id)).length,124);
});

test('pre-calibration labels never confer new high tiers or poison old numeric floors', () => {
  const high=ACHIEVEMENT_SERIES['sonnet-main'].slice(3);
  assert.equal(high.length,2);
  const actual=migrateCalibratedAchievementGrants(['sonnet-main-gold',...high]);
  assert.ok(actual.includes('sonnet-main'));
  assert.ok(actual.includes('sonnet-main-silver'));
  assert.ok(high.every(id=>!actual.includes(id)),'legacy migration cannot authorize an additive high rank');
});

test('all new ranks use the exact existing counter at boundary and never borrow another metric', () => {
  for (const rule of LONG_TERM_ACHIEVEMENT_DEFINITIONS) {
    for (const offset of [-1,0,1]) {
      const count=rule.target+offset;
      const facts:any={claudeTokens:0,codexTokens:0,activeDays:0,claudeFamilies:[],
        claudeFamilyTokens:{sonnet:0,opus:0,haiku:0},fable:{processedTokens:0,outputSessions:0},
        calendar:{familyDays:{},activeWeeks:0},codex:{modelCount:0,efforts:[],familyRootCounts:{astra:0,sol:0,luna:0}}};
      if(rule.series==='sonnet-main') facts.claudeFamilyTokens.sonnet=count;
      else if(rule.series==='opus-cannon') facts.claudeFamilyTokens.opus=count;
      else if(rule.series==='haiku-worker') facts.claudeFamilyTokens.haiku=count;
      else if(rule.series==='fable-volume') facts.fable.processedTokens=count;
      else if(rule.series==='fable-sessions') facts.fable.outputSessions=count;
      else if(rule.series==='claude-output-sessions') facts.claudeOutputSessions=count;
      else if(rule.series==='claude-output') facts.claudeOutputTokens=count;
      else if(rule.series==='claude-cache-creation') facts.claudeCacheCreationTokens=count;
      else if(rule.series==='cache-wizard') facts.claudeCacheReadTokens=count;
      else if(rule.series==='active-days') facts.activeDays=count;
      else if(rule.series==='active-weeks') facts.calendar.activeWeeks=count;
      else facts.calendar.familyDays[rule.series.replace('-days','')]=count;
      facts.claudeTokens=Math.max(count,facts.claudeOutputTokens??0,facts.claudeCacheCreationTokens??0,
        facts.claudeCacheReadTokens??0);
      const result=evaluateAchievements(facts).find(row=>row.id===rule.id)!;
      assert.equal(result.progress,count,rule.id);
      assert.equal(result.unlocked,offset>=0,rule.id);
    }
  }
});

test('new output/cache ranks retain causal live proof; sessions and days cannot inherit a Token receipt', () => {
  const facts:any={claudeTokens:2_500_000_000,codexTokens:0,activeDays:0,claudeFamilies:[],
    claudeOutputTokens:499_999_999,claudeCacheCreationTokens:1_999_999_999,
    codex:{modelCount:0,efforts:[],familyRootCounts:{astra:0,sol:0,luna:0}}};
  const before=evaluateAchievements(facts);
  const after=evaluateAchievements({...facts,claudeTokens:2_500_000_002,claudeOutputTokens:500_000_000,claudeCacheCreationTokens:2_000_000_000,
    claudeOutputSessions:5_000,activeDays:1_500,calendar:{familyDays:{sonnet:1_000},activeWeeks:104}});
  const delta:any={provider:'claude',after:100,through:200,processed:2,output:1,cacheCreation:1,cacheRead:0,
    families:{sonnet:2,opus:0,haiku:0,fable:0}};
  assert.deepEqual(claudeTailAchievementCrossings(before,after,delta).sort(),
    ['claude-output-platinum','claude-cache-creation-platinum'].sort());
});
