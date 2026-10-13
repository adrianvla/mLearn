import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../../apps/desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

function directives(policy) {
  return new Map(policy.split(';').map(part => part.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...sources]) => [name, sources]));
}

test('runtime-generated styles do not disable CSP or script nonce/hash protection', () => {
  const security = config.app.security;
  assert.deepEqual(security.dangerousDisableAssetCspModification, ['style-src']);
  const policy = directives(security.csp);
  assert.deepEqual(policy.get('default-src'), ["'self'"]);
  assert.deepEqual(policy.get('script-src'), ["'self'"]);
  assert.deepEqual(policy.get('style-src'), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(policy.get('object-src'), ["'none'"]);
  assert.ok(!policy.get('connect-src').some(value => value === '*' || value === 'http:' || value === 'https:'));
});
