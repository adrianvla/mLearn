/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

test('the real cosmetic selector updates shared annotations without learning commands and retries the same write', { timeout: 30000 }, async () => {
  const bundle = await build({
    stdin: { loader: 'tsx', resolveDir: resolve('.'), contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { InlineLevelScaleSetting } from './apps/client/src/features/settings/InlineLevelScaleSetting';
      import { ViewPreferencesContext } from './apps/client/src/bootstrap/ViewPreferences';
      import { LinguisticWord } from './apps/client/src/features/linguistic/LinguisticWord';
      import { createRuntimeClient } from './packages/runtime-client/src/client';
      let saved = {revision:0,inlineLevelScale:null,starCollapse:'auto'}, next = 0, loseReply = true;
      const commands = [];
      const scales = [
        {id:'p:exam',label:'Exam',attribution:'Exam author'},
        {id:'p:course',label:'University course',attribution:'University'},
      ];
      const levels = scales.map((scale,index) => ({
        scaleId:scale.id,level:'stage-'+index,label:scale.label,rank:index===0?4:2,attribution:scale.attribution,
      }));
      const client = createRuntimeClient({
        commandId:()=> 'view-'+next++,
        execute:async raw=>{
          const request = JSON.parse(raw); commands.push(request);
          if(request.type==='describe_language') return JSON.stringify({type:'language',description:{
            language:'example',label:'Example',annotationCapability:'p:meaning',attribution:'Package',
            capabilities:[{id:'p:meaning',label:'Meaning'}],levelScales:scales,
          }});
          if(request.type==='save_inline_level_scale'||request.type==='save_star_collapse'){
            // The first reply is lost after commit. Its retry returns the same receipt.
            if(saved.revision===request.expectedRevision) saved={...saved,revision:saved.revision+1,
              ...(request.type==='save_star_collapse'?{starCollapse:request.collapse}:{inlineLevelScale:request.scaleId})};
            if(loseReply){loseReply=false;throw new Error('Reply lost after commit');}
            return JSON.stringify({type:'saved',revision:saved.revision});
          }
          throw new Error('Unexpected domain command: '+request.type);
        },
      });
      window.viewCommands=()=>commands;
      function App(){
        const [view,setView]=useState(saved);
        const snapshot={protocolVersion:1,revision:0,theme:{},codePolicy:'mobile-bundled',catalogConfigured:false,
          availablePlugins:[],installedPlugins:[{id:'p',version:'1',capabilities:['language.describe.v1']}],viewPreferences:view};
        return <ViewPreferencesContext.Provider value={{value:view,publish:setView}}>
          <InlineLevelScaleSetting client={client} snapshot={snapshot} onSaved={async()=>setView({...saved})}/>
          <div><LinguisticWord text="word" presentation={{readings:[],labels:[],contours:[],levels}}
            activation={{status:'claimed_known',onActivate:()=>{}}}/></div>
        </ViewPreferencesContext.Provider>;
      }
      const root=createRoot(document.getElementById('root'));
      window.remountView=()=>{root.render(<App key={next}/>);};
      window.remountView();
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.EXPO_PUBLIC_MLEARN_METRICS': '"0"' },
    plugins: [{
      name: 'native-control-adapters',
      setup(builder) {
        builder.onResolve({ filter: /^@mlearn\/ui\/(button|layout|select|text|inline-word)$/ },
          args => ({ path: args.path, namespace: 'controls' }));
        builder.onLoad({ filter: /.*/, namespace: 'controls' }, () => ({
          loader: 'tsx', resolveDir: resolve('.'), contents: `
            import React from 'react';
            import { InlineWordElement, DocumentWordContent } from './packages/ui/src/InlineWordElement.web';
            export const InlineWord=props=><InlineWordElement {...props} color="#000" knownColor="#080"/>;
            export const InlineWordContent=DocumentWordContent;
            export const SettingRow=({children})=><section>{children}</section>;
            export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
            export const Button=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;
            export const Select=({label,value,options,disabled,onValueChange})=><select aria-label={label}
              value={value} disabled={disabled} onChange={event=>onValueChange(event.target.value)}>
              {options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
            </select>;
          `,
        }));
      },
    }],
  });
  assert.ok(bundle.outputFiles[0]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const selector = page.getByRole('combobox', { name: 'Inline level scale' });
    await expect(selector).toBeEnabled();
    await expect(page.locator('[data-level-star]')).toHaveCount(0);
    await selector.selectOption('p:exam');
    await expect(page.getByRole('alert')).toHaveText('Reply lost after commit');
    await expect(selector).toBeDisabled();
    await page.getByRole('button', { name: 'Retry saving inline level scale' }).click();
    await expect(selector).toBeEnabled();
    await expect(page.locator('[data-level-star]')).toHaveCount(4);
    await selector.selectOption('p:course');
    await expect(page.locator('[data-level-star]')).toHaveCount(2);
    const collapse = page.getByRole('combobox', { name: 'Star collapse' });
    await collapse.selectOption('always');
    await expect(page.locator('[data-level-star]')).toHaveCount(1);
    await expect(page.locator('[data-level-stars-count]')).toHaveText('2');
    await collapse.selectOption('never');
    await expect(page.locator('[data-level-star]')).toHaveCount(2);
    await collapse.selectOption('auto');
    await expect(page.locator('[data-level-star]')).toHaveCount(2);
    await page.evaluate(() => Reflect.get(window, 'remountView')());
    await expect(selector).toHaveValue('p:course');
    await expect(collapse).toHaveValue('auto');
    await expect(page.locator('[data-level-star]')).toHaveCount(2);
    await selector.selectOption('none');
    await expect(page.locator('[data-level-star]')).toHaveCount(0);
    const commands: { type: string; commandId?: string }[] = await page.evaluate(() => Reflect.get(window, 'viewCommands')());
    assert.ok(commands.every(command => ['describe_language', 'save_inline_level_scale', 'save_star_collapse'].includes(command.type)));
    const writes = commands.filter(command => command.type === 'save_inline_level_scale');
    assert.equal(writes.length, 4);
    assert.deepEqual(writes[0], writes[1]);
    assert.notEqual(writes[1].commandId, writes[2].commandId);
    assert.equal(commands.filter(command => command.type === 'save_star_collapse').length, 3);
    await expect(page.getByRole('button', { name: 'word: claimed known' })).toBeVisible();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
