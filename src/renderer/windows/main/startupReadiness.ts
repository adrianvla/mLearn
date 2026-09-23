export type StartupRendererState = 'language' | 'library' | 'backend' | 'ready';

/** The main window can appear after its required stores settle or an error UI is ready. */
export function startupRendererState(input: {
  languageLoading: boolean;
  libraryLoading: boolean;
  knowledgeReady: boolean;
  serverStatus: 'loading' | 'connected' | 'error' | 'installing';
}): StartupRendererState {
  if (input.languageLoading) return 'language';
  if (input.libraryLoading || !input.knowledgeReady) return 'library';
  if (input.serverStatus === 'connected' || input.serverStatus === 'error') return 'ready';
  return 'backend';
}
