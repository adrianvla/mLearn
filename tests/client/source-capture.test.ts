import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisBatch, MaterialCreate, SourceRecord } from '@mlearn/contracts';
import { captureSourcePage } from '../../apps/client/src/features/material/captureSource';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';

const source: SourceRecord = {
  id: 'video', title: 'Source', mediaPath: '/source.mp4', mediaRevision: 'media',
  subtitlePath: '/source.srt', subtitleRevision: 'subtitles', packageId: 'example.language',
  packageVersion: '1', positionMs: 1000, durationMs: 10000, subtitleOffsetMs: 500,
  subtitleOffsetRevision: 1, playbackRate: 1.25, inspectionTrigger: 'click',
};

function fixture(count: number) {
  const words = Array.from({ length: count }, (_, index) => `word${index}`);
  let offset = 0;
  const tokens = words.map(text => {
    const start = offset; offset += text.length + 1;
    return { start, end: start + text.length, text, targets: [text] };
  });
  const batch: AnalysisBatch = {
    sourceId: source.id, subtitleRevision: 'subtitles', packageId: source.packageId,
    packageVersion: '1', packageRevision: 'package', knowledge: [],
    annotations: tokens.map(token => ({ cueIndex: 0, tokenStart: token.start, status: 'claimed_known' })),
    cues: [{ cue: { index: 0, startMs: 1500, endMs: 4000, text: words.join(' ') }, tokens }],
  };
  const captured: MaterialCreate[][] = [];
  const dictionary: string[][] = [];
  let id = 0;
  const client: Parameters<typeof captureSourcePage>[0] = {
    async analyzeTranscript() { return batch; },
    async materialEligibility(targets) {
      return targets.map(target => ({ target, availability: { state: 'eligible' } }));
    },
    async inspectTargets(sourceId, subtitleRevision, packageRevision, targetIds) {
      dictionary.push(targetIds);
      return { sourceId, subtitleRevision, packageRevision, packageId: source.packageId, packageVersion: '1',
        items: targetIds.map(targetId => ({ state: 'available', summary: {
          targetId, headword: targetId, reading: null, summary: `meaning of ${targetId}`, presentation: null,
        } })) };
    },
    prepareMaterial(content, distinct = false) {
      return { commandId: `command-${id++}`, content, distinct };
    },
    async captureMaterials({ commands }) {
      captured.push(commands);
      return commands.map(command => ({
        state: 'saved', commandId: command.commandId, materialId: `material-${command.commandId}`,
        committedRevision: 1, reused: false,
      }));
    },
  };
  return { client, batch, captured, dictionary };
}

test('whole-source capture batches eligible known words with canonical source and dictionary content', async () => {
  const { client, captured, dictionary } = fixture(14);
  const committed: number[] = [];
  const result = await captureSourcePage(client, source, null, new AbortController().signal, count => committed.push(count));
  assert.equal(result.saved, 14);
  assert.equal(result.next, 0);
  assert.equal(result.done, false);
  assert.deepEqual(dictionary.map(group => group.length), [6, 6, 2]);
  assert.deepEqual(committed, [6, 6, 2]);
  assert.equal(captured.flat().length, 14);
  const content = captured[0][0].content;
  assert.equal(content.meaning, 'meaning of word0');
  const locator = content.source?.locator;
  assert.ok(locator?.kind === 'video');
  assert.equal(locator.positionMs, 1000);
  assert.equal(locator.subtitleOffsetMs, 500);
  assert.equal(locator.playbackRate, 1.25);
});

