import { batch, createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Token } from '../../../../shared/types';
import type { VideoWordEntry } from '../../../components/video';

const state = vi.hoisted(() => ({ language: (): string => 'source-a', source: (): string => 'resource-a',
  tokens: () => [] as Token[], sidebar: undefined as undefined | { words: () => VideoWordEntry[]; onAddWord: (entry: VideoWordEntry) => Promise<void> },
  add: vi.fn(), capture: vi.fn(), frame: vi.fn().mockResolvedValue(null), settings: {} as typeof DEFAULT_SETTINGS }));
const { idle, noOp } = vi.hoisted(() => ({ idle: () => false, noOp: () => undefined }));
vi.mock('@solidjs/router', () => ({ useNavigate: () => noOp }));
vi.mock('../../../context/LanguageContext', () => ({ LanguageProvider: (props: { children: JSX.Element }) => props.children }));
vi.mock('../../../hooks/useMediaSourceLanguage', () => ({ useMediaSourceLanguage: () => ({
  language: () => state.language(), sourceKey: () => state.source(), variantId: () => null,
  active: () => ({ source: { resourceId: state.source() } }), prepare: async () => ({}), adopt: () => true,
}) }));
vi.mock('../../../hooks/useDictionaryTargetLanguage', () => ({ useDictionaryTargetLanguage: () => () => 'en' }));
vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: state.settings, updateSetting: noOp }),
  useLanguage: () => ({ currentLangData: () => ({ name: state.language(), settings: { fixed: {} } }),
    supportedLanguages: () => [], getLanguageFeatures: () => ({ tokenizerCapabilities: {} }),
    isTokenTranslatable: () => true, getFrequency: () => undefined, getCanonicalForm: (word: string) => word,
    getWordVariants: () => [], getReadingVariants: () => [], }),
  useFlashcards: () => ({ isWordIgnoredSync: idle, isWordKnownWhenWrittenSync: idle,
    getCardByWordSync: noOp, getComprehensiveWordStatusWithSourceSync: () => ({}),
    getComprehensiveWordStatusSync: () => ({}), addFlashcard: state.add, captureSuggestedFlashcard: state.capture }),
}));
vi.mock('../../../hooks', () => ({
  useSubtitles: () => ({ tokens: () => state.tokens(), currentIndex: () => state.tokens().length ? 0 : -1,
    currentSubtitle: () => ({ text: 'authored subtitle', start: 0, end: 1 }), subtitles: () => [], loadSubtitles: noOp }),
  useWatchTogether: () => ({ isActive: idle, isRoomMode: idle, isAnticipatingPing: idle, canControl: idle,
    mode: () => 'idle', roomState: () => null, roomSession: () => null, remoteSubtitle: () => null }),
  useMediaStats: () => ({ stats: () => ({ wordsEncountered: {}, grammarEncountered: {} }),
    setMedia: noOp, eventContext: () => undefined, saveError: () => null, retrySaveStats: noOp }),
}));
vi.mock('../../../../shared/platform', () => ({ isElectron: idle }));
vi.mock('../../../../shared/bridges', () => ({ getBridge: () => ({
  window: { onOpenAside: () => noOp, onContextMenuCommand: () => noOp },
  overlay: { onOverlayRequestSync: () => noOp, sendOverlayVideoState: noOp, sendOverlaySubtitleTracks: noOp },
  files: {},
}) }));
vi.mock('../../../components/common', () => ({ Button: (p: { children: JSX.Element }) => <button>{p.children}</button>,
  Panel: (p: { children: JSX.Element }) => <div>{p.children}</div>, SourceLanguageSelect: () => null, VideoIcon: () => null, Spinner: () => null }));
vi.mock('../../../components/common/MediaUsageSaveStatus/MediaUsageSaveStatus', () => ({ MediaUsageSaveStatus: () => null }));
vi.mock('../../../components/utils/WindowDragRegion', () => ({ WindowDragRegion: () => null }));
vi.mock('../../../components/video', () => ({ VideoPlayer: () => null,
  VideoUnknownWordsSidebar: (props: NonNullable<typeof state.sidebar>) => { state.sidebar = props; return <div data-testid="vocabulary">{props.words().map(row => row.word).join(',')}</div>; } }));
