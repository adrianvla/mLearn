import { fitLearningModel } from '../../../shared/learningModel';
// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { type JSX } from 'solid-js';

let settingsLoadingMock = () => false;
let currentLangDataMock: Record<string, unknown> = {};
let currentSettingsMock: { language: string; learningLanguageLevels: Record<string, number>; sessionIntensity: string; frequencyProviderSelections: Record<string, string>; learningGoals?: Array<Record<string, unknown>> } = {
  language: 'test', learningLanguageLevels: { test: 2 }, sessionIntensity: 'steady', frequencyProviderSelections: {},
};
const localizationMock = vi.fn((key: string) => key);
const ingress = vi.hoisted(() => ({ context: {} as Record<string, unknown>, cleanup: vi.fn(), request: vi.fn(), close: vi.fn(), open: vi.fn() }));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ window: {
  onWindowContext: (callback: (context: Record<string, unknown>) => void) => { callback(ingress.context); return ingress.cleanup; },
  getWindowContext: ingress.request,
  closeWindow: ingress.close, openWindow: ingress.open,
} }) }));

vi.mock('../../hooks/useLearningModel', () => ({ useLearningModel: () => ({ model: () => fitLearningModel([], Date.now()), snapshot: () => ({ events: [] }), ready: () => true, failed: () => false, retry: vi.fn() }) }));

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useLanguage: () => ({
    currentLangData: () => currentLangDataMock,
    getFreqLevelNames: () => ({ '2': 'Package target' }),
  }),
  useSettings: () => ({ isLoading: () => settingsLoadingMock(), settings: currentSettingsMock }),
  useLocalization: () => ({
    t: localizationMock,
  }),
}));

vi.mock('../../components/common', () => ({
  Button: (props: { children?: JSX.Element; onClick?: () => void }) => <button onClick={props.onClick}>{props.children}</button>,
  Panel: (props: { children?: JSX.Element; class?: string }) => <div class={props.class}>{props.children}</div>,
  ArrowLeftIcon: () => <span />,
  TabContainer: (props: {
    tabs: Array<{ id: string; label: string; icon?: JSX.Element }>;
    activeTab: string;
    onTabChange: (tabId: string) => void;
    children?: JSX.Element;
  }) => (
    <div>
      <div role="tablist">
        {props.tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.activeTab === tab.id}
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {props.children}
    </div>
  ),
  TabPanel: (props: { tabId: string; activeTab: string; children?: JSX.Element }) => (
    <>{props.tabId === props.activeTab ? props.children : null}</>
  ),
  TargetIcon: () => <span />,
  BookIcon: () => <span />,
  GridIcon: () => <span />,
  SparklesIcon: () => <span />,
  LearningGoals: (props: { compact?: boolean; summaryOnly?: boolean; onEdit?: () => void; requirementEvaluations?: unknown[] }) => (
    <section data-testid="plan-target-summary" data-summary-only={props.summaryOnly} data-has-evaluation={props.requirementEvaluations?.length ? 'true' : undefined}>
      <span>{String(currentSettingsMock.learningGoals?.[0]?.outcome ?? 'mlearn.Goals.Explore')}</span>
      <button class="learning-goals__edit" onClick={props.onEdit}>mlearn.LearningPlan.Edit</button>
    </section>
  ),
}));

vi.mock('../wordSync/App', () => ({
  WordSyncContent: (props: { mode?: string; intent?: string; words?: readonly string[] }) => <div data-testid="word-sync-content" data-mode={props.mode} data-intent={props.intent} data-words={props.words ? JSON.stringify(props.words) : undefined}>Word Sync Content</div>,
}));

vi.mock('../characterGrid/App', () => ({
  CharacterGridContent: () => <div>Character Grid Content</div>,
}));

vi.mock('./LearningPlanSettings', () => ({ LearningPlanSettings: () => <div>Plan controls</div> }));

