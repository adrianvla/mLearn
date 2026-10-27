/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { DocumentWindow, ImageReaderSettings, OcrCorrection, OcrEvidence, OcrPage, OcrProvider, OcrRecovery, OcrRegion, OcrRequest } from '@mlearn/contracts';
import { initialTheme, resolveTheme } from '../../packages/theme/src/theme';

declare global { interface Window {
  __imageReaderRequests: Record<string, unknown>[];
  __imageOcrControl: { hold: boolean; fail: 'cancelled' | 'committed' | null;
    entered: Promise<void>; finished: Promise<void>; release?: () => void };
  __imageImportControl: { hold: boolean; entered: Promise<void>; release?: () => void };
  __imageEligibilityControl: { hold: boolean; entered: Promise<void>; release?: () => void };
  __imageUriControl: { available: boolean };
  __documentAnalysisControl: { first: Promise<void>; second: Promise<void> };
} }

// These are real exported controls/pixels/geometry with substituted native IPC.
// Recognition quality and persistence are verified separately through real hosts.
async function readerOptions(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Reader appearance', exact: true });
  if (!await dialog.isVisible())
    await page.getByRole('button', { name: 'View options', exact: true }).click();
  return dialog;
}

async function start(page: Page, home = false, orientation: 'topToBottom' | 'vertical-rl' | null = null, pdf = false, withSenses = false) {
  await page.addInitScript(({ theme, orientation, pdf, withSenses }) => {
    const source: DocumentWindow = {
      source: { id: 'scan-book', title: 'Original image collection', documentPath: '/owned/collection.images',
        format: pdf ? 'pdf' : 'images', contentRevision: 'original-pixels', parserRevision: 'images-1', packageId: 'package', packageVersion: '1',
        position: { parserRevision: 'images-1', resource: 'image-0', blockId: 'page-0', offset: 0 },
        appearance: { writingMode: 'auto', font: 'source', fontSize: 24, lineHeight: 1.6, letterSpacing: 0 },
        totalBlocks: 3, totalPages: 3, progression: null, fidelity: [] },
      blocks: Array.from({ length: 3 }, (_, index) => ({ resource: `image-${index}`, id: `page-${index}`, kind: 'image',
        text: pdf ? ['東京', '大阪', '京都'][index] : '', readings: [], image: { resourceId: `image-${index}`, alt: `Original ${index + 1}` }, page: index, writingMode: null })),
      previous: null, next: null,
    };
    const provider: OcrProvider = { id: 'fixture-sdk', label: 'Fixture on-device provider', revision: '1',
      availability: 'ready', languages: ['ja-JP'], scripts: ['Jpan'], languageProvenance: 'Fixture SDK', reason: null };
    let settings: ImageReaderSettings = { fit: 'height', paired: false, firstPageSingle: false, collate: true,
      direction: 'ltr', showOverlay: true, showAnnotations: true };
    const originals = new Map<string, string>();
    const recognized = new Map<string, OcrPage>();
    const evidence = new Map<string, OcrEvidence>();
    const correctionReceipts = new Map<string, OcrPage>();
    let loseCorrectionReceipt = true;
    const texts = [orientation ? '日本語を読む' : '東京', '大阪', '京都'];
    texts.forEach((text, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 1200;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('A real raster fixture requires Canvas2D');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 1200);
      context.fillStyle = '#111'; context.font = '96px sans-serif';
      const vertical = index === 0 && orientation !== null;
      if (vertical) Array.from(text).forEach((glyph, index) => context.fillText(glyph, 100, 200 + index * 100));
      else context.fillText(text, 100, 250);
      const measured = context.measureText(vertical ? '語' : text);
      const x = (100 - measured.actualBoundingBoxLeft) / 800, right = (100 + measured.actualBoundingBoxRight) / 800;
      const y = ((vertical ? 200 : 250) - measured.actualBoundingBoxAscent) / 1200;
      const bottom = ((vertical ? 200 + (Array.from(text).length - 1) * 100 : 250) + measured.actualBoundingBoxDescent) / 1200;
      const resourceId = `image-${index}`;
      let reading: OcrRegion | null = null;
      if (index === 0 && !vertical) {
        context.font = '28px sans-serif'; context.fillText('とうきょう', 100, 140);
        const annotation = context.measureText('とうきょう');
        const left = (100 - annotation.actualBoundingBoxLeft) / 800, right = (100 + annotation.actualBoundingBoxRight) / 800;
        const top = (140 - annotation.actualBoundingBoxAscent) / 1200, bottom = (140 + annotation.actualBoundingBoxDescent) / 1200;
        reading = { id: 'reading-0', text: 'とうきょう', quad: {
          topLeft: { x: left, y: top }, topRight: { x: right, y: top }, bottomRight: { x: right, y: bottom },
          bottomLeft: { x: left, y: bottom } }, candidates: [{ text: 'とうきょう', confidence: 0.9 }],
          language: 'ja-JP', orientation: 'horizontal', readingOf: 'line-0' };
      }
      originals.set(resourceId, canvas.toDataURL('image/png'));
      recognized.set(resourceId, { sourceId: source.source.id, contentRevision: source.source.contentRevision,
        resourceId, ocrRevision: 1, provider, width: 800, height: 1200, crop: null,
        regions: [{ id: `line-${index}`, text, quad: { topLeft: { x, y }, topRight: { x: right, y },
          bottomRight: { x: right, y: bottom }, bottomLeft: { x, y: bottom } },
          candidates: [{ text, confidence: 0.9 }], language: 'ja-JP', orientation: vertical ? orientation : 'horizontal', readingOf: null },
        ...(reading ? [reading] : [])] });
    });
    for (const original of recognized.values()) evidence.set(`${original.resourceId}:1`, {
      sourceId: original.sourceId, resourceId: original.resourceId, ocrRevision: 1, parentRevision: null,
      request: null, correction: null, package: null, result: {
        requestId: crypto.randomUUID(), provider, width: original.width, height: original.height,
        crop: null, regions: structuredClone(original.regions),
      },
    });
    const requests: Record<string, unknown>[] = [];
    let firstAnalysis: () => void = () => {}, secondAnalysis: () => void = () => {};
    const documentAnalysisControl = {
      first: new Promise<void>(resolve => { firstAnalysis = resolve; }),
      second: new Promise<void>(resolve => { secondAnalysis = resolve; }),
    };
    let analysisCount = 0;
    let practiceSession: Record<string, unknown> | null = null;
    let practiceReceipt: unknown = null;
    let losePracticeReceipt = true;
    const reservations = new Set<string>(), cancellations = new Set<string>();
    const actionReceipts = new Map<string, { request: OcrRequest; recovery: OcrRecovery }>();
    let markEntered: () => void = () => {}, markFinished: () => void = () => {};
    const ocrControl: Window['__imageOcrControl'] = { hold: false, fail: null,
      entered: new Promise<void>(resolve => { markEntered = resolve; }),
      finished: new Promise<void>(resolve => { markFinished = resolve; }) };
    let markPicker: () => void = () => {};
    const importControl: Window['__imageImportControl'] = { hold: false,
      entered: new Promise<void>(resolve => { markPicker = resolve; }) };
    let markEligibility: () => void = () => {};
    const eligibilityControl: Window['__imageEligibilityControl'] = { hold: false,
      entered: new Promise<void>(resolve => { markEligibility = resolve; }) };
    const imageUriControl = { available: true };
    const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
    Object.assign(window, {
      isTauri: true, __MLEARN_MEDIA_BASE__: 'http://127.0.0.1/fixture-media/', __imageReaderRequests: requests,
      __imageOcrControl: ocrControl,
      __imageImportControl: importControl,
      __imageEligibilityControl: eligibilityControl,
      __imageUriControl: imageUriControl,
      __documentAnalysisControl: documentAnalysisControl,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === 'plugin:event|listen') return 1;
          if (command === 'window_material_active') return false;
          if (command === 'cancel_source_open') return;
          if (command === 'ocr_providers') return JSON.stringify([provider]);
          if (command === 'pick_images') {
            requests.push({ type: command, folder: args.folder }); markPicker();
            if (importControl.hold) await new Promise<void>(resolve => { importControl.release = resolve; });
            return { paths: ['/fixture/one.png', '/fixture/two.png', '/fixture/three.png'], title: 'Original image collection' };
          }
          if (command === 'reserve_ocr') {
            const id = String(args.jobId);
            if (reservations.size) throw new Error('Native recognition is already admitted');
            reservations.add(id); requests.push({ type: command, jobId: id }); return;
          }
          if (command === 'cancel_ocr') {
            cancellations.add(String(args.jobId)); requests.push({ type: command, jobId: args.jobId }); return;
          }
          if (command === 'recognize_image') {
            const request: OcrRequest = JSON.parse(JSON.stringify(args.request));
            if (!reservations.has(request.requestId)) throw new Error('Missing native recognition admission');
            requests.push({ type: command, jobId: args.jobId, request }); markEntered();
            try {
              if (actionReceipts.has(request.requestId)) throw new Error('Terminal OCR requests require native recovery, not another inference');
              actionReceipts.set(request.requestId, { request, recovery: { state: 'pending' } });
              if (ocrControl.hold) await new Promise<void>(resolve => { ocrControl.release = resolve; });
              if (cancellations.has(request.requestId) || ocrControl.fail === 'cancelled') {
                ocrControl.fail = null;
                actionReceipts.set(request.requestId, { request, recovery: { state: 'cancelled' } });
                throw new Error('Native recognition failed and cancelled before publication');
              }
              const original = recognized.get(request.resourceId);
              if (!original) throw new Error('Missing native original');
              const regions = structuredClone(original.regions);
              if (request.crop) {
                const { x, y, width, height } = request.crop;
                regions.push({ id: 'crop-line', text: '区域', quad: {
                  topLeft: { x, y }, topRight: { x: x + width, y }, bottomRight: { x: x + width, y: y + height },
                  bottomLeft: { x, y: y + height } }, candidates: [{ text: '区域', confidence: 0.8 }],
                  language: 'ja-JP', orientation: 'horizontal', readingOf: null });
              }
              const result = { ...original, ocrRevision: original.ocrRevision + 1, crop: request.crop, regions };
              recognized.set(request.resourceId, result);
              actionReceipts.set(request.requestId, { request, recovery: { state: 'completed', page: result } });
              if (ocrControl.fail === 'committed') {
                ocrControl.fail = null;
                throw new Error('Native recognition completion receipt lost');
              }
              return JSON.stringify({ type: 'ocr_page', page: result });
            } finally { reservations.delete(request.requestId); markFinished(); }
          }
          if (command === 'image_page_uri') {
            requests.push({ type: command, resourceId: args.resourceId, crop: args.crop ?? null });
            if (!imageUriControl.available) throw new Error('fixture-original-unavailable');
            const uri = originals.get(String(args.resourceId));
            if (!uri) throw new Error('Unknown original image');
            if (object(args.crop)) {
              const crop = args.crop;
              if (![crop.x, crop.y, crop.width, crop.height].every(value => typeof value === 'number' && Number.isFinite(value)))
                throw new Error('Malformed original-pixel crop');
              const original = new Image(); original.src = uri; await original.decode();
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.ceil(Number(crop.width) * original.naturalWidth));
              canvas.height = Math.max(1, Math.ceil(Number(crop.height) * original.naturalHeight));
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Original-pixel crop unavailable');
              context.drawImage(original, Number(crop.x) * original.naturalWidth, Number(crop.y) * original.naturalHeight,
                Number(crop.width) * original.naturalWidth, Number(crop.height) * original.naturalHeight,
                0, 0, canvas.width, canvas.height);
              return canvas.toDataURL('image/png');
            }
            return uri;
          }
          if (command !== 'runtime_execute') throw new Error(`Unexpected native action: ${command}`);
          const request: unknown = JSON.parse(String(args.request));
          if (!object(request) || typeof request.type !== 'string') throw new Error('Invalid fixture action');
          requests.push(request);
          switch (request.type) {
            case 'snapshot': return JSON.stringify({ type: 'snapshot', snapshot: { protocolVersion: 1, revision: 1, theme,
              installedPlugins: [{ id: 'package', version: '1', displayName: 'Fixture language', capabilities: ['text.analyze.v1'] }],
              availablePlugins: [], codePolicy: 'desktop', catalogConfigured: true } });
            case 'recent_sources': return JSON.stringify({ type: 'sources', sources: [] });
            case 'recent_documents': return JSON.stringify({ type: 'documents', sources: [source.source] });
            case 'import_image_collection': return JSON.stringify({ type: 'document', window: source });
            case 'resume_document': return JSON.stringify({ type: 'document', window: source });
            case 'analyze_document': {
              if (++analysisCount === 1) firstAnalysis(); else secondAnalysis();
              return JSON.stringify({ type: 'document_analysis', batch: {
              sourceId: source.source.id, contentRevision: source.source.contentRevision,
              parserRevision: source.source.parserRevision, packageId: 'package', packageVersion: '1', packageRevision: 'a'.repeat(64),
              blocks: source.blocks.map(block => ({ resource: block.resource, blockId: block.id, start: 0, text: block.text, tokens: [] })),
              knowledge: [], annotations: [],
            } }); }
            case 'document_contents': return JSON.stringify({ type: 'document_contents', page: {
              sourceId: source.source.id, parserRevision: source.source.parserRevision, nextOffset: null,
              items: source.blocks.map(block => ({ label: `Page ${Number(block.page) + 1}`,
                position: { parserRevision: source.source.parserRevision, resource: block.resource, blockId: block.id, offset: 0 } })),
            } });
            case 'document_window': {
              const position = request.position;
              const index = object(position) ? source.blocks.findIndex(block =>
                block.resource === position.resource && block.id === position.blockId) : 0;
              if (index < 0) throw new Error('Requested source window is unavailable');
              return JSON.stringify({ type: 'document', window: { ...source, blocks: source.blocks.slice(index) } });
            }
            case 'checkpoint_document':
              if (!object(request.checkpoint) || !object(request.checkpoint.position)) throw new Error('Missing original position');
              Object.assign(source.source, { position: request.checkpoint.position });
              return JSON.stringify({ type: 'document', window: source });
            case 'image_reader_settings': return JSON.stringify({ type: 'image_reader_settings', sourceId: source.source.id, settings });
            case 'save_image_reader_settings':
              if (!object(request.settings)) throw new Error('Missing accepted image settings');
              Object.assign(settings, request.settings);
              return JSON.stringify({ type: 'image_reader_settings', sourceId: source.source.id, settings });
            case 'image_page': {
              const index = Number(request.pageIndex), block = source.blocks[index];
              if (!block) throw new Error('No such original page');
              return JSON.stringify({ type: 'image_page', page: { sourceId: source.source.id, contentRevision: source.source.contentRevision,
                pageIndex: index, resourceId: block.resource, position: {
                  parserRevision: 'images-1', resource: block.resource, blockId: block.id, offset: 0 } } });
            }
            case 'read_ocr': return JSON.stringify({ type: 'ocr_cached', page: recognized.get(String(request.resourceId)) ?? null });
            case 'ocr_recovery': {
              const original: OcrRequest = JSON.parse(String(args.request)).request;
              const receipt = actionReceipts.get(original.requestId);
              if (receipt && JSON.stringify(receipt.request) !== JSON.stringify(original)) throw new Error('Changed OCR recovery request');
              return JSON.stringify({ type: 'ocr_recovery', recovery: receipt?.recovery ?? { state: 'unknown' } });
            }
            case 'ocr_evidence': {
              const value = evidence.get(`${request.resourceId}:${request.ocrRevision}`);
              if (!value) throw new Error('Unknown immutable recognition evidence');
              return JSON.stringify({ type: 'ocr_evidence', evidence: value });
            }
            case 'correct_ocr': {
              const correction: OcrCorrection = JSON.parse(String(args.request)).correction;
              let saved = correctionReceipts.get(correction.commandId);
              if (!saved) {
                const original = recognized.get(correction.resourceId);
                if (!original || original.ocrRevision !== correction.expectedRevision) throw new Error('Native correction revision conflict');
                saved = { ...original, ocrRevision: original.ocrRevision + 1,
                  regions: original.regions.map(region => region.id === correction.region.id ? structuredClone(correction.region) : region) };
                recognized.set(saved.resourceId, saved); correctionReceipts.set(correction.commandId, saved);
                evidence.set(`${saved.resourceId}:${saved.ocrRevision}`, { sourceId: saved.sourceId, resourceId: saved.resourceId,
                  ocrRevision: saved.ocrRevision, parentRevision: original.ocrRevision,
                  request: null, result: null, correction, package: null });
              }
              if (loseCorrectionReceipt) {
                loseCorrectionReceipt = false;
                return JSON.stringify({ type: 'error', code: 'unavailable', message: 'Correction receipt lost' });
              }
              return JSON.stringify({ type: 'ocr_page', page: saved });
            }
            case 'analyze_ocr': {
              const original = recognized.get(String(request.resourceId));
              if (!original) throw new Error('Missing immutable recognition');
              const ids = request.regionIds;
              if (!Array.isArray(ids)) throw new Error('Missing bounded original regions');
              const selected = original.regions.filter(region => ids.includes(region.id));
              const regions = selected.map(region => ({ regionId: region.id, text: region.text,
                tokens: orientation && region.id === 'line-0' ? [
                  { start: 0, end: 9, text: '日本語', targets: ['first-word'] },
                  { start: 9, end: 12, text: 'を', targets: [] },
                  { start: 12, end: 18, text: '読む', targets: ['last-word'] },
                ] : [{ start: 0, end: new TextEncoder().encode(region.text).length, text: region.text, targets: [region.id] }] }));
              return JSON.stringify({ type: 'ocr_analysis', batch: { sourceId: source.source.id, contentRevision: source.source.contentRevision,
                resourceId: original.resourceId, ocrRevision: original.ocrRevision, packageId: 'package', packageVersion: '1',
                packageRevision: 'a'.repeat(64), regions, knowledge: [],
                annotations: regions.flatMap(region => region.tokens.filter(token => token.targets.length)
                  .map(token => ({ regionId: region.regionId, tokenStart: token.start, status: 'untracked' }))) } });
            }
            case 'inspect_target': return JSON.stringify({ type: 'entry', packageVersion: '1', packageRevision: 'a'.repeat(64),
              entry: { targetId: 'line-0', headword: '東京', reading: 'とうきょう', partOfSpeech: 'noun', definition: 'Tokyo',
                summary: 'Tokyo', senses: withSenses ? [
                  { heading: 'noun', labels: ['noun'], definitions: ['Tokyo'], notes: [] },
                  { heading: 'place', labels: ['place'], definitions: ['Tokyo metropolitan area'], notes: [] },
                ] : null, attribution: 'Fixture dictionary', capabilities: [{ id: 'reading', label: 'Reading' }] },
              knowledge: { projections: [], claim: 'untracked' } });
            case 'capture_materials': {
              if (!object(request.batch) || !Array.isArray(request.batch.commands)) throw new Error('Missing capture batch');
              return JSON.stringify({ type: 'material_captured', results: request.batch.commands.map(command => {
                if (!object(command) || typeof command.commandId !== 'string') throw new Error('Missing capture command identity');
                return { state: 'saved', commandId: command.commandId, materialId: 'captured-tokyo', committedRevision: 1, reused: false };
              }) });
            }
            case 'material_eligibility': {
              if (eligibilityControl.hold) {
                markEligibility();
                await new Promise<void>(resolve => { eligibilityControl.release = resolve; });
              }
              return JSON.stringify({ type: 'material_eligibility', items: [{
                target: { packageId: 'package', targetId: 'line-0' }, availability: { state: 'existing', materialId: 'saved-tokyo', excluded: false } }] });
            }
            case 'review': {
              if (!object(request.command) || request.command.kind !== 'start' || !object(request.command.start))
                throw new Error('Source practice must use the shared native Start command');
              const start = request.command.start;
              if (!object(start.mode) || start.mode.kind !== 'practice' || !Array.isArray(start.mode.items)
                || !object(start.mode.items[0])) throw new Error('Missing finite source practice membership');
              if (practiceReceipt !== null && practiceReceipt !== start.commandId) throw new Error('Practice retry changed command identity');
              practiceReceipt = start.commandId;
              practiceSession ??= { id: start.sessionId, revision: 1, mode: start.mode, state: 'active', completed: 0,
                total: 1, canUndo: false, message: null, encounter: {
                  id: 'practice-encounter', workId: 'practice-work', materialId: start.mode.items[0].materialId, materialRevision: 1,
                  packageId: 'package', packageVersion: '1', packageRevision: 'a'.repeat(64), probeId: 'written',
                  probeContractVersion: 1, direction: 'written', cue: '東京', answer: null, source: start.mode.items[0].source,
                  requiredMedia: null, supplied: [], correction: false,
                  targets: [{ id: 'meaning', label: 'Meaning', mnemonic: null, key: null }],
                  conditions: { revealed: false, exposureCount: 1, assistance: [], delivery: 'not_required' },
                } };
              if (losePracticeReceipt) {
                losePracticeReceipt = false;
                return JSON.stringify({ type: 'error', code: 'unavailable', message: 'Practice admission receipt lost' });
              }
              return JSON.stringify({ type: 'review', commit: { commandId: start.commandId, committedRevision: 1, session: practiceSession } });
            }
            case 'review_sessions': return JSON.stringify({ type: 'review_sessions', sessions: practiceSession ? [practiceSession] : [] });
            case 'review_session':
              if (!practiceSession || practiceSession.id !== request.sessionId) throw new Error('Missing admitted practice');
              return JSON.stringify({ type: 'review_session', session: practiceSession });
            case 'materials': return JSON.stringify({ type: 'materials', page: { items: [], next: null } });
            default: throw new Error(`Unexpected image-source operation: ${request.type}`);
          }
        },
      },
    });
  }, { theme: initialTheme, orientation, pdf, withSenses });
  await page.goto(home ? '/' : '/reader?id=scan-book');
  if (home) {
    // The card's independent Continue preview covers its center. Activate the
    // visible header, as a pointer user does when choosing a new source.
    await page.getByRole('button', { name: 'Read', exact: true }).click({ position: { x: 24, y: 24 } });
    await expect(page.getByRole('button', { name: 'Open images', exact: true })).toBeEnabled();
    return;
  }
  if (pdf) {
    await readerOptions(page);
    await expect(page.getByRole('button', { name: 'View original PDF pages', exact: true })).toBeVisible();
    return;
  }
  await expect(page.getByTestId('reader-image-ready')).toBeVisible();
  await expect(page.getByRole('button', { name: orientation ? '日本語: untracked' : '東京: untracked', exact: true })).toBeVisible();
}

