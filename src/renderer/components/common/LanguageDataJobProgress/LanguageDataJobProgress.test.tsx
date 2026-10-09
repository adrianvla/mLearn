import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageDataJobProgress } from './LanguageDataJobProgress';
vi.mock('../../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
it('renders distinct jobs with known byte progress and an indeterminate unknown-length download', () => {
  const container = document.createElement('div'); document.body.append(container);
  dispose = render(() => <LanguageDataJobProgress jobs={[
    { operationId: 'first', language: 'qx', dictionaryTargetLanguage: 'en', components: ['core'], phase: 'downloading', downloadedBytes: 42, expectedBytes: 100 },
    { operationId: 'second', language: 'qx', dictionaryTargetLanguage: 'fr', components: ['core'], phase: 'downloading', downloadedBytes: 17, expectedBytes: 0 },
  ]} />, container);
  const progress = container.querySelectorAll('progress');
  expect(progress[0].value).toBe(42);
  expect(progress[0].max).toBe(100);
  expect(progress[1].hasAttribute('value')).toBe(false);
  expect(container.textContent).toContain('qx → en');
  expect(container.textContent).toContain('qx → fr');
});
