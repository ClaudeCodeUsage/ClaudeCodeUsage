import { test, expect, openClaude, openCodex } from './support/app.mjs';

test('a live Codex refresh waits for an active scroll burst before replacing the panel', async ({ page }) => {
  await openCodex(page, { height: 420 });
  const before = await page.evaluate(() => {
    const panel = document.getElementById('provider-panel');
    const filler = document.createElement('div');
    filler.style.height = '1600px';
    panel.appendChild(filler);
    scrollTo(0, 160);
    window.dispatchEvent(new Event('scroll'));
    window.__ccuScrollPanel = panel.firstElementChild;
    window.dispatchEvent(new MessageEvent('message', { data: {
      command: 'dashboardDataPatch',
      provider: 'codex',
      tab: 'today',
      revision: 1,
      html: panel.innerHTML,
      claudeLast30HoursByDay: {},
    } }));
    return { scrollY, calls: window.__ccuSetStateCalls };
  });
  expect(before.scrollY).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.getElementById('provider-panel').firstElementChild === window.__ccuScrollPanel)).toBe(true);
  expect(await page.evaluate(() => window.__ccuPostedMessages.some((message) => message.command === 'dashboardDataPatchAck'))).toBe(false);
  await expect.poll(() => page.evaluate(() =>
    window.__ccuPostedMessages.some((message) => message.command === 'dashboardDataPatchAck' && message.revision === 1 && message.ok),
  )).toBe(true);
  expect(await page.evaluate((calls) => window.__ccuSetStateCalls - calls, before.calls)).toBeLessThanOrEqual(1);
});

test('continued Codex scrolling coalesces updates but cannot starve the latest patch', async ({ page }) => {
  await openCodex(page, { height: 420 });
  await page.evaluate(() => {
    const panel = document.getElementById('provider-panel');
    const filler = document.createElement('div');
    filler.style.height = '1600px';
    panel.appendChild(filler);
    scrollTo(0, 160);
    window.dispatchEvent(new Event('scroll'));
    window.__ccuScrollPulse = setInterval(() => window.dispatchEvent(new Event('scroll')), 35);
    for (let revision = 1; revision <= 4; revision += 1) {
      window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'dashboardDataPatch', provider: 'codex', tab: 'today', revision,
        html: panel.innerHTML, claudeLast30HoursByDay: {},
      } }));
    }
  });
  try {
    await expect.poll(() => page.evaluate(() =>
      window.__ccuPostedMessages.filter((message) => message.command === 'dashboardDataPatchAck'),
    )).toEqual([{ command: 'dashboardDataPatchAck', revision: 4, ok: true }]);
  } finally {
    await page.evaluate(() => clearInterval(window.__ccuScrollPulse));
  }
});

test('a 20-update scroll storm swaps the provider panel at most twice', async ({ page }) => {
  await openCodex(page, { height: 420 });
  const result = await page.evaluate(async () => {
    const panel = document.getElementById('provider-panel');
    const filler = document.createElement('div');
    filler.style.height = '1600px';
    panel.appendChild(filler);
    const html = panel.innerHTML;
    let swaps = 0;
    const observer = new MutationObserver((records) => {
      swaps += records.filter((record) => record.type === 'childList').length;
    });
    observer.observe(panel, { childList: true });
    scrollTo(0, 160);
    for (let revision = 1; revision <= 20; revision += 1) {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new MessageEvent('message', { data: {
        command: 'dashboardDataPatch', provider: 'codex', tab: 'today', revision,
        html, claudeLast30HoursByDay: {},
      } }));
      await new Promise((done) => setTimeout(done, 25));
    }
    await new Promise((done) => setTimeout(done, 650));
    observer.disconnect();
    return {
      swaps,
      acks: window.__ccuPostedMessages
        .filter((message) => message.command === 'dashboardDataPatchAck')
        .map((message) => message.revision),
    };
  });
  expect(result.swaps).toBeGreaterThan(0);
  expect(result.swaps).toBeLessThanOrEqual(2);
  expect(result.acks.at(-1)).toBe(20);
});

const scrollerFixtures = [
  ['dashboard-tabs', 'tabs'],
  ['chart', 'hc-scroll'],
  ['table', 'daily-table-container'],
  ['project-heatmap', 'project-matrix-scroll'],
  ['project-trend', 'project-matrix-trend-scroll'],
  ['local-data-table', 'local-data-table-wrap'],
  ['heatmap', 'heatmap-svg'],
  ['share-preview', 'share-preview'],
  ['share-preview-copy', 'share-preview'],
  ['advice-preview', 'advice-payload-preview-body'],
];

