// Keep this entry tiny: the HTML fallback paints before the scene bundle loads.
let closed = false;
window.addEventListener('pagehide', () => {
  closed = true;
  window.mlearnSplash?.destroy();
}, { once: true });

requestAnimationFrame(() => requestAnimationFrame(() => {
  if (closed) return;
  void import('./standalone.js').then(({ startSplash }) => {
    if (!closed) startSplash();
  }).catch(() => {
    // The inline HTML bridge and static scene remain available.
  });
}));
