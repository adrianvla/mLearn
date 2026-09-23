/** Rendering policy is independent of the GPU backend and of mLearn itself. */
export const DEFAULTS = Object.freeze({
  maxDpr: 2, maxPixels: 1_200_000, scale: 1, fps: 30,
  particles: 112, seed: 17, exposure: 1.1,
});

const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

/** CSS dimensions -> a bounded backing store, maintaining the CSS aspect ratio. */
export function renderSize(cssWidth, cssHeight, deviceDpr = 1, options = {}) {
  const w=positive(cssWidth,1), h=positive(cssHeight,1);
  const maxDpr=positive(options.maxDpr,DEFAULTS.maxDpr);
  const cap=positive(options.maxPixels,DEFAULTS.maxPixels);
  const scale=Math.min(1,positive(options.scale,DEFAULTS.scale));
  const dpr=Math.min(positive(deviceDpr,1),maxDpr)*scale;
  const fit=Math.min(1,Math.sqrt(cap/(w*h*dpr*dpr)));
  return { width:Math.max(1,Math.floor(w*dpr*fit)), height:Math.max(1,Math.floor(h*dpr*fit)), dpr:dpr*fit };
}

/** Progress is monotonic, like the current Electron splashWindow owner. */
export function progressValue(value, previous = 0) {
  if (!Number.isFinite(value)) return previous;
  return Math.max(previous,Math.min(100,Math.max(0,value)));
}

/** Discard long scheduling gaps, instead of launching particles after a tab resume. */
export function advanceClock(time, deltaSeconds, paused) {
  return paused ? time : time + Math.max(0,Math.min(.05,Number.isFinite(deltaSeconds)?deltaSeconds:0));
}
export function smoothPointer(current, target, deltaSeconds) {
  return current + (target-current)*(1-Math.exp(-6*Math.max(0,deltaSeconds)));
}
