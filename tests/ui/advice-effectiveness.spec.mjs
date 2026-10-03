import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';

import { test, expect, openClaude, openCodex } from './support/app.mjs';

const require = createRequire(import.meta.url);
const {
  PROMPT_SENTINEL,
  USER_CONTEXT_SENTINEL,
  buildAdviceEffectivenessFixture,
} = require('./support/advice-effectiveness-fixture.cjs');

const locales = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];

async function openCandidate(page, provider, options = {}) {
  const open = provider === 'claude' ? openClaude : openCodex;
  await open(page, { ...options, fixture: 'advice-effectiveness' });
  await page.locator('#tab-content').click();
  const root = page.locator(
    `.advice-effectiveness-body[data-advice-provider="${provider}"]`,
  );
  await expect(root).toBeVisible();
  return root;
}

async function dispatchHostMessage(page, message) {
  await page.evaluate((data) => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }, message);
}

async function dispatchDashboardDataPatch(
  page,
  provider,
  { revision = 1, adviceSnapshotIds = {} } = {},
) {
  const url = new URL(page.url());
  url.searchParams.set('provider', provider);
  url.searchParams.set('fixture', 'advice-effectiveness');
  const response = await page.context().request.get(url.toString());
  const documentText = await response.text();
  await page.evaluate(({ nextProvider, nextRevision, nextAdviceSnapshotIds, documentText }) => {
    const activeTab = document.querySelector('.tabs [role="tab"].active')
      ?.id.replace('tab-', '');
    if (!activeTab) throw new Error('Current dashboard did not expose an active tab');
    const nextDocument = new DOMParser().parseFromString(documentText, 'text/html');
    const nextPanel = nextDocument.getElementById('provider-panel');
    if (!nextPanel) throw new Error('Fixture did not render a provider panel');
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'dashboardDataPatch',
        provider: nextProvider,
        tab: activeTab,
        revision: nextRevision,
        html: nextPanel.innerHTML,
        claudeLast30HoursByDay: {},
        adviceSnapshotIds: nextAdviceSnapshotIds,
      },
    }));
  }, {
    nextProvider: provider,
    nextRevision: revision,
    nextAdviceSnapshotIds: adviceSnapshotIds,
    documentText,
  });
}

async function postedMessages(page, command) {
  return page.evaluate((expectedCommand) =>
    window.__ccuPostedMessages.filter((message) => message.command === expectedCommand),
  command);
}

async function expectPostedCount(page, command, count) {
  await expect.poll(async () => (await postedMessages(page, command)).length).toBe(count);
}

async function grantAggregateConsent(page) {
  const aggregate = page.locator(
    '[data-advice-provider="claude"] [data-advice-consent-kind="aggregate"]',
  );
  await aggregate.focus();
  await aggregate.press('Space');
  await expectPostedCount(page, 'updateAdviceConsent', 1);
  await dispatchHostMessage(page, {
    command: 'adviceConsentResult',
    ok: true,
    provider: 'claude',
    aggregateConsent: 'explicit',
    promptSampleConsent: 'not-granted',
  });
  await expect(aggregate).toBeChecked();
}

async function gateNextAdvicePreviewValidation(page) {
  await page.evaluate(() => {
    const original = globalThis.ccuVerifyCanonicalPreview;
    if (typeof original !== 'function') {
      throw new Error('Canonical preview verifier is unavailable');
    }
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    globalThis.__ccuAdvicePreviewValidationStarted = false;
    globalThis.__ccuReleaseAdvicePreviewValidation = release;
    globalThis.ccuVerifyCanonicalPreview = async (...args) => {
      globalThis.__ccuAdvicePreviewValidationStarted = true;
      await gate;
      return original(...args);
    };
  });
}

async function releaseAdvicePreviewValidation(page) {
  await page.evaluate(() => globalThis.__ccuReleaseAdvicePreviewValidation());
}

async function seriousOrCriticalViolations(page, include) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const results = await builder.analyze();
  const violations = [];
  for (const violation of results.violations
    .filter((item) => item.impact === 'serious' || item.impact === 'critical')) {
    const targets = [];
    for (const node of violation.nodes) {
      const contrast = node.any.map((check) => check.data).find((data) => data?.contrastRatio);
      const themedAccent = violation.id === 'color-contrast' && contrast
        ? await page.evaluate((target) => {
          const element = document.querySelector(target.join(' '));
          if (!element) return null;
          const style = getComputedStyle(element);
          const probe = document.createElement('span');
          document.body.appendChild(probe);
          const resolve = (value) => {
            probe.style.color = value;
            return getComputedStyle(probe).color;
          };
          const root = getComputedStyle(document.documentElement);
          const accentTokens = [
            '--vscode-charts-blue', '--vscode-charts-green', '--vscode-charts-orange',
            '--vscode-charts-purple', '--vscode-charts-red', '--vscode-charts-yellow',
            '--vscode-focusBorder',
          ];
          const isAccent = accentTokens.some((token) =>
            resolve(root.getPropertyValue(token).trim()) === style.color);
          probe.remove();
          const weight = Number.parseInt(style.fontWeight, 10) || 400;
          const hasUnderline = style.textDecorationLine !== 'none'
            || (Number.parseFloat(style.borderBottomWidth) >= 2 && style.borderBottomStyle !== 'none');
          const before = getComputedStyle(element, '::before').content;
          const after = getComputedStyle(element, '::after').content;
          const hasIcon = (before && before !== 'none' && before !== 'normal')
            || (after && after !== 'none' && after !== 'normal')
            || Boolean(element.querySelector('svg, .codicon, [aria-hidden="true"]'));
          return { isAccent, hasNonColorCue: weight >= 600 || hasUnderline || hasIcon };
        }, node.target)
        : null;
      if (!themedAccent?.isAccent
        || Number(contrast.contrastRatio) < 3
        || !themedAccent.hasNonColorCue) {
        targets.push(node.target);
      }
    }
    if (targets.length) violations.push({
      id: violation.id,
      impact: violation.impact,
      targets,
    });
  }
  return violations;
}

