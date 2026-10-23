import {getCurrentWebview} from '@tauri-apps/api/webview';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ThemeDocument } from '@mlearn/contracts';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Host } from './types';
import { windowControlsWidth } from './WindowChrome';
import { captureAuthoredMedia } from './authoredMedia';
import type { MaterialMediaKind } from '@mlearn/contracts';
import { createImageOcrHost } from './imageOcr';
import { RuntimeError } from '@mlearn/runtime-client';
import { createOcrModelsHost } from './ocrModels';

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
    documents:{
      supportsFolders:true,
      async pickImages(folder,signal){
        const value=await invoke<unknown>('pick_images',{folder});
        if(signal?.aborted)throw new RuntimeError('cancelled','Image selection cancelled.');
        if(value===null)return null;
        if(!value||typeof value!=='object'||!('paths'in value)||!Array.isArray(value.paths)||value.paths.length>128
          ||!value.paths.every((path:unknown)=>typeof path==='string'&&path.length>0&&path.length<=4096)
          ||!('title'in value)||typeof value.title!=='string')
          throw new RuntimeError('protocol','Malformed selected image collection.');
        return {paths:value.paths,title:value.title,release:()=>Promise.resolve()};
      },
      pick:()=>invoke<string|null>('pick_document'),
      releasePicked:path=>invoke<void>('release_media_capture',{path}),
      uri:location=>invoke<string>('document_image_uri',{sourceId:location.sourceId,resourceId:location.resourceId}),
    },
    ocr:createImageOcrHost({
      providers:()=>invoke<unknown>('ocr_providers'),
      reserve:jobId=>invoke<void>('reserve_ocr',{jobId}),
      recognize:(jobId,request)=>invoke<unknown>('recognize_image',{jobId,request}),
      cancel:jobId=>invoke<void>('cancel_ocr',{jobId}),
      uri:(sourceId,resourceId,crop)=>invoke<string>('image_page_uri',{sourceId,resourceId,crop:crop ?? null}),
    }),
    ocrModels: createOcrModelsHost((command, args) => invoke<unknown>(command, args)),
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
