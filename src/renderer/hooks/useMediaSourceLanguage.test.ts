import { createRoot } from 'solid-js';
const kv = vi.hoisted(() => ({ rows: new Map<string, string>(), get: vi.fn(), set: vi.fn() }));
vi.mock('../../shared/bridges', () => ({ getBridge: () => ({ kvStore: { kvGet: kv.get, kvSet: kv.set } }) }));
beforeEach(() => {
  vi.resetModules(); kv.rows.clear(); kv.get.mockReset(); kv.set.mockReset();
  kv.get.mockImplementation(async (key: string) => kv.rows.get(key) ?? null);
  kv.set.mockImplementation(async (key: string, value: string) => { kv.rows.set(key, value); });
});

it('adopts only the latest source and pins fallback across study switches', async () => {
  const { useMediaSourceLanguage } = await import('./useMediaSourceLanguage');
  let study = 'ru'; let dispose!: () => void;
  const scope = createRoot(done => { dispose = done; return useMediaSourceLanguage(() => study, () => undefined); });
  try {
    let resolveOld!: (value: string | null) => void;
    kv.get.mockImplementationOnce(() => new Promise<string | null>(done => { resolveOld = done; }));
    const old = scope.prepare({ kind: 'book', resourceId: '/old' }, ['old-source']);
    const next = await scope.prepare({ kind: 'book', resourceId: '/new' });
    expect(scope.adopt(next!)).toBe(true);
    study = 'ja';
    expect(scope.language()).toBe('ru');
    resolveOld(null);
    expect(await old).toBeNull();
    expect(scope.active()?.source.resourceId).toBe('/new');
  } finally { dispose(); }
});

it('keeps latest selection and saving state coherent through two overlapping acknowledged writes', async () => {
  const { useMediaSourceLanguage } = await import('./useMediaSourceLanguage');
  let dispose!: () => void;
  const scope = createRoot(done => { dispose = done; return useMediaSourceLanguage(() => 'fallback', () => undefined); });
  try {
    const prepared = await scope.prepare({ kind: 'book', resourceId: '/source' }); scope.adopt(prepared!);
    const pending: Array<() => void> = [];
    kv.set.mockImplementation((key: string, value: string) => new Promise<void>(done => pending.push(() => { kv.rows.set(key, value); done(); })));
    const first = scope.select({ language: 'first' });
    const second = scope.select({ language: 'second' });
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
    pending.shift()!(); await first;
    expect(scope.saving()).toBe(true);
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
    pending.shift()!(); await second;
    expect(scope.language()).toBe('second');
    expect(scope.saving()).toBe(false);
    expect(JSON.parse([...kv.rows.values()][0]).override.language).toBe('second');
  } finally { dispose(); }
});
