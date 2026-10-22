import {getCurrentWebview} from '@tauri-apps/api/webview';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ThemeDocument } from '@mlearn/contracts';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Host } from './types';
import { windowControlsWidth } from './WindowChrome';
import { captureAuthoredMedia } from './authoredMedia';
import type { MaterialMediaKind } from '@mlearn/contracts';

declare global {
  interface Window {
    readonly __MLEARN_MEDIA_BASE__?: string;
    readonly __MLEARN_INITIAL_THEME__?: ThemeDocument;
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
    initialTheme: window.__MLEARN_INITIAL_THEME__,
    authoredMedia:{
      capture:captureAuthoredMedia({
        reserve:jobId=>invoke<void>('reserve_media_capture',{jobId}),
        capture:(jobId,request)=>invoke<unknown>('capture_media',{jobId,request}),
        cancel:jobId=>invoke<void>('cancel_media_capture',{jobId}),
        release:path=>invoke<void>('release_media_capture',{path}),
        commandId:()=>crypto.randomUUID(),
      }),
      async pick(kind){
        const picked=await invoke<{path:string;name:string;kind:MaterialMediaKind}|null>('pick_authored_media',{kind});
        return picked?{...picked,release:()=>invoke<void>('release_media_capture',{path:picked.path})}:null;
      },
      uri:id=>invoke<string>('authored_media_uri',{id}),
      export:id=>invoke<boolean>('export_authored_media',{id}),
    },
    subscribeWindowMaterial: async handler => {
      let receivedEvent = false;
      const stop = await listen<boolean>('window-material-changed', event => {
        receivedEvent = true;
        handler(event.payload);
      });
      try {
        const active = await invoke<boolean>('window_material_active');
        // A newer native transition can arrive while the initial read is in flight.
        if (!receivedEvent) handler(active);
      } catch (error) {
        stop();
        throw error;
      }
      return stop;
    },
    media:{subscribeDrop:handler=>getCurrentWebview().onDragDropEvent(event=>{if(event.payload.type==='drop')handler(event.payload.paths);}),releasePicked:async()=>{},pick:(subtitles)=>invoke<string|null>('pick_local_file',{subtitles}),uri:(source)=>`${mediaBase}${encodeURIComponent(source.id)}`},
    client: createRuntimeClient({ execute: (request) => invoke<string>('runtime_execute', { request }), cancelSourceOpen:()=>invoke<void>('cancel_source_open'),commandId: () => crypto.randomUUID() }),
  };
}
