import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderHarness } = require('./render-harness.cjs');
const locales = new Set(['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']);
const uiTestPort = Number(process.env.CCU_UI_TEST_PORT ?? 4173);

const server = createServer((request, response) => {
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
    const fixture = ['default', 'rootless-cycle', 'root-over-limit', 'persisted-details', 'weekly-usage-only', 'weekly-claude-completed', 'unknown-models', 'zero-input'].includes(requestedFixture)
      ? requestedFixture
      : 'default';
    const autoRefresh = url.searchParams.get('autoRefresh') === 'true';
    const weeklyValue = url.searchParams.get('weeklyValue') !== 'false';
    const html = renderHarness({ provider, locale, theme, fixture, autoRefresh, weeklyValue });
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
