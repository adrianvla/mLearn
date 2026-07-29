import { describe, expect, it } from 'vitest';
import {
  VARIANT_OVERLAY_ALLOWLIST,
  applyVariantOverlay,
  canonicalLanguage,
  resolveActiveVariantId,
  resolveEffectiveLanguageData,
} from './languageVariants';
import { DEFAULT_SETTINGS } from './types';
import type { GrammarPoint, LanguageData, LanguageDataMap } from './types';

const baseGrammar: GrammarPoint[] = [
  { pattern: '了', meaning: 'aspect marker', level: 1 },
];

const variantGrammar: GrammarPoint[] = [
  { pattern: '了', meaning: 'aspect marker (traditional)', level: 1 },
];

function makeBase(): LanguageData {
  return {
    name: 'Chinese',
    grammar: baseGrammar,
    conversation: {
      tutorPromptGuidelines: ['base tutor'],
      correctionPromptGuidelines: ['base correction'],
    } as LanguageData['conversation'],
    runtime: {
      tts: { webSpeechLang: 'zh-CN' },
    } as LanguageData['runtime'],
    variants: {
      'zh-Hant': {
        name: 'Mandarin Chinese (Traditional)',
        overrides: {
          grammar: variantGrammar,
          'conversation.tutorPromptGuidelines': ['traditional tutor'],
          'runtime.tts.webSpeechLang': 'zh-TW',
        },
      },
    },
  };
}

describe('VARIANT_OVERLAY_ALLOWLIST', () => {
  it('matches the plan §3.2 list exactly', () => {
    expect([...VARIANT_OVERLAY_ALLOWLIST]).toEqual([
      'name',
      'name_translated',
      'flagEmoji',
      'grammar',
      'conversation.tutorPromptGuidelines',
      'conversation.correctionPromptGuidelines',
      'conversation.mistakeCheckerPromptGuidelines',
      'typography.subtitleFontFamily',
      'typography.contentFontFamily',
      'runtime.ocr.paddleLang',
      'runtime.tts.webSpeechLang',
      'runtime.tts.diagnosticText',
      'runtime.adapter.config',
      'runtime.diagnostics.sampleText',
    ]);
  });
});

describe('applyVariantOverlay', () => {
  it('returns the same object when no variantId', () => {
    const base = makeBase();
    expect(applyVariantOverlay(base, undefined)).toBe(base);
  });

  it('returns the same object when data has no variants', () => {
    const base: LanguageData = { name: 'Japanese' };
    expect(applyVariantOverlay(base, 'zh-Hant')).toBe(base);
  });

  it('returns the same object when variantId is not in variants', () => {
    const base = makeBase();
    expect(applyVariantOverlay(base, 'zh-Hans')).toBe(base);
  });

  it('replaces grammar array shallowly with reference equality', () => {
    const base = makeBase();
    const result = applyVariantOverlay(base, 'zh-Hant');
    expect(result.grammar).toBe(variantGrammar);
    expect(result.grammar).not.toBe(baseGrammar);
    expect(base.grammar).toBe(baseGrammar);
  });

  it('replaces nested allowlisted paths without mutating the base', () => {
    const base = makeBase();
    const result = applyVariantOverlay(base, 'zh-Hant');
    expect(result.conversation?.tutorPromptGuidelines).toEqual(['traditional tutor']);
    expect(result.conversation?.correctionPromptGuidelines).toEqual(['base correction']);
    expect(result.runtime?.tts?.webSpeechLang).toBe('zh-TW');
    expect(base.conversation?.tutorPromptGuidelines).toEqual(['base tutor']);
    expect(base.runtime?.tts?.webSpeechLang).toBe('zh-CN');
  });

  it('leaves untouched fields identical to the base', () => {
    const base = makeBase();
    const result = applyVariantOverlay(base, 'zh-Hant');
    expect(result.name).toBe(base.name);
    expect(result.variants).toBe(base.variants);
  });

  it('throws on override paths outside the allowlist, naming the path', () => {
    const base: LanguageData = {
      name: 'Chinese',
      variants: {
        'zh-Hant': {
          name: 'Mandarin Chinese (Traditional)',
          overrides: { 'runtime.nlp.dictionary': { type: 'evil' } },
        },
      },
    };
    expect(() => applyVariantOverlay(base, 'zh-Hant')).toThrowError(/runtime\.nlp\.dictionary/);
  });
});

describe('resolveActiveVariantId', () => {
  it('reads settings.languageVariants[lang]', () => {
    expect(resolveActiveVariantId(DEFAULT_SETTINGS, 'zh')).toBeUndefined();
    const settings = { ...DEFAULT_SETTINGS, languageVariants: { zh: 'zh-Hant' } };
    expect(resolveActiveVariantId(settings, 'zh')).toBe('zh-Hant');
    expect(resolveActiveVariantId(settings, 'ja')).toBeUndefined();
  });

  it('falls back to DEFAULT_SETTINGS when languageVariants is undefined', () => {
    const legacySettings = Object.assign({}, DEFAULT_SETTINGS, { languageVariants: undefined });
    expect(resolveActiveVariantId(legacySettings, 'zh')).toBeUndefined();
  });
});

describe('resolveEffectiveLanguageData', () => {
  it('applies the active variant from settings', () => {
    const base = makeBase();
    const settings = { ...DEFAULT_SETTINGS, languageVariants: { zh: 'zh-Hant' } };
    const result = resolveEffectiveLanguageData(base, settings, 'zh');
    expect(result.grammar).toBe(variantGrammar);
  });

  it('returns identity when no variant is active', () => {
    const base = makeBase();
    expect(resolveEffectiveLanguageData(base, DEFAULT_SETTINGS, 'zh')).toBe(base);
  });
});

describe('canonicalLanguage', () => {
  const map: LanguageDataMap = {
    zh: { name: 'Chinese', legacyCodes: ['zh-Hans', 'zh-Hant'] },
    ja: { name: 'Japanese' },
  };

  it('folds legacy codes to the canonical language', () => {
    expect(canonicalLanguage('zh-Hans', map)).toBe('zh');
    expect(canonicalLanguage('zh-Hant', map)).toBe('zh');
  });

  it('keeps canonical codes as-is', () => {
    expect(canonicalLanguage('zh', map)).toBe('zh');
    expect(canonicalLanguage('ja', map)).toBe('ja');
  });

  it('returns the input for unknown codes or missing data', () => {
    expect(canonicalLanguage('ko', map)).toBe('ko');
    expect(canonicalLanguage('zh-Hans', undefined)).toBe('zh-Hans');
  });
});
