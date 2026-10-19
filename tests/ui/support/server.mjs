import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { lstatSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { renderHarness, achievementResourceFiles } = require('./render-harness.cjs');
// Read only the packaged catalog at startup; requests select cached bytes by
// exact route, never a path, URL parameter, directory listing or user source.
const achievementResources = new Map([...achievementResourceFiles].map(([route, filename]) => {
  if (!lstatSync(filename).isFile()) throw new Error('Expected a regular packaged achievement icon');
  return [route, readFileSync(filename)];
}));
const locales = new Set(['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']);
const uiTestPort = Number(process.env.CCU_UI_TEST_PORT ?? 4173);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${uiTestPort}`);
    if (url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('ok');
      return;
    }
    if (url.pathname === '/__weekly_accounts_setting__' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 512) throw new Error('Synthetic setting message too large');
      }
      const ok = await require('./weekly-account-fixture.cjs').updateWeeklyAccountSetting(JSON.parse(body));
      response.writeHead(ok ? 200 : 400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok }));
      return;
    }
    if (url.pathname !== '/') {
      const image = achievementResources.get(url.pathname);
      if (image) {
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff' });
        response.end(image);
        return;
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }

    const requestedLocale = url.searchParams.get('locale') ?? 'en';
    const locale = locales.has(requestedLocale) ? requestedLocale : 'en';
    const requestedProvider = url.searchParams.get('provider');
    const provider = requestedProvider === 'claude' || requestedProvider === 'compare'
      ? requestedProvider
      : 'codex';
    const requestedTheme = url.searchParams.get('theme');
    const theme = ['dark', 'highContrast'].includes(requestedTheme) ? requestedTheme : 'light';
    const requestedFixture = url.searchParams.get('fixture') ?? 'default';
    const fixture = [
      'default',
      'complete-index',
      'rootless-cycle',
      'root-over-limit',
      'persisted-details',
      'weekly-usage-only',
      'weekly-rough-partial',
      'weekly-accounts',
      'weekly-claude-completed',
      'weekly-quota-pace',
      'unknown-models',
      'zero-input',
      'covered-day-without-hourly-rows',
      'advice-effectiveness',
      'advice-effectiveness-snoozed',
      'advice-effectiveness-disabled',
      'advice-optimizer',
      'combined-heatmap',
      'session-timezone-boundaries',
      'local-currency',
      'achievement-token-stages',
      'achievement-share-resources',
      'achievement-calendar-subset',
      'achievement-review-loading',
      'achievement-review-failure',
      'achievement-proof-stale',
      'achievement-review-next-rank',
      'achievement-management-history',
      'achievement-management-history-recorded',
      'achievement-management-full',
      'achievement-long-term-gold',
      'achievement-long-term-platinum',
      'achievement-long-term-legendary',
      'achievement-effort-statistics',
      'achievement-effort-statistics-empty',
      'achievement-effort-statistics-retired',
      'achievement-records',
      'achievement-records-read',
      'achievement-history-only',
      'achievement-pins',
      'achievement-six-pins',
      'achievement-six-pins-reordered',
      'achievement-last-pin',
      'achievement-last-pin-removed',
      'achievement-theme-milestones',
      'achievement-theme-pins',
      'achievement-theme-pins-released',
      'achievement-journey-partial',
      'achievement-journey-complete',
      'achievement-journey-history',
      'achievement-hidden-pins',
      'achievement-hidden-pins-released',
      'achievement-hidden-pins-last',
    ].includes(requestedFixture)
      ? requestedFixture
      : 'default';
    const requestedTimeZone = url.searchParams.get('timeZone') ?? 'Asia/Hong_Kong';
    const timeZone = ['Asia/Hong_Kong', 'Asia/Tokyo', 'Pacific/Honolulu'].includes(requestedTimeZone)
      ? requestedTimeZone
      : 'Asia/Hong_Kong';
    const autoRefresh = url.searchParams.get('autoRefresh') === 'true';
    const weeklyValue = url.searchParams.get('weeklyValue') !== 'false';
    const shareStudio = url.searchParams.get('shareStudio') !== 'false';
    const projectMatrix = url.searchParams.get('projectMatrix') !== 'false';
    const achievementsEnabled = url.searchParams.get('achievementsEnabled') !== 'false';
    const achievementNotices = url.searchParams.get('achievementNotices') !== 'false';
    const requestedFeedback = url.searchParams.get('adviceFeedback');
    const adviceFeedback = requestedFeedback === 'claude-helpful' ||
      requestedFeedback === 'optimizer-helpful'
      ? requestedFeedback
      : 'none';
    const requestedCodexMonth = url.searchParams.get('codexMonth') ?? '';
    const codexMonth = /^\d{4}-\d{2}$/.test(requestedCodexMonth)
      ? requestedCodexMonth
      : '';
    const claudeOnly = url.searchParams.get('claudeOnly') === 'true';
    const codexOnly = url.searchParams.get('codexOnly') === 'true';
    const requestedCommandTemplate = url.searchParams.get('commandTemplate') ?? '';
    const commandTemplate = ['claudeShareCard', 'claudeHeatmap', 'achievements'].includes(requestedCommandTemplate)
      ? requestedCommandTemplate
      : '';
    const commandAfterReset = url.searchParams.get('commandAfterReset') === 'true';
    const quotaPace = url.searchParams.get('quotaPace') === 'true';
    const requestedPaceState = url.searchParams.get('quotaPaceState') ?? 'fresh';
    const quotaPaceState = ['fresh', 'stale', 'reset', 'null', 'raw-mismatch'].includes(requestedPaceState)
      ? requestedPaceState : 'fresh';
    const html = await renderHarness({
      provider,
      locale,
      theme,
      fixture,
      autoRefresh,
      weeklyValue,
      shareStudio,
      projectMatrix,
      achievementsEnabled,
      achievementNotices,
      adviceFeedback,
      timeZone,
      codexMonth,
      claudeOnly,
      codexOnly,
      commandTemplate,
      commandAfterReset,
      quotaPace,
      quotaPaceState,
      weeklyAccountSession: url.searchParams.get('weeklyAccountSession') ?? '00000000000000000000000000000000',
      nativeResources: url.searchParams.get('nativeResources') === 'true',
    });
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(html);
  } catch {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Internal Server Error');
  }
});

server.listen(uiTestPort, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
