/**
 * OCR Models Diagnostics Suite
 * Actually loads OCR models and runs recognition on a test image.
 */

import fs from 'fs';
import path from 'path';
import { PYTHON_BACKEND_PORT } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { httpPost, skipTest } from '../utils';
import { getAppPath, getResourcePath } from '../../../utils/platform';

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

registerDiagnosticSuite({
  name: SUITE_NAMES.OCR_MODELS,
  tests: [
    {
      name: 'ocr-warmup',
      timeoutMs: 60_000,
      async fn() {
        const { status, body } = await httpPost(
          `http://127.0.0.1:${PYTHON_BACKEND_PORT}/ocr/warmup`,
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
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
          imageBuffer,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const http = require('http');
          const req = http.request(
            `http://127.0.0.1:${PYTHON_BACKEND_PORT}/ocr?turbo=1`,
            {
              method: 'POST',
              headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
              },
              timeout: 60_000,
            },
            (res: any) => {
              let data = '';
              res.on('data', (chunk: Buffer) => { data += chunk; });
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
            },
          );
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('OCR turbo request timed out')); });
          req.write(body);
          req.end();
        });

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
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
          imageBuffer,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const http = require('http');
          const req = http.request(
            `http://127.0.0.1:${PYTHON_BACKEND_PORT}/ocr`,
            {
              method: 'POST',
              headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
              },
              timeout: 120_000,
            },
            (res: any) => {
              let data = '';
              res.on('data', (chunk: Buffer) => { data += chunk; });
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
            },
          );
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('OCR accurate request timed out')); });
          req.write(body);
          req.end();
        });

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
