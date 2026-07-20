import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type LanguageColoredProsodyConfig, type LanguageData } from '../../shared/types';
import {
  buildColoredProsodySegments,
  coloredProsodyAllowsStatus,
  getColoredProsodyConfig,
  getColoredProsodyPalette,
  resolveColoredProsodyStyle,
} from './coloredProsody';

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

describe('colored prosody renderer registry', () => {
  it('maps tone-marked syllables to corresponding surface characters and readings', () => {
    expect(buildColoredProsodySegments(toneConfig, {
      text: '妈麻马骂吗',
      word: '妈麻马骂吗',
      reading: 'mā má mǎ mà ma',
      slot: 'word',
    })).toEqual([
      { text: '妈', paletteKey: 'tone-1' },
      { text: '麻', paletteKey: 'tone-2' },
      { text: '马', paletteKey: 'tone-3' },
      { text: '骂', paletteKey: 'tone-4' },
      { text: '吗', paletteKey: 'neutral' },
    ]);

    expect(buildColoredProsodySegments(toneConfig, {
      text: 'mā má mǎ mà ma',
      word: '妈麻马骂吗',
      reading: 'mā má mǎ mà ma',
      slot: 'reading',
    })?.filter((segment) => segment.paletteKey).map((segment) => segment.paletteKey)).toEqual([
      'tone-1',
      'tone-2',
      'tone-3',
      'tone-4',
      'neutral',
    ]);
  });

  it('maps numeric pitch positions to package palette categories and skips invalid data', () => {
    const config: LanguageColoredProsodyConfig = {
      renderer: 'pitch-accent-category',
      paletteId: 'pitch',
      colors: {},
      labels: {},
    };
    const render = (position: number | null) => buildColoredProsodySegments(config, {
      text: '桜',
      word: '桜',
      reading: 'さくら',
      slot: 'word',
      prosodyPosition: position,
    });

    expect(render(0)?.[0].paletteKey).toBe('heiban');
    expect(render(1)?.[0].paletteKey).toBe('atamadaka');
    expect(render(2)?.[0].paletteKey).toBe('nakadaka');
    expect(render(3)?.[0].paletteKey).toBe('odaka');
    expect(render(null)).toBeNull();
    expect(render(4)).toBeNull();
  });

  it('allows future packages to select registered strategies without language-code checks', () => {
    const language: LanguageData = { name: 'Future language', prosody: { coloring: toneConfig } };
    expect(getColoredProsodyConfig(language)).toBe(toneConfig);
    expect(getColoredProsodyConfig({
      name: 'Future language',
      prosody: { coloring: { ...toneConfig, renderer: 'not-installed' } },
    })).toBeNull();
  });
});

describe('colored prosody preferences', () => {
  it('uses an inclusive combined-status limit', () => {
    expect(coloredProsodyAllowsStatus('unknown', 'learning')).toBe(true);
    expect(coloredProsodyAllowsStatus('learning', 'learning')).toBe(true);
    expect(coloredProsodyAllowsStatus('known', 'learning')).toBe(false);
    expect(coloredProsodyAllowsStatus('known', 'known')).toBe(true);
  });

  it('merges palette overrides and applies saturation plus ease mixing', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      coloredProsodyPalettes: { tones: { 'tone-1': '#123456' } },
      coloredProsodySaturation: 0,
    };
    expect(getColoredProsodyPalette(settings, toneConfig)['tone-1']).toBe('#123456');
    expect(resolveColoredProsodyStyle('#ff0000', settings, undefined, undefined)).toEqual({ color: '#363636' });

    const mixed = resolveColoredProsodyStyle('#ff0000', {
      ...settings,
      coloredProsodySaturation: 100,
      coloredProsodyEaseMixEnabled: true,
      coloredProsodyEaseMixTarget: 'part-of-speech',
    }, DEFAULT_SETTINGS.easeThresholdMastered, '#0000ff');
    expect(mixed.color).not.toBe('#ff0000');
    expect(mixed.color).not.toBe('#0000ff');
  });
});
