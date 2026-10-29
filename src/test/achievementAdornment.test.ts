import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {renderAchievementIcon, renderAchievementWebviewIcon, achievementIconRank} from '../achievementIcons';
import {renderAchievementAdornment} from '../achievementAdornment';
import {ACHIEVEMENT_SERIES} from '../achievements';
import {renderAchievementShareSvg} from '../achievementShare';
import {ACHIEVEMENT_COPY} from '../i18n';

test('catalog identities select square ranks, including IDs without rank suffixes',()=>{
  for(const [id,rank] of [['hundred-million-club','bronze'],['billion-token-club','silver'],
    ['ten-billion-token-club','gold'],['hundred-billion-token-club','platinum'],['trillion-token-club','legendary'],
    ['streak-machine','milestone']] as const){
    const svg=renderAchievementIcon(id,'currentColor',{x:0,y:0,size:80}).replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g,'data:image/png;base64,fixture');
    assert.match(svg,new RegExp('data-achievement-frame="'+rank+'"'));
    assert.match(svg,/<rect[^>]+data-frame-part="square"/);
    assert.equal(svg.includes('data-frame-part="laurel"'),['gold','platinum','legendary'].includes(rank));
    assert.equal(svg.includes('data-frame-part="complete"'),rank==='milestone');
    assert.doesNotMatch(svg,/<circle|<foreignObject|<script|https:/);
  }
});
test('actual share output includes tier adornments inside a neutral card and remains deterministic',()=>{
  const copy=ACHIEVEMENT_COPY.en;
  const input={selected:['ten-billion-token-club','local-share-export'] as const,titles:copy.titles,
    heading:copy.shareTitle,subtitle:copy.intro,groups:copy.groups,levels:copy.levels,milestone:copy.milestone,footer:copy.heading};
  const svg=renderAchievementShareSvg(input);
  assert.match(svg,/data-achievement-frame="gold"/);
  assert.match(svg,/data-achievement-frame="milestone"/);
  assert.equal((svg.match(/data-share-card-frame="neutral"/g)||[]).length,2);
  assert.equal(svg,renderAchievementShareSvg(input));
});

test('webview resource PNGs and self-contained exports use identical adornment geometry',()=>{
  for(const id of ['hundred-million-club','billion-token-club','ten-billion-token-club',
    'hundred-billion-token-club','trillion-token-club','streak-machine'] as const){
    const geometry=renderAchievementAdornment(achievementIconRank(id));
    const web=renderAchievementWebviewIcon(id,'/__achievement_icons__/fixture.png');
    assert.ok(web.includes(geometry),id);
    assert.ok(renderAchievementIcon(id,'currentColor',{x:0,y:0,size:80}).includes(geometry),id);
    assert.ok(web.includes('src="/__achievement_icons__/fixture.png"'));
    assert.ok(web.includes('loading="lazy"'));
    assert.ok(!web.includes('data:image/'));
  }
});
test('target and locked marks cannot look like a granted milestone or high-tier award',()=>{
  const target=renderAchievementWebviewIcon('trillion-token-club','fixture.png','target');
  assert.match(target,/data-achievement-frame="legendary" data-emblem-state="target"/);
  assert.match(target,/stroke-dasharray="4 3"/);
  const locked=renderAchievementWebviewIcon('trillion-token-club','fixture.png','locked');
  assert.match(locked,/data-achievement-frame="locked"/);
  assert.match(locked,/data-frame-part="lock"/);
  assert.doesNotMatch(locked,/data-frame-part="laurel"|data-frame-part="apex"/);
  assert.doesNotMatch(renderAchievementWebviewIcon('streak-machine','fixture.png','locked'),/data-frame-part="complete"/);
  assert.match(renderAchievementWebviewIcon('streak-machine','fixture.png'),/data-achievement-frame="milestone"/);
});
test('catalog series preserve their real number of tiers and webview resources remain attribute-escaped',()=>{
  assert.equal(ACHIEVEMENT_SERIES['codex-api-task'].length,3);
  assert.equal(ACHIEVEMENT_SERIES['codex-api-total'].length,4);
  assert.equal(ACHIEVEMENT_SERIES['cumulative-volume'].length,5);
  assert.equal(achievementIconRank(ACHIEVEMENT_SERIES['codex-api-task'][2]),'gold');
  assert.equal(achievementIconRank(ACHIEVEMENT_SERIES['codex-api-total'][3]),'platinum');
  const escaped=renderAchievementWebviewIcon('local-share-export','fixture.png" onload="bad<&');
  assert.ok(escaped.includes('src="fixture.png&quot; onload=&quot;bad&lt;&amp;"'));
  assert.doesNotMatch(escaped,/ src="[^"]*" onload=/);
});

test('exported artwork keeps its full requested size with separate eight-unit ornament margins',()=>{
  for (const size of [40,48,56,64,72,80,96,112]) {
    const svg=renderAchievementIcon('trillion-token-club','currentColor',{x:5,y:7,size});
    const edge=size>56?8:0,total=size+2*edge;
    const image=svg.match(/<image[^>]+>/)![0].replace(/href="[^"]+"/,'href="fixture"');
    assert.match(svg,new RegExp('x="5" y="7" width="'+total+'" height="'+total+'" viewBox="0 0 '+total+' '+total+'"'));
    assert.match(image,new RegExp('x="'+edge+'" y="'+edge+'" width="'+size+'" height="'+size+'"'));
    assert.equal(svg.includes('data-frame-part="laurel"'), size > 56);
  }
});

test('full size rank outlines use increasing outer laurel counts',()=>{
  for(const [rank,count] of [['gold',6],['platinum',8],['legendary',10]] as const) {
    const geometry=renderAchievementAdornment(rank);
    assert.equal((geometry.match(/data-frame-part="laurel"/g)||[]).length,count);
  }
});

test('gallery webview holds bounded size variants without duplicating the resource image',()=>{
  const web=renderAchievementWebviewIcon('trillion-token-club','fixture.png');
  assert.match(web,/data-icon-context="gallery"/);
  assert.equal((web.match(/<img\b/g)||[]).length,1);
  assert.equal((web.match(/<svg\b/g)||[]).length,1);
  assert.deepEqual([...web.matchAll(/data-art-size="(\d+)"/g)].map(m=>Number(m[1])),[56,80,112]);
});

test('each webview context includes only its bounded size variants with export-identical geometry',()=>{
  const sizes = {gallery:[56,80,112],overview:[56,72,96],record:[40,56],detail:[40],selection:[48]} as const;
  for (const context of Object.keys(sizes) as (keyof typeof sizes)[]) {
    const web=renderAchievementWebviewIcon('trillion-token-club','fixture.png','earned',undefined,context);
    assert.match(web,new RegExp('data-icon-context="'+context+'"'));
    assert.deepEqual([...web.matchAll(/data-art-size="(\d+)"/g)].map(m=>Number(m[1])),[...sizes[context]]);
    for (const size of sizes[context]) {
      const geometry=renderAchievementAdornment('legendary','earned',size);
      assert.ok(web.includes('<g data-art-size="'+size+'">'+geometry+'</g>'));
      assert.ok(renderAchievementIcon('trillion-token-club','currentColor',{x:0,y:0,size}).includes(geometry));
      assert.equal(geometry.includes('data-frame-part="laurel"'),size>56);
    }
  }
});
