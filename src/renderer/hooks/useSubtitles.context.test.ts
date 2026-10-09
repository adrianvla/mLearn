import { createRoot, createSignal } from 'solid-js';
import { IDBFactory } from 'fake-indexeddb';
import type { Token, LanguageData } from '../../shared/types';

const state = vi.hoisted(() => ({ settings: { language: 'ru', subsOffsetTime: 0, removeSpeakerNames: false }, data: undefined as (() => LanguageData) | undefined }));
const backend = vi.hoisted(() => ({ tokenize: vi.fn() }));
vi.mock('../context', () => ({ useSettings: () => ({ settings: state.settings }), useLanguage: () => ({ currentLangData: state.data }) }));
vi.mock('../../shared/backends', () => ({ getBackend: () => backend }));

const subtitle = '1\n00:00:01,000 --> 00:00:03,000\n婚約者\n';

describe('mounted subtitle NLP context', () => {
  beforeEach(() => { vi.resetModules(); backend.tokenize.mockReset(); vi.stubGlobal('indexedDB', new IDBFactory()); });
  afterEach(() => vi.unstubAllGlobals());
  it('uses the warm source language and does not publish a delayed prior language into the current cue', async () => {
    const [language, setLanguage] = createSignal('ru');
    state.settings = { get language() { return language(); }, subsOffsetTime: 0, removeSpeakerNames: false };
    state.data = () => ({ languageData: { version: language() + '-v1', assets: [] }, runtime: { nlp: { tokenizer: { type: 'none' } } } }) as unknown as LanguageData;
    let resolve!: (tokens: Token[]) => void;
    backend.tokenize.mockImplementationOnce(() => new Promise<Token[]>(done => { resolve = done; }));
    const { useSubtitles } = await import('./useSubtitles');
    let dispose!: () => void;
    const hook = createRoot(done => { dispose = done; return useSubtitles(); });
    try {
      hook.loadSubtitles(subtitle);
      const old = hook.updateTime(2);
      await vi.waitFor(() => expect(backend.tokenize).toHaveBeenCalledWith('婚約者', 'ru'));
      setLanguage('ja');
      resolve([{ word: 'old', actual_word: 'old', type: 'unknown' }]);
      await old;
      expect(hook.tokens()).toEqual([]);
      backend.tokenize.mockResolvedValueOnce([{ word: '婚約者', actual_word: '婚約者', type: 'unknown' }]);
      await hook.updateTime(2);
      expect(backend.tokenize).toHaveBeenLastCalledWith('婚約者', 'ja');
      expect(hook.tokens().map(token => token.word)).toEqual(['婚約者']);
    } finally { dispose(); }
  });
});
