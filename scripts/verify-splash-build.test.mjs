import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('production splash is versioned and its emitted assets resolve', () => {
  const htmlPath = path.join(root, 'dist', 'src', 'html', 'splash.html');
  assert.ok(existsSync(htmlPath), 'Vite did not emit the splash entry');
  const html = readFileSync(htmlPath, 'utf8');
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(html, new RegExp(`data-version="${version.replaceAll('.', '\\.')}"`));
  assert.doesNotMatch(html, /__MLEARN_(?:VERSION|DEVELOPMENT)/);
  assert.match(html, /id="bootstrap-fallback"/);
  assert.match(html, /aria-label="Startup progress"/);

  const assets = [...html.matchAll(/(?:src|href)="(\.\.\/[^"?#]+\.(?:js|css))"/g)]
    .map((match) => path.resolve(path.dirname(htmlPath), match[1]));
  assert.ok(assets.some((asset) => asset.endsWith('.js')), 'splash script is missing');
  assert.ok(assets.some((asset) => asset.endsWith('.css')), 'splash stylesheet is missing');
  for (const asset of assets) assert.ok(existsSync(asset), `missing splash asset: ${asset}`);
});
