import { describe, expect, it } from 'vitest';
import type { Token } from '../../../../shared/types';
import type { LanguageTokenizerCapabilities } from '../../../../shared/languageFeatures';
import { getReaderPassiveTrackingWord } from './readerWordTracking';

describe('reader word tracking helpers', () => {
  it('uses the token lookup word for passive tracking without pre-canonicalizing', () => {
    const token: Token = {
      word: 'كتب',
      surface: 'يكتب',
      actual_word: 'يكتب',
      reading: 'yaktub',
    };
    const tokenizerCapabilities: Pick<LanguageTokenizerCapabilities, 'providesLemmas'> = {
      providesLemmas: true,
    };

    expect(getReaderPassiveTrackingWord(token, tokenizerCapabilities)).toBe('يكتب');
  });
});
