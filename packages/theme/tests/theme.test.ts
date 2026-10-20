import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtInThemes, initialTheme, parseThemePreview, resolveTheme } from '../src/theme.ts';

const savedSlate = {
  schemaVersion: 1, id: 'mlearn.slate', name: 'Slate',
  colors: { background: '#15191F', surface: '#20262E', text: '#EDF0F5', muted: '#BAC2CE',
    accent: '#99BEFF', onAccent: '#15243C', border: '#414B5A' },
  radius: 12, textScale: 1, spacingScale: 1, extensions: {},
};
const savedQuartzCheckpoint = {
  ...initialTheme,
  colors: { background: '#F5F5F5', surface: '#EEEEEE', text: '#1A1A1A', muted: '#626262',
    accent: '#C44700', onAccent: '#FFFFFF', border: '#BFBFBF' },
};

test('normal saved built-in presentation updates without losing text and density preferences', () => {
  const saved = { ...savedSlate, textScale: 1.5, spacingScale: 0.75 };
  const rendered = resolveTheme(saved);
  assert.notDeepEqual(rendered.colors, saved.colors);
  assert.deepEqual(rendered.colors, builtInThemes[1].colors);
  assert.equal(rendered.textScale, 1.5);
  assert.equal(rendered.spacing.small, 6);
  assert.deepEqual(saved, { ...savedSlate, textScale: 1.5, spacingScale: 0.75 });
  assert.deepEqual(resolveTheme(savedQuartzCheckpoint).colors, initialTheme.colors);
});

test('customized historical built-in IDs retain their actual palette and extension data', () => {
  for (const custom of [
    { ...savedSlate, colors: { ...savedSlate.colors, accent: '#AA3377' } },
    { ...savedSlate, radius: 6 },
    { ...savedSlate, extensions: { 'school::palette': { retained: true } } },
    { ...savedQuartzCheckpoint, colors: { ...savedQuartzCheckpoint.colors, accent: '#AA3377' } },
  ]) {
    const parsed = parseThemePreview(JSON.stringify(custom));
    assert.deepEqual(resolveTheme(parsed).colors, custom.colors);
    assert.equal(resolveTheme(parsed).radius, custom.radius);
    assert.deepEqual(parsed, custom);
  }
});

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

test('all text roles scale size and line height together without changing family or weight', () => {
  const ordinary = resolveTheme(initialTheme).typography;
  const enlarged = resolveTheme({ ...initialTheme, textScale: 2, spacingScale: 0.75 }).typography;
  assert.deepEqual(enlarged, Object.fromEntries(Object.entries(ordinary).map(([role, metrics]) => [
    role, { ...metrics, fontSize: metrics.fontSize * 2, lineHeight: metrics.lineHeight * 2 },
  ])));
});
