// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { FlashcardEditor } from './FlashcardEditor';
import type { Flashcard } from '../../../shared/types';

const {
  generateExampleSentenceWithLLMMock,
  updateFlashcardContentMock,
  colorizeTokenizedTextMock,
} = vi.hoisted(() => ({
  generateExampleSentenceWithLLMMock: vi.fn(),
  updateFlashcardContentMock: vi.fn(),
  colorizeTokenizedTextMock: vi.fn(),
}));

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: {
      language: 'de',
      showProsody: true,
      colour_codes: { noun: '#de' },
      backendMode: 'local',
      backendUrl: 'http://localhost:7752',
      cloudAuthAccessToken: '',
      cloudAuthToken: '',
    },
  }),
  useLanguage: () => ({
    langData: {
      de: {
        name: 'German',
        settings: { fixed: {} },
        textProcessing: {
          partOfSpeech: {
            colors: { noun: '#de' },
          },
        },
        prosody: { type: 'none' },
      },
      ja: {
        name: 'Japanese',
        settings: { fixed: {} },
        textProcessing: {
          partOfSpeech: {
            colors: { noun: '#ja' },
          },
        },
        prosody: {
          type: 'japanese-pitch-accent',
          positionLabel: 'Accent position',
          positionPlaceholder: '0, 1, 2...',
        },
      },
      zh: {
        name: 'Chinese',
        settings: { fixed: {} },
        textProcessing: {
          partOfSpeech: {
            colors: { noun: '#zh' },
          },
        },
        prosody: {
          type: 'tone-contour',
          positionLabel: 'Tone contour',
          positionPlaceholder: 'rising, falling...',
        },
      },
      xx: {
        name: 'Unlabeled Prosody',
        settings: { fixed: {} },
        prosody: {
          type: 'tone-contour',
        },
      },
    },
    currentLangData: () => ({
      name: 'German',
      settings: { fixed: {} },
      textProcessing: {
        partOfSpeech: {
          colors: { noun: '#de' },
        },
      },
      prosody: { type: 'none' },
    }),
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const labels: Record<string, string> = {
        'mlearn.CardEditor.RegenerateExample': 'Regenerate Example',
        'mlearn.Global.Cancel': 'Cancel',
        'mlearn.Global.Actions.SaveChanges': 'Save',
        'mlearn.CardEditor.Fields.JapanesePitchAccent': 'Pitch Accent',
        'mlearn.CardEditor.Fields.ProsodyPosition': 'Prosody position',
        'mlearn.CardEditor.Fields.ProsodyPositionPlaceholder': '0, 1, 2...',
        'mlearn.CardEditor.Regenerate.Title': 'Regenerate TTS',
        'mlearn.JapanesePitchAccent.Atamadaka': 'Atamadaka',
        'mlearn.JapanesePitchAccent.DropAfterMora': `Drop after mora ${params?.mora}`,
      };
      return labels[key] ?? key;
    },
  }),
  useFlashcards: () => ({
    intervalToString: (interval: number) => String(interval),
    generateExampleSentenceWithLLM: generateExampleSentenceWithLLMMock,
    updateFlashcardContent: updateFlashcardContentMock,
  }),
}));

vi.mock('../../../shared/platform', () => ({
  isElectron: () => true,
}));

vi.mock('../../utils/languageTokenization', () => ({
  colorizeTokenizedText: colorizeTokenizedTextMock,
}));

vi.mock('../common/Feedback/Toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('../common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  Input: (props: {
    label?: string;
    value?: string | number;
    placeholder?: string;
    onInput?: (event: InputEvent & { currentTarget: HTMLInputElement }) => void;
  }) => (
    <label>
      <span>{props.label}</span>
      <input
        value={props.value ?? ''}
        placeholder={props.placeholder}
        onInput={(event) => props.onInput?.(event as InputEvent & { currentTarget: HTMLInputElement })}
      />
    </label>
  ),
}));

vi.mock('../language-specific', () => ({
  ProsodyOverlay: (props: { language?: string; prosodyPosition?: number | null }) => (
    <span data-testid="prosody-overlay-preview" data-language={props.language ?? ''}>
      {props.prosodyPosition ?? ''}
    </span>
  ),
}));