test('candidate surface is absent from the default-off fixture', async ({ page }) => {
  await openClaude(page, { fixture: 'advice-effectiveness-disabled' });
  await page.locator('#tab-content').click();
  await expect(page.locator('.advice-effectiveness-body')).toHaveCount(0);

  await openCodex(page, { fixture: 'advice-effectiveness-disabled' });
  await page.locator('#tab-content').click();
  await expect(page.locator('.advice-effectiveness-body')).toHaveCount(0);
});

test('candidate extends the existing provider card instead of creating a third card', async ({ page }) => {
  const claudeRoot = await openCandidate(page, 'claude');
  const claudeCards = page.locator('#content > .action-card');
  await expect(claudeCards).toHaveCount(2);
  await expect(claudeCards.first().locator('[data-advice-provider="claude"]')).toHaveCount(1);
  await expect(claudeCards.nth(1).locator('.advice-effectiveness-body')).toHaveCount(0);
  expect(await claudeRoot.evaluate((element) =>
    element.parentElement?.classList.contains('action-card'))).toBe(true);

  const codexRoot = await openCandidate(page, 'codex');
  const codexCards = page.locator('#content > .action-card');
  await expect(codexCards).toHaveCount(1);
  await expect(codexCards.first().locator('[data-advice-provider="codex"]')).toHaveCount(1);
  expect(await codexRoot.evaluate((element) =>
    element.parentElement?.classList.contains('action-card'))).toBe(true);
});

test('aggregate and prompt consent remain separate and prompt starts closed', async ({ page }) => {
  const root = await openCandidate(page, 'claude');
  const aggregate = root.locator('[data-advice-consent-kind="aggregate"]');
  const prompt = root.locator('[data-advice-consent-kind="prompt"]');
  const preview = root.locator('[data-advice-action="preview"]');

  await expect(aggregate).not.toBeChecked();
  await expect(aggregate).toBeEnabled();
  await expect(prompt).not.toBeChecked();
  await expect(prompt).toBeDisabled();
  await expect(preview).toBeDisabled();
  expect(await page.content()).not.toContain(PROMPT_SENTINEL);

  await aggregate.focus();
  await aggregate.press('Space');
  await expectPostedCount(page, 'updateAdviceConsent', 1);
  expect((await postedMessages(page, 'updateAdviceConsent')).at(-1)).toEqual({
    command: 'updateAdviceConsent',
    provider: 'claude',
    aggregateConsent: 'explicit',
    promptSampleConsent: 'not-granted',
  });
  await dispatchHostMessage(page, {
    command: 'adviceConsentResult',
    ok: true,
    provider: 'claude',
    aggregateConsent: 'explicit',
    promptSampleConsent: 'not-granted',
  });

  await expect(aggregate).toBeChecked();
  await expect(prompt).toBeEnabled();
  await expect(prompt).not.toBeChecked();
  await expect(preview).toBeEnabled();

  await prompt.focus();
  await prompt.press('Space');
  await expectPostedCount(page, 'updateAdviceConsent', 2);
  expect((await postedMessages(page, 'updateAdviceConsent')).at(-1)).toEqual({
    command: 'updateAdviceConsent',
    provider: 'claude',
    aggregateConsent: 'explicit',
    promptSampleConsent: 'explicit',
  });
  expect(await page.content()).not.toContain(PROMPT_SENTINEL);
  await dispatchHostMessage(page, {
    command: 'adviceConsentResult',
    ok: true,
    provider: 'claude',
    aggregateConsent: 'explicit',
    promptSampleConsent: 'explicit',
  });
  await expect(prompt).toBeChecked();

  await aggregate.focus();
  await aggregate.press('Space');
  await expectPostedCount(page, 'updateAdviceConsent', 3);
  expect((await postedMessages(page, 'updateAdviceConsent')).at(-1)).toEqual({
    command: 'updateAdviceConsent',
    provider: 'claude',
    aggregateConsent: 'not-granted',
    promptSampleConsent: 'not-granted',
  });
});

