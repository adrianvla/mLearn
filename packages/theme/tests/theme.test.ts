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

test('accepted spacing density changes layout values independently of typography', () => {
  const compact = parseThemePreview(JSON.stringify({ ...initialTheme, spacingScale: 0.75 }));
  const spacious = parseThemePreview(JSON.stringify({ ...initialTheme, spacingScale: 1.5 }));
  assert.equal(resolveTheme(compact).spacing.small, 6);
  assert.equal(resolveTheme(spacious).spacing.small, 12);
  assert.equal(resolveTheme(compact).textScale, 1);
  assert.throws(() => parseThemePreview(JSON.stringify({ ...initialTheme, spacingScale: 0 })));
});

test('theme documents predating density retain the ordinary spacing default', () => {
  const { spacingScale: _spacing, ...older } = initialTheme;
  assert.equal(parseThemePreview(JSON.stringify(older)).spacingScale, 1);
});
