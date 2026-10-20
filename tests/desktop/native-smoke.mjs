// Drive the real Tauri binary through WebKit WebDriver, without mocking IPC.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { startCatalog } from '../../tools/catalog-server.mjs';

await mkdir('test-results/desktop', { recursive: true });
const catalog = await startCatalog(path.resolve('target/plugin-cdn'));
const driver = spawn('tauri-driver', ['--port', '4444'], { stdio: 'inherit' });
let session;
let restoreTheme;
async function rpc(method, endpoint, body) {
  const response = await fetch(`http://127.0.0.1:4444${endpoint}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || typeof result.value?.error === 'string') throw new Error(JSON.stringify(result));
  return result.value;
}
async function until(work, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await work(); if (result) return result; } catch (error) { last = error; }
    await delay(150);
  }
  throw new Error(`Timed out: ${description}; ${last ?? ''}`);
}
async function script(source, args = []) { return rpc('POST', `/session/${session}/execute/sync`, { script: source, args }); }
async function text(expected) { return until(async () => (await script('return document.body.innerText')).includes(expected), expected); }
async function click(label) {
  const result = await rpc('POST', `/session/${session}/execute/async`, { script: `
    const label=arguments[0],done=arguments[arguments.length-1];
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
    const timer=setTimeout(()=>finish({error:'Visible enabled control unavailable',label}),15000);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true});
    document.addEventListener('scroll',check,true);check();
  `, args: [label] });
  const element = result?.['element-6066-11e4-a52e-4f735466cecf'];
  assert.ok(element, JSON.stringify(result));
  await rpc('POST', `/session/${session}/element/${element}/click`, {});
}
async function closeInspector() {
  // A newly reopened, above-cue panel grows upward when its real entry arrives.
  // Observe the completed entry and its layout before WebDriver chooses a point;
  // otherwise the Close button can move between pointer-down and pointer-up.
  const ready=await rpc('POST',`/session/${session}/execute/async`,{script:`
    const done=arguments[arguments.length-1];
    let settled=false,frame=0,panel;
    const finish=value=>{
      if(settled)return;
      settled=true;mutations.disconnect();resize.disconnect();
      cancelAnimationFrame(frame);clearTimeout(timer);done(value);
    };
    const check=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{
        const current=document.querySelector('[data-testid="inspector-panel"]');
        if(current!==panel){if(panel)resize.unobserve(panel);panel=current;if(panel)resize.observe(panel);}
        const button=panel?.querySelector('[aria-label="Close Inspector"]');
        if(!button||!panel.querySelector('[aria-label="Dictionary source"]'))return;
        const r=button.getBoundingClientRect();
        const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        if(r.width&&r.height&&hit?.closest('[aria-label="Close Inspector"]')===button)
          finish({ready:true,rect:{x:r.x,y:r.y,width:r.width,height:r.height}});
      });});
    };
    const mutations=new MutationObserver(check),resize=new ResizeObserver(check);
    const timer=setTimeout(()=>finish({error:'Inspector entry and Close target did not become ready'}),5000);
    mutations.observe(document.body,{subtree:true,childList:true,attributes:true});check();
  `,args:[]});
  assert.equal(ready.ready,true,JSON.stringify(ready));
  await script(`window.__m01Dismiss={};window.__m01Dismiss.promise=new Promise(resolve=>{
    let settled=false;
    const finish=pass=>{if(settled)return;settled=true;observer.disconnect();clearTimeout(timer);resolve(pass);};
    const check=()=>{if(!document.querySelector('[data-testid="inspector-panel"]'))finish(true);};
    const observer=new MutationObserver(check);
    const timer=setTimeout(()=>finish(false),5000);
    window.__m01Dismiss.cancel=()=>finish(false);
    observer.observe(document.documentElement,{subtree:true,childList:true});
  });return true;`);
  try {
    await click('Close Inspector');
    const closed=await rpc('POST',`/session/${session}/execute/async`,{script:'const done=arguments[0];window.__m01Dismiss.promise.then(done);',args:[]});
    assert.equal(closed,true,'Inspector must finish dismissing before the next source interaction');
  } finally {
    await script('window.__m01Dismiss.cancel();delete window.__m01Dismiss;return true;');
  }
}
// Subscribe before input. Native media properties do not all mutate the DOM.
async function observeSourceView(condition) {
  await script(`window.__m02View={};window.__m02View.promise=new Promise(resolve=>{
    let settled=false;
    const events=['loadedmetadata','ratechange','seeked'];
    const finish=pass=>{
      if(settled)return;settled=true;observer.disconnect();clearTimeout(timer);
      events.forEach(event=>document.removeEventListener(event,check,true));resolve(pass);
    };
    const check=()=>{if(${condition})finish(true);};
    const observer=new MutationObserver(check);
    const timer=setTimeout(()=>finish(false),30000);
    window.__m02View.cancel=()=>finish(false);
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true});
    events.forEach(event=>document.addEventListener(event,check,true));check();
  });return true;`);
}
async function observedSourceView(description) {
  try {
    const result=await rpc('POST',`/session/${session}/execute/async`,{
      script:'const done=arguments[0];window.__m02View.promise.then(done);',args:[],
    });
    assert.equal(result,true,description);
  } finally {
    await script('window.__m02View.cancel();delete window.__m02View;return true;');
  }
}
async function launch() {
  const result = await rpc('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: path.resolve('target/debug/mlearn-desktop') } } } });
  session = result.sessionId;
  assert.ok(session, 'WebDriver session missing');
  await click('Settings');
  await click('Runtime');
  await text('Tauri desktop');
}
async function screenshot(name) {
  const data = await rpc('GET', `/session/${session}/screenshot`);
  await writeFile(`test-results/desktop/${name}.png`, Buffer.from(data, 'base64'));
}
async function styleState() {
  return script(`
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"],[role="header"]'))
      .find(node => node.textContent === 'Settings');
    // Expo retains the hidden Home heading when Settings is pushed. Measure
    // the visible navigation control, not any node sharing its accessible name.
    const button = Array.from(document.querySelectorAll('button[aria-label="Home"],[role="button"][aria-label="Home"]'))
      .find(node => node.getClientRects().length && node.getBoundingClientRect().height > 0);
    const computed = heading && getComputedStyle(heading);
    return {
      heading: heading ? { fontSize: computed.fontSize, color: computed.color } : null,
      buttonHeight: button ? button.getBoundingClientRect().height : null,
      csp: Array.from(document.querySelectorAll('meta[http-equiv]')).map(node => ({ name: node.httpEquiv, content: node.content })),
      styles: Array.from(document.styleSheets).map(sheet => {
        try { return { href: sheet.href, disabled: sheet.disabled, rules: sheet.cssRules.length }; }
        catch (error) { return { href: sheet.href, error: String(error) }; }
      })
    };
  `);
}
// Checking body.innerText alone misses results positioned below the action.
// The feedback must be locally visible as part of the originating panel.
async function assertPluginFeedbackNearAction(expected) {
  const geometry = await script(`
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"],[role="header"]'))
      .find(node => node.textContent === 'SDK example');
    const panel = heading?.parentElement;
    const message = document.querySelector('[data-testid="runtime-message"]');
    const button = document.querySelector('[aria-label="Run hello"]');
    const msgBox = message?.getBoundingClientRect();
    const buttonBox = button?.getBoundingClientRect();
    return {
      message: message?.textContent ?? null,
      inPluginPanel: Boolean(panel && message && panel.contains(message)),
      gapPx: msgBox && buttonBox ? Math.abs(msgBox.top - buttonBox.top) : null,
    };
  `);
  assert.equal(geometry.message, expected);
  assert.ok(geometry.inPluginPanel, 'Result must be rendered within the Hello, plugin panel');
  assert.ok(geometry.gapPx !== null && geometry.gapPx < 100, 'Result must be adjacent to the Run hello action');
}
async function assertStyled(theme, color) {
  const state = await styleState();
  await writeFile(`test-results/desktop/styles-${theme}.json`, JSON.stringify(state, null, 2));
  assert.ok(state.heading, 'Main heading missing');
  assert.equal(state.heading.fontSize, '20px', 'Packaged webview must apply the shared typography');
  assert.equal(state.heading.color, color, 'Native webview must apply the current theme, not merely save its name');
  assert.ok(state.buttonHeight >= 44, 'Shared native-web button must retain its accessible hit target');
}
try {
  await until(() => rpc('GET', '/status'), 'WebDriver startup');
  await launch();
  await assertStyled('quartz', 'rgb(17, 20, 24)');
  await screenshot('initial-quartz');
  await click('Install SDK example');
  await text('Verified plugin installed from the catalog.');
  await assertPluginFeedbackNearAction('Verified plugin installed from the catalog.');
  await click('Run hello');
  await text('Hello, world!');
  await assertPluginFeedbackNearAction('Hello, world!');
  await screenshot('hello-result-beside-action');
  await click('Appearance');
  await click('Select theme: Quartz');
  await observeSourceView('!!document.querySelector(\'[data-testid="runtime-message"]\')');
  await click('Dark Quartz');
  await observedSourceView('Saved theme feedback must be visible after the native acknowledgement');
  await assertStyled('dark-quartz', 'rgb(240, 240, 240)');
  await screenshot('downloaded-plugin-and-saved-theme');
  await rpc('DELETE', `/session/${session}`); session = undefined;
  await launch();
  await click('Appearance');
  await text('Current: Dark Quartz.');
  await assertStyled('restarted-dark-quartz', 'rgb(240, 240, 240)');
  await click('Runtime');
  await click('Run hello');
  await text('Hello, world!');
  await screenshot('persisted-after-native-restart');
  // Seed through the real typed Rust command boundary; native picker selection is
  // separately exercised on macOS. No mocked transport or renderer learner state.
  async function native(request) {
    const value = await rpc('POST', `/session/${session}/execute/async`, {script: `
      const done=arguments[arguments.length-1];
      window.__TAURI_INTERNALS__.invoke('runtime_execute',{request:JSON.stringify(arguments[0])})
        .then(value=>done(JSON.parse(value))).catch(error=>done({type:'error',message:String(error)}));`, args:[request]});
    return value;
  }
  const numericBase = (await native({ type: 'snapshot' })).snapshot;
  restoreTheme = async () => {
    const current = (await native({type:'snapshot'})).snapshot;
    const restored = await native({type:'save_theme',document:numericBase.theme,expectedRevision:current.revision,commandId:randomUUID()});
    assert.equal(restored.type,'saved',JSON.stringify(restored));
    restoreTheme = undefined;
  };
  // Observe actual layout before refreshing accepted native settings. CSS-variable
  // mode formerly updated colors but left numeric theme-derived styles frozen.
  await script(`
    window.__m01NumericTheme = {};
    window.__m01NumericTheme.promise = new Promise(resolve => {
      // Expo keeps the Home route mounted. Observe the active Settings heading,
      // not the first (hidden) route heading, which can retain its old geometry.
      const heading = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"],[role="header"]'))
        .find(node => node.textContent === 'Settings' && node.getClientRects().length);
      let settled = false;
      const finish = value => {
        if(settled)return;
        settled=true;observer.disconnect();clearTimeout(timer);resolve(value);
      };
      const observer = new ResizeObserver(() => {
        const fontSize=getComputedStyle(heading).fontSize;
        if(fontSize==='40px')finish({fontSize});
      });
      const timer = setTimeout(() => finish({error:'Numeric theme did not update mounted text',fontSize:getComputedStyle(heading).fontSize}),5000);
      window.__m01NumericTheme.cancel = () => finish({error:'cancelled'});
      observer.observe(heading);
    });
    return true;
  `);
  try {
    const scaled = await native({type:'save_theme',document:{...numericBase.theme,textScale:2},expectedRevision:numericBase.revision,commandId:randomUUID()});
    assert.equal(scaled.type,'saved',JSON.stringify(scaled));
    await click('Reload native state');
    const scaledText = await rpc('POST',`/session/${session}/execute/async`,{script:`
      const done=arguments[arguments.length-1];window.__m01NumericTheme.promise.then(done);`,args:[]});
    assert.equal(scaledText.fontSize,'40px',JSON.stringify(scaledText));
  } finally {
    await script('window.__m01NumericTheme.cancel();delete window.__m01NumericTheme;return true;');
  }
  async function resumeWatch() {
    // Home refreshes native state after missing-source recovery. Presence alone
    // can find the button while that refresh still disables it. Observe readiness
    // before the real WebDriver click; a permanently disabled control still fails.
    const element = await rpc('POST', `/session/${session}/execute/async`, {script: `
      const done=arguments[arguments.length-1];
      let settled=false;
      function finish(value) {
        if(settled)return;
        settled=true;observer.disconnect();clearTimeout(timer);done(value);
      }
      function check() {
        const button=Array.from(document.querySelectorAll('[aria-label="Resume watch-fixture.mp4"]')).find(node=>{
          if(node.disabled||node.getAttribute('aria-disabled')==='true'||
            node.closest('[aria-hidden="true"]')||!node.getClientRects().length)return false;
          const style=getComputedStyle(node);
          return style.visibility!=='hidden'&&style.pointerEvents!=='none';
        });
        if(button)finish(button);
      }
      const observer=new MutationObserver(check);
      const timer=setTimeout(()=>finish({readinessError:'Resume source did not become visible and enabled'}),20000);
      observer.observe(document.body,{subtree:true,childList:true,attributes:true});
      check();`, args:[]});
    const id=element?.['element-6066-11e4-a52e-4f735466cecf'];
    assert.ok(id,JSON.stringify(element));
    await rpc('POST', `/session/${session}/element/${id}/click`, {});
  }
  assert.equal((await native({type:'install_plugin',pluginId:'org.mlearn.english'})).type,'installed');
  const fixture=path.resolve('.mlearn/m01-ci-fixtures/watch-fixture.mp4');
  const opened=await native({type:'open_source',path:fixture,packageId:'org.mlearn.english'});
  assert.equal(opened.type,'source',JSON.stringify(opened));
  const id=opened.window.source.id;
  const attached=await native({type:'attach_subtitles',sourceId:id,path:path.resolve('.mlearn/m01-ci-fixtures/watch-fixture.srt')});
  assert.equal(attached.type,'source',JSON.stringify(attached));
  await click('Home');
  // Refocus Home to fetch sources created through the same native runtime.
  await click('Settings');await click('Home');
  await resumeWatch();
  await until(()=>script('const v=document.querySelector("video");return v&&v.readyState>=2&&v.duration>=29'),'Decoded real H.264/AAC fixture');
  // Reject only a real rate write in this explicitly isolated profile. Position
  // checkpoints still commit; IPC and the native rejection remain genuine.
  assert.ok(process.env.XDG_DATA_HOME, 'Native failure checks require an isolated XDG_DATA_HOME');
  const preferenceDb = new DatabaseSync(path.join(process.env.XDG_DATA_HOME, 'net.kikan.mlearn.v3dev', 'profile.sqlite3'));
  preferenceDb.exec(`CREATE TRIGGER mlearn_test_rate_write_rejected BEFORE UPDATE OF document ON sources
    WHEN json_extract(NEW.document,'$.playbackRate') <> json_extract(OLD.document,'$.playbackRate')
    BEGIN SELECT RAISE(ABORT,'mlearn_test_rate_write_rejected'); END`);
  try {
    await observeSourceView('!!document.querySelector(\'[data-testid="playback-preference-error"]\')');
    await click('Playback rate: 1×');
    await click('1.25×');
    await observedSourceView('A rejected preference write must show feedback without opening another dialog');
    const feedback = await script(`const error=document.querySelector('[data-testid="playback-preference-error"]');
      const controls=document.querySelector('[data-testid="media-controls"]');
      const r=error.getBoundingClientRect();return {text:error.textContent,besideControls:controls.contains(error),
        visible:r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight};`);
    assert.match(feedback.text, /mlearn_test_rate_write_rejected/);
    assert.ok(feedback.besideControls && feedback.visible, 'Rate failure must remain visible beside its initiating control');
    assert.equal((await native({type:'recent_sources'})).sources.find(source=>source.id===id).playbackRate, 1);
  } finally {
    preferenceDb.exec('DROP TRIGGER mlearn_test_rate_write_rejected');
    preferenceDb.close();
  }
  await observeSourceView('document.querySelector("video")?.playbackRate===1.25&&!document.querySelector(\'[data-testid="playback-preference-error"]\')');
  await click('Playback rate: 1×');await click('1.25×');
  await observedSourceView('Retry must save the real preference and clear its feedback');
  await observeSourceView('document.querySelector("video")?.playbackRate===1');
  await click('Playback rate: 1.25×');await click('1×');
  await observedSourceView('Restore the fixture rate before ordinary media input');
  const rateKeysBefore=await script(`document.querySelector('[role="combobox"][aria-label^="Playback rate:"]').focus();
    window.__rateKeyEvents=[];window.__rateKeyListener=event=>window.__rateKeyEvents.push({key:event.key,prevented:event.defaultPrevented});
    document.addEventListener('keydown',window.__rateKeyListener);
    const video=document.querySelector('video');return {time:video.currentTime,muted:video.muted};`);
  try {
    for(const key of ['\uE014','\uE012','m','f']) {
      await rpc('POST',`/session/${session}/actions`,{actions:[{type:'key',id:'rate-control-input',actions:[
        {type:'keyDown',value:key},{type:'keyUp',value:key},
      ]}]});
    }
    const rateKeysAfter=await script(`const video=document.querySelector('video');return {time:video.currentTime,muted:video.muted,events:window.__rateKeyEvents};`);
    assert.equal(rateKeysAfter.time,rateKeysBefore.time,'Closed combobox arrows must not seek the video');
    assert.equal(rateKeysAfter.muted,rateKeysBefore.muted,'Combobox typing must not mute the video');
    assert.equal(rateKeysAfter.events.length,4);
    assert.ok(rateKeysAfter.events.every(event=>!event.prevented),'Media shortcuts must not consume combobox keys');
  } finally {
    await script('document.removeEventListener("keydown",window.__rateKeyListener);delete window.__rateKeyEvents;delete window.__rateKeyListener;document.activeElement.blur();return true;');
  }
  await rpc('POST', `/session/${session}/execute/async`, {script:'const done=arguments[arguments.length-1];document.querySelector("video").play().then(()=>done(true)).catch(e=>done(String(e)));',args:[]});
  await until(()=>script('return document.querySelector("video").currentTime>1'),'Playback time advances');
  await script('document.querySelector("video").pause()');
  await click('Children: untracked');await text('child');await click('Adjust Meaning knowledge: Meaning \u00b7 untracked');
  await click('Claim Meaning known');await text('claimed known');await closeInspector();
  await click('Children: mixed');await closeInspector();
  await script('document.querySelector("video").currentTime=20');
  await until(()=>script('return Math.abs(document.querySelector("video").currentTime-20)<0.5'),'Seek to second occurrence');
  await click('came: untracked');await text('come');await closeInspector();
  await click('Children: mixed');await closeInspector();
  // Hold only delivery of a real native preference response. Cancellation and
  // route blur must recover without an obsolete completion replacing that owner.
  for (const leave of ['cancel', 'blur']) {
    const offset=leave==='cancel'?375:625;
    const checkpoint=leave==='cancel'?10000:11000;
    await script(`const callbacks=window.__TAURI_INTERNALS__.callbacks;
      const originalSet=callbacks.set;
      const gate={originalSet,release:null,entered:null,checkpoint:null,delivered:false,checkpointArmed:false};
      gate.entered=new Promise(resolve=>gate.enter=resolve);
      gate.checkpoint=new Promise(resolve=>gate.saved=resolve);
      const held=new Promise(resolve=>gate.release=resolve);
      window.__m02Preference=gate;
      // Tauri's invoke property is deliberately nonwritable. Its documented
      // debugging callback Map lets this harness delay a real result without
      // replacing IPC or fabricating a native response.
      const offset=arguments[0],sourceId=arguments[1],position=arguments[2];
      callbacks.set=function(key,callback){
        return originalSet.call(this,key,data=>{
          let response;
          if(typeof data==='string')try{response=JSON.parse(data);}catch{}
          if(!gate.delivered&&response?.type==='source'&&response.window.source.id===sourceId&&response.window.source.subtitleOffsetMs===offset){
            gate.delivered=true;gate.enter();void held.then(()=>callback(data));return;
          }
          callback(data);
          if(gate.checkpointArmed&&response?.type==='position_saved'){
            // A resumed player's earlier checkpoint can finish after a new seek.
            // Signal the exact durable position, not whichever acknowledgement
            // happens to arrive first.
            void window.__TAURI_INTERNALS__.invoke('runtime_execute',{request:JSON.stringify({type:'recent_sources'})}).then(raw=>{
              const saved=JSON.parse(raw);
              if(saved.type!=='sources')throw new Error(raw);
              if(saved.sources.find(source=>source.id===sourceId)?.positionMs===position){
                gate.checkpointArmed=false;gate.saved(data);
              }
            }).catch(error=>gate.saved(JSON.stringify({type:'error',message:String(error)})));
          }
        });
      };return true;`,[offset,id,checkpoint]);
    try {
      await click('Playback options');
      const input=await rpc('POST',`/session/${session}/element`,{using:'css selector',value:'[data-testid="subtitle-offset-input"]'});
      const inputId=input['element-6066-11e4-a52e-4f735466cecf'];
      await rpc('POST',`/session/${session}/element/${inputId}/clear`,{});
      await rpc('POST',`/session/${session}/element/${inputId}/value`,{text:String(offset)});
      await click('Apply subtitle offset');
      assert.equal(await rpc('POST',`/session/${session}/execute/async`,{
        script:'const done=arguments[0];const timer=setTimeout(()=>done(false),10000);window.__m02Preference.entered.then(()=>{clearTimeout(timer);done(true);});',args:[],
      }),true,'Preference must reach the actual native owner before cancellation');
      await click('Close');
      if (leave === 'cancel') {
        await click('Cancel opening');
      } else {
        await rpc('POST',`/session/${session}/back`,{});
        await text('Recent sources');
      }
      await script('window.__m02Preference.release();return true;');
      if (leave === 'blur') await resumeWatch();
      const resumed=(await native({type:'recent_sources'})).sources.find(source=>source.id===id);
      // This probe sets HTMLVideoElement.currentTime directly, unlike the product
      // controller which queues seeks until metadata. First observe real resume
      // initialization so it cannot overwrite the test's subsequent raw seek.
      await observeSourceView(`!!document.querySelector('[aria-label="Children: mixed"]')&&!document.querySelector('[aria-label="Cancel opening"]')&&document.querySelector("video")?.readyState>=2&&!document.querySelector("video").seeking&&Math.abs(document.querySelector("video").currentTime-${resumed.positionMs}/1000)<0.01`);
      await observedSourceView('Cancelled or blurred preference work must leave a usable Watch');
      await script('window.__m02Preference.checkpointArmed=true;document.querySelector("video").currentTime=arguments[0]/1000;return true;',[checkpoint]);
      const saved=await rpc('POST',`/session/${session}/execute/async`,{
        script:'const done=arguments[0];const timer=setTimeout(()=>done(null),10000);window.__m02Preference.checkpoint.then(value=>{clearTimeout(timer);done(value);});',args:[],
      });
      const recent=await native({type:'recent_sources'});
      const media=await script('const video=document.querySelector("video");return {positionMs:Math.round(video.currentTime*1000),readyState:video.readyState,seeking:video.seeking};');
      assert.equal(JSON.parse(saved ?? '{}').type,'position_saved',`Fresh media checkpoints must persist after preference cancellation: ${JSON.stringify({leave,checkpoint,media,source:recent.sources.find(source=>source.id===id),saved})}`);
      assert.equal(recent.sources.find(source=>source.id===id).positionMs,checkpoint);
      assert.equal(recent.sources.find(source=>source.id===id).subtitleOffsetMs,offset);
    } finally {
      await script('const gate=window.__m02Preference;gate.release();window.__TAURI_INTERNALS__.callbacks.set=gate.originalSet;delete window.__m02Preference;return true;');
    }
  }
  // Real persisted source preferences feed the mounted host and untouched cues.
  assert.equal((await native({type:'set_subtitle_offset',sourceId:id,offsetMs:500})).type,'source');
  assert.equal((await native({type:'set_playback_rate',sourceId:id,rate:1.25})).type,'source');
  assert.equal((await native({type:'set_inspection_trigger',sourceId:id,trigger:'modifier'})).type,'source');
  await click('Home');
  await observeSourceView('document.querySelector("video")?.readyState>=1&&document.querySelector("video").playbackRate===1.25');
  await resumeWatch();
  await observedSourceView('Saved playback rate must reach the actual native video');
  const shifted=await native({type:'source_window',sourceId:id,positionMs:14500});
  assert.equal(shifted.window.cues.find(cue=>cue.index===1).startMs,15000);
  await click('Transcript');
  const search=await rpc('POST',`/session/${session}/element`,{using:'css selector',value:'[aria-label="Search transcript"]'});
  const searchId=search['element-6066-11e4-a52e-4f735466cecf'];
  await rpc('POST',`/session/${session}/element/${searchId}/value`,{text:'came'});
  await observeSourceView('!!document.querySelector(\'[aria-label="Go to cue 2 at 0:14"]\')&&!document.querySelector(\'[aria-label^="Go to cue 1 "]\')');
  await click('Search');
  await observedSourceView('Bounded transcript search must return the actual second cue');
  await screenshot('native-transcript-search');
  await observeSourceView('!!document.querySelector(\'[aria-label="came: untracked"]\')');
  await observedSourceView('Transcript must reuse real native token analysis');
  await click('came: untracked');
  await text('come');
  await click('Adjust Meaning knowledge: Meaning \u00b7 untracked');
  await observeSourceView('!!document.querySelector(\'[aria-label="Adjust Meaning knowledge: Meaning · claimed known"]\')');
  await click('Claim Meaning known');
  await observedSourceView('Transcript claim must update authoritative Knowledge');
  await closeInspector();
  assert.equal(await script('return document.activeElement?.getAttribute("aria-label")'),'came: mixed');
  await click('came: mixed');
  await text('come');
  await click('Adjust Meaning knowledge: Meaning \u00b7 claimed known');
  await observeSourceView('!!document.querySelector(\'[aria-label="Adjust Meaning knowledge: Meaning · untracked"]\')');
  await click('Withdraw Meaning claim');
  await observedSourceView('Transcript withdrawal must refresh the same Knowledge projection');
  await closeInspector();
  assert.equal(await script('return document.activeElement?.getAttribute("aria-label")'),'came: untracked');
  // Observe the UI's actual analysis instead of issuing a competing background
  // analysis into the deliberately single-guest native execution slot.
  await script(`const callbacks=window.__TAURI_INTERNALS__.callbacks;
    const observed={originalSet:callbacks.set};
    observed.promise=new Promise(resolve=>observed.publish=resolve);
    const sourceId=arguments[0];
    window.__m02AnalysisObservation=observed;
    callbacks.set=function(key,callback){
      return observed.originalSet.call(this,key,data=>{
        callback(data);
        let response;
        if(typeof data==='string')try{response=JSON.parse(data);}catch{}
        if(response?.type==='analysis'&&response.batch?.sourceId===sourceId)observed.publish(response);
      });
    };return true;`,[id]);
  let beforeHover;
  try {
    await observeSourceView('Math.abs(document.querySelector("video").currentTime-14.5)<0.01&&!document.querySelector(\'[data-testid="dialog-surface"]\')');
    await click('Go to cue 2 at 0:14');
    await observedSourceView('Transcript selection must seek the real player using the saved offset');
    await observeSourceView('!!document.querySelector(\'[aria-label="Children: mixed"]\')');
    await observedSourceView('Shifted cue retains the same authoritative Knowledge');
    beforeHover=await rpc('POST',`/session/${session}/execute/async`,{
      script:'const done=arguments[0];const timer=setTimeout(()=>done({type:"error",message:"No UI analysis completed"}),10000);window.__m02AnalysisObservation.promise.then(value=>{clearTimeout(timer);done(value);});',args:[],
    });
  } finally {
    await script('window.__TAURI_INTERNALS__.callbacks.set=window.__m02AnalysisObservation.originalSet;delete window.__m02AnalysisObservation;return true;');
  }
  assert.equal(beforeHover.type,'analysis',JSON.stringify(beforeHover));
  assert.ok(beforeHover.batch.knowledge.some(projection=>projection.claim===true));
  const child=await rpc('POST',`/session/${session}/element`,{using:'css selector',value:'[aria-label="Children: mixed"]'});
  await observeSourceView('!!document.querySelector(\'[data-testid="inspector-panel"] [aria-label="Dictionary source"]\')');
  await rpc('POST',`/session/${session}/actions`,{actions:[
    {type:'key',id:'inspection-modifier',actions:[{type:'keyDown',value:'\uE008'},{type:'pause',duration:0},{type:'keyUp',value:'\uE008'}]},
    {type:'pointer',id:'inspection-pointer',parameters:{pointerType:'mouse'},actions:[
      {type:'pointerMove',duration:0,origin:'viewport',x:0,y:0},
      {type:'pointerMove',duration:0,origin:child,x:0,y:0},
      {type:'pause',duration:0},
    ]},
  ]});
  await observedSourceView('Shift-assisted real pointer entry must open the shared Inspector without a click');
  await screenshot('native-modifier-inspection');
  await closeInspector();
  const retainedClaim=await native({type:'knowledge',keys:beforeHover.batch.knowledge.map(projection=>projection.key)});
  assert.equal(retainedClaim.type,'knowledge');
  assert.deepEqual(retainedClaim.projections,beforeHover.batch.knowledge,'Hover must not create learner evidence or change claims');
  assert.equal((await native({type:'set_subtitle_offset',sourceId:id,offsetMs:0})).type,'source');
  assert.equal((await native({type:'set_playback_rate',sourceId:id,rate:1})).type,'source');
  assert.equal((await native({type:'set_inspection_trigger',sourceId:id,trigger:'click'})).type,'source');
  await click('Home');
  await observeSourceView('document.querySelector("video")?.readyState>=1&&document.querySelector("video").playbackRate===1');
  await resumeWatch();
  await observedSourceView('Reset source preferences must restore the real host');
  await observeSourceView('Math.abs(document.querySelector("video").currentTime-20)<0.01&&!!document.querySelector(\'[aria-label="home: untracked"]\')');
  await script('document.querySelector("video").currentTime=20;return true;');
  await observedSourceView('Continue at the exact original second-line occurrence');
  // A second-line occurrence must reserve its entire authored cue and follow
  // the real native window resize, not retain its first captured coordinates.
  await script(`window.__m01EntryReady=new Promise(resolve=>{
   const ready=()=>document.querySelector('[data-testid="inspector-panel"] [aria-label="Dictionary source"]');
   const finish=pass=>{observer.disconnect();clearTimeout(timer);resolve(pass);};
   const observer=new MutationObserver(()=>{if(ready())finish(true);});
   const timer=setTimeout(()=>finish(false),5000);
   observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});
  });`);
  await click('home: untracked');
  assert.equal(await rpc('POST',`/session/${session}/execute/async`,{
   script:'const done=arguments[0],pending=window.__m01EntryReady;delete window.__m01EntryReady;pending.then(done);',args:[]
  }),true,'The actual dictionary entry must be ready before layout assertions');
  const clearance=await script(`const panel=document.querySelector('[data-testid="inspector-panel"]').getBoundingClientRect();
   const cue=document.querySelector('button[aria-label="home: untracked"]').closest('[data-testid="annotated-text"]').getBoundingClientRect();
   return {bottom:panel.bottom,cueTop:cue.top};`);
  assert.ok(clearance.bottom<=clearance.cueTop,JSON.stringify(clearance));
  const windowPath=`/session/${session}/window/rect`;
  const originalRect=await rpc('GET',windowPath);
  await script(`window.__m01ResizeCheck=new Promise(resolve=>{
   const panel=document.querySelector('[data-testid="inspector-panel"]');
   const word=document.querySelector('button[aria-label="home: untracked"]');
   const cue=word.closest('[data-testid="annotated-text"]');
   const initialWidth=innerWidth;
   let resize,mutation,last;
   const finish=pass=>{resize.disconnect();mutation.disconnect();removeEventListener('resize',check);clearTimeout(timer);resolve({pass,...last});};
   const check=()=>{
    if(innerWidth===initialWidth)return;
    const p=panel.getBoundingClientRect(),w=word.getBoundingClientRect(),c=cue.getBoundingClientRect();
    const expected=w.left+w.width/2;
    last={panel:p.toJSON(),cue:c.toJSON(),expected,viewport:innerWidth};
    if(Math.abs(p.left+p.width/2-expected)<2&&p.bottom<=c.top&&p.left>=0&&p.right<=innerWidth)finish(true);
   };
   const timer=setTimeout(()=>finish(false),5000);
   resize=new ResizeObserver(check);resize.observe(document.documentElement);resize.observe(panel);
   mutation=new MutationObserver(check);mutation.observe(panel,{attributes:true,attributeFilter:['style','class']});
   addEventListener('resize',check);
  });`);
  try {
   await rpc('POST',windowPath,{...originalRect,width:originalRect.width+160});
   const resized=await rpc('POST',`/session/${session}/execute/async`,{script:'const done=arguments[0],pending=window.__m01ResizeCheck;delete window.__m01ResizeCheck;pending.then(done);',args:[]});
   assert.equal(resized.pass,true,JSON.stringify(resized));
  } finally {
   await rpc('POST',windowPath,originalRect);
  }
  // Keep the accepted maximum text scale through the minimum native viewport.
  // A fixed expanded footer previously left no complete dictionary line visible.
  await click('Adjust Meaning knowledge: Meaning \u00b7 untracked');
  await script(`window.__m01CompactCheck=new Promise(resolve=>{
   const panel=document.querySelector('[data-testid="inspector-panel"]');
   const body=panel.querySelector('[data-testid="inspector-body"]');
   const footer=panel.querySelector('[data-testid="inspector-footer"]');
   const subtitles=document.querySelector('[data-testid="subtitle-window"]');
   const toolbar=document.querySelector('[data-testid="watch-toolbar"]');
   const controls=document.querySelector('[data-testid="media-controls"]');
   let settled=false,last;
   const finish=pass=>{
    if(settled)return;settled=true;
    resize.disconnect();mutation.disconnect();removeEventListener('resize',check);clearTimeout(timer);resolve({pass,...last});
   };
   const check=()=>{
    if(innerWidth>420||innerHeight>560)return;
    const p=panel.getBoundingClientRect(),b=body.getBoundingClientRect(),f=footer.getBoundingClientRect();
    const lineHeight=Math.max(44,...Array.from(body.querySelectorAll('*'),node=>parseFloat(getComputedStyle(node).lineHeight)).filter(Number.isFinite));
    const s=subtitles.getBoundingClientRect(),t=toolbar.getBoundingClientRect(),c=controls.getBoundingClientRect();
    last={panel:p.toJSON(),body:b.toJSON(),footer:f.toJSON(),subtitles:s.toJSON(),toolbar:t.toJSON(),controls:c.toJSON(),lineHeight,width:innerWidth,height:innerHeight};
    if(b.height>=lineHeight&&p.top>=0&&p.bottom<=innerHeight&&f.top>=b.bottom&&f.bottom<=p.bottom&&s.height>0&&s.top>=t.bottom&&s.bottom<=c.top)finish(true);
   };
   const resize=new ResizeObserver(check);[panel,body,footer,subtitles,toolbar,controls].forEach(node=>resize.observe(node));
   const mutation=new MutationObserver(check);mutation.observe(panel,{subtree:true,attributes:true,childList:true});
   const timer=setTimeout(()=>finish(false),5000);
   addEventListener('resize',check);check();
  });`);
  try {
   await rpc('POST',windowPath,{...originalRect,width:420,height:560});
   const compact=await rpc('POST',`/session/${session}/execute/async`,{script:'const done=arguments[0],pending=window.__m01CompactCheck;delete window.__m01CompactCheck;pending.then(done);',args:[]});
   assert.equal(compact.pass,true,JSON.stringify(compact));
   await click('Adjust Meaning knowledge: Meaning \u00b7 untracked');
   await screenshot('watch-enlarged-minimum-inspector');
  } finally {
   await rpc('POST',windowPath,originalRect);
  }
  await closeInspector();
  assert.equal(await script('return document.activeElement?.getAttribute("aria-label")'),'home: untracked');
  await screenshot('watch-inspector-claim-projection');
  await click('Home');
  await click('Settings');
  // Observe before opening/resizing: AX/DOM presence alone missed a clipped form.
  await script(`window.__overnightDialogCheck=new Promise(resolve=>{
   let settled=false,last;
   const finish=pass=>{
    if(settled)return;settled=true;
    resize.disconnect();mutation.disconnect();removeEventListener('resize',check);clearTimeout(timer);
    resolve({pass,...last});
   };
   const visible=element=>{
    element.scrollIntoView({block:'center'});
    const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return r.width>0&&r.height>0&&!!hit&&(hit===element||element.contains(hit));
   };
   const check=()=>{
    if(settled||innerWidth>420||innerHeight>560)return;
    const dialog=document.querySelector('[role="dialog"]');
    const panel=dialog?.querySelector('[data-testid="dialog-surface"]');
    const editor=dialog?.querySelector('textarea'),save=dialog?.querySelector('[aria-label="Save custom theme"]');
    if(!panel||!editor||!save)return;
    const bounds=panel.getBoundingClientRect();
    last={bounds:bounds.toJSON(),width:innerWidth,height:innerHeight,editor:visible(editor),save:visible(save)};
    if(last.editor&&last.save&&bounds.top>=0&&bounds.bottom<=innerHeight)finish(true);
   };
   const resize=new ResizeObserver(check);resize.observe(document.body);
   const mutation=new MutationObserver(check);mutation.observe(document.body,{subtree:true,attributes:true,childList:true});
   const timer=setTimeout(()=>finish(false),5000);
   addEventListener('resize',check);check();
  });`);
  await click('Edit theme JSON');
  try {
   await rpc('POST',windowPath,{...originalRect,width:420,height:560});
   const visibility=await rpc('POST',`/session/${session}/execute/async`,{script:'const done=arguments[0],pending=window.__overnightDialogCheck;delete window.__overnightDialogCheck;pending.then(done);',args:[]});
   await screenshot('dialog-minimum-2x-controls');
   assert.equal(visibility.pass,true,JSON.stringify(visibility));
  } finally {
   try { await click('Close'); }
   finally { await rpc('POST',windowPath,originalRect); }
  }
  await click('Home');
  await restoreTheme();
   await click('Settings');await click('Runtime');await click('Reload native state');await click('Home');
  const saved=(await native({type:'recent_sources'})).sources.find(source=>source.id===id);
  assert.ok(Math.abs(saved.positionMs-20000)<500);assert.equal(saved.subtitleRevision,attached.window.source.subtitleRevision);assert.equal(saved.packageId,'org.mlearn.english');
  await rpc('DELETE', `/session/${session}`);session=undefined;
  await launch();await click('Home');await resumeWatch();
  await until(()=>script('const v=document.querySelector("video");return v&&Math.abs(v.currentTime-20)<0.5'),'Exact source position after native restart');
  await click('Children: mixed');await closeInspector();await click('Home');
  await rename(fixture,fixture+'.missing');
  try {await resumeWatch();await text('reselect');await click('Reselect from Home');}
  finally {await rename(fixture+'.missing',fixture);}
  await resumeWatch();
  await until(()=>script('const v=document.querySelector("video");return v&&Math.abs(v.currentTime-20)<0.5'),'Missing-source recovery keeps progress');
  await screenshot('watch-restarted-source');
  await click('Home');
  const subtitleCopy=attached.window.source.subtitlePath;
  await rename(subtitleCopy,subtitleCopy+'.missing');
  try {
    await resumeWatch();await text('Reselect subtitles');
    assert.equal((await native({type:'attach_subtitles',sourceId:id,path:path.resolve('.mlearn/m01-ci-fixtures/watch-fixture.srt')})).type,'source');
    await click('Retry source');
    await until(()=>script('const v=document.querySelector("video");return v&&Math.abs(v.currentTime-20)<0.5'),'Replaced missing subtitles preserve source position');
  } finally {await rename(subtitleCopy+'.missing',subtitleCopy);}

  // An unavailable language analysis must never freeze the raw subtitle window.
  const unsupported=path.resolve('.mlearn/m01-ci-fixtures/unsupported.srt');
  await writeFile(unsupported,'1\n00:00:00,000 --> 00:00:05,000\n日本語\n\n2\n00:00:10,000 --> 00:00:15,000\n語彙\n\n3\n00:00:20,000 --> 00:00:30,000\n字幕\n');
  assert.equal((await native({type:'attach_subtitles',sourceId:id,path:unsupported})).type,'source');
  await click('Home');await resumeWatch();
  await text('English');await text('字幕');
  await script('document.querySelector("video").currentTime=2');
  await text('日本語');
  await screenshot('watch-raw-subtitles-with-analysis-unavailable');
  // Two seeks within the same two-second bucket must still change the cue window.
  await writeFile(unsupported,'1\n00:00:00,000 --> 00:00:00,250\nChildren.\n\n2\n00:00:00,250 --> 00:00:00,500\nwalked.\n\n3\n00:00:00,500 --> 00:00:01,500\nhome.\n');
  assert.equal((await native({type:'attach_subtitles',sourceId:id,path:unsupported})).type,'source');
  await click('Home');await resumeWatch();
  // A Resume click finishes before React mounts the player. Subscribe to its
  // real media/initial-seek events before seeking, retaining that active element.
  const subsecondVideo=await rpc('POST', `/session/${session}/execute/async`, {script: `
    const done=arguments[arguments.length-1];
    const listeners=new AbortController();
    let video,settled=false;
    function finish(value) {
      if(settled)return;
      settled=true;observer.disconnect();listeners.abort();clearTimeout(timer);done(value);
    }
    function check() {
      const active=Array.from(document.querySelectorAll('video')).find(node=>
        node.getClientRects().length&&!node.closest('[aria-hidden="true"]'));
      if(active!==video) {
        video=active;
        video?.addEventListener('loadedmetadata',check,{signal:listeners.signal});
        video?.addEventListener('loadeddata',check,{signal:listeners.signal});
        video?.addEventListener('seeked',check,{signal:listeners.signal});
        video?.addEventListener('error',check,{signal:listeners.signal});
      }
      if(video?.error)finish({mediaError:video.error.code});
      else if(video&&video.readyState>=2&&!video.seeking)finish(video);
    }
    const observer=new MutationObserver(check);
    const timer=setTimeout(()=>finish({readinessError:'Video metadata unavailable before subsecond seek'}),20000);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true});
    check();`, args:[]});
  assert.ok(subsecondVideo?.['element-6066-11e4-a52e-4f735466cecf'],JSON.stringify(subsecondVideo));
  await script('arguments[0].currentTime=0.1',[subsecondVideo]);await click('Children: mixed');await closeInspector();
  await script('arguments[0].currentTime=0.8',[subsecondVideo]);await click('home: untracked');await text('home');await closeInspector();
  console.log('Real Tauri IPC, signed packages, playback/seek, contextual Inspector, shared claims, exact source restart and missing-source recovery passed.');
} catch (error) {
  if (session) {
    await screenshot('failure').catch(() => {});
    const body = await script('return document.body.innerText').catch(() => 'No DOM available');
    await writeFile('test-results/desktop/failure.txt', String(body));
    await script(`const v=document.querySelector('video'); return v && {src:v.currentSrc,readyState:v.readyState,networkState:v.networkState,duration:Number.isFinite(v.duration)?v.duration:null,currentTime:v.currentTime,paused:v.paused,error:v.error&&{code:v.error.code,message:v.error.message},mp4:v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),webm:v.canPlayType('video/webm; codecs="vp9, opus"')};`).then(state=>writeFile('test-results/desktop/media-failure.json',JSON.stringify(state,null,2))).catch(error=>writeFile('test-results/desktop/media-failure.json',JSON.stringify({probeError:String(error)},null,2)));
    await styleState().then(state => writeFile('test-results/desktop/styles-failure.json', JSON.stringify(state, null, 2))).catch(() => {});
  }
  throw error;
} finally {
  try {
    if (session && restoreTheme) await restoreTheme();
  } finally {
    if (session) await rpc('DELETE', `/session/${session}`).catch(() => {});
    driver.kill('SIGTERM');
    catalog.close();
  }
}