test('sealed preview renders the exact canonical body, UTF-8 size, and SHA-256', async ({ page }) => {
  const fixture = buildAdviceEffectivenessFixture({ locale: 'en' });
  const networkAfterLoad = [];
  await openCandidate(page, 'claude');
  page.on('request', (request) => networkAfterLoad.push(request.url()));
  await grantAggregateConsent(page);

  const previewButton = page.locator(
    '[data-advice-provider="claude"] [data-advice-action="preview"]',
  );
  await previewButton.focus();
  await previewButton.press('Enter');
  await expectPostedCount(page, 'prepareAdviceSnapshot', 1);
  expect((await postedMessages(page, 'prepareAdviceSnapshot')).at(-1)).toEqual({
    command: 'prepareAdviceSnapshot',
    provider: 'claude',
    aggregateConsent: 'explicit',
    promptSampleConsent: 'not-granted',
  });
  await dispatchHostMessage(page, {
    ...fixture.snapshotMessages.aggregateOnly,
    body: `${fixture.snapshotMessages.aggregateOnly.body} `,
  });
  await expect(
    page.locator('[data-advice-provider="claude"] [data-advice-consent-status]'),
  ).not.toHaveText('');
  await expect(
    page.locator('[data-advice-provider="claude"] [data-advice-action="send"]'),
  ).toBeDisabled();
  await dispatchHostMessage(page, fixture.snapshotMessages.aggregateOnly);

  const preview = page.locator('[data-advice-preview="claude"]');
  const body = preview.locator('[data-advice-preview-body]');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute(
    'data-snapshot-id',
    fixture.snapshotMessages.aggregateOnly.snapshotId,
  );
  await expect(body).toHaveText(fixture.snapshotMessages.aggregateOnly.body);
  await expect(preview.locator('[data-advice-preview-bytes]')).toContainText(
    String(fixture.snapshotMessages.aggregateOnly.utf8Bytes),
  );
  await expect(preview.locator('[data-advice-preview-count]')).toContainText('0');
  await expect(preview.locator('[data-advice-preview-digest]')).toHaveText(
    `SHA-256 ${fixture.snapshotMessages.aggregateOnly.sha256}`,
  );
  await expect(preview.locator('[data-advice-preview-destination]')).toContainText(
    fixture.snapshotMessages.aggregateOnly.endpoint,
  );
  await expect(preview.locator('[data-advice-preview-destination]')).toContainText('openai');
  await expect(preview.locator('[data-advice-preview-destination]')).toContainText('safe-model');
  expect(Buffer.byteLength(fixture.snapshotMessages.aggregateOnly.body, 'utf8')).toBe(
    fixture.snapshotMessages.aggregateOnly.utf8Bytes,
  );
  expect(createHash('sha256')
    .update(fixture.snapshotMessages.aggregateOnly.body, 'utf8')
    .digest('hex')).toBe(fixture.snapshotMessages.aggregateOnly.sha256);
  expect(fixture.snapshotMessages.aggregateOnly.body).not.toContain('promptSamples');
  expect(fixture.snapshotMessages.aggregateOnly.body).not.toContain(USER_CONTEXT_SENTINEL);
  expect(await page.content()).not.toContain(PROMPT_SENTINEL);

  const prompt = page.locator(
    '[data-advice-provider="claude"] [data-advice-consent-kind="prompt"]',
  );
  await prompt.focus();
  await prompt.press('Space');
  await expectPostedCount(page, 'updateAdviceConsent', 2);
  await dispatchHostMessage(page, {
    command: 'adviceConsentResult',
    ok: true,
    provider: 'claude',
    aggregateConsent: 'explicit',
    promptSampleConsent: 'explicit',
  });
  expect(await page.content()).not.toContain(PROMPT_SENTINEL);

  await previewButton.focus();
  await previewButton.press('Enter');
  await expectPostedCount(page, 'prepareAdviceSnapshot', 2);
  expect((await postedMessages(page, 'prepareAdviceSnapshot')).at(-1)).toEqual({
    command: 'prepareAdviceSnapshot',
    provider: 'claude',
    aggregateConsent: 'explicit',
    promptSampleConsent: 'explicit',
  });
  await dispatchHostMessage(page, fixture.snapshotMessages.withPromptSamples);
  await expect(body).toHaveText(fixture.snapshotMessages.withPromptSamples.body);
  await expect(body).toContainText(PROMPT_SENTINEL);
  await expect(body).toContainText(USER_CONTEXT_SENTINEL);
  await expect(preview.locator('[data-advice-preview-bytes]')).toContainText(
    String(fixture.snapshotMessages.withPromptSamples.utf8Bytes),
  );
  await expect(preview.locator('[data-advice-preview-count]')).toContainText('1');
  await expect(preview.locator('[data-advice-preview-digest]')).toHaveText(
    `SHA-256 ${fixture.snapshotMessages.withPromptSamples.sha256}`,
  );
  expect(Buffer.byteLength(fixture.snapshotMessages.withPromptSamples.body, 'utf8')).toBe(
    fixture.snapshotMessages.withPromptSamples.utf8Bytes,
  );
  expect(createHash('sha256')
    .update(fixture.snapshotMessages.withPromptSamples.body, 'utf8')
    .digest('hex')).toBe(fixture.snapshotMessages.withPromptSamples.sha256);
  const send = page.locator(
    '[data-advice-provider="claude"] [data-advice-action="send"]',
  );
  await expect(send).toBeEnabled();
  await send.click();
  await expectPostedCount(page, 'sendAdviceSnapshot', 1);
  expect((await postedMessages(page, 'sendAdviceSnapshot')).at(-1)).toEqual({
    command: 'sendAdviceSnapshot',
    provider: 'claude',
    snapshotId: fixture.snapshotMessages.withPromptSamples.snapshotId,
  });
  expect(networkAfterLoad).toEqual([]);
});

