/** Renderer-owned pairing storage shared by mobile bridges and HTTP backends. */
import { PROXY_SERVER_PORT } from './constants';

export function getNodeServerUrl(): string {
  try {
    return localStorage.getItem('mlearn-node-server-url')?.replace(/\/+$/, '')
      || `http://127.0.0.1:${PROXY_SERVER_PORT}`;
  } catch {
    return `http://127.0.0.1:${PROXY_SERVER_PORT}`;
  }
}

/** Never infer a pairing credential for an endpoint other than the paired origin. */
export function getNodeServerAuthToken(targetUrl: string): string | undefined {
  try {
    const target = new URL(targetUrl);
    const paired = new URL(getNodeServerUrl());
    if (!['http:', 'https:'].includes(target.protocol)
      || target.username || target.password || target.origin !== paired.origin) return undefined;
    return localStorage.getItem('mlearn-node-server-token')?.trim() || undefined;
  } catch {
    return undefined;
  }
}
