// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ settings: { language: 'future', uiLanguage: 'en', learningGoals: [] as Array<Record<string, unknown>> } }));
vi.mock('../../../../context', () => ({
  useSettings: () => ({ settings: fixture.settings, updateSetting: vi.fn() }),
  useLocalization: () => ({ t: (key: string) => key }),
  useLanguage: () => ({ currentLangData: () => null }),
  useFlashcards: () => ({ store: { dailyStats: { '2026-10-10': { future: { date: '2026-10-10', newCardsStudied: 3, reviewCardsStudied: 7, lapses: 0, timeSpent: 0, graduated: 0 } } } },
    libraryLoadError: () => null, retryLibraryLoad: vi.fn(), isLoading: () => false }),
}));
vi.mock('../../../../hooks/useLearningModel', () => ({ useLearningModel: () => ({ model: () => null, snapshot: () => null, failed: () => false, retry: vi.fn() }) }));
vi.mock('../../../../components/common', () => ({
  Button: (props: { children?: string }) => <button>{props.children}</button>,
  ChevronDownIcon: () => <svg data-testid="disclosure-icon" />,
  LearningGoals: () => <div data-testid="goal-surface">goal surface</div>,
}));
import { WelcomeLearningSummary } from './WelcomeLearningSummary';

describe('Home learning summary', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  beforeEach(() => { fixture.settings = { language: 'future', uiLanguage: 'en', learningGoals: [] }; container = document.createElement('div'); document.body.append(container); });
  afterEach(() => { dispose?.(); container.remove(); });

  it('shows recorded practice totals instead of an empty goal prompt when no goal is active', () => {
    dispose = render(() => <WelcomeLearningSummary onPlan={vi.fn()} />, container);
    expect(container.querySelector('[data-testid="goal-surface"]')).toBeNull();
    expect(container.textContent).toContain('7');
    expect(container.textContent).toContain('3');
    expect(container.querySelector('.welcome-lifetime-totals--home')).not.toBeNull();
    expect(container.textContent).not.toContain('mlearn.Goals.Explore');
  });

  it('does not repeat the same counters when record details are opened', () => {
    dispose = render(() => <WelcomeLearningSummary onPlan={vi.fn()} />, container);
    container.querySelector('details')!.open = true;
    expect(container.querySelectorAll('.welcome-lifetime-totals')).toHaveLength(1);
    expect(container.querySelector('.welcome-summary-definition')).not.toBeNull();
    expect(container.querySelector('summary [data-testid="disclosure-icon"]')).not.toBeNull();
  });

  it('shows the shared goal owner and retains record totals in details when a valid active package goal exists', () => {
    fixture.settings.learningGoals = [{ id: 'goal', language: 'future', status: 'active', outcomeRef: { id: 'package-outcome' } }];
    dispose = render(() => <WelcomeLearningSummary onPlan={vi.fn()} />, container);
    expect(container.querySelector('[data-testid="goal-surface"]')).not.toBeNull();
    expect(container.querySelector('.welcome-lifetime-totals--home')).toBeNull();
    expect(container.querySelectorAll('.welcome-lifetime-totals')).toHaveLength(1);
    expect(container.querySelector('details .welcome-lifetime-totals')).not.toBeNull();
  });
});
