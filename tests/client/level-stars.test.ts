import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import ts from 'typescript';
import {
  LEVEL_STARS, LEVEL_STAR_PALETTE, levelStarsRank,
  levelStarsAvailableWidth, levelStarsCollapsed,
} from '../../packages/ui/src/LevelStars.types';

test('display ranks are integral and bounded to seven', () => {
  // Given package ranks and invalid boundary inputs, when preparing display rank,
  // then the result never requests a negative, fractional or unbounded star row.
  const ranks = [-Infinity, -1, 0, NaN, 1, 3.9, 7, 8, Infinity];
  assert.deepEqual(ranks.map(levelStarsRank), [0, 0, 0, 0, 1, 3, 7, 7, 7]);
});

test('auto collapse uses exactly half each same-line gap after margin', () => {
  // Given the v2 fixture: a ten-pixel word with 32-pixel gaps on both sides.
  const layout = {
    word: { x: 10, y: 0, width: 10, height: 10 },
    previous: { x: -27, y: 0, width: 5, height: 10 },
    next: { x: 52, y: 0, width: 10, height: 10 },
  };
  // When measuring with and without the eight-pixel clearance.
  const ordinary = levelStarsAvailableWidth(layout);
  const spaced = levelStarsAvailableWidth(layout, 8);
  // Then 40 pixels fit only without the clearance; equality must also fit.
  assert.equal(ordinary, 42);
  assert.equal(spaced, 34);
  assert.equal(levelStarsCollapsed('auto', 40, ordinary), false);
  assert.equal(levelStarsCollapsed('auto', 40, spaced), true);
  assert.equal(levelStarsCollapsed('auto', 34, spaced), false);
});

test('missing and off-line siblings are unbounded while overlapping gaps clamp to zero', () => {
  // Given a word with neighbors at the exact half-height line threshold.
  const word = { x: 10, y: 0, width: 10, height: 10 };
  const previous = { x: 9, y: 5, width: 5, height: 10 };
  const next = { x: 17, y: 5, width: 10, height: 10 };
  // When siblings overlap, move beyond that threshold, or are absent.
  const overlap = levelStarsAvailableWidth({ word, previous, next }, 8);
  const wrapped = levelStarsAvailableWidth({ word, previous, next: { ...next, y: 5.01 } }, 8);
  const edge = levelStarsAvailableWidth({ word, previous });
  // Then overlap adds no space, and either unbounded side preserves v2 behavior.
  assert.equal(overlap, 10);
  assert.equal(wrapped, Infinity);
  assert.equal(edge, Infinity);
});

test('collapse modes and native word-width fallback use the selected star size', () => {
  // Given the three reference sizes and an exact-width native parent.
  for (const size of ['small', 'medium', 'large'] as const) {
    const needed = 4 * LEVEL_STARS.sizes[size].star;
    // When applying each policy, then only auto depends on available width.
    assert.equal(levelStarsCollapsed('auto', needed, needed), false);
    assert.equal(levelStarsCollapsed('auto', needed, needed - 1), true);
    assert.equal(levelStarsCollapsed('always', needed, Infinity), true);
    assert.equal(levelStarsCollapsed('never', needed, 0), false);
  }
});

/** Transpile just the two owners in memory; no server, app build or output files. */
async function rendererModules(): Promise<Record<string, string>> {
  const require = createRequire(resolve('package.json'));
  const modules: Record<string, string> = {};
  for (const [name, packageName, file] of [
    ['react', 'react', 'react.production.js'],
    ['react/jsx-runtime', 'react', 'react-jsx-runtime.production.js'],
    ['scheduler', 'scheduler', 'scheduler.production.js'],
    ['react-dom', 'react-dom', 'react-dom.production.js'],
    ['react-dom/client', 'react-dom', 'react-dom-client.production.js'],
  ]) {
    modules[name] = await readFile(join(dirname(require.resolve(`${packageName}/package.json`)), 'cjs', file), 'utf8');
  }
  for (const file of ['LevelStars.types.ts', 'LevelStars.web.tsx']) {
    const source = await readFile(resolve('packages/ui/src', file), 'utf8');
    modules[`./${file.replace(/\.tsx?$/, '')}`] = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
  }
  return modules;
}

function rendererScript(modules: Readonly<Record<string, string>>): string {
  return `window.starTest = (() => {
    const sources = ${JSON.stringify(modules)}, cache = new Map(), roots = new Map();
    function load(name) {
      if (cache.has(name)) return cache.get(name).exports;
      const module = { exports: {} };
      cache.set(name, module);
      new Function('require', 'module', 'exports', sources[name])(load, module, module.exports);
      return module.exports;
    }
    const React = load('react'), { createRoot } = load('react-dom/client');
    const { flushSync } = load('react-dom'), { LevelStars } = load('./LevelStars.web');
    const counts = { created: 0, observed: new Set(), observeCalls: 0, unobserved: 0, disconnected: 0 };
    const NativeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback) { super(callback); counts.created++; }
      observe(element, options) { counts.observed.add(element); counts.observeCalls++; super.observe(element, options); }
      unobserve(element) { counts.observed.delete(element); counts.unobserved++; super.unobserve(element); }
      disconnect() { counts.observed.clear(); counts.disconnected++; super.disconnect(); }
    };
    return {
      counts,
      render(id, props) {
        if (!roots.has(id)) roots.set(id, createRoot(document.getElementById(id)));
        flushSync(() => roots.get(id).render(React.createElement(LevelStars, props)));
      },
      unmount(id) {
        flushSync(() => roots.get(id).unmount());
        roots.delete(id);
      }
    };
  })();`;
}

