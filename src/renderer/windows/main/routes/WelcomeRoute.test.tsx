// @vitest-environment happy-dom

import { createSignal, type Component, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const localization = vi.hoisted(() => ({
  translate: (key: string) => key,
}));

const settingsState = vi.hoisted(() => ({
  settings: {
    language: 'ja',
    uiLanguage: 'en',
    known_ease_threshold: 3500,
    srsLearningThreshold: 1500,
    simplifyHomeScreen: false,
  },
}));

vi.mock('@solidjs/router', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings: settingsState.settings,
  }),
  useLocalization: () => ({ t: (key: string) => localization.translate(key) }),
  useLanguage: () => ({
    currentLangData: () => null,
    supportedLanguages: () => [],
    langData: {},
    isLoading: () => false,
    refreshLanguageData: vi.fn(),
    getCanonicalFormForLanguage: (_language: string, word: string) => word,
  }),
  useFlashcards: () => ({
    store: { flashcards: {}, dailyStats: {} },
    isLoading: () => false,
    queueCounts: () => ({ total: 0 }),
    getCurrentCard: () => null,
    getPreviewDueDates: () => null,
    dueDateToString: (_dueDate: number) => '',
    answerCard: vi.fn(),
  }),
}));

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({ window: { openWindow: vi.fn() } }),
}));

vi.mock('../../../../shared/platform', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../shared/platform')>(),
  isMobile: () => false,
}));
vi.mock('../../../services/thumbnailService', () => ({ getRecentItems: async () => [] }));
vi.mock('../../../services/llmProvider', () => ({ isLLMReady: () => false }));
vi.mock('../../../services/wordLookupService', () => ({ openWordLookup: vi.fn() }));
vi.mock('../../../components/utils/WindowDragRegion', () => ({ WindowDragRegion: () => null }));
vi.mock('../../../components/AITutorSetup', () => ({ AITutorSetupModal: () => null }));
vi.mock('@renderer/components/common/Misc/AppLogo', () => ({ default: () => <span /> }));

vi.mock('../../../components/common', () => {
  const Icon: Component = () => <span />;
  return {
    Btn: (props: { children?: JSX.Element; onClick?: () => void }) => (
      <button type="button" onClick={props.onClick}>{props.children}</button>
    ),
    Tooltip: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
    VideoIcon: Icon,
    BookIcon: Icon,
    SettingsIcon: Icon,
    BotIcon: Icon,
    BarChartIcon: Icon,
    TargetIcon: Icon,
    SearchIcon: Icon,
    LanguageVariantGate: () => null,
  };
});

vi.mock('../../../components/common/Card/ActionCard', () => ({
  ActionCard: (props: { title: string; description: string; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled}>
      <h3>{props.title}</h3>
      <p>{props.description}</p>
    </button>
  ),
}));

vi.mock('./components', () => {
  const Preview: Component = () => <div />;
  return {
    WelcomeFeatureCard: (props: { title: string; description: string; preview?: JSX.Element }) => (
      <article>
        <h3>{props.title}</h3>
        <p>{props.description}</p>
        {props.preview}
      </article>
    ),
    WelcomeVideoPreview: Preview,
    WelcomeReaderPreview: Preview,
    WelcomeFlashcardPreview: Preview,
    WelcomeSettingsPreview: Preview,
    WelcomeStatsPreview: Preview,
    WelcomeLookupPreview: Preview,
    WelcomeLevelPreview: Preview,
    WelcomeTutorPreview: Preview,
    WelcomeContinueRow: Preview,
  };
});

import { WelcomeRoute } from './WelcomeRoute';

describe('WelcomeRoute localization', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('updates route-owned labels when the localization function changes after mount', async () => {
    const [prefix, setPrefix] = createSignal('before');
    localization.translate = (key) => `${prefix()}:${key}`;
    const dispose = render(() => <WelcomeRoute />, container);

    expect(container.textContent).toContain('before:mlearn.Home.Cards.Video.Title');
    expect(container.textContent).toContain('before:mlearn.Home.UI.LearningLanguage');

    setPrefix('after');
    await Promise.resolve();

    expect(container.textContent).toContain('after:mlearn.Home.Cards.Video.Title');
    expect(container.textContent).toContain('after:mlearn.Home.UI.LearningLanguage');
    expect(container.textContent).not.toContain('before:mlearn.Home.Cards.Video.Title');

    dispose();
  });

  it('renders plain action buttons instead of feature cards when simplifyHomeScreen is enabled', async () => {
    settingsState.settings.simplifyHomeScreen = true;
    const dispose = render(() => <WelcomeRoute />, container);

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.some((b) => b.textContent?.includes('mlearn.Home.Cards.Video.Title'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('mlearn.Home.Cards.Reader.Title'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('mlearn.Home.Cards.AITutor.Title'))).toBe(true);

    const articles = container.querySelectorAll('article');
    expect(articles.length).toBe(0);

    settingsState.settings.simplifyHomeScreen = false;
    dispose();
  });
});
