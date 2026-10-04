// @vitest-environment happy-dom
import { type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentItem } from '../../../services/thumbnailService';
const fixture = vi.hoisted(() => ({ navigate: vi.fn(), openWindow: vi.fn(), recent: [] as RecentItem[],
  grammarResume: null as { context: { activity: string; patterns: string[] } } | null,
  review: undefined as { id: string } | undefined,
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => fixture.navigate }));
vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: { language: 'future', uiLanguage: 'en' } }),
  useLocalization: () => ({ t: (key: string) => key }),
  useLanguage: () => ({ currentLangData: () => ({ name: 'Future language' }) }),
  useFlashcards: () => ({ store: { meta: { reviewSessions: { future: fixture.review } } } }),
}));
vi.mock('../../../../shared/bridges', () => ({ getBridge: () => ({ window: { openWindow: fixture.openWindow } }) }));
vi.mock('../../../services/thumbnailService', () => ({ getRecentItems: async () => fixture.recent }));
vi.mock('./homeGrammarResume', () => ({ homeGrammarResume: () => fixture.grammarResume }));
vi.mock('./homePracticeResume', () => ({ homePracticeResume: () => null }));
vi.mock('../../../../shared/reviewSession', () => ({ reviewSessionHasAvailableCards: () => true }));
vi.mock('../../../components/common/Misc/AppLogo', () => ({ default: () => null }));
vi.mock('./components', async () => ({
  WelcomeFeatureCard: (await import('./components/WelcomeFeatureCard')).WelcomeFeatureCard,
  WelcomeReaderPreview: (await import('./components/WelcomeFeaturePreviews')).WelcomeReaderPreview,
  WelcomeVideoPreview: (await import('./components/WelcomeFeaturePreviews')).WelcomeVideoPreview,
}));
vi.mock('../../../components/common', () => ({
  Button: (props: { children?: JSX.Element; onClick?: () => void }) => <button onClick={props.onClick}>{props.children}</button>,
  BookIcon: () => null, VideoIcon: () => null, BotIcon: () => null, TargetIcon: () => null,
  LanguageVariantGate: () => null, LearningGoals: () => <span>no-target-filler</span>,
}));
import { WelcomeRoute } from './WelcomeRoute';

describe('purpose-led Home', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  const mount = async () => { dispose = render(() => <WelcomeRoute />, container); await Promise.resolve(); await Promise.resolve(); };
  const open = (title: string) => container.querySelector<HTMLButtonElement>(`button[aria-labelledby="${Array.from(container.querySelectorAll('h3')).find(h => h.textContent === title)?.id}"]`)!.click();
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); fixture.grammarResume = null; fixture.review = undefined; fixture.recent = []; container = document.createElement('div'); document.body.append(container); });
  afterEach(() => { dispose?.(); container.remove(); });
  it('keeps five recognizable activities with no raw next-answer recommendation', async () => {
    await mount();
    expect(Array.from(container.querySelectorAll('h3')).map(h => h.textContent)).toEqual([
      'mlearn.Home.Today.Read', 'mlearn.Home.Today.Watch', 'mlearn.Product.Messenger', 'mlearn.Product.Practise', 'mlearn.Product.Evaluate',
    ]);
    expect(container.textContent).not.toContain('mlearn.Home.Today.Next');
    expect(container.textContent).not.toContain('no-target-filler');
  });
  it('opens Review when an unrelated grammar pass is retained', async () => {
    fixture.grammarResume = { context: { activity: 'grammar', patterns: ['private upcoming cue'] } };
    await mount(); open('mlearn.Product.Practise');
    expect(fixture.navigate).toHaveBeenCalledWith('/practise');
    expect(fixture.openWindow).not.toHaveBeenCalled();
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
  it('does not reuse old subtitles for a different saved video', async () => {
    sessionStorage.setItem('mlearn_open_video_subtitles', 'other');
    fixture.recent = [{ type: 'video', name: 'Film', path: '/film.mp4', progress: 0, lastWatched: 1 }]; await mount();
    container.querySelector<HTMLButtonElement>('.wfv-play')!.click(); expect(sessionStorage.getItem('mlearn_open_video_subtitles')).toBeNull();
  });
});
