import {getCurrentWebview} from '@tauri-apps/api/webview';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Host } from './types';
import { windowControlsWidth } from './WindowChrome';

declare global {
  interface Window {
    readonly __MLEARN_MEDIA_BASE__?: string;
  }
}

export function createHost(): Host {
  if (!isTauri()) return { available: false, label: 'Browser preview', reason: 'The browser preview has no native runtime. Open Tauri or an Expo development build to save settings and execute plugins.' };
  const mediaBase = window.__MLEARN_MEDIA_BASE__;
  if (!mediaBase) throw new Error('Desktop media transport was not initialized');
  return {
    available: true,
    label: 'Tauri desktop',
    windowControlsWidth,
    windowMaterial: windowControlsWidth > 0,
    media:{subscribeDrop:handler=>getCurrentWebview().onDragDropEvent(event=>{if(event.payload.type==='drop')handler(event.payload.paths);}),releasePicked:async()=>{},pick:(subtitles)=>invoke<string|null>('pick_local_file',{subtitles}),uri:(source)=>`${mediaBase}${encodeURIComponent(source.id)}`},
    client: createRuntimeClient({ execute: (request) => invoke<string>('runtime_execute', { request }), cancelSourceOpen:()=>invoke<void>('cancel_source_open'),commandId: () => crypto.randomUUID() }),
  };
}
