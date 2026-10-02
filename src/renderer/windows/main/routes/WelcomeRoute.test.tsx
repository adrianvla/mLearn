// @vitest-environment happy-dom
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentItem } from '../../../services/thumbnailService';

const fixture = vi.hoisted(() => ({
  openWindow: vi.fn(), navigate: vi.fn(), retry: vi.fn(), notify: vi.fn(), configure: vi.fn(),
  recent: [] as RecentItem[], source: false, llm: false, mobile: false,
  progress: { tracked: 0, known: 0, total: 0 },
  settings: { language: 'test-language', uiLanguage: 'en', simplifyHomeScreen: false },
}));
const [knowledgeReady, setKnowledgeReady] = createSignal(true);
const [projectionReady, setProjectionReady] = createSignal(true);
const [projectionFailed, setProjectionFailed] = createSignal(false);
const [due, setDue] = createSignal(0);
vi.mock('@solidjs/router', () => ({ useNavigate: () => fixture.navigate }));
vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: fixture.settings }),
  useLocalization: () => ({ t: (key: string, params?: Record<string, string>) => `${key}${params ? JSON.stringify(params) : ''}` }),
  useLanguage: () => ({ currentLangData: () => fixture.source ? { name: 'Test language' } : null, isLoading: () => false }),
  useFlashcards: () => ({ store: { wordKnowledge: {}, dailyStats: {} }, isLoading: () => false, isKnowledgeReady: knowledgeReady, queueCounts: () => ({ total: due() }) }),
}));
vi.mock('../../../../shared/bridges', () => ({ getBridge: () => ({ window: { openWindow: fixture.openWindow } }) }));
vi.mock('../../../../shared/platform', () => ({ isMobile: () => fixture.mobile }));
vi.mock('../../../services/thumbnailService', () => ({ getRecentItems: async () => fixture.recent }));
vi.mock('../../../services/llmProvider', () => ({ isLLMReady: () => fixture.llm }));
vi.mock('../../../services/capabilityUnavailable', () => ({ notifyCapabilityUnavailable: fixture.notify, openCapabilitySettings: fixture.configure }));
vi.mock('../../../hooks/useEvidenceLinkedProjections', () => ({ useEvidenceLinkedProjections: () => ({ ready: projectionReady, failed: projectionFailed, retry: fixture.retry, resolveState: () => ({ status: 'unknown', basis: 'unmeasured' }) }) }));
vi.mock('../../../utils/wordLevelStats', () => ({
  getLevelStudyFrequency: () => fixture.source ? { item: 'level' } : null,
  getLevelStudyLevelNames: () => ['level'], computeLevelStats: () => [{}], summarizeLevelProgress: () => fixture.progress,
}));
vi.mock('../../../../shared/languageFeatures', () => ({ getLearningLanguageLevelForLanguage: () => null, isFrequencyLevelAtOrEasierThanTarget: () => true }));
vi.mock('../../../components/utils/WindowDragRegion', () => ({ WindowDragRegion: () => null }));
vi.mock('./components', async () => ({ WelcomeContinueRow: (await import('./components/WelcomeContinueRow')).WelcomeContinueRow }));
vi.mock('@renderer/components/common/Misc/AppLogo', () => ({ default: () => null }));
vi.mock('../../../components/common', () => {
  const Icon = () => null;
  return {
    Button: (props: { children?: JSX.Element; onClick?: () => void; variant?: string }) => <button data-variant={props.variant} onClick={props.onClick}>{props.children}</button>,
    Panel: (props: { children?: JSX.Element; class?: string }) => <div class={props.class}>{props.children}</div>,
    SkeletonRows: () => <span data-testid="loading" />,
    VideoIcon: Icon, BookIcon: Icon, BotIcon: Icon, TargetIcon: Icon, SearchIcon: Icon, BarChartIcon: Icon, LanguageVariantGate: Icon,
  };
});
import { WelcomeRoute } from './WelcomeRoute';

