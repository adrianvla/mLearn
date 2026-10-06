// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData, WordFrequencyMap } from '../../../shared/types';

const updateSettingsMock = vi.fn();
const managedKeys = new Set<string>();

const testSettings = {
  language: 'xx',
  learningLanguageLevel: null,
  learningLanguageLevels: {} as Record<string, number | null>,
  frequencyProviderSelections: {} as Record<string, string>,
  frequencyLevelSystemSelections: {} as Record<string, string>,
  frequencyProviderTargets: {} as Record<string, Record<string, number | null>>,
  frequencyLevelSystemsByProvider: {} as Record<string, Record<string, string>>,
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

vi.mock('../../context', () => ({
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

vi.mock('../../components/common', () => ({
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
  LearningGoals: () => <div data-testid="shared-goals" />,
  Input: (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  ColorInput: () => <div />,
  SortableList: () => <div />,
}));

describe('LearningPlanSettings', () => {
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
    testSettings.frequencyProviderTargets = {};
    testSettings.frequencyLevelSystemsByProvider = {};
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

  it('offers frequency levels discovered from installed frequency data when names are omitted', async () => {
    const { LearningPlanSettings } = await import('./LearningPlanSettings');
    const dispose = render(() => <LearningPlanSettings />, container);

    const browsingPreference = container.querySelector<HTMLDetailsElement>('.learning-plan-curriculum-preference');
    expect(browsingPreference?.open).toBe(false);
    expect(browsingPreference?.querySelector('summary')?.textContent).toBe('mlearn.LearningPlan.BrowsePreference');

    const selects = Array.from(container.querySelectorAll('select'));
    const levelSelect = selects.find((select) =>
      Array.from(select.options).some((option) => option.textContent === 'Band 2')
    );

    expect(levelSelect).toBeDefined();
    expect(Array.from(levelSelect!.options).map((option) => [option.value, option.textContent])).toContainEqual(['2', 'Band 2']);
    expect(Array.from(levelSelect!.options).map((option) => option.value)).not.toContain('-1');
    expect(Array.from(levelSelect!.options).map((option) => option.value)).not.toContain('0');

    dispose();
  });

  it('does not present the legacy frequency preference as a second active target', async () => {
    testSettings.learningLanguageLevels = { xx: 2 };
    const { LearningPlanSettings } = await import('./LearningPlanSettings');
    const dispose = render(() => <LearningPlanSettings />, container);

    const preference = container.querySelector<HTMLDetailsElement>('.learning-plan-curriculum-preference');
    expect(preference?.open).toBe(false);
    expect(preference?.textContent).toContain('Band 2');
    expect(container.textContent).not.toContain('mlearn.LearningPlan.CurrentTarget');
    expect(container.querySelector('[data-testid="shared-goals"]')).not.toBeNull();
    dispose();
  });

  it('keeps declared zero levels selectable for languages that use them', async () => {
    testLanguageData = {
      ...testLanguageData,
      frequencyLevels: {
        names: { '0': 'Starter', '2': 'Band 2' },
        difficulty: 'higher-is-harder',
        displayOrder: 'ascending',
      },
    };

    const { LearningPlanSettings } = await import('./LearningPlanSettings');
    const dispose = render(() => <LearningPlanSettings />, container);

    const levelSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.textContent === 'Starter')
    );

    expect(levelSelect).toBeDefined();
    expect(Array.from(levelSelect!.options).map((option) => [option.value, option.textContent])).toContainEqual(['0', 'Starter']);

    levelSelect!.value = '0';
    levelSelect!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(updateSettingsMock).toHaveBeenCalledWith({
      learningLanguageLevels: {
        xx: 0,
      },
    });

    dispose();
  });

  it('offers provider and level-system selectors and retains each provider target', async () => {
    testSettings.frequencyProviderSelections = { xx: 'smartool' };
    testSettings.frequencyLevelSystemSelections = { xx: 'cefr' };
    testSettings.learningLanguageLevels = { xx: 3 };
    testSettings.frequencyProviderTargets = { xx: { smartool: 3, openrussian: 1 } };
    testLanguageData = {
      ...testLanguageData,
      activeFrequencyProvider: 'smartool',
      activeFrequencyLevelSystem: 'cefr',
      defaultFrequencyProvider: 'openrussian',
      frequencyProviders: {
        openrussian: {
          name: 'OpenRussian',
          freq: [['частый', 'ча́стый', 1]],
          frequencyLevels: { names: { '1': 'Common' }, rowLevelIndex: 2 },
        },
        smartool: {
          name: 'SMARTool',
          freq: [['слово', 'слово', 3]],
          defaultLevelSystem: 'cefr',
          levelSystems: {
            cefr: {
              name: 'CEFR',
              frequencyLevels: { names: { '3': 'B1' }, rowLevelIndex: 2 },
            },
            trki: {
              name: 'ТРКИ',
              frequencyLevels: { names: { '3': 'ТРКИ-1' }, rowLevelIndex: 2 },
            },
          },
        },
      },
    };

    const { LearningPlanSettings } = await import('./LearningPlanSettings');
    const dispose = render(() => <LearningPlanSettings />, container);
    const selects = Array.from(container.querySelectorAll('select'));
    const providerSelect = selects.find((select) =>
      Array.from(select.options).some((option) => option.textContent === 'SMARTool')
    );
    const levelSystemSelect = selects.find((select) =>
      Array.from(select.options).some((option) => option.textContent === 'ТРКИ')
    );

    expect(providerSelect?.value).toBe('smartool');
    expect(levelSystemSelect?.value).toBe('cefr');

    levelSystemSelect!.value = 'trki';
    levelSystemSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({
      frequencyLevelSystemSelections: { xx: 'trki' },
      frequencyLevelSystemsByProvider: { xx: { smartool: 'trki' } },
      learningLanguageLevels: { xx: 3 },
    });

    updateSettingsMock.mockReset();
    providerSelect!.value = 'openrussian';
    providerSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({
      frequencyProviderSelections: { xx: 'openrussian' },
      frequencyLevelSystemSelections: {},
      frequencyProviderTargets: { xx: { smartool: 3, openrussian: 1 } },
      learningLanguageLevels: { xx: 1 },
    });

    dispose();
  });

  it('shares Home goal controls rather than maintaining another goal editor', async () => {
    const { LearningPlanSettings } = await import('./LearningPlanSettings');
    const dispose = render(() => <LearningPlanSettings />, container);
    expect(container.querySelector('[data-testid="shared-goals"]')).not.toBeNull();
    dispose();
  });

  it('keeps legacy intensity stored without exposing an ineffective algorithm control', async () => {
    testSettings.sessionIntensity = 'gentle';
    const { LearningPlanSettings } = await import('./LearningPlanSettings');
    const dispose = render(() => <LearningPlanSettings />, container);
    expect(container.querySelector('option[value="gentle"]')).toBeNull();
    expect(container.querySelector('[data-testid="shared-goals"]')).not.toBeNull();
    expect(testSettings.sessionIntensity).toBe('gentle');
    dispose();
  });
});