test('preview rejects missing, credential-bearing or inconsistent destination metadata without sending', async ({ page }) => {
  const fixture = buildAdviceEffectivenessFixture({ locale: 'en' });
  await openCandidate(page, 'claude');
  await grantAggregateConsent(page);
  const valid = fixture.snapshotMessages.aggregateOnly;
  for (const override of [
    { endpoint: undefined },
    { endpoint: 'https://secret@example.invalid/v1/chat/completions' },
    { endpoint: 'https://example.invalid/v1/chat/completions?key=secret' },
    { apiFormat: 'unknown' },
    { model: 'unpreviewed-model' },
  ]) {
    await dispatchHostMessage(page, { ...valid, ...override });
    await expect(page.locator('[data-advice-provider="claude"] [data-advice-action="send"]')).toBeDisabled();
  }
  await expectPostedCount(page, 'sendAdviceSnapshot', 0);
  expect(await page.content()).not.toContain('secret@');
});

test('withdrawing consent cancels a preview whose digest validation is pending', async ({ page }) => {
  const fixture = buildAdviceEffectivenessFixture({ locale: 'en' });
  await openCandidate(page, 'claude');
  await grantAggregateConsent(page);
  await gateNextAdvicePreviewValidation(page);

  const root = page.locator('[data-advice-provider="claude"]');
  await root.locator('[data-advice-action="preview"]').click();
  await dispatchHostMessage(page, fixture.snapshotMessages.aggregateOnly);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ccuAdvicePreviewValidationStarted)).toBe(true);

  const aggregate = root.locator('[data-advice-consent-kind="aggregate"]');
  await aggregate.focus();
  await aggregate.press('Space');
  await expectPostedCount(page, 'discardAdviceSnapshot', 2);
  await releaseAdvicePreviewValidation(page);

  const preview = root.locator('[data-advice-preview]');
  await expect(aggregate).not.toBeChecked();
  await expect(preview).toBeHidden();
  await expect(preview.locator('[data-advice-preview-body]')).toHaveText('');
  await expect(root.locator('[data-advice-action="send"]')).toBeDisabled();
});

test('clearing local advice data cancels a preview whose digest validation is pending', async ({ page }) => {
  const fixture = buildAdviceEffectivenessFixture({ locale: 'en' });
  await openCandidate(page, 'claude');
  await grantAggregateConsent(page);
  await gateNextAdvicePreviewValidation(page);

  const root = page.locator('[data-advice-provider="claude"]');
  await root.locator('[data-advice-action="preview"]').click();
  await dispatchHostMessage(page, fixture.snapshotMessages.aggregateOnly);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ccuAdvicePreviewValidationStarted)).toBe(true);

  page.once('dialog', (dialog) => dialog.accept());
  await root.locator('[data-advice-action="clear"]').click();
  await expectPostedCount(page, 'clearAdviceLocalData', 1);
  await releaseAdvicePreviewValidation(page);

  const preview = root.locator('[data-advice-preview]');
  await expect(preview).toBeHidden();
  await expect(preview.locator('[data-advice-preview-body]')).toHaveText('');
  await expect(root.locator('[data-advice-action="send"]')).toBeDisabled();
});

test('host-triggered advice clear cancels a pending browser digest validation', async ({ page }) => {
  const fixture = buildAdviceEffectivenessFixture({ locale: 'en' });
  await openCandidate(page, 'claude');
  await grantAggregateConsent(page);
  await gateNextAdvicePreviewValidation(page);

  const root = page.locator('[data-advice-provider="claude"]');
  await root.locator('[data-advice-action="preview"]').click();
  await dispatchHostMessage(page, fixture.snapshotMessages.aggregateOnly);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ccuAdvicePreviewValidationStarted)).toBe(true);

  await dispatchHostMessage(page, { command: 'advicePreviewsInvalidated' });
  await releaseAdvicePreviewValidation(page);

  const preview = root.locator('[data-advice-preview]');
  await expect(preview).toBeHidden();
  await expect(preview.locator('[data-advice-preview-body]')).toHaveText('');
  await expect(root.locator('[data-advice-action="send"]')).toBeDisabled();
});

