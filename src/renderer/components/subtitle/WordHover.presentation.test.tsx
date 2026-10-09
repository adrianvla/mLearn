// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { DEFAULT_SETTINGS, type DictionaryEntry, type Token } from '../../../shared/types';
import { WordHover } from './WordHover';
import { StableWordHover } from './StableWordHover';
import { OcrWord } from '../reader/OcrWord';
import { useWordHover, type HoverData } from '../../hooks/useWordHover';
import { surfaceKnowledgeInspection } from '../../services/surfaceKnowledgeInspection';

const inspect = vi.hoisted(() => vi.fn());
const savedCard = vi.hoisted(() => vi.fn().mockResolvedValue('card-id'));
const tokenizeContent = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('../../services/openKnowledgeInspector', async original => ({
  ...await original<typeof import('../../services/openKnowledgeInspector')>(), openKnowledgeInspector: inspect,
}));

const [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS });

vi.mock('../../context', () => ({
  useSettings: () => ({ settings, updateSettings: (next: object) => setSettings(next) }),
  useLocalization: () => ({ t: (key: string) => key }),
  useFlashcards: () => ({
    addFlashcard: savedCard, getCardByWordSync: () => null,
    getComprehensiveWordStatusWithSourceSync: () => ({ status: 'unknown' }),
    isKnowledgeReady: () => true,
    getAccessStatus: () => ({ status: 'unknown', ease: 0, source: 'None', untracked: true }),
    trackWordHovered: vi.fn(), cancelWordHover: vi.fn(),
  }),
  useLanguage: () => ({
    currentLangData: () => null, getFrequency: () => null,
    getLevelName: () => '', getFreqLevelNames: () => ({}),
    getLanguageFeatures: () => ({ tokenizerCapabilities: {} }),
    getCanonicalForm: (word: string) => word, getWordVariants: (word: string) => [word],
    getReadingVariants: (reading: string) => [reading],
  }),
}));
vi.mock('../../hooks/useDictionaryTargetLanguage', () => ({ useDictionaryTargetLanguage: () => () => 'en' }));
vi.mock('../../hooks/useTranslation', () => ({ cacheVersion: () => 0, getCachedReading: () => null,
  useTokenizer: () => ({ tokenize: tokenizeContent }), getCachedTranslation: () => null }));
vi.mock('../../services/llmProvider', () => ({ getCachedExplanation: () => null }));
vi.mock('../common/Smart', () => ({ ResourcePill: (props: { onAdd?: () => void }) => <button data-testid="save-card" onClick={props.onAdd}>Save</button>,
  WordStatusPill: (props: { onInspect?: () => void; onModalOpenChange?: (open: boolean) => void; cycleClaims?: boolean; suppressKnowledgePopover?: boolean }) =>
    <button data-testid="status-record" data-cycle-claims={String(props.cycleClaims === true)}
      data-nested-popover={String(!props.suppressKnowledgePopover)} onMouseEnter={() => props.onModalOpenChange?.(true)}
      onMouseLeave={() => props.onModalOpenChange?.(false)} onClick={props.onInspect}>Status</button>,
}));

