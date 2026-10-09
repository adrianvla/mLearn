// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DEFAULT_SETTINGS, type LanguageData } from '../../../../../shared/types';
import { fitLearningModel, type LearningModel } from '../../../../../shared/learningModel';
import { learningGoalSemanticBasis } from '../../../../../shared/learningGoalCompatibility';
const fixture = vi.hoisted(() => ({ loading: false, error: null as string | null, model: undefined as LearningModel | undefined, failed: false, updateSetting: vi.fn() }));
const data: LanguageData = { name: 'Future', languageData: { version: 'v1', assets: [] }, freq: [['alpha', '', 1]], frequencyLevels: { rowLevelIndex: 2 },
  learning: { outcomes: { 'future:goal': { label: 'Future objective', provenance: 'package', groups: [{ id: 'group', selectors: [{ source: 'frequency', words: ['alpha'] }] }],
    requirements: { conditions: [{ id: 'opaque', kind: 'future:unknown-condition', payload: { values: [1, 2] } }] } } } } };
const settings = { ...DEFAULT_SETTINGS, language: 'future', learningGoals: [{ id: 'goal', language: 'future', outcome: 'Future objective',
  outcomeRef: { id: 'future:goal', packageVersion: 'v1', semanticBasis: learningGoalSemanticBasis(data, { id: 'future:goal' }) },
  deadline: '2026-10-10', createdAt: 1, priority: 1, status: 'active' as const }] };
vi.mock('../../../../context', () => ({
  useSettings: () => ({ settings, updateSetting: fixture.updateSetting }),
  useLocalization: () => ({ t: (key: string) => key }),
  useLanguage: () => ({ currentLangData: () => data }),
  useFlashcards: () => ({ store: { dailyStats: { '2026-01-01': { future: { date: '2026-01-01', newCardsStudied: 2, reviewCardsStudied: 5, lapses: 1, timeSpent: 100, graduated: 0 } } } },
    isLoading: () => fixture.loading, libraryLoadError: () => fixture.error, retryLibraryLoad: vi.fn() }),
}));
vi.mock('../../../../hooks/useLearningModel', () => ({ useLearningModel: () => ({ model: () => fixture.model, snapshot: () => ({ events: [] }), failed: () => fixture.failed, retry: vi.fn() }) }));
import { WelcomeLearningSummary } from './WelcomeLearningSummary';
let dispose: (() => void) | undefined;
beforeEach(() => { vi.setSystemTime(new Date('2026-10-09T14:00:00Z')); settings.language = 'future'; fixture.loading = false; fixture.error = null; fixture.failed = false; fixture.model = fitLearningModel([], Date.now()); fixture.updateSetting.mockClear(); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.useRealTimers(); });
it('renders canonical unsupported requirements, the deadline and recorded totals without claiming mastery or writing settings', () => {
  dispose = render(() => <WelcomeLearningSummary onPlan={vi.fn()} />, document.body);
  expect(document.body.textContent).toContain('Future objective');
  expect(document.body.textContent).toContain('mlearn.Goals.RequirementStatus.unsupported');
  expect(document.body.textContent).toContain('mlearn.Goals.DaysRemaining');
  expect(Array.from(document.querySelectorAll('dd')).map(node => node.textContent)).toEqual(['5', '2']);
  expect(fixture.updateSetting).not.toHaveBeenCalled();
});
it('shows a failed library as unavailable rather than numeric zero', () => {
  fixture.error = 'Controlled disk failure';
  dispose = render(() => <WelcomeLearningSummary onPlan={vi.fn()} />, document.body);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Controlled disk failure');
  expect(document.querySelector('dd')).toBeNull();
});

it('does not label a missing learning-language selection with numeric zero', () => {
  settings.language = '';
  dispose = render(() => <WelcomeLearningSummary onPlan={vi.fn()} />, document.body);
  expect(document.querySelector('dd')).toBeNull();
  expect(document.body.textContent).toContain('mlearn.Settings.Language.LearningLanguage.Label');
});
