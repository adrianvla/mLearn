// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData, WordFrequencyMap } from '../../../../shared/types';

const updateSettingsMock = vi.fn();
const managedKeys = new Set<string>();

const testSettings = {
  language: 'xx',
  learningLanguageLevel: null,
  learningLanguageLevels: {} as Record<string, number | null>,
  frequencyProviderSelections: {} as Record<string, string>,
  frequencyLevelSystemSelections: {} as Record<string, string>,
  autoSuggestFlashcards: true,
  autoSuggestUnknownWords: true,
  use_anki: false,
  srsLearningThreshold: 1500,
  known_ease_threshold: 2500,
  easeThresholdUnknown: 1.3,
  easeThresholdLearning: 1.5,
  easeThresholdKnown: 2.5,
  easeThresholdMastered: 3,
  ankiLearningThreshold: 1500,
  ankiKnownThreshold: 2500,
  enableWordColoring: true,
  colorKnownWords: true,
  do_colour_codes: true,
  passiveEaseEnabled: false,
  manualStatusEaseBuffer: 0.2,
  openAside: true,
  sessionIntensity: 'steady' as 'gentle' | 'steady' | 'intensive',
  examGoal: { kind: 'none' } as { kind: 'none' | 'exam'; deadline?: string; target?: string; language?: string },
};

let testLanguageData: LanguageData = {
  name: 'Example Language',
  settings: { fixed: {} },
  freq: [],
  frequencyLevels: {
    fallbackLabelTemplate: 'Band {level}',
    difficulty: 'higher-is-harder',
    displayOrder: 'ascending',
  },
};

let testWordFrequency: WordFrequencyMap = {};

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings: testSettings,
    updateSettings: updateSettingsMock,
    isSettingManaged: (key: string) => managedKeys.has(key),
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (!params) return key;
      return `${key} ${Object.values(params).join(' ')}`;
    },
  }),
  useLanguage: () => ({
    currentLangData: () => testLanguageData,
    getFreqLevelNames: () => testLanguageData.frequencyLevels?.names ?? {},
    getLanguageFeatures: () => ({
      supportsFrequencyLevels: Boolean(testLanguageData.freq || Object.keys(testWordFrequency).length > 0),
    }),
    wordFrequency: testWordFrequency,
    getWordFrequency: () => testWordFrequency,
  }),
}));

vi.mock('../../../components/common', () => ({
  Btn: (props: { children?: JSX.Element }) => <button>{props.children}</button>,
  SettingRow: (props: { children?: JSX.Element; settingKey?: string }) => <div data-setting-key={props.settingKey}>{props.children}</div>,
  SettingGroup: (props: { children?: JSX.Element }) => <section>{props.children}</section>,
  ToggleSwitch: () => <div />,
  TabContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  TargetIcon: () => <div />,
  Select: (props: JSX.SelectHTMLAttributes<HTMLSelectElement> & { options?: Array<{ value: string; label: string }> }) => (
    <select {...props}>
      {props.children}
      {props.options?.map((option) => <option value={option.value}>{option.label}</option>)}
    </select>
  ),
  Input: (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  ColorInput: () => <div />,
  SortableList: () => <div />,
}));

describe('BehaviourTab', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    updateSettingsMock.mockReset();
    managedKeys.clear();
    testSettings.language = 'xx';
    testSettings.learningLanguageLevels = {};
    testSettings.frequencyProviderSelections = {};
    testSettings.frequencyLevelSystemSelections = {};
    testLanguageData = {
      name: 'Example Language',
      settings: { fixed: {} },
      freq: [],
      frequencyLevels: {
        fallbackLabelTemplate: 'Band {level}',
        difficulty: 'higher-is-harder',
        displayOrder: 'ascending',
      },
    };
    testWordFrequency = {
      alpha: { reading: 'alpha', level: 'ignored', raw_level: 0 },
      beta: { reading: 'beta', level: 'ignored', raw_level: 2 },
      sentinel: { reading: 'sentinel', level: '', raw_level: -1 },
    };
  });

  afterEach(() => {
    container.remove();
  });

  it('shows independently managed children when their ordinary parents are off', async () => {
    testSettings.passiveEaseEnabled = false;
    testSettings.autoSuggestFlashcards = false;
    managedKeys.add('manualStatusEaseBuffer');
    managedKeys.add('autoSuggestUnknownWords');
    managedKeys.add('ankiLearningThreshold');
    managedKeys.add('ankiKnownThreshold');
    const { BehaviourTab } = await import('./BehaviourTab');
    const dispose = render(() => <BehaviourTab />, container);

    expect(container.querySelector('[data-setting-key="manualStatusEaseBuffer"]')).not.toBeNull();
    expect(container.querySelector('[data-setting-key="autoSuggestUnknownWords"]')).not.toBeNull();
    expect(container.querySelector('[data-setting-key="ankiLearningThreshold"]')).not.toBeNull();
    expect(container.querySelector('[data-setting-key="ankiKnownThreshold"]')).not.toBeNull();
    dispose();
  });

});
