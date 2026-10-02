/** Reversible study preference shared by reader, video, overlay and suggestions. */
import { showToast } from '../../components/common/Feedback/Toast';

type TranslateKey = (key: string, params?: Record<string, string>) => string;

export interface StudyExclusionRequest {
  word: string;
  reading?: string;
  language: string;
}
export interface StudyExclusionDeps {
  ignoreWordForLanguage: (word: string, reading?: string, language?: string) => Promise<void>;
  t: TranslateKey;
}

/** Resolve true only after the preference has been saved; authored cards stay stored. */
export async function excludeWordFromStudy(
  request: StudyExclusionRequest,
  deps: StudyExclusionDeps,
): Promise<boolean> {
  try {
    await deps.ignoreWordForLanguage(request.word, request.reading, request.language);
    return true;
  } catch {
    showToast({ message: deps.t('mlearn.Knowledge.StudyPreferenceSaveFailed'), variant: 'error' });
    return false;
  }
}
