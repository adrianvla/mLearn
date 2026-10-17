import {getCurrentWebview} from '@tauri-apps/api/webview';
import { invoke, isTauri, convertFileSrc } from '@tauri-apps/api/core';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Host } from './types';

export function createHost(): Host {
  if (!isTauri()) return { available: false, label: 'Browser preview', reason: 'The browser preview has no native runtime. Open Tauri or an Expo development build to save settings and execute plugins.' };
  return {
    available: true,
    label: 'Tauri desktop',
    media:{subscribeDrop:handler=>getCurrentWebview().onDragDropEvent(event=>{if(event.payload.type==='drop')handler(event.payload.paths);}),releasePicked:async()=>{},pick:(subtitles)=>invoke<string|null>('pick_local_file',{subtitles}),uri:(source)=>convertFileSrc(source.id,'mlearn-media')},
    client: createRuntimeClient({ execute: (request) => invoke<string>('runtime_execute', { request }), cancelSourceOpen:()=>invoke<void>('cancel_source_open'),commandId: () => crypto.randomUUID() }),
  };
}
