import * as DocumentPicker from 'expo-document-picker';
import { File,Directory,Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { randomUUID } from 'expo-crypto';
import { createRuntimeClient, RuntimeError } from '@mlearn/runtime-client';
import type { Host } from './types';
import { captureAuthoredMedia } from './authoredMedia';
import type { PickedAuthoredMedia } from './authoredMedia';
import type { MaterialMediaKind } from '@mlearn/contracts';
import { createImageOcrHost } from './imageOcr';

export function createHost(): Host {
  const module = requireOptionalNativeModule<{
    execute(request: string): Promise<string>;
    cancelSourceOpen():Promise<void>;
    reserveMediaCapture(id:string):Promise<void>;
    importPickedMedia(uri:string,name:string):Promise<string>;
    importPickedDocument(uri:string,name:string):Promise<string>;
    documentImageUri(sourceId:string,resourceId:string):Promise<string>;
    ocrProviders():Promise<string>;
    reserveOcr(id:string):Promise<void>;
    recognizeImage(id:string,request:string):Promise<string>;
    cancelOcr(id:string):Promise<void>;
    imagePageUri(sourceId:string,resourceId:string,crop:string|null):Promise<string>;
    captureMedia(id:string,request:string):Promise<string>;
    cancelMediaCapture(id:string):Promise<void>;
    releaseMediaCapture(path:string):Promise<void>;
    authoredMediaUri(id:string):Promise<string>;
    exportAuthoredMedia(id:string):Promise<boolean>;
  }>('MlearnNative');
  if (!module) return { available: false, label: 'Native module unavailable', reason: 'Build the local Rust module with npm run prepare:ios or prepare:android, then run the native app. Expo Go does not contain this module.' };
  const pickerCache=new Map<string,Directory>();
  function releasePicked(path:string){const directory=pickerCache.get(path);if(directory){directory.delete();pickerCache.delete(path);}return Promise.resolve();}
  const pickAuthored=async(kind:MaterialMediaKind):Promise<PickedAuthoredMedia|null> => {
    const mime:Record<MaterialMediaKind,string>={image:'image/*',audio:'audio/*',video:'video/*'};
    const result=await DocumentPicker.getDocumentAsync({type:mime[kind],copyToCacheDirectory:false,multiple:false});
    if(result.canceled)return null;
    const asset=result.assets[0];
    if(!asset)throw new Error('The picker returned no media.');
    if(!asset.name||asset.name.length>255||/[\\/]/.test(asset.name)||asset.name==='.'||asset.name==='..'){
      throw new Error('The selected media has an invalid name.');
    }
    const path=await module.importPickedMedia(asset.uri,asset.name);
    return {path,name:asset.name,kind,release:()=>module.releaseMediaCapture(path)};
  };
  return { available: true, label: 'Expo native', documents:{
    supportsFolders:false,
    async pickImages(folder,signal){
      if(folder)throw new RuntimeError('unavailable','Select image files on this device; folder selection is not supported.');
      const result=await DocumentPicker.getDocumentAsync({type:'image/*',copyToCacheDirectory:false,multiple:true});
      if(result.canceled)return null;
      if(result.assets.length>128)throw new RuntimeError('invalid_request','Select at most 128 source images.');
      const directory=new Directory(Paths.cache,'mlearn-images',randomUUID());directory.create({intermediates:true});
      const paths:string[]=[];
      let total=0;
      const release=()=>{if(directory.exists)directory.delete();return Promise.resolve();};
      try {
        for(const [index,asset] of result.assets.entries()){
          if(signal?.aborted)throw new RuntimeError('cancelled','Image selection cancelled.');
          const staged=await module.importPickedDocument(asset.uri,asset.name);
          try {
            if(signal?.aborted)throw new RuntimeError('cancelled','Image selection cancelled.');
            const file=new File(`file://${staged.split('/').map(encodeURIComponent).join('/')}`);
            total+=file.size;
            if(total>64*1024*1024)throw new RuntimeError('invalid_request','Image collection exceeds its 64 MiB import limit.');
            const page=new Directory(directory,String(index).padStart(4,'0'));page.create();
            const destination=new File(page,asset.name);
            await file.move(destination);
            paths.push(decodeURIComponent(destination.uri.replace(/^file:\/\//,'')));
          } finally {await module.releaseMediaCapture(staged);}
        }
        return {paths,title:result.assets[0]?.name??'Image collection',release};
      } catch(cause){await release();throw cause;}
    },
    async pick(){
      const result=await DocumentPicker.getDocumentAsync({type:['text/plain','application/epub+zip','application/pdf'],copyToCacheDirectory:false,multiple:false});
      if(result.canceled)return null;
      const asset=result.assets[0];
      if(!asset)throw new Error('The picker returned no document.');
      return module.importPickedDocument(asset.uri,asset.name);
    },
    releasePicked:path=>module.releaseMediaCapture(path),
    // A data URI works inside Expo DOM's isolated WebView; native file URLs do not.
    // Resolve IDs again natively rather than allowing renderer-supplied file paths.
    uri:location=>module.documentImageUri(location.sourceId,location.resourceId),
  }, ocr:createImageOcrHost({
    providers:()=>module.ocrProviders(),
    reserve:id=>module.reserveOcr(id),
    recognize:(id,request)=>module.recognizeImage(id,JSON.stringify(request)),
    cancel:id=>module.cancelOcr(id),
    uri:(sourceId,resourceId,crop)=>module.imagePageUri(sourceId,resourceId,crop ? JSON.stringify(crop) : null),
  }), authoredMedia:{
    capture:captureAuthoredMedia({
      reserve:id=>module.reserveMediaCapture(id),
      capture:async(id,request)=>JSON.parse(await module.captureMedia(id,JSON.stringify(request))),
      cancel:id=>module.cancelMediaCapture(id),
      release:path=>module.releaseMediaCapture(path),
      commandId:randomUUID,
    }),
    pick:pickAuthored,
    uri:id=>module.authoredMediaUri(id),
    export:id=>module.exportAuthoredMedia(id),
  }, media:{
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
      try {const selected=cached;await selected.move(new File(directory,asset.name));const path=decodeURIComponent(selected.uri.replace(/^file:\/\//,''));pickerCache.set(path,directory);return path;}
      catch(error){directory.delete();if(cached.exists&&cached.uri.startsWith(Paths.cache.uri))cached.delete();throw error;}
    },
    uri:(source)=>new File(`file://${source.mediaPath.split('/').map(encodeURIComponent).join('/')}`).uri,
  }, client: createRuntimeClient({ execute: (request) => module.execute(request), cancelSourceOpen:()=>module.cancelSourceOpen(),commandId: randomUUID }) };
}
