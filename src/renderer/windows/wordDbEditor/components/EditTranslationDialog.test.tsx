// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { EditTranslationDialog, type TranslationOverride } from './EditTranslationDialog';

const setOverrideMock = vi.fn();
const translateWordMock = vi.fn();
let prosodyTypeMock: 'none' | 'japanese-pitch-accent' | 'tone-contour' = 'none';
let prosodyLabelsMock = true;
let showProsodyMock = true;

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings: {
      language: prosodyTypeMock === 'japanese-pitch-accent' ? 'ja' : 'test',
      showProsody: showProsodyMock,
    },
  }),
  useLanguage: () => ({
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    currentLangData: () => ({
      name: 'Test Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: prosodyTypeMock === 'japanese-pitch-accent'
        ? {
          type: 'japanese-pitch-accent',
          positionLabel: 'Accent position',
          positionPlaceholder: '0, 1, 2...',
        }
        : prosodyTypeMock === 'tone-contour'
          ? {
            type: 'tone-contour',
            ...(prosodyLabelsMock
              ? {
                positionLabel: 'Tone position',
                positionPlaceholder: '1, 2, 3...',
              }
              : {}),
          }
          : { type: 'none' },
    }),
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'mlearn.WordDbEditor.EditTranslation.Title') return `Edit ${params?.word ?? ''}`;
      if (key === 'mlearn.WordDbEditor.EditTranslation.RemoveOverride') return 'Remove override';
      if (key === 'mlearn.CardEditor.Fields.Word') return 'Word';
      if (key === 'mlearn.CardEditor.Fields.Reading') return 'Reading';
      if (key === 'mlearn.CardEditor.Fields.JapanesePitchAccent') return 'Pitch accent';
      if (key === 'mlearn.CardEditor.Fields.JapanesePitchAccentPlaceholder') return 'Pitch placeholder';
      if (key === 'mlearn.CardEditor.Fields.ProsodyPosition') return 'Prosody position';
      if (key === 'mlearn.CardEditor.Fields.ProsodyPositionPlaceholder') return '0, 1, 2...';
      if (key === 'mlearn.CardEditor.Fields.Definitions') return 'Definitions';
      if (key === 'mlearn.CardEditor.Fields.StructuredContent') return 'Structured content';
      if (key === 'mlearn.JapanesePitchAccent.Nakadaka') return 'Nakadaka';
      if (key === 'mlearn.JapanesePitchAccent.Odaka') return 'Odaka';
      if (key === 'mlearn.Global.Save') return 'Save';
      if (key === 'mlearn.Global.Cancel') return 'Cancel';
      return key;
    },
  }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    translateWord: translateWordMock,
    setOverride: setOverrideMock,
  }),
}));

vi.mock('../../../components/common', () => ({
  AlertBanner: (props: { message: string }) => <div role="alert">{props.message}</div>,
  Btn: (props: { children?: JSX.Element; onClick?: () => void }) => (
    <button type="button" onClick={props.onClick}>{props.children}</button>
  ),
  ContentEditable: (props: { value?: string; onChange?: (value: string) => void }) => (
    <textarea
      data-testid="structured-content"
      value={props.value ?? ''}
      onInput={(event) => props.onChange?.((event.target as HTMLTextAreaElement).value)}
    />
  ),
  FormField: (props: { label?: string; children?: JSX.Element }) => (
    <label>
      <span>{props.label}</span>
      {props.children}
    </label>
  ),
  Input: (props: {
    value?: string | number;
    disabled?: boolean;
    type?: string;
    placeholder?: string;
    onInput?: (event: InputEvent) => void;
  }) => (
    <input
      disabled={props.disabled}
      type={props.type ?? 'text'}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      onInput={(event) => props.onInput?.(event as InputEvent)}
    />
  ),
  Modal: (props: { children?: JSX.Element; footer?: JSX.Element; isOpen: boolean; title?: string }) => (
    <div>
      <h1>{props.title}</h1>
      {props.isOpen ? props.children : null}
      {props.footer}
    </div>
  ),
  ModalFooter: (props: {
    leftContent?: JSX.Element;
    cancelText?: string;
    confirmText?: string;
    onCancel?: () => void;
    onConfirm?: () => void;
  }) => (
    <footer>
      {props.leftContent}
      <button type="button" onClick={props.onCancel}>{props.cancelText}</button>
      <button type="button" onClick={props.onConfirm}>{props.confirmText}</button>
    </footer>
  ),
  Spinner: () => <span>Loading</span>,
  Textarea: (props: { value?: string; onInput?: (event: InputEvent) => void }) => (
    <textarea
      value={props.value ?? ''}
      onInput={(event) => props.onInput?.(event as InputEvent)}
    />
  ),
}));

vi.mock('../../../components/language-specific', () => ({
  ProsodyOverlay: (props: { prosodyPosition?: number | null }) => (
    <span data-testid="pitch-preview">{props.prosodyPosition ?? ''}</span>
  ),
}));

function renderDialog(initialData: TranslationOverride) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const onSave = vi.fn();
  return {
    container,
    onSave,
    dispose: render(() => (
      <EditTranslationDialog
        word="Haus"
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        initialData={initialData}
      />
    ), container),
  };
}

