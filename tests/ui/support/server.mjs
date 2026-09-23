import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderHarness } = require('./render-harness.cjs');
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
    if (url.pathname !== '/') {
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
    const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
    const requestedFixture = url.searchParams.get('fixture') ?? 'default';
    const fixture = [
      'default',
      'rootless-cycle',
      'root-over-limit',
      'persisted-details',
      'weekly-usage-only',
      'weekly-claude-completed',
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
    const requestedCommandTemplate = url.searchParams.get('commandTemplate') ?? '';
    const commandTemplate = ['claudeShareCard', 'claudeHeatmap'].includes(requestedCommandTemplate)
      ? requestedCommandTemplate
      : '';
    const commandAfterReset = url.searchParams.get('commandAfterReset') === 'true';
    const html = await renderHarness({
      provider,
      locale,
      theme,
      fixture,
      autoRefresh,
      weeklyValue,
      shareStudio,
      projectMatrix,
      adviceFeedback,
      timeZone,
      codexMonth,
      claudeOnly,
      commandTemplate,
      commandAfterReset,
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
