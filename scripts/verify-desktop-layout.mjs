import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Browser geometry checks complement the component tests: happy-dom cannot
// detect CSS specificity, hidden-face height, or real flexbox overflow.
// These fixtures use production styles and DOM contracts, not learner data.
const root = process.cwd();
const output = process.env.UI_EVIDENCE_DIR || '/tmp/mlearn-ui-evidence';
const playwright = process.env.PLAYWRIGHT_PACKAGE_DIR
  ? await import(pathToFileURL(path.join(process.env.PLAYWRIGHT_PACKAGE_DIR, 'index.mjs')).href)
  : await import('playwright');
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    const content = await readFile(file);
    response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const results = [];
const styles = [
  'src/renderer/styles/index.css',
  'src/renderer/components/flashcard/FlashcardDisplay.css',
  'src/renderer/components/common/StudyEncounter/StudyEncounter.css',
  'src/renderer/components/flashcard/FlashcardReview.css',
  'src/renderer/windows/main/routes/components/ReaderNav.css',
  'src/renderer/windows/main/ApplicationShell.css',
  'src/renderer/windows/levelStudy/LevelStudy.css',
];
async function pageFor(html, viewport) {
  const page = await browser.newPage({ viewport });
  await page.setContent(`<!doctype html><html><head>${styles.map(file => `<link rel="stylesheet" href="${origin}/${file}">`).join('')}
    <style>html,body{margin:0;height:100%}body{--window-controls-inline-start-inset:78px;--window-controls-block-start-inset:28px}</style>
    </head><body>${html}</body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}
async function check(name, task) {
  try { const detail = await task(); results.push({ name, status: 'pass', detail }); }
  catch (error) { results.push({ name, status: 'fail', error: error.message }); }
}
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 600 }, { width: 390, height: 700 }]) {
    await check(`flashcard reveal keeps its hidden face collapsed at ${viewport.width}x${viewport.height}`, async () => {
      const page = await pageFor(`<div class="flashcard-review-container"><div class="flashcard-review-header">Review controls</div>
        <div class="flashcard-review-content"><section class="study-encounter flashcard-study-encounter">
          <div class="flashcard-container"><div class="flashcard-card"><div class="flashcard-face flashcard-front">Prompt</div>
            <div class="flashcard-face flashcard-back flashcard-face--hidden">Answer</div></div></div>
          <button id="reveal">Reveal answer</button></section></div></div>`, viewport);
      try {
        const before = await page.locator('.flashcard-front').boundingBox();
        const hiddenBack = await page.locator('.flashcard-back').evaluate(element => element.getBoundingClientRect().height);
        await page.locator('#reveal').evaluate(button => button.addEventListener('click', () => {
          document.querySelector('.flashcard-front').classList.add('flashcard-face--hidden');
          document.querySelector('.flashcard-back').classList.remove('flashcard-face--hidden');
          button.textContent = 'Rate answer';
        }));
        await page.locator('#reveal').click();
        const after = await page.locator('.flashcard-back').boundingBox();
        const hiddenFront = await page.locator('.flashcard-front').evaluate(element => element.getBoundingClientRect().height);
        const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        await page.screenshot({ path: path.join(output, `review-${viewport.width}.png`), fullPage: true });
        assert.equal(hiddenBack, 0, 'the unrevealed back face occupies layout space');
        assert.equal(hiddenFront, 0, 'the revealed card leaves its hidden front face occupying layout space');
        assert.ok(Math.abs(after.y - before.y) <= 2, `answer moved ${after.y - before.y}px`);
        assert.equal(horizontalOverflow, false, 'review overflows the viewport horizontally');
        assert.ok(after.width <= viewport.width, 'card exceeds the viewport width');
        return { before, after, hiddenBack, hiddenFront };
      } finally { await page.close(); }
    });
  }
  await check('Reader uses one inline native-control inset, not an additional blank titlebar', async () => {
    const page = await pageFor('<nav class="reader-nav panel"><div class="nav-group"><button>Home</button></div></nav>', { width: 1440, height: 900 });
    try {
      const metrics = await page.locator('.reader-nav').evaluate(element => ({ height: element.getBoundingClientRect().height, paddingTop: parseFloat(getComputedStyle(element).paddingTop) }));
      assert.ok(metrics.paddingTop <= 12, `Reader toolbar top padding is ${metrics.paddingTop}px`);
      assert.ok(metrics.height <= 60, `Reader toolbar height is ${metrics.height}px`);
      return metrics;
    } finally { await page.close(); }
  });
  await check('Plan navigation shares the native titlebar row', async () => {
    const page = await pageFor('<nav class="application-navigation"><button>Plan</button><button>Knowledge</button><button>Progress</button></nav>', { width: 1440, height: 900 });
    try {
      const padding = await page.locator('.application-navigation').evaluate(element => parseFloat(getComputedStyle(element).paddingTop));
      assert.ok(padding <= 12, `Workspace navigation top padding is ${padding}px`);
      return { padding };
    } finally { await page.close(); }
  });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
}
for (const result of results) console.log(JSON.stringify(result));
if (results.some(result => result.status === 'fail')) process.exitCode = 1;
