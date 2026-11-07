/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

test('evidence and source search cancel their read on Stop and dismissal', { timeout: 30000 }, async t => {
    // Given real view and runtime-client owners with a held native wire receipt.
    const bundle = await build({
        stdin: { contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { flushSync } from 'react-dom';
            import { KnowledgeEvidence } from './apps/client/src/features/inspector/KnowledgeEvidence';
            import { ReaderSearch } from './apps/client/src/features/reader/ReaderSearch';
            import { createBoundedReadTestClient } from './packages/runtime-client/tests/boundedReadFixture';
            const root = createRoot(document.getElementById('root'));
            window.mount = kind => {
                let release, entered;
                const gate = new Promise(resolve => { release = resolve; });
                const started = new Promise(resolve => { entered = resolve; });
                const cancelled = [], requests = [], receipts = [];
                const client = createBoundedReadTestClient({
                    commandId: () => 'unused',
                    execute: async raw => {
                        const request = JSON.parse(raw); requests.push(request); entered();
                        await gate;
                        if (request.type === 'search_document') return JSON.stringify({
                            type: 'document_search',
                            page: { ...request.query, hits: [], scanned: 1, total: 2, unavailable: 0,
                                next: { identity: 'a'.repeat(64), index: 1, region: 0, offset: 0, unavailable: 0 } }
                        });
                        return JSON.stringify({ type: 'error', code: 'cancelled', message: 'Fixture read cancelled' });
                    }
                });
                for (const name of ['knowledgeEvidence', 'searchDocument']) {
                    const read = client[name];
                    client[name] = (query, signal) => {
                        signal?.addEventListener('abort', () => cancelled.push(query), { once: true });
                        const receipt = read(query, signal);
                        receipts.push(receipt.then(() => {}, () => {}));
                        return receipt;
                    };
                }
                const unmount = () => flushSync(() => root.render(null));
                window.fixture = { started, cancelled, requests, unmount,
                    release: async () => { release(); await Promise.all(receipts); } };
                flushSync(() => root.render(kind === 'evidence'
                    ? <KnowledgeEvidence client={client}
                        knowledgeKey={{ packageId: 'package', targetId: 'target', capability: 'meaning' }}
                        label="Meaning" onBack={unmount} />
                    : <ReaderSearch client={client}
                        source={{ id: 'source', contentRevision: 'content', parserRevision: 'parser' }}
                        scope="text" position={null} compact={false} disabled={false}
                        onLocate={async () => true} onReturn={async () => true} onOpen={() => {}} />));
            };
        `, resolveDir: resolve('.'), loader: 'tsx' },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"', 'process.env.EXPO_PUBLIC_MLEARN_METRICS': '"0"' },
        plugins: [{
            name: 'native-presentation',
            setup(builder) {
                builder.onResolve({ filter: /^(react-native|react-native-unistyles|@mlearn\/ui\/(button|dialog|layout|text|text-field))$/ },
                    args => ({ path: args.path, namespace: 'presentation' }));
                builder.onLoad({ filter: /.*/, namespace: 'presentation' }, () => ({
                    loader: 'tsx', resolveDir: resolve('.'), contents: `
                        import React from 'react';
                        export const View = React.forwardRef(({ children, testID }, ref) =>
                            <div ref={ref} tabIndex={-1} data-testid={testID}>{children}</div>);
                        export const Row = View;
                        export const Text = ({ children, accessibilityRole }) => <span role={accessibilityRole}>{children}</span>;
                        export const Button = React.forwardRef(({ label, disabled, onPress }, ref) =>
                            <button ref={ref} disabled={disabled} onClick={onPress}>{label}</button>);
                        export const TextField = ({ label, value, editable, onChangeText }) =>
                            <input aria-label={label} value={value} disabled={!editable}
                                onChange={event => onChangeText(event.target.value)} />;
                        export const Dialog = ({ open, onOpenChange, trigger, children }) => <>
                            {React.cloneElement(trigger, { onPress: () => onOpenChange(true) })}
                            {open ? <div role="dialog">{children}
                                <button onClick={() => onOpenChange(false)}>Close search</button></div> : null}
                        </>;
                        export const StyleSheet = { create: definition => definition({
                            spacing: { small: 8, compact: 4 }, media: { border: '#505050' }
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
        for (const kind of ['evidence', 'search'] as const) {
            for (const action of ['stop', 'dismiss'] as const) await t.test(`${kind} ${action}`, async () => {
                const page = await browser.newPage();
                page.setDefaultTimeout(3000);
                const errors: string[] = [];
                page.on('pageerror', error => errors.push(error.message));
                try {
                    await page.setContent('<div id="root"></div>');
                    await page.addScriptTag({ content: script.text });
                    await page.evaluate(kind => Reflect.get(window, 'mount')(kind), kind);
                    if (kind === 'search') {
                        await page.getByRole('button', { name: 'Search source', exact: true }).click();
                        await page.getByRole('textbox', { name: 'Search this source', exact: true }).fill('query');
                        await page.getByRole('button', { name: 'Search', exact: true }).click();
                    }
                    await page.evaluate(() => Reflect.get(window, 'fixture').started);
                    // When this view stops or dismisses the pending read.
                    const label = kind === 'evidence'
                        ? action === 'stop' ? 'Stop loading evidence' : 'Back to entry'
                        : action === 'stop' ? 'Stop search' : 'Close search';
                    await page.getByRole('button', { name: label, exact: true }).click();
                    // Then exactly that read is aborted, with no further native quantum.
                    assert.equal(await page.evaluate(() => Reflect.get(window, 'fixture').cancelled.length), 1);
                    await page.evaluate(() => Reflect.get(window, 'fixture').release());
                    assert.equal(await page.evaluate(() => Reflect.get(window, 'fixture').requests.length), 1);
                    if (action === 'stop')
                        await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
                    assert.deepEqual(errors, []);
                } finally { await page.close(); }
            });
        }
    } finally { await browser.close(); }
});
