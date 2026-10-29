import test from 'node:test';
import assert from 'node:assert/strict';
import { clickControl, WebDriverError, WebDriverTransportError, rpc } from '../../tests/desktop/webdriver.mjs';

test('a transport timeout retains its request identity and original cause without replay', async t => {
  const timeout = new DOMException('Fixture timeout', 'TimeoutError');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, method: options.method });
    throw timeout;
  });
  await assert.rejects(rpc('POST', '/session/fixture/execute/async', { script: 'private fixture' }), error => {
    assert.ok(error instanceof WebDriverTransportError);
    assert.equal(error.method, 'POST');
    assert.equal(error.endpoint, '/session/fixture/execute/async');
    assert.equal(error.cause, timeout);
    return true;
  });
  assert.deepEqual(requests, [{ url: 'http://127.0.0.1:4444/session/fixture/execute/async', method: 'POST' }]);
});

test('a response-body timeout retains its request identity and original cause without replay', async t => {
  const timeout = new DOMException('Fixture body timeout', 'TimeoutError');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, method: options.method });
    return new Response(new ReadableStream({
      start(controller) { controller.error(timeout); },
    }));
  });
  await assert.rejects(rpc('POST', '/session/fixture/execute/async', { script: 'private fixture' }), error => {
    assert.ok(error instanceof WebDriverTransportError);
    assert.equal(error.method, 'POST');
    assert.equal(error.endpoint, '/session/fixture/execute/async');
    assert.equal(error.cause, timeout);
    return true;
  });
  assert.deepEqual(requests, [{ url: 'http://127.0.0.1:4444/session/fixture/execute/async', method: 'POST' }]);
});

test('a native protocol rejection remains distinct from a transport failure', async t => {
  const result = { value: { error: 'element click intercepted' } };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(result), { status: 400 }));
  await assert.rejects(rpc('POST', '/session/fixture/element/control/click', {}), error =>
    error instanceof WebDriverError && error.code === 'element click intercepted');
});

test('a replaced control is reacquired before dispatching exactly one native click', async () => {
  let current = 'old';
  const activated = [];
  const rpc = async (_method, endpoint) => {
    if (endpoint.endsWith('/execute/async'))
      return { 'element-6066-11e4-a52e-4f735466cecf': current };
    if (endpoint.endsWith('/element/old/click')) {
      current = 'replacement';
      throw new WebDriverError({ value: { error: 'stale element reference' } });
    }
    assert.equal(endpoint, '/session/fixture/element/replacement/click');
    activated.push(current);
  };
  await clickControl(rpc, 'fixture', 'Control');
  assert.deepEqual(activated, ['replacement']);
});

test('an intercepted click is not replayed', async () => {
  const blocked = new WebDriverError({ value: { error: 'element click intercepted' } });
  let intercepted = false;
  const rpc = async (_method, endpoint) => {
    if (endpoint.endsWith('/execute/async'))
      return { 'element-6066-11e4-a52e-4f735466cecf': 'control' };
    if (!intercepted) {
      intercepted = true;
      throw blocked;
    }
  };
  await assert.rejects(clickControl(rpc, 'fixture', 'Control'), error => error === blocked);
});

test('a stale handle at the readiness deadline is not replayed', async t => {
  let now = 0;
  let expiresAt;
  t.mock.method(Date, 'now', () => now);
  const stale = new WebDriverError({ value: { error: 'stale element reference' } });
  const rpc = async (_method, endpoint, body) => {
    if (now > 0) throw new Error('Expired input was replayed');
    if (endpoint.endsWith('/execute/async')) {
      expiresAt = body.args[1];
      return { 'element-6066-11e4-a52e-4f735466cecf': 'control' };
    }
    now = expiresAt;
    throw stale;
  };
  await assert.rejects(clickControl(rpc, 'fixture', 'Control'), error => error === stale);
});
