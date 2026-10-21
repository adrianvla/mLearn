import assert from 'node:assert/strict';

export class WebDriverError extends Error {
  constructor(result) {
    super(JSON.stringify(result));
    this.code = result.value?.error;
  }
}

export async function clickControl(rpc, session, label) {
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const result = await rpc('POST', `/session/${session}/execute/async`, { script: `
    const label=arguments[0],remaining=arguments[1],done=arguments[arguments.length-1];
    let settled=false,frame=0;
    const finish=value=>{
      if(settled)return;
      settled=true;observer.disconnect();cancelAnimationFrame(frame);
      document.removeEventListener('scroll',check,true);clearTimeout(timer);done(value);
    };
    const check=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const control=Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"],[role="option"]'))
          .find(node=>{
            const rect=node.getBoundingClientRect();
            return node.getAttribute('aria-label')===label && rect.width && rect.height &&
              !node.disabled && node.getAttribute('aria-disabled')!=='true' &&
              !node.closest('[aria-hidden="true"]') && getComputedStyle(node).visibility!=='hidden';
          });
        if(!control)return;
        control.scrollIntoView({block:'nearest',inline:'nearest'});
        const rect=control.getBoundingClientRect(),style=getComputedStyle(control);
        const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
        if(rect.width && rect.height && style.visibility!=='hidden' &&
          style.pointerEvents!=='none' && hit && control.contains(hit))finish(control);
      });
    };
    const observer=new MutationObserver(check);
    const timer=setTimeout(()=>finish({error:'Visible enabled control unavailable',label}),remaining);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true});
    document.addEventListener('scroll',check,true);check();
  `, args: [label, Math.max(1, deadline - Date.now())] });
      const element = result?.['element-6066-11e4-a52e-4f735466cecf'];
      assert.ok(element, JSON.stringify(result));
      await rpc('POST', `/session/${session}/element/${element}/click`, {});
      return;
    } catch (error) {
      // A detached handle is rejected before click dispatch. Reacquire it,
      // without replaying an acknowledged action or masking another failure.
      if (!(error instanceof WebDriverError) || error.code !== 'stale element reference' ||
          Date.now() >= deadline) throw error;
    }
  }
}
