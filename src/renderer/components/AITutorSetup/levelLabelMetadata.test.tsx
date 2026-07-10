// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData } from '../../../shared/types';

const streamChatMock = vi.hoisted(() => vi.fn(() => ({ abort: vi.fn() })));

const wordKnowledge = {
  alpha: {
    word: 'alpha',
    ease: 1.5,
    language: 'xx',
    timesSeen: 1,
    timesHovered: 0,
    lastSeen: 0,
  },
  beta: {
    word: 'beta',
    ease: 2.5,
    language: 'xx',
    timesSeen: 1,
    timesHovered: 0,
    lastSeen: 0,
  },
  gamma: {
    word: 'gamma',
    ease: 2.8,
    language: 'xx',
    timesSeen: 1,
    timesHovered: 0,
    lastSeen: 0,
  },
};

const grammarKnowledge = {
  'uses-alpha': {
    pattern: 'uses-alpha',
    ease: 1.5,
    timesEncountered: 2529,
    timesFailed: 4,
    lastSeen: 0,
    level: 1,
    language: 'xx',
  },
};

const frequencyLanguage: LanguageData = {
  name: 'Template Frequency Language',
  settings: { fixed: {} },
    frequencyLevels: {
    fallbackLabelTemplate: 'Band {level}',
    displayOrder: 'ascending',
  },
};

const grammarLanguage: LanguageData = {
  name: 'Template Grammar Language',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Latn'] },
  },
  grammarLevels: {
    fallbackLabelTemplate: 'Pattern {level}',
    displayOrder: 'ascending',
  },
  grammar: [
    { pattern: 'uses-alpha', meaning: 'uses alpha', level: 1 },
    { pattern: 'uses-beta', meaning: 'uses beta', level: 2 },
  ],
};

let activeLanguageData: LanguageData = frequencyLanguage;
let tutorSettings = {
  language: 'xx',
  theme: 'light',
  easeThresholdUnknown: 1.6,
  easeThresholdLearning: 2.2,
  easeThresholdKnown: 3,
  easeThresholdMastered: 4,
  llmEnabled: false,
  llmProvider: 'cloud',
  cloudAuthStatus: 'signed-out',
};

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'mlearn.AITutorSetup.AllLevels') return 'All levels';
      if (key === 'mlearn.AITutorSetup.GrammarFailureStats') return `failed ${params?.failed}/${params?.seen} seen`;
      if (key === 'mlearn.AITutorSetup.ItemsSelected') return `${params?.count ?? 0} selected`;
      return key;
    },
  }),
  useSettings: () => ({
    settings: tutorSettings,
  }),
  useLowPowerGate: () => ({
    requestAccess: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../../context/LanguageContext', () => ({
  useLanguage: () => ({
    currentLangData: () => activeLanguageData,
    langData: { xx: activeLanguageData },
    getFreqLevelNames: () => ({}),
    getFrequency: (word: string) => {
      if (word === 'alpha') return { level: 'Band 1', raw_level: 1, reading: 'alpha' };
      if (word === 'beta') return { level: 'Band 2', raw_level: 2, reading: 'beta' };
      if (word === 'gamma') return { level: '', raw_level: -1, reading: 'gamma' };
      return null;
    },
    supportsGrammar: () => true,
    getGrammarLevelName: (level: number) => `Fallback ${level}`,
  }),
}));

vi.mock('../../context/FlashcardContext', () => ({
  useFlashcards: () => ({
    store: {
      wordKnowledge,
      flashcards: {},
    },
    getGrammarKnowledge: (pattern: string) => grammarKnowledge[pattern as keyof typeof grammarKnowledge] ?? null,
  }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    mediaStats: {
      onMediaStatsList: () => () => {},
      listMediaStats: vi.fn(),
    },
  }),
}));

vi.mock('../../services/llmProvider', () => ({
  streamChat: streamChatMock,
  isLLMReady: (settings: { llmEnabled: boolean; llmProvider: string; cloudAuthStatus?: string }) =>
    settings.llmEnabled && (
      (settings.llmProvider === 'cloud' && settings.cloudAuthStatus === 'signed-in') ||
      settings.llmProvider === 'ollama'
    ),
}));

