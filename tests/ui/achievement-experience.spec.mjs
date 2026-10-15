import { test, expect, openCodex, openClaude, openCompare } from './support/app.mjs';

const modelExperienceNames = {
  en: ['Models in one task', 'Multi-model tasks', 'Fable same-session'],
  'zh-CN': ['同任务模型', '多模型任务', 'Fable 同会话'],
  'zh-TW': ['同任務模型', '多模型任務', 'Fable 同會話'],
  'de-DE': ['Modelle je Aufgabe', 'Mehrmodell-Aufgaben', 'Fable: gemeinsame Sitzung'],
  ja: ['同一タスクのモデル', '複数モデルのタスク', 'Fable 同一セッション'],
  ko: ['한 작업의 모델', '다중 모델 작업', 'Fable 같은 세션'],
  'pt-BR': ['Modelos por tarefa', 'Tarefas multimodelo', 'Fable na mesma sessão'],
  id: ['Model dalam satu tugas', 'Tugas multimodel', 'Fable dalam sesi yang sama'],
};

// Compare exposes its share workspace, not a provider achievement/settings tab.
for (const [provider, open] of [['claude', openClaude], ['codex', openCodex]]) {
  test(`${provider} reselecting the current tab preserves expanded rules and sends no duplicate host work`, async ({ page }) => {
    await open(page, { width: 360 });
    await page.locator('#tab-achievements').click();
    const card = page.locator('.achievement-card').first();
    await card.locator('summary').focus();
    await card.locator('summary').press('Enter');
    await page.clock.runFor(200);
    const before = await page.evaluate(() => ({
      state: JSON.parse(localStorage.getItem('__ccu-vscode-state')),
      messages: window.__ccuPostedMessages.length,
    }));
    expect(before.state.openDetails.length).toBeGreaterThan(0);
    await page.locator('#tab-achievements').click();
    await page.clock.runFor(200);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__ccu-vscode-state')).openDetails))
      .toEqual(before.state.openDetails);
    expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(before.messages);
    // Focus/scroll may independently save UI state; only host work and the
    // exact disclosure set must stay unchanged on current-tab reselection.
    await page.reload();
    await expect(card.locator('details')).toHaveAttribute('open');
    await page.locator('#tab-settings').click();
    const inventoryRequests = await page.evaluate(() => window.__ccuPostedMessages.filter(message =>
      message.command === 'requestLocalDataInventory').length);
    // The basic renderer fixture omits the host-backed inventory section.
    expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message =>
      message.command === 'tabChanged' && message.tab === 'settings').length)).toBe(1);
    const settingsMessages = await page.evaluate(() => window.__ccuPostedMessages.length);
    await page.locator('#tab-settings').click();
    expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message =>
      message.command === 'requestLocalDataInventory').length)).toBe(inventoryRequests);
    expect(await page.evaluate(() => window.__ccuPostedMessages.length)).toBe(settingsMessages);
    await page.locator('#tab-achievements').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__ccu-vscode-state')).openDetails)).toEqual([]);
  });
}