test('real renderer preserves rank, filter palette, measured collapse and shared observer cleanup',
  { timeout: 30_000 }, async () => {
    // Given the real React renderer and ResizeObserver, not a DOM/layout mock.
    const modules = await rendererModules();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<style>
        #line { display:flex; gap:32px; align-items:flex-start }
        #line > span { display:inline-block; position:relative; width:10px; height:10px; overflow:visible }
        #before { width:5px !important }
      </style><div id="line"><span id="before"></span><span id="word"></span><span id="after"></span></div>`);
      await page.addScriptTag({ content: rendererScript(modules) });
      const render = (props: object) => page.evaluate(`starTest.render('word', ${JSON.stringify(props)})`);

      // When rendering ranks, size variants and forced compact mode.
      for (let rank = 1; rank <= 7; rank++) {
        await render({ rank, label: `rank ${rank}`, collapse: 'never' });
        assert.equal(await page.locator('#word [data-level-star]').count(), rank);
        assert.equal(await page.locator('#word [role="img"]').getAttribute('aria-label'), `rank ${rank}`);
        assert.equal(await page.locator('#word svg').first().getAttribute('width'), '10');
      }
      for (const [size, pixels] of [['small', 6], ['large', 14]] as const) {
        await render({ rank: 4, label: 'rank 4', collapse: 'never', size });
        assert.equal(await page.locator('#word svg').first().getAttribute('width'), String(pixels));
      }
      await render({ rank: 9, label: 'bounded rank', collapse: 'always' });
      assert.equal(await page.locator('#word [data-level-star]').count(), 1);
      assert.equal(await page.locator('#word [data-level-stars-count]').textContent(), '7');
      await render({ rank: 0, label: 'no rank' });
      assert.equal(await page.locator('#word [data-level-stars]').count(), 0);

      // Then native fills match the actual web filter's opaque red interior.
      const colors = await page.evaluate(filters => {
        const context = document.createElement('canvas').getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        return filters.map(filter => {
          context.clearRect(0, 0, 1, 1);
          context.filter = filter;
          context.fillStyle = '#f00';
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
        });
      }, LEVEL_STAR_PALETTE.map(palette => palette.filter));
      for (let index = 0; index < colors.length; index++) {
        const expected = LEVEL_STAR_PALETTE[index].color;
        assert.ok(colors[index].every((channel, component) =>
          Math.abs(channel - Number.parseInt(expected.slice(1 + component * 2, 3 + component * 2), 16)) <= 1));
      }

      // Given two rows sharing the same word/sibling observations.
      await page.evaluate(`starTest.unmount('word');
        starTest.render('before', { rank:2, label:'rank 2' });
        starTest.render('word', { rank:4, label:'rank 4' });`);
      assert.equal(await page.locator('#word [data-level-stars-count]').textContent(), '4');
      assert.deepEqual(await page.evaluate(`({
        created:starTest.counts.created, observed:starTest.counts.observed.size,
        observeCalls:starTest.counts.observeCalls
      })`), { created: 1, observed: 3, observeCalls: 3 });

      // When the actual word grows to the exact fit threshold, subscribe first.
      await page.evaluate(`new Promise((resolve, reject) => {
        const row = document.querySelector('#word [data-level-stars]');
        const observer = new MutationObserver(() => {
          if (row.dataset.collapsed === 'false') {
            clearTimeout(deadline); observer.disconnect(); resolve();
          }
        });
        const deadline = setTimeout(() => {
          observer.disconnect(); reject(new Error('Resize did not expand stars'));
        }, 10000);
        observer.observe(row, { attributes:true, attributeFilter:['data-collapsed'] });
        document.getElementById('word').style.width = '16px';
      })`);
      // Then measured auto mode expands, and removing one row retains shared refs.
      assert.equal(await page.locator('#word [data-level-star]').count(), 4);
      await page.evaluate(`starTest.unmount('before')`);
      assert.equal(await page.evaluate('starTest.counts.unobserved'), 0);
      await page.evaluate(`starTest.unmount('word')`);
      assert.deepEqual(await page.evaluate(`({
        observed:starTest.counts.observed.size, unobserved:starTest.counts.unobserved,
        disconnected:starTest.counts.disconnected
      })`), { observed: 0, unobserved: 3, disconnected: 1 });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
