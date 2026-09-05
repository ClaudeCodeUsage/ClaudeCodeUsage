import { test as base, expect } from '@playwright/test';

const uiBaseUrl = `http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}`;

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.__ccuPostedMessages = [];
      window.acquireVsCodeApi = () => ({
        getState: () => {
          const raw = localStorage.getItem('__ccu-vscode-state');
          return raw ? JSON.parse(raw) : undefined;
        },
        setState: (value) => {
          localStorage.setItem('__ccu-vscode-state', JSON.stringify(value));
        },
        postMessage: (value) => {
          window.__ccuPostedMessages.push(structuredClone(value));
          return Promise.resolve(true);
        },
      });
    });
    await page.clock.install({ time: new Date('2026-07-20T12:00:00.000Z') });
    await use(page);
  },
});

export { expect };

export async function openCodex(
  page,
  { locale = 'en', theme = 'light', fixture = 'default', autoRefresh = false, weeklyValue = true, width = 1280, height = 900 } = {},
) {
  await page.setViewportSize({ width, height });
  await page.goto(
    `${uiBaseUrl}/?provider=codex&locale=${encodeURIComponent(locale)}&theme=${theme}&fixture=${encodeURIComponent(fixture)}&autoRefresh=${autoRefresh}&weeklyValue=${weeklyValue}`,
    { waitUntil: 'load' },
  );
  await page.locator('.tab-content.active').waitFor();
  await expect(page.locator('#provider-tab-codex')).toHaveAttribute('aria-selected', 'true');
}

export async function openClaude(
  page,
  { locale = 'en', theme = 'light', fixture = 'default', autoRefresh = false, weeklyValue = true, width = 1280, height = 900 } = {},
) {
  await page.setViewportSize({ width, height });
  await page.goto(
    `${uiBaseUrl}/?provider=claude&locale=${encodeURIComponent(locale)}&theme=${theme}&fixture=${encodeURIComponent(fixture)}&autoRefresh=${autoRefresh}&weeklyValue=${weeklyValue}`,
    { waitUntil: 'load' },
  );
  await page.locator('.tab-content.active').waitFor();
}

export async function openCompare(
  page,
  { locale = 'en', theme = 'light', fixture = 'default', autoRefresh = false, weeklyValue = true, width = 1280, height = 900 } = {},
) {
  await page.setViewportSize({ width, height });
  await page.goto(
    `${uiBaseUrl}/?provider=compare&locale=${encodeURIComponent(locale)}&theme=${theme}&fixture=${encodeURIComponent(fixture)}&autoRefresh=${autoRefresh}&weeklyValue=${weeklyValue}`,
    { waitUntil: 'load' },
  );
  await page.locator('#provider-panel').waitFor();
  await expect(page.locator('#provider-tab-compare')).toHaveAttribute('aria-selected', 'true');
}