test('source capture skips saved/excluded targets and retains only failed original commands', async () => {
  const { client, captured } = fixture(14);
  client.materialEligibility = async targets => targets.map(target => ({
    target, availability: target.targetId === 'word0' ? { state: 'excluded' }
      : target.targetId === 'word1' ? { state: 'existing', materialId: 'existing', excluded: false }
        : { state: 'eligible' },
  }));
  client.captureMaterials = async ({ commands }) => {
    captured.push(commands);
    return commands.map((command, index) => index === 0
      ? { state: 'failed', commandId: command.commandId, message: 'temporary failure' }
      : { state: 'saved', commandId: command.commandId, materialId: command.commandId, committedRevision: 1, reused: false });
  };
  const result = await captureSourcePage(client, source, null, new AbortController().signal);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].map(command => command.content.targetId), ['word2', 'word3', 'word4', 'word5']);
  assert.equal(result.saved, 3);
  assert.equal(result.next, null);
  assert.deepEqual(result.failed, [captured[0][0]]);
});

test('cancelling during a durable group reports its commits and admits no following group', async () => {
  const { client, captured } = fixture(14);
  const controller = new AbortController();
  const original = client.captureMaterials;
  let admitted!: () => void;
  const admission = new Promise<void>(resolve => { admitted = resolve; });
  let release!: () => void;
  const completion = new Promise<void>(resolve => { release = resolve; });
  client.captureMaterials = async batch => { admitted(); await completion; return original(batch); };
  const committed: number[] = [];
  const run = captureSourcePage(client, source, null, controller.signal, count => committed.push(count));
  await admission;
  controller.abort();
  release();
  await assert.rejects(run, (error: unknown) => error instanceof Error && error.message.includes('stopped'));
  assert.equal(captured.length, 1);
  assert.deepEqual(committed, [6]);
});

test('changed source identity and nonadvancing pages cannot admit capture', async () => {
  const { client, batch, captured } = fixture(1);
  batch.packageVersion = 'changed';
  await assert.rejects(captureSourcePage(client, source, null, new AbortController().signal));
  batch.packageVersion = '1';
  await assert.rejects(captureSourcePage(client, source, 0, new AbortController().signal));
  assert.equal(captured.length, 0);
  batch.cues = [];
  assert.equal((await captureSourcePage(client, source, 0, new AbortController().signal)).done, true);
});