test('live dashboard patches preserve every local scroller kind and sanitize landmark keys', async ({ page }) => {
  await openClaude(page, { width: 900, height: 720 });

  const before = await page.evaluate((fixtures) => {
    const panel = document.getElementById('provider-panel');
    if (!panel) throw new Error('Claude fixture did not render a provider panel');
    const scope = panel.querySelector('#today');
    if (!scope) throw new Error('Claude fixture did not render the Today panel');

    const fixtureRoot = document.createElement('div');
    fixtureRoot.setAttribute('data-refresh-fixture-root', 'true');
    scope.appendChild(fixtureRoot);

    const makeScroller = (id, className, index) => {
      let scroller;
      if (id === 'advice-preview') {
        const owner = document.createElement('details');
        owner.className = 'advice-payload-preview';
        owner.setAttribute('data-advice-provider', 'claude');
        owner.open = true;
        scroller = document.createElement('pre');
        owner.appendChild(scroller);
        fixtureRoot.appendChild(owner);
      } else {
        scroller = document.createElement('div');
        fixtureRoot.appendChild(scroller);
      }
      scroller.className = className;
      scroller.setAttribute('data-refresh-fixture', id);
      scroller.style.cssText = 'display:block;width:90px;height:45px;overflow:scroll;';
      const content = document.createElement('div');
      content.style.cssText = 'width:640px;height:360px;';
      content.textContent = id;
      scroller.appendChild(content);

      if (id === 'chart') {
        scroller.setAttribute('data-codex-time-series', '');
        scroller.setAttribute('data-date', '2026-07-20');
      } else if (id === 'table') {
        scroller.setAttribute('data-month', '2026-07');
      } else if (id === 'project-heatmap') {
        scroller.setAttribute('data-project-matrix', 'claude');
        scroller.setAttribute('data-project-matrix-range-panel', '30');
        scroller.setAttribute('data-project-matrix-heatmap', '');
      } else if (id === 'project-trend') {
        scroller.setAttribute('data-project-matrix', 'claude');
        scroller.setAttribute('data-project-matrix-range-panel', '90');
        scroller.setAttribute('data-project-matrix-trend', '');
      } else if (id === 'local-data-table') {
        scroller.setAttribute('data-month', '/Users/example/private-history');
      } else if (id === 'heatmap') {
        scroller.setAttribute('data-codex-last30-daily', '');
      }

      scroller.scrollLeft = 25 + index * 11;
      scroller.scrollTop = 15 + index * 7;
      return {
        id,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      };
    };

    const positions = fixtures.map(([id, className], index) =>
      makeScroller(id, className, index));
    const entries = globalThis.ccuRefreshScrollerEntries(panel)
      .filter(({ scroller }) => scroller.hasAttribute('data-refresh-fixture'))
      .map(({ scroller, key }) => ({
        id: scroller.getAttribute('data-refresh-fixture'),
        key,
      }));
    const landmarkChecks = {
      date: globalThis.ccuRefreshSafeScrollLandmark('data-date', '2026-07-20'),
      badDate: globalThis.ccuRefreshSafeScrollLandmark('data-date', '../../private'),
      month: globalThis.ccuRefreshSafeScrollLandmark('data-month', '2026-07'),
      badMonth: globalThis.ccuRefreshSafeScrollLandmark('data-month', '/Users/example/private'),
      provider: globalThis.ccuRefreshSafeScrollLandmark('data-project-matrix', 'claude'),
      badProvider: globalThis.ccuRefreshSafeScrollLandmark('data-project-matrix', 'account-secret'),
      range: globalThis.ccuRefreshSafeScrollLandmark('data-project-matrix-range-panel', '30'),
      badRange: globalThis.ccuRefreshSafeScrollLandmark('data-project-matrix-range-panel', '365'),
      adviceProvider: globalThis.ccuRefreshSafeScrollLandmark('data-advice-provider', 'optimizer'),
      badAdviceProvider: globalThis.ccuRefreshSafeScrollLandmark('data-advice-provider', 'account-secret'),
      valueless: globalThis.ccuRefreshSafeScrollLandmark('data-hourly-overview', ''),
      valuedFlag: globalThis.ccuRefreshSafeScrollLandmark('data-hourly-overview', 'private'),
    };

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'dashboardDataPatch',
        provider: 'claude',
        tab: 'today',
        revision: 1,
        html: panel.innerHTML,
        claudeLast30HoursByDay: {},
      },
    }));
    return { positions, entries, landmarkChecks };
  }, scrollerFixtures);

  expect(before.entries).toHaveLength(scrollerFixtures.length);
  expect(before.positions.every(({ scrollLeft, scrollTop }) =>
    scrollLeft > 0 && scrollTop > 0)).toBe(true);
  expect(new Set(before.entries.map(({ key }) => key.split('|')[1])))
    .toEqual(new Set([
      'dashboard-tabs',
      'chart',
      'table',
      'project-heatmap',
      'project-trend',
      'local-data-table',
      'heatmap',
      'share-preview',
      'advice-preview',
    ]));
  expect(before.entries.find(({ id }) => id === 'chart').key)
    .toContain('data-codex-time-series=present/data-date=2026-07-20');
  expect(before.entries.find(({ id }) => id === 'project-heatmap').key)
    .toContain('data-project-matrix=claude');
  expect(before.entries.find(({ id }) => id === 'local-data-table').key)
    .not.toContain('private-history');
  const duplicateShareKeys = before.entries
    .filter(({ id }) => id.startsWith('share-preview'))
    .map(({ key }) => key);
  expect(new Set(duplicateShareKeys).size).toBe(2);
  expect(before.landmarkChecks).toEqual({
    date: '2026-07-20',
    badDate: '',
    month: '2026-07',
    badMonth: '',
    provider: 'claude',
    badProvider: '',
    range: '30',
    badRange: '',
    adviceProvider: 'optimizer',
    badAdviceProvider: '',
    valueless: 'present',
    valuedFlag: '',
  });

  await expect.poll(() => page.evaluate(() =>
    window.__ccuPostedMessages.filter((message) =>
      message.command === 'dashboardDataPatchAck').at(-1),
  )).toEqual({ command: 'dashboardDataPatchAck', revision: 1, ok: true });

  await expect.poll(async () => page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-refresh-fixture]')).map((scroller) => ({
      id: scroller.getAttribute('data-refresh-fixture'),
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
    })),
  )).toEqual(before.positions);
});
