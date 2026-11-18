/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('package-colored labels remain readable on content and media surfaces in both themes', { timeout: 30_000 }, async () => {
  const bundle = await build({
    stdin: { loader: 'tsx', resolveDir: resolve('.'), contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Badge } from './packages/ui/src/Badge';
      import { builtInThemes, resolveTheme } from './packages/theme/src/theme';
      import { ThemeFixture } from 'react-native-unistyles';
      const colors = ['#FF44CC', '#FF0000', '#0000FF', '#00FF00', '#FFFF00', '#000000', '#FFFFFF'];
      createRoot(document.getElementById('root')).render(<>
        {builtInThemes.map(document => {
          const theme = resolveTheme(document);
          return <ThemeFixture key={document.id} value={theme}>
            {['content', 'media'].map(tone => <section key={tone}
              style={{padding:12,background:tone === 'media' ? '#212121' : theme.colors.surface}}>
              {colors.map(color => <Badge key={color} label={color} color={color} tone={tone} variant="label" />)}
            </section>)}
          </ThemeFixture>;
        })}
      </>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'badge-platform',
      setup(builder) {
        builder.onResolve({ filter: /^react-native$|^react-native-unistyles$/ },
          args => ({ path: args.path, namespace: 'badge-platform' }));
        builder.onLoad({ filter: /.*/, namespace: 'badge-platform' }, args => ({
          loader: 'tsx', resolveDir: resolve('.'),
          contents: args.path === 'react-native' ? `
            import React from 'react';
            function flatten(style) {
              const { _web, ...native } = Object.assign({}, ...(Array.isArray(style) ? style : [style]));
              return {...native, ..._web};
            }
            export const View = ({children,style}) => <div style={flatten(style)}>{children}</div>;
            export const Text = ({children,style}) => <span style={flatten(style)}>{children}</span>;
          ` : `
            import React from 'react';
            import { initialTheme, resolveTheme } from './packages/theme/src/theme';
            const context = React.createContext(resolveTheme(initialTheme));
            export const ThemeFixture = context.Provider;
            export const useUnistyles = () => ({theme:React.useContext(context)});
            export const StyleSheet = {create:fn=>fn(resolveTheme(initialTheme))};
          `,
        }));
      },
    }],
  });
  assert.ok(bundle.outputFiles[0]);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.getByText('#FF0000', { exact: true })).toHaveCount(4);
    const contrast = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    assert.deepEqual(contrast.violations, []);
    const red = await page.getByText('#FF0000', { exact: true }).first().evaluate(node =>
      node.parentElement ? getComputedStyle(node.parentElement).backgroundColor.match(/\d+/g)?.map(Number) : null);
    const [r, g, b] = red ?? [];
    assert.ok(r !== undefined && g !== undefined && b !== undefined);
    assert.ok(r > g && r > b, 'The package hue remains visible in its label surface');
  } finally {
    await browser.close();
  }
});