vi.mock('./LevelStudyTab', () => ({
  LevelStudyTab: (props: { onEditPlan?: () => void; grammarRequest?: unknown; grammarScopePatterns?: readonly string[]; onGrammarRequestHandled?: () => void }) => <div data-grammar-request={props.grammarRequest ? JSON.stringify(props.grammarRequest) : undefined} data-grammar-scope={props.grammarScopePatterns ? JSON.stringify(props.grammarScopePatterns) : undefined}>Level Study Content<button onClick={props.onEditPlan}>Edit from progress</button><button onClick={props.onGrammarRequestHandled}>Admission acknowledged</button></div>,
}));

describe('LevelStudyContent', () => {
  it('keeps an installed construction subset after the admission request is acknowledged', async () => {
    currentLangDataMock = { grammar: [{ pattern: 'package-defined', level: 2 }] };
    ingress.context = { activity: 'grammar', patterns: ['package-defined'], returnTo: 'home' };
    const { LevelStudyContent } = await import('./App');
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <LevelStudyContent workspace="grammar" launchContext={ingress.context} />, host);
    try {
      expect(host.querySelector('[data-grammar-request]')?.getAttribute('data-grammar-request')).toContain('package-defined');
      expect(host.querySelector('[data-grammar-request]')?.getAttribute('data-grammar-request')).not.toContain('invented');
      Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Admission acknowledged')!.click();
      expect(host.querySelector('[data-grammar-request]')?.getAttribute('data-grammar-request')).toBeUndefined();
      expect(host.querySelector('[data-grammar-scope]')?.getAttribute('data-grammar-scope')).toBe('["package-defined"]');
      expect(host.querySelector('[data-testid="word-sync-content"]')).toBeNull();
    } finally { dispose(); host.remove(); }
  });
  it.each([{ patterns: [] }, { patterns: ['removed'] }, { patterns: ['package-defined', 'removed'] }, { patterns: ['package-defined', 12] }])('refuses an explicit invalid scope without generic grammar controls: $patterns', async ({ patterns }) => {
    currentLangDataMock = { grammar: [{ pattern: 'package-defined', level: 2 }] };
    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent workspace="grammar" launchContext={{ activity: 'grammar', patterns }} />, container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('mlearn.Product.GrammarSelectionUnavailable');
    expect(container.textContent).not.toContain('Level Study Content');
    dispose();
  });

  it.each(['valid', 'wrong-request', 'wrong-target', 'wrong-task'])('validates and forwards the %s Home grammar decision', async kind => {
    currentLangDataMock = { grammar: [{ pattern: 'package-defined', level: 2 }] };
    const decision = { id: 'home-id', at: 1, policyVersion: 'home-test', selected: {
      key: 'grammar:package-defined', action: 'grammar',
      targets: [{ kind: 'grammar-pattern', id: kind === 'wrong-target' ? 'other' : 'test:grammar:package-defined', capability: 'grammar-recognition' }],
      task: { taskTemplateId: kind === 'wrong-task' ? 'grammar-contrast' : 'grammar-self-assess', inputModality: 'activity-handoff',
        responseModality: 'none', supplied: [], requested: ['grammar-recognition'], fluencyRequired: false, ratingMode: 'profile' },
    }, baseline: null, detail: { future: { opaque: ['kept'] } } };
    ingress.context = { activity: 'grammar', patterns: ['package-defined'], session: {
      requestId: kind === 'wrong-request' ? 'other-id' : decision.id, encounterLimit: 1, decision } };
    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent workspace="grammar" launchContext={ingress.context} />, container);
    const raw = container.querySelector('[data-grammar-request]')?.getAttribute('data-grammar-request');
    if (kind === 'valid') expect(JSON.parse(raw!)).toMatchObject({ patterns: ['package-defined'], handoffDecision: decision });
    else {
      expect(raw).toBeUndefined();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('mlearn.Product.GrammarSelectionUnavailable');
      expect(container.textContent).not.toContain('Level Study Content');
    }
    dispose();
  });

  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    currentLangDataMock = {};
    currentSettingsMock = { language: 'test', learningLanguageLevels: { test: 2 }, sessionIntensity: 'steady', frequencyProviderSelections: {} };
    ingress.context = {};
    localizationMock.mockImplementation((key: string) => {
      switch (key) {
        case 'mlearn.LevelStudy.Title':
          return 'Level Study';
        case 'mlearn.LevelStudy.Tabs.WordSync':
          return 'Word Sync';
        case 'mlearn.LevelStudy.Tabs.CharacterGrid':
          return 'Character Grid';
        case 'mlearn.LevelStudy.Tabs.LevelStudy':
          return 'Level Study';
        default:
          return key;
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    container.remove();
  });

  it('keeps a routed Plan passive even when transport carries an old task intention', async () => {
    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent workspace="plan" launchContext={{ activity: 'practice' }} />, container);
    expect(container.textContent).toContain('Plan controls');
    expect(container.querySelector('[data-testid="word-sync-content"]')).toBeNull();
    expect(ingress.request).not.toHaveBeenCalled();
    dispose();
  });
  it('starts with the learning plan and launches practice with a route back', async () => {
    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent />, container);
    expect(container.textContent).toContain('Plan controls');
    expect(container.textContent).not.toContain('Word Sync Content');
    const practice = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Home.Today.PracticeAction');
    practice?.click();
    expect(ingress.open).toHaveBeenCalledWith({ type: 'level-study', context: { activity: 'practice', intent: 'start', returnTo: 'plan' } });
    expect(container.querySelector('[data-testid="word-sync-content"]')).toBeNull();
    expect(container.textContent).toContain('Plan controls');
    dispose();
  });

  it('foregrounds target and coverage even when character study is available', async () => {
    currentLangDataMock = {
            characterStudy: { scripts: ['Arab'] },
    };

    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent />, container);

    expect(container.textContent).not.toContain('mlearn.StudyEncounter.Task');
    expect(container.textContent).not.toContain('Character Grid');
    expect(container.textContent).toContain('Level Study');

    dispose();
  });

  it('routes Assess Current Level into Word Sync assessment mode', async () => {
    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent />, container);
    const assess = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'mlearn.LearningPlan.Assess');
    expect(assess).toBeDefined();
    assess!.click();

    expect(ingress.open).toHaveBeenCalledWith({ type: 'level-study', context: { activity: 'assessment', intent: 'start', returnTo: 'plan' } });
    expect(container.querySelector('[data-testid="word-sync-content"]')).toBeNull();
    expect(container.textContent).toContain('Plan controls');
    dispose();
  });

  it('hides the character grid tab when language metadata disables character study', async () => {
    currentLangDataMock = {
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
      characterStudy: { enabled: false, scripts: ['Latn'] },
    };

    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent />, container);

    expect(container.textContent).not.toContain('mlearn.StudyEncounter.Task');
    expect(container.textContent).not.toContain('Character Grid');
    expect(container.textContent).toContain('Level Study');

    dispose();
  });

  it('keeps configuration collapsed and opens it when progress requests a plan edit', async () => {
    const { LevelStudyContent } = await import('./App');
    const dispose = render(() => <LevelStudyContent />, container);
    const configuration = container.querySelector<HTMLDetailsElement>('.learning-plan-configuration')!;
    expect(configuration.open).toBe(false);
    expect(container.querySelector('[data-testid="plan-target-summary"]')?.textContent).toContain('mlearn.Goals.Explore');
    expect(container.querySelector('[data-testid="plan-target-summary"]')?.getAttribute('data-summary-only')).toBe('true');
    expect(container.textContent).not.toContain('Package target');
    expect(configuration.querySelector('summary')?.textContent).toContain('mlearn.LearningPlan.EditControls');
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Edit from progress')!.click();
    expect(configuration.open).toBe(true);
    expect(document.activeElement).toBe(configuration.querySelector('summary'));
    configuration.querySelector('summary')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(configuration.open).toBe(false);
    expect(document.activeElement).toBe(container.querySelector('[data-testid="plan-target-summary"] button'));
    dispose();
  });
});
