import { DEFAULTS, progressValue, advanceClock, smoothPointer } from './policy.js';
import { decodeLogo } from './logo-data.js';
import { LOGO_SVG } from './logo-svg.js';

/** Internal backend-independent owner. The public entry point supplies the real vgpu backend. */
export function mountSplash(host, settings = {}, rendererFactory) {
  if (!(host instanceof HTMLElement)) throw new TypeError('A splash host HTMLElement is required.');
  const finite = (v, d) => Number.isFinite(v) ? v : d;
  const options={ ...DEFAULTS, ...settings };
  options.fps=Math.min(60,Math.max(1,finite(options.fps,DEFAULTS.fps)));
  options.particles=Math.min(256,Math.max(0,Math.floor(finite(options.particles,DEFAULTS.particles))));
  options.seed=finite(options.seed,DEFAULTS.seed)%10000;
  options.exposure=Math.min(3,Math.max(.1,finite(options.exposure,DEFAULTS.exposure)));
  const root=document.createElement('section'); root.className='prism-splash';
  root.setAttribute('aria-label','mLearn startup');
  root.dataset.status=settings.showStatus===false?'hidden':'visible';
  // This markup is project-owned, not user-provided. Status updates below only use textContent.
  root.innerHTML=`<div class="prism-fallback"><div class="prism-fallback-panel"></div>${LOGO_SVG}</div><canvas class="prism-canvas" aria-hidden="true"></canvas><h1 class="prism-name">mLearn</h1><p class="prism-version"></p>${settings.development === true ? '<p class="prism-development">Development mode</p>' : ''}<footer class="prism-footer"><p class="prism-status" role="status" aria-live="polite">Starting mLearn</p><div class="prism-track" role="progressbar" aria-label="Startup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="prism-progress"></div></div></footer><div class="prism-drag" aria-hidden="true"></div>`;
  host.append(root);
  root.querySelector('.prism-version').textContent = typeof settings.version === 'string' ? `v${settings.version}` : '';
  const canvas=root.querySelector('canvas'),status=root.querySelector('.prism-status'),track=root.querySelector('.prism-track'),bar=root.querySelector('.prism-progress');
  let renderer=null, destroyed=false, failed=false, paused=settings.autoplay===false, bootFrame=0, bootTimer=0, raf=0;
  let time=0,lastTick=0,lastDraw=-Infinity,progress=0;
  // The light reaches its existing full look before the final startup handoff.
  const lightTarget = () => Math.min(1,progress/75);
  let illumination=Math.min(1,progressValue(settings.initialProgress??0)/75);
  let lastError=null,backend='static',renderCount=0;
  const pointer=[0,0],pointerTarget=[0,0];
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let reduced=motion.matches;
  let resolveReady;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  let settled=false;
  const settle = value => {if(!settled){settled=true;resolveReady(value);}};
  function releaseRenderer(){const r=renderer;renderer=null;try{r?.destroy();}catch{/* Teardown must not trap the startup owner. */}}
  const canAnimate=()=>!destroyed && !!renderer && !paused && !reduced && !document.hidden;
  function fail(error) {
    if(destroyed)return;
    failed=true;lastError=error instanceof Error?error:new Error(String(error));backend='static';
    cancelAnimationFrame(raf);raf=0;
    releaseRenderer();root.dataset.rendered='false';
    try{settings.onError?.(lastError);}catch{ /* Consumer diagnostics cannot break startup. */ }
    settle(false);
  }
  function paint() {
    if(!renderer || destroyed || document.hidden)return;
    try{const submitted=renderer.render({time,progress,illumination,pointer: reduced?[0,0]:pointer});if(submitted===false)return;
      renderCount++;root.dataset.rendered='true';
      if(!settled){settle(true);try{settings.onReady?.();}catch{}}}
    catch(error){fail(error);}
  }
  function loop(now) {
    raf=0;if(!canAnimate())return;
    const delta=lastTick?Math.max(0,(now-lastTick)/1000):0;lastTick=now;
    time=advanceClock(time,delta,false);
    illumination=smoothPointer(illumination,lightTarget(),delta);
    if(lightTarget()-illumination<0.001)illumination=lightTarget();
    pointer[0]=smoothPointer(pointer[0],pointerTarget[0],delta);
    pointer[1]=smoothPointer(pointer[1],pointerTarget[1],delta);
    if(now-lastDraw >= 1000/options.fps-.8){lastDraw=now;paint();}
    if(canAnimate())raf=requestAnimationFrame(loop);
  }
  function resumeScheduling() {
    cancelAnimationFrame(raf);raf=0;lastTick=0;lastDraw=-Infinity;
    if(canAnimate())raf=requestAnimationFrame(loop);
  }
  function resize() {
    if(!renderer || destroyed)return;
    const r=root.getBoundingClientRect();
    try{renderer.resize(r.width,r.height,window.devicePixelRatio||1);paint();}
    catch(error){fail(error);}
  }
  const observer=new ResizeObserver(resize);observer.observe(root);
  const onPointer = event => {
    if(reduced || paused)return;
    const r=root.getBoundingClientRect();
    if(r.width && r.height){pointerTarget[0]=Math.max(-1,Math.min(1,(event.clientX-r.left)/r.width*2-1));pointerTarget[1]=Math.max(-1,Math.min(1,(event.clientY-r.top)/r.height*2-1));}
  };
  const onLeave=()=>{pointerTarget[0]=0;pointerTarget[1]=0;};
  const onVisibility=()=>{resumeScheduling();if(!document.hidden)resize();};
  const onMotion=()=>{reduced=motion.matches;pointer[0]=pointer[1]=0;resumeScheduling();paint();};
  root.addEventListener('pointermove',onPointer,{passive:true});root.addEventListener('pointerleave',onLeave,{passive:true});
  document.addEventListener('visibilitychange',onVisibility);motion.addEventListener('change',onMotion);
  window.addEventListener('resize',resize,{passive:true});
  // DPR can change independently of CSS size when the splash crosses displays.
  let dprQuery=null;
  function watchDpr(){
    dprQuery?.removeEventListener('change',onDpr);
    dprQuery=matchMedia(`(resolution: ${window.devicePixelRatio||1}dppx)`);
    dprQuery.addEventListener('change',onDpr);
  }
  function onDpr(){resize();watchDpr();}
  watchDpr();
  function updateStartup(value={}) {
    if(destroyed)return;
    progress=progressValue(value?.progress,progress);
    root.style.setProperty('--prism-illumination',String(lightTarget()));
    if(!canAnimate())illumination=lightTarget();
    if(typeof value?.status==='string')status.textContent=value.status;
    bar.style.transform=`scaleX(${progress/100})`;track.setAttribute('aria-valuenow',String(progress));
    if(!canAnimate())paint();
  }
  updateStartup({status:settings.initialStatus??'Starting mLearn',progress:settings.initialProgress??0});
  async function boot(){
    if(destroyed)return;
    try {
      const bytes=await decodeLogo();
      if(destroyed)return;
      const created=await rendererFactory(canvas,{...options,onDeviceError:fail},bytes);
      if(destroyed||failed){created.destroy();return;}
      renderer=created;backend=created.backend;resize();
      if(!renderer)return; // A resize or first-draw failure already restored the fallback.
      resumeScheduling();
    } catch(error){fail(error);}
  }
  // A static first paint is independent of adapter creation, decompression and compilation.
  bootFrame=requestAnimationFrame(()=>{bootFrame=requestAnimationFrame(()=>{bootTimer=setTimeout(()=>void boot(),0);});});
  function destroy(){
    if(destroyed)return;destroyed=true;
    cancelAnimationFrame(raf);cancelAnimationFrame(bootFrame);clearTimeout(bootTimer);
    observer.disconnect();dprQuery?.removeEventListener('change',onDpr);
    root.removeEventListener('pointermove',onPointer);root.removeEventListener('pointerleave',onLeave);
    document.removeEventListener('visibilitychange',onVisibility);motion.removeEventListener('change',onMotion);window.removeEventListener('resize',resize);
    releaseRenderer();root.remove();settle(false);
  }
  return {
    ready,updateStartup,destroy,
    setPaused(value){if(destroyed)return;paused=Boolean(value);resumeScheduling();paint();},
    // An explicit still/time API makes screenshots and deterministic visual tests reproducible.
    setTime(seconds){if(destroyed)return;time=Math.max(0,finite(seconds,time));lastTick=0;paint();},
    get diagnostics(){return {backend,progress,time,paused,reducedMotion:reduced,renderCount,physicalSize:[canvas.width,canvas.height],destroyed,error:lastError?.message??null};},
  };
}
