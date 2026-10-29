import {test,expect,openClaude,openCodex} from './support/app.mjs';

async function openDiagnostics(page,provider,options={}) {
 await (provider==='claude'?openClaude:openCodex)(page,{fixture:'usage-diagnostics-on',locale:'zh-CN',theme:'dark',width:320,...options});
 await page.locator('#tab-content').click();
 const panel=page.locator(`[data-usage-diagnostics="${provider}"]`);
 await expect(panel).toBeVisible();
 return panel;
}

async function patchDiagnostics(page,provider) {
 const url=new URL(page.url());url.searchParams.set('fixture','usage-diagnostics-updated');
 const response=await page.context().request.get(url.href);expect(response.ok()).toBe(true);
 await page.evaluate(({html,provider})=>{
  const next=new DOMParser().parseFromString(html,'text/html').getElementById('provider-panel');
  if(!next)throw Error('Updated fixture has no provider panel');
  dispatchEvent(new MessageEvent('message',{data:{command:'dashboardDataPatch',provider,tab:'content',revision:91,
   html:next.innerHTML,claudeLast30HoursByDay:{},adviceSnapshotIds:{}}}));
 },{html:await response.text(),provider});
 await page.clock.runFor(250);
 await expect.poll(()=>page.evaluate(()=>window.__ccuPostedMessages.some(m=>m.command==='dashboardDataPatchAck'&&m.revision===91&&m.ok))).toBe(true);
}

for(const provider of ['claude','codex']) {
 for(const width of [320,960]) test(`${provider}: result-first diagnostics preserve visible scope and caveats at ${width}px`,async({page},info)=>{
  const panel=await openDiagnostics(page,provider,{width});
  const change=panel.locator('[data-diagnostic="change"]');
  const result=change.locator('[data-diagnostic-result]');
  await expect(result).toBeVisible();await expect(result).toContainText('+1,500');await expect(result).toContainText('Token');
  const visibleChange=await change.innerText();
  expect(visibleChange).toContain('2026-07-18');expect(visibleChange).toContain('2026-07-19');
  const method=change.locator('details[data-diagnostic-method="change"]');
  await expect(method).not.toHaveAttribute('open');
  expect(await result.evaluate((el)=>Boolean(el.compareDocumentPosition(el.closest('[data-diagnostic]').querySelector('[data-diagnostic-method]'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const throughput=panel.locator('[data-diagnostic="throughput"]');
  await expect(throughput.locator('[data-diagnostic-result]')).toContainText('187.5');
  await expect(throughput.locator('details[data-diagnostic-method="throughput"]')).not.toHaveAttribute('open');
  await expect(panel.locator('[data-diagnostic]')).toHaveCount(2);
  await expect(panel.locator('[data-diagnostic="quota"]')).toHaveCount(0);
  expect(await panel.innerText()).toContain('模型和角色');
  const models=panel.locator(`details[data-persist="diagnostics:${provider}:models"]`);
  await models.locator('summary').click();
  const layout=await panel.evaluate(el=>({
   pageFits:document.documentElement.scrollWidth<=innerWidth+1,
   rows:[...el.querySelectorAll('.cbar-row')].filter(row=>row.getClientRects().length).map(row=>{
    const label=row.querySelector('.cbar-label'),track=row.querySelector('.cbar-track'),value=row.querySelector('.cbar-val');
    if(!label||!track||!value)return true;
    const a=label.getBoundingClientRect(),b=track.getBoundingClientRect(),c=value.getBoundingClientRect();
    return a.right<=b.left+1&&b.right<=c.left+1;
   })
  }));
  expect(layout.pageFits).toBe(true);expect(layout.rows.every(Boolean)).toBe(true);
  await models.locator('summary').click();await expect(models).not.toHaveAttribute('open');
  expect(await page.content()).not.toMatch(/SYNTHETIC_ACCOUNT_FINGERPRINT|SYNTHETIC_WINDOW_FINGERPRINT/);
  await panel.screenshot({path:info.outputPath(`diagnostics-result-first-${provider}-${width}.png`),animations:'disabled'});
  if(width===960)await page.locator('#content').screenshot({path:info.outputPath(`content-${provider}-960.png`),animations:'disabled'});
 });

 test(`${provider}: diagnostic method disclosure survives numeric update and reload`,async({page})=>{
  const panel=await openDiagnostics(page,provider);
  const method=panel.locator('details[data-diagnostic-method="change"]');
  const persistKey=await method.getAttribute('data-persist');expect(persistKey).toMatch(/^diagnostics:/);
  await method.locator('summary').focus();await method.locator('summary').press('Enter');
  await expect(method).toHaveAttribute('open');await page.clock.runFor(100);
  await patchDiagnostics(page,provider);
  await expect(method).toHaveAttribute('open');
  await expect(panel.locator('[data-diagnostic="change"] [data-diagnostic-result]')).toContainText('+3,500');
  await page.reload();
  await expect(panel).toBeVisible();await expect(method).toHaveAttribute('open');
  expect(await method.getAttribute('data-persist')).toBe(persistKey);
 });

 test(`${provider}: disabled diagnostics leave no empty result or method panels`,async({page})=>{
  await (provider==='claude'?openClaude:openCodex)(page,{fixture:'usage-diagnostics-off',locale:'zh-CN',theme:'dark',width:320});
  await page.locator('#tab-content').click();
  await expect(page.locator('[data-usage-diagnostics]')).toHaveCount(0);
  await expect(page.locator('[data-diagnostic-result],[data-diagnostic-method]')).toHaveCount(0);
 });
}

for (const width of [320,960]) test(`Claude nonempty content categories and tool details fit at ${width}px`,async({page},info)=>{
 await openDiagnostics(page,'claude',{width});
 const content=page.locator('[data-analysis-summary="claude"]');
 await expect(content.locator(':scope > .cbar-list > .cbar-row')).toHaveCount(2);
 await expect(content).toContainText('7,000');await expect(content).toContainText('70.0%');
 await content.locator('details[data-persist="analysis:claude:tools"] > summary').click();
 const geometry=await content.evaluate(el=>({fits:document.documentElement.scrollWidth<=innerWidth+1,
  rows:[...el.querySelectorAll('.cbar-row')].map(row=>{const box=row.getBoundingClientRect();
   return row.scrollWidth<=row.clientWidth+1&&[...row.children].every(cell=>{const r=cell.getBoundingClientRect();
    return r.left>=box.left-1&&r.right<=box.right+1;});})}));
 expect(geometry.fits).toBe(true);expect(geometry.rows.every(Boolean)).toBe(true);
 await content.screenshot({path:info.outputPath(`content-categories-${width}.png`),animations:'disabled'});
});