describe('Home next activity', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  const mount = async () => { dispose = render(() => <WelcomeRoute />, container); await Promise.resolve(); await Promise.resolve(); };
  const click = (key: string) => {
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.startsWith(key));
    expect(button, key).toBeDefined(); button!.click();
  };
  beforeEach(() => {
    vi.clearAllMocks(); setKnowledgeReady(true); setProjectionReady(true); setProjectionFailed(false); setDue(0);
    fixture.recent = []; fixture.source = false; fixture.progress = { tracked: 0, known: 0, total: 0 };
    fixture.llm = false; fixture.mobile = false; fixture.settings.simplifyHomeScreen = false;
    container = document.createElement('div'); document.body.append(container);
  });
  afterEach(() => { dispose?.(); container.remove(); sessionStorage.clear(); });
  it('opens the existing review destination without mounting a second rating controller', async () => {
    setDue(214); await mount();
    expect(container.querySelector('.welcome-next')?.textContent).toContain('"count":"214"');
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    expect(container.querySelector('input')).toBeNull();
    click('mlearn.Home.Today.ReviewAction');
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'flashcards' });
    expect(container.querySelector('[data-testid="flashcard-preview"]')).toBeNull();
  });
  it.each([
    [{ tracked: 10, known: 4, total: 20 }, 'PracticeAction', 'reinforce'],
    [{ tracked: 10, known: 10, total: 20 }, 'AssessmentAction', 'assessment'],
  ])('hands its learning-record recommendation directly to shared study: %s', async (progress, action, activity) => {
    fixture.source = true; fixture.progress = progress; await mount(); click(`mlearn.Home.Today.${action}`);
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'level-study', context: { activity } });
  });
  it('does not recommend from partially loaded learner knowledge', async () => {
    setKnowledgeReady(false); setDue(12); await mount();
    expect(container.querySelector('.welcome-next h2')).toBeNull();
    setKnowledgeReady(true);
    expect(container.querySelector('.welcome-next h2')?.textContent).toContain('mlearn.Home.Today.ReviewTitle');
  });
  it('offers retry instead of a recommendation when the required projection fails', async () => {
    fixture.source = true; setProjectionReady(false); setProjectionFailed(true); await mount();
    expect(container.querySelector('.welcome-next h2')).toBeNull(); click('mlearn.Knowledge.Retry'); expect(fixture.retry).toHaveBeenCalledOnce();
  });
  it('supports a package without a level curriculum without waiting forever or forcing assessment', async () => {
    setProjectionReady(false); await mount();
    expect(container.textContent).toContain('mlearn.Home.Today.PlanUnmeasured');
    click('mlearn.Home.Today.ReadAction'); expect(fixture.navigate).toHaveBeenCalledWith('/reader');
    expect(container.textContent).not.toContain('mlearn.Home.Today.AssessmentAction');
  });
  it('continues the most recent video with its linked subtitles', async () => {
    fixture.recent = [{ type: 'video', name: 'Film', path: '/film.mp4', subtitlePath: '/film.srt', lastWatched: Date.now(), progress: 40 }];
    await mount(); click('mlearn.Home.Today.ContinueAction');
    expect(sessionStorage.getItem('mlearn_open_video')).toBe('/film.mp4');
    expect(sessionStorage.getItem('mlearn_open_video_subtitles')).toBe('/film.srt');
    expect(fixture.navigate).toHaveBeenCalledWith('/video');
  });
  it('clears stale video context when a material row opens a book', async () => {
    sessionStorage.setItem('mlearn_open_video_subtitles', '/stale.srt');
    fixture.recent = [{ type: 'book', name: 'Book', path: '/book.epub', lastWatched: Date.now(), progress: 10 }];
    await mount(); container.querySelector<HTMLButtonElement>('.welcome-continue-main')!.click();
    expect(sessionStorage.getItem('mlearn_open_book')).toBe('/book.epub');
    expect(sessionStorage.getItem('mlearn_open_video_subtitles')).toBeNull();
    expect(fixture.navigate).toHaveBeenCalledWith('/reader');
  });
  it('explains unavailable conversation setup before opening settings', async () => {
    await mount(); click('mlearn.Home.Cards.AITutor.Title');
    expect(fixture.notify).toHaveBeenCalledWith('llm', 'notConfigured', expect.any(Function));
    expect(fixture.configure).toHaveBeenCalledWith('llm'); expect(fixture.openWindow).not.toHaveBeenCalled();
  });
  it('keeps the same journey in compact Home instead of substituting a feature catalogue', async () => {
    fixture.settings.simplifyHomeScreen = true; setDue(12); await mount(); click('mlearn.Home.Today.ReviewAction');
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'flashcards' });
    click('mlearn.Home.Today.ViewPlan'); expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'level-study', context: { activity: 'plan' } });
  });
});
