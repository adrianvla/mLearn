import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialTheme, parseThemePreview, resolveTheme } from '../src/theme.ts';

test('arbitrary themes preserve extension values and are not a fixed theme-name enum', () => {
  const custom = { ...initialTheme, id: 'school.unique', name: 'Custom', extensions: { 'future::feature': { nested: ['kept'] } } };
  const parsed = parseThemePreview(JSON.stringify(custom));
  assert.deepEqual(parsed, custom);
  assert.equal(resolveTheme(parsed).colors.accent, initialTheme.colors.accent);
});
test('editor rejects invalid rendering values without coercion', () => {
  assert.throws(() => parseThemePreview(JSON.stringify({ ...initialTheme, radius: -1 })));
  assert.throws(() => parseThemePreview(JSON.stringify({ ...initialTheme, colors: { ...initialTheme.colors, text: 'url(secret)' } })));
});