describe('shared popup presentation', () => {
  let host: HTMLDivElement;
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    setSettings({ ...DEFAULT_SETTINGS });
    inspect.mockClear();
  });
  afterEach(() => { dispose?.(); host.remove(); });

  it('distinguishes unavailable lookup from a successful empty definition and retries explicitly', () => {
    const retry = vi.fn();
    dispose = render(() => <WordHover word="form" token={{ word: 'form', actual_word: 'form', type: 'noun' }} position={{ x: 200, y: 200 }} lookupFailed onRetryLookup={retry} />, host);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain('mlearn.WordHover.NoTranslation');
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('mlearn.Knowledge.Retry'))!.click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('retains dictionary alternatives and updates an open popup from shared preferences', () => {
    dispose = render(() => <WordHover word="form" token={{ word: 'form', actual_word: 'form', type: 'noun' }} position={{ x: 200, y: 200 }}
      translationData={{ data: [{ definitions: 'short meaning' }] }}
      dictionaryEntries={[
        { word: 'form', reading: '', meanings: ['first distinct meaning'] },
        { word: 'form', reading: '', meanings: ['second distinct meaning'] },
      ]} />, host);
    const popup = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(popup.textContent).toContain('short meaning');
    expect(popup.textContent).toContain('first distinct meaning');
    expect(popup.textContent).toContain('second distinct meaning');
    expect(popup.style.getPropertyValue('--word-hover-scale')).toBe('1');
    setSettings({ showReadingAnnotations: false });
    expect(popup.classList.contains('word-hover--readings-hidden')).toBe(true);
    setSettings({ showReadingAnnotations: true });
    expect(popup.classList.contains('word-hover--readings-hidden')).toBe(false);
    setSettings({ wordHoverSizePercent: 75 });
    expect(popup.style.getPropertyValue('--word-hover-scale')).toBe('0.75');
    setSettings({ wordHoverSizePercent: Infinity });
    expect(popup.style.getPropertyValue('--word-hover-scale')).toBe('1');
  });

  it('keeps the compact rating popup on the status pill while Inspect opens the full evidence view', () => {
    setSettings({ language: 'future-language' });
    dispose = render(() => <WordHover word="walk" token={{ word: 'walked', actual_word: 'walk', type: 'verb' }}
      position={{ x: 200, y: 200 }} translationData={{ data: [{ definitions: 'go on foot' }] }} />, host);
    const status = host.querySelector<HTMLButtonElement>('[data-testid="status-record"]')!;
    expect(status.dataset.cycleClaims).toBe('false');
    expect(status.dataset.nestedPopover).toBe('true');
    status.click();
    expect(inspect).not.toHaveBeenCalled();
    host.querySelector<HTMLButtonElement>('.word-hover-inspect')!.click();
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith(surfaceKnowledgeInspection(settings.language, 'walk'));
  });

  it('keeps the popup mounted while its target data and geometry update', () => {
    const token: Token = { word: 'walk', actual_word: 'walk', type: 'verb' };
    const [data, setData] = createSignal<HoverData>({
      token, word: 'walk', position: { x: 200, y: 200 }, translation: { data: [{ definitions: 'go on foot', reading: '' }] },
      element: host, lookupWord: 'walk', language: 'en',
    });
    dispose = render(() => (
      <StableWordHover data={data}>
        {(current) => <WordHover token={current().token!} word={current().word} position={current().position} translationData={current().translation ?? undefined} />}
      </StableWordHover>
    ), host);
    const popup = host.querySelector('.subtitle_hover');
    setData((current) => ({ ...current, position: { x: 260, y: 220 } }));
    expect(host.querySelector('.subtitle_hover')).toBe(popup);
    expect(host.querySelector('.word-hover-headword')?.textContent).toBe('walk');
    setData((current) => ({ ...current, token: { word: 'run', actual_word: 'run', type: 'verb' }, word: 'run', lookupWord: 'run' }));
    expect(host.querySelector('.subtitle_hover')).toBe(popup);
    expect(host.querySelector('.word-hover-headword')?.textContent).toBe('run');
  });

  it('routes same-occurrence key-hover movement through the owner without refetching or remounting', () => {
    setSettings({ ...DEFAULT_SETTINGS, readerWordHoverTrigger: 'key-hover', readerWordHoverKey: 'Alt' });
    const token: Token = { word: 'walk', surface: 'walk', actual_word: 'walk', type: 'verb' };
    const entries: DictionaryEntry[] = [{ word: 'walk', reading: '', meanings: ['go on foot'] }];
    const requests = vi.fn();
    const Fixture = () => {
      const hover = useWordHover();
      const [dictionaryEntries, setDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
      const onOpen = vi.fn((currentToken: Token, event: MouseEvent) => {
        const element = event.currentTarget as HTMLElement;
        const rect = element.getBoundingClientRect();
        const opened = {
          word: currentToken.surface ?? currentToken.word,
          token: currentToken,
          translation: null,
          position: { x: rect.left + rect.width / 2, y: rect.top },
          anchorRect: rect,
          element,
          lookupWord: currentToken.actual_word,
          language: 'en',
          trackPassiveHover: true,
          contextIdentity: 'walk in a sentence',
        };
        if (!hover.showHover(opened)) return;
        requests();
        setDictionaryEntries(entries);
      });
      const onMove = (currentToken: Token, event: MouseEvent) => {
        const element = event.currentTarget as HTMLElement;
        const current = hover.hoverData();
        if (!current) return;
        const rect = element.getBoundingClientRect();
        hover.updateHoverPosition({
          ...current,
          token: currentToken,
          position: { x: rect.left + rect.width / 2, y: rect.top },
          anchorRect: rect,
        });
      };
      return <>
        <OcrWord token={token} onWordEnter={onOpen} onWordMove={onMove} onWordLeave={hover.hideHover} />
        <StableWordHover data={hover.hoverData}>
          {(current) => current().token ? <WordHover
            token={current().token!}
            word={current().word}
            position={current().position}
            anchorRect={current().anchorRect}
            dictionaryEntries={dictionaryEntries()}
            visible={hover.isVisible()}
            onMouseEnter={hover.cancelHide}
            onMouseLeave={hover.hideHover}
          /> : null}
        </StableWordHover>
      </>;
    };
    dispose = render(() => <Fixture />, host);

    const word = host.querySelector('.ocr-word')!;
    word.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    const popup = host.querySelector('.subtitle_hover');
    expect(host.textContent).toContain('go on foot');
    word.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    word.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    expect(requests).toHaveBeenCalledOnce();
    expect(host.querySelector('.subtitle_hover')).toBe(popup);
    expect(host.textContent).toContain('go on foot');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false }));
  });

  it('keeps the outer popup open while a nested status surface owns interaction', () => {
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    dispose = render(() => <WordHover word="walk" token={{ word: 'walk', actual_word: 'walk', type: 'verb' }}
      position={{ x: 200, y: 200 }} onMouseEnter={onEnter} onMouseLeave={onLeave} />, host);

    host.querySelector<HTMLButtonElement>('[data-testid="status-record"]')!.dispatchEvent(new MouseEvent('mouseenter'));
    host.querySelector('.subtitle_hover')!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(onLeave).not.toHaveBeenCalled();

    host.querySelector<HTMLButtonElement>('[data-testid="status-record"]')!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});


