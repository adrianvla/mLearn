import { isWatchResponse } from './watchProtocol';
import { createMaterialClient } from './materialClient';
import { createMaterialBulkClient } from './materialBulkClient';
import { createMaterialProposalClient } from './materialProposalClient';
import { createReviewClient } from './reviewClient';
import { createDocumentClient } from './documentClient';
import { createOcrClient } from './ocrClient';
import { createConversationClient } from './conversationClient';
import { createCollectionClient } from './collectionClient';
import { isMaterialResponse } from './materialProtocol';
import { isSourceAnchor } from './sourceProtocol';
import { RuntimeError } from './errors';
export { RuntimeError } from './errors';
export { isPackageInstallStatus } from './watchProtocol';
export { isOcrPage, isOcrProvider, isOcrRect, isOcrResponse } from './ocrProtocol';
import type { Request, Response, Snapshot, SourceAnchor, StarCollapse, ThemeDocument, KnowledgeKey, ClaimChange, InspectionTrigger, PackageInstallCommand, SubtitleDirection, SourceRecord } from '@mlearn/contracts';

export interface Transport {
  execute(request: string): Promise<string>;
  commandId(): string;
  cancelSourceOpen?():Promise<void>;
}

export function createRuntimeClient(transport: Transport) {
  let tail:Promise<void>=Promise.resolve();let pending=0;let searches=0;let sourceEpoch=0;let cancelInFlight:Promise<void>|null=null;
  type DisplayRead={readonly command:Request;readonly epoch:number;readonly queuedAt:number;readonly resolve:(value:Response)=>void;readonly reject:(reason:unknown)=>void};
  const analysis:{running:boolean;desired:DisplayRead|null}={running:false,desired:null};
  const windows:{running:boolean;desired:DisplayRead|null}={running:false,desired:null};
  const cancelled=()=>new RuntimeError('cancelled','Source work cancelled.');
  async function cancelSourceOpen(){
    sourceEpoch++;
    for(const lane of [analysis,windows]){lane.desired?.reject(cancelled());lane.desired=null;}
    if(!cancelInFlight)cancelInFlight=(transport.cancelSourceOpen?.()??Promise.resolve()).finally(()=>{cancelInFlight=null;});
    await cancelInFlight;
  }
  async function runDisplay(lane:typeof analysis,read:DisplayRead):Promise<void>{
    lane.running=true;
    try{
      if(cancelInFlight)await cancelInFlight;
      if(read.epoch!==sourceEpoch)throw cancelled();
      if(process.env.EXPO_PUBLIC_MLEARN_METRICS==='1')
        console.info(`runtime-queue operation=${read.command.type} elapsed_ms=${(performance.now()-read.queuedAt).toFixed(3)}`);
      const value=await execute(read.command);
      if(read.epoch!==sourceEpoch)throw cancelled();
      read.resolve(value);
    }catch(error){read.reject(error);}
    finally{
      const desired=lane.desired;lane.desired=null;
      if(desired)void runDisplay(lane,desired);else lane.running=false;
    }
  }
  function displayRead(command:Request):Promise<Response>{
    const lane=command.type==='analyze_source'||command.type==='analyze_transcript'||command.type==='analyze_document'||command.type==='analyze_ocr'
      ||command.type==='conversation'&&(command.command.action==='analyze_visible_messages'||command.command.action==='analyze_message_source')?analysis:windows;
    return new Promise((resolve,reject)=>{
      const read={command,epoch:sourceEpoch,queuedAt:performance.now(),resolve,reject};
      if(lane.running){lane.desired?.reject(cancelled());lane.desired=read;}
      else void runDisplay(lane,read);
    });
  }
  async function request(command:Request):Promise<Response>{
    if(command.type==='search_document'){
      // A stopped bounded read may still have an unacknowledged transport
      // receipt. Admit one replacement without blocking source/control work.
      if(searches>=2)throw new RuntimeError('busy','Source search reads are still pending; retry the search.');
      const epoch=sourceEpoch;searches++;
      try{
        if(cancelInFlight)await cancelInFlight;
        if(epoch!==sourceEpoch)throw cancelled();
        const value=await execute(command);
        if(epoch!==sourceEpoch)throw cancelled();
        return value;
      }finally{searches--;}
    }
    if(command.type==='analyze_source'||command.type==='analyze_transcript'||command.type==='analyze_document'||command.type==='analyze_ocr'||command.type==='source_window'||command.type==='document_window'
      ||command.type==='conversation'&&(command.command.action==='analyze_visible_messages'||command.command.action==='analyze_message_source'))return displayRead(command);
    if(pending>=8)throw new RuntimeError('busy','Native request queue is full; retry the action.');
    // A queued lookup must not acquire the replacement source's native epoch.
    // Durable claims/checkpoints remain admitted across source cancellation.
    const epoch=sourceEpoch;const sourceAction=['open_source','resume_source','open_document','resume_document','import_image_collection','image_page','read_ocr','ocr_evidence','postprocess_ocr','set_document_language','document_contents','document_resource','attach_subtitles','set_source_language','inspect_target','inspect_targets','return_material_source','return_material_proposal_source','return_review_source','return_source_anchor'].includes(command.type);
    const queuedAt=performance.now();
    pending++;const previous=tail;let release=()=>{};tail=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    if(process.env.EXPO_PUBLIC_MLEARN_METRICS==='1')
      console.info(`runtime-queue operation=${command.type} elapsed_ms=${(performance.now()-queuedAt).toFixed(3)}`);
    try{if(sourceAction&&cancelInFlight)await cancelInFlight;if(sourceAction&&epoch!==sourceEpoch)throw new RuntimeError('cancelled','Source opening cancelled.');const value=await execute(command);if(sourceAction&&epoch!==sourceEpoch)throw new RuntimeError('cancelled','Source opening cancelled.');return value;}finally{pending--;release();}
  }
  async function execute(command: Request): Promise<Response> {
    const started = performance.now();
    const raw = await transport.execute(JSON.stringify(command));
    if (process.env.EXPO_PUBLIC_MLEARN_METRICS === '1')
      console.info(`runtime-transport operation=${command.type} elapsed_ms=${(performance.now() - started).toFixed(3)}`);
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
  function prepareInstall(pluginId:string):PackageInstallCommand {
    return {pluginId,commandId:transport.commandId()};
  }
  async function installPackage(command:PackageInstallCommand) {
    const response=await execute({type:'install_package',command});
    if(!isWatchResponse(response)||response.type!=='installed')throw new RuntimeError('protocol','Missing plugin installation receipt.');
    return response.plugin;
  }
  async function packageInstallControl(type:'package_install_status'|'cancel_package_install',commandId:string) {
    // Control reads must not queue behind the transfer whose body is pending.
    const response=await execute({type,commandId});
    if(!isWatchResponse(response)||response.type!=='package_install_status')throw new RuntimeError('protocol','Malformed package install status.');
    if(response.status!==null&&response.status.command.commandId!==commandId)throw new RuntimeError('protocol','Mismatched package install identity.');
    return response.status;
  }
  return {
    ...createCollectionClient(request, () => transport.commandId(), execute),
    ...createConversationClient(request, () => transport.commandId(), execute),
    ...createMaterialClient(request, () => transport.commandId()),
    ...createMaterialBulkClient(execute, () => transport.commandId()),
    ...createMaterialProposalClient(request, () => transport.commandId(), execute),
    ...createReviewClient(request, () => transport.commandId()),
    ...createDocumentClient(request),
    ...createOcrClient(request, () => transport.commandId()),
    async returnSourceAnchor(anchor: SourceAnchor) {
      const original = structuredClone(anchor);
      if (!isSourceAnchor(original)) throw new RuntimeError('invalid_request', 'Choose a valid original source span.');
      const response = await request({ type: 'return_source_anchor', anchor: original });
      if (!isMaterialResponse(response) || response.type !== 'material_source' && response.type !== 'document_material_source'
        && response.type !== 'image_material_source' && response.type !== 'conversation_material_source')
        throw new RuntimeError('protocol', 'Malformed source return response.');
      const returned = response.anchor;
      if (returned.sourceId !== original.sourceId || returned.contentRevision !== original.contentRevision
        || returned.packageId !== original.packageId || returned.packageVersion !== original.packageVersion
        || returned.text !== original.text
        || JSON.stringify(Object.entries(returned.locator).sort(([a], [b]) => a.localeCompare(b)))
          !== JSON.stringify(Object.entries(original.locator).sort(([a], [b]) => a.localeCompare(b))))
        throw new RuntimeError('protocol', 'Source return changed the requested original span.');
      return response;
    },
    prepareInstall,
    installPackage,
    packageInstallStatus:(commandId:string)=>packageInstallControl('package_install_status',commandId),
    cancelPackageInstall:(commandId:string)=>packageInstallControl('cancel_package_install',commandId),
    async currentPackageInstall(){
      const response=await execute({type:'current_package_install'});
      if(!isWatchResponse(response)||response.type!=='package_install_status')throw new RuntimeError('protocol','Malformed current package install status.');
      return response.status;
    },
    cancelSourceOpen,
    beginSourceSession(){
      const ready=cancelSourceOpen();const epoch=sourceEpoch;
      return {ready,isCurrent:()=>epoch===sourceEpoch,cancel:()=>epoch===sourceEpoch?cancelSourceOpen():Promise.resolve()};
    },
    async recentSources(){ const r=await watch({type:'recent_sources'}); if(r.type!=='sources')throw new RuntimeError('protocol','Missing sources'); return r.sources; },
    async availablePackages(){const r=await watch({type:'available_packages'});if(r.type!=='packages')throw new RuntimeError('protocol','Missing catalog');return r.plugins;},
    async openSource(path:string,packageId:string){const r=await watch({type:'open_source',path,packageId});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async resumeSource(sourceId:string){const r=await watch({type:'resume_source',sourceId});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async attachSubtitles(sourceId:string,path:string){const r=await watch({type:'attach_subtitles',sourceId,path});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async sourceWindow(sourceId:string,positionMs:number){const r=await watch({type:'source_window',sourceId,positionMs});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async transcript(sourceId:string,afterIndex:number|null,query:string){const r=await watch({type:'transcript',sourceId,afterIndex,query});if(r.type!=='transcript')throw new RuntimeError('protocol','Missing transcript');return r.page;},
    async cuePosition(sourceId:string,subtitleRevision:string,cueIndex:number){
      const r=await watch({type:'cue_position',sourceId,subtitleRevision,cueIndex});
      if(r.type!=='cue_position'||r.position.sourceId!==sourceId||r.position.subtitleRevision!==subtitleRevision||r.position.cueIndex!==cueIndex)throw new RuntimeError('protocol','Mismatched subtitle cue position.');
      return r.position.positionMs;
    },
    async setSubtitleOffset(sourceId:string,offsetMs:number){const r=await watch({type:'set_subtitle_offset',sourceId,offsetMs});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    prepareSubtitleAlignment(source:SourceRecord,positionMs:number,direction:SubtitleDirection):Extract<Request,{type:'align_subtitle_offset'}>{
      if(source.subtitleRevision===null)throw new RuntimeError('invalid_request','Select subtitles before adjusting synchronization.');
      return {type:'align_subtitle_offset',sourceId:source.id,subtitleRevision:source.subtitleRevision,
        expectedOffsetRevision:source.subtitleOffsetRevision,positionMs:Math.round(positionMs),direction};
    },
    async alignSubtitleOffset(command:Extract<Request,{type:'align_subtitle_offset'}>){
      const r=await watch(command);
      if(r.type!=='source'||r.window.source.id!==command.sourceId||r.window.source.subtitleRevision!==command.subtitleRevision
        ||r.window.source.subtitleOffsetRevision!==command.expectedOffsetRevision+1)
        throw new RuntimeError('protocol','Mismatched subtitle alignment');
      return r.window;
    },
    async setPlaybackRate(sourceId:string,rate:number){const r=await watch({type:'set_playback_rate',sourceId,rate});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async setInspectionTrigger(sourceId:string,trigger:InspectionTrigger){const r=await watch({type:'set_inspection_trigger',sourceId,trigger});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async setSourceLanguage(sourceId:string,packageId:string){const r=await watch({type:'set_source_language',sourceId,packageId});if(r.type!=='source')throw new RuntimeError('protocol','Missing source');return r.window;},
    async savePosition(sourceId:string,positionMs:number,durationMs:number){const r=await watch({type:'save_position',sourceId,positionMs:Math.round(positionMs),durationMs:Math.round(durationMs)});if(r.type!=='position_saved')throw new RuntimeError('protocol','Missing position receipt');},
    async analyzeSource(sourceId:string,positionMs:number){const r=await watch({type:'analyze_source',sourceId,positionMs});if(r.type!=='analysis')throw new RuntimeError('protocol','Missing analysis');return r.batch;},
    async analyzeTranscript(sourceId:string,afterIndex:number|null,query:string){const r=await watch({type:'analyze_transcript',sourceId,afterIndex,query});if(r.type!=='analysis')throw new RuntimeError('protocol','Missing transcript analysis');return r.batch;},
    async describeLanguage(packageId:string){const r=await watch({type:'describe_language',packageId});if(r.type!=='language')throw new RuntimeError('protocol','Missing language description');return r.description;},
    async inspectTarget(packageId:string,targetId:string,expectedRevision:string|null=null){const r=await watch({type:'inspect_target',packageId,targetId,expectedRevision});if(r.type!=='entry'||r.entry.targetId!==targetId||expectedRevision!==null&&r.packageRevision!==expectedRevision)throw new RuntimeError('protocol','Mismatched inspected entry');return r;},
    async inspectTargets(sourceId:string,subtitleRevision:string,packageRevision:string,targetIds:string[]){
      const r=await watch({type:'inspect_targets',sourceId,subtitleRevision,packageRevision,targetIds});
      if(r.type!=='dictionary'||r.batch.sourceId!==sourceId||r.batch.subtitleRevision!==subtitleRevision||r.batch.packageRevision!==packageRevision
        ||r.batch.items.length!==targetIds.length||r.batch.items.some((item,index)=>(item.state==='available'?item.summary.targetId:item.targetId)!==targetIds[index]))
        throw new RuntimeError('protocol','Mismatched dictionary batch');
      return r.batch;
    },
    async knowledge(keys:KnowledgeKey[]){const r=await watch({type:'knowledge',keys});if(r.type!=='knowledge')throw new RuntimeError('protocol','Missing Knowledge');return r.projections;},
    prepareClaim(key:KnowledgeKey,claim:boolean|null):ClaimChange{return {key,claim,commandId:transport.commandId()};},
    async changeClaim(change:ClaimChange){const r=await watch({type:'change_claim',change});if(r.type!=='claim_changed')throw new RuntimeError('protocol','Missing claim receipt');return r.projection;},
    async snapshot(): Promise<Snapshot> {
      const response = await request({ type: 'snapshot' });
      if (response.type !== 'snapshot' || response.snapshot.protocolVersion !== 1) throw new RuntimeError('protocol', 'Unsupported native protocol.');
      const view=response.snapshot.viewPreferences;
      if(view!==undefined&&view!==null&&(!Number.isInteger(view.revision)||view.revision<0||view.revision>4294967295
        ||!['auto','always','never'].includes(view.starCollapse)
        ||view.inlineLevelScale!==null&&(typeof view.inlineLevelScale!=='string'||view.inlineLevelScale.length>512||!view.inlineLevelScale.includes(':'))))
        throw new RuntimeError('protocol','Malformed native view preferences.');
      return response.snapshot;
    },
    prepareInlineLevelScale(scaleId:string|null,expectedRevision:number):Extract<Request,{type:'save_inline_level_scale'}> {
      return {type:'save_inline_level_scale',scaleId,expectedRevision,commandId:transport.commandId()};
    },
    async saveInlineLevelScale(command:Extract<Request,{type:'save_inline_level_scale'}>):Promise<number> {
      const response=await request(command);
      if(response.type!=='saved'||!Number.isInteger(response.revision)||response.revision!==command.expectedRevision+1)
        throw new RuntimeError('protocol','Missing view preference commit receipt.');
      return response.revision;
    },
    prepareStarCollapse(collapse:StarCollapse,expectedRevision:number):Extract<Request,{type:'save_star_collapse'}> {
      return {type:'save_star_collapse',collapse,expectedRevision,commandId:transport.commandId()};
    },
    async saveStarCollapse(command:Extract<Request,{type:'save_star_collapse'}>):Promise<number> {
      const response=await request(command);
      if(response.type!=='saved'||!Number.isInteger(response.revision)||response.revision!==command.expectedRevision+1)
        throw new RuntimeError('protocol','Missing view preference commit receipt.');
      return response.revision;
    },
    async saveTheme(document: ThemeDocument, expectedRevision: number): Promise<number> {
      const response = await request({ type: 'save_theme', document, expectedRevision, commandId: transport.commandId() });
      if (response.type !== 'saved') throw new RuntimeError('protocol', 'Missing settings commit receipt.');
      return response.revision;
    },
    async installPlugin(pluginId: string) {
      return installPackage(prepareInstall(pluginId));
    },
    async invokePlugin(pluginId: string, capability: string, input: unknown): Promise<unknown> {
      const response = await request({ type: 'invoke_plugin', pluginId, capability, input });
      if (response.type !== 'plugin_result') throw new RuntimeError('protocol', 'Missing plugin result.');
      return response.output;
    },
  };
}
export type RuntimeClient = ReturnType<typeof createRuntimeClient>;
