/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

test('tile words activate from their empty space, restore keyboard focus and keep annotations attached to text', { timeout: 30_000 }, async () => {
  const bundle = await build({
    stdin: { loader: 'tsx', resolveDir: resolve('.'), contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { InlineWordElement } from './packages/ui/src/InlineWordElement.web';
      function App() {
        const [anchor, setAnchor] = useState(null);
        return <>
          {['𠮷', 'a'.repeat(80)].map(text => <div key={text} style={{width:96,fontSize:24}}>
            <InlineWordElement text={text} layout="tile" status="unavailable"
              color="#111" knownColor="#080" onActivate={setAnchor}
              level={{rank:7,label:'Seven',attribution:'Fixture',scaleId:'p:scale',level:'seven'}} />
          </div>)}
          {anchor ? <button onClick={() => { anchor.restoreFocus(); setAnchor(null); }}>Close</button> : null}
        </>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  assert.ok(bundle.outputFiles[0]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 600 } });
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const word = page.getByRole('button', { name: '𠮷: unavailable', exact: true });
    const long = page.getByRole('button', { name: `${'a'.repeat(80)}: unavailable`, exact: true });
    await expect(word).toBeVisible();
    const bounds = await word.boundingBox();
    assert.ok(bounds);
    assert.equal(bounds.width, 96);
    assert.ok(bounds.height >= 44);
    await word.click({ position: { x: 4, y: 4 } });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(word).toBeFocused();
    await word.press('Enter');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(word).toBeFocused();
    const annotation = word.locator('[data-level-stars]');
    const glyph = await annotation.evaluate(element => element.parentElement?.getBoundingClientRect().width);
    assert.ok(glyph !== undefined && glyph < 40, 'The star measurement belongs to the glyph, not its tile');
    const overflow = await long.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
    assert.ok(overflow.content <= overflow.width, 'Long entries stay inside their tile');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  } finally {
    await browser.close();
  }
});
