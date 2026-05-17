/**
 * OCR Diagnostics Suite
 */

import fs from 'fs';
import path from 'path';
import { PYTHON_BACKEND_PORT, DEFAULT_CLOUD_API_URL } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { httpGet, skipTest } from '../utils';
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
  name: SUITE_NAMES.OCR,
  tests: [
    {
      name: 'local-ocr-ready',
      timeoutMs: 10_000,
      async fn() {
        const { status } = await httpGet(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/health`);
        if (status !== 200) {
          throw new Error('Python backend not reachable');
        }
        // OCR readiness is implicit if backend is up and has OCR dependencies
        // The backend would fail to start if OCR deps were missing and required
      },
    },
    {
      name: 'local-ocr-test-image',
      timeoutMs: 30_000,
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
              timeout: 30_000,
            },
            (res: any) => {
              let data = '';
              res.on('data', (chunk: Buffer) => { data += chunk; });
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
            },
          );
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('OCR request timed out')); });
          req.write(body);
          req.end();
        });

        if (result.status !== 200) {
          throw new Error(`Local OCR returned status ${result.status}`);
        }
        const data = JSON.parse(result.body);
        if (!Array.isArray(data) && !data.results) {
          throw new Error('Local OCR returned unexpected format');
        }
      },
    },
    {
      name: 'cloud-ocr-reachable',
      timeoutMs: 15_000,
      async fn() {
        const { status } = await httpGet(`${DEFAULT_CLOUD_API_URL}/api/health`, 15_000);
        if (status !== 200) {
          throw new Error(`Cloud API returned status ${status}`);
        }
      },
    },
  ],
});