for (const width of [1500, 1080, 393]) {
test(`Reader toolbar stays one row and retains overflow controls at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await start(page);
  const home = await page.getByRole('button', { name: 'Home', exact: true }).boundingBox();
  for (const name of ['Previous page', 'Next page', 'Contents', 'View options']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    if (!home || !box) throw new Error('Reader navigation geometry is unavailable');
    expect(box.y).toBe(home.y);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  const toolbar = await page.getByTestId('reader-toolbar').boundingBox();
  const footer = await page.getByTestId('reader-status').boundingBox();
  if (!toolbar || !footer) throw new Error('Reader chrome geometry is unavailable');
  expect(footer.height).toBeLessThan(toolbar.height);
  if (width === 1500) {
    await expect(page.getByRole('combobox', { name: /^Image fit:/ })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^Page layout:/ })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('reader-single-row.png') });
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  if (width !== 1500) {
    await expect(page.getByRole('combobox', { name: /^Image fit:/ })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^Page layout:/ })).toBeVisible();
  }
  await expect(page.getByRole('combobox', { name: /^Page reading direction:/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recognize', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('reader-overflow-options.png') });
});
}

for (const width of [1080, 390]) {
test(`source image retry recovers original pixels without repeating recognition at ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await start(page, true);
  await page.evaluate(() => { window.__imageUriControl.available = false; });
  await page.getByRole('button', { name: 'Open images', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry image action', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId('reader-image-loading')).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('source-unavailable.png') });
  await page.evaluate(() => { window.__imageUriControl.available = true; });
  await retry.click();
  await expect(page.getByTestId('reader-image-ready')).toBeVisible();
  await expect(page.getByRole('button', { name: '東京: untracked', exact: true })).toBeVisible();
  const requests = await page.evaluate(() => window.__imageReaderRequests);
  expect(requests.filter(request => request.type === 'image_page_uri')).toHaveLength(2);
  expect(requests.filter(request => request.type === 'analyze_ocr')).toHaveLength(1);
  expect(requests.filter(request => request.type === 'recognize_image')).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('source-recovered.png') });
});
}

