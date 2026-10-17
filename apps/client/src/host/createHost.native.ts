import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { randomUUID } from 'expo-crypto';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Host } from './types';

export function createHost(): Host {
  const module = requireOptionalNativeModule<{ execute(request: string): Promise<string>;cancelSourceOpen():Promise<void> }>('MlearnNative');
  if (!module) return { available: false, label: 'Native module unavailable', reason: 'Build the local Rust module with npm run prepare:ios or prepare:android, then run the native app. Expo Go does not contain this module.' };
  const pickerCache=new Map<string,string>();
  function releasePicked(path:string){const uri=pickerCache.get(path);if(uri){new File(uri).delete();pickerCache.delete(path);}return Promise.resolve();}
  return { available: true, label: 'Expo native', media:{
    releasePicked,
    async pick(subtitles){
      for(const pending of pickerCache.keys())await releasePicked(pending);
      const result=await DocumentPicker.getDocumentAsync({type:subtitles?'*/*':'video/*',copyToCacheDirectory:true,multiple:false});
      if(result.canceled)return null;
      const uri=result.assets[0].uri;const path=decodeURIComponent(uri.replace(/^file:\/\//,''));pickerCache.set(path,uri);return path;
    },
    uri:(source)=>new File(source.mediaPath).uri,
  }, client: createRuntimeClient({ execute: (request) => module.execute(request), cancelSourceOpen:()=>module.cancelSourceOpen(),commandId: randomUUID }) };
}
