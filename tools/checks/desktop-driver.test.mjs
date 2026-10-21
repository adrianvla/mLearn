import test from 'node:test';
import assert from 'node:assert/strict';
import { clickControl, WebDriverError } from '../../tests/desktop/webdriver.mjs';

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
