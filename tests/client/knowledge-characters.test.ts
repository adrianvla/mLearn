/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import type { CollectionItemId, CollectionQuery } from '@mlearn/contracts';

test('package kind scopes both bounded pages and selection while grid/list retain target inspection identity',
  { timeout: 30_000 }, async () => {
    // Given the real screen with portable controls/runtime replaced at their
    // boundaries. Opaque package kind and target IDs deliberately carry no
    // language code, character suffix or dictionary prefix.
    const bundle = await build({
      stdin: { loader: 'tsx', resolveDir: resolve('.'), contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { KnowledgeScreen } from './apps/client/src/features/knowledge/KnowledgeScreen';
        createRoot(document.getElementById('root')).render(<KnowledgeScreen />);
      ` },
      bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [{
        name: 'knowledge-host',
        setup(builder) {
          builder.onResolve({ filter: /^react-native$|^react-native-unistyles$|^expo-router$|^@mlearn\/ui\/|RuntimeProvider$|^\.\.\/(inspector|linguistic|collection)$/ },
            args => ({ path: args.path, namespace: 'knowledge-host' }));
          builder.onLoad({ filter: /.*/, namespace: 'knowledge-host' }, args => {
            const common = `import React from 'react';`;
            let contents: string;
            switch (args.path) {
              case 'react-native':
                contents = `${common}
                  export const Platform = { OS: 'web' };
                  export const AccessibilityInfo = {};
                  export const findNodeHandle = () => null;
                  export const useWindowDimensions = () => ({ width: 1440, height: 900 });
                  export const View = React.forwardRef(({ children, testID }, ref) =>
                    <div ref={ref} data-testid={testID}>{children}</div>);
                `; break;
              case 'react-native-unistyles':
                contents = `export const StyleSheet = { create: fn => fn({
                  colors: {}, spacing: {}, radius: 8,
                }) };`; break;
              case 'expo-router':
                contents = `${common}
                  export const useFocusEffect = callback => React.useEffect(callback, [callback]);
                  export const useLocalSearchParams = () => ({});
                  const router = { push() {}, replace() {} };
                  export const useRouter = () => router;
                `; break;
              case '../../bootstrap/RuntimeProvider':
                contents = `
                  const kinds = [
                    { id: 'unit-v9', label: 'Script units', color: null, attribution: 'Fixture' },
                    { id: 'entry-v4', label: 'Lexical entries', color: null, attribution: 'Fixture' },
                  ];
                  const capability = { id: 'decode-v3', label: 'Decode' };
                  const description = { language: 'fixture', label: 'Fixture',
                    capabilities: [capability], annotationCapability: capability.id,
                    attribution: 'Fixture', catalog: { kinds, capabilities: [capability], scopes: [], levels: [] } };
                  const row = (id, headword, kind, supported) => ({
                    kind: 'target', target: { kind, summary: {
                      targetId: id, headword, reading: null, summary: id,
                      presentation: null,
                    }, capabilities: supported ? [capability.id] : [], scopes: [], levels: [], extensions: {} },
                    knowledge: supported ? [{ key: { packageId: 'fixture.pkg', targetId: id, capability: capability.id },
                      status: 'claimed_known', claim: true, assessed: null, prediction: null, revision: 1 }] : [],
                    materialCount: 0,
                  });
                  const rows = [
                    row('opaque-a', '木', 'unit-v9', true),
                    row('opaque-b', '𠮷', 'unit-v9', false),
                    row('opaque-c', '語', 'unit-v9', true),
                    row('opaque-d', 'word', 'entry-v4', true),
                  ];
                  window.requests = [];
                  function kindOf(filter) {
                    if (filter.kind === 'entity_kind') return filter.id;
                    if (filter.kind === 'all') return filter.filters.map(kindOf).find(Boolean);
                    return null;
                  }
                  const client = {
                    snapshot: async () => ({ installedPlugins: [
                      { id: 'fixture.pkg', displayName: 'Fixture', capabilities: ['text.analyze.v1'] },
                    ] }),
                    currentCollectionPreparation: async () => null,
                    describeLanguage: async () => description,
                    collection: async query => {
                      window.requests.push(query);
                      if (window.holdNextCollection) {
                        window.holdNextCollection = false;
                        await new Promise((resolve, reject) => {
                          window.rejectHeldCollection = () => reject(new Error('Collection fixture unavailable'));
                          window.signalCollectionEntered();
                        });
                      }
                      const kind = kindOf(query.filter);
                      const matches = rows.filter(row => !kind || row.target.kind === kind);
                      return { state: 'ready', page: {
                        items: query.after ? matches.slice(2) : matches.slice(0, 2),
                        count: matches.length, next: query.after || matches.length <= 2 ? null : 'opaque-cursor', previous: null,
                        packageRevision: 'revision-pinned', knowledgeRevision: 1, materialRevision: 1,
                      } };
                    },
                  };
                  const host = { available: true, client };
                  export const useRuntime = () => host;
                `; break;
              case '../collection':
                contents = `${common}
                  export function useCollectionSelection(client, query, items) {
                    const [enabled, setEnabled] = React.useState(false);
                    const [ids, setIds] = React.useState([]);
                    window.selectionInput = { query, items };
                    return { enabled, setEnabled, count: ids.length, canToggle: true,
                      selected: item => ids.includes(item.targetId),
                      toggle: item => setIds(old => old.includes(item.targetId)
                        ? old.filter(id => id !== item.targetId) : [...old, item.targetId]),
                    };
                  }
                  export const CollectionSelectionControls = ({ state }) => <>
                    <button aria-label="Selection" onClick={() => state.setEnabled(!state.enabled)}>Selection</button>
                    <output data-testid="selected-count">{state.count}</output>
                  </>;
                  export const CollectionFilters = ({ onApply }) =>
                    <button aria-label="Fixture compound filter" onClick={() =>
                      onApply({ kind: 'any', filters: [{ kind: 'material', state: 'saved' }, { kind: 'source', sourceId: 'source-7' }] })
                    }>Filter</button>;
                `; break;
              case '../linguistic':
                contents = `${common}
                  export const LinguisticWord = ({ text, activation }) =>
                    <button data-status={activation.status} onClick={event => {
                      const target = event.currentTarget;
                      activation.onActivate({ x: 0, y: 0, width: 44, height: 44,
                        measure: () => {}, restoreFocus: () => target.focus() });
                    }}>{text}</button>;
                `; break;
              case '../inspector':
                contents = `${common}
                  export const Inspector = ({ inspection, packageId, onClose }) =>
                    <section data-testid="inspector" data-package={packageId}
                      data-target={inspection.targets[0]} data-revision={inspection.packageRevision}
                      data-source={JSON.stringify(inspection.sourceAnchor)}>
                      <button aria-label="Close inspection" onClick={() => {
                        inspection.anchor.restoreFocus(); onClose();
                      }}>Close</button>
                    </section>;
                `; break;
              default:
                contents = `${common}
                  export const AppShell = ({ header, children }) => <main>{header}{children}</main>;
                  export const Row = ({ children }) => <div>{children}</div>;
                  export const Text = React.forwardRef(({ children, tabIndex }, ref) =>
                    <span ref={ref} tabIndex={tabIndex}>{children}</span>);
                  export const Button = ({ label, accessibilityLabel, accessibilityState, disabled, onPress }) =>
                    <button aria-label={accessibilityLabel ?? label} aria-pressed={accessibilityState?.selected}
                      disabled={disabled} onClick={onPress}>{label}</button>;
                  export const Select = ({ label, options, value, onValueChange }) =>
                    <select aria-label={label} value={value} onChange={e => onValueChange(e.target.value)}>
                      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>;
                  export const TextField = ({ label, value, onChangeText }) =>
                    <input aria-label={label} value={value} onChange={e => onChangeText(e.target.value)} />;
                  export const Badge = ({ label }) => <span>{label}</span>;
                `;
            }
            return { contents, loader: 'tsx', resolveDir: resolve('.') };
          });
        },
      }],
    });
    assert.ok(bundle.outputFiles[0]);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await expect(page.getByTestId('knowledge-target-opaque-a')).toBeVisible();

      // When selecting the package-declared kind, both the server request and
      // frozen-selection query must include it alongside the existing filter.
      await page.getByRole('button', { name: 'Fixture compound filter' }).click();
      await page.getByLabel('Knowledge entity kind').selectOption('unit-v9');
      await expect(page.getByLabel('Knowledge entity kind')).toHaveValue('unit-v9');
      await expect(page.getByTestId('knowledge-target-opaque-b')).toBeVisible();
      const scoped = await page.evaluate<{
        request: CollectionQuery;
        selection: { query: CollectionQuery; items: CollectionItemId[] };
      }>(`({
        request: window.requests.at(-1), selection: window.selectionInput,
      })`);
      assert.deepEqual(scoped.request.filter, {
        kind: 'all', filters: [
          { kind: 'text', text: '' },
          { kind: 'any', filters: [{ kind: 'material', state: 'saved' }, { kind: 'source', sourceId: 'source-7' }] },
          { kind: 'entity_kind', id: 'unit-v9' },
        ],
      });
      assert.deepEqual(scoped.selection.query, { ...scoped.request, after: null });
      assert.deepEqual(scoped.selection.items, [
        { kind: 'target', targetId: 'opaque-a' }, { kind: 'target', targetId: 'opaque-b' },
      ]);

      // When switching layout, selection and the bounded data page are retained.
      await page.getByRole('button', { name: 'Selection', exact: true }).click();
      await page.getByRole('button', { name: 'Select 木', exact: true }).click();
      const reads = await page.evaluate('window.requests.length');
      await page.getByLabel('Knowledge layout').selectOption('grid');
      await expect(page.getByRole('button', { name: 'Select 木', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('selected-count')).toHaveText('1');
      await expect(page.getByTestId('knowledge-target-opaque-a').getByText('opaque-a', { exact: true })).toHaveCount(0);
      assert.equal(await page.evaluate('window.requests.length'), reads);
      assert.equal(await page.getByTestId('knowledge-target-opaque-c').count(), 0);

      // Then metadata-only entries remain inspectable, with no invented state,
      // rewritten target, source anchor or capability promoted from the package.
      const metadata = page.getByRole('button', { name: '𠮷', exact: true });
      await expect(metadata).toHaveAttribute('data-status', 'unavailable');
      await metadata.click();
      const inspector = page.getByTestId('inspector');
      await expect(inspector).toHaveAttribute('data-target', 'opaque-b');
      await expect(inspector).toHaveAttribute('data-package', 'fixture.pkg');
      await expect(inspector).toHaveAttribute('data-revision', 'revision-pinned');
      await expect(inspector).toHaveAttribute('data-source', 'null');
      await page.getByRole('button', { name: 'Close inspection' }).click();
      await expect(metadata).toBeFocused();
      await page.getByLabel('Knowledge layout').selectOption('list');
      await expect(page.getByTestId('selected-count')).toHaveText('1');
      await expect(page.getByTestId('knowledge-target-opaque-a').getByText('opaque-a', { exact: true })).toBeVisible();

      // Native cursors are used unchanged, and changing kind returns to page one
      // rather than locally filtering the previous page or reusing its cursor.
      await page.getByRole('button', { name: 'Next Knowledge page' }).click();
      await expect(page.getByTestId('knowledge-target-opaque-c')).toBeVisible();
      assert.equal(await page.evaluate('window.requests.at(-1).after'), 'opaque-cursor');
      await page.getByLabel('Knowledge entity kind').selectOption('entry-v4');
      await expect(page.getByTestId('knowledge-target-opaque-d')).toBeVisible();
      assert.equal(await page.evaluate('window.requests.at(-1).after'), null);
      assert.equal(await page.getByTestId('knowledge-target-opaque-c').count(), 0);
      assert.deepEqual(errors, []);

      // When a kind-scoped request is held and then fails, metadata controls
      // must remain focused and usable rather than disappearing with the rows.
      await page.evaluate(`window.holdNextCollection = true;
        window.collectionEntered = new Promise(resolve => { window.signalCollectionEntered = resolve; });
        void 0;`);
      await page.getByLabel('Knowledge entity kind').focus();
      await page.getByLabel('Knowledge entity kind').selectOption('unit-v9');
      await page.evaluate('window.collectionEntered');
      try {
        await expect(page.getByLabel('Knowledge entity kind')).toBeVisible();
        await expect(page.getByLabel('Knowledge entity kind')).toBeFocused();
      } finally {
        await page.evaluate('window.rejectHeldCollection()');
      }
      await expect(page.getByText('Collection fixture unavailable', { exact: true })).toBeVisible();
      await page.getByLabel('Knowledge entity kind').selectOption('');
      await expect(page.getByTestId('knowledge-target-opaque-a')).toBeVisible();
      await expect(page.getByLabel('Knowledge entity kind')).toHaveValue('');
    } finally {
      await browser.close();
    }
  });
