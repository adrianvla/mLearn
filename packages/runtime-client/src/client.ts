import { isWatchResponse } from './watchProtocol';
import type { Request, Response, Snapshot, ThemeDocument, KnowledgeKey, ClaimChange } from '@mlearn/contracts';

export interface Transport {
  execute(request: string): Promise<string>;
  commandId(): string;
  cancelSourceOpen?():Promise<void>;
}
export class RuntimeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'RuntimeError'; }
}

export function createRuntimeClient(transport: Transport) {
  let tail:Promise<void>=Promise.resolve();let pending=0;let sourceEpoch=0;let cancelInFlight:Promise<void>|null=null;
  async function request(command:Request):Promise<Response>{
    if(pending>=8)throw new RuntimeError('busy','Native request queue is full; retry the action.');
    const epoch=sourceEpoch;const sourceAction=['open_source','resume_source','attach_subtitles'].includes(command.type);
    pending++;const previous=tail;let release=()=>{};tail=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try{if(sourceAction&&cancelInFlight)await cancelInFlight;if(sourceAction&&epoch!==sourceEpoch)throw new RuntimeError('cancelled','Source opening cancelled.');const value=await execute(command);if(sourceAction&&epoch!==sourceEpoch)throw new RuntimeError('cancelled','Source opening cancelled.');return value;}finally{pending--;release();}
  }
  async function execute(command: Request): Promise<Response> {
    const raw = await transport.execute(JSON.stringify(command));
    if (raw.length > 524_288) throw new RuntimeError('protocol', 'Native response exceeds the message limit.');
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') throw new RuntimeError('protocol', 'Malformed native response.');
    const response = value as Response;
    if (response.type === 'error') throw new RuntimeError(response.code, response.message);
    return response;
  }
  async function watch(command:Request) {
    const response=await request(command);
    if(!isWatchResponse(response))throw new RuntimeError('protocol','Malformed bounded native response.');
    return response;
  }
  return {
    async cancelSourceOpen(){sourceEpoch++;if(!cancelInFlight)cancelInFlight=(transport.cancelSourceOpen?.()??Promise.resolve()).finally(()=>{cancelInFlight=null;});await cancelInFlight;},
    async recentSources(){ const r=await watch({type:'recent_sources'}); if(r.type!=='sources')throw new RuntimeError('protocol','Missing sources'); return r.sources; },
    async availablePackages(){const r=await watch({type:'available_packages'});if(r.type!=='packages')throw new RuntimeError('protocol','Missing catalog');return r.plugins;},
    async openSource(path:string,packageId:string){const r=await watch({type:'open_source',path,packageId});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async resumeSource(sourceId:string){const r=await watch({type:'resume_source',sourceId});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async attachSubtitles(sourceId:string,path:string){const r=await watch({type:'attach_subtitles',sourceId,path});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async sourceWindow(sourceId:string,positionMs:number){const r=await watch({type:'source_window',sourceId,positionMs});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async savePosition(sourceId:string,positionMs:number,durationMs:number){const r=await watch({type:'save_position',sourceId,positionMs:Math.round(positionMs),durationMs:Math.round(durationMs)});if(r.type!=='position_saved')throw new RuntimeError('protocol','Missing position receipt');},
    async analyzeSource(sourceId:string,positionMs:number){const r=await watch({type:'analyze_source',sourceId,positionMs});if(r.type!=='analysis')throw new RuntimeError('protocol','Missing analysis');return r.batch;},
    async describeLanguage(packageId:string){const r=await watch({type:'describe_language',packageId});if(r.type!=='language')throw new RuntimeError('protocol','Missing language description');return r.description;},
    async inspectTarget(packageId:string,targetId:string){const r=await watch({type:'inspect_target',packageId,targetId});if(r.type!=='entry')throw new RuntimeError('protocol','Missing entry');return r.entry;},
    async knowledge(keys:KnowledgeKey[]){const r=await watch({type:'knowledge',keys});if(r.type!=='knowledge')throw new RuntimeError('protocol','Missing Knowledge');return r.projections;},
    prepareClaim(key:KnowledgeKey,claim:boolean|null):ClaimChange{return {key,claim,commandId:transport.commandId()};},
    async changeClaim(change:ClaimChange){const r=await watch({type:'change_claim',change});if(r.type!=='claim_changed')throw new RuntimeError('protocol','Missing claim receipt');return r.projection;},
    async snapshot(): Promise<Snapshot> {
      const response = await request({ type: 'snapshot' });
      if (response.type !== 'snapshot' || response.snapshot.protocolVersion !== 1) throw new RuntimeError('protocol', 'Unsupported native protocol.');
      return response.snapshot;
    },
    async saveTheme(document: ThemeDocument, expectedRevision: number): Promise<number> {
      const response = await request({ type: 'save_theme', document, expectedRevision, commandId: transport.commandId() });
      if (response.type !== 'saved') throw new RuntimeError('protocol', 'Missing settings commit receipt.');
      return response.revision;
    },
    async installPlugin(pluginId: string) {
      const response = await request({ type: 'install_plugin', pluginId });
      if (response.type !== 'installed') throw new RuntimeError('protocol', 'Missing plugin installation receipt.');
      return response.plugin;
    },
    async invokePlugin(pluginId: string, capability: string, input: unknown): Promise<unknown> {
      const response = await request({ type: 'invoke_plugin', pluginId, capability, input });
      if (response.type !== 'plugin_result') throw new RuntimeError('protocol', 'Missing plugin result.');
      return response.output;
    },
  };
}
export type RuntimeClient = ReturnType<typeof createRuntimeClient>;
