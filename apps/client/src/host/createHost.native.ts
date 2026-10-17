import * as DocumentPicker from 'expo-document-picker';
import { File,Directory,Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { randomUUID } from 'expo-crypto';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Host } from './types';

export function createHost(): Host {
  const module = requireOptionalNativeModule<{ execute(request: string): Promise<string>;cancelSourceOpen():Promise<void> }>('MlearnNative');
  if (!module) return { available: false, label: 'Native module unavailable', reason: 'Build the local Rust module with npm run prepare:ios or prepare:android, then run the native app. Expo Go does not contain this module.' };
  const pickerCache=new Map<string,Directory>();
  function releasePicked(path:string){const directory=pickerCache.get(path);if(directory){directory.delete();pickerCache.delete(path);}return Promise.resolve();}
  return { available: true, label: 'Expo native', media:{
    releasePicked,
    async pick(subtitles){
      for(const pending of pickerCache.keys())await releasePicked(pending);
      const result=await DocumentPicker.getDocumentAsync({type:subtitles?'*/*':'video/*',copyToCacheDirectory:true,multiple:false});
      if(result.canceled)return null;
      const asset=result.assets[0];const cached=new File(asset.uri);
      if(!cached.uri.startsWith(Paths.cache.uri))throw new Error('The picker did not return an isolated cache copy. Please select the file again.');
      if(!asset.name||asset.name.length>255||/[\\/]/.test(asset.name)||asset.name==='.'||asset.name==='..'){cached.delete();throw new Error('The selected file has an invalid name.');}
      // DocumentPicker owns a cache copy. Move it into one owned selection directory
      // so Rust sees the real filename rather than the provider's UUID cache name.
      const directory=new Directory(Paths.cache,'mlearn-picker',randomUUID());directory.create({intermediates:true});
      try {const selected=cached;selected.move(new File(directory,asset.name));const path=decodeURIComponent(selected.uri.replace(/^file:\/\//,''));pickerCache.set(path,directory);return path;}
      catch(error){directory.delete();if(cached.exists&&cached.uri.startsWith(Paths.cache.uri))cached.delete();throw error;}
    },
    uri:(source)=>new File(`file://${source.mediaPath.split('/').map(encodeURIComponent).join('/')}`).uri,
  }, client: createRuntimeClient({ execute: (request) => module.execute(request), cancelSourceOpen:()=>module.cancelSourceOpen(),commandId: randomUUID }) };
}