for (const [locale, names] of Object.entries(modelExperienceNames)) {
  test(`${locale} model experience cards distinguish breadth, repeated tasks and same-session Fable`, async ({ page }, testInfo) => {
    for (const theme of ['dark', 'light']) {
      await openClaude(page, { locale, width: 320, theme, fixture: 'achievement-token-stages' });
      await page.locator('#tab-achievements').click();
      const keys = ['same-root-models', 'model-relay-roots', 'fable-relay'];
      for (const [index, key] of keys.entries()) {
        const card = page.locator(`.achievement-card[data-achievement-key="${key}"]`);
        await expect(card.locator('h4')).toHaveText(names[index]);
        await card.locator('summary').focus();
        // The second theme visit deliberately retains the first visit's state.
        if (!(await card.locator('details').evaluate(element => element.open))) {
          await card.locator('summary').press('Enter');
        }
        await expect(card.locator('details')).toHaveAttribute('open');
        await expect(card.locator('[data-achievement-level]')).toHaveCount(index === 2 ? 1 : 3);
      }
      // Flush native toggle tasks before reload; the harness freezes its clock.
      await page.clock.runFor(200);
      await expect.poll(() => page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}');
        return ['same-root-models', 'model-relay-roots', 'fable-relay'].every(key =>
          state.openDetails?.includes(`achievement:${key}`));
      })).toBe(true);
      await page.reload();
      for (const key of keys) await expect(page.locator(`.achievement-card[data-achievement-key="${key}"] details`)).toHaveAttribute('open');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => window.__ccuPostedMessages.some(message =>
        ['refresh', 'updateSetting', 'previewAchievementShare', 'exportAchievementShare'].includes(message.command)))).toBe(false);
      await page.locator('.achievement-card[data-achievement-key="same-root-models"]').screenshot({
        path: testInfo.outputPath(`model-breadth-320-${theme}.png`),
      });
    }
  });
}

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} overview badge opens the canonical rule without refreshing or selecting a share`, async ({ page }, testInfo) => {
    for (const [width, theme] of [[320, 'dark'], [360, 'light']]) {
      await openClaude(page, { locale, width, theme, fixture: 'achievement-token-stages' });
      await page.locator('#tab-achievements').click();
      for (const kind of ['badges', 'next']) {
        const buttons = page.locator(`[data-achievement-overview="${kind}"] .achievement-overview-badge`);
        expect(await buttons.count()).toBeGreaterThan(0);
        expect(await buttons.count()).toBeLessThanOrEqual(3);
      }
      const button = page.locator('[data-achievement-overview="next"] .achievement-overview-badge').first();
      const key = await button.getAttribute('data-achievement-open');
      await page.locator('#achievementFilter').selectOption('earned');
      await button.focus();
      await button.press('Enter');
      const detail = page.locator(`.achievement-card[data-achievement-key="${key}"] details`);
      await expect(page.locator('#achievementFilter')).toHaveValue('all');
      await expect(detail).toHaveAttribute('open');
      await expect(detail.locator('summary')).toBeFocused();
      await page.reload();
      await expect(detail).toHaveAttribute('open');
      await expect(page.locator('#achievementFilter')).toHaveValue('all');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => window.__ccuPostedMessages.some(message =>
        ['refresh', 'updateSetting', 'previewAchievementShare', 'exportAchievementShare'].includes(message.command)))).toBe(false);
      await page.locator('#tab-achievements').click();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`overview-${width}-${theme}.png`) });
    }
  });
}

test('integer-only progress and folded evidence stay keyboard-accessible without host refreshes', async ({ page }) => {
  await openCodex(page, { width: 360 });
  await page.locator('#tab-achievements').click();
  const disclosure = page.locator('.achievement-evidence-note');
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(disclosure.locator('p').first()).toBeHidden();
  await expect(disclosure.locator('.achievement-date-note')).toBeHidden();
  await disclosure.locator('summary').focus();
  await disclosure.locator('summary').press('Enter');
  await expect(disclosure.locator('p').first()).toContainText('first event week');
  await expect(disclosure.locator('.achievement-date-note')).toBeVisible();
  await page.reload();
  await expect(disclosure).toHaveAttribute('open');
  await disclosure.locator('summary').focus();
  await disclosure.locator('summary').press('Enter');
  await page.reload();
  await expect(disclosure).not.toHaveAttribute('open');
  for (const summary of await page.locator('.achievement-disclosure > summary').all()) await summary.click();
  const progress = await page.locator('.achievement-progress-label').allTextContents();
  const verified = page.locator('.achievement-card[data-achievement-proof="ready"]');
  const pending = page.locator('.achievement-card[data-achievement-proof="pending"]');
  expect(progress.length).toBe(await verified.count());
  expect(await pending.count()).toBeGreaterThan(0);
  await expect(pending.locator('progress,.achievement-progress-label')).toHaveCount(0);
  for (const summary of await pending.locator('summary').all()) {
    await expect(summary).toHaveAttribute('aria-label', /Evidence pending/);
  }
  for (const text of progress) expect(text).not.toMatch(/\d+[.,]\d+[kMBT]/);
  await expect(page.locator('.achievement-state')).toHaveCount(0);
  const messages = await page.evaluate(() => window.__ccuPostedMessages);
  expect(messages.some(message => ['refresh', 'updateSetting'].includes(message.command))).toBe(false);
});

test('gallery filters are local, survive reload, and do not read or refresh logs', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-achievements').click();
  await page.locator('#achievementFilter').selectOption('next');
  const expected = await page.locator('.achievement-card[data-achievement-next="true"]').count();
  await expect(page.locator('.achievement-card:visible')).toHaveCount(expected);
  await page.reload();
  await expect(page.locator('#achievementFilter')).toHaveValue('next');
  await expect(page.locator('.achievement-card:visible')).toHaveCount(expected);
  await page.locator('#achievementFilter').selectOption('earned');
  const earned = await page.locator('.achievement-card[data-achievement-earned="true"]').count();
  await expect(page.locator('.achievement-card:visible')).toHaveCount(earned);
  const messages = await page.evaluate(() => window.__ccuPostedMessages);
  expect(messages.some(message => ['refresh', 'updateSetting'].includes(message.command))).toBe(false);
  await expect(page.locator('.achievement-count')).toContainText('series');
  await expect(page.locator('.achievement-count')).toContainText('levels');
});

test('a gallery settings shortcut focuses the existing opt-out without changing it', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-achievements').click();
  await page.getByRole('button', { name: 'Achievement settings', exact: true }).click();
  await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#set_enableAchievements')).toBeFocused();
  await expect(page.locator('#set_enableAchievements')).toBeChecked();
  await page.reload();
  await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#set_enableAchievements').locator('..')).toBeVisible();
  await page.locator('#set_enableAchievements').focus();
  await page.locator('#set_enableAchievements').press('Space');
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.some(message =>
    message.command === 'updateSetting' && message.key === 'enableAchievements' && message.value === false))).toBe(true);
});

test('a tier update keeps its series disclosure, filter, card order and keyboard focus', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-achievements').click();
  await page.locator('#achievementFilter').selectOption('all');
  const card = page.locator('[data-achievement-series="astra-regular"]');
  await card.locator('summary').click();
  await card.locator('summary').focus();
  const order = await page.locator('.achievement-card').evaluateAll(cards => cards.map(card => card.dataset.achievementKey));
  const source = await (await page.context().request.get(page.url())).text();
  await page.evaluate(source => {
    const nextPanel = new DOMParser().parseFromString(source, 'text/html').getElementById('provider-panel');
    // The host rendering contract separately verifies real tier upgrades. This
    // patch exercises client restoration while the displayed level ID changes.
    const upgraded = nextPanel.querySelector('[data-achievement-series="astra-regular"]');
    upgraded.dataset.achievementId = 'astra-regular-silver';
    upgraded.querySelector('h4').textContent = 'Astra regular · Silver';
    window.dispatchEvent(new MessageEvent('message', { data: {
      command: 'dashboardDataPatch', provider: 'codex', tab: 'achievements', revision: 1,
      html: nextPanel.innerHTML, claudeLast30HoursByDay: {},
    } }));
  }, source);
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.some(message =>
    message.command === 'dashboardDataPatchAck' && message.revision === 1 && message.ok))).toBe(true);
  await expect(card.locator('details')).toHaveAttribute('open');
  await expect(card.locator('summary')).toBeFocused();
  await expect(page.locator('#achievementFilter')).toHaveValue('all');
  expect(await page.locator('.achievement-card').evaluateAll(cards => cards.map(card => card.dataset.achievementKey))).toEqual(order);
  await page.reload();
  await expect(card.locator('details')).toHaveAttribute('open');
  await expect(page.locator('#achievementFilter')).toHaveValue('all');
});

test('closing a disclosure restored from an old level key remains closed after reload', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-achievements').click();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('__ccu-vscode-state')) || {};
    state.openDetails = ['achievement:sol-regular-silver'];
    localStorage.setItem('__ccu-vscode-state', JSON.stringify(state));
  });
  await page.reload();
  const card = page.locator('[data-achievement-series="sol-regular"]');
  await expect(card.locator('details')).toHaveAttribute('open');
  await card.locator('summary').click();
  await expect(card.locator('details')).not.toHaveAttribute('open');
  await page.reload();
  await expect(card.locator('details')).not.toHaveAttribute('open');
});

test('five-level rules and distinct silver/platinum treatments fit 320px and 360px', async ({ page }) => {
  for (const width of [320, 360]) {
    await openCodex(page, { width });
    await page.locator('#tab-achievements').click();
    const card = page.locator('[data-achievement-series="cumulative-volume"]');
    if (!await card.locator('details').evaluate(details => details.open)) await card.locator('summary').click();
    const fits = await card.evaluate(card => [...card.querySelectorAll('summary,.achievement-tier-markers,.achievement-level-rules')]
      .every(element => element.scrollWidth <= element.clientWidth + 1));
    expect(fits).toBe(true);
  }
  const colors = await page.evaluate(() => {
    const card = document.querySelector('.achievement-card');
    card.dataset.achievementTier = 'silver';
    const silver = getComputedStyle(card).getPropertyValue('--achievement-tier-color');
    card.dataset.achievementTier = 'platinum';
    return { silver, platinum: getComputedStyle(card).getPropertyValue('--achievement-tier-color') };
  });
  expect(colors.silver.trim()).not.toBe(colors.platinum.trim());
});

for (const [provider, open] of [['claude', openClaude], ['codex', openCodex]]) {
  test(`sharing returns to the ${provider} gallery with keyboard focus`, async ({ page }) => {
    await open(page, { fixture: 'combined-heatmap' });
    await page.locator('#tab-achievements').click();
    await page.locator('#achievements button[onclick="openAchievementShare()"] ').click();
    await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
    await page.locator('#achievementShareBack').click();
    await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'providerChanged').at(-1)))
      .toEqual({ command: 'providerChanged', provider, tab: 'achievements' });
    await open(page, { fixture: 'combined-heatmap' });
    await expect(page.locator('#tab-achievements')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#achievementFilter')).toBeFocused();
  });
}

test('an upgrade never silently selects a new badge and explains selection changes', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  await page.evaluate(() => localStorage.setItem('ccu.sharing.achievementBadges', JSON.stringify(['no-longer-offered-tier'])));
  await page.reload();
  await expect(page.locator('.achievement-share-choice:checked')).toHaveCount(0);
  await expect(page.locator('#achievementShareStatus')).toContainText('changed');
  await expect(page.locator('#achievementShareExportBtn')).toBeDisabled();
});

test('export suppresses repeated clicks and reports success, cancel and a retryable error', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  await page.locator('.achievement-share-choice').first().check();
  const request = await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'previewAchievementShare').at(-1));
  await page.evaluate(request => window.dispatchEvent(new MessageEvent('message', { data: {
    ...request, command: 'achievementShareResult', previewId: 'export-preview', svg: '<svg width="100" height="60"/>',
  } })), request);
  const button = page.locator('#achievementShareExportBtn');
  await button.click();
  await page.evaluate(() => exportAchievementShare());
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'exportAchievementShare').length)).toBe(1);
  await expect(button).toBeDisabled();
  for (const [reply, text] of [[{ ok: true }, 'saved'], [{ ok: false, cancelled: true }, 'cancelled'], [{ ok: false, stale: false }, 'Could not save']]) {
    await page.evaluate(reply => window.dispatchEvent(new MessageEvent('message', { data: {
      command: 'achievementShareExportResult', previewId: 'export-preview', ...reply,
    } })), reply);
    await expect(page.locator('#achievementShareStatus')).toContainText(text);
    await expect(button).toBeEnabled();
    if (!reply.stale && !('stale' in reply)) await button.click();
  }
});

test('share selection explains its empty state and waits for the matching preview, ignoring stale replies', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  await expect(page.locator('#achievementSharePreview')).toContainText('Select');
  await expect(page.locator('.achievement-share-choice-icon').first()).toBeVisible();
  await page.locator('.achievement-share-choice').first().check();
  const request = await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'previewAchievementShare').at(-1));
  expect(request.requestId).toBeGreaterThan(0);
  await expect(page.locator('#achievementShareExportBtn')).toBeDisabled();
  await expect(page.locator('#achievementShareStatus')).toContainText('Preparing');
  await page.evaluate(request => window.dispatchEvent(new MessageEvent('message', { data: {
    command: 'achievementShareResult', requestId: request.requestId - 1, clientId: request.clientId, ids: request.ids,
    previewId: 'stale', svg: '<svg data-old="true"/>',
  } })), request);
  await expect(page.locator('#achievementShareExportBtn')).toBeDisabled();
  await page.evaluate(request => window.dispatchEvent(new MessageEvent('message', { data: {
    command: 'achievementShareResult', requestId: request.requestId, clientId: request.clientId, ids: request.ids,
    previewId: 'accepted-preview', svg: '<svg width="120" height="80"><rect width="120" height="80"/></svg>',
  } })), request);
  await expect(page.locator('#achievementShareExportBtn')).toBeEnabled();
  await page.locator('#achievementShareExportBtn').click();
  const exported = await page.evaluate(() => window.__ccuPostedMessages.find(message => message.command === 'exportAchievementShare'));
  expect(exported.previewId).toBe('accepted-preview');
  expect(exported.ids).toEqual(request.ids);
  await page.locator('.achievement-share-choice').first().uncheck();
  await expect(page.locator('#achievementShareExportBtn')).toBeDisabled();
  await page.locator('#achievementShareBack').click();
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'providerChanged').at(-1)))
    .toEqual({ command: 'providerChanged', provider: 'codex', tab: 'achievements' });
  // The harness records provider requests; the extension host is tested separately.
  await openCodex(page, { fixture: 'combined-heatmap' });
  await expect(page.locator('#tab-achievements')).toHaveAttribute('aria-selected', 'true');
});

test('a matching preview reconciles only unavailable selected badges and survives reload', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  await page.locator('.achievement-share-choice').nth(0).check();
  const request = await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'previewAchievementShare').at(-1));
  const acceptedIds = [];
  await page.evaluate(({ request, acceptedIds }) => window.dispatchEvent(new MessageEvent('message', { data: {
    command: 'achievementShareResult', requestId: request.requestId, clientId: request.clientId, ids: acceptedIds,
    svg: '',
  } })), { request, acceptedIds });
  await expect(page.locator('#achievementShareExportBtn')).toBeDisabled();
  await expect(page.locator('#achievementSharePreview')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.achievement-share-choice').nth(0)).not.toBeChecked();
  await expect(page.locator('#achievementShareCount')).toHaveText('0/9');
  await page.reload();
  const restored = await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'restoreAchievementShare').at(-1));
  expect(restored.ids).toEqual(acceptedIds);
});

test('a matching malformed preview fails visibly instead of remaining busy or accepting extra badges', async ({ page }) => {
  await openCompare(page, { fixture: 'combined-heatmap', commandTemplate: 'achievements' });
  await page.locator('.achievement-share-choice').nth(0).check();
  const request = await page.evaluate(() => window.__ccuPostedMessages.filter(message => message.command === 'previewAchievementShare').at(-1));
  await page.evaluate(request => window.dispatchEvent(new MessageEvent('message', { data: {
    command: 'achievementShareResult', requestId: request.requestId, clientId: request.clientId, ids: ['not-selected'],
    previewId: 'untrusted-preview', svg: '<svg data-unexpected="true"/>',
  } })), request);
  await expect(page.locator('#achievementShareExportBtn')).toBeDisabled();
  await expect(page.locator('#achievementSharePreview')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#achievementShareStatus')).toContainText(/could not/i);
  await expect(page.locator('#achievementSharePreview svg')).toHaveCount(0);
  await expect(page.locator('.achievement-share-choice').nth(0)).toBeChecked();
});

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} current progress and display-only stages fit closed cards`, async ({ page }, testInfo) => {
    for (const [width, theme] of [[320, 'dark'], [360, 'light']]) {
      await openClaude(page, { locale, theme, width, fixture: 'achievement-token-stages' });
      await page.locator('#tab-achievements').click();
      const card = page.locator('[data-achievement-series="sonnet-main"]');
      // Moving between viewport/theme cases deliberately retains Webview state.
      // Close the previous case's restored disclosure before testing its face.
      if (await card.locator('details').evaluate(details => details.open)) await card.locator('summary').click();
      await expect(card.locator('details')).not.toHaveAttribute('open');
      await expect(card.locator('.achievement-current-progress')).toHaveText('295M / 1B');
      await expect(card.locator('.achievement-stage-target')).toContainText('500M');
      const fit = await card.locator('summary').evaluate(element => element.scrollWidth <= element.clientWidth + 1);
      expect(fit).toBe(true);
      await card.locator('summary').focus();
      await card.locator('summary').press('Enter');
      await expect(card.locator('[data-achievement-level]')).toHaveCount(5);
      await expect(card.locator('.achievement-level-rules')).not.toContainText('500M');
      await page.reload();
      await expect(card.locator('details')).toHaveAttribute('open');
      await expect(card.locator('.achievement-stage-target')).toContainText('500M');
      expect((await page.evaluate(() => window.__ccuPostedMessages)).some(message =>
        ['refresh', 'updateSetting', 'previewAchievementShare'].includes(message.command))).toBe(false);
      if (locale === 'zh-CN') await card.screenshot({ path: testInfo.outputPath(`stage-${width}-${theme}.png`) });
    }
  });
  test(`${locale} compact targets, full tier rules, and controls fit the narrow gallery`, async ({ page }, testInfo) => {
    await openCodex(page, { locale, theme: 'dark', width: 360 });
    await page.locator('#tab-achievements').click();
    await expect(page.locator('.achievement-next-target').first()).toBeVisible();
    await page.locator('[data-achievement-series="astra-regular"] summary').click();
    await expect(page.locator('[data-achievement-series="astra-regular"] [data-achievement-level]')).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow).toBe(false);
    await page.locator('#achievementFilter').selectOption('next');
    await page.reload();
    await expect(page.locator('#achievementFilter')).toHaveValue('next');
    if (locale === 'zh-CN') await page.locator('#achievements').screenshot({ path: testInfo.outputPath('experience-narrow-dark.png') });
  });
}
