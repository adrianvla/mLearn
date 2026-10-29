/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import type { GraphPage, LinguisticEntity, RelationCategory } from '@mlearn/contracts';

const packageId = 'example.language';
const revision = 'a'.repeat(64);
const entity: LinguisticEntity = {
    id: 'entity:root', targetId: 'target:root', label: 'Root',
    kind: { id: `${packageId}:unfamiliar-kind`, label: 'Package kind', color: null, attribution: 'Kind source' },
    capabilities: [{ id: `${packageId}:meaning`, label: 'Meaning' }],
    properties: [
        { id: `${packageId}:feature`, label: 'Nested feature',
            value: { choices: ['one', 'two'] }, attribution: 'Property source' },
        { id: `${packageId}:description`, label: 'Description',
            value: 'Ordinary package fact', attribution: 'Property source' },
        { id: `${packageId}:count`, label: 'Count', value: 3, attribution: 'Property source' },
    ],
    attribution: 'Entity source',
};
const bound = { ...entity, id: 'entity:bound', targetId: 'target:bound', label: 'Bound' };
const fact = { ...entity, id: 'fact:only', targetId: null, capabilities: [], label: 'Fact' };
const categories: RelationCategory[] = ['identity', 'property', 'alternative', 'support', 'support'];
const first: GraphPage = {
    packageId, packageVersion: '1', packageRevision: revision, entity,
    connections: categories.map((category, index) => ({
        entity: index === 1 ? fact : bound,
        relation: { id: `relation:${index}`, category,
            predicate: { id: `${packageId}:relation-${index}`, label: `Predicate ${index}`,
                color: null, attribution: 'Predicate source' },
            from: index === 2 ? bound.id : entity.id,
            to: index === 2 ? entity.id : index === 1 ? fact.id : bound.id,
            qualifiers: [
                { id: `${packageId}:condition`, label: 'Condition',
                    value: { scope: 'only here' }, attribution: 'Qualifier source' },
                { id: `${packageId}:group`, label: 'Package group',
                    value: 'opaque-group-reference', attribution: 'Qualifier source' },
            ],
            attribution: 'Relation source' },
    })),
    knowledge: ['target:root', 'target:bound'].map(targetId => ({
        key: { packageId, targetId, capability: `${packageId}:meaning` },
        claim: null, assessed: null, prediction: null, revision: 0, status: 'untracked' as const,
    })),
    next: { identity: 'b'.repeat(64), after: 'next' },
};
const last: GraphPage = { ...first, connections: [], knowledge: [first.knowledge[0]], next: null };