test('a live dashboard patch preserves vertical position inside the advice payload preview', async ({ page }) => {
  const fixture = buildAdviceEffectivenessFixture({ locale: 'en' });
  const bodyText = JSON.stringify(
    JSON.parse(fixture.snapshotMessages.aggregateOnly.body),
    null,
    2,
  );
  const snapshotMessage = {
    ...fixture.snapshotMessages.aggregateOnly,
    body: bodyText,
    utf8Bytes: Buffer.byteLength(bodyText, 'utf8'),
    sha256: createHash('sha256').update(bodyText, 'utf8').digest('hex'),
  };
  await openCandidate(page, 'claude');
  await page.addStyleTag({
    content: '.advice-payload-preview pre { max-height: 48px !important; }',
  });
  await grantAggregateConsent(page);
  await page.locator(
    '[data-advice-provider="claude"] [data-advice-action="preview"]',
  ).click();
  await expectPostedCount(page, 'prepareAdviceSnapshot', 1);
  await dispatchHostMessage(page, snapshotMessage);

  const body = page.locator('[data-advice-preview="claude"] [data-advice-preview-body]');
  await expect(body).toBeVisible();
  const destination = page.locator('[data-advice-preview="claude"] [data-advice-preview-destination]');
  await expect(destination).toContainText(snapshotMessage.endpoint);
  const destinationBefore = await destination.textContent();
  const before = await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      scrollTop: element.scrollTop,
      maxScrollTop: element.scrollHeight - element.clientHeight,
    };
  });
  expect(before.maxScrollTop).toBeGreaterThan(0);
  expect(before.scrollTop).toBeGreaterThan(0);
  const capturedPreview = await page.evaluate(() => {
    const panel = document.getElementById('provider-panel');
    return globalThis.ccuCaptureRefreshContext(panel).advicePreviews;
  });
  expect(capturedPreview).toHaveLength(1);
  expect(capturedPreview[0]).toMatchObject({
    provider: 'claude',
    snapshotId: snapshotMessage.snapshotId,
    hidden: false,
    open: true,
    body: bodyText,
  });

  await dispatchDashboardDataPatch(page, 'claude', {
    adviceSnapshotIds: { claude: snapshotMessage.snapshotId },
  });
  await expectPostedCount(page, 'dashboardDataPatchAck', 1);
  expect((await postedMessages(page, 'dashboardDataPatchAck')).at(-1)).toEqual({
    command: 'dashboardDataPatchAck',
    revision: 1,
    ok: true,
  });

  const refreshed = page.locator('[data-advice-preview="claude"] [data-advice-preview-body]');
  await expect(refreshed).toBeVisible();
  await expect(destination).toHaveText(destinationBefore);
  await expect(destination).toContainText(snapshotMessage.apiFormat);
  await expect(destination).toContainText(snapshotMessage.model);
  await expect(page.locator('[data-advice-provider="claude"] [data-advice-action="send"]')).toBeEnabled();
  await expect.poll(() => refreshed.evaluate((element) => element.scrollTop))
    .toBe(before.scrollTop);
});

test('a live dashboard patch discards a preview with missing destination metadata', async ({ page }) => {
  const fixture = buildAdviceEffectivenessFixture({ locale: 'en' });
  const root = await openCandidate(page, 'claude');
  await grantAggregateConsent(page);
  await dispatchHostMessage(page, fixture.snapshotMessages.aggregateOnly);
  await expect(root.locator('[data-advice-action="send"]')).toBeEnabled();
  await root.locator('[data-advice-preview]').evaluate((preview) => preview.removeAttribute('data-preview-endpoint'));
  await dispatchDashboardDataPatch(page, 'claude', {
    adviceSnapshotIds: { claude: fixture.snapshotMessages.aggregateOnly.snapshotId },
  });
  await expectPostedCount(page, 'dashboardDataPatchAck', 1);
  await expect(root.locator('[data-advice-action="send"]')).toBeDisabled();
  await expect(root.locator('[data-advice-preview]')).toBeHidden();
});

test('a live dashboard patch cannot restore a snapshot the host invalidated', async ({ page }) => {
  const fixture = buildAdviceEffectivenessFixture({ locale: 'en' });
  await openCandidate(page, 'claude');
  await grantAggregateConsent(page);
  await page.locator(
    '[data-advice-provider="claude"] [data-advice-action="preview"]',
  ).click();
  await dispatchHostMessage(page, fixture.snapshotMessages.aggregateOnly);

  const preview = page.locator('[data-advice-preview="claude"]');
  const body = preview.locator('[data-advice-preview-body]');
  const send = page.locator(
    '[data-advice-provider="claude"] [data-advice-action="send"]',
  );
  await expect(body).toHaveText(fixture.snapshotMessages.aggregateOnly.body);
  await expect(send).toBeEnabled();

  const discardedCapture = await page.evaluate(() => {
    const panel = document.getElementById('provider-panel');
    const previews = globalThis.ccuCaptureRefreshContext(panel).advicePreviews;
    globalThis.ccuRestoreAdvicePreviews(previews, {});
    return previews[0];
  });
  expect(discardedCapture).toMatchObject({
    body: '',
    digest: '',
    sendText: '',
    statusText: '',
  });

  await page.locator(
    '[data-advice-provider="claude"] [data-advice-consent-kind="aggregate"]',
  ).focus();
  await dispatchDashboardDataPatch(page, 'claude');

  await expect(page.locator(
    '[data-advice-provider="claude"] [data-advice-consent-kind="aggregate"]',
  )).not.toBeChecked();
  await expect(preview).toBeHidden();
  await expect(body).toHaveText('');
  await expect(send).toBeDisabled();
  expect(await postedMessages(page, 'sendAdviceSnapshot')).toEqual([]);
});

