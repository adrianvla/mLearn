import type { Token } from '../../../../shared/types';
import type { LanguageTokenizerCapabilities } from '../../../../shared/languageFeatures';
import { getTokenLookupWord } from '../../../utils/wordForms';

type TokenizerLookupCapabilities = Pick<LanguageTokenizerCapabilities, 'providesLemmas'>;

export function getReaderPassiveTrackingWord(
  token: Pick<Token, 'word' | 'actual_word' | 'surface' | 'reading'>,
  tokenizerCapabilities?: TokenizerLookupCapabilities,
): string {
  return getTokenLookupWord(token, tokenizerCapabilities);
}