test('CaptureList retries uncertain writes with their prepared identities, separately from availability reads', { timeout: 30000 }, async (t: TestContext) => {
  // Only native presentation primitives are substituted; React, CaptureList and
  // the typed runtime client execute unchanged in an isolated browser.
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { CaptureList } from './apps/client/src/features/material/CaptureList';
      import { emptyMaterial, cueAnchor } from './apps/client/src/features/material/content';
      import { createRuntimeClient } from './packages/runtime-client/src/client';
      const source = ${JSON.stringify(source)};
      window.mount = (mode) => {
        let next = 0, attempts = 0, reads = 0;
        const commands = [], receipts = new Map();
        const client = createRuntimeClient({
          commandId: () => 'command-' + next++,
          execute: async raw => {
            const request = JSON.parse(raw);
            if (request.type === 'material_eligibility') {
              if (mode === 'availability' && reads++ === 0) throw new Error('Availability unavailable');
              return JSON.stringify({ type: 'material_eligibility', items: request.targets.map(target => ({
                target, availability: receipts.size ? { state: 'existing', materialId: 'saved', excluded: false } : { state: 'eligible' }
              })) });
            }
            if (request.type === 'capture_materials') {
              const results = request.batch.commands.map(command => {
                if (!receipts.has(command.commandId)) receipts.set(command.commandId, {
                  state: 'saved', commandId: command.commandId, materialId: 'saved-' + command.commandId,
                  committedRevision: 1, reused: false
                });
                return receipts.get(command.commandId);
              });
              return JSON.stringify({ type: 'material_captured', results });
            }
            throw new Error('Unexpected request: ' + request.type);
          }
        });
        const capture = client.captureMaterials;
        client.captureMaterials = async batch => {
          commands.push(structuredClone(batch.commands));
          const first = attempts++ === 0;
          if (first && mode === 'before') throw new Error('Rejected before commit');
          const results = await capture(batch);
          if (first && mode === 'after') throw new Error('Committed but reply rejected');
          return results;
        };
        const candidates = ['word0', 'word1'].map((phrase, index) => ({
          key: phrase, content: { ...emptyMaterial(source.packageId), phrase, targetId: phrase, packageRevision: 'package',
            source: cueAnchor(source, { index, startMs: 1500, endMs: 4000, text: phrase },
              { start: 0, end: phrase.length }, 1000) }
        }));
        window.captureState = () => ({ commands, prepared: next, committed: receipts.size });
        createRoot(document.getElementById('root')).render(React.createElement(CaptureList, { client, candidates }));
      };
    `, resolveDir: resolve('.') , loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.EXPO_PUBLIC_MLEARN_METRICS': '"0"' },
    plugins: [{
      name: 'native-presentation',
      setup(builder) {
        builder.onResolve({ filter: /^(react-native(-unistyles)?|@mlearn\/ui\/.*)$/ }, args => ({ path: args.path, namespace: 'presentation' }));
        builder.onLoad({ filter: /.*/, namespace: 'presentation' }, () => ({
          loader: 'tsx', resolveDir: resolve('.'), contents: `
            import React from 'react';
            import { initialTheme, resolveTheme } from './packages/theme/src/theme';
            export const View = ({ children }) => <div>{children}</div>;
            export const Row = View;
            export const Text = ({ children, accessibilityRole }) => <span role={accessibilityRole}>{children}</span>;
            export const Button = ({ label, disabled, onPress }) => <button disabled={disabled} onClick={onPress}>{label}</button>;
            export const InlineWord = ({ text, onActivate }) => <button onClick={event => {
              const node = event.currentTarget;
              onActivate({ ...node.getBoundingClientRect().toJSON(),
                measure: publish => publish(node.getBoundingClientRect()), restoreFocus: () => node.focus() });
            }}>{text}</button>;
            export const Badge = ({ label }) => <span>{label}</span>;
            export const StyleSheet = { create: definition => typeof definition === 'function'
              ? definition(resolveTheme(initialTheme)) : definition };
          `,
        }));
      },
    }],
  });
  const script = bundle.outputFiles[0];
  assert.ok(script);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ['before', 'after', 'availability'] as const) await t.test(mode, async () => {
      const page = await browser.newPage();
      page.setDefaultTimeout(3000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.setContent('<div id="root"></div>');
        await page.addScriptTag({ content: script.text });
        await page.evaluate(mode => {
          const mount = Reflect.get(window, 'mount');
          mount(mode);
        }, mode);
        if (mode === 'availability') {
          await page.getByRole('button', { name: 'Retry availability', exact: true }).click();
        }
        await page.getByRole('button', { name: 'Capture all eligible in this view', exact: true }).click();
        if (mode !== 'availability') {
          await expect(page.getByRole('alert')).toContainText(mode === 'before' ? 'Rejected before commit' : 'Committed but reply rejected');
          await expect(page.getByRole('button', { name: 'Retry availability', exact: true })).toHaveCount(0);
          await expect(page.getByRole('button', { name: 'Capture word0', exact: true })).toHaveCount(0);
          await page.getByRole('button', { name: 'Retry failed captures (2)', exact: true }).click();
        }
        await expect(page.getByText('Saved · saved-command-0 · revision 1', { exact: true })).toBeVisible();
        await expect(page.getByText('Saved · saved-command-1 · revision 1', { exact: true })).toBeVisible();
        const state = await page.evaluate(() => Reflect.get(window, 'captureState')());
        assert.equal(state.prepared, 2);
        assert.equal(state.committed, 2);
        assert.equal(state.commands.length, mode === 'availability' ? 1 : 2);
        if (mode !== 'availability') assert.deepEqual(state.commands[1], state.commands[0]);
      } catch (cause) {
        throw new Error(`${String(cause)}\nBrowser errors: ${errors.join('\n')}\n${await page.locator('body').innerText()}`, { cause });
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
