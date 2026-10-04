// @vitest-environment happy-dom
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Flashcard } from '../../../../shared/types';
import { fitLearningModel } from '../../../../shared/learningModel';
import { hashWordSync } from '../../../../shared/utils/wordHash';
import type { RecentItem } from '../../../services/thumbnailService';

const fixture = vi.hoisted(() => ({
  recordDecision: vi.fn(async (_decision: unknown) => {}), openWindow: vi.fn(), navigate: vi.fn(), retry: vi.fn(), notify: vi.fn(), configure: vi.fn(),
  recordingLookup: vi.fn(async (_id: string): Promise<string | null> => null),
  choiceBarrier: undefined as Promise<void> | undefined,
  recent: [] as RecentItem[], source: false, llm: false, mobile: false,
  progress: { tracked: 0, known: 0, total: 0 },
  reviewMeta: {} as Pick<import('../../../../shared/types').FlashcardMeta, 'reviewSessions' | 'reviewPresentations'>,
  grammarProjections: {} as import('../../../../shared/knowledge/historyQueries').GrammarProjectionMap, grammarRead: vi.fn(),
  frequency: [] as import('../../../../shared/types').LanguageData['freq'], scopedKnown: false, futureDue: false, grammar: undefined as import('../../../../shared/types').LanguageData['grammar'], learning: undefined as import('../../../../shared/types').LanguageData['learning'],
  settings: { learningGoals: undefined as import('../../../../shared/learningGoals').LearningGoal[] | undefined, language: 'test-language', uiLanguage: 'en', simplifyHomeScreen: false, reviewActivities: undefined as import('../../../../shared/types').Settings['reviewActivities'] | undefined },
}));
const [windowActive, setWindowActive] = createSignal(true);
const [knowledgeReady, setKnowledgeReady] = createSignal(true);
const [projectionReady, setProjectionReady] = createSignal(true);
const [projectionFailed, setProjectionFailed] = createSignal(false);
const [due, setDue] = createSignal(0);
vi.mock('../../../services/homeLearningChoice', async () => ({ chooseHomeOffThread: async (input: Parameters<typeof import('./homeLearningDecision').chooseHomeLearningChoice>) => { await fixture.choiceBarrier; return (await import('./homeLearningDecision')).chooseHomeLearningChoice(...input); } }));
vi.mock('../../../services/learningPreparationForecast', async () => ({ forecastPreparationOffThread: async (...args: Parameters<typeof import('../../../../shared/learningPreparation').forecastLearningPreparation>) => (await import('../../../../shared/learningPreparation')).forecastLearningPreparation(...args) }));
vi.mock('@solidjs/router', () => ({ useNavigate: () => fixture.navigate }));
vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: fixture.settings }),
  useLocalization: () => ({ t: (key: string, params?: Record<string, string>) => `${key}${params ? JSON.stringify(params) : ''}` }),
  useLanguage: () => ({ currentLangData: () => fixture.source ? { name: 'Test language', freq: fixture.frequency, frequencyLevels: { rowLevelIndex: 2 }, grammar: fixture.grammar, learning: fixture.learning } : null, isLoading: () => false }),
  useFlashcards: () => ({ store: { wordKnowledge: {}, dailyStats: {}, ignoredWords: {}, get meta() { return fixture.reviewMeta; }, get flashcards() { return Object.fromEntries(Array.from({ length: due() }, (_, index) => [String(index), { id: String(index), language: fixture.settings.language, content: { front: `word-${index}`, back: 'answer' }, state: 'review', dueDate: fixture.futureDue ? Date.now() + 60000 : 1 } as Flashcard])); } }, isLoading: () => false, isKnowledgeReady: knowledgeReady, queue: () => ({ newQueue: [], scheduledQueue: Array.from({ length: due() }, (_, index) => String(index)) }), queueCounts: () => ({ total: due() }) }),
}));
vi.mock('../../../../shared/bridges', () => ({ getBridge: () => ({ window: { openWindow: fixture.openWindow }, flashcards: { getFlashcardTts: fixture.recordingLookup }, knowledgeEvents: { recordLearningDecision: fixture.recordDecision, getGrammarProjections: async () => { await fixture.grammarRead(); return fixture.grammarProjections; } }, mediaStats: { onMediaStatsList: () => () => {}, listMediaStats: vi.fn() } }) }));
vi.mock('../../../hooks/useLearningModel', () => ({ useLearningModel: () => ({ model: () => fitLearningModel([], Date.now()), snapshot: () => ({ events: [], sequence: 0 }), ready: () => true, failed: () => false, retry: vi.fn() }) }));
vi.mock('../../../components/flashcard/flashcardReviewDecision', () => ({ flashcardReviewPolicyEntry: (card: Flashcard, _language: string, _data: unknown, activity?: import('../../../components/flashcard/reviewActivities').ReviewActivity) => ({ presentation: { cardId: card.id, language: fixture.settings.language, surface: card.content.front }, task: { taskTemplateId: activity?.kind === 'holistic' ? 'srs-review' : activity?.id ?? 'srs-review', inputModality: activity?.kind === 'audio-recognition' ? 'audio' : 'written-form', responseModality: 'recall', supplied: [], requested: activity?.targets ?? ['sense-recognition'], fluencyRequired: false, ratingMode: 'profile' }, targets: (activity?.targets ?? ['sense-recognition']).map(capability => ({ entityId: card.id, capability })) }) }));
vi.mock('../../../../shared/platform', () => ({ isMobile: () => fixture.mobile }));
vi.mock('../../../services/thumbnailService', () => ({ getRecentItems: async () => fixture.recent }));
vi.mock('../../../services/llmProvider', () => ({ isLLMReady: () => fixture.llm }));
vi.mock('../../../services/capabilityUnavailable', () => ({ notifyCapabilityUnavailable: fixture.notify, openCapabilitySettings: fixture.configure }));
vi.mock('../../../hooks/useEvidenceLinkedProjections', () => ({ useEvidenceLinkedProjections: () => ({ projections: () => new Map(), ready: projectionReady, failed: projectionFailed, retry: fixture.retry, resolveState: () => ({ status: fixture.scopedKnown ? 'known' : 'unknown', basis: fixture.scopedKnown ? 'evidence' : 'unmeasured' }) }) }));
vi.mock('../../../utils/wordLevelStats', () => ({
  getLevelStudyFrequency: () => fixture.source ? { item: 'level' } : null,
  getLevelStudyLevelNames: () => ['level'], computeLevelStats: () => [{}], summarizeLevelProgress: () => fixture.progress,
}));
vi.mock('../../../../shared/languageFeatures', async () => ({ ...(await vi.importActual<typeof import('../../../../shared/languageFeatures')>('../../../../shared/languageFeatures')), getLearningLanguageLevelForLanguage: () => null, isFrequencyLevelAtOrEasierThanTarget: () => true, getTestedAccesses: () => ['sense-recognition', 'surface-recognition'] }));
vi.mock('../../../components/utils/WindowDragRegion', () => ({ WindowDragRegion: () => null }));
vi.mock('./components', async () => ({ WelcomeContinueRow: (await import('./components/WelcomeContinueRow')).WelcomeContinueRow }));
vi.mock('@renderer/components/common/Misc/AppLogo', () => ({ default: () => null }));
vi.mock('../../../components/common', () => {
  const Icon = () => null;
  return {
    Button: (props: { children?: JSX.Element; onClick?: () => void; variant?: string }) => <button data-variant={props.variant} onClick={props.onClick}>{props.children}</button>,
    Panel: (props: { children?: JSX.Element; class?: string }) => <div class={props.class}>{props.children}</div>,
    SkeletonRows: () => <span data-testid="loading" />,
    VideoIcon: Icon, BookIcon: Icon, BotIcon: Icon, TargetIcon: Icon, SearchIcon: Icon, BarChartIcon: Icon, LanguageVariantGate: Icon, LearningGoals: Icon,
  };
});
vi.mock('../../../hooks/useWindowActivity', () => ({ useWindowActivity: () => windowActive }));
import { grammarEvidenceKey } from '../../../../shared/grammar/evidence';
import { WelcomeRoute } from './WelcomeRoute';

