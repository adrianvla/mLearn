/**
 * OCR Models Diagnostics Suite
 * Actually loads OCR models and runs recognition on a test image.
 */

import fs from 'fs';
import path from 'path';
import { PYTHON_BACKEND_PORT } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { httpPost, httpPostMultipart, skipTest } from '../utils';
import { getAppPath, getResourcePath } from '../../../utils/platform';
import { loadSettings } from '../../settings';
import { buildOcrMultipartBody, buildOcrWarmupUrl } from '../ocrRequestUtils';

function findTestImage(): string | null {
  const candidates = [
    path.join(getAppPath(), 'root-of-app', 'diagnostics-test-ocr.png'),
    path.join(getResourcePath(), 'root-of-app', 'diagnostics-test-ocr.png'),
    path.join(__dirname, '..', 'testAssets', 'test-ocr-image.png'),
    path.join(getAppPath(), 'dist-electron', 'electron', 'services', 'diagnostics', 'testAssets', 'test-ocr-image.png'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

function getOcrDiagnosticLanguage(): string {
  const language = loadSettings().language?.trim();
  if (!language) {
    skipTest('No learning language configured');
  }
  return language;
}

registerDiagnosticSuite({
  name: SUITE_NAMES.OCR_MODELS,
  tests: [
    {
      name: 'ocr-warmup',
      timeoutMs: 60_000,
      async fn() {
        const language = getOcrDiagnosticLanguage();
        const { status, body } = await httpPost(
          buildOcrWarmupUrl(language),
          {},
          60_000,
        );
        if (status !== 200) {
          throw new Error(`OCR warmup returned status ${status}`);
        }
        const data = JSON.parse(body);
        if (data.status === 'disabled') {
          skipTest('OCR is disabled in backend config');
        }
      },
    },
    {
      name: 'ocr-turbo-image',
      timeoutMs: 60_000,
      async fn() {
        const testImage = findTestImage();
        if (!testImage) {
          skipTest('Test OCR image not found');
        }
        const imageBuffer = fs.readFileSync(testImage);
        const boundary = `----mlearn-diag-${Date.now()}`;
        const body = buildOcrMultipartBody({
          boundary,
          imageBuffer,
          language: getOcrDiagnosticLanguage(),
          turbo: true,
        });
        const result = await httpPostMultipart(
          `http://127.0.0.1:${PYTHON_BACKEND_PORT}/ocr`,
          body,
          boundary,
          60_000,
        );

        if (result.status !== 200) {
          throw new Error(`OCR turbo returned status ${result.status}`);
        }
        const data = JSON.parse(result.body);
        if (!data.results || !Array.isArray(data.results)) {
          throw new Error('OCR turbo returned unexpected format');
        }
      },
    },
    {
      name: 'ocr-accurate-image',
      timeoutMs: 120_000,
      async fn() {
        const testImage = findTestImage();
        if (!testImage) {
          skipTest('Test OCR image not found');
        }
        const imageBuffer = fs.readFileSync(testImage);
        const boundary = `----mlearn-diag-${Date.now()}`;
        const body = buildOcrMultipartBody({
          boundary,
          imageBuffer,
          language: getOcrDiagnosticLanguage(),
          turbo: false,
        });
        const result = await httpPostMultipart(
          `http://127.0.0.1:${PYTHON_BACKEND_PORT}/ocr`,
          body,
          boundary,
          120_000,
        );

        if (result.status !== 200) {
          throw new Error(`OCR accurate returned status ${result.status}`);
        }
        const data = JSON.parse(result.body);
        if (!data.results || !Array.isArray(data.results)) {
          throw new Error('OCR accurate returned unexpected format');
        }
      },
    },
  ],
});
