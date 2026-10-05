import { test, expect, openCompare } from './support/app.mjs';

const deliberateShareCommands = ['previewAchievementShare', 'exportAchievementShare'];

test('Compare aggregate patches preserve badge choices, template, focus, and scroll without share actions', async ({ page }) => {
  await openCompare(page, {
    fixture: 'combined-heatmap', commandTemplate: 'achievements', width: 900, height: 420,
  });
  const choice = page.locator('.achievement-share-choice').first();
  await choice.check();
  const selectedId = await choice.inputValue();
  await expect.poll(() => page.evaluate(() =>
    window.__ccuPostedMessages.some((message) => message.command === 'previewAchievementShare'),
  )).toBe(true);

  // Fresh server render supplies unchecked badges. The browser fixture has no
  // extension-host bridge, so hydration requests are observed separately.
  const response = await page.context().request.get(page.url());
  expect(response.ok()).toBe(true);
  const documentText = await response.text();
  const before = await page.evaluate(({ documentText, selectedId }) => {
    const panel = document.getElementById('provider-panel');
    const next = new DOMParser().parseFromString(documentText, 'text/html')
      .getElementById('provider-panel');
    if (!panel || !next) throw new Error('Compare fixture must provide both panel renders');
    if (!next.querySelector(`.achievement-share-choice[value="${selectedId}"]`)) {
      throw new Error('The fresh render must contain the same earned badge');
    }
    next.querySelectorAll('.achievement-share-choice').forEach((input) => {
      input.checked = false;
      input.removeAttribute('checked');
    });
    // Model stale server defaults while retaining the earned-badge controls.
    // Hydration must reapply the saved presentation without firing change events.
    next.querySelectorAll('#sharingTemplate option').forEach((option) => {
      option.toggleAttribute('selected', option.value === 'combinedHeatmap');
    });
    next.querySelectorAll('[data-sharing-presentation]').forEach((section) => {
      section.hidden = section.getAttribute('data-sharing-presentation') !== 'combinedHeatmap';
    });
    const addGeometry = (root) => {
      const filler = document.createElement('div');
      filler.style.height = '1200px';
      root.append(filler);
      const preview = root.querySelector('#achievementSharePreview');
      preview.style.cssText = 'display:block;height:120px;overflow:auto;';
      const content = document.createElement('div');
      content.style.cssText = 'width:1800px;height:400px;';
      preview.append(content);
    };
    addGeometry(panel);
    addGeometry(next);
    next.querySelector('.usage-summary').setAttribute('data-compare-refresh-fixture', 'fresh');
    const preview = document.getElementById('achievementSharePreview');
    preview.focus({ preventScroll: true });
    preview.scrollLeft = 81;
    preview.scrollTop = 29;
    window.scrollTo(0, 180);
    window.dispatchEvent(new Event('scroll'));
    window.__compareRefreshDocument = document.documentElement;
    window.__compareRefreshPanel = panel;
    const snapshot = {
      scrollY, scrollLeft: preview.scrollLeft, scrollTop: preview.scrollTop,
      template: localStorage.getItem('ccu.sharing.template'),
      badges: localStorage.getItem('ccu.sharing.achievementBadges'),
    };
    window.__ccuPostedMessages = [];
    window.dispatchEvent(new MessageEvent('message', { data: {
      command: 'dashboardDataPatch', provider: 'compare', tab: 'all', revision: 1,
      html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {},
    } }));
    return snapshot;
  }, { documentText, selectedId });
  expect(before.template).toBe('achievements');
  expect(JSON.parse(before.badges)).toEqual([selectedId]);
  expect(before.scrollY).toBeGreaterThan(0);
  expect(before.scrollLeft).toBeGreaterThan(0);
  expect(before.scrollTop).toBeGreaterThan(0);

  await expect.poll(() => page.evaluate(() =>
    window.__ccuPostedMessages.filter((message) => message.command === 'dashboardDataPatchAck'),
  )).toEqual([{ command: 'dashboardDataPatchAck', revision: 1, ok: true }]);
  await expect(page.locator('.usage-summary[data-compare-refresh-fixture="fresh"]')).toHaveCount(1);
  await expect(page.locator('#provider-tab-compare')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#sharingTemplate')).toHaveValue('achievements');
  await expect(page.locator('.achievement-share-presentation')).toBeVisible();
  await expect(page.locator('.achievement-share-choice:checked')).toHaveCount(1);
  await expect(page.locator(`.achievement-share-choice[value="${selectedId}"]`)).toBeChecked();
  await expect(page.locator('#achievementShareCount')).toHaveText('1/9');
  await expect.poll(() => page.evaluate(() => {
    const preview = document.getElementById('achievementSharePreview');
    return { scrollY, scrollLeft: preview.scrollLeft, scrollTop: preview.scrollTop,
      focused: document.activeElement?.id };
  })).toEqual({ scrollY: before.scrollY, scrollLeft: before.scrollLeft,
    scrollTop: before.scrollTop, focused: 'achievementSharePreview' });
  expect(await page.evaluate(() =>
    document.documentElement === window.__compareRefreshDocument &&
    document.getElementById('provider-panel') === window.__compareRefreshPanel,
  )).toBe(true);
  const posted = await page.evaluate(() => window.__ccuPostedMessages);
  expect(posted.filter((message) => deliberateShareCommands.includes(message.command))).toEqual([]);
  expect(await page.evaluate(() => ({
    template: localStorage.getItem('ccu.sharing.template'),
    badges: localStorage.getItem('ccu.sharing.achievementBadges'),
  }))).toEqual({ template: before.template, badges: before.badges });
});

test('Compare rejects wrong-provider and script-bearing patches without touching sharing controls', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  const choice = page.locator('.achievement-share-choice').first();
  await choice.check();
  const selectedId = await choice.inputValue();
  const result = await page.evaluate(() => {
    const panel = document.getElementById('provider-panel');
    const html = panel.innerHTML;
    const first = panel.firstElementChild;
    window.__ccuPostedMessages = [];
    const outcomes = [
      { provider: 'claude', html },
      { provider: 'compare', html: '<script>window.__compareUnsafeScript = true;</script>' },
    ].map((payload, index) => ccuApplyDashboardDataPatch({
      ...payload, command: 'dashboardDataPatch', tab: 'all', revision: index + 1,
      claudeLast30HoursByDay: {}, adviceSnapshotIds: {},
    }));
    return { outcomes, unchanged: panel.firstElementChild === first,
      scriptRan: window.__compareUnsafeScript === true, messages: window.__ccuPostedMessages };
  });
  expect(result.outcomes).toEqual([false, false]);
  expect(result.unchanged).toBe(true);
  expect(result.scriptRan).toBe(false);
  expect(result.messages.filter((message) => message.command === 'dashboardDataPatchAck'))
    .toEqual([1, 2].map((revision) => ({ command: 'dashboardDataPatchAck', revision, ok: false })));
  expect(result.messages.filter((message) => deliberateShareCommands.includes(message.command))).toEqual([]);
  await expect(page.locator(`.achievement-share-choice[value="${selectedId}"]`)).toBeChecked();
  await expect(page.locator('#sharingTemplate')).toHaveValue('achievements');
});
