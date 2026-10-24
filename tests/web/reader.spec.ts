/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import type { DocumentAnalysisBatch, DocumentAppearance, DocumentPosition, DocumentWindow, Material, ReviewSession, SourceAnchor } from '@mlearn/contracts';
import { initialTheme } from '../../packages/theme/src/theme';

// Real exported screens, DOM text geometry and shared controls. Only native IPC
// is substituted here; the actual parser/storage/host flows have separate tests.
const source: DocumentWindow = {
  source: {
    id: 'reader-source', title: 'Mixed source.epub', documentPath: '/profile/documents/source.epub',
    contentRevision: 'content', parserRevision: 'parser-1', format: 'epub', packageId: 'package', packageVersion: '1',
    position: null, appearance: { writingMode: 'auto', font: 'source', fontSize: 24, lineHeight: 1.6, letterSpacing: 0 },
    progression: 'rtl', totalBlocks: 4, totalPages: 0, fidelity: ['Source-authored ruby and writing modes.'],
  },
  blocks: [
    { resource: 'chapter', id: 'opening', kind: 'h1', text: 'A small journey', readings: [], image: null, page: null, writingMode: 'vertical-rl' },
    { resource: 'chapter', id: 'seed', kind: 'p', text: '🌱 東京へ歩く。',
      readings: [{ start: 5, end: 11, text: 'とうきょう' }], image: null, page: null, writingMode: 'vertical-rl' },
    { resource: 'chapter', id: 'bridge', kind: 'p', text: 'The small bridge is quiet.',
      readings: [], image: null, page: null, writingMode: 'horizontal-tb' },
    { resource: 'chapter', id: 'image', kind: 'image', text: '', readings: [],
      image: { resourceId: 'bridge-image', alt: 'Blue bridge' }, page: null, writingMode: 'horizontal-tb' },
  ],
  previous: null, next: null,
};
const position = (blockId: string, offset = 0): DocumentPosition => ({
  parserRevision: 'parser-1', resource: 'chapter', blockId, offset,
});
const anchor: SourceAnchor = {
  sourceId: source.source.id, contentRevision: 'content', packageId: 'package', packageVersion: '1',
  text: source.blocks[1].text,
  locator: { kind: 'document', parserRevision: 'parser-1', resource: 'chapter',
    blockId: 'seed', contextStart: 0, selectionStart: 5, selectionEnd: 11 },
};
const material: Material = {
  id: 'material-tokyo', revision: 1, excluded: false, media: [],
  content: { packageId: 'package', targetId: 'tokyo', packageRevision: 'a'.repeat(64), sense: null,
    phrase: '東京', reading: 'とうきょう', meaning: 'Tokyo', context: anchor.text, notes: '',
    examples: [], attachments: [], source: anchor },
};
const batch: DocumentAnalysisBatch = {
  sourceId: source.source.id, contentRevision: 'content', parserRevision: 'parser-1',
  packageId: 'package', packageVersion: '1', packageRevision: 'a'.repeat(64),
  blocks: [{ resource: 'chapter', blockId: 'seed', start: 0, text: anchor.text, tokens: [
    { start: 0, end: 5, text: '🌱 ', targets: [] },
    { start: 5, end: 11, text: '東京', targets: ['tokyo'] },
    { start: 11, end: 23, text: 'へ歩く。', targets: [] },
  ] }],
  knowledge: [], annotations: [{ resource: 'chapter', blockId: 'seed', tokenStart: 5, status: 'untracked' }],
};
declare global {
  interface Window {
    __readerRequests: { type: string; position: DocumentPosition | null }[];
  }
}