test('candidate exposes only bounded advice actions and feedback posts identifiers plus kind only', async ({ page }) => {
  const root = await openCandidate(page, 'claude');
  await expect(root.locator('form, a[href]')).toHaveCount(0);
  await expect(root.locator('[data-advice-action="send"]')).toBeDisabled();
  expect(await root.locator('[data-advice-action]').evaluateAll((elements) =>
    [...new Set(elements.map((element) => element.getAttribute('data-advice-action')))].sort()))
    .toEqual(['clear', 'feedback', 'preview', 'send', 'snooze']);

  const feedbackKinds = await root.locator('[data-advice-action="feedback"]')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-feedback-kind')));
  expect(feedbackKinds).toEqual(['helpful', 'not-helpful', 'applied']);

  const helpful = root.locator('[data-feedback-kind="helpful"]');
  await helpful.focus();
  await helpful.press('Space');
  await expectPostedCount(page, 'recordAdviceFeedback', 1);
  const message = (await postedMessages(page, 'recordAdviceFeedback')).at(-1);
  expect(Object.keys(message).sort()).toEqual([
    'adviceId',
    'command',
    'kind',
    'provider',
    'recommendationId',
  ]);
  expect(message).toEqual({
    command: 'recordAdviceFeedback',
    provider: 'claude',
    adviceId: 'advice-claude-ui-fixture',
    recommendationId: 'recommendation-claude-clear-between-tasks',
    kind: 'helpful',
  });
  expect(JSON.stringify(message)).not.toMatch(/prompt|body|path|session|payload/i);

  await dispatchHostMessage(page, {
    command: 'adviceFeedbackResult',
    ok: true,
    provider: 'claude',
    adviceId: message.adviceId,
    recommendationId: message.recommendationId,
    rating: 'helpful',
    applied: 'not-applied',
  });
  await expect(helpful).toHaveAttribute('aria-pressed', 'true');
  await expect(helpful).toBeEnabled();
  await expect(root.locator('[data-advice-feedback-status]')).not.toBeEmpty();

  page.once('dialog', (dialog) => dialog.accept());
  await root.locator('[data-advice-action="clear"]').click();
  await expectPostedCount(page, 'clearAdviceLocalData', 1);
  expect((await postedMessages(page, 'clearAdviceLocalData')).at(-1)).toEqual({
    command: 'clearAdviceLocalData',
  });
});

test('snooze posts only opaque recommendation identity and does not send a network request', async ({ page }) => {
  const root = await openCandidate(page, 'claude');
  const snooze = root.locator('[data-advice-action="snooze"]').first();
  await snooze.click();
  await expectPostedCount(page, 'snoozeAdvice', 1);
  const message = (await postedMessages(page, 'snoozeAdvice')).at(-1);
  expect(message).toEqual({
    command: 'snoozeAdvice',
    provider: 'claude',
    adviceId: 'advice-claude-ui-fixture',
    recommendationId: 'recommendation-claude-clear-between-tasks',
    mode: 'snooze',
  });
  expect(JSON.stringify(message)).not.toMatch(/prompt|body|path|session|payload/i);
});

test('host-persisted advice snooze remains closed and resumable after a full webview reload', async ({ page }) => {
  await openClaude(page, { fixture: 'advice-effectiveness-snoozed' });
  await page.locator('#tab-content').click();

  const snoozed = page.locator(
    '[data-advice-provider="claude"] .advice-recommendation-snoozed',
  );
  const resume = snoozed.locator('[data-advice-action="snooze"]');
  await expect(snoozed).toHaveCount(1);
  await expect(snoozed).not.toHaveAttribute('open', '');
  await expect(resume).toHaveAttribute('data-snooze-mode', 'resume');

  await page.reload({ waitUntil: 'load' });
  await page.locator('#tab-content').click();
  const reloaded = page.locator(
    '[data-advice-provider="claude"] .advice-recommendation-snoozed',
  );
  await expect(reloaded).toHaveCount(1);
  await expect(reloaded).not.toHaveAttribute('open', '');
  await expect(reloaded.locator('[data-advice-action="snooze"]'))
    .toHaveAttribute('data-snooze-mode', 'resume');
});

test('one recommendation feedback leaves sibling recommendations interactive and recovers on failure', async ({ page }) => {
  const root = await openCandidate(page, 'codex');
  const groups = root.locator('.advice-feedback-group');
  await expect(groups).toHaveCount(2);
  const firstButtons = groups.nth(0).locator('[data-advice-action="feedback"]');
  const siblingButtons = groups.nth(1).locator('[data-advice-action="feedback"]');

  await firstButtons.first().click();
  for (let index = 0; index < 3; index += 1) {
    await expect(firstButtons.nth(index)).toBeDisabled();
    await expect(siblingButtons.nth(index)).toBeEnabled();
  }
  const message = (await postedMessages(page, 'recordAdviceFeedback')).at(-1);

  await dispatchHostMessage(page, {
    command: 'adviceFeedbackResult',
    ok: false,
    provider: 'codex',
    adviceId: message.adviceId,
    recommendationId: message.recommendationId,
  });
  for (let index = 0; index < 3; index += 1) {
    await expect(firstButtons.nth(index)).toBeEnabled();
    await expect(siblingButtons.nth(index)).toBeEnabled();
  }
});

test('optimizer exact preview fails closed before enabling the shared explicit sender', async ({ page }) => {
  await openClaude(page, { fixture: 'advice-optimizer' });
  await page.locator('#tab-content').click();
  const card = page.locator('.action-card[data-advice-provider="optimizer"]');
  const preview = card.locator('#optPreview');
  const send = card.locator('#optSendBtn');
  await expect(card).toBeVisible();
  await expect(send).toBeDisabled();

  const base = {
    command: 'optimizePreviewResult',
    ok: true,
    snapshotId: 'optimizer-0123456789abcdef01234567',
    body: '{"model":"safe-model","safe":true}',
    sha256: createHash('sha256').update('{"model":"safe-model","safe":true}', 'utf8').digest('hex'),
    utf8Bytes: Buffer.byteLength('{"model":"safe-model","safe":true}', 'utf8'),
    endpoint: 'https://example.invalid/v1/chat/completions', apiFormat: 'openai', model: 'safe-model',
    dataMode: 'user-draft-only',
  };
  await dispatchHostMessage(page, base);
  await expect(preview).toBeHidden();
  await expect(send).toBeDisabled();

  await dispatchHostMessage(page, {
    ...base,
    contentType: 'application/json',
    sha256: 'a'.repeat(64),
  });
  await expect(card.locator('#optError')).toBeVisible();
  await expect(preview).toBeHidden();
  await expect(send).toBeDisabled();

  await dispatchHostMessage(page, { ...base, contentType: 'application/json' });
  await expect(preview).toBeVisible();
  await expect(send).toBeEnabled();
  await send.click();
  await expectPostedCount(page, 'sendOptimizerRequest', 1);
  expect((await postedMessages(page, 'sendOptimizerRequest')).at(-1)).toEqual({
    command: 'sendOptimizerRequest',
    snapshotId: base.snapshotId,
    draft: 'HOST_ONLY_OPTIMIZER_DRAFT',
  });
});

