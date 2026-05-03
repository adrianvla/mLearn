/**
 * Plugins Diagnostics Suite
 */

import fs from 'fs';
import path from 'path';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { getUserDataPath } from '../../../utils/platform';
import { skipTest } from '../utils';

registerDiagnosticSuite({
  name: SUITE_NAMES.PLUGINS,
  tests: [
    {
      name: 'plugin-manager-init',
      timeoutMs: 5_000,
      fn() {
        const pluginsDir = path.join(getUserDataPath(), 'plugins');
        if (!fs.existsSync(pluginsDir)) {
          // No plugins installed is fine — just verify directory is creatable
          try {
            fs.mkdirSync(pluginsDir, { recursive: true });
          } catch (e) {
            throw new Error(`Cannot create plugins directory: ${e}`);
          }
          return;
        }
        fs.readdirSync(pluginsDir);
        // Verify entries are readable
      },
    },
    {
      name: 'plugin-registry-readable',
      timeoutMs: 5_000,
      fn() {
        const regPath = path.join(getUserDataPath(), 'plugin_registry.json');
        if (!fs.existsSync(regPath)) {
          skipTest('No plugin registry file');
        }
        const data = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
        if (typeof data !== 'object') {
          throw new Error('Plugin registry is not valid JSON');
        }
      },
    },
    {
      name: 'plugin-kv-rw',
      timeoutMs: 5_000,
      async fn() {
        const kvPath = path.join(getUserDataPath(), 'plugin_kv.json');
        const backupPath = path.join(getUserDataPath(), 'plugin_kv.json.diag_backup');
        let original: string | null = null;
        if (fs.existsSync(kvPath)) {
          original = fs.readFileSync(kvPath, 'utf-8');
          fs.writeFileSync(backupPath, original);
        }
        const testData: Record<string, unknown> = { __diag_plugin_test: { value: 'hello', updated: Date.now() } };
        fs.writeFileSync(kvPath, JSON.stringify(testData));
        const reloaded = JSON.parse(fs.readFileSync(kvPath, 'utf-8'));
        if (reloaded.__diag_plugin_test?.value !== 'hello') {
          throw new Error('Plugin KV round-trip failed');
        }
        if (original !== null) {
          fs.writeFileSync(kvPath, original);
          fs.unlinkSync(backupPath);
        } else {
          fs.unlinkSync(kvPath);
        }
      },
    },
  ],
});