describe('Home next activity', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  const mount = async () => {
    dispose = render(() => <WelcomeRoute />, container); await Promise.resolve(); await Promise.resolve();
    if (knowledgeReady() && projectionReady() && !projectionFailed())
      await vi.waitFor(() => expect(container.querySelector('.welcome-next h2, .welcome-next [role="alert"]')).not.toBeNull());
  };
  const click = async (key: string) => {
    await vi.waitFor(() => expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent?.startsWith(key)), key).toBe(true));
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.startsWith(key));
    const actions = [fixture.openWindow, fixture.navigate, fixture.retry, fixture.notify, fixture.configure];
    const before = actions.reduce((sum, action) => sum + action.mock.calls.length, 0);
    button!.click();
    await vi.waitFor(() => expect(actions.reduce((sum, action) => sum + action.mock.calls.length, 0)).toBeGreaterThan(before));
  };
  const installTargets = () => {
    fixture.source = true;
    fixture.frequency = [...new Set(fixture.settings.learningGoals?.flatMap(goal => goal.scope?.words ?? []) ?? [])].map(word => [word, '', 1]);
    fixture.learning = { outcomes: Object.fromEntries((fixture.settings.learningGoals ?? []).map(goal => [goal.id, {
      label: goal.outcome, provenance: 'package', groups: [{ id: 'material', selectors: [{ source: 'frequency', words: goal.scope?.words }] }],
    }])) };
    fixture.settings.learningGoals = fixture.settings.learningGoals?.map(goal => ({ ...goal, outcomeRef: { id: goal.id } }));
  };
  beforeEach(() => {
    vi.clearAllMocks(); setWindowActive(true); setKnowledgeReady(true); setProjectionReady(true); setProjectionFailed(false); setDue(0);
    fixture.grammarRead.mockReset(); fixture.grammarProjections = {}; fixture.settings.learningGoals = undefined; fixture.grammar = undefined; fixture.learning = undefined; fixture.frequency = []; fixture.scopedKnown = false; fixture.futureDue = false;
    fixture.reviewMeta = {}; fixture.choiceBarrier = undefined; fixture.settings.reviewActivities = undefined;
    fixture.recordingLookup.mockReset().mockResolvedValue(null);
    fixture.recent = []; fixture.source = false; fixture.progress = { tracked: 0, known: 0, total: 0 };
    fixture.llm = false; fixture.mobile = false; fixture.settings.simplifyHomeScreen = false;
    container = document.createElement('div'); document.body.append(container);
  });
  afterEach(() => { dispose?.(); container.remove(); sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks(); });
  it('prepares goal scope without a curriculum and retires completed scope from the primary action', async () => {
    fixture.settings.learningGoals = [{ id: 'book', language: 'test-language', outcome: 'Read my book', status: 'active', priority: 2, createdAt: 1, scope: { provenance: 'user', words: ['chosen'] } }];
    installTargets();
    await mount(); await click('mlearn.Home.Today.PracticeAction');
    expect(fixture.openWindow).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ material: { language: 'test-language', label: 'Read my book', words: ['chosen'] } }) }));
    dispose(); fixture.scopedKnown = true; await mount();
    await click('mlearn.Home.Today.ReadAction');
    expect(fixture.navigate).toHaveBeenCalledWith('/reader');
    expect(fixture.recordDecision).toHaveBeenCalled();
  });
  it('hands off a selected word beyond the former sixteen-word prefix', async () => {
    const words = [...Array.from({ length: 40 }, (_, index) => `z-word-${index}`), 'a-later-choice'];
    fixture.settings.learningGoals = [{ id: 'scope', language: 'test-language', outcome: 'Scope', status: 'active',
      priority: 1, createdAt: 1, scope: { provenance: 'user', words: words.slice(0, 40) } },
      { id: 'priority-access', language: 'test-language', outcome: 'Another scope', status: 'active', priority: 1, createdAt: 1,
        scope: { provenance: 'user', words: [words[40]] } }];
    installTargets();
    await mount(); await click('mlearn.Home.Today.PracticeAction');
    expect(fixture.openWindow).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({
      material: expect.objectContaining({ words: ['a-later-choice'] }) }) }));
    expect(fixture.recordDecision.mock.calls[0][0]).toMatchObject({ policyVersion: 'home-learning-controller@13',
      selected: { key: 'practice:a-later-choice' }, detail: { candidatesOmitted: 0,
        homeController: { evaluationsOmitted: 9 } } });
  });

  it('does not open or persist a stale asynchronous choice after the candidate pool changes', async () => {
    setDue(1); await mount();
    let release!: () => void;
    fixture.choiceBarrier = new Promise<void>(resolve => { release = resolve; });
    Array.from(container.querySelectorAll('button')).find(button => button.textContent?.startsWith('mlearn.Home.Today.ReviewAction'))!.click();
    setDue(2); release();
    await vi.waitFor(() => expect(container.querySelector('.welcome-next h2')).not.toBeNull());
    expect(fixture.recordDecision).not.toHaveBeenCalled();
    expect(fixture.openWindow).not.toHaveBeenCalled();
  });

  it('does not admit a late Home choice after leaving the route', async () => {
    setDue(1); await mount();
    let release!: () => void;
    fixture.choiceBarrier = new Promise<void>(resolve => { release = resolve; });
    Array.from(container.querySelectorAll('button')).find(button => button.textContent?.startsWith('mlearn.Home.Today.ReviewAction'))!.click();
    dispose(); release();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(fixture.recordDecision).not.toHaveBeenCalled(); expect(fixture.openWindow).not.toHaveBeenCalled();
  });

  it('offers an available package audio task and carries its actual retrieval conditions', async () => {
    fixture.source = true; fixture.scopedKnown = true; setDue(1);
    fixture.settings.reviewActivities = { holistic: false, focused: false, audio: true };
    fixture.learning = { capabilities: { 'future::sound': { label: 'Package sound', testableIn: ['srs-review'] } },
      reviewActivities: { 'future::audio': { kind: 'audio-recognition', label: 'Sound', prompt: 'Listen', targets: ['future::sound'] } } };
    fixture.recordingLookup.mockResolvedValue('flashcard-audio://copied');
    await mount(); await click('mlearn.Home.Today.ReviewAction');
    const decision = fixture.recordDecision.mock.calls[0][0] as import('../../../../shared/learningDecision').LearningDecision;
    expect(decision.selected).toMatchObject({ key: 'review:0:future::audio', task: { taskTemplateId: 'future::audio' },
      presentation: { reviewActivityId: 'future::audio', retrievalTask: { inputModality: 'audio', requested: ['future::sound'] } } });
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'flashcards', context: { activity: 'review', session: {
      requestId: decision.id, encounterLimit: expect.any(Number), initialCardId: '0', decision } } });
  });

  it('does not offer audio or substitute a written cue when the actual recording is missing', async () => {
    fixture.source = true; fixture.scopedKnown = true; setDue(1);
    fixture.settings.reviewActivities = { holistic: false, focused: false, audio: true };
    fixture.learning = { reviewActivities: { 'future::audio': {
      kind: 'audio-recognition', label: 'Sound', prompt: 'Listen', targets: ['future::sound'] } } };
    fixture.recordingLookup.mockResolvedValue(null);
    await mount(); await click('mlearn.Home.Today.ReadAction');
    expect(fixture.navigate).toHaveBeenCalledWith('/reader');
    expect(fixture.recordDecision.mock.calls[0][0]).toMatchObject({ selected: { action: 'read' } });
    expect(fixture.openWindow).not.toHaveBeenCalled();
  });

  it('withholds new choices on recording lookup failure and retries the actual resource read', async () => {
    setDue(1); fixture.recordingLookup.mockRejectedValueOnce(new Error('recording evidence unavailable'));
    await mount(); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.recordDecision).not.toHaveBeenCalled();
    await click('mlearn.Knowledge.Retry');
    await click('mlearn.Home.Today.ReviewAction');
    expect(fixture.recordingLookup.mock.calls.length).toBeGreaterThan(1);
    expect(fixture.recordDecision).toHaveBeenCalledOnce();
  });

  it('persists the necessary workload scenario with the actual Home decision', async () => {
    fixture.settings.learningGoals = [{ id: 'near', language: 'test-language', outcome: 'Defined scope',
      status: 'active', priority: 1, createdAt: 1, deadline: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      scope: { provenance: 'user', words: Array.from({ length: 1000 }, (_, index) => `item-${index}`) } }];
    installTargets();
    await mount(); await click('mlearn.Home.Today.PracticeAction');
    const decision = fixture.recordDecision.mock.calls[0][0] as unknown as {
      detail: { homeController: { deadlineWorkloads: { items: number; status: string; priorDriven: boolean }[] } }
    };
    expect(decision.detail.homeController.deadlineWorkloads).toEqual([expect.objectContaining({
      goalId: 'near', items: 1000, status: 'one-pass-exceeds-opportunity-scenarios', priorDriven: true,
    })]);
    expect(fixture.settings.learningGoals[0].scope?.words).toHaveLength(1000);
    expect(decision.detail.homeController).not.toHaveProperty('preparationForecast');
  });
  it('includes unassessed installed grammar and excludes measured grammar from deadline workload', async () => {
    fixture.source = true;
    fixture.grammar = [{ pattern: 'future-measured', level: 9, meaning: 'cue' },
      { pattern: 'future-passive', level: 9, meaning: 'cue' }, { pattern: 'future-missing', level: 9, meaning: 'cue' }];
    fixture.learning = { outcomes: { subset: { label: 'Package scope', provenance: 'package',
      groups: [{ id: 'opaque', selectors: [{ source: 'grammar', levels: [9] }] }] } } };
    fixture.grammarProjections = Object.fromEntries(['future-measured', 'future-passive'].map(pattern => [
      grammarEvidenceKey('test-language', pattern, 'grammar-recognition'), { ease: 2.5, timesEncountered: 1, timesFailed: 0,
        firstSeen: 1, lastSeen: 1, hasActiveEvidence: pattern === 'future-measured' }]));
    fixture.settings.learningGoals = [{ id: 'near', language: 'test-language', outcome: 'Package scope',
      outcomeRef: { id: 'subset' }, status: 'active', priority: 1, createdAt: 1,
      deadline: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) }];
    await mount(); await click('mlearn.Home.Today.PracticeAction');
    const decision = fixture.recordDecision.mock.calls[0][0] as { detail: { homeController: { deadlineWorkloads: unknown[] } } };
    expect(decision.detail.homeController.deadlineWorkloads).toEqual([expect.objectContaining({ goalId: 'near', items: 2,
      effortSources: [expect.objectContaining({ family: 'grammar-self-assess' })] })]);
    expect(fixture.grammarRead).toHaveBeenCalledTimes(1);
    setWindowActive(false);
    fixture.grammarProjections = Object.fromEntries(fixture.grammar!.map(point => [
      grammarEvidenceKey('test-language', point.pattern, 'grammar-recognition'), { ease: 2.5, timesEncountered: 1,
        timesFailed: 0, firstSeen: 1, lastSeen: 1, hasActiveEvidence: true }]));
    expect(fixture.grammarRead).toHaveBeenCalledTimes(1);
    setWindowActive(true);
    await vi.waitFor(() => expect(fixture.grammarRead).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(Array.from(container.querySelectorAll('button')).some(button =>
      button.textContent?.startsWith('mlearn.Home.Today.PracticeAction'))).toBe(true));
    await click('mlearn.Home.Today.PracticeAction');
    const refreshed = fixture.recordDecision.mock.calls[1][0] as typeof decision;
    expect(refreshed.detail.homeController.deadlineWorkloads).toEqual([expect.objectContaining({ items: 0,
      status: 'indeterminate' })]);
  });

  it('retries missing grammar evidence rather than treating it as zero work', async () => {
    fixture.source = true;
    fixture.grammar = [{ pattern: 'future', level: 9, meaning: 'cue' }];
    fixture.learning = { outcomes: { subset: { label: 'Scope', provenance: 'package',
      groups: [{ id: 'group', selectors: [{ source: 'grammar' }] }] } } };
    fixture.settings.learningGoals = [{ id: 'near', language: 'test-language', outcome: 'Scope', outcomeRef: { id: 'subset' },
      status: 'active', priority: 1, createdAt: 1, deadline: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) }];
    fixture.grammarRead.mockRejectedValueOnce(new Error('projection unavailable'));
    await mount();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(fixture.recordDecision).not.toHaveBeenCalled();
    await click('mlearn.Knowledge.Retry');
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull());
    await click('mlearn.Home.Today.PracticeAction');
    const decision = fixture.recordDecision.mock.calls[0][0] as { detail: { homeController: { deadlineWorkloads: unknown[] } } };
    expect(decision.detail.homeController.deadlineWorkloads).toEqual([expect.objectContaining({ items: 1 })]);
    expect(fixture.grammarRead).toHaveBeenCalledTimes(2);
  });

  it('refreshes deadline estimates at the start boundary after Home has been idle', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-04'));
    fixture.settings.learningGoals = [{ id: 'near', language: 'test-language', outcome: 'Scope', status: 'active',
      priority: 1, createdAt: 1, deadline: '2026-10-05', scope: { provenance: 'user', words: ['chosen'] } }];
    installTargets();
    await mount();
    clock.mockReturnValue(Date.parse('2026-10-20'));
    await click('mlearn.Home.Today.PracticeAction');
    const decision = fixture.recordDecision.mock.calls[0][0] as { detail: { homeController: { evaluatedAt: number; horizonDays: number; preparationForecast?: unknown; deadlineWorkloads: unknown[] } } };
    expect(decision.detail.homeController.evaluatedAt).toBe(Date.parse('2026-10-20'));
    expect(decision.detail.homeController.horizonDays).toBe(30);
    expect(decision.detail.homeController.preparationForecast).toBeUndefined();
    expect(decision.detail.homeController.deadlineWorkloads).toEqual([]);
  });
  it.each([false, true])('resumes installed grammar before a different task, with unavailable future projection=%s', async unavailable => {
    fixture.source = true;
    fixture.grammar = [{ pattern: 'unknown-construction', level: 9, meaning: 'Package-owned meaning' }];
    if (unavailable) {
      fixture.learning = { outcomes: { subset: { label: 'Scope', provenance: 'package',
        groups: [{ id: 'group', selectors: [{ source: 'grammar' }] }] } } };
      fixture.settings.learningGoals = [{ id: 'near', language: 'test-language', outcome: 'Scope', outcomeRef: { id: 'subset' },
        status: 'active', priority: 1, createdAt: 1, deadline: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) }];
      fixture.grammarRead.mockRejectedValue(new Error('future projection unavailable'));
    }
    const denominator = 'unknown-construction';
    localStorage.setItem('mlearn-study-grammar:test-language', JSON.stringify({ id: 'active',
      identity: JSON.stringify({ language: 'test-language', level: 9, kind: 'self-assess', denominator }),
      queue: [{ id: denominator }], index: 0, visited: [], rated: 0, revealed: true,
      meta: { level: 9, kind: 'self-assess', denominator, presentedAt: Date.now() },
    }));
    await mount(); await click('mlearn.StudyEncounter.Resume');
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'level-study', context: {
      activity: 'grammar', patterns: ['unknown-construction'], returnTo: 'home',
    } });
    expect(fixture.recordDecision).not.toHaveBeenCalled();
  });
  it('does not immediately recommend failed cards scheduled for later', async () => {
    fixture.futureDue = true; setDue(2); await mount();
    expect(container.querySelector('.welcome-next')?.textContent).not.toContain('mlearn.Home.Today.ReviewReason');
    await click('mlearn.Home.Today.ReadAction'); expect(fixture.navigate).toHaveBeenCalledWith('/reader');
  });
  it('resumes an already admitted encounter before its next due time without a new recommendation', async () => {
    fixture.futureDue = true; setDue(1);
    const session = { id: 'saved-session', cardIds: ['0'], completedCardIds: [], encounterLimit: 1, startedAt: 1 };
    fixture.reviewMeta = { reviewSessions: { 'test-language': session }, reviewPresentations: { 'test-language': {
      id: 'saved-choice', cardId: '0', session, decision: { id: 'saved-choice', at: 1, policyVersion: 'test',
        selected: { key: '0', action: 'MAINTAIN', presentation: { cardId: '0', language: 'test-language',
          surface: 'word-0', contentVersion: hashWordSync(JSON.stringify({ front: 'word-0', back: 'answer' })) },
          targets: [{ kind: 'surface', id: 'opaque-target', capability: 'opaque-access' }],
          task: { taskTemplateId: 'opaque-task', inputModality: 'audio', responseModality: 'self-assessment',
            supplied: ['cue'], requested: ['opaque-access'], fluencyRequired: false, ratingMode: 'profile' } },
        baseline: null, detail: {} },
    } } };
    await mount(); await click('mlearn.StudyEncounter.Resume');
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'flashcards' });
    expect(fixture.recordDecision).not.toHaveBeenCalled();
  });
  it('opens the existing review destination without mounting a second rating controller', async () => {
    setDue(214); await mount();
    expect(container.querySelector('.welcome-next')?.textContent).toContain('word-0');
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    expect(container.querySelector('input')).toBeNull();
    await click('mlearn.Home.Today.ReviewAction');
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'flashcards', context: { activity: 'review', session: { requestId: expect.any(String), encounterLimit: expect.any(Number), initialCardId: '0', decision: expect.any(Object) } } });
    expect(container.querySelector('[data-testid="flashcard-preview"]')).toBeNull();
  });
  it.each([
    [{ tracked: 10, known: 4, total: 20 }, 'PracticeAction', 'practice'],
  ])('hands its learning-record recommendation directly to shared study: %s', async (progress, action, activity) => {
    fixture.source = true; fixture.progress = progress; await mount(); await click(`mlearn.Home.Today.${action}`);
    expect(fixture.openWindow).toHaveBeenCalledWith(expect.objectContaining({ type: 'level-study', context: expect.objectContaining({ activity, returnTo: 'home', session: { requestId: expect.any(String), encounterLimit: expect.any(Number) } }) }));
  });
  it('starts useful finite discovery from an installed curriculum before any placement', async () => {
    fixture.source = true; fixture.progress = { tracked: 0, known: 0, total: 8000 };
    fixture.settings.learningGoals = [{ id: 'goal', language: 'test-language', outcome: 'Read a book', priority: 2, status: 'active', createdAt: 1 }];
    await mount(); await click('mlearn.Home.Today.PracticeAction');
    expect(fixture.openWindow).toHaveBeenCalledWith(expect.objectContaining({ type: 'level-study', context: expect.objectContaining({ activity: 'practice', returnTo: 'home', session: expect.any(Object) }) }));
  });
  it('saves and carries the exact Home grammar handoff before the actual activity admits recall', async () => {
    fixture.source = true; fixture.scopedKnown = true;
    fixture.grammar = [{ pattern: 'future-construction', level: 9, meaning: 'Package cue' }];
    fixture.learning = { outcomes: { 'future-subset': { label: 'Installed subset', provenance: 'package',
      groups: [{ id: 'opaque-group', selectors: [{ source: 'grammar', patterns: ['future-construction'] }] }] } } };
    fixture.settings.learningGoals = [{ id: 'goal', language: 'test-language', outcome: 'Installed subset',
      outcomeRef: { id: 'future-subset' }, priority: 1, status: 'active', createdAt: 1 }];
    await mount(); await click('mlearn.Home.Today.PracticeAction');
    const decision = fixture.recordDecision.mock.calls[0][0] as import('../../../../shared/learningDecision').LearningDecision;
    expect(decision.selected).toMatchObject({ action: 'grammar', task: { taskTemplateId: 'grammar-self-assess' } });
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'level-study', context: { activity: 'grammar',
      patterns: ['future-construction'], returnTo: 'home', session: { requestId: decision.id,
        encounterLimit: expect.any(Number), decision } } });
    expect(fixture.recordDecision.mock.invocationCallOrder[0]).toBeLessThan(fixture.openWindow.mock.invocationCallOrder[0]);
  });

  it('does not recommend from partially loaded learner knowledge', async () => {
    setKnowledgeReady(false); setDue(12); await mount();
    expect(container.querySelector('.welcome-next h2')).toBeNull();
    setKnowledgeReady(true);
    await vi.waitFor(() => expect(container.querySelector('.welcome-next h2')?.textContent).toContain('word-0'));
  });
  it('offers retry instead of a recommendation when the required projection fails', async () => {
    fixture.source = true; setProjectionReady(false); setProjectionFailed(true); await mount();
    expect(container.querySelector('.welcome-next h2')).toBeNull(); await click('mlearn.Knowledge.Retry'); expect(fixture.retry).toHaveBeenCalledOnce();
  });
  it('supports a package without a level curriculum without waiting forever or forcing assessment', async () => {
    setProjectionReady(false); await mount();
    expect(container.textContent).toContain('mlearn.Home.Today.PlanUnmeasured');
    await click('mlearn.Home.Today.ReadAction'); expect(fixture.navigate).toHaveBeenCalledWith('/reader');
    expect(container.textContent).not.toContain('mlearn.Home.Today.AssessmentAction');
  });
  it('continues the most recent video with its linked subtitles', async () => {
    fixture.recent = [{ type: 'video', name: 'Film', path: '/film.mp4', subtitlePath: '/film.srt', lastWatched: Date.now(), progress: 40 }];
    await mount(); await click('mlearn.Home.Today.ContinueAction');
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
    await mount(); await click('mlearn.Home.Cards.AITutor.Title');
    expect(fixture.notify).toHaveBeenCalledWith('llm', 'notConfigured', expect.any(Function));
    expect(fixture.configure).toHaveBeenCalledWith('llm'); expect(fixture.openWindow).not.toHaveBeenCalled();
  });
  it('keeps the same journey in compact Home instead of substituting a feature catalogue', async () => {
    fixture.settings.simplifyHomeScreen = true; setDue(12); await mount(); await click('mlearn.Home.Today.ReviewAction');
    expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'flashcards', context: { activity: 'review', session: { requestId: expect.any(String), encounterLimit: expect.any(Number), initialCardId: '0', decision: expect.any(Object) } } });
    await click('mlearn.Home.Today.ViewPlan'); expect(fixture.openWindow).toHaveBeenCalledWith({ type: 'level-study', context: { activity: 'plan' } });
  });
});
