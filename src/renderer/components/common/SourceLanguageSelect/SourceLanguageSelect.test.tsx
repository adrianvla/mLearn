import { vi, it, expect } from 'vitest';
import { render } from 'solid-js/web';
import { createRoot } from 'solid-js';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import { useMediaSourceLanguage } from '../../../hooks/useMediaSourceLanguage';
import { SourceLanguageSelect } from './SourceLanguageSelect';
const kv = vi.hoisted(() => ({ rows: new Map<string, string>(), get: vi.fn(), set: vi.fn() }));
vi.mock('../../../../shared/bridges', () => ({ getBridge: () => ({ kvStore: { kvGet: kv.get, kvSet: kv.set } }) }));
vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: DEFAULT_SETTINGS }),
  useLanguage: () => ({ supportedLanguages: () => ['first', 'second'], langData: { first: { name: 'First Source' }, second: { name: 'Second Source' } } }),
}));

it('shows a labelled fallback, retains unfamiliar identifiers and exposes durable failure/retry', async () => {
  kv.rows.clear(); kv.get.mockImplementation(async (key: string) => kv.rows.get(key) ?? null);
  kv.set.mockImplementation(async (key: string, value: string) => { kv.rows.set(key, value); });
  let disposeScope!: () => void;
  const scope = createRoot(done => { disposeScope = done; return useMediaSourceLanguage(() => 'unfamiliar', () => undefined); });
  const prepared = await scope.prepare({ kind: 'book', resourceId: '/source' }); scope.adopt(prepared!);
  const host = document.createElement('div'); document.body.appendChild(host);
  const disposeRender = render(() => <SourceLanguageSelect scope={scope} />, host);
  try {
    const select = host.querySelector('select')!;
    expect(host.querySelector('label')?.textContent).toContain('mlearn.Media.SourceLanguage');
    expect(select.value).toBe('unfamiliar');
    expect(host.textContent).toContain('mlearn.Media.SourceLanguageFallback');
    kv.set.mockRejectedValueOnce(new Error('disk unavailable'));
    select.value = 'second'; select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    expect(scope.language()).toBe('unfamiliar');
    host.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(scope.language()).toBe('second'));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(JSON.parse([...kv.rows.values()][0]).override.language).toBe('second');
  } finally { disposeRender(); disposeScope(); host.remove(); }
});
