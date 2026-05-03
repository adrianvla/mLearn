/**
 * Browser Extension Diagnostics Suite
 */

import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { detectBrowsers } from '../../browserDetection';
import { isExtensionInstalled } from '../../extensionInstaller';
import { skipTest } from '../utils';

registerDiagnosticSuite({
  name: SUITE_NAMES.BROWSER_EXTENSION,
  tests: [
    {
      name: 'browser-detection',
      timeoutMs: 10_000,
      async fn() {
        const browsers = await detectBrowsers();
        if (!Array.isArray(browsers)) {
          throw new Error('Browser detection returned unexpected format');
        }
        // It's okay if no browsers are detected (e.g., fresh VM)
      },
    },
    {
      name: 'extension-installed',
      timeoutMs: 5_000,
      async fn() {
        const browsers = await detectBrowsers();
        if (browsers.length === 0) {
          skipTest('No browsers detected');
        }
        const browser = browsers[0];
        const result = await isExtensionInstalled(browser);
        if (typeof result !== 'boolean') {
          throw new Error('Extension check returned unexpected format');
        }
        // Either true or false is fine; we just verify the check works
      },
    },
  ],
});
