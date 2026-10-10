import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComponent, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { LanguageDataInstallProgress } from '../../shared/types';
import { LanguageProvider, useLanguage } from './LanguageContext';

interface Request { requestId: string; sourceKey: string }
interface Publication extends Request { catalog: Array<{ language: string; name: string }> }
const boundary = vi.hoisted(() => ({
  settings: {} as typeof DEFAULT_SETTINGS,
  loading: (() => false) as () => boolean,
  catalog: undefined as undefined | ((value: Publication) => void),
  installed: undefined as undefined | ((value: unknown) => void),
  invalidated: undefined as undefined | (() => void),
  progress: undefined as undefined | ((value: LanguageDataInstallProgress) => void),
  installError: undefined as undefined | ((value: unknown) => void),
  install: vi.fn(),
  getCatalog: vi.fn<(request: Request) => void>(),
  onCatalog: vi.fn(),
}));
vi.mock('./SettingsContext', () => ({ useSettings: () => ({ settings: boundary.settings, isLoading: boundary.loading }) }));
vi.mock('../../shared/bridges', () => ({ getBridge: () => ({ localization: {
  getLangData: vi.fn(), onLangData: () => () => {},
  getLanguageDataCatalog: boundary.getCatalog,
  onLanguageDataCatalog: (cb: (value: Publication) => void) => { boundary.onCatalog(); boundary.catalog = cb; return () => {}; },
  onLanguageDataCatalogInvalidated: (cb: () => void) => { boundary.invalidated = cb; return () => {}; },
  onLanguageDataInstalled: (cb: (value: unknown) => void) => { boundary.installed = cb; return () => {}; },
  onLanguageDataInstallProgress: (cb: (value: LanguageDataInstallProgress) => void) => { boundary.progress = cb; return () => {}; },
  onLanguageDataInstallError: (cb: (value: unknown) => void) => { boundary.installError = cb; return () => {}; },
  installLanguageData: boundary.install,
} }) }));
let dispose: (() => void) | undefined;
let update: ReturnType<typeof createStore<typeof DEFAULT_SETTINGS>>[1];
let setLoading: (value: boolean) => void;
beforeEach(() => {
  vi.clearAllMocks();
  const [settings, setter] = createStore({ ...DEFAULT_SETTINGS, languageCatalogUrl: 'https://catalog.example/a.json' });
  boundary.settings = settings; update = setter;
  const [loading, setterLoading] = createSignal(false);
  boundary.loading = loading; setLoading = setterLoading;
  boundary.catalog = undefined; boundary.installed = undefined; boundary.invalidated = undefined;
});
afterEach(() => { dispose?.(); dispose = undefined; });
async function mount(nested = false) {
  let ctx!: ReturnType<typeof useLanguage>;
  createRoot(done => {
    dispose = done;
    createComponent(LanguageProvider, { get children() {
      ctx = useLanguage();
      return nested ? createComponent(LanguageProvider, { language: 'future-source', get children() { useLanguage(); return null; } }) : null;
    } });
  });
  await Promise.resolve();
  return ctx;
}
const request = () => boundary.getCatalog.mock.calls.at(-1)![0];
const publish = (req: Request, version: string) => boundary.catalog!({ ...req, catalog: [{ language: 'future-source', name: version }] });

describe('mounted catalog acquisition owner', () => {
  it('refuses an unready install observably and retires old failed jobs when a retry is admitted', async () => {
    const ctx = await mount();
    expect(ctx.installLanguageData('future-source')).toBe(false);
    expect(boundary.install).not.toHaveBeenCalled();
    publish(request(), 'ready');
    expect(ctx.installLanguageData('future-source')).toBe(true);
    const first = boundary.install.mock.calls.at(-1)![3];
    boundary.progress!({ operationId: first, language: 'future-source', components: ['core'], phase: 'error' });
    boundary.installError!({ operationId: first, language: 'future-source', error: 'controlled transfer failure' });
    expect(ctx.installLanguageData('future-source')).toBe(true);
    const retry = boundary.install.mock.calls.at(-1)![3];
    expect(ctx.languageDataInstallJobs()[first]).toBeUndefined();
    boundary.progress!({ operationId: first, language: 'future-source', components: ['core'], phase: 'error' });
    expect(ctx.languageDataInstallJobs()[first]).toBeUndefined();
    boundary.progress!({ operationId: retry, language: 'future-source', components: ['core'], phase: 'ready' });
    expect(ctx.languageDataInstallJobs()[retry].phase).toBe('ready');
    expect(ctx.isLanguageDataInstalling('future-source')).toBe(false);
  });
  it('waits for loaded Settings and shares the root request with scoped consumers', async () => {
    setLoading(true); const ctx = await mount(true);
    expect(boundary.getCatalog).not.toHaveBeenCalled();
    setLoading(false);
    expect(boundary.getCatalog).toHaveBeenCalledTimes(1);
    expect(boundary.onCatalog).toHaveBeenCalledTimes(1);
    publish(request(), 'a'); expect(ctx.languageDataCatalog()[0]).toMatchObject({ name: 'a' });
  });
  it('invalidates old descriptors immediately and rejects reversed and A-B-A responses', async () => {
    const ctx = await mount(); const a1 = request(); publish(a1, 'a1');
    update('languageCatalogUrl', 'https://catalog.example/b.json');
    expect(ctx.languageDataCatalog()).toEqual([]);
    const b = request(); expect(b.requestId).not.toBe(a1.requestId);
    publish(b, 'b'); publish(a1, 'stale-a');
    expect(ctx.languageDataCatalog()[0]).toMatchObject({ name: 'b' });
    update('languageCatalogUrl', 'https://catalog.example/a.json'); const a2 = request();
    expect(a2.sourceKey).toBe(a1.sourceKey); expect(a2.requestId).not.toBe(a1.requestId);
    publish(a2, 'a2'); publish(a1, 'stale-a'); publish(b, 'stale-b');
    expect(ctx.languageDataCatalog()[0]).toMatchObject({ name: 'a2' });
  });
  it('invalidates an in-flight status read after an installed-generation change', async () => {
    const ctx = await mount(); const before = request();
    boundary.invalidated!(); const after = request(); expect(after.requestId).not.toBe(before.requestId);
    publish(after, 'installed'); publish(before, 'not-installed');
    expect(ctx.languageDataCatalog()[0]).toMatchObject({ name: 'installed' });
  });
  it('accepts the installation ACK without importing captured old-source catalog descriptors', async () => {
    const ctx = await mount();
    update('languageCatalogUrl', 'https://catalog.example/b.json'); const current = request(); publish(current, 'b');
    boundary.installed!({ language: 'future-source', name: 'old-a', installedVersion: 'installed-a', operationId: 'owned-install' });
    expect(ctx.languageDataCatalog().some(row => row.name === 'old-a')).toBe(false);
    expect(boundary.getCatalog.mock.calls.length).toBeGreaterThan(1);
  });
});