test('graph presentation preserves semantics, bounded receipts and recovery', { timeout: 30000 }, async t => {
    // Given real React and the typed runtime client; only native presentation is
    // substituted, following the adjacent client browser harness conventions.
    const bundle = await build({
        stdin: { contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { flushSync } from 'react-dom';
            import { GraphDetails } from './apps/client/src/features/inspector/GraphDetails';
            import { createBoundedReadTestClient } from './packages/runtime-client/tests/boundedReadFixture';
            const first = ${JSON.stringify(first)}, last = ${JSON.stringify(last)};
            const root = createRoot(document.getElementById('root'));
            window.mount = mode => {
                let attempts = 0, release;
                const queries = [], inspected = [], cancelled = [];
                const client = createBoundedReadTestClient({ commandId: () => 'unused', execute: async raw => {
                    const { query } = JSON.parse(raw); queries.push(query);
                    const attempt = ++attempts;
                    if ((mode === 'held' || mode === 'stopped' || mode === 'revision') && attempt === 1)
                        await new Promise(resolve => { release = resolve; });
                    if (mode === 'unsupported') return JSON.stringify({ type: 'error', code: 'operation',
                        message: 'Package does not provide related-entity inspection' });
                    if ((mode === 'retry' && attempt === 1) || (mode === 'continuation' && attempt === 2))
                        return JSON.stringify({ type: 'error', code: 'operation', message: 'Temporary failure' });
                    const template = query.after || mode === 'stopped' && attempt > 1 ? last : first;
                    const page = query.targetId === 'replacement' || query.packageId !== first.packageId
                        || query.expectedRevision !== first.packageRevision
                        ? { ...last, packageId: query.packageId, packageRevision: query.expectedRevision,
                            entity: { ...last.entity, targetId: query.targetId, label: 'Replacement', capabilities: [], properties: [] },
                            knowledge: [] }
                        : template;
                    return JSON.stringify({ type: 'graph_neighborhood', page });
                } });
                const neighborhood = client.graphNeighborhood;
                const receipts = [];
                client.graphNeighborhood = (query, signal) => {
                    signal?.addEventListener('abort', () => cancelled.push(query), { once: true });
                    const receipt = neighborhood(query, signal);
                    receipts.push(receipt.then(() => {}, () => {}));
                    return receipt;
                };
                const render = props => flushSync(() => root.render(<GraphDetails client={client}
                    packageId={first.packageId} targetId={first.entity.targetId}
                    packageRevision={first.packageRevision} onInspectTarget={id => inspected.push(id)} {...props} />));
                window.graph = { queries, inspected, cancelled, release: () => { release?.(); return Promise.all(receipts); }, render,
                    unmount: () => flushSync(() => root.render(null)) };
                render({});
            };
        `, resolveDir: resolve('.'), loader: 'tsx' },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"', 'process.env.EXPO_PUBLIC_MLEARN_METRICS': '"0"' },
        plugins: [{
            name: 'native-presentation',
            setup(builder) {
                builder.onResolve({ filter: /^(react-native|react-native-unistyles|@mlearn\/ui\/(button|layout|text))$/ },
                    args => ({ path: args.path, namespace: 'presentation' }));
                builder.onLoad({ filter: /.*/, namespace: 'presentation' }, () => ({
                    loader: 'tsx', resolveDir: resolve('.'), contents: `
                        import React from 'react';
                        export const View = ({ children, testID }) => <div data-testid={testID}>{children}</div>;
                        export const Row = View;
                        export const Text = ({ children, accessibilityRole }) => <span role={accessibilityRole}>{children}</span>;
                        export const Button = ({ label, accessibilityLabel, disabled, onPress }) =>
                            <button aria-label={accessibilityLabel ?? label} disabled={disabled} onClick={onPress}>{label}</button>;
                        export const StyleSheet = { create: definition => definition({
                            spacing: { small: 8 }, media: { border: '#505050' }
                        }) };
                    `,
                }));
            },
        }],
    });
    const script = bundle.outputFiles[0];
    assert.ok(script);
    const browser = await chromium.launch({ headless: true });
    try {
        for (const mode of ['semantics', 'retry', 'continuation', 'unsupported', 'held', 'revision', 'stopped'] as const)
            await t.test(mode, async () => {
                const page = await browser.newPage();
                page.setDefaultTimeout(3000);
                const errors: string[] = [];
                page.on('pageerror', error => errors.push(error.message));
                try {
                    await page.setContent('<div id="root"></div>');
                    await page.addScriptTag({ content: script.text });
                    await page.evaluate(mode => Reflect.get(window, 'mount')(mode), mode);
                    if (mode === 'held' || mode === 'revision') {
                        // When replacing scope before releasing an old receipt,
                        // then only the replacement may remain visible.
                        await page.evaluate(mode => Reflect.get(window, 'graph').render(mode === 'held'
                            ? { targetId: 'replacement' } : { packageRevision: 'c'.repeat(64) }), mode);
                        assert.equal(await page.evaluate(() => Reflect.get(window, 'graph').cancelled.length), 1);
                        await expect(page.getByTestId('graph-details')).toContainText('Replacement');
                        await page.evaluate(() => Reflect.get(window, 'graph').release());
                        await expect(page.getByTestId('graph-relation')).toHaveCount(0);
                    } else if (mode === 'stopped') {
                        // When stopping and explicitly refreshing a held read,
                        // its old transport receipt must not restore the old page.
                        await page.getByRole('button', { name: 'Stop loading relations', exact: true }).click();
                        assert.equal(await page.evaluate(() => Reflect.get(window, 'graph').cancelled.length), 1);
                        await page.getByRole('button', { name: 'Refresh relations', exact: true }).click();
                        await expect(page.getByTestId('graph-relation')).toHaveCount(0);
                        await expect(page.getByRole('button', { name: 'Stop loading relations', exact: true })).toHaveCount(0);
                        await page.evaluate(() => Reflect.get(window, 'graph').release());
                        await expect(page.getByTestId('graph-relation')).toHaveCount(0);
                    } else if (mode === 'unsupported') {
                        await expect(page.getByRole('alert')).toContainText('unsupported');
                        await expect(page.getByRole('button', { name: 'Retry relations', exact: true })).toHaveCount(0);
                    } else {
                        if (mode === 'retry') {
                            await expect(page.getByRole('alert')).toHaveText('Temporary failure');
                            await page.getByRole('button', { name: 'Retry relations', exact: true }).click();
                        }
                        await expect(page.getByTestId('graph-relation')).toHaveCount(5);
                        if (mode === 'semantics') {
                            // Provenance remains inspectable, but technical IDs
                            // do not crowd the ordinary relationship reading.
                            await expect(page.getByText(entity.id, { exact: false })).toHaveCount(0);
                            const graph = page.getByTestId('graph-details');
                            await expect(graph).toContainText('Description: Ordinary package fact');
                            await expect(graph).toContainText('Count: 3');
                            await expect(graph).not.toContainText('{"choices":["one","two"]}');
                            await expect(graph).not.toContainText('opaque-group-reference');
                            await page.getByRole('button', { name: 'Graph sources', exact: true }).click();
                            await expect(page.getByText(`Entity: ${entity.id}`, { exact: false })).toBeVisible();
                            await expect(page.getByText(`Relation: ${first.connections[0].relation.id}`, { exact: false })).toBeVisible();
                            await expect(graph).toContainText('{"choices":["one","two"]}');
                            await expect(graph).toContainText('{"scope":"only here"}');
                            await expect(graph).toContainText('opaque-group-reference');
                            await page.getByRole('button', { name: 'Graph sources', exact: true }).click();
                            await expect(page.getByText(entity.id, { exact: false })).toHaveCount(0);
                            await expect(graph).not.toContainText('{"choices":["one","two"]}');
                            await expect(graph).not.toContainText('opaque-group-reference');
                            // When inspecting an explicit binding, parallel edges and
                            // unbound facts stay distinct and never become targets.
                            await expect(page.getByTestId('graph-support').getByTestId('graph-relation')).toHaveCount(2);
                            await expect(page.getByTestId('graph-property').getByRole('button')).toHaveCount(0);
                            await expect(page.getByTestId('graph-alternative')).toContainText('Bound → Predicate 2 → Root');
                            await page.getByRole('button', { name: 'Inspect Bound target target:bound', exact: true }).first().click();
                            assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'graph').inspected), ['target:bound']);
                        }
                        // When continuing, the next native page replaces this page.
                        await page.getByRole('button', { name: 'Next relations', exact: true }).click();
                        if (mode === 'continuation') {
                            await expect(page.getByRole('alert')).toHaveText('Temporary failure');
                            await expect(page.getByTestId('graph-relation')).toHaveCount(5);
                            await page.getByRole('button', { name: 'Retry relations', exact: true }).click();
                        }
                        await expect(page.getByTestId('graph-relation')).toHaveCount(0);
                        await expect(page.getByRole('button', { name: 'Next relations', exact: true })).toHaveCount(0);
                        const queries = await page.evaluate(() => Reflect.get(window, 'graph').queries);
                        assert.deepEqual(queries.at(-1), {
                            packageId, targetId: entity.targetId, expectedRevision: revision, after: first.next,
                        });
                    }
                    assert.deepEqual(errors, []);
                } finally { await page.close(); }
            });
    } finally { await browser.close(); }
});
