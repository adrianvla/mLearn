import type { RuntimeClient } from '@mlearn/runtime-client';
import type { AuthoredMediaHost } from './authoredMedia';
import type { ImageOcrHost } from './imageOcr';
import type { OcrModelsHost } from './ocrModels';
export type PickedImageCollection = {
  readonly paths: string[];
  readonly title: string;
  readonly release: () => Promise<void>;
};
export type MediaHost = {subscribeDrop?:(handler:(paths:string[])=>void)=>Promise<()=>void>;pick(subtitles:boolean):Promise<string|null>;releasePicked(path:string):Promise<void>;uri(source:import("@mlearn/contracts").SourceRecord):string};
export type DocumentHost = {
  readonly supportsFolders: boolean;
  pickImages(folder: boolean, signal?: AbortSignal): Promise<PickedImageCollection|null>;
  pick():Promise<string|null>;
  releasePicked(path:string):Promise<void>;
  uri(location:import('@mlearn/contracts').DocumentResourceLocation):Promise<string>;
};
export type Host = { available: true; client: RuntimeClient; media:MediaHost; documents:DocumentHost; ocr:ImageOcrHost; authoredMedia:AuthoredMediaHost; label: string; windowControlsWidth?: number;
  copyText:(text:string)=>Promise<void>;
  ocrModels?: OcrModelsHost;
  initialTheme?: import('@mlearn/contracts').ThemeDocument;
  subscribeWindowMaterial?:(handler:(active:boolean)=>void)=>Promise<()=>void>;
} | { available: false; label: string; reason: string };
