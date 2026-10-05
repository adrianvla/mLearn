import { useNavigate, type NavigateOptions } from '@solidjs/router';
import { getBridge } from '../../../shared/bridges';
import { isElectron } from '../../../shared/platform';
import { applicationHostForPath, type ApplicationHost } from '../../../shared/applicationNavigation';
import { prepareMediaWorkspaceReturn } from './routes/mediaWorkspaceReturn';

export function currentApplicationHost(): ApplicationHost {
  const host = new URLSearchParams(window.location.search).get('host');
  return host === 'study' || host === 'my-learning' || host === 'settings' ? host : 'main';
}

let mediaSource: { workspace: 'reader' | 'video'; path: string } | undefined;
export function setActiveMediaSource(source: typeof mediaSource): void { mediaSource = source; }
export function hasActiveMediaSource(source: Record<string, unknown>): boolean {
  return !!mediaSource && source.workspace === mediaSource.workspace && source.path === mediaSource.path;
}

/** Same-host Back stays local. Cross-host destinations never unmount the origin. */
export function useApplicationNavigate() {
  const navigate = useNavigate();
  return (path: string, options?: Partial<NavigateOptions>) => {
    const host = applicationHostForPath(path);
    if (isElectron() && host !== currentApplicationHost()) {
      getBridge().window.openWindow({ type: host, context: { applicationPath: path,
        ...((options?.state as { applicationContext?: Record<string, unknown> } | undefined)?.applicationContext ?? {}) } });
    } else if (options) navigate(path, options);
    else navigate(path);
  };
}

export function useApplicationReturn() {
  const navigate = useApplicationNavigate();
  return (path: string, context?: Record<string, unknown>) => {
    const source = context?.sourceContext;
    if (isElectron() && applicationHostForPath(path) !== currentApplicationHost()) {
      getBridge().window.openWindow({ type: applicationHostForPath(path), context: {
        applicationPath: path, applicationReturn: true, ...(source ? { sourceContext: source } : {}),
      } });
      return;
    }
    if ((path === '/reader' || path === '/video') && source && typeof source === 'object' && !Array.isArray(source)) {
      const actual = prepareMediaWorkspaceReturn(sessionStorage, source as Record<string, unknown>);
      if (actual) { navigate(actual); return; }
    }
    navigate(path);
  };
}
