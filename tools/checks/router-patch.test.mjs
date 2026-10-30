import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { patchRouterHistory } from '../patch-expo-router.mjs';

test('the router history repair is pinned and idempotent at the web linking boundary', () => {
  const dependency = new URL('../../node_modules/expo-router/', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', dependency), 'utf8'));
  for (const artifact of ['useLinking.js', 'createMemoryHistory.js']) {
    const shipped = readFileSync(new URL(`build/fork/${artifact}`, dependency), 'utf8');
    assert.equal(patchRouterHistory(version, artifact, shipped), shipped);
    assert.throws(() => patchRouterHistory('unreviewed', artifact, shipped), Error);
    assert.throws(() => patchRouterHistory(version, artifact, `${shipped}\n`), Error);
  }
});

test('external Back updates memory history before a prevented removal goes forward again', { timeout: 5_000 }, async () => {
  const require = createRequire(import.meta.url);
  const { createMemoryHistory } = require('expo-router/build/fork/createMemoryHistory.js');
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const location = { pathname: '/', hash: '' };
  const entries = [];
  let cursor = 0;
  const window = Object.assign(new EventTarget(), {
    location, document: { title: 'Router history test' },
    history: {
      get state() { return entries[cursor]?.state; },
      pushState(state, _title, path) {
        entries.splice(cursor + 1);
        entries.push({ state, path }); cursor = entries.length - 1;
        location.pathname = path;
      },
      replaceState(state, _title, path) {
        entries[cursor] = { state, path }; location.pathname = path;
      },
      go(delta) {
        const next = cursor + delta;
        if (next < 0 || next >= entries.length) return;
        cursor = next; location.pathname = entries[cursor].path;
        queueMicrotask(() => window.dispatchEvent(new Event('popstate')));
      },
    },
  });
  globalThis.window = window;
  globalThis.location = location;
  let unlisten;
  try {
    const history = createMemoryHistory();
    history.replace({ path: '/', state: { route: 'home' } });
    history.push({ path: '/review', state: { route: 'review' } });
    const back = new Promise(resolve => { unlisten = history.listen(resolve); });
    window.history.go(-1);
    await back;
    assert.equal(history.index, 0);
    await history.go(1);
    assert.equal(location.pathname, '/review');
    assert.equal(history.index, 1);
  } finally {
    unlisten?.();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});
