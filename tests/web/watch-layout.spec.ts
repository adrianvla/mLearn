/// <reference types="node" />
import { expect } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from './messenger-native-fixture';

for (const width of [1200, 500, 320] as const) {
test(`focused live word card fits the ${width}px overlay when its close control appears`, async ({ page, nativeCore }, info) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-watch-layout-'));
  try {
    // This fixture exercises real source analysis and layout, not media decoding.
    // The browser transport explicitly reports native media as unsupported.
    const video = path.join(directory, 'words.mp4');
    const subtitles = path.join(directory, 'words.srt');
    await writeFile(video, 'authored source identity for the layout fixture');
    await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:10,000\ncat dog book house\n');
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const opened = JSON.parse(await nativeCore.invoke('runtime_execute', {
      request: JSON.stringify({ type: 'open_source', path: video, packageId: 'org.mlearn.english' }),
    }));
    expect(opened).toMatchObject({ type: 'source' });
    const sourceId = opened.window.source.id;
    const attached = JSON.parse(await nativeCore.invoke('runtime_execute', {
      request: JSON.stringify({ type: 'attach_subtitles', sourceId, path: subtitles }),
    }));
    expect(attached).toMatchObject({ type: 'source' });
    await page.goto(`/watch?id=${encodeURIComponent(sourceId)}`);
    const translator = page.getByRole('button', { name: 'Live word translator', exact: true });
    await expect(translator).toBeEnabled();
    await page.getByRole('button', { name: 'Subtitle synchronization', exact: true }).click();
    const synchronization = page.getByRole('button', { name: /^Subtitle offset:/ });
    await expect(synchronization).toBeVisible();
    await page.screenshot({ path: info.outputPath('standalone-synchronization.png') });
    const sourceOverlays = await page.getByTestId('watch-source-overlays').boundingBox();
    const nextCue = await page.getByRole('button', { name: 'Align next subtitle', exact: true }).boundingBox();
    if (!sourceOverlays || !nextCue) throw new Error('Synchronization overlay is not laid out');
    const cueGlyph = await page.getByRole('button', { name: 'Align next subtitle', exact: true }).locator('svg').boundingBox();
    if (!cueGlyph) throw new Error('Synchronization glyph is not laid out');
    // The reference's shared icon-button rule overrides SubtitleSync's
    // nominal 30px SVG to 20px. Preserve the larger interactive target.
    expect(cueGlyph.width).toBe(20);
    expect(cueGlyph.height).toBe(20);
    expect(nextCue.width).toBeGreaterThanOrEqual(40);
    expect(nextCue.height).toBeGreaterThanOrEqual(40);
    const dismiss = page.getByRole('button', { name: 'Hide synchronization', exact: true, includeHidden: true });
    // MediaOverlay's close wrapper and panel are the same owners in both
    // disclosure states. A one-pixel header divider precedes the 220px body.
    const panel = await dismiss.locator('..').locator('..').boundingBox();
    if (!panel) throw new Error('Synchronization panel is not laid out');
    expect(panel.width).toBe(221);
    await synchronization.focus();
    await expect(dismiss).toBeEnabled();
    const closeBounds = await dismiss.boundingBox();
    const previousCue = await page.getByRole('button', { name: 'Align previous subtitle', exact: true }).boundingBox();
    const focusedNext = await page.getByRole('button', { name: 'Align next subtitle', exact: true }).boundingBox();
    if (!closeBounds || !previousCue || !focusedNext) throw new Error('Focused synchronization controls are not laid out');
    expect(closeBounds.width).toBe(40);
    expect(closeBounds.height).toBe(40);
    expect(closeBounds.x + closeBounds.width).toBeLessThanOrEqual(previousCue.x);
    expect(focusedNext.x).toBe(nextCue.x);
    await page.screenshot({ path: info.outputPath('focused-synchronization.png') });
    await dismiss.hover();
    await page.getByRole('button', { name: 'Home', exact: true }).focus();
    await page.screenshot({ path: info.outputPath('hovered-synchronization.png') });
    // Without live cards, flex row's default start alignment must not move
    // synchronization away from the source's right edge on wide windows.
    expect(nextCue.x).toBeGreaterThan(sourceOverlays.x + sourceOverlays.width / 2);
    await dismiss.click();
    await expect(synchronization).toBeHidden();
    await translator.click();
    const overlay = page.getByTestId('live-word-cards');
    const cards = overlay.getByRole('button', { name: / · / });
    await expect(cards).toHaveCount(4);
    // OCR readability must not replace the reference's translucent video cards.
    const material = await cards.first().evaluate(node => getComputedStyle(node).backgroundColor);
    const channels = material.match(/\d+(?:\.\d+)?/g)?.map(Number);
    expect(channels).toHaveLength(4);
    expect(channels?.[3]).toBeLessThanOrEqual(0.6);
    const last = cards.last();
    const containedAfterFocus = last.evaluate(element => {
      const overlay = element.closest('[data-testid="live-word-cards"]');
      if (!overlay) throw new Error('Live word overlay is missing');
      let scroller = element.parentElement;
      while (scroller && scroller !== overlay
        && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX))
        scroller = scroller.parentElement;
      if (!scroller || scroller === overlay) throw new Error('Live word scroll owner is missing');
      return new Promise<void>((resolve, reject) => {
        const check = () => {
          const close = overlay.querySelector('[aria-label="Hide live word translator"]');
          const card = element.getBoundingClientRect();
          const bounds = overlay.getBoundingClientRect();
          if (document.activeElement === element && close && close.getAttribute('aria-disabled') !== 'true'
            && !close.hasAttribute('disabled')
            && card.left >= bounds.left && card.right <= bounds.right) {
            cleanup();
            resolve();
          }
        };
        const observer = new ResizeObserver(check);
        const timeout = window.setTimeout(() => {
          cleanup();
          const close = overlay.querySelector('[aria-label="Hide live word translator"]');
          reject(new Error(`Focused card did not fit after close-control layout: ${JSON.stringify({
            focused: document.activeElement === element,
            closeDisabled: close?.getAttribute('aria-disabled'),
            cardRight: element.getBoundingClientRect().right,
            overlayRight: overlay.getBoundingClientRect().right,
          })}`));
        }, 5000);
        const cleanup = () => {
          window.clearTimeout(timeout);
          observer.disconnect();
          overlay.removeEventListener('scroll', check, true);
          overlay.removeEventListener('focusin', check);
        };
        // Close disclosure resizes the actual scroll owner; its corrective
        // scroll is asynchronous. Subscribe before focus, not for a fixed delay.
        observer.observe(scroller);
        observer.observe(element);
        overlay.addEventListener('scroll', check, true);
        overlay.addEventListener('focusin', check);
        check();
      });
    });
    await last.focus();
    await containedAfterFocus;
    await expect(overlay.getByRole('button', { name: 'Hide live word translator', exact: true })).toBeEnabled();
    const container = await overlay.boundingBox();
    const focused = await last.boundingBox();
    if (!container || !focused) throw new Error('Focused live word card is not laid out');
    await page.screenshot({ path: info.outputPath('focused-live-card.png') });
    expect(focused.x).toBeGreaterThanOrEqual(container.x);
    expect(focused.x + focused.width).toBeLessThanOrEqual(container.x + container.width);
    if (width === 1200) {
      await page.getByRole('button', { name: 'Subtitle synchronization', exact: true }).click();
      await page.getByRole('button', { name: 'Transcript', exact: true }).click();
      const sidebar = page.getByRole('dialog', { name: 'Transcript', exact: true });
      await expect(sidebar).toBeVisible();
      await sidebar.getByRole('combobox', { name: /^Sidebar content:/ }).click();
      await page.getByRole('option', { name: 'Vocabulary', exact: true }).click();
      const vocabulary = page.getByRole('dialog', { name: 'Vocabulary', exact: true });
      await expect(vocabulary).toBeVisible();
      await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
      await page.getByTestId('subtitle-window').getByText('cat', { exact: true }).click();
      await expect(page.getByTestId('inspector-panel')).toBeVisible();
      await page.getByRole('button', { name: 'Close Inspector', exact: true }).click();
      await expect(vocabulary).toBeVisible();
      await vocabulary.getByRole('button', { name: 'Capture cat', exact: true }).click();
      // This transport has no native media duration: preserve its real
      // recoverable capture failure rather than manufacturing a saved receipt.
      const captureError = vocabulary.getByRole('alert');
      await expect(captureError).toHaveText('Video duration unavailable; wait for media or reselect it');
      await page.setViewportSize({ width: 390, height: 850 });
      await expect(vocabulary).not.toHaveCSS('height', '850px');
      await expect(captureError).toHaveText('Video duration unavailable; wait for media or reselect it');
      const drawerBounds = await vocabulary.boundingBox();
      if (!drawerBounds) throw new Error('Compact vocabulary drawer is not laid out');
      expect(drawerBounds.x).toBeGreaterThanOrEqual(0);
      expect(drawerBounds.x + drawerBounds.width).toBeLessThanOrEqual(390);
      await page.screenshot({ path: info.outputPath('vocabulary-compact-retained-error.png') });
      await page.setViewportSize({ width, height: 850 });
      await expect(vocabulary).toHaveCSS('height', '850px');
      await expect(captureError).toHaveText('Video duration unavailable; wait for media or reselect it');
      const sidebarBounds = await vocabulary.boundingBox();
      const synchronizationBounds = await page.getByRole('button', { name: /^Subtitle offset:/, includeHidden: true }).boundingBox();
      if (!sidebarBounds || !synchronizationBounds) throw new Error('Vocabulary synchronization is not laid out');
      expect(sidebarBounds.x).toBe(width - 320);
      expect(sidebarBounds.y).toBe(0);
      expect(sidebarBounds.height).toBe(850);
      await page.screenshot({ path: info.outputPath('vocabulary-synchronization.png') });
      expect(synchronizationBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x);
      const offsetInk = await page.getByRole('button', { name: /^Subtitle offset:/ })
        .getByText('0.00', { exact: true }).evaluate(node => getComputedStyle(node).color);
      const contrast = await page.getByRole('button', { name: 'Hide synchronization', exact: true, includeHidden: true })
        .locator('..').locator('..').evaluate((panel, ink) => {
          const material = panel.firstElementChild;
          const surface = panel.closest('[data-testid="dialog-surface"]');
          if (!material || !surface) throw new Error('Synchronization material or sidebar surface is missing');
          const color = (css: string) => {
            const values = css.match(/\d+(?:\.\d+)?/g)?.map(Number);
            const [red, green, blue, alpha = 1] = values ?? [];
            if (red === undefined || green === undefined || blue === undefined)
              throw new Error(`Unsupported computed color: ${css}`);
            return { red, green, blue, alpha };
          };
          const foreground = color(ink);
          const tint = color(getComputedStyle(material).backgroundColor);
          const backdrop = color(getComputedStyle(surface).backgroundColor);
          const luminance = (channels: [number, number, number]) => {
            const linear = (value: number) => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            };
            return linear(channels[0]) * 0.2126 + linear(channels[1]) * 0.7152 + linear(channels[2]) * 0.0722;
          };
          const foregroundLuminance = luminance([foreground.red, foreground.green, foreground.blue]);
          const backgroundLuminance = luminance([
            tint.red * tint.alpha + backdrop.red * (1 - tint.alpha),
            tint.green * tint.alpha + backdrop.green * (1 - tint.alpha),
            tint.blue * tint.alpha + backdrop.blue * (1 - tint.alpha),
          ]);
          return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
            / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
        }, offsetInk);
      // The shared synchronization value uses the large 24px text role.
      expect(contrast).toBeGreaterThanOrEqual(3);
      await page.getByRole('button', { name: /^Subtitle offset:/ }).click();
      const playback = page.getByRole('dialog', { name: 'Playback and subtitles', exact: true });
      await expect(playback).toBeVisible();
      await playback.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(vocabulary).toBeVisible();
      await expect(page.getByRole('button', { name: /^Subtitle offset:/ })).toBeFocused();
      await page.screenshot({ path: info.outputPath('sidebar-playback-return.png') });
      await page.getByRole('button', { name: /^Subtitle offset:/ }).hover();
      await page.getByRole('button', { name: 'Hide synchronization', exact: true }).click();
      await expect(page.getByRole('button', { name: /^Subtitle offset:/ })).toBeHidden();
      await expect(vocabulary).toBeVisible();
      await expect(vocabulary.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
      await page.screenshot({ path: info.outputPath('vocabulary-after-sync-close.png') });
      await vocabulary.getByRole('button', { name: 'Close', exact: true }).click();
      const playbackTrigger = page.getByRole('button', { name: 'Playback options', exact: true });
      await playbackTrigger.click();
      await expect(playback).toBeVisible();
      await playback.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(playbackTrigger).toBeFocused();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
}