describe('EditTranslationDialog', () => {
  beforeEach(() => {
    setOverrideMock.mockReset();
    translateWordMock.mockReset();
    prosodyTypeMock = 'none';
    prosodyLabelsMock = true;
    showProsodyMock = true;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hides Japanese pitch controls and clears pitch overrides for languages without prosody metadata', async () => {
    const { container, onSave, dispose } = renderDialog({
      reading: 'haus',
      prosodyPosition: 2,
      definitions: ['house'],
    });

    expect(container.textContent).not.toContain('Pitch accent');

    container.querySelectorAll('button')[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSave).toHaveBeenCalledWith({
      reading: 'haus',
      prosodyPosition: null,
      definitions: ['house'],
      structuredContent: undefined,
    });
    expect(setOverrideMock).toHaveBeenCalledWith('Haus', {
      data: [
        {
          reading: 'haus',
          definitions: ['house'],
        },
      ],
    });

    dispose();
  });

  it('shows and saves pitch controls only when prosody metadata supports them', async () => {
    prosodyTypeMock = 'japanese-pitch-accent';
    const { container, onSave, dispose } = renderDialog({
      reading: 'あめ',
      prosodyPosition: 2,
      definitions: ['rain'],
    });

    expect(container.textContent).not.toContain('Pitch accent');
    expect(container.textContent).toContain('Odaka');
    expect(container.textContent).toContain('Accent position');
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).placeholder).toBe('0, 1, 2...');

    container.querySelectorAll('button')[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSave).toHaveBeenCalledWith({
      reading: 'あめ',
      prosodyPosition: 2,
      prosody: {
        type: 'japanese-pitch-accent',
        position: 2,
        raw: {
          type: 'japanese-pitch-accent',
          position: 2,
        },
      },
      definitions: ['rain'],
      structuredContent: undefined,
    });
    expect(setOverrideMock).toHaveBeenCalledWith('Haus', {
      data: [
        {
          reading: 'あめ',
          definitions: ['rain'],
        },
        undefined,
        {
          type: 'japanese-pitch-accent',
          position: 2,
        },
      ],
    });

    dispose();
  });

  it('saves package-defined positional prosody without Japanese pitch-accent fields', async () => {
    prosodyTypeMock = 'tone-contour';
    const { container, onSave, dispose } = renderDialog({
      reading: 'ma1',
      prosodyPosition: 2,
      definitions: ['mother'],
    });

    expect(container.textContent).toContain('Tone position');
    expect(container.textContent).not.toContain('Nakadaka');
    expect(container.querySelector('[data-testid="pitch-preview"]')).toBeNull();
    expect(container.querySelector('.edit-translation-dialog__prosody-preview')?.textContent).toContain('Tone position');
    expect(container.querySelector('.edit-translation-dialog__prosody-preview')?.textContent).toContain('2');
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).placeholder).toBe('1, 2, 3...');

    container.querySelectorAll('button')[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSave).toHaveBeenCalledWith({
      reading: 'ma1',
      prosodyPosition: 2,
      prosody: {
        type: 'tone-contour',
        position: 2,
        raw: {
          type: 'tone-contour',
          position: 2,
        },
      },
      definitions: ['mother'],
      structuredContent: undefined,
    });
    expect(setOverrideMock).toHaveBeenCalledWith('Haus', {
      data: [
        {
          reading: 'ma1',
          definitions: ['mother'],
        },
        undefined,
        {
          type: 'tone-contour',
          position: 2,
        },
      ],
    });

    dispose();
  });

  it('initializes package-defined prosody from the generic payload when legacy pitch is absent', async () => {
    prosodyTypeMock = 'tone-contour';
    const { container, onSave, dispose } = renderDialog({
      reading: 'ma1',
      prosodyPosition: null,
      prosody: {
        type: 'tone-contour',
        position: 3,
        raw: {
          type: 'tone-contour',
          position: 3,
          contours: [{ syllable: 'ma', tone: 'falling' }],
        },
      },
      definitions: ['horse'],
    });

    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('3');

    container.querySelectorAll('button')[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSave).toHaveBeenCalledWith({
      reading: 'ma1',
      prosodyPosition: 3,
      prosody: {
        type: 'tone-contour',
        position: 3,
        raw: {
          type: 'tone-contour',
          position: 3,
        },
      },
      definitions: ['horse'],
      structuredContent: undefined,
    });

    dispose();
  });

  it('uses neutral fallback labels for package-defined prosody without labels', async () => {
    prosodyTypeMock = 'tone-contour';
    prosodyLabelsMock = false;
    const { container, dispose } = renderDialog({
      reading: 'ma1',
      prosodyPosition: 2,
      definitions: ['mother'],
    });

    expect(container.textContent).toContain('Prosody position');
    expect(container.textContent).not.toContain('Pitch accent');
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).placeholder).toBe('0, 1, 2...');
    expect(container.querySelector('[data-testid="pitch-preview"]')).toBeNull();
    expect(container.querySelector('.edit-translation-dialog__prosody-preview')?.textContent).toContain('Prosody position');
    expect(container.querySelector('.edit-translation-dialog__prosody-preview')?.textContent).toContain('2');

    dispose();
  });
});
