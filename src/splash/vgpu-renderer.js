/** Production backend. Real vgpu 0.5.0 API; no Three.js, framework, or native WebGPU wrapper. */
import { init, surface, target, texture, sampler, effect, draw, frame } from 'vgpu';
import sceneSource from './shaders/scene.wgsl?raw';
import dustSource from './shaders/dust.wgsl?raw';
import blurSource from './shaders/bloom.wgsl?raw';
import compositeSource from './shaders/composite.wgsl?raw';
import { LOGO_SIZE } from './logo-data.js';
import { renderSize } from './policy.js';

export async function createVgpuRenderer(canvas, options, logoBytes) {
  if (!navigator.gpu) throw new Error('WebGPU is unavailable; using the static splash.');
  const gpu = await init({ powerPreference: 'low-power' });
  let disposed = false;
  try {
    const output = surface(gpu, canvas, { autoResize: false, size: [1,1], alphaMode: 'opaque' });
    const hdr = target(gpu, { size: [1,1], format: 'rgba16float', label: 'prism-hdr' });
    const bloomX = target(gpu, { size: [1,1], format: 'rgba16float', label: 'prism-bloom-x' });
    const bloomY = target(gpu, { size: [1,1], format: 'rgba16float', label: 'prism-bloom-y' });
    const logo = texture(gpu, {
      kind: '2d', size: LOGO_SIZE, format: 'r16float',
      usage: ['texture_binding','copy_dst'], label: 'mlearn-exact-logo-sdf',
    });
    gpu.gpu.queue.writeTexture({ texture: logo.gpu }, logoBytes,
      { bytesPerRow: LOGO_SIZE[0]*2 }, [...LOGO_SIZE,1]);
    const linear = sampler(gpu, { minFilter: 'linear', magFilter: 'linear' });
    const initial = { resolution: [1,1], time: 0, progress: 0, pointer: [0,0], seed: options.seed, exposure: options.exposure };
    const scene = effect(gpu, sceneSource, { label: 'prism-studio', set: { params: initial, logo, linear } });
    const dust = draw(gpu, {
      shader: dustSource, label: 'prism-instanced-dust', vertices: 6, instances: options.particles,
      depth: false,
      blend: { color: {src:'one',dst:'one',op:'add'}, alpha: {src:'zero',dst:'one',op:'add'} },
      set: { params: initial },
    });
    // Separate effects own separate uniforms; no set() mutation between passes in one frame.
    const blurX = effect(gpu, blurSource, { label: 'prism-bloom-horizontal', set: {
      blur: { step: [1,0], threshold: .80, pad: 0 }, source: hdr, linear,
    } });
    const blurY = effect(gpu, blurSource, { label: 'prism-bloom-vertical', set: {
      blur: { step: [0,1], threshold: 0, pad: 0 }, source: bloomX, linear,
    } });
    const composite = effect(gpu, compositeSource, { label: 'prism-display', set: {
      params: initial, source: hdr, bloom: bloomY, linear,
    } });
    // Compilation is asynchronous and occurs only after the static splash has painted.
    const compiled = await Promise.allSettled([
      () => scene.compile(hdr), () => dust.compile(hdr), () => blurX.compile(bloomX),
      () => blurY.compile(bloomY),
      // A surface's current frame texture exists only inside frame(gpu).
      () => composite.compile({ colors: [output.format] }),
    ].map(compile => Promise.resolve().then(compile)));
    const error = compiled.find(result => result.status === 'rejected');
    if (error) throw error.reason;
    let lastProgress = -1;
    let inFlight = false, pending = null;
    let width = 0, height = 0;
    const onUncaptured = (event) => options.onDeviceError?.(event.error);
    gpu.gpu.addEventListener('uncapturederror', onUncaptured);
    void gpu.gpu.lost.then((info) => {
      if (!disposed) options.onDeviceError?.(new Error(`WebGPU device lost: ${info.message}`));
    });
    function resize(cssWidth, cssHeight, dpr) {
      if (disposed) return;
      const size=renderSize(cssWidth,cssHeight,dpr,options);
      if(size.width===width && size.height===height) return;
      width=size.width; height=size.height;
      output.resize([width,height]); hdr.resize([width,height]);
      const bw=Math.max(1,Math.floor(width/4)), bh=Math.max(1,Math.floor(height/4));
      bloomX.resize([bw,bh]); bloomY.resize([bw,bh]);
      // Bind Targets, not target.color: vgpu follows attachment replacement after resize.
      scene.set({ params: { resolution: [width,height] } });
      dust.set({ params: { resolution: [width,height] } });
      composite.set({ params: { resolution: [width,height] } });
      blurX.set({ blur: { step: [4/width,0] } });
      blurY.set({ blur: { step: [0,1/bh] } });
    }
    function render(values) {
      if (disposed) return false;
      if (inFlight) {
        // Slow GPUs get the newest state, never an unbounded backlog of old frames.
        pending = { ...values, pointer: [...values.pointer] };
        return false;
      }
      scene.set({ params: { time: values.time, pointer: values.pointer } });
      dust.set({ params: { time: values.time, pointer: values.pointer } });
      if(values.progress!==lastProgress){
        lastProgress=values.progress;
        scene.set({ params: { progress: lastProgress/100 } });
      }
      // Four render passes, five draws; a single command submission.
      frame(gpu, (f) => {
        f.pass({ target: hdr }, (pass) => { pass.draw(scene); if(options.particles>0) pass.draw(dust); });
        f.pass(bloomX, blurX);
        f.pass(bloomY, blurY);
        f.pass(output, composite);
      });
      inFlight = true;
      void gpu.gpu.queue.onSubmittedWorkDone().then(() => {
        inFlight = false;
        if (!disposed && pending) {
          const next=pending; pending=null;
          try { render(next); } catch(error) { options.onDeviceError?.(error); }
        }
      }, (error) => { inFlight=false; if(!disposed) options.onDeviceError?.(error); });
      return true;
    }
    function destroy() {
      if (disposed) return;
      disposed=true;pending=null;
      gpu.gpu.removeEventListener('uncapturederror',onUncaptured);
      // Owns all textures, samplers, programs and the surface. No GPU work survives teardown.
      gpu.dispose();
    }
    return { backend: 'vgpu', resize, render, destroy };
  } catch(error) {
    disposed=true; gpu.dispose(); throw error;
  }
}