async function start(page: Page, reviewReturn = false) {
  await page.addInitScript(({ source, batch, material, anchor, theme, reviewReturn }) => {
    const state = structuredClone(source);
    const all = structuredClone(source.blocks);
    const review: ReviewSession = {
      id: 'book-review', revision: 1, mode: { kind: 'finite', limit: 1 }, state: 'active',
      completed: 0, total: 1, canUndo: false, message: null,
      encounter: {
        id: 'book-encounter', workId: 'book-work', materialId: material.id, materialRevision: material.revision,
        packageId: 'package', packageVersion: '1', packageRevision: 'a'.repeat(64),
        probeId: 'written', probeContractVersion: 1, direction: 'written', cue: '東京',
        answer: null, source: structuredClone(anchor), requiredMedia: null, supplied: [], correction: false,
        targets: [{ id: 'meaning', label: 'Meaning', mnemonic: 'm', key: null }],
        conditions: { revealed: false, exposureCount: 1, assistance: [], delivery: 'not_required' },
      },
    };
    // The admitted encounter keeps its source after a later authored edit.
    if (reviewReturn) material.content.source = null;
    const requests: Window['__readerRequests'] = [];
    const object = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const point = (value: unknown): value is DocumentPosition => object(value)
      && typeof value.parserRevision === 'string' && typeof value.resource === 'string'
      && typeof value.blockId === 'string' && typeof value.offset === 'number' && Number.isInteger(value.offset);
    const appearance = (value: unknown): value is DocumentAppearance => object(value)
      && (value.writingMode === 'auto' || value.writingMode === 'horizontal' || value.writingMode === 'vertical')
      && (value.font === 'source' || value.font === 'serif' || value.font === 'sans')
      && typeof value.fontSize === 'number' && typeof value.lineHeight === 'number' && typeof value.letterSpacing === 'number';
    const windowAt = (location: DocumentPosition | null) => {
      const index = location ? all.findIndex(block => block.resource === location.resource && block.id === location.blockId) : 0;
      if (index < 0) throw new Error('Missing original fixture block');
      return { source: structuredClone(state.source), blocks: all.slice(index),
        previous: index ? { parserRevision: 'parser-1', resource: 'chapter', blockId: all[index - 1].id, offset: 0 } : null, next: null };
    };
    Object.assign(window, {
      isTauri: true, __MLEARN_MEDIA_BASE__: 'http://127.0.0.1/fixture-media/', __readerRequests: requests,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command: string, args: { request?: string }) => {
          if (command === 'plugin:event|listen') return 1;
          if (command === 'window_material_active') return false;
          if (command === 'cancel_source_open') return;
          if (command === 'document_image_uri') return 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="blue"/></svg>');
          if (command !== 'runtime_execute') throw new Error(`Unexpected host action: ${command}`);
          const request: unknown = JSON.parse(args.request ?? '');
          if (!object(request) || typeof request.type !== 'string') throw new Error('Invalid fixture request');
          requests.push({ type: request.type, position: point(request.position) ? request.position : null });
          switch (request.type) {
            case 'snapshot': return JSON.stringify({ type: 'snapshot', snapshot: {
              protocolVersion: 1, revision: 1, theme, installedPlugins: [
                { id: 'package', version: '1', displayName: 'Fixture language', capabilities: ['text.analyze.v1'] },
              ], availablePlugins: [], codePolicy: 'desktop', catalogConfigured: true,
            } });
            case 'recent_sources': return JSON.stringify({ type: 'sources', sources: [] });
            case 'recent_documents': return JSON.stringify({ type: 'documents', sources: [state.source] });
            case 'resume_document': return JSON.stringify({ type: 'document', window: windowAt(state.source.position) });
            case 'document_window':
              if (request.position !== null && !point(request.position)) throw new Error('Invalid fixture position');
              return JSON.stringify({ type: 'document', window: windowAt(request.position) });
            case 'document_contents': return JSON.stringify({ type: 'document_contents', page: {
              sourceId: state.source.id, parserRevision: 'parser-1', items: all.map(block => ({
                label: block.text, position: { parserRevision: 'parser-1', resource: block.resource, blockId: block.id, offset: 0 },
              })), nextOffset: null,
            } });
            case 'analyze_document': return JSON.stringify({ type: 'document_analysis', batch });
            case 'document_resource': return JSON.stringify({ type: 'document_resource', location: {
              sourceId: state.source.id, resourceId: 'bridge-image', path: '/profile/document-assets/bridge.svg',
              mimeType: 'image/svg+xml', byteLength: 145,
            } });
            case 'checkpoint_document':
              if (!object(request.checkpoint) || !point(request.checkpoint.position)
                || !appearance(request.checkpoint.appearance)) throw new Error('Invalid fixture checkpoint');
              state.source.position = request.checkpoint.position;
              state.source.appearance = request.checkpoint.appearance;
              return JSON.stringify({ type: 'document', window: windowAt(state.source.position) });
            case 'inspect_target': return JSON.stringify({ type: 'entry', packageVersion: '1', packageRevision: 'a'.repeat(64),
              entry: { targetId: 'tokyo', headword: '東京', reading: 'とうきょう', partOfSpeech: 'noun',
                definition: 'Tokyo', summary: 'Tokyo', senses: null, attribution: 'Fixture dictionary',
                capabilities: [{ id: 'reading', label: 'Reading' }] },
              knowledge: { projections: [], claim: 'untracked' },
            });
            case 'material_eligibility': return JSON.stringify({ type: 'material_eligibility',
              items: [{ target: { packageId: 'package', targetId: 'tokyo' },
                availability: { state: 'existing', materialId: material.id, excluded: false } }] });
            case 'materials': return JSON.stringify({ type: 'materials', page: { items: [material], next: null } });
            case 'material': return JSON.stringify({ type: 'material', material });
            case 'review_sessions': return JSON.stringify({ type: 'review_sessions', sessions: [review] });
            case 'review_session': return JSON.stringify({ type: 'review_session', session: review });
            case 'review': {
              const command = request.command;
              if (!review.encounter || !object(command) || command.kind !== 'assistance' || command.assistance !== 'source'
                || command.encounterId !== review.encounter.id || !object(command.mutation)
                || command.mutation.sessionId !== review.id || command.mutation.expectedRevision !== review.revision)
                throw new Error('Invalid Review source assistance');
              review.revision++;
              review.encounter.conditions.assistance = ['source'];
              return JSON.stringify({ type: 'review', commit: {
                commandId: command.mutation.commandId, committedRevision: review.revision, session: review,
              } });
            }
            case 'return_review_source':
              if (!review.encounter || request.sessionId !== review.id || request.encounterId !== review.encounter.id
                || !review.encounter.conditions.assistance.includes('source'))
                throw new Error('Review source return must use the admitted encounter and recorded assistance');
              state.source.position = { parserRevision: 'parser-1', resource: 'chapter', blockId: 'seed', offset: 5 };
              return JSON.stringify({ type: 'document_material_source', window: windowAt(state.source.position),
                anchor: review.encounter.source });
            case 'return_material_source':
              if (!material.content.source) return JSON.stringify({ type: 'error', code: 'unavailable',
                message: 'This authored item has no source association' });
              state.source.position = { parserRevision: 'parser-1', resource: 'chapter', blockId: 'seed', offset: 5 };
              return JSON.stringify({ type: 'document_material_source', window: windowAt(state.source.position), anchor });
            default: throw new Error(`Unimplemented fixture request: ${request.type}`);
          }
        },
      },
    });
  }, { source, batch, material, anchor, theme: initialTheme, reviewReturn });
  if (reviewReturn) {
    await page.goto('/review?sessionId=book-review');
    await expect(page.getByTestId('review-cue')).toContainText('東京');
    return;
  }
  await page.goto('/reader?id=reader-source');
  await expect(page.getByTestId('reader-title')).toHaveText(source.source.title);
  const token = page.getByRole('button', { name: '東京: untracked', exact: true });
  await expect(token).toBeVisible();
}

