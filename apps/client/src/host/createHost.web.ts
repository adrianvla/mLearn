import {getCurrentWebview} from '@tauri-apps/api/webview';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ThemeDocument } from '@mlearn/contracts';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Host } from './types';
import { windowControlsWidth } from './WindowChrome';

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
