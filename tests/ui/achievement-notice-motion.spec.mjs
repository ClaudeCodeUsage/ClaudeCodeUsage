import { test, expect, openCodex } from './support/app.mjs';

// Keep every builtin theme value, removing only the harness-wide motion override.
// Otherwise screenshots' deterministic override would hide production animation.
async function allowProductionMotion(page) {
  await page.evaluate(() => {
    const style = document.getElementById('test-vscode-theme');
    style.textContent = style.textContent.replace(/\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*animation[^}]*\}/g, '');
  });
}
async function show(page) {
  await page.locator('#tab-achievements').focus();
  await page.evaluate(() => {
    window.__ccuPostedMessages = [];
    window.dispatchEvent(new MessageEvent('message', { data: {
      command: 'achievementUnlockNotice', text: 'Astra unlocked',
      iconFile: 'codex-astra-regular.png', noticeId: 'a'.repeat(48),
    } }));
  });
}

test('new award animates only its emblem once, without focus theft or extra messages', async ({ page }, testInfo) => {
  await openCodex(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await allowProductionMotion(page);
  const html = await (await page.context().request.get(page.url())).text();
  await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 60000).toISOString()));
  await show(page);
  const notice = page.locator('#ccuAchievementUnlockNotice');
  const icon = notice.locator('img');
  const style = await icon.evaluate(el => {
    const s = getComputedStyle(el);
    return { name: s.animationName, duration: parseFloat(s.animationDuration), count: s.animationIterationCount };
  });
  expect(style.name).toBe('ccuBadgeArrive');
  expect(style.duration).toBeGreaterThan(0); expect(style.duration).toBeLessThanOrEqual(.6);
  expect(style.count).toBe('1');
  expect(await notice.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await expect(page.locator('#tab-achievements')).toBeFocused();
  await page.clock.runFor(700);
  // Browser CSS uses the real document timeline, unlike the mocked JS dismissal clock.
  await expect.poll(() => icon.evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
  await page.evaluate(html => {
    const panel = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
    window.dispatchEvent(new MessageEvent('message', { data: {
      command: 'dashboardDataPatch', provider: 'codex', tab: 'today', revision: 1,
      html: panel.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {},
    } }));
  }, html);
  await page.clock.runFor(200);
  expect(await icon.evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
  await notice.screenshot({ path: testInfo.outputPath('notice-static-after-single-motion.png') });
  await page.clock.runFor(4000);
  await expect(notice).toBeVisible();
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(row => row.command === 'achievementNoticeAck'))).toEqual([
    { command: 'achievementNoticeAck', noticeId: 'a'.repeat(48) },
  ]);
  for (const command of ['refresh', 'exportAchievementShare', 'updateSetting'])
    expect(await page.evaluate(() => window.__ccuPostedMessages.map(row => row.command))).not.toContain(command);
  await page.clock.runFor(1500); await expect(notice).toHaveCount(0);
  await page.reload(); await expect(notice).toHaveCount(0);
});

for (const mode of ['reduced', 'high-contrast', 'high-contrast-light']) {
  test(`${mode} keeps new award feedback entirely static`, async ({ page }) => {
    await openCodex(page);
    await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    if (mode !== 'reduced') await page.evaluate(mode => { document.body.className = `vscode-${mode}`; }, mode);
    await allowProductionMotion(page); await show(page);
    const icon = page.locator('#ccuAchievementUnlockNotice img');
    expect(await icon.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await expect(page.locator('#tab-achievements')).toBeFocused();
  });
}
