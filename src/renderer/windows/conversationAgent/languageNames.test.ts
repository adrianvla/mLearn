import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../../shared/types';
import { getConversationDisplayLanguageName, getConversationPromptLanguageName } from './languageNames';

const arabicData = {
  name: 'Arabic',
  name_translated: 'العربية',
  colour_codes: {},
  settings: { fixed: {} },
} as LanguageData;

describe('conversationAgent languageNames', () => {
  it('uses localized UI names for visible conversation copy', () => {
    const t = (key: string) => key === 'mlearn.Languages.ar' ? 'Arabisch' : key;

    expect(getConversationDisplayLanguageName('ar', arabicData, t, 'en')).toBe('Arabisch');
  });

  it('uses Intl display names for visible copy when the app has no language key', () => {
    const t = (key: string) => key;

    expect(getConversationDisplayLanguageName('ar', arabicData, t, 'de')).toBe('Arabisch');
  });

  it('falls back to installed metadata names for unlocalized package languages', () => {
    const t = (key: string) => key;

    expect(getConversationDisplayLanguageName('x-mlearn-ar', arabicData, t)).toBe('العربية');
  });

  it('uses installed metadata names for LLM prompt language identity', () => {
    expect(getConversationPromptLanguageName('ar', arabicData)).toBe('Arabic (العربية)');
  });
});
