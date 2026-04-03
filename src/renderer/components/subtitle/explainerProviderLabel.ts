import type { LLMProvider } from '../../../shared/types';

type TranslateFn = (key: string, params?: Record<string, string>) => string;

const EXPLAINER_PROVIDER_KEYS: Record<LLMProvider, string> = {
  builtin: 'mlearn.Explainer.Provider.Builtin',
  ollama: 'mlearn.Explainer.Provider.Ollama',
  cloud: 'mlearn.Explainer.Provider.Cloud',
};

export function getExplainerProviderTranslationKey(provider: LLMProvider): string {
  return EXPLAINER_PROVIDER_KEYS[provider];
}

export function buildExplainerGeneratedByLabel(provider: LLMProvider, translate: TranslateFn): string {
  return translate('mlearn.Explainer.GeneratedBy', {
    provider: translate(getExplainerProviderTranslationKey(provider)),
  });
}