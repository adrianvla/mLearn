/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { initialTheme } from '../../packages/theme/src/theme';

declare global { interface Window {
  __ocrModelNative: { complete?: () => void; installed: boolean; calls: string[] };
} }
async function start(page: Page, offline = false) {
  await page.addInitScript(({ theme, offline }) => {
    const state: Window['__ocrModelNative'] = { installed: offline, calls: [] };
    let status: null | { command: { commandId: string; pluginId: string }; phase: string;
      downloadedBytes: number; totalBytes: number; message: string | null } = null;
    let rejectInstall: ((cause: Error) => void) | undefined;
    let identity = 0;
    const label = 'Native detector and recognizer';
    const response = () => ({ type: 'package_install_status', status });
    Object.assign(window, {
      isTauri: true, __MLEARN_MEDIA_BASE__: 'http://127.0.0.1/fixture-media/', __ocrModelNative: state,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command: string, args: Record<string, unknown>) => {
          state.calls.push(command);
          if (command === 'plugin:event|listen') return 1;
          if (command === 'window_material_active') return false;
          if (command === 'ocr_models') return { models: [{
            profile: { id: 'profile', label, target: 'macos-aarch64',
              runtime: { byteLength: 875274349 }, models: { byteLength: 453587427 } },
            profileRevision: 'a'.repeat(64), installed: state.installed,
            installedRevision: state.installed ? 'a'.repeat(64) : null, reason: state.installed ? null : 'Resources are not installed.',
          }], catalogReason: offline ? 'Catalog unavailable while offline; installed resources retained.' : null, installation: response() };
          if (command === 'ocr_model_install_status') return response();
          if (command === 'install_ocr_model') {
            status = { command: { commandId: `install-${++identity}`, pluginId: 'profile' }, phase: 'downloading',
              downloadedBytes: 800000000, totalBytes: 1328861776, message: null };
            return new Promise<null>((resolve, reject) => {
              rejectInstall = reject;
              state.complete = () => {
                state.installed = true;
                if (!status) throw new Error('No admitted model installation');
                status.phase = 'succeeded'; status.downloadedBytes = status.totalBytes;
                resolve(null);
              };
            });
          }
          if (command === 'cancel_ocr_model_install') {
            if (!status || !rejectInstall) throw new Error('No native install to cancel');
            status.phase = 'cancelled'; status.message = 'Installation cancelled';
            rejectInstall(new Error('Installation cancelled'));
            return response();
          }
          if (command === 'remove_ocr_model') { state.installed = false; return null; }
          if (command === 'test_ocr_model') return { detectedRegions: 2, rawRecognition: ['Native example text'], elapsedMs: 1234 };
          if (command !== 'runtime_execute') throw new Error(`Unexpected native action ${command}`);
          const request = JSON.parse(String(args.request));
          if (request.type === 'snapshot') return JSON.stringify({ type: 'snapshot', snapshot: {
            protocolVersion: 1, revision: 1, theme, installedPlugins: [], availablePlugins: [],
            codePolicy: 'desktop-downloaded', catalogConfigured: true, packageIssues: [],
          } });
          if (request.type === 'current_package_install') return JSON.stringify({ type: 'package_install_status', status: null });
          throw new Error(`Unexpected runtime action ${request.type}`);
        },
      },
    });
  }, { theme: initialTheme, offline });
  await page.goto('/settings?section=languages');
  await expect(page.getByText('OCR models', { exact: true })).toBeVisible();
  await expect(page.getByText('Native detector and recognizer', { exact: true }).first()).toBeVisible();
}

for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'narrow', width: 390, height: 844 }]) {
test(`native OCR models install, cancel, test and remove through their genuine host owner on ${viewport.name}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await start(page);
  const install = page.getByRole('button', { name: 'Install Native detector and recognizer', exact: true });
  await install.click();
  await expect(page.getByRole('progressbar', { name: 'Native OCR model installation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel OCR model installation', exact: true }).click();
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
  await expect(install).toBeEnabled();
  await install.click();
  await expect(page.getByRole('progressbar', { name: 'Native OCR model installation', exact: true })).toBeVisible();
  await page.evaluate(() => {
    if (!window.__ocrModelNative.complete) throw new Error('Native installation was not admitted');
    window.__ocrModelNative.complete();
  });
  await expect(page.getByRole('button', { name: 'Test Native detector and recognizer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test Native detector and recognizer', exact: true }).click();
  await expect(page.getByText('2 detected regions · 1234 ms engine work', { exact: true })).toBeVisible();
  await expect(page.getByText('Native example text', { exact: true })).toBeVisible();
  const removal = await page.getByRole('button', { name: 'Remove Native detector and recognizer', exact: true }).boundingBox();
  expect(removal).not.toBeNull();
  expect(removal!.x + removal!.width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: testInfo.outputPath('native-model-settings.png') });
  await page.getByRole('button', { name: 'Remove Native detector and recognizer', exact: true }).click();
  await page.getByRole('button', { name: 'Remove model resources', exact: true }).click();
  await expect(install).toBeVisible();
  expect(await page.evaluate(() => window.__ocrModelNative.installed)).toBe(false);
});
}

test('installed native OCR models stay usable when catalog discovery fails offline', async ({ page }) => {
  await start(page, true);
  await expect(page.getByRole('alert')).toContainText('Catalog unavailable while offline');
  await page.getByRole('button', { name: 'Test Native detector and recognizer', exact: true }).click();
  await expect(page.getByText('Native example text', { exact: true })).toBeVisible();
});