test('mixed writing modes do not overlap and next navigates within the loaded source window', async ({ page }) => {
  await start(page);
  const rectangles = await page.getByRole('document', { name: 'Document text' }).evaluate(node =>
    [...node.children].map(child => {
      const box = child.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }));
  for (let index = 1; index < rectangles.length; index++) {
    const before = rectangles[index - 1], after = rectangles[index];
    expect(before.right <= after.left || after.right <= before.left
      || before.bottom <= after.top || after.bottom <= before.top).toBe(true);
  }
  await expect(page.getByRole('button', { name: 'Next passage', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Next passage', exact: true }).click();

  await expect(page.getByTestId('reader-position')).toContainText('seed');
  const requests = await page.evaluate(() => window.__readerRequests);
  expect(requests.some(request => request.type === 'document_window'
    && request.position?.blockId === position('seed').blockId)).toBe(true);
  await expect(page.getByRole('button', { name: 'Previous passage', exact: true })).toBeEnabled();
});

test('opening a captured document Material dismisses Inspector before exposing its editor', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '東京: untracked', exact: true }).click();
  await expect(page.getByTestId('inspector-panel')).toBeVisible();

  await page.getByRole('button', { name: 'Open saved 東京', exact: true }).click();

  await expect(page.getByTestId('material-phrase')).toHaveValue('東京');
  await expect(page.getByTestId('inspector-panel')).toHaveCount(0);
  await expect(page.getByRole('document', { name: 'Document text' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Return to source', exact: true })).toBeVisible();
});

test('Review Return preserves its admitted passage after the Material source is cleared', async ({ page }, testInfo) => {
  await start(page, true);

  await page.getByRole('button', { name: 'Return to source', exact: true }).click();

  await expect(page.getByTestId('reader-title')).toHaveText(source.source.title);
  await expect(page.getByTestId('reader-position')).toContainText('chapter · seed');
  const selected = page.getByRole('document', { name: 'Document text' })
    .locator('[data-source-start="5"][data-source-end="11"]');
  await expect(selected).toHaveText('東京');
  await expect(selected).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: testInfo.outputPath('review-original-document-return.png') });
});

test('source image navigation exposes a real bounded thumbnail without changing the image aspect ratio', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Read chapter image', exact: true }).click();
  const images = page.getByRole('img', { name: 'Blue bridge', exact: true });
  await expect(images).toHaveCount(2);
  const sizes = await images.evaluateAll(nodes => nodes.map(node => {
    if (!(node instanceof HTMLImageElement)) throw new Error('Expected rendered source and thumbnail images');
    return { width: node.naturalWidth, height: node.naturalHeight, source: node.src };
  }));
  expect(sizes.some(size => size.source.startsWith('data:image/png;') && size.width <= 128
    && size.height <= 160 && size.width / size.height === 2)).toBe(true);
  await expect(page.getByTestId('reader-position')).toContainText('image');
});

test('narrow Reader reflows without losing the original source location or hiding navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await start(page);
  await page.getByRole('button', { name: 'Next passage', exact: true }).click();
  await expect(page.getByTestId('reader-position')).toContainText('seed');
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('button', { name: 'Horizontal', exact: true }).click();
  await page.getByRole('button', { name: 'Larger text', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('reader-position')).toContainText('seed');
  const document = page.getByRole('document', { name: 'Document text' });
  await expect(document.locator('section').first()).toHaveCSS('writing-mode', 'horizontal-tb');
  await expect(document.locator('section').first()).toHaveCSS('font-size', '26px');
  const controls = [page.getByRole('button', { name: 'Home', exact: true }),
    page.getByRole('button', { name: 'Next passage', exact: true }), document];
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(393);
    expect(box!.height).toBeGreaterThan(0);
  }
  await page.screenshot({ path: testInfo.outputPath('reader-narrow.png') });
});