test('original PDF presentation does not analyze hidden document text during source navigation', async ({ page }) => {
  await start(page, false, null, true);
  await page.evaluate(() => window.__documentAnalysisControl.first);
  await page.getByRole('button', { name: 'View original PDF pages', exact: true }).click();
  await expect(page.getByTestId('reader-image-ready')).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByTestId('reader-position')).toHaveText('Page 2 of 3');
  expect(await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'analyze_document').length)).toBe(1);
  await readerOptions(page);
  await page.getByRole('button', { name: 'Read available PDF text', exact: true }).click();
  await page.evaluate(() => window.__documentAnalysisControl.second);
  expect(await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'analyze_document').length)).toBe(2);
});

for (const width of [1080, 390]) {
for (const orientation of ['topToBottom', 'vertical-rl'] as const) {
test(`vertical source tokens follow their original column for ${orientation} observations at ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await start(page, false, orientation);
  const first = await page.getByRole('button', { name: '日本語: untracked', exact: true }).boundingBox();
  const last = await page.getByRole('button', { name: '読む: untracked', exact: true }).boundingBox();
  const column = await page.locator('[data-ocr-region="line-0"]').boundingBox();
  expect(first).not.toBeNull(); expect(last).not.toBeNull(); expect(column).not.toBeNull();
  expect(first!.height).toBeGreaterThan(column!.height * 0.35);
  expect(last!.y).toBeGreaterThan(column!.y + column!.height * 0.5);
  expect(last!.y).toBeGreaterThanOrEqual(first!.y + first!.height - 1);
  expect(last!.x).toBeLessThan(first!.x + first!.width);
  expect(last!.x + last!.width).toBeGreaterThan(first!.x);
  await page.screenshot({ path: testInfo.outputPath('vertical-source-word-alignment.png') });
});
}
}

for (const folder of [false, true]) {
test(`Home admits an actual selected image ${folder ? 'folder' : 'collection'} through the existing native source owner`, async ({ page }, testInfo) => {
  if (!folder) await page.setViewportSize({ width: 390, height: 844 });
  await start(page, true);
  const entry = page.getByRole('button', { name: folder ? 'Open image folder' : 'Open images', exact: true });
  await entry.scrollIntoViewIfNeeded();
  const bounds = await entry.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  if (folder) expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('home-image-entry.png') });
  await entry.click();
  await expect(page.getByTestId('reader-image-ready')).toBeVisible();
  await expect(page.getByRole('button', { name: '東京: untracked', exact: true })).toBeVisible();
  const requests = await page.evaluate(() => window.__imageReaderRequests);
  expect(requests.find(request => request.type === 'pick_images')).toEqual({ type: 'pick_images', folder });
  expect(requests.find(request => request.type === 'import_image_collection')).toMatchObject({
    packageId: 'package', paths: ['/fixture/one.png', '/fixture/two.png', '/fixture/three.png'], title: 'Original image collection',
  });
  await page.screenshot({ path: testInfo.outputPath('home-image-admitted.png') });
});
}

test('source entry requires an explicit replacement for an unavailable language', async ({ page }) => {
  await start(page, true);
  for (const [route, action] of [['reader', 'Open document'], ['watch', 'Open local video']]) {
    await page.goto(`/${route}?packageId=unavailable-package`);
    await expect(page.getByRole('alert')).toHaveText('The selected source language is unavailable. Choose an installed package.');
    await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled();
    await page.getByRole('combobox', { name: /^Source language:/ }).click();
    await page.getByRole('option', { name: 'Fixture language', exact: true }).click();
    await expect(page.getByRole('button', { name: action, exact: true })).toBeEnabled();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
});

test('cancelled native image selection cannot admit or navigate a late picker result', async ({ page }) => {
  await start(page, true);
  await page.evaluate(() => { window.__imageImportControl.hold = true; });
  await page.getByRole('button', { name: 'Open images', exact: true }).click();
  await page.evaluate(() => window.__imageImportControl.entered);
  await page.getByRole('button', { name: 'Cancel image opening', exact: true }).click();
  await page.evaluate(() => {
    if (!window.__imageImportControl.release) throw new Error('Native image selection was not held');
    window.__imageImportControl.release();
  });
  await expect(page.getByRole('button', { name: 'Open images', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'import_image_collection'))).toHaveLength(0);
  await expect(page.getByTestId('reader-image-ready')).toHaveCount(0);
});

test('source practice retries one frozen request and opens its actually admitted shared encounter', async ({ page }, testInfo) => {
  await start(page);
  await readerOptions(page);
  await page.getByRole('button', { name: 'Page words', exact: true }).click();
  const words = page.getByRole('dialog', { name: 'Page words', exact: true });
  await words.getByRole('button', { name: 'Practice saved words in this view', exact: true }).click();
  await expect(words.getByRole('alert')).toContainText('Practice admission receipt lost');
  await words.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Page words', exact: true })).toBeFocused();
  await (await readerOptions(page)).getByRole('button', { name: 'Close', exact: true }).click();
  await readerOptions(page);
  await page.getByRole('button', { name: 'Page words', exact: true }).click();
  await expect(words.getByRole('alert')).toContainText('Practice admission receipt lost');
  await words.getByRole('button', { name: 'Retry original Word Practice request', exact: true }).click();
  await expect(page).toHaveURL(/\/review\?sessionId=/);
  await expect(page.getByText('Word Practice', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reveal', exact: true })).toBeVisible();
  const starts = await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'review'));
  expect(starts).toHaveLength(2);
  expect(starts[1]).toEqual(starts[0]);
  expect(starts[0]).toMatchObject({ command: { kind: 'start', start: { mode: { kind: 'practice', items: [{
    materialId: 'saved-tokyo', source: { text: '東京', locator: { kind: 'image', resourceId: 'image-0',
      ocrRevision: 1, regionId: 'line-0', contextStart: 0, selectionStart: 0, selectionEnd: 6 } },
  }] } } } });
  await page.screenshot({ path: testInfo.outputPath('source-word-native-practice-entry.png') });
});

for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'narrow', width: 390, height: 844 }]) {
test(`recognition correction retains uncertain identity, refreshes alignment and exposes original evidence on ${viewport.name}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await start(page);
  await readerOptions(page);
  await page.getByRole('button', { name: 'Recognition details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recognition and alignment', exact: true });
  await page.screenshot({ path: testInfo.outputPath('recognition-region-draft.png') });
  await dialog.getByRole('textbox', { name: 'Recognized text', exact: true }).fill('東京都');
  await dialog.getByRole('textbox', { name: 'Top left X', exact: true }).fill('15');
  await dialog.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Correction receipt lost');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recognition details', exact: true })).toBeFocused();
  await (await readerOptions(page)).getByRole('button', { name: 'Close', exact: true }).click();
  await readerOptions(page);
  await page.getByRole('button', { name: 'Recognition details', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Correction receipt lost');
  await expect(dialog.getByRole('textbox', { name: 'Recognized text', exact: true })).toHaveValue('東京都');
  await dialog.getByRole('button', { name: 'Retry same correction', exact: true }).click();
  await expect(dialog.getByText(/recognition revision 2/)).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Recognized text', exact: true }).fill('Unsaved draft');
  await dialog.getByRole('button', { name: 'Load current saved recognition', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Recognized text', exact: true })).toHaveValue('東京都');
  await dialog.getByRole('button', { name: 'Inspect saved evidence', exact: true }).click();
  await expect(page.getByTestId('ocr-evidence')).toContainText('"ocrRevision": 2');
  await dialog.getByRole('button', { name: 'Inspect parent revision 1', exact: true }).click();
  await expect(page.getByTestId('ocr-evidence')).toContainText('"ocrRevision": 1');
  const raw = JSON.parse(await page.getByTestId('ocr-evidence').innerText());
  expect(raw.result.regions[0].text).toBe('東京');
  expect(raw.correction).toBeNull();
  const corrections = await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'correct_ocr'));
  expect(corrections).toHaveLength(2); expect(corrections[1]).toEqual(corrections[0]);
  expect(corrections[0]).toMatchObject({ correction: { expectedRevision: 1,
    region: { text: '東京都', quad: { topLeft: { x: 0.15 } } } } });
  await page.screenshot({ path: testInfo.outputPath('recognition-correction-evidence.png') });
  await page.keyboard.press('Escape');
  await (await readerOptions(page)).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('reader-image-ready')).toBeVisible();
  await expect(page.getByRole('button', { name: '東京都: untracked', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'image_page_uri' && request.crop === null).length)).toBe(1);
});
}

