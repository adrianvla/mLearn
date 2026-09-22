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

  it('offers provider and level-system selectors and resets an incompatible proficiency ceiling', async () => {
    testSettings.frequencyProviderSelections = { xx: 'smartool' };
    testSettings.frequencyLevelSystemSelections = { xx: 'cefr' };
    testSettings.learningLanguageLevels = { xx: 3 };
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
      learningLanguageLevels: { xx: null },
    });

    updateSettingsMock.mockReset();
    providerSelect!.value = 'openrussian';
    providerSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({
      frequencyProviderSelections: { xx: 'openrussian' },
      frequencyLevelSystemSelections: {},
      learningLanguageLevels: { xx: null },
    });

    dispose();
  });

  it('clears an exam goal and its fields explicitly, preserving the sibling field', async () => {
    const { LearningPlanSettings } = await import('./LearningPlanSettings');

    // exam → none clears the whole goal object.
    testSettings.sessionIntensity = 'steady';
    testSettings.examGoal = { kind: 'exam', deadline: '2026-10-01', target: 'JLPT N1' };
    let dispose = render(() => <LearningPlanSettings />, container);
    const goalSelect = Array.from(container.querySelectorAll('select')).find(select => select.querySelector('option[value="exam"]'))!;
    expect(goalSelect.value).toBe('exam');
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(1);

    goalSelect.value = 'none';
    goalSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ examGoal: { kind: 'none' } });
    dispose();
    updateSettingsMock.mockReset();

    // Emptying the target drops target and keeps the deadline. A goal
    // recorded before scoping gets the active language stamped on edit.
    testSettings.examGoal = { kind: 'exam', deadline: '2026-10-01', target: 'JLPT N1' };
    dispose = render(() => <LearningPlanSettings />, container);
    const targetInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(targetInput.value).toBe('JLPT N1');
    targetInput.value = '';
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ examGoal: { kind: 'exam', deadline: '2026-10-01', language: 'xx' } });
    dispose();
    updateSettingsMock.mockReset();

    // Emptying the date drops deadline and keeps the target.
    dispose = render(() => <LearningPlanSettings />, container);
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-10-01');
    dateInput.value = '';
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ examGoal: { kind: 'exam', target: 'JLPT N1', language: 'xx' } });
    dispose();
    updateSettingsMock.mockReset();

    // Non-empty edits set the field.
    dispose = render(() => <LearningPlanSettings />, container);
    const editableTarget = container.querySelector('input[type="text"]') as HTMLInputElement;
    editableTarget.value = 'Goethe B1';
    editableTarget.dispatchEvent(new Event('input', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ examGoal: { kind: 'exam', deadline: '2026-10-01', target: 'Goethe B1', language: 'xx' } });
    dispose();
  });

  it('stamps a fresh exam goal with the active learning language and keeps an existing stamp', async () => {
    const { LearningPlanSettings } = await import('./LearningPlanSettings');

    // Fresh goal: the active learning language is the stamp.
    testSettings.sessionIntensity = 'steady';
    testSettings.examGoal = { kind: 'none' };
    let dispose = render(() => <LearningPlanSettings />, container);
    const goalSelect = Array.from(container.querySelectorAll('select')).find(select => select.querySelector('option[value="exam"]'))!;
    goalSelect.value = 'exam';
    goalSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ examGoal: { kind: 'exam', language: 'xx' } });
    dispose();
    updateSettingsMock.mockReset();

    // An already-scoped goal keeps its stamp on re-selection.
    testSettings.examGoal = { kind: 'exam', deadline: '2026-10-01', language: 'ja' };
    dispose = render(() => <LearningPlanSettings />, container);
    const scopedSelect = Array.from(container.querySelectorAll('select')).find(select => select.querySelector('option[value="exam"]'))!;
    scopedSelect.value = 'exam';
    scopedSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ examGoal: { kind: 'exam', deadline: '2026-10-01', language: 'ja' } });
    dispose();
    updateSettingsMock.mockReset();

    // Field edits never re-scope an existing stamp.
    dispose = render(() => <LearningPlanSettings />, container);
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    dateInput.value = '2026-11-15';
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ examGoal: { kind: 'exam', deadline: '2026-11-15', language: 'ja' } });
    dispose();
  });

  it('preselects the session intensity select from settings', async () => {
    testSettings.sessionIntensity = 'gentle';
    testSettings.examGoal = { kind: 'none' };
    const { LearningPlanSettings } = await import('./LearningPlanSettings');
    const dispose = render(() => <LearningPlanSettings />, container);

    const selects = [Array.from(container.querySelectorAll('select')).find(select => select.querySelector('option[value="gentle"]'))!, Array.from(container.querySelectorAll('select')).find(select => select.querySelector('option[value="exam"]'))!];
    expect(selects[0]!.value).toBe('gentle');
    expect(selects[1]!.value).toBe('none');
    // No exam goal → no target/deadline fields.
    expect(container.querySelector('input[type="date"]')).toBeNull();

    selects[0]!.value = 'intensive';
    selects[0]!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateSettingsMock).toHaveBeenCalledWith({ sessionIntensity: 'intensive' });
    dispose();
  });
});
