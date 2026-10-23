import type { RuntimeClient } from '@mlearn/runtime-client';
import type { AuthoredMediaHost } from './authoredMedia';
export type MediaHost = {subscribeDrop?:(handler:(paths:string[])=>void)=>Promise<()=>void>;pick(subtitles:boolean):Promise<string|null>;releasePicked(path:string):Promise<void>;uri(source:import("@mlearn/contracts").SourceRecord):string};
export type DocumentHost = {
  pick():Promise<string|null>;
  releasePicked(path:string):Promise<void>;
  uri(location:import('@mlearn/contracts').DocumentResourceLocation):Promise<string>;
};
export type Host = { available: true; client: RuntimeClient; media:MediaHost; documents:DocumentHost; authoredMedia:AuthoredMediaHost; label: string; windowControlsWidth?: number;
  initialTheme?: import('@mlearn/contracts').ThemeDocument;
  subscribeWindowMaterial?:(handler:(active:boolean)=>void)=>Promise<()=>void>;
} | { available: false; label: string; reason: string };