for (const width of [1080, 393]) {
test(`cancelled dragged crop does not reopen recognition with Reader options at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await start(page);
  await readerOptions(page);
  await page.getByRole('button', { name: 'Select crop', exact: true }).click();
  const image = await page.getByRole('img', { name: 'Page 1', exact: true }).boundingBox();
  if (!image) throw new Error('Original image geometry is unavailable');
  await page.mouse.move(image.x + image.width * 0.25, image.y + image.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(image.x + image.width * 0.6, image.y + image.height * 0.7);
  await page.mouse.up();
  const recognition = page.getByRole('dialog', { name: 'Recognize source image', exact: true });
  await expect(recognition).toBeVisible();
  expect(Number(await recognition.getByRole('textbox', { name: 'Left (%)', exact: true }).inputValue())).toBeCloseTo(25, 0);
  expect(Number(await recognition.getByRole('textbox', { name: 'Width (%)', exact: true }).inputValue())).toBeCloseTo(35, 0);
  await recognition.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recognize', exact: true })).toBeFocused();
  await (await readerOptions(page)).getByRole('button', { name: 'Close', exact: true }).click();
  const options = await readerOptions(page);
  await expect(options).toBeVisible();
  await expect(recognition).toHaveCount(0);
  await expect(options.getByRole('combobox', { name: /^Page reading direction:/ })).toBeVisible();
  expect(await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'recognize_image'))).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('crop-cancelled-options-reopened.png') });
});
}

test('explicit crop recognition uses original coordinates and keeps unrelated saved regions and source pixels', async ({ page }) => {
  await start(page);
  await readerOptions(page);
  await page.getByRole('button', { name: 'Recognize', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recognize source image', exact: true });
  await dialog.getByRole('combobox', { name: /^Recognition provider:/ }).click();
  await page.getByRole('option', { name: 'Fixture on-device provider', exact: true }).click({ timeout: 5000 });
  await dialog.getByRole('button', { name: 'Selected region', exact: true }).click();
  for (const [label, value] of [['Left (%)', '60'], ['Top (%)', '60'], ['Width (%)', '20'], ['Height (%)', '20']])
    await dialog.getByRole('textbox', { name: label, exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Recognize selected region', exact: true }).click();
  await expect(page.getByRole('button', { name: '区域: untracked', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '東京: untracked', exact: true })).toBeVisible();
  await expect(page.getByTestId('reader-image-ready')).toBeVisible();
  const calls = await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'recognize_image'));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ request: { sourceId: 'scan-book', resourceId: 'image-0',
    contentRevision: 'original-pixels', providerId: 'fixture-sdk', crop: { x: 0.6, y: 0.6, width: 0.2, height: 0.2 } } });
  expect(await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'image_page_uri' && request.crop === null).length)).toBe(1);
});

for (const entry of ['keyboard', 'rail', 'contents'] as const) {
test(`${entry} source navigation cancels running recognition without waiting for SDK completion or publishing its stale result`, async ({ page }) => {
  await start(page);
  await page.evaluate(() => { window.__imageOcrControl.hold = true; });
  await readerOptions(page);
  await page.getByRole('button', { name: 'Recognize', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recognize source image', exact: true });
  await dialog.getByRole('combobox', { name: /^Recognition provider:/ }).click();
  await page.getByRole('option', { name: 'Fixture on-device provider', exact: true }).click({ timeout: 5000 });
  await dialog.getByRole('button', { name: 'Recognize page', exact: true }).click();
  await page.evaluate(() => window.__imageOcrControl.entered);
  if (entry === 'keyboard') {
    await page.getByRole('document', { name: 'Image pages', exact: true }).focus();
    await page.keyboard.press('PageDown');
  } else if (entry === 'rail') {
    await page.getByRole('button', { name: 'Read image-1 page-1', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Page 2', exact: true }).click();
  }
  await expect(page.getByTestId('reader-position')).toHaveText('Page 2 of 3');
  await expect(page.getByRole('button', { name: '大阪: untracked', exact: true })).toBeVisible();
  const cancelled = await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'cancel_ocr'));
  expect(cancelled).toHaveLength(1);
  await page.evaluate(() => {
    if (!window.__imageOcrControl.release) throw new Error('Native inference was not held');
    window.__imageOcrControl.release();
  });
  await page.evaluate(() => window.__imageOcrControl.finished);
  await expect(page.getByRole('button', { name: 'Cancel recognition', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('reader-position')).toHaveText('Page 2 of 3');
  await expect(page.getByRole('button', { name: '東京: untracked', exact: true })).toHaveCount(0);
});
}

for (const failure of ['cancelled', 'committed'] as const) {
test(`recognition retry resolves native ${failure} state without resurrecting or duplicating inference`, async ({ page }) => {
  await start(page);
  await page.evaluate(failure => { window.__imageOcrControl.fail = failure; }, failure);
  await readerOptions(page);
  await page.getByRole('button', { name: 'Recognize', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recognize source image', exact: true });
  await dialog.getByRole('combobox', { name: /^Recognition provider:/ }).click();
  await page.getByRole('option', { name: 'Fixture on-device provider', exact: true }).click({ timeout: 5000 });
  await dialog.getByRole('button', { name: 'Recognize page', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(failure === 'cancelled' ? 'cancelled before publication' : 'completion receipt lost');
  await page.getByRole('button', { name: 'Retry image action', exact: true }).click();
  await readerOptions(page);
  await page.getByRole('button', { name: 'Recognition details', exact: true }).click();
  await expect(page.getByText(/recognition revision 2/)).toBeVisible();
  const requests = await page.evaluate(() => window.__imageReaderRequests);
  const inference = requests.filter(request => request.type === 'recognize_image');
  expect(inference).toHaveLength(failure === 'cancelled' ? 2 : 1);
  expect(requests.filter(request => request.type === 'ocr_recovery')).toHaveLength(1);
  if (failure === 'cancelled') expect(inference[0]).not.toEqual(inference[1]);
});
}

test('original image targets open shared Inspector and RTL pairing preserves original page membership', async ({ page }, testInfo) => {
  await start(page);
  await page.getByRole('button', { name: '東京: untracked', exact: true }).click();
  await expect(page.getByTestId('inspector-panel')).toBeVisible();
  await expect(page.getByTestId('inspector-panel').getByText('Tokyo', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('image-reader-desktop-inspector.png') });
  await page.keyboard.press('Escape');
  await readerOptions(page);
  await page.getByRole('combobox', { name: /^Page layout:/ }).click();
  await page.getByRole('option', { name: 'Double page', exact: true }).click();
  await (await readerOptions(page)).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('img', { name: /^Page [12]$/ })).toHaveCount(2);
  await readerOptions(page);
  await page.getByRole('combobox', { name: /^Page reading direction:/ }).click();
  await page.getByRole('option', { name: 'Right to left', exact: true }).click();
  await (await readerOptions(page)).getByRole('button', { name: 'Close', exact: true }).click();
  const first = await page.getByRole('img', { name: 'Page 1', exact: true }).boundingBox();
  const second = await page.getByRole('img', { name: 'Page 2', exact: true }).boundingBox();
  expect(first).not.toBeNull(); expect(second).not.toBeNull();
  expect(first!.x).toBeGreaterThan(second!.x);
  await expect(page.getByTestId('reader-position')).toHaveText('Page 1–2 of 3');
  await page.screenshot({ path: testInfo.outputPath('image-reader-spread-rtl.png') });
});

test('narrow image fit keeps a real source and its interactive region inside the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await start(page);
  const image = await page.getByRole('img', { name: 'Page 1', exact: true }).boundingBox();
  const word = await page.getByRole('button', { name: '東京: untracked', exact: true }).boundingBox();
  expect(image).not.toBeNull(); expect(word).not.toBeNull();
  expect(word!.x).toBeGreaterThanOrEqual(image!.x);
  expect(word!.y).toBeGreaterThanOrEqual(image!.y);
  expect(word!.x + word!.width).toBeLessThanOrEqual(image!.x + image!.width + 1);
  expect(word!.y + word!.height).toBeLessThanOrEqual(image!.y + image!.height + 1);
  await page.screenshot({ path: testInfo.outputPath('image-reader-narrow.png') });
});

for (const width of [1080, 393]) {
test(`Inspector sense selection stays beside its heading and captures the chosen meaning at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await start(page, false, null, false, true);
  await page.getByRole('button', { name: '東京: untracked', exact: true }).click();
  const inspector = page.getByTestId('inspector-panel');
  const first = inspector.getByRole('button', { name: 'Select sense 1 for capture', exact: true });
  const second = inspector.getByRole('button', { name: 'Select sense 2 for capture', exact: true });
  await expect(second).toBeVisible();
  const heading = await inspector.getByText('place', { exact: true }).boundingBox();
  const selector = await second.boundingBox();
  if (!heading || !selector) throw new Error('Sense heading and selection must be laid out');
  await page.screenshot({ path: testInfo.outputPath('inspector-sense-selection.png') });
  expect(selector.y).toBeLessThan(heading.y + heading.height);
  expect(selector.y + selector.height).toBeGreaterThan(heading.y);
  expect(selector.width).toBeLessThan(selector.height * 2);
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await inspector.getByRole('button', { name: 'Capture this context: 東京', exact: true }).click();
  await expect(inspector.getByText('Saved · captured-tokyo · revision 1', { exact: true })).toBeVisible();
  const captures = await page.evaluate(() => window.__imageReaderRequests.filter(request => request.type === 'capture_materials'));
  expect(captures).toHaveLength(1);
  expect(captures[0]).toMatchObject({ batch: { commands: [{ content: {
    sense: { heading: 'place', labels: ['place'], definitions: ['Tokyo metropolitan area'], notes: [] },
    meaning: 'Tokyo metropolitan area',
    source: { sourceId: 'scan-book' },
  } }] } });
});

