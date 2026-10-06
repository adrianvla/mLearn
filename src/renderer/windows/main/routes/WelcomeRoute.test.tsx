// @vitest-environment happy-dom
import { Show, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentItem } from '../../../services/thumbnailService';
const fixture = vi.hoisted(() => ({ navigate: vi.fn(), openWindow: vi.fn(), recent: [] as RecentItem[],
  language: 'future', updateSetting: vi.fn(), toast: vi.fn(),
  grammarResume: null as { context: { activity: string; patterns: string[] } } | null,
  review: undefined as { id: string } | undefined,
  presentation: undefined as { id: string; cardId: string } | undefined,
}));
vi.mock('../applicationHost', () => ({ useApplicationNavigate: () => fixture.navigate }));
vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: { language: fixture.language, uiLanguage: 'en' }, updateSetting: fixture.updateSetting }),
  useLocalization: () => ({ t: (key: string) => key }),
  useLanguage: () => ({
    currentLangData: () => ({ name: 'Future language', flagEmoji: 'package-flag' }),
    langData: { future: { name: 'Future language' }, de: { name: 'German', name_translated: 'Deutsch' } },
    supportedLanguages: () => ['future', 'de'],
    languageDataCatalog: () => [{ language: 'future', compatible: true }, { language: 'de', compatible: true }],
    getLanguageDataStatus: () => undefined,
  }),
  useFlashcards: () => ({ store: { flashcards: { card: { language: 'future' } }, meta: { reviewSessions: { future: fixture.review }, reviewPresentations: { future: fixture.presentation } } } }),
}));
vi.mock('../../../../shared/bridges', () => ({ getBridge: () => ({ window: { openWindow: fixture.openWindow } }) }));
vi.mock('../../../services/thumbnailService', () => ({ getRecentItems: async () => fixture.recent }));
vi.mock('../../../components/common/Feedback/Toast', () => ({ showToast: fixture.toast }));
vi.mock('./homeGrammarResume', () => ({ homeGrammarResume: () => fixture.grammarResume }));
vi.mock('./homePracticeResume', () => ({ homePracticeResume: () => null }));
vi.mock('../../../../shared/reviewSession', () => ({ reviewSessionHasAvailableCards: () => true }));
vi.mock('../../../components/common/Misc/AppLogo', () => ({ default: () => null }));
vi.mock('./components', async () => ({
  WelcomeFeatureCard: (await import('./components/WelcomeFeatureCard')).WelcomeFeatureCard,
  WelcomeReaderPreview: (await import('./components/WelcomeFeaturePreviews')).WelcomeReaderPreview,
  WelcomeVideoPreview: (await import('./components/WelcomeFeaturePreviews')).WelcomeVideoPreview,
  WelcomeContinueRow: (await import('./components/WelcomeContinueRow')).WelcomeContinueRow,
}));
vi.mock('../../../components/common', () => ({
  Button: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; class?: string; 'aria-haspopup'?: 'dialog' | 'menu' | 'true' | 'false' | 'listbox' | 'tree' | 'grid' | boolean; 'aria-expanded'?: boolean }) => (
    <button type="button" class={props.class} aria-haspopup={props['aria-haspopup']} aria-expanded={props['aria-expanded']} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  Select: (props: { value: string; onChange?: (event: Event & { currentTarget: HTMLSelectElement }) => void; options: Array<{ value: string; label: string; disabled?: boolean }> }) => (
    <select value={props.value} onChange={props.onChange}>
      {props.options.map(option => <option value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  ),
  Modal: (props: { isOpen: boolean; title?: JSX.Element | string; children?: JSX.Element; footer?: JSX.Element }) => (
    <Show when={props.isOpen}>
      <div role="dialog" aria-label={typeof props.title === 'string' ? props.title : undefined}>{props.children}<footer>{props.footer}</footer></div>
    </Show>
  ),
  BookIcon: () => null, VideoIcon: () => null, BotIcon: () => null, TargetIcon: () => null,
  LanguageVariantGate: () => null, LearningGoals: () => <span>no-target-filler</span>,
}));
import { WelcomeRoute } from './WelcomeRoute';

describe('purpose-led Home', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  const mount = async () => { dispose = render(() => <WelcomeRoute />, container); await Promise.resolve(); await Promise.resolve(); };
  const open = (title: string) => container.querySelector<HTMLButtonElement>(`button[aria-labelledby="${Array.from(container.querySelectorAll('h3')).find(h => h.textContent === title)?.id}"]`)!.click();
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); fixture.language = 'future'; fixture.grammarResume = null; fixture.review = undefined; fixture.presentation = undefined; fixture.recent = []; container = document.createElement('div'); document.body.append(container); });
  afterEach(() => { dispose?.(); container.remove(); });
  it('shows the current learning language as an accessible quick-switch action', async () => {
    await mount();
    expect(container.querySelector('.welcome-language-switch')?.tagName).toBe('BUTTON');
    expect(container.querySelector('.welcome-language-switch')?.textContent).toContain('mlearn.Home.UI.LearningLanguage');
    expect(container.querySelector('.welcome-language-switch')?.getAttribute('aria-haspopup')).toBe('dialog');
  });
  it('opens a keyboard-accessible language switcher and leaves settings unchanged when cancelled', async () => {
    await mount();
    const switcher = container.querySelector<HTMLButtonElement>('.welcome-language-switch');
    expect(switcher?.getAttribute('aria-haspopup')).toBe('dialog');
    switcher!.click();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.Cancel')!.click();
    expect(fixture.updateSetting).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it('applies a selected learning language through the shared settings updater', async () => {
    await mount();
    container.querySelector<HTMLButtonElement>('.welcome-language-switch')!.click();
    const select = container.querySelector<HTMLSelectElement>('select')!;
    select.value = 'de';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fixture.updateSetting).toHaveBeenCalledWith('language', 'de');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it('keeps five recognizable activities with no raw next-answer recommendation', async () => {
    await mount();
    expect(Array.from(container.querySelectorAll('h3')).map(h => h.textContent)).toEqual([
      'mlearn.Home.Today.Read', 'mlearn.Home.Today.Watch', 'mlearn.Product.Messenger', 'mlearn.Flashcards.UI.Title', 'mlearn.Product.Evaluate',
    ]);
    expect(container.textContent).not.toContain('mlearn.Home.Today.Next');
    expect(container.textContent).not.toContain('no-target-filler');
  });
  it('opens Review when an unrelated grammar pass is retained', async () => {
    fixture.grammarResume = { context: { activity: 'grammar', patterns: ['private upcoming cue'] } };
    await mount(); open('mlearn.Flashcards.UI.Title');
    expect(fixture.navigate).not.toHaveBeenCalled();
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'flashcards', context: { activity: 'review', intent: 'start', returnTo: 'home' } });
    expect(container.textContent).not.toContain('private upcoming cue');
    Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('mlearn.Product.GrammarPractice'))!.click();
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'level-study', context: { activity: 'grammar', patterns: ['private upcoming cue'], intent: 'resume', returnTo: 'home' } });
  });
  it('opens saved conversation without requiring a configured LLM', async () => {
    await mount(); open('mlearn.Product.Messenger'); expect(fixture.navigate).toHaveBeenCalledWith('/messenger');
  });
  it('opens Evaluate without admitting practice', async () => {
    await mount(); open('mlearn.Product.Evaluate'); expect(fixture.navigate).toHaveBeenCalledWith('/evaluate'); expect(fixture.openWindow).not.toHaveBeenCalled();
  });
  it('resumes a continuous Review cursor by its exact identity without a finite boundary', async () => {
    fixture.presentation = { id: 'continuous-choice', cardId: 'card' }; await mount();
    Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('mlearn.Flashcards.UI.Tabs.Review'))!.click();
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'flashcards', context: { activity: 'review', intent: 'resume', sessionId: 'continuous-choice', returnTo: 'home' } });
  });
  it('resumes an identified review separately from generic Open', async () => {
    fixture.review = { id: 'retained-review' }; await mount();
    Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('mlearn.Flashcards.UI.Tabs.Review'))!.click();
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'flashcards', context: { activity: 'review', intent: 'resume', sessionId: 'retained-review', returnTo: 'home' } });
  });
  it('continues actual source material with subtitle identity and keeps preview controls independent', async () => {
    fixture.recent = [{ type: 'video', name: 'Saved film', path: '/copied/film.mp4', subtitlePath: '/copied/film.vtt', progress: 31, lastWatched: 1 }];
    await mount(); container.querySelector<HTMLButtonElement>('.wfv-play')!.click();
    expect(sessionStorage.getItem('mlearn_open_video')).toBe('/copied/film.mp4');
    expect(sessionStorage.getItem('mlearn_open_video_subtitles')).toBe('/copied/film.vtt');
    expect(fixture.navigate).toHaveBeenCalledWith('/video');
    expect(fixture.navigate).toHaveBeenCalledOnce();
  });
  it('shows and opens each recent source with its own progress and subtitle identity', async () => {
    fixture.recent = [
      { type: 'video', name: 'Film one', path: '/media/one.mp4', subtitlePath: '/subs/one.vtt', progress: 31, lastWatched: 3 },
      { type: 'book', name: 'Book two', path: '/books/two.epub', progress: 62, lastWatched: 2 },
      { type: 'video', name: 'Film three', path: '/media/three.mp4', subtitlePath: '/subs/three.vtt', progress: 87, lastWatched: 1 },
    ];
    await mount();
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('.welcome-recent-list .welcome-continue-main'));
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual([
      'Film one, mlearn.Global.Continue', 'Book two, mlearn.Global.Continue', 'Film three, mlearn.Global.Continue',
    ]);
    expect(Array.from(container.querySelectorAll('.welcome-recent-list progress')).map(progress => progress.getAttribute('value')))
      .toEqual(['31', '62', '87']);
    rows[2].click();
    expect(sessionStorage.getItem('mlearn_open_video')).toBe('/media/three.mp4');
    expect(sessionStorage.getItem('mlearn_open_video_subtitles')).toBe('/subs/three.vtt');
    expect(fixture.navigate).toHaveBeenCalledWith('/video');
    expect(fixture.navigate).toHaveBeenCalledOnce();
  });
  it('opens the selected recent book by its persisted source path', async () => {
    fixture.recent = [
      { type: 'video', name: 'Film', path: '/media/film.mp4', subtitlePath: '/subs/film.vtt', progress: 31, lastWatched: 2 },
      { type: 'book', name: 'Saved chapter', path: '/books/chapter.epub', progress: 62, lastWatched: 1 },
    ];
    await mount();
    const bookRow = Array.from(container.querySelectorAll<HTMLButtonElement>('.welcome-recent-list .welcome-continue-main'))
      .find(row => row.getAttribute('aria-label') === 'Saved chapter, mlearn.Global.Continue');
    expect(bookRow).toBeDefined();
    bookRow!.click();
    expect(sessionStorage.getItem('mlearn_open_book')).toBe('/books/chapter.epub');
    expect(fixture.navigate).toHaveBeenCalledWith('/reader');
    expect(fixture.navigate).toHaveBeenCalledOnce();
  });
  it('does not reuse old subtitles for a different saved video', async () => {
    sessionStorage.setItem('mlearn_open_video_subtitles', 'other');
    fixture.recent = [{ type: 'video', name: 'Film', path: '/film.mp4', progress: 0, lastWatched: 1 }]; await mount();
    container.querySelector<HTMLButtonElement>('.wfv-play')!.click(); expect(sessionStorage.getItem('mlearn_open_video_subtitles')).toBeNull();
  });
  it('recovers from a recent item without a usable path through the existing open flow', async () => {
    fixture.recent = [{ type: 'book', name: 'Unavailable book', path: ' ', progress: 15, lastWatched: 1 }];
    await mount();
    container.querySelector<HTMLButtonElement>('.welcome-recent-list .welcome-continue-main')!.click();
    expect(fixture.toast).toHaveBeenCalledWith({ message: 'mlearn.Home.Errors.UnableToOpen', variant: 'error' });
    expect(fixture.navigate).toHaveBeenCalledWith('/reader');
  });
});