vi.mock('../../../components/cloud', () => ({ CloudReLoginModal: () => null }));
vi.mock('../../../components/watchTogether', () => ({ WatchTogetherCodeModal: () => null, WatchTogetherModeModal: () => null }));
vi.mock('../../../components/subtitle', () => ({ SubtitleSync: () => null }));
vi.mock('../../../components/subtitle/ExplainerPopup', () => ({ ExplainerPopup: () => null }));
vi.mock('../../../services/thumbnailService', async original => ({ ...await original<typeof import('../../../services/thumbnailService')>(),
  saveToRecentItems: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../utils/suggestedFlashcards', async original => ({ ...await original<typeof import('../../../utils/suggestedFlashcards')>(),
  filterSuggestedWords: async (words: string[]) => new Set(words),
}));
vi.mock('../../../services/flashcardImageCapture', () => ({ captureVideoFrameForFlashcard: (...args: unknown[]) => state.frame(...args) }));
vi.mock('./videoPluginActivity', () => ({ syncVideoPluginActivity: noOp }));
import { VideoRoute } from './VideoRoute';

describe('mounted Video vocabulary admission', () => {
  it('clears old rows and dedupe and rejects a retained save callback across source/resource changes', async () => {
    state.settings = { ...DEFAULT_SETTINGS, language: 'study', rightSidebarOpen: true, autoSuggestFlashcards: false };
    const [language, setLanguage] = createSignal('source-a'), [source, setSource] = createSignal('resource-a');
    const [tokens, setTokens] = createSignal<Token[]>([]);
    state.language = language; state.source = source; state.tokens = tokens; state.add.mockClear();
    sessionStorage.setItem('mlearn_open_video', '/real-owner-boundary.mp4');
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <VideoRoute />, host);
    try {
      await vi.waitFor(() => expect(state.sidebar).toBeDefined());
      setTokens([{ word: 'shared-spelling', actual_word: 'shared-spelling', type: 'package-category' }]);
      expect(state.sidebar!.words().map(row => row.word)).toEqual(['shared-spelling']);
      const oldEntry = state.sidebar!.words()[0], oldSave = state.sidebar!.onAddWord;
      batch(() => { setTokens([]); setLanguage('source-b'); setSource('resource-b'); });
      expect(state.sidebar!.words()).toEqual([]);
      await oldSave(oldEntry);
      expect(state.add).not.toHaveBeenCalled();
      setTokens([{ word: 'shared-spelling', actual_word: 'shared-spelling', type: 'package-category' }]);
      expect(state.sidebar!.words().map(row => row.word)).toEqual(['shared-spelling']);
      expect(state.sidebar!.words()[0]).not.toBe(oldEntry);
    } finally { dispose(); host.remove(); sessionStorage.clear(); state.sidebar = undefined; }
  });
  it('does not let a delayed old capture completion alter new-source dedupe or in-flight state', async () => {
    state.settings = { ...DEFAULT_SETTINGS, language: 'study', rightSidebarOpen: true, autoSuggestFlashcards: true, enable_flashcard_creation: true };
    const [language, setLanguage] = createSignal('source-a'), [source, setSource] = createSignal('resource-a');
    const [tokens, setTokens] = createSignal<Token[]>([]);
    state.language = language; state.source = source; state.tokens = tokens;
    let finishOld!: () => void, finishNew!: () => void;
    state.capture.mockReset().mockImplementationOnce(() => new Promise<void>(resolve => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishNew = resolve; }));
    sessionStorage.setItem('mlearn_open_video', '/real-owner-boundary.mp4');
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <VideoRoute />, host);
    const token = { word: 'same-spelling', actual_word: 'same-spelling', type: 'package-category' };
    try {
      await vi.waitFor(() => expect(state.sidebar).toBeDefined());
      setTokens([token]);
      await vi.waitFor(() => expect(state.capture).toHaveBeenCalledTimes(1));
      expect(state.capture.mock.calls[0][0]).toMatchObject({ language: 'source-a', word: 'same-spelling' });
      batch(() => { setTokens([]); setLanguage('source-b'); setSource('resource-b'); });
      setTokens([token]);
      await vi.waitFor(() => expect(state.capture).toHaveBeenCalledTimes(2));
      expect(state.capture.mock.calls[1][0]).toMatchObject({ language: 'source-b', word: 'same-spelling' });
      finishOld(); await Promise.resolve(); await Promise.resolve();
      setTokens([{ ...token }]);
      await Promise.resolve(); await Promise.resolve();
      expect(state.capture).toHaveBeenCalledTimes(2);
      expect(state.sidebar!.words()).toHaveLength(1);
      finishNew(); await Promise.resolve();
    } finally { finishOld?.(); finishNew?.(); dispose(); host.remove(); sessionStorage.clear(); state.sidebar = undefined; }
  });

});
