// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { WordStatus } from '../../shared/constants';
import {
  DEFAULT_SETTINGS,
  type LanguageColoredProsodyConfig,
  type LanguageData,
  type Settings,
} from '../../shared/types';
import {
  applyWordDecorations,
  createWordRenderText,
  type WordRenderTextContext,
} from './wordRenderText';

const { prosodySpy } = vi.hoisted(() => ({ prosodySpy: vi.fn() }));

vi.mock('../components/language-specific/ProsodyOverlay', () => ({
  ProsodyOverlay: (props: {
    children?: unknown;
    class?: string;
    word?: string;
    reading?: string;
    prosodyPosition?: unknown;
    prosodyType?: unknown;
  }) => {
    prosodySpy(props);
    return <span data-prosody-spy class={props.class}>{props.children as never}</span>;
  },
}));

const toneConfig: LanguageColoredProsodyConfig = {
  renderer: 'tone-marked-syllables',
  paletteId: 'tones',
  colors: {
    'tone-1': '#ff00ff',
    'tone-2': '#ffff00',
    'tone-3': '#00b84a',
    'tone-4': '#ff0000',
    neutral: '#006eff',
  },
  labels: {},
};

const toneLanguage: LanguageData = {
  name: 'Chinese',
  prosody: { coloring: toneConfig },
};

const pitchConfig: LanguageColoredProsodyConfig = {
  renderer: 'pitch-accent-category',
  paletteId: 'pitch',
  colors: { heiban: '#00b84a', atamadaka: '#ffa500', nakadaka: '#00aaff', odaka: '#ff0000' },
  labels: {},
};

const pitchLanguage: LanguageData = {
  name: 'Japanese',
  prosody: { coloring: pitchConfig },
};

const word = '妈麻马骂吗';
const reading = 'mā má mǎ mà ma';

const options = {
  slot: 'word' as const,
  word,
  reading,
  displayReading: reading,
  isReadingScript: false,
  class: 'fixture-word',
  style: { color: 'rgb(1, 2, 3)' },
};

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeCtx(overrides: Partial<WordRenderTextContext> = {}): WordRenderTextContext {
  return {
    languageData: () => toneLanguage,
    prosodyPosition: () => null,
    ease: () => undefined,
    partOfSpeechColor: () => undefined,
    status: () => 'unknown' as WordStatus,
    isKnown: () => false,
    surface: 'subtitle',
    settings: () => makeSettings(),
    ...overrides,
  };
}

function renderTextResult(ctx: WordRenderTextContext) {
  const renderText = createWordRenderText(ctx);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => renderText(word, options), container);
  return { container, dispose };
}

describe('createWordRenderText', () => {
  it('colors each surface character segment when relevant-only is off on an other surface', () => {
    const { container, dispose } = renderTextResult(makeCtx({ surface: 'other' }));
    const segments = container.querySelectorAll<HTMLElement>('.colored-prosody__segment');
    expect(segments).toHaveLength(5);
    expect(Array.from(segments).map((element) => element.dataset.prosodyValue)).toEqual([
      'tone-1',
      'tone-2',
      'tone-3',
      'tone-4',
      'neutral',
    ]);
    expect(segments[0].style.color).toBe('#ff00ff');
    dispose();
  });

  it('colors on the subtitle surface when relevant-only is on', () => {
    const { container, dispose } = renderTextResult(makeCtx({
      surface: 'subtitle',
      settings: () => makeSettings({ coloredProsodyRelevantOnly: true }),
    }));
    expect(container.querySelectorAll('.colored-prosody__segment')).toHaveLength(5);
    dispose();
  });

  it('falls back to the plain span on other surfaces when relevant-only is on', () => {
    const { container, dispose } = renderTextResult(makeCtx({
      surface: 'other',
      settings: () => makeSettings({ coloredProsodyRelevantOnly: true }),
    }));
    const span = container.querySelector('span');
    expect(container.querySelector('.colored-prosody__segment')).toBeNull();
    expect(span?.className).toBe('fixture-word');
    expect(span?.style.color).toBe('rgb(1, 2, 3)');
    expect(span?.textContent).toBe(word);
    dispose();
  });

  it('returns the plain span when the colored prosody master toggle is off', () => {
    const { container, dispose } = renderTextResult(makeCtx({
      settings: () => makeSettings({ coloredProsodyEnabled: false }),
    }));
    expect(container.querySelector('.colored-prosody__segment')).toBeNull();
    expect(container.querySelector('span')?.textContent).toBe(word);
    dispose();
  });

  it('returns the plain span when the combined status exceeds the status limit', () => {
    const { container, dispose } = renderTextResult(makeCtx({
      status: () => 'known',
      settings: () => makeSettings({ coloredProsodyStatusLimit: 'learning' }),
    }));
    expect(container.querySelector('.colored-prosody__segment')).toBeNull();
    dispose();
  });

  it('skips known words when colorKnownWords is off', () => {
    const { container, dispose } = renderTextResult(makeCtx({
      isKnown: () => true,
      settings: () => makeSettings({ colorKnownWords: false }),
    }));
    expect(container.querySelector('.colored-prosody__segment')).toBeNull();
    dispose();
  });

  it('still colors known words when colorKnownWords is on', () => {
    const { container, dispose } = renderTextResult(makeCtx({
      isKnown: () => true,
      settings: () => makeSettings({ colorKnownWords: true }),
    }));
    expect(container.querySelectorAll('.colored-prosody__segment')).toHaveLength(5);
    dispose();
  });

  it('renders one segment with the pitch category for a known prosody position', () => {
    const { container, dispose } = renderTextResult(makeCtx({
      languageData: () => pitchLanguage,
      prosodyPosition: () => 1,
    }));
    const segments = container.querySelectorAll<HTMLElement>('.colored-prosody__segment');
    expect(segments).toHaveLength(1);
    expect(segments[0].dataset.prosodyValue).toBe('atamadaka');
    expect(segments[0].style.color).toBe('#ffa500');
    dispose();
  });

  it('gates the surface check before the dictionary position lookup', () => {
    const { container, dispose } = renderTextResult(makeCtx({
      languageData: () => pitchLanguage,
      prosodyPosition: () => 1,
      surface: 'other',
      settings: () => makeSettings({ coloredProsodyRelevantOnly: true }),
    }));
    expect(container.querySelector('.colored-prosody__segment')).toBeNull();
    expect(container.querySelector('span')?.textContent).toBe(word);
    dispose();
  });
});

