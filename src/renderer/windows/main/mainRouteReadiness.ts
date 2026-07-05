export interface MainRouteReadinessState {
  serverConnected: boolean;
  settingsLoading: boolean;
  languageLoading: boolean;
}

export function shouldMountMainRoutes(state: MainRouteReadinessState): boolean {
  return state.serverConnected && !state.settingsLoading && !state.languageLoading;
}