vi.mock('./TtsGenerateModal', () => ({
  TtsGenerateModal: (props: { language?: string }) => (
    <div data-testid="tts-modal" data-language={props.language ?? ''} />
  ),
}));

function makeJapaneseCard(): Flashcard {
  return {
    id: 'card-1',
    language: 'ja',
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: 1,
    lastReviewed: 0,
    lastUpdated: 1,
    content: {
      type: 'word',
      front: '雨',
      back: 'rain',
      reading: 'あめ',
      prosody: {
        type: 'japanese-pitch-accent',
        position: 1,
        raw: { pitches: [{ position: 1 }] },
      },
      extra: { sourceLanguageFeature: 'kept' },
    },
  };
}

function makeProsodyOnlyJapaneseCard(): Flashcard {
  const card = makeJapaneseCard();
  return {
    ...card,
    content: {
      ...card.content,
      prosody: {
        type: 'japanese-pitch-accent',
        position: 2,
        raw: { pitches: [{ position: 2 }] },
      },
    },
  };
}

function makeToneContourCardWithStaleLegacyPitch(): Flashcard {
  return {
    id: 'card-tone',
    language: 'zh',
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: 1,
    lastReviewed: 0,
    lastUpdated: 1,
    content: {
      type: 'word',
      front: '妈',
      back: 'mother',
      reading: 'ma1',
      prosody: {
        type: 'tone-contour',
        raw: { tone: 'high-level' },
      },
    },
  };
}

function makeToneContourCardWithPosition(): Flashcard {
  const card = makeToneContourCardWithStaleLegacyPitch();
  return {
    ...card,
    content: {
      ...card.content,
      prosody: {
        type: 'tone-contour',
        position: 3,
        raw: { tone: 'rising' },
      },
    },
  };
}

function makeUnlabeledProsodyCard(): Flashcard {
  return {
    id: 'card-unlabeled-prosody',
    language: 'xx',
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: 1,
    lastReviewed: 0,
    lastUpdated: 1,
    content: {
      type: 'word',
      front: 'word',
      back: 'definition',
      reading: 'reading',
      prosody: {
        type: 'tone-contour',
        position: 1,
      },
    },
  };
}