vi.mock('../common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  CollapsibleStickyHeader: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  EmptyState: (props: { title?: string }) => <div>{props.title}</div>,
  HintText: (props: { children?: JSX.Element }) => <p>{props.children}</p>,
  HoverReveal: (props: { icon?: JSX.Element; label: string; title?: string; class?: string }) => (
    <span class={props.class} title={props.title ?? props.label}>
      {props.icon}
      <span>{props.label}</span>
    </span>
  ),
  Input: (props: {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    onInput?: (event: InputEvent & { currentTarget: HTMLInputElement }) => void;
    onKeyDown?: (event: KeyboardEvent) => void;
  }) => (
    <input
      value={props.value ?? ''}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onInput={(event) => props.onInput?.(event as InputEvent & { currentTarget: HTMLInputElement })}
      onKeyDown={(event) => props.onKeyDown?.(event as KeyboardEvent)}
    />
  ),
  LevelPillsFilter: (props: {
    levels: number[];
    getLevelLabel: (level: number) => string;
    allLabel: string;
  }) => (
    <div>
      <span>{props.allLabel}</span>
      {props.levels.map((level) => <span>{props.getLevelLabel(level)}</span>)}
    </div>
  ),
  PillLabel: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  SelectableCard: (props: { title?: string; badgeElement?: JSX.Element; children?: JSX.Element }) => (
    <article>
      <h3>{props.title}</h3>
      {props.badgeElement}
      {props.children}
    </article>
  ),
  SparklesIcon: () => <span />,
}));

describe('AI tutor setup level labels', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    activeLanguageData = frequencyLanguage;
    tutorSettings = {
      language: 'xx',
      theme: 'light',
      easeThresholdUnknown: 1.6,
      easeThresholdLearning: 2.2,
      easeThresholdKnown: 3,
      easeThresholdMastered: 4,
      llmEnabled: false,
      llmProvider: 'cloud',
      cloudAuthStatus: 'signed-out',
    };
    streamChatMock.mockClear();
  });

  afterEach(() => {
    container.remove();
  });

  it('uses frequency fallback label templates in the word level filter', async () => {
    const { WordSelector } = await import('./WordSelector');
    const dispose = render(() => (
      <WordSelector
        selected={[]}
        onSelectionChange={vi.fn()}
        customWords={[]}
        onCustomWordsChange={vi.fn()}
      />
    ), container);

    expect(container.textContent).toContain('Band 1');
    expect(container.textContent).toContain('Band 2');
    expect(container.textContent).not.toContain('Band -1');

    dispose();
  });

  it('uses grammar fallback label templates on grammar cards', async () => {
    activeLanguageData = grammarLanguage;

    const { GrammarSelector } = await import('./GrammarSelector');
    const dispose = render(() => (
      <GrammarSelector
        selected={[]}
        onSelectionChange={vi.fn()}
      />
    ), container);

    const cardText = Array.from(container.querySelectorAll('article'))
      .map((article) => article.textContent ?? '')
      .join('\n');
    expect(cardText).toContain('Pattern 1');
    expect(cardText).toContain('Pattern 2');
    expect(cardText).not.toContain('Fallback 1');

    dispose();
  });

  it('shows grammar failure counts with hover-reveal detail copy', async () => {
    activeLanguageData = grammarLanguage;

    const { GrammarSelector } = await import('./GrammarSelector');
    const dispose = render(() => (
      <GrammarSelector
        selected={[]}
        onSelectionChange={vi.fn()}
      />
    ), container);

    const cardText = Array.from(container.querySelectorAll('article'))
      .map((article) => article.textContent ?? '')
      .join('\n');
    expect(cardText).toContain('4/2529');
    expect(cardText).toContain('failed 4/2529 seen');
    expect(cardText).not.toContain('0/0');

    dispose();
  });

  it('uses installed language names instead of raw codes when generating vocabulary', async () => {
    activeLanguageData = {
      name: 'Arabic',
      name_translated: 'العربية',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Arab'],
        },
      },
    };
    tutorSettings = {
      ...tutorSettings,
      language: 'ar',
      llmEnabled: true,
      llmProvider: 'cloud',
      cloudAuthStatus: 'signed-in',
    };

    const { WordSelector } = await import('./WordSelector');
    const dispose = render(() => (
      <WordSelector
        selected={[]}
        onSelectionChange={vi.fn()}
        customWords={[]}
        onCustomWordsChange={vi.fn()}
      />
    ), container);

    const inputs = Array.from(container.querySelectorAll('input'));
    const topicInput = inputs[1] as HTMLInputElement;
    topicInput.value = 'food';
    topicInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const generateButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('mlearn.AITutorSetup.GenerateBtn'));
    expect(generateButton).toBeTruthy();
    generateButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    const streamChatCalls = streamChatMock.mock.calls as unknown as [Array<{ content?: string }>][];
    const messages = streamChatCalls[0]?.[0];
    expect(messages?.[0]?.content).toContain('Arabic (العربية)');
    expect(messages?.[0]?.content).not.toContain('learning ar');
    expect(messages?.[0]?.content).toContain('pronunciation, transliteration, or reading annotation');

    dispose();
  });
});