test('optimizer result records the same retractable local feedback events', async ({ page }) => {
  await openClaude(page, { fixture: 'advice-optimizer' });
  await page.locator('#tab-content').click();
  const card = page.locator('.action-card[data-advice-provider="optimizer"]');
  const feedback = card.locator('#optFeedback');
  const buttons = feedback.locator('[data-advice-action="feedback"]');
  await expect(feedback).toBeVisible();
  await expect(buttons).toHaveCount(3);

  await buttons.first().click();
  const message = (await postedMessages(page, 'recordAdviceFeedback')).at(-1);
  expect(message).toEqual({
    command: 'recordAdviceFeedback',
    provider: 'optimizer',
    adviceId: 'advice-optimizer-0123456789abcdef01234567',
    recommendationId: 'recommendation-optimizer-result-v1',
    kind: 'helpful',
  });
  await dispatchHostMessage(page, {
    command: 'adviceFeedbackResult',
    ok: true,
    provider: 'optimizer',
    adviceId: message.adviceId,
    recommendationId: message.recommendationId,
    rating: 'helpful',
    applied: 'not-applied',
  });
  await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true');
  for (let index = 0; index < 3; index += 1) {
    await expect(buttons.nth(index)).toBeEnabled();
  }
});

test('optimizer snooze is keyboard reachable and posts only its opaque target', async ({ page }) => {
  await openClaude(page, { fixture: 'advice-optimizer' });
  await page.locator('#tab-content').click();
  const snooze = page.locator(
    '.action-card[data-advice-provider="optimizer"] [data-advice-action="snooze"]',
  );
  await expect(snooze).toBeVisible();
  await snooze.focus();
  await snooze.press('Enter');
  await expectPostedCount(page, 'snoozeAdvice', 1);
  const message = (await postedMessages(page, 'snoozeAdvice')).at(-1);
  expect(message).toEqual({
    command: 'snoozeAdvice',
    provider: 'optimizer',
    adviceId: 'advice-optimizer-0123456789abcdef01234567',
    recommendationId: 'recommendation-optimizer-result-v1',
    mode: 'snooze',
  });
  expect(JSON.stringify(message)).not.toMatch(/prompt|body|path|session|payload/i);
});

