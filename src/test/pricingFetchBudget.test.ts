import { EventEmitter } from 'node:events';
import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import * as https from 'node:https';
import { fetchLatestPricing, getExactModelPricing, getModelPricing, getPricingLastFetched } from '../pricing';

class PricingResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  destroyed = false;
  setEncoding(): void {}
  resume(): void {}
  destroy(): void { this.destroyed = true; }
}

class PricingRequest extends EventEmitter {
  destroyed = false;
  destroy(error?: Error): void {
    this.destroyed = true;
    if (error) this.emit('error', error);
  }
}

function fakeNetwork(context: TestContext) {
  const exchanges: Array<{ request: PricingRequest; response: PricingResponse }> = [];
  context.mock.method(https, 'get', (_url: unknown, _options: unknown, callback: (response: PricingResponse) => void) => {
    const request = new PricingRequest();
    const response = new PricingResponse();
    // Prevent the synthetic emitter itself throwing if production lacks an
    // error listener. The assertion still detects an unresolved/accepted read.
    response.on('error', () => {});
    exchanges.push({ request, response });
    queueMicrotask(() => callback(response));
    return request;
  });
  return exchanges;
}

function send(response: PricingResponse, value: unknown): void {
  response.emit('data', JSON.stringify(value));
  response.emit('end');
}

test('concurrent pricing refreshes share one network response and one retained catalog', async context => {
  const exchanges = fakeNetwork(context);
  const first = fetchLatestPricing();
  const second = fetchLatestPricing();
  try {
    assert.equal(exchanges.length, 1);
  } finally {
    await Promise.resolve();
    for (const exchange of exchanges) send(exchange.response, { 'fixture-single-flight': { input_cost_per_token: 1e-6 } });
    await Promise.all([first, second]);
  }
});

test('pricing response bytes are capped before JSON parsing and the previous catalog survives failure', async context => {
  const exchanges = fakeNetwork(context);
  const previous = getPricingLastFetched();
  const responsePromise = fetchLatestPricing();
  const assertion = assert.rejects(responsePromise, /size limit/i);
  await Promise.resolve();
  const exchange = exchanges[0];
  exchange.response.emit('data', ' '.repeat(17 * 1024 * 1024));
  send(exchange.response, { 'fixture-oversized': { input_cost_per_token: 1 } });
  await assertion;
  assert.equal(exchange.request.destroyed, true);
  assert.equal(exchange.response.destroyed, true);
  assert.equal(getPricingLastFetched(), previous);
});

test('a successful refresh atomically replaces runtime prices rather than accumulating stale models', async context => {
  const exchanges = fakeNetwork(context);
  const first = fetchLatestPricing();
  await Promise.resolve();
  send(exchanges[0].response, { 'fixture-stale-price': { input_cost_per_token: 7e-6 } });
  await first;
  assert.equal(getModelPricing('fixture-stale-price')!.input_cost_per_token, 7e-6);
  const second = fetchLatestPricing();
  await Promise.resolve();
  send(exchanges[1].response, { 'fixture-new-price': { input_cost_per_token: 8e-6 } });
  await second;
  assert.equal(getModelPricing('fixture-new-price')!.input_cost_per_token, 8e-6);
  assert.equal(getModelPricing('fixture-stale-price')!.input_cost_per_token, 3e-6);
  assert.equal(getExactModelPricing('fixture-new-price'), null);
});

test('catalog model count has a hard limit and failed refreshes do not partially install prices', async context => {
  const exchanges = fakeNetwork(context);
  const previous = getPricingLastFetched();
  const responsePromise = fetchLatestPricing();
  const assertion = assert.rejects(responsePromise, /model limit/i);
  await Promise.resolve();
  send(exchanges[0].response, Object.fromEntries(Array.from({ length: 16_385 }, (_, index) => [
    `fixture-catalog-${index}`, { input_cost_per_token: 1e-6 },
  ])));
  await assertion;
  assert.equal(getPricingLastFetched(), previous);
  assert.equal(getModelPricing('fixture-new-price')!.input_cost_per_token, 8e-6);
});

test('unsafe labels and negative/non-finite prices do not become runtime overrides', async context => {
  const exchanges = fakeNetwork(context);
  const responsePromise = fetchLatestPricing();
  await Promise.resolve();
  const json = Object.create(null);
  json['fixture-safe-price'] = { input_cost_per_token: 2e-6, output_cost_per_token: 4e-6 };
  json['fixture-negative-price'] = { input_cost_per_token: -1 };
  json['fixture-negative-cache'] = { input_cost_per_token: 1e-6, cache_read_input_token_cost: -2 };
  json['fixture-bad-output'] = { input_cost_per_token: 1e-6, output_cost_per_token: 'not a rate' };
  json.constructor = { input_cost_per_token: 99 };
  json.__proto__ = { input_cost_per_token: 99 };
  json['private-fixture-' + 'x'.repeat(10_000)] = { input_cost_per_token: 1e-6 };
  send(exchanges[0].response, json);
  assert.equal((await responsePromise).updated, 1);
  assert.equal(getModelPricing('fixture-safe-price')!.input_cost_per_token, 2e-6);
  assert.equal(getModelPricing('constructor')!.input_cost_per_token, 3e-6);
});

test('a pricing response stream error rejects instead of installing partial data', async context => {
  const exchanges = fakeNetwork(context);
  const responsePromise = fetchLatestPricing();
  const assertion = assert.rejects(responsePromise, /stream failed/);
  await Promise.resolve();
  exchanges[0].response.emit('error', new Error('stream failed'));
  send(exchanges[0].response, { 'fixture-after-error': { input_cost_per_token: 99 } });
  await assertion;
});

test('pricing fetch has a wall-clock deadline, not only an idle-socket timeout', async context => {
  const exchanges = fakeNetwork(context);
  let expire: (() => void) | undefined;
  context.mock.method(global, 'setTimeout', (callback: () => void, milliseconds: number) => {
    if (milliseconds === 15_000) expire = callback;
    return { unref() {} };
  });
  context.mock.method(global, 'clearTimeout', () => {});
  const responsePromise = fetchLatestPricing();
  void responsePromise.catch(() => {});
  try {
    assert.ok(expire, 'a trickling response must not bypass the 15s deadline');
    expire!();
    await assert.rejects(responsePromise, /timed out/i);
    assert.equal(exchanges[0].request.destroyed, true);
  } finally {
    await Promise.resolve();
    send(exchanges[0].response, { 'fixture-timeout-cleanup': { input_cost_per_token: 1e-6 } });
    await responsePromise.catch(() => {});
  }
});
