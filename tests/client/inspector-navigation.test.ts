/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

test('Inspector graph navigation keeps source identity separate from active targets', { timeout: 30000 }, async t => {
  // Inspector and React execute unchanged. The graph callback and presentation
  // seams isolate navigation from graph paging, native rendering and storage.
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { Inspector } from './apps/client/src/features/inspector/Inspector';
      const revision = 'a'.repeat(64);
      const source = {
        sourceId: 'source', contentRevision: 'content', packageId: 'package',
        packageVersion: '1', text: 'original context',
        locator: { kind: 'document', resourceId: 'document', position: 0,
          selectionStart: 0, selectionEnd: 8 }
      };
      const anchor = {
        x: 10, y: 20, width: 30, height: 40,
        measure: publish => publish({ x: 10, y: 20, width: 30, height: 40 }),
        restoreFocus() {}
      };
      window.originalAnchor = anchor;
      window.mount = scenario => {
        window.graphKnowledgeScenario = scenario === 'knowledge';
        const calls = [], claims = [];
        let releaseSlow, pendingSlow, failure = true, command = 0;
        const projection = targetId => {
          const changes = claims.filter(change => change.key.targetId === targetId);
          const claim = changes.length ? changes.at(-1).known : true;
          return { key: { packageId: 'package', targetId, capability: 'meaning' },
            claim, assessed: null, prediction: null, revision: changes.length,
            status: claim === null ? 'untracked' : claim ? 'claimed_known' : 'claimed_unknown' };
        };
        const lookup = targetId => ({
          packageRevision: revision,
          entry: { targetId, headword: 'headword ' + targetId, definition: 'meaning ' + targetId,
            summary: null, reading: null, presentation: null, senses: null,
            attribution: 'fixture', capabilities: [{ id: 'meaning', label: 'Meaning' }] },
          knowledge: { claim: window.graphKnowledgeScenario ? projection(targetId).status
              : targetId === 'alternative' ? 'claimed_known' : 'untracked',
            projections: window.graphKnowledgeScenario ? [projection(targetId)] : [] }
        });
        const client = {
          inspectTarget: (packageId, targetId, packageRevision) => {
            calls.push({ packageId, targetId, packageRevision });
            if (targetId === 'slow') {
              pendingSlow = new Promise(resolve => { releaseSlow = resolve; });
              return pendingSlow;
            }
            if (targetId === 'failed' && failure) {
              failure = false;
              return Promise.reject(new Error('lookup failed'));
            }
            return Promise.resolve(lookup(targetId));
          },
          prepareClaim: (key, known) => ({ commandId: 'claim-' + command++, key, known }),
          changeClaim: async change => { claims.push(change); },
          graphNeighborhood: async query => ({
            packageId: 'package', packageVersion: '1', packageRevision: revision,
            entity: { id: 'entity:' + query.targetId, targetId: query.targetId, label: 'Graph entry',
              kind: { id: 'package:entry', label: 'Entry', color: null, attribution: 'Fixture' },
              capabilities: [{ id: 'meaning', label: 'Meaning' }], properties: [], attribution: 'Fixture' },
            connections: [], knowledge: [projection(query.targetId)], next: null
          })
        };
        window.navigationState = () => ({ calls, claims });
        window.releaseSlow = async () => {
          releaseSlow(lookup('slow'));
          await pendingSlow;
          await Promise.resolve();
          flushSync(() => {});
        };
        function Fixture() {
          const [changed, setChanged] = React.useState(false);
          const inspection = React.useMemo(() => ({
            sourceForm: changed ? 'replacement phrase' : 'original phrase',
            context: changed ? 'replacement context' : 'original context',
            targets: ['root', 'alternative'], initialTargetId: 'alternative',
            sourceAnchor: changed ? { ...source, sourceId: 'replacement' } : source,
            anchor, packageRevision: revision
          }), [changed]);
          return <><button onClick={() => setChanged(true)}>Replace source</button>
            <Inspector inspection={inspection} packageId="package" client={client}
              onChanged={async () => {}} onClose={() => {}} /></>;
        }
        createRoot(document.getElementById('root')).render(<Fixture />);
      };
    `, resolveDir: resolve('.'), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.EXPO_PUBLIC_MLEARN_METRICS': '"0"' },
    plugins: [{
      name: 'inspector-presentation',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/GraphDetails$/ }, args =>
          args.importer.endsWith('/inspector/Inspector.tsx')
            ? { path: args.path, namespace: 'graph' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'graph' }, () => ({
          loader: 'tsx', resolveDir: resolve('.'), contents: `
            import { GraphDetails as RealGraphDetails } from './apps/client/src/features/inspector/GraphDetails';
            export function GraphDetails({ targetId, onInspectTarget, ...props }) {
              if (window.graphKnowledgeScenario)
                return <RealGraphDetails targetId={targetId} onInspectTarget={onInspectTarget} {...props} />;
              return <section data-testid="graph-target" data-target={targetId}>
                {['deep', 'slow', 'failed', targetId + '-next'].map(id =>
                  <button key={id} onClick={() => onInspectTarget(id)}>Graph: {id}</button>)}
              </section>;
            }
          `,
        }));
        builder.onResolve({ filter: /^(\.\.\/(material|linguistic|explanation)|\.\/KnowledgeEvidence|\.\.\/\.\.\/bootstrap\/RuntimeProvider)$/ }, args =>
          args.importer.endsWith('/inspector/Inspector.tsx')
            ? { path: args.path, namespace: 'features' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'features' }, () => ({
          loader: 'tsx', resolveDir: resolve('.'), contents: `
            export { emptyMaterial } from './apps/client/src/features/material/content';
            export const useRuntime = () => ({ available: false });
            export const Pronunciation = () => null;
            export const MaterialEditor = () => null;
            export const CaptureList = ({ candidates }) =>
              <output data-testid="capture-content">{JSON.stringify(candidates[0].content)}</output>;
            export const SourceActions = ({ source }) =>
              <output data-testid="source-actions">{JSON.stringify(source)}</output>;
            export const KnowledgeEvidence = ({ knowledgeKey, onBack }) =>
              <section><output data-testid="evidence-key">{JSON.stringify(knowledgeKey)}</output>
                <button onClick={onBack}>Back to entry</button></section>;
          `,
        }));
        builder.onResolve({ filter: /^(react-native(-unistyles)?|expo-router|@mlearn\/ui\/.*)$/ }, args =>
          ({ path: args.path, namespace: 'presentation' }));
        builder.onLoad({ filter: /.*/, namespace: 'presentation' }, () => ({
          loader: 'tsx', resolveDir: resolve('.'), contents: `
            import React from 'react';
            import { initialTheme, resolveTheme } from './packages/theme/src/theme';
            export const View = React.forwardRef(({ children, testID }, ref) => <div ref={ref} data-testid={testID}>{children}</div>);
            export const Row = View;
            export const Text = ({ children, accessibilityRole }) => <span role={accessibilityRole}>{children}</span>;
            export const Badge = ({ label }) => <span>{label}</span>;
            export const Button = React.forwardRef(({ label, accessibilityLabel, accessibilityState, disabled, onPress }, ref) =>
              <button ref={ref} aria-label={accessibilityLabel ?? label}
                aria-expanded={accessibilityState?.expanded} disabled={disabled} onClick={onPress}>{label}</button>);
            export const ContextPanel = ({ title, anchor, sourceContext, footer, popover, children }) =>
              <section data-testid="panel" data-original-anchor={anchor === window.originalAnchor}>
                <h1>{title}</h1><output data-testid="context">{sourceContext}</output>
                {children}<footer>{footer}</footer>{popover}
              </section>;
            export const Dialog = ({ trigger }) => trigger;
            export const useRouter = () => ({ push() {} });
            export const StyleSheet = { create: definition => definition(resolveTheme(initialTheme)) };
          `,
        }));
      },
    }],
  });
  const script = bundle.outputFiles[0];
  assert.ok(script);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ['identity', 'stale', 'bounded', 'replacement', 'knowledge'] as const) {
      await t.test(scenario, async () => {
        const page = await browser.newPage();
        page.setDefaultTimeout(3000);
        try {
          // Given: a source-selected dictionary alternative with its own claim.
          await page.setContent('<div id="root"></div>');
          await page.addScriptTag({ content: script.text });
          await page.evaluate(scenario => Reflect.get(window, 'mount')(scenario), scenario);
          await expect(page.getByRole('heading')).toHaveText('headword alternative');
          await page.getByRole('button', { name: 'Linguistic relationships', exact: true }).click();

          if (scenario === 'knowledge') {
            // When a successful claim refreshes the entry, the real graph must
            // display the same native projection without a manual refresh.
            const graph = page.getByTestId('graph-details');
            await expect(graph).toContainText('Meaning: claimed known');
            await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
            await page.getByRole('button', { name: 'Claim Meaning unknown', exact: true }).click();
            await expect(page.getByText('Meaning · claimed unknown', { exact: true })).toBeVisible();
            // Then the graph agrees, while source identity and the active target
            // remain unchanged.
            await expect(graph).toContainText('Meaning: claimed unknown');
            await expect(page.getByRole('heading')).toHaveText('headword alternative');
            assert.equal(JSON.parse(await page.getByTestId('capture-content').innerText()).targetId, 'alternative');
            await expect(page.getByTestId('context')).toHaveText('original context');
          } else if (scenario === 'identity') {
            // When: a related target is inspected and claimed.
            await page.getByRole('button', { name: 'Graph: deep', exact: true }).click();
            await expect(page.getByRole('heading')).toHaveText('headword deep');
            await expect(page.getByRole('button', { name: 'Knowledge', exact: true })).toHaveText('Untracked');
            await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
            await page.getByRole('button', { name: 'Claim Meaning known', exact: true }).click();
            await expect(page.getByRole('button', { name: 'Inspect evidence', exact: true })).toBeEnabled();
            await page.getByRole('button', { name: 'Inspect evidence', exact: true }).click();

            // Then: claim/evidence/capture use that identity, never root Knowledge
            // or the original inflected phrase, while source provenance is intact.
            const state = await page.evaluate(() => Reflect.get(window, 'navigationState')());
            assert.equal(state.claims[0].key.targetId, 'deep');
            assert.ok(state.calls.every((call: { packageId: string; packageRevision: string }) =>
              call.packageId === 'package' && call.packageRevision === 'a'.repeat(64)));
            const evidence = JSON.parse(await page.getByTestId('evidence-key').innerText());
            assert.equal(evidence.targetId, 'deep');
            const content = JSON.parse(await page.getByTestId('capture-content').innerText());
            assert.equal(content.targetId, 'deep');
            assert.equal(content.phrase, 'headword deep');
            assert.equal(content.context, 'original context');
            assert.equal(content.source.sourceId, 'source');
            assert.deepEqual(JSON.parse(await page.getByTestId('source-actions').innerText()), content.source);
            await expect(page.getByTestId('panel')).toHaveAttribute('data-original-anchor', 'true');
            await expect(page.getByTestId('context')).toHaveText('original context');
            await page.getByRole('button', { name: 'Return to source entry', exact: true }).click();
            await expect(page.getByRole('heading')).toHaveText('headword alternative');
            await expect(page.getByRole('button', { name: 'Linguistic relationships', exact: true })).toBeFocused();
            const root = JSON.parse(await page.getByTestId('capture-content').innerText());
            assert.equal(root.targetId, 'alternative');
            assert.equal(root.phrase, 'original phrase');
            await page.getByRole('button', { name: 'Dictionary alternatives (1)', exact: true }).click();
            await expect(page.getByRole('button', { name: 'Next sense', exact: true })).toBeDisabled();
          } else if (scenario === 'stale') {
            // When: Return abandons a pending lookup, then that lookup completes.
            await page.getByRole('button', { name: 'Graph: slow', exact: true }).click();
            await page.getByRole('button', { name: 'Return to source entry', exact: true }).click();
            await expect(page.getByRole('heading')).toHaveText('headword alternative');
            await page.evaluate(() => Reflect.get(window, 'releaseSlow')());
            // Then: stale completion cannot replace the root or its Material.
            await expect(page.getByRole('heading')).toHaveText('headword alternative');
            assert.equal(JSON.parse(await page.getByTestId('capture-content').innerText()).targetId, 'alternative');
            await page.getByRole('button', { name: 'Graph: failed', exact: true }).click();
            await expect(page.getByRole('alert')).toHaveText('lookup failed');
            await page.getByRole('button', { name: 'Retry lookup', exact: true }).click();
            await expect(page.getByRole('heading')).toHaveText('headword failed');
          } else if (scenario === 'bounded') {
            // When: traversal exceeds the retained history bound.
            let target = 'alternative';
            for (let index = 0; index < 18; index++) {
              target += '-next';
              await page.getByRole('button', { name: 'Graph: ' + target, exact: true }).click();
              await expect(page.getByRole('heading')).toHaveText('headword ' + target);
            }
            for (let index = 0; index < 15; index++) {
              await page.getByRole('button', { name: 'Previous graph target', exact: true }).click();
              target = target.slice(0, -5);
              await expect(page.getByRole('heading')).toHaveText('headword ' + target);
            }
            // Then: only sixteen deep targets remain, but root Return survives.
            await expect(page.getByRole('button', { name: 'Previous graph target', exact: true })).toHaveCount(0);
            await page.getByRole('button', { name: 'Return to source entry', exact: true }).click();
            await expect(page.getByRole('heading')).toHaveText('headword alternative');
          } else {
            // When: the original source changes while a deep lookup is pending.
            await page.getByRole('button', { name: 'Graph: slow', exact: true }).click();
            await page.getByRole('button', { name: 'Replace source', exact: true }).click();
            await expect(page.getByTestId('context')).toHaveText('replacement context');
            await expect(page.getByRole('heading')).toHaveText('headword alternative');
            await page.evaluate(() => Reflect.get(window, 'releaseSlow')());
            // Then: source lifetime reset drops history and late publication.
            await expect(page.getByRole('button', { name: 'Return to source entry', exact: true })).toHaveCount(0);
            const content = JSON.parse(await page.getByTestId('capture-content').innerText());
            assert.equal(content.targetId, 'alternative');
            assert.equal(content.phrase, 'replacement phrase');
            assert.equal(content.source.sourceId, 'replacement');
          }
        } finally { await page.close(); }
      });
    }
  } finally { await browser.close(); }
});