test(`Inspector footer keeps shared pill actions on one scrolling row at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await start(page);
  await page.getByRole('button', { name: '東京: untracked', exact: true }).click();
  const footer = page.getByTestId('inspector-footer');
  const knowledge = footer.getByRole('button', { name: /^Knowledge/ });
  await expect(knowledge).toBeVisible();
  const actions = footer.getByRole('button');
  await expect(actions).toHaveCount(4);
  const geometry = await actions.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { top: rect.top, radius: style.borderRadius, material: style.backgroundImage };
  }));
  for (const action of geometry) {
    expect(action.top).toBe(geometry[0].top);
    expect(action.radius).toBe(geometry[0].radius);
    expect(action.material).toContain('linear-gradient');
  }
  const overflow = await footer.evaluate(node => node.scrollWidth > node.clientWidth);
  expect(overflow).toBe(width === 393);
  const explain = footer.getByRole('button', { name: 'Explain', exact: true });
  await explain.focus();
  const trailing = await explain.boundingBox();
  const viewport = await footer.boundingBox();
  if (!trailing || !viewport) throw new Error('Inspector footer geometry is unavailable');
  expect(trailing.x).toBeGreaterThanOrEqual(viewport.x);
  expect(trailing.x + trailing.width).toBeLessThanOrEqual(viewport.x + viewport.width);
  if (width === 1080) {
    await page.setViewportSize({ width: 393, height: 900 });
    const close = page.getByRole('button', { name: 'Close Inspector', exact: true });
    await expect(close).toBeInViewport();
    const panel = await page.getByTestId('inspector-panel').boundingBox();
    if (!panel) throw new Error('Resized Inspector geometry is unavailable');
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(393);
  }
  await page.screenshot({ path: testInfo.outputPath(`inspector-footer-${width}.png`) });
});

test(`Escape dismisses Knowledge before its Inspector at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await start(page);
  const word = page.getByRole('button', { name: '東京: untracked', exact: true });
  await word.click();
  const inspector = page.getByTestId('inspector-panel');
  const knowledge = inspector.getByRole('button', { name: /^Knowledge/ });
  await knowledge.click();
  const claim = inspector.getByRole('button', { name: 'Claim Reading known', exact: true });
  await claim.focus();
  await page.keyboard.press('Escape');
  await expect(claim).toHaveCount(0);
  await expect(inspector).toBeVisible();
  await expect(knowledge).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(inspector).toHaveCount(0);
  await expect(word).toBeFocused();
});
}

