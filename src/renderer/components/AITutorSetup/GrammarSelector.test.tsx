// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { GrammarSelector } from './GrammarSelector';

const state = vi.hoisted(() => ({
  settings: {
    language: 'de',
    easeThresholdLearning: 2.0,
    easeThresholdKnown: 3.0,
  },
}));

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: state.settings }),
  useLocalization: () => ({ t: (key: string) => key }),
}));
vi.mock('../../context/LanguageContext', () => ({
  useLanguage: () => ({
    currentLangData: () => ({
      grammar: [
        { pattern: 'seit + Dativ', meaning: 'since + dative', level: 1 },
        { pattern: 'てしまう', meaning: 'finish completely', level: 2 },
      ],
      grammarLevels: { names: {} },
    }),
    supportsGrammar: () => true,
    getGrammarLevelName: (level: number) => `L${level}`,
  }),
}));
vi.mock('../../context/FlashcardContext', () => ({
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    getGrammarKnowledge: (pattern: string) => (
      pattern === 'seit + Dativ'
        ? { ease: 2.6, timesEncountered: 30, timesFailed: 0, firstSeen: 1, lastSeen: 2, hasActiveEvidence: true }
        : pattern === 'てしまう'
          ? { ease: 1.6, timesEncountered: 30, timesFailed: 0, firstSeen: 1, lastSeen: 2, hasActiveEvidence: false }
          : undefined
    ),
  }),
}));

let dispose: (() => void) | undefined;
beforeEach(() => {
  state.settings = { language: 'de', easeThresholdLearning: 2.0, easeThresholdKnown: 3.0 };
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.clearAllMocks(); });

function renderSelector(): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  dispose = render(() => <GrammarSelector selected={[]} onSelectionChange={() => {}} />, container);
  return container;
}

describe('GrammarSelector classification parity', () => {
  function statusBadgeFor(container: HTMLElement, pattern: string): Element | null | undefined {
    const card = Array.from(container.querySelectorAll('.grammar-selector__card'))
      .find((el) => el.textContent?.includes(pattern));
    return card?.querySelector('.grammar-selector__status');
  }

  it('classifies the materialized grammar ease with the CONFIGURED effective thresholds', () => {
    // ease 2.6 under easeThresholdKnown 3.0 is Learning. The pre-fix callsite
    // used hardcoded SRS anchors (known 1.8) and rendered Known — the exact
    // word-vs-grammar disagreement R01 forbids.
    const container = renderSelector();
    const badge = statusBadgeFor(container, 'seit + Dativ');
    expect(badge?.className).toContain('grammar-selector__status--learning');
    expect(container.querySelector('.grammar-selector__status--known')).toBeNull();
  });

  it('classifies the same ease as Known under the shipped default thresholds', () => {
    // Same component, same evidence ease 2.6: with the default 1.8 anchor the
    // canonical word classifier also says Known — parity must hold in BOTH
    // directions, so this pins the settings flow into the callsite.
    state.settings = { language: 'de', easeThresholdLearning: 1.55, easeThresholdKnown: 1.8 };
    const container = renderSelector();
    const badge = statusBadgeFor(container, 'seit + Dativ');
    expect(badge?.className).toContain('grammar-selector__status--known');
  });

  it('renders passive-only exposure as Untracked regardless of its derived ease', () => {
    // てしまう: 30 encounters materialize ease 1.6, but hasActiveEvidence is
    // false — exposure is familiarity, never Learning (REQ13; FINAL review
    // major #1). The configured thresholds must not rescue it either.
    state.settings = { language: 'de', easeThresholdLearning: 1.55, easeThresholdKnown: 1.8 };
    const container = renderSelector();
    const badge = statusBadgeFor(container, 'てしまう');
    expect(badge?.className).toContain('grammar-selector__status--untracked');
    expect(container.querySelector('.grammar-selector__status--learning')).toBeNull();
  });
});
