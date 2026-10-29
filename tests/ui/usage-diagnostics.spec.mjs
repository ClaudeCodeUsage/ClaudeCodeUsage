import {test,expect,openCodex,openClaude} from './support/app.mjs';
const locales=['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'];
const open=(page,provider,options={})=>(provider==='codex'?openCodex:openClaude)(page,{fixture:'usage-diagnostics-on',width:320,...options});
for(const provider of ['claude','codex'])for(const locale of locales){
 test(`${provider} diagnostics ${locale}: real renderer, 320px, no raw identity`,async({page},info)=>{
  await open(page,provider,{locale,theme:'dark'});await page.locator('#tab-content').click();
  const panel=page.locator(`[data-usage-diagnostics="${provider}"]`);await expect(panel).toBeVisible();
  await expect(panel.locator('[data-diagnostic]')).toHaveCount(2);
  await expect(panel.locator('[data-diagnostic="quota"]')).toHaveCount(0);
  await expect(panel).toContainText('TPS');await expect(panel).toContainText('Token');
  await panel.locator('details').first().locator('summary').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await page.content()).not.toMatch(/SYNTHETIC_ACCOUNT_FINGERPRINT|SYNTHETIC_WINDOW_FINGERPRINT/);
  await panel.screenshot({path:info.outputPath(`diagnostics-${provider}-${locale}-320.png`),animations:'disabled'});
 });
}
for(const provider of ['claude','codex']){
 test(`${provider}: diagnostic defaults remain off with the same numeric evidence`,async({page})=>{
  await open(page,provider,{fixture:'usage-diagnostics-off'});await page.locator('#tab-content').click();
  await expect(page.locator('[data-usage-diagnostics]')).toHaveCount(0);
 });
 for(const theme of ['light','highContrast'])test(`${provider}: diagnostics ${theme} reuse registered theme tokens`,async({page},info)=>{
  await open(page,provider,{theme,locale:'zh-CN'});await page.locator('#tab-content').click();
  const panel=page.locator(`[data-usage-diagnostics="${provider}"]`);await expect(panel).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await panel.screenshot({path:info.outputPath(`diagnostics-${provider}-${theme}-320.png`),animations:'disabled'});
 });
 test(`${provider}: evidence disclosure survives numeric patch and reload`,async({page})=>{
  await open(page,provider);await page.locator('#tab-content').click();
  const detail=page.locator(`details[data-persist="diagnostics:${provider}:models"]`);
  await detail.locator('summary').focus();await detail.locator('summary').press('Enter');
  await page.clock.runFor(100);await expect(detail).toHaveAttribute('open');
  const before=await detail.textContent();const url=new URL(page.url());url.searchParams.set('fixture','usage-diagnostics-updated');
  const response=await page.context().request.get(url.href);expect(response.ok()).toBe(true);
  await page.evaluate(({html,provider})=>{
   const next=new DOMParser().parseFromString(html,'text/html').getElementById('provider-panel');
   dispatchEvent(new MessageEvent('message',{data:{command:'dashboardDataPatch',provider,tab:'content',revision:73,
    html:next.innerHTML,claudeLast30HoursByDay:{},adviceSnapshotIds:{}}}));
  },{html:await response.text(),provider});
  await page.clock.runFor(250);
  await expect.poll(()=>page.evaluate(()=>window.__ccuPostedMessages.some(m=>m.command==='dashboardDataPatchAck'&&m.revision===73&&m.ok))).toBe(true);
  await expect(detail).toHaveAttribute('open');expect(await detail.textContent()).not.toBe(before);
  await page.reload();await expect(detail).toHaveAttribute('open');
  expect(await page.content()).not.toMatch(/SYNTHETIC_ACCOUNT_FINGERPRINT|SYNTHETIC_WINDOW_FINGERPRINT/);
 });
}