test('source Inspector capture actions remain readable on their shared media material', async ({ page }, testInfo) => {
  await start(page);
  await page.getByRole('button', { name: '東京: untracked', exact: true }).click();
  const action = page.getByRole('button', { name: 'Open saved 東京', exact: true });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();
  // Axe cannot infer a sibling backdrop-filter layer. Check the actual active
  // action foreground against both extremes of that shared translucent material.
  const foreground = (await page.getByRole('button', { name: 'Exclude capture 東京', exact: true })
    .getByText('Exclude capture 東京', { exact: true }).evaluate(node => getComputedStyle(node).color))
    .match(/\d+(?:\.\d+)?/g)?.map(Number);
  expect(foreground).toHaveLength(3);
  const panel = resolveTheme(initialTheme).media.panel;
  const alpha = Number.parseInt(panel.slice(7, 9), 16) / 255;
  const luminance = (rgb: number[]) => rgb.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const source of [0, 255]) {
    const background = [1, 3, 5].map(offset => Number.parseInt(panel.slice(offset, offset + 2), 16) * alpha + source * (1 - alpha));
    const a = luminance(foreground!), b = luminance(background);
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
  expect((await new AxeBuilder({ page }).include('[data-testid="inspector-panel"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('image-reader-capture-contrast.png') });
});

test('publisher concealment changes only its actual pixel region and keyboard reveal preserves original source data', async ({ page }, testInfo) => {
  await start(page);
  const region = page.locator('[data-ocr-reading="reading-0"]');
  const original = await region.screenshot();
  const source = await page.getByRole('img', { name: 'Page 1', exact: true }).getAttribute('src');
  const admitted = await page.evaluate(() => window.__imageReaderRequests.length);
  await readerOptions(page);
  await page.getByRole('button', { name: 'Hide publisher readings', exact: true }).click();
  await (await readerOptions(page)).getByRole('button', { name: 'Close', exact: true }).click();
  const reveal = page.getByRole('button', { name: 'Reveal reading annotation', exact: true });
  await expect(reveal).toBeVisible();
  const concealed = await region.screenshot({ path: testInfo.outputPath('publisher-reading-concealed.png') });
  expect(concealed.equals(original)).toBe(false);
  await reveal.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Hide reading annotation: とうきょう', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  expect((await region.screenshot({ path: testInfo.outputPath('publisher-reading-revealed.png') })).equals(original)).toBe(true);
  await expect(page.getByRole('img', { name: 'Page 1', exact: true })).toHaveAttribute('src', source!);
  expect(await page.evaluate(offset => window.__imageReaderRequests.slice(offset)
    .filter(request => ['complete_ocr', 'correct_ocr', 'analyze_ocr'].includes(String(request.type))), admitted)).toEqual([]);
});

test('held image lens samples original pixels, wheel zoom is transient and release restores source interactions', async ({ page }, testInfo) => {
  await start(page);
  const word = await page.getByRole('button', { name: '東京: untracked', exact: true }).boundingBox();
  expect(word).not.toBeNull();
  await page.mouse.move(word!.x + word!.width / 2, word!.y + word!.height / 2);
  await page.keyboard.down('z');
  const lens = page.getByRole('img', { name: 'Source image magnifier', exact: true });
  await expect(lens).toBeVisible();
  await expect(lens).toHaveAttribute('aria-busy', 'false');
  await expect(lens).toContainText('2.0×');
  await page.screenshot({ path: testInfo.outputPath('native-pixel-source-lens.png') });
  await page.mouse.wheel(0, -10);
  await expect(lens).toHaveAttribute('aria-busy', 'false');
  await expect(lens).toContainText('2.3×');
  await page.keyboard.up('z');
  await expect(lens).toHaveCount(0);
  await expect(page.getByRole('button', { name: '東京: untracked', exact: true })).toBeVisible();
  await page.keyboard.down('z');
  await expect(lens).toContainText('2.0×');
  await page.keyboard.up('z');
  expect(await page.evaluate(() => window.__imageReaderRequests.some(request =>
    request.type === 'image_page_uri' && request.crop !== null))).toBe(true);
});

test('pending availability leaves a short source word on one readable line', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await start(page);
  await page.evaluate(() => { window.__imageEligibilityControl.hold = true; });
  const entered = page.evaluate(() => window.__imageEligibilityControl.entered);
  await readerOptions(page);
  await page.getByRole('button', { name: 'Page words', exact: true }).click();
  await entered;
  const words = page.getByRole('dialog', { name: 'Page words', exact: true });
  try {
    await expect(words.getByText('Checking capture availability…', { exact: true })).toBeVisible();
    const lines = await words.getByRole('button', { name: '東京: untracked', exact: true }).evaluate(node => {
      const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const tops = new Set<number>();
      for (let current = text.nextNode(); current; current = text.nextNode()) {
        if (!current.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(current);
        for (const rect of range.getClientRects()) {
          if (rect.width && rect.height) tops.add(Math.round(rect.top * 100) / 100);
        }
      }
      return tops.size;
    });
    await page.screenshot({ path: testInfo.outputPath('pending-source-word.png') });
    expect(lines).toBe(1);
  } finally {
    await page.evaluate(() => { window.__imageEligibilityControl.hold = false; window.__imageEligibilityControl.release?.(); });
  }
  await expect(words.getByRole('button', { name: 'Open saved 東京', exact: true })).toBeVisible();
});

for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'narrow', width: 390, height: 844 }]) {
test(`page word operations reuse shared capture and Inspector and locate the exact original token on ${viewport.name}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await start(page);
  await readerOptions(page);
  await page.getByRole('button', { name: 'Page words', exact: true }).click();
  const words = page.getByRole('dialog', { name: 'Page words', exact: true });
  await expect(words.getByRole('button', { name: 'Open saved 東京', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('source-word-sidebar.png') });
  const token = words.getByRole('button', { name: '東京: untracked', exact: true });
  await token.click();
  await expect(page.getByTestId('inspector-panel')).toBeVisible();
  await expect(page.getByTestId('inspector-panel').getByText('Tokyo', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(words).toBeVisible();
  await words.getByRole('button', { name: 'Capture this context: 東京', exact: true }).click();
  const receipt = words.getByText('Saved · captured-tokyo · revision 1', { exact: true });
  await expect(receipt).toBeVisible();
  await page.setViewportSize({ width: viewport.width === 1280 ? 390 : 1280, height: viewport.height });
  await expect(receipt).toBeVisible();
  await page.setViewportSize(viewport);
  await expect(receipt).toBeVisible();
  await words.getByRole('button', { name: 'Locate 東京', exact: true }).click();
  await expect(words).toHaveCount(0);
  const original = page.locator('[data-ocr-region="line-0"] [data-source-start="0"][data-source-end="6"]');
  await expect(original).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByTestId('reader-position')).toHaveText('Page 1 of 3');
  await page.screenshot({ path: testInfo.outputPath('source-word-original-location.png') });
});
}
