/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

test('triggerless Dialog restores native accessibility focus only after closing to a current target',
  { timeout: 30_000 }, async () => {
    // Given the real shared Dialog and React effects, with native host operations
    // recorded at the adapter boundary. Native Content does not emit web autofocus.
    const bundle = await build({
      stdin: { loader: 'tsx', resolveDir: resolve('.'), contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { Dialog } from './packages/ui/src/Dialog';
        import { Platform } from 'react-native';
        const root = createRoot(document.getElementById('root'));
        window.renderDialog = (os, open, targetId) => {
          Platform.OS = os;
          flushSync(() => root.render(<Dialog open={open} onOpenChange={() => {}}
            title="Details" description="Source details"
            focusTarget={() => targetId ? document.getElementById(targetId) : null}>
            <span>Content</span>
          </Dialog>));
          return window.focusEvents.slice();
        };
      ` },
      bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [{
        name: 'native-dialog-host',
        setup(builder) {
          builder.onResolve({ filter: /^react-native$|^react-native-unistyles$|^@rn-primitives\/dialog$|^\.\/(Button|Text|KeyboardAvoidingView)$/ },
            args => ({ path: args.path, namespace: 'native-host' }));
          builder.onLoad({ filter: /.*/, namespace: 'native-host' }, args => ({
            loader: 'tsx', resolveDir: resolve('.'), contents: args.path === 'react-native' ? `
              import React from 'react';
              export const Platform = { OS: 'ios' };
              window.focusEvents = [];
              export const AccessibilityInfo = {
                sendAccessibilityEvent: (target, event) => window.focusEvents.push([target.id, event]),
                setAccessibilityFocus: tag => window.focusEvents.push([tag, 'focus']),
              };
              export const findNodeHandle = target => target?.id ?? null;
              export const View = React.forwardRef(({ children }, ref) => <div ref={ref}>{children}</div>);
              export const ScrollView = View;
              export const useWindowDimensions = () => ({ width: 390, height: 844 });
            ` : args.path === 'react-native-unistyles' ? `
              const theme = { colors: {}, spacing: {} };
              export const StyleSheet = { create: factory => factory(theme) };
              export const useUnistyles = () => ({ theme });
            ` : args.path === '@rn-primitives/dialog' ? `
              import React, { createContext, useContext } from 'react';
              const Context = createContext(false);
              export const Root = ({ open, children }) => <Context.Provider value={open}>{children}</Context.Provider>;
              export const Portal = ({ children }) => useContext(Context) ? children : null;
              export const Content = ({ children }) => children;
              export const Trigger = Content, Overlay = Content, Title = Content, Description = Content, Close = Content;
            ` : `
              import React from 'react';
              export const Button = ({ label }) => <button>{label}</button>;
              export const Text = ({ children }) => <span>{children}</span>;
              export const KeyboardAvoidingView = ({ children }) => <div>{children}</div>;
            `,
          }));
        },
      }],
    });
    assert.ok(bundle.outputFiles[0]);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<button id="origin">Details</button><button id="fallback">Options</button><div id="root"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const render = (os: string, open: boolean, target: string | null) =>
        page.evaluate<[string, string][]>(`renderDialog(${JSON.stringify(os)}, ${open}, ${JSON.stringify(target)})`);

      for (const os of ['ios', 'android']) {
        // When closed, opening, or rerendering an open modal, no return is issued.
        const before = await render(os, false, 'origin');
        assert.deepEqual(await render(os, true, 'origin'), before);
        assert.deepEqual(await render(os, true, 'fallback'), before);
        // Then close restores the latest fallback, exactly once even after rerender.
        const closed = [...before, ['fallback', 'focus']];
        assert.deepEqual(await render(os, false, 'fallback'), closed);
        assert.deepEqual(await render(os, false, 'origin'), closed);
        // A route-blurred or unmounted origin returns no target and steals no focus.
        await render(os, true, 'origin');
        assert.deepEqual(await render(os, false, null), closed);
        await render(os, true, 'origin');
        assert.deepEqual(await render(os, false, 'removed-origin'), closed);
        await render(os, true, 'origin');
        assert.deepEqual(await render(os, false, 'origin'), [...closed, ['origin', 'focus']]);
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
