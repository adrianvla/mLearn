import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, installPackage } from './fixture';
import { createRuntimeBrowserClient } from '../../../tools/runtime-browser-client';

// PLAN M06 Review (real runtime part): open a real image collection, navigate pages and a spread,
// magnify original pixels, and report recognition state in place. Recognition itself runs only in
// the desktop host's OCR models and is exercised natively (.mlearn/m01-m11/native); mobile Vision /
// ML Kit verification needs simulators and is logged as a user-blocked gap.
test('M06 image collection pages, spread, source-pixel magnifier and recognition state', async ({ page, nativeCore }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const client = createRuntimeBrowserClient(nativeCore);
  const directory = path.join(await mkdtemp(path.join(tmpdir(), 'mlearn-m06-')), 'Rooftop');
  try {
    await mkdir(directory);
    const pages = [];
    for (const index of [1, 2, 3]) {
      const target = path.join(directory, `${index}.png`);
      await copyFile(path.join(homedir(), 'mlearn-test-corpus', 'loadable', `${index}.png`), target);
      pages.push(target);
    }
    await installPackage(page, /Japanese/);
    const opened = await client.importImages(pages, 'Rooftop', 'org.mlearn.japanese');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/reader?id=${opened.source.id}`);

    // The collection opens on its first page with a named source and a page rail.
    await expect(page.getByTestId('reader-title')).toHaveText(/Rooftop/);
    await expect(page.getByTestId('reader-position')).toHaveText('1/3');
    await expect(page.getByRole('button', { name: /^Page 2/ })).toBeVisible();
    const status = page.getByTestId('reader-status');
    // Without installed recognition models the page stays shown and the state is plain.
    await expect(status).not.toContainText('This page couldn’t be shown.');
    expect(await status.innerText()).not.toMatch(/onnx|paddle|manga|model id|org\.mlearn|\.png|bytes/i);
    await page.screenshot({ path: info.outputPath('m06-first-page.png') });

    // Spread layout and page turns keep the source position.
    await page.getByRole('combobox', { name: /^Page layout:/ }).click();
    await page.getByRole('option', { name: 'Double Page', exact: true }).click();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.getByTestId('reader-position')).not.toHaveText('1/3');
    await expect(status).not.toContainText('This page couldn’t be shown.');
    await page.screenshot({ path: info.outputPath('m06-spread.png') });

    // The held magnifier samples the original image pixels under the pointer.
    const image = page.getByTestId(/^reader-image-/).first();
    const box = await image.boundingBox();
    if (!box) throw new Error('The page image has no layout');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.keyboard.down('z');
    const lens = page.getByRole('img', { name: 'Source image magnifier', exact: true });
    await expect(lens).toBeVisible();
    await expect(lens).toHaveAttribute('aria-busy', 'false');
    await page.screenshot({ path: info.outputPath('m06-magnifier.png') });
    await page.keyboard.up('z');
    await expect(lens).toHaveCount(0);

    // Leaving through Home and reopening returns to the same spread.
    const position = await page.getByTestId('reader-position').innerText();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: /Rooftop/ }).first().click();
    await expect(page.getByTestId('reader-position')).toHaveText(position);
  } finally {
    await rm(path.dirname(directory), { recursive: true, force: true });
  }
});
