import type { LanguageData, LanguagePythonRequirementComponent } from '../../shared/types';

/** App switches enable optional capabilities; installed packages declare which they offer. */
export function languageActivationComponents(
  metadata: LanguageData,
  enabled: readonly LanguagePythonRequirementComponent[],
): LanguagePythonRequirementComponent[] {
  const runtime = metadata.runtime;
  return [...new Set(['core', ...enabled.filter(component => {
    if (component === 'core') return false;
    if (runtime?.python?.packagesByComponent?.[component]?.length
      || runtime?.python?.importChecksByComponent?.[component]?.length) return true;
    if (component === 'voice') return Boolean(runtime?.tts || runtime?.stt);
    if (component === 'ocr') return Boolean(runtime?.ocr);
    return false;
  })])];
}
