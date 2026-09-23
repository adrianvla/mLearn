import { mountSplash } from './controller.js';

export function startSplash() {
  const snapshot = window.__mlearnStartup;
  const fallback = document.getElementById('bootstrap-fallback');
  const version = fallback?.querySelector('.prism-version')?.getAttribute('data-version') ?? '';
  const splash = mountSplash(document.getElementById('splash-host'), {
    initialStatus: snapshot.status,
    initialProgress: snapshot.progress,
    version,
    development: fallback?.dataset.development === 'true',
  }, async (canvas, options, logoBytes) => {
    const { createVgpuRenderer } = await import('./vgpu-renderer.js');
    return createVgpuRenderer(canvas, options, logoBytes);
  });
  window.updateStartup = value => splash.updateStartup(value);
  window.mlearnSplash = splash;
  document.getElementById('bootstrap-fallback')?.remove();
}