function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.trim() === label);
  expect(button).toBeTruthy();
  button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function setPitchInput(container: HTMLElement, value: string) {
  const input = container.querySelector('input[type="number"]') as HTMLInputElement | null;
  expect(input).toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

describe('FlashcardEditor', () => {
  beforeEach(() => {
    generateExampleSentenceWithLLMMock.mockResolvedValue({
      sentence: '雨が降っています。',
      meaning: 'It is raining.',
    });
    updateFlashcardContentMock.mockReset();
    colorizeTokenizedTextMock.mockResolvedValue('<span>雨</span>が降っています。');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('uses the saved card language when regenerating examples even if the active language differs', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => (
      <FlashcardEditor
        flashcard={makeJapaneseCard()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    ), container);

    clickButton(container, 'Regenerate Example');
    await Promise.resolve();
    await Promise.resolve();

    expect(generateExampleSentenceWithLLMMock).toHaveBeenCalledWith('雨', 'rain', 'ja');
    expect(colorizeTokenizedTextMock).toHaveBeenCalledWith(expect.objectContaining({
      text: '雨が降っています。',
      language: 'ja',
      languageData: expect.objectContaining({ name: 'Japanese' }),
      colourCodes: { noun: '#ja' },
      targetWord: '雨',
    }));
    expect(updateFlashcardContentMock).toHaveBeenCalledWith('card-1', {
      example: '<span>雨</span>が降っています。',
      exampleMeaning: 'It is raining.',
    });

    dispose();
  });

  it('preserves existing generic prosody payloads when saving through the friendly editor', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onSave = vi.fn();
    const dispose = render(() => (
      <FlashcardEditor
        flashcard={makeJapaneseCard()}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    ), container);

    clickButton(container, 'Save');

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      front: '雨',
      back: 'rain',
      prosody: {
        type: 'japanese-pitch-accent',
        position: 1,
        raw: { pitches: [{ position: 1 }] },
      },
      extra: { sourceLanguageFeature: 'kept' },
    }));
    expect(container.querySelector('[data-testid="prosody-overlay-preview"]')?.getAttribute('data-language')).toBe('ja');
    expect(container.textContent).toContain('Atamadaka');
    expect(container.textContent).toContain('Accent position');
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).placeholder).toBe('0, 1, 2...');

    dispose();
  });

  it('initializes Japanese pitch from prosody and saves prosody-only content', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onSave = vi.fn();
    const dispose = render(() => (
      <FlashcardEditor
        flashcard={makeProsodyOnlyJapaneseCard()}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    ), container);

    expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('2');
    setPitchInput(container, '3');
    clickButton(container, 'Save');

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      prosody: {
        type: 'japanese-pitch-accent',
        position: 3,
        raw: { pitches: [{ position: 2 }] },
      },
    }));
    expect(onSave.mock.calls[0]?.[0].pitchAccent).toBeUndefined();

    dispose();
  });

  it('does not persist stale legacy Japanese pitch fields for package-defined prosody models', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onSave = vi.fn();
    const dispose = render(() => (
      <FlashcardEditor
        flashcard={makeToneContourCardWithStaleLegacyPitch()}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    ), container);

    const input = container.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input!.value).toBe('');
    expect(input!.placeholder).toBe('rising, falling...');
    expect(container.textContent).toContain('Tone contour');
    expect(container.querySelector('[data-testid="prosody-overlay-preview"]')).toBeNull();
    clickButton(container, 'Save');

    const saved = onSave.mock.calls[0]?.[0];
    expect(saved.pitchAccent).toBeUndefined();
    expect(saved.prosody).toEqual({
      type: 'tone-contour',
      raw: { tone: 'high-level' },
    });

    dispose();
  });

  it('edits package-defined prosody positions without adding Japanese pitch fields', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onSave = vi.fn();
    const dispose = render(() => (
      <FlashcardEditor
        flashcard={makeToneContourCardWithPosition()}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    ), container);

    expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('3');
    expect(container.querySelector('[data-testid="prosody-overlay-preview"]')).toBeNull();
    expect(container.querySelector('.prosody-preview')?.textContent).toContain('Tone contour');
    expect(container.querySelector('.prosody-preview')?.textContent).toContain('3');
    setPitchInput(container, '4');
    expect(container.querySelector('.prosody-preview')?.textContent).toContain('4');
    clickButton(container, 'Save');

    const saved = onSave.mock.calls[0]?.[0];
    expect(saved.pitchAccent).toBeUndefined();
    expect(saved.prosody).toEqual({
      type: 'tone-contour',
      position: 4,
      raw: { tone: 'rising' },
    });

    dispose();
  });

  it('clears package-defined prosody positions without restoring stale values', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onSave = vi.fn();
    const dispose = render(() => (
      <FlashcardEditor
        flashcard={makeToneContourCardWithPosition()}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    ), container);

    setPitchInput(container, '');
    expect(container.querySelector('.prosody-preview')).toBeNull();
    clickButton(container, 'Save');

    const saved = onSave.mock.calls[0]?.[0];
    expect(saved.pitchAccent).toBeUndefined();
    expect(saved.prosody).toEqual({
      type: 'tone-contour',
      raw: { tone: 'rising' },
    });

    dispose();
  });

  it('uses neutral fallback labels for package-defined prosody without labels', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => (
      <FlashcardEditor
        flashcard={makeUnlabeledProsodyCard()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    ), container);

    expect(container.textContent).toContain('Prosody position');
    expect(container.textContent).not.toContain('Pitch Accent');
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).placeholder).toBe('0, 1, 2...');
    expect(container.querySelector('[data-testid="prosody-overlay-preview"]')).toBeNull();
    expect(container.querySelector('.prosody-preview')?.textContent).toContain('Prosody position');
    expect(container.querySelector('.prosody-preview')?.textContent).toContain('1');

    dispose();
  });
});