it('keeps an admitted save in its original language across a delayed content capture', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  setSettings({ ...DEFAULT_SETTINGS, language: 'original-source' });
  let resolve!: (tokens: Token[]) => void;
  tokenizeContent.mockImplementationOnce(() => new Promise<Token[]>(done => { resolve = done; }));
  savedCard.mockClear();
  const dispose = render(() => <WordHover word="original-word" token={{ word: 'original-word', actual_word: 'original-word', type: 'unknown' }}
    position={{ x: 20, y: 20 }} isOCR={true} contextPhrase="original context" lastScreenshot="data:image/png;base64,eA=="
    translationData={{ data: [{ definitions: ['original meaning'] }] }} />, host);
  try {
    host.querySelector<HTMLButtonElement>('[data-testid="save-card"]')!.click();
    await vi.waitFor(() => expect(tokenizeContent).toHaveBeenCalledWith('original context'));
    setSettings({ language: 'new-source' });
    resolve([{ word: 'original', actual_word: 'original', type: 'unknown' }]);
    await vi.waitFor(() => expect(savedCard).toHaveBeenCalled());
    expect(savedCard.mock.calls[0][0]).toMatchObject({ front: 'original-word', back: 'original meaning' });
    expect(savedCard.mock.calls[0][3]).toBe('original-source');
  } finally { dispose(); host.remove(); tokenizeContent.mockReset().mockResolvedValue([]); }
});
