import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {I18n} from '../i18n';
import {codexAchievementEffortStatistics} from '../achievementEffortStatistics';
import type {SupportedLanguage} from '../types';
import type {CodexFileAggregate} from '../providers/codex/codexIndex';
const loader=require('node:module'),original=loader._load;
loader._load=function(name:string,...args:unknown[]) {return name==='vscode'?{}:original.call(this,name,...args);};
let Provider:typeof import('../webview').UsageWebviewProvider;
try {Provider=require('../webview').UsageWebviewProvider;} finally {loader._load=original;}
function owner(files:CodexFileAggregate[]) {
  const p:any=Object.create(Provider.prototype);let enabled=true;
  Object.assign(p,{settings:{get:()=>enabled},revokedAchievementEvidence:new Set(),
    codexAchievementSignals:{effortStatistics:codexAchievementEffortStatistics(files)}});
  return {p,disable:()=>{enabled=false;}};
}
function file(key:string,model='gpt-6.1-sol',input=100_000_000,output=100_000):CodexFileAggregate {
  const tokens={inputTotal:input,outputTotal:output,cachedInput:0};
  return {total:tokens,byDay:{},byModel:{[model]:tokens},byEffort:{high:tokens},session:{sessionKey:key,role:'root'},
    structural:{patchCalls:0,toolCalls:0,postPatchToolCalls:0,compactCount:0,taskCompleteCount:0}};
}
test('real effort renderer explains six named tiers, three joint progress metrics and frozen-reference money in eight locales',()=>{
  const old=I18n.getLocale();
  try {for(const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'] as SupportedLanguage[]) {
    I18n.setLanguage(locale);const {p}=owner([file('private-root')]);
    for(const tier of [0,1,2]) {
      const html=p.renderAchievementEffortStatistics(tier);
      assert.equal((html.match(/data-effort-statistics-row=/g)||[]).length,6);
      for(const effort of ['low','medium','high','xhigh','max','ultra']) assert.ok(html.includes('data-effort-statistics-row="'+effort+'"'));
      assert.match(html,/USD/);assert.doesNotMatch(html,/api-reference-2026-10-openai-v1/);
      assert.match(html,/data-achievement-reference/);
      assert.equal((html.match(/data-effort-progress=/g)||[]).length,18);
      assert.equal((html.match(/data-effort-joint-progress=/g)||[]).length,6);
      assert.doesNotMatch(html,/private-root|sessionKey|<script>/);
    }
  }}finally {I18n.setLanguage(old as SupportedLanguage);}
});
test('missing price is not zero, partial pricing is a lower bound, and positive submicro value remains positive',()=>{
  const {p}=owner([file('known'),file('unknown','unknown-private-model')]);
  const partial=p.renderAchievementEffortStatistics(0);assert.match(partial,/data-effort-money="partial"/);assert.match(partial,/≥/);
  assert.doesNotMatch(partial,/unknown-private-model/);
  p.codexAchievementSignals.effortStatistics=codexAchievementEffortStatistics([file('tiny','gpt-5-nano',0,1)]);
  assert.match(p.renderAchievementEffortStatistics(0),/&lt;\$1/);
  p.codexAchievementSignals.effortStatistics=codexAchievementEffortStatistics([
    file('tiny','gpt-5-nano',0,1),file('unknown','unknown-private-model',0,1)]);
  const tinyPartial=p.renderAchievementEffortStatistics(0);
  assert.match(tinyPartial,/data-effort-money="partial"/);assert.match(tinyPartial,/&lt;\$1/);
  assert.doesNotMatch(tinyPartial,/≥&lt;\$1/,'a lower-bound prefix cannot qualify a less-than subtotal label');
  p.codexAchievementSignals.effortStatistics=codexAchievementEffortStatistics([file('unknown','unknown-private-model')]);
  const unpriced=p.renderAchievementEffortStatistics(0);assert.match(unpriced,/data-effort-money="unpriced"/);assert.doesNotMatch(unpriced,/\$0/);
});
test('unavailable, retired and OFF effort evidence cannot show old six-row numeric statistics',()=>{
  const {p,disable}=owner([file('private-root')]);p.revokedAchievementEvidence.add('codex');
  assert.doesNotMatch(p.renderAchievementEffortStatistics(0),/data-effort-statistics-row=/);
  p.revokedAchievementEvidence.clear();p.codexAchievementSignals.effortStatistics=undefined;
  assert.doesNotMatch(p.renderAchievementEffortStatistics(0),/data-effort-statistics-row=/);
  disable();Object.defineProperty(p,'codexAchievementSignals',{get:()=>assert.fail('OFF effort proof access')});
  assert.equal(p.renderAchievementEffortStatistics(0),'');
});