describe('applyWordDecorations', () => {
  beforeEach(() => {
    prosodySpy.mockClear();
  });

  function renderDecorations(
    text: JSX.Element,
    slotOptions: Parameters<typeof applyWordDecorations>[1],
    decorations: Parameters<typeof applyWordDecorations>[2],
  ) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => applyWordDecorations(text, slotOptions, decorations), container);
    return { container, dispose };
  }

  it('wraps a non-suppressed reading slot in the prosody overlay', () => {
    const { container, dispose } = renderDecorations('text', {
      ...options,
      slot: 'reading',
      isReadingScript: true,
    }, {
      prosodyOverlay: { position: 3 },
      surfaceWord: word,
      surfaceReading: reading,
    });
    expect(container.querySelector('[data-prosody-spy]')).not.toBeNull();
    expect(prosodySpy).toHaveBeenCalledWith(expect.objectContaining({
      word: reading,
      reading,
      prosodyPosition: 3,
      class: 'prosody-overlay-wrapper--reading',
    }));
    dispose();
  });

  it('never wraps a suppressed slot (ruby word base) in the prosody overlay', () => {
    const { container, dispose } = renderDecorations('text', {
      ...options,
      suppressOverlay: true,
    }, {
      prosodyOverlay: { position: 4 },
      surfaceWord: word,
      surfaceReading: reading,
    });
    expect(container.querySelector('[data-prosody-spy]')).toBeNull();
    expect(container.textContent).toBe('text');
    dispose();
  });

  it('keeps colored prosody on a suppressed slot while dropping the overlay', () => {
    const { container, dispose } = renderDecorations(word, {
      ...options,
      suppressOverlay: true,
    }, {
      coloredProsody: makeCtx({ surface: 'other' }),
      prosodyOverlay: { position: 4 },
      surfaceWord: word,
      surfaceReading: reading,
    });
    expect(container.querySelector('[data-prosody-spy]')).toBeNull();
    expect(container.querySelectorAll('.colored-prosody__segment')).toHaveLength(5);
    dispose();
  });

  it('resolves a function position against the target slot reading', () => {
    const { dispose } = renderDecorations('text', {
      ...options,
      slot: 'reading',
    }, {
      prosodyOverlay: { position: (r: string) => (r === reading ? 7 : 0) },
      surfaceWord: word,
      surfaceReading: reading,
    });
    expect(prosodySpy).toHaveBeenCalledWith(expect.objectContaining({ prosodyPosition: 7 }));
    dispose();
  });

  it('honors the reading-slot word override', () => {
    const { dispose } = renderDecorations('text', {
      ...options,
      slot: 'reading',
    }, {
      prosodyOverlay: { overlayWordForReadingSlot: '仏像' },
      surfaceWord: word,
      surfaceReading: reading,
    });
    expect(prosodySpy).toHaveBeenCalledWith(expect.objectContaining({ word: '仏像' }));
    dispose();
  });

  it('wraps plain text in a class/style span when no decoration applies', () => {
    const { container, dispose } = renderDecorations('text', options, {
      surfaceWord: word,
      surfaceReading: reading,
    });
    const span = container.querySelector('span');
    expect(span?.className).toBe('fixture-word');
    expect(span?.style.color).toBe('rgb(1, 2, 3)');
    expect(span?.textContent).toBe('text');
    dispose();
  });

  it('composes colored prosody inside the overlay', () => {
    const { container, dispose } = renderDecorations(word, {
      ...options,
      slot: 'reading',
    }, {
      coloredProsody: makeCtx({ surface: 'other' }),
      prosodyOverlay: { position: 3 },
      surfaceWord: word,
      surfaceReading: reading,
    });
    const spy = container.querySelector('[data-prosody-spy]');
    expect(spy).not.toBeNull();
    expect(spy?.querySelector('.colored-prosody__segment')).not.toBeNull();
    dispose();
  });
});