test('optimizer snooze control remains within the narrow shared card', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openClaude(page, { fixture: 'advice-optimizer' });
  await page.locator('#tab-content').click();
  expect(await page.locator('body').evaluate((element) =>
    element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test('a new optimizer result does not inherit feedback from the previous run', async ({ page }) => {
  await openClaude(page, { fixture: 'advice-optimizer' });
  await page.locator('#tab-content').click();
  const card = page.locator('.action-card[data-advice-provider="optimizer"]');
  const helpful = card.locator('[data-feedback-kind="helpful"]');

  await dispatchHostMessage(page, {
    command: 'adviceFeedbackResult',
    ok: true,
    provider: 'optimizer',
    adviceId: 'advice-optimizer-0123456789abcdef01234567',
    recommendationId: 'recommendation-optimizer-result-v1',
    rating: 'helpful',
    applied: 'not-applied',
  });
  await expect(helpful).toHaveAttribute('aria-pressed', 'true');

  await dispatchHostMessage(page, {
    command: 'optimizeResult',
    prompt: 'New paste-ready result',
    settings: 'Effort: low',
    adviceId: 'advice-optimizer-89abcdef0123456789abcdef',
    recommendationId: 'recommendation-optimizer-result-v1',
  });

  await expect(helpful).toHaveAttribute(
    'data-advice-id',
    'advice-optimizer-89abcdef0123456789abcdef',
  );
  await expect(helpful).toHaveAttribute('aria-pressed', 'false');
  await expect(helpful).not.toHaveClass(/is-selected/);

  await dispatchHostMessage(page, {
    command: 'adviceFeedbackResult',
    ok: true,
    provider: 'optimizer',
    adviceId: 'advice-optimizer-0123456789abcdef01234567',
    recommendationId: 'recommendation-optimizer-result-v1',
    rating: 'helpful',
    applied: 'not-applied',
  });
  await expect(helpful).toHaveAttribute('aria-pressed', 'false');
  await expect(helpful).not.toHaveClass(/is-selected/);
});

test('optimizer feedback operation survives a full webview reload', async ({ page }) => {
  await openClaude(page, { fixture: 'advice-optimizer' });
  await page.locator('#tab-content').click();
  const card = page.locator('.action-card[data-advice-provider="optimizer"]');
  const helpful = card.locator('[data-feedback-kind="helpful"]');

  await helpful.click();
  const message = (await postedMessages(page, 'recordAdviceFeedback')).at(-1);
  await dispatchHostMessage(page, {
    command: 'adviceFeedbackResult',
    ok: true,
    provider: 'optimizer',
    adviceId: message.adviceId,
    recommendationId: message.recommendationId,
    rating: 'helpful',
    applied: 'not-applied',
  });
  await expect(helpful).toHaveAttribute('aria-pressed', 'true');

  // The query value is the test harness representation of the durable host
  // ledger written by the operation above; reload must reconstruct the state.
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('adviceFeedback', 'optimizer-helpful');
    window.history.replaceState({}, '', url);
  });
  await page.reload({ waitUntil: 'load' });

  const reloaded = page.locator(
    '.action-card[data-advice-provider="optimizer"] [data-feedback-kind="helpful"]',
  );
  await expect(reloaded).toHaveAttribute('aria-pressed', 'true');
  await expect(reloaded).toHaveClass(/is-selected/);
});

for (const provider of ['claude', 'codex']) {
  test(`${provider} candidate has labelled structure and no serious Axe violations`, async ({ page }) => {
    const root = await openCandidate(page, provider, { theme: 'dark' });
    await expect(root).toHaveAttribute('aria-labelledby', `advice-effectiveness-${provider}`);
    await expect(root.locator(`#advice-effectiveness-${provider}`)).toBeVisible();
    const spines = root.locator('.advice-spine');
    expect(await spines.count()).toBeGreaterThanOrEqual(2);
    expect(await spines.evaluateAll((items) =>
      items.every((item) => Boolean(item.getAttribute('aria-label'))))).toBe(true);
    await expect(spines.first().locator(':scope > li')).toHaveCount(2);
    await expect(spines.first().locator('.advice-step-marker')).toHaveText(['1', '2']);
    for (let index = 1; index < await spines.count(); index += 1) {
      await expect(spines.nth(index).locator(':scope > li')).toHaveCount(3);
      await expect(spines.nth(index).locator('.advice-step-marker')).toHaveText(['3', '4', '5']);
    }
    expect(await root.locator('.advice-feedback-group').evaluateAll((items) =>
      items.every((item) => item.getAttribute('role') === 'group'))).toBe(true);
    expect(await root.locator('[data-advice-feedback-status]').evaluateAll((items) =>
      items.every((item) => item.getAttribute('aria-live') === 'polite'))).toBe(true);
    if (provider === 'claude') {
      await expect(root.locator('.advice-consent legend')).not.toBeEmpty();
      await expect(root.locator('[data-advice-consent-status]')).toHaveAttribute('aria-live', 'polite');
      await expect(root.locator('[data-advice-preview-body]')).toHaveAttribute('tabindex', '0');
      await expect(root.locator('[data-advice-preview-body]')).toHaveAttribute('aria-label', /.+/);
    }
    expect(await seriousOrCriticalViolations(
      page,
      `.advice-effectiveness-body[data-advice-provider="${provider}"]`,
    )).toEqual([]);
  });
}

for (const locale of locales) {
  test(`${locale} candidate adds no narrow-screen overflow beyond the shared shell`, async ({ page }) => {
    for (const provider of ['claude', 'codex']) {
      const open = provider === 'claude' ? openClaude : openCodex;
      await open(page, {
        fixture: 'advice-effectiveness-disabled',
        locale,
        width: 360,
        height: 800,
      });
      await page.locator('#tab-content').click();
      const baseline = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }));

      const root = await openCandidate(page, provider, {
        locale,
        width: 360,
        height: 800,
      });
      const layout = await root.evaluate((element) => ({
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        rootClientWidth: element.clientWidth,
        rootScrollWidth: element.scrollWidth,
      }));
      // The pre-existing tab/header shell is intentionally one unwrapped row
      // on narrow panels. The candidate must not widen that known baseline.
      expect(layout.documentWidth, { baseline, layout })
        .toBeLessThanOrEqual(baseline.documentWidth);
      expect(layout.bodyWidth, { baseline, layout })
        .toBeLessThanOrEqual(baseline.bodyWidth);
      expect(layout.rootScrollWidth, layout).toBeLessThanOrEqual(layout.rootClientWidth);
    }
  });
}

for (const theme of ['light', 'dark']) {
  test(`${theme} candidate keeps the sealed-snapshot visual hierarchy`, async ({ page }) => {
    const root = await openCandidate(page, 'claude', { theme });
    const structure = await root.evaluate((element) => {
      const style = getComputedStyle(element);
      const spine = element.querySelector('.advice-spine');
      const payload = element.querySelector('.advice-payload-section');
      return {
        background: style.backgroundColor,
        borderStyle: style.borderTopStyle,
        borderWidth: Number.parseFloat(style.borderTopWidth),
        spineDisplay: spine ? getComputedStyle(spine).display : null,
        payloadBorderStyle: payload ? getComputedStyle(payload).borderTopStyle : null,
        payloadBorderWidth: payload ? Number.parseFloat(getComputedStyle(payload).borderTopWidth) : 0,
      };
    });
    expect(structure.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(structure.borderStyle).not.toBe('none');
    expect(structure.borderWidth).toBeGreaterThan(0);
    expect(structure.spineDisplay).toBe('grid');
    expect(structure.payloadBorderStyle).not.toBe('none');
    expect(structure.payloadBorderWidth).toBeGreaterThan(0);
  });
}
