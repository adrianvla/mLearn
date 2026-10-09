import type { Settings } from './types';

/** Configuration admission shared by renderer and main; live transport remains authoritative. */
export function validCompatibleApiBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}

export function llmConfigurationFailure(settings: Settings): string | undefined {
  switch (settings.llmProvider) {
    case 'cloud': return settings.cloudAuthStatus === 'signed-in' ? undefined : 'cloud-auth-required';
    case 'openai-compatible': return validCompatibleApiBaseUrl(settings.compatibleApiBaseUrl) && !!settings.compatibleModel.trim()
      ? undefined : 'compatible-configuration-required';
    case 'builtin': return settings.llmEnabled && !!settings.builtinModel.trim() ? undefined : 'local-model-required';
    case 'ollama': return settings.llmEnabled ? undefined : 'local-model-required';
    default: return 'provider-configuration-required';
  }
}
