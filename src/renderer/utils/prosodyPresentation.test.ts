import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../shared/types';
import {
  canRenderStoredProsodyWithoutMetadata,
  getProsodyOverlayRenderer,
  getProsodyPositionCategoryLabel,
  getProsodyPositionFieldLabel,
  getProsodyPositionFieldPlaceholder,
} from './prosodyPresentation';

const t = (key: string, params?: Record<string, string | number>) => {
  if (key === 'mlearn.CardEditor.Fields.JapanesePitchAccent') return 'Pitch accent';
  if (key === 'mlearn.CardEditor.Fields.JapanesePitchAccentPlaceholder') return '0, 1, 2...';
  if (key === 'mlearn.CardEditor.Fields.ProsodyPosition') return 'Prosody position';
  if (key === 'mlearn.CardEditor.Fields.ProsodyPositionPlaceholder') return 'Position';
  if (key === 'mlearn.JapanesePitchAccent.Heiban') return 'Heiban';
  if (key === 'mlearn.JapanesePitchAccent.Atamadaka') return 'Atamadaka';
  if (key === 'mlearn.JapanesePitchAccent.Odaka') return 'Odaka';
  if (key === 'mlearn.JapanesePitchAccent.DropAfterMora') return `Drop after mora ${params?.mora}`;
  return key;
};

describe('prosodyPresentation', () => {
  it('uses package-declared field labels for generic prosody models', () => {
    const languageData: LanguageData = {
      name: 'Tone Language',
      settings: { fixed: {} },
      prosody: {
        type: 'tone-contour',
        positionLabel: 'Tone number',
        positionPlaceholder: '1-5',
      },
    };

    expect(getProsodyPositionFieldLabel(languageData, t)).toBe('Tone number');
    expect(getProsodyPositionFieldPlaceholder(languageData, t)).toBe('1-5');
  });

  it('falls back to generic copy for non-Japanese prosody models', () => {
    const languageData: LanguageData = {
      name: 'Stress Language',
      settings: { fixed: {} },
      prosody: { type: 'stress-position' },
    };

    expect(getProsodyPositionFieldLabel(languageData, t)).toBe('Prosody position');
    expect(getProsodyPositionFieldPlaceholder(languageData, t)).toBe('Position');
    expect(getProsodyPositionCategoryLabel(languageData, 1, 'record', t)).toBe('');
    expect(getProsodyOverlayRenderer(languageData, 'stress-position')).toBeNull();
    expect(canRenderStoredProsodyWithoutMetadata('stress-position')).toBe(false);
  });

  it('routes Japanese pitch accent category names through the selected prosody model', () => {
    const languageData: LanguageData = {
      name: 'Japanese',
      settings: { fixed: {} },
      prosody: { type: 'japanese-pitch-accent' },
    };

    expect(getProsodyPositionFieldLabel(languageData, t)).toBe('Pitch accent');
    expect(getProsodyPositionFieldPlaceholder(languageData, t)).toBe('0, 1, 2...');
    expect(getProsodyPositionCategoryLabel(languageData, 1, 'あかい', t)).toBe('Atamadaka');
    expect(getProsodyOverlayRenderer(languageData)).toBe('japanese-pitch-accent');
    expect(getProsodyOverlayRenderer(null, 'japanese-pitch-accent')).toBe('japanese-pitch-accent');
    expect(canRenderStoredProsodyWithoutMetadata('japanese-pitch-accent')).toBe(true);
  });
});
