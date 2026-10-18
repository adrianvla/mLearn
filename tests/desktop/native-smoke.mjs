// Drive the real Tauri binary through WebKit WebDriver, without mocking IPC.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startCatalog } from '../../tools/catalog-server.mjs';

await mkdir('test-results/desktop', { recursive: true });
const catalog = await startCatalog(path.resolve('target/plugin-cdn'));
const driver = spawn('tauri-driver', ['--port', '4444'], { stdio: 'inherit' });
let session;
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
  const element = await until(async () => {
    const value = await rpc('POST', `/session/${session}/element`, { using: 'css selector', value: `[aria-label="${label}"]` });
    return value['element-6066-11e4-a52e-4f735466cecf'];
  }, label);
  await rpc('POST', `/session/${session}/element/${element}/click`, {});
}
async function launch() {
  const result = await rpc('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: path.resolve('target/debug/mlearn-desktop') } } } });
  session = result.sessionId;
  assert.ok(session, 'WebDriver session missing');
  await click('Settings');
  await text('Tauri desktop');
}
async function screenshot(name) {
  const data = await rpc('GET', `/session/${session}/screenshot`);
  await writeFile(`test-results/desktop/${name}.png`, Buffer.from(data, 'base64'));
}
async function styleState() {
  return script(`
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"],[role="header"]'))
      .find(node => node.textContent === 'One app. Native at the core.');
    const button = document.querySelector('[aria-label="Reload native state"]');
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
      .find(node => node.textContent === 'Hello, plugin');
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
  assert.equal(state.heading.fontSize, '28px', 'Packaged webview must apply the shared typography');
  assert.equal(state.heading.color, color, 'Native webview must apply the current theme, not merely save its name');
  assert.ok(state.buttonHeight >= 44, 'Shared native-web button must retain its accessible hit target');
}
try {
  await until(() => rpc('GET', '/status'), 'WebDriver startup');
  await launch();
  await assertStyled('quartz', 'rgb(32, 35, 42)');
  await screenshot('initial-quartz');
  await click('Install SDK example');
  await text('Verified plugin installed from the catalog.');
  await assertPluginFeedbackNearAction('Verified plugin installed from the catalog.');
  await click('Run hello');
  await text('Hello, world!');
  await assertPluginFeedbackNearAction('Hello, world!');
  await screenshot('hello-result-beside-action');
  await click('Slate');
  await text('Theme saved by Rust');
  await assertStyled('slate', 'rgb(237, 240, 245)');
  await screenshot('downloaded-plugin-and-saved-theme');
  await rpc('DELETE', `/session/${session}`); session = undefined;
  await launch();
  await text('Current: Slate.');
  await assertStyled('restarted-slate', 'rgb(237, 240, 245)');
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
  await rpc('POST', `/session/${session}/execute/async`, {script:'const done=arguments[arguments.length-1];document.querySelector("video").play().then(()=>done(true)).catch(e=>done(String(e)));',args:[]});
  await until(()=>script('return document.querySelector("video").currentTime>1'),'Playback time advances');
  await script('document.querySelector("video").pause()');
  await click('Children: untracked');await text('child');await click('Knowledge');
  await click('Claim Meaning known');await text('claimed known');await click('Close Inspector');
  await click('Children: mixed');await click('Close Inspector');
  await script('document.querySelector("video").currentTime=20');
  await until(()=>script('return Math.abs(document.querySelector("video").currentTime-20)<0.5'),'Seek to second occurrence');
  await click('came: untracked');await text('come');await click('Close Inspector');
  await click('Children: mixed');await click('Close Inspector');
  await screenshot('watch-inspector-claim-projection');
  await click('Home');
  const saved=(await native({type:'recent_sources'})).sources.find(source=>source.id===id);
  assert.ok(Math.abs(saved.positionMs-20000)<500);assert.equal(saved.subtitleRevision,attached.window.source.subtitleRevision);assert.equal(saved.packageId,'org.mlearn.english');
  await rpc('DELETE', `/session/${session}`);session=undefined;
  await launch();await click('Home');await resumeWatch();
  await until(()=>script('const v=document.querySelector("video");return v&&Math.abs(v.currentTime-20)<0.5'),'Exact source position after native restart');
  await click('Children: mixed');await click('Close Inspector');await click('Home');
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
  await script('arguments[0].currentTime=0.1',[subsecondVideo]);await click('Children: mixed');await click('Close Inspector');
  await script('arguments[0].currentTime=0.8',[subsecondVideo]);await click('home: untracked');await text('home');await click('Close Inspector');
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
  if (session) await rpc('DELETE', `/session/${session}`).catch(() => {});
  driver.kill('SIGTERM');
  catalog.close();
}
