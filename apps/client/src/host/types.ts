import type { RuntimeClient } from '@mlearn/runtime-client';
export type MediaHost = {subscribeDrop?:(handler:(paths:string[])=>void)=>Promise<()=>void>;pick(subtitles:boolean):Promise<string|null>;releasePicked(path:string):Promise<void>;uri(source:import("@mlearn/contracts").SourceRecord):string};
export type Host = { available: true; client: RuntimeClient; media:MediaHost; label: string; windowControlsWidth?: number;
  initialTheme?: import('@mlearn/contracts').ThemeDocument;
  subscribeWindowMaterial?:(handler:(active:boolean)=>void)=>Promise<()=>void>;
} | { available: false; label: string; reason: string };
