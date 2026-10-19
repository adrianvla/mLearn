import type { Response } from '@mlearn/contracts';
type RecordValue = Record<string, unknown>;
function object(v: unknown): v is RecordValue { return !!v && typeof v === 'object' && !Array.isArray(v); }
const string = (v: unknown): v is string => typeof v === 'string' && v.length <= 32768;
const integer = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 4294967295;
const optionalString = (v: unknown) => v === null || string(v);
const optionalBoolean = (v: unknown) => v === null || typeof v === 'boolean';
function list(v: unknown, limit: number, guard: (v: unknown) => boolean): boolean { return Array.isArray(v) && v.length <= limit && v.every(guard); }
function source(v: unknown): boolean { return object(v) && ['id','title','mediaPath','mediaRevision','packageId','packageVersion'].every(k=>string(v[k])) && optionalString(v.subtitlePath) && optionalString(v.subtitleRevision) && integer(v.positionMs) && integer(v.durationMs) && Number.isInteger(v.subtitleOffsetMs) && Math.abs(Number(v.subtitleOffsetMs))<=86400000 && typeof v.playbackRate==='number' && v.playbackRate>=0.5 && v.playbackRate<=2 && typeof v.inspectionTrigger==='string' && ['click','immediate','delayed','modifier'].includes(v.inspectionTrigger); }
function cue(v: unknown): boolean { return object(v) && integer(v.index) && integer(v.startMs) && integer(v.endMs) && Number(v.endMs)>Number(v.startMs) && string(v.text); }
function capability(v: unknown): boolean { return object(v) && string(v.id) && string(v.label); }
function key(v: unknown): boolean { return object(v) && string(v.packageId) && string(v.targetId) && string(v.capability); }
function projection(v: unknown): boolean { return object(v) && key(v.key) && optionalBoolean(v.claim) && optionalBoolean(v.assessed) && (v.prediction===null || typeof v.prediction==='number' && Number.isFinite(v.prediction)) && integer(v.revision) && string(v.status); }
function plugin(v: unknown): boolean { return object(v) && string(v.id) && string(v.version) && list(v.capabilities,64,string); }
function installStatus(v: unknown): boolean {
 if(!object(v)||!object(v.command)||!string(v.command.commandId)||v.command.commandId.length<1||v.command.commandId.length>128||!string(v.command.pluginId)||v.command.pluginId.length<1||v.command.pluginId.length>128)return false;
 if(!integer(v.downloadedBytes)||v.downloadedBytes>272629760||!optionalString(v.message)||(typeof v.message==='string'&&v.message.length>2048))return false;
 if(v.totalBytes===null){if(v.downloadedBytes!==0)return false;}
 else if(!integer(v.totalBytes)||v.totalBytes>272629760||v.downloadedBytes>v.totalBytes)return false;
 switch(v.phase){
 case 'downloading':case 'failed':case 'cancelled':return true;
 case 'validating':case 'succeeded':return v.totalBytes!==null&&v.downloadedBytes===v.totalBytes;
 default:return false;
 }
}
function token(v: unknown): boolean { return object(v) && integer(v.start) && integer(v.end) && Number(v.end)>Number(v.start) && string(v.text) && list(v.targets,128,string); }
function sense(v: unknown): boolean {
 return object(v) && string(v.heading) && list(v.labels,32,string) && list(v.notes,32,string)
  && list(v.definitions,128,string) && Array.isArray(v.definitions) && v.definitions.length>0;
}
/** Structure validation at the native JSON transport boundary, not a TypeScript cast. */
export function isWatchResponse(v: unknown): v is Response {
 if(!object(v))return false;
 switch(v.type){
 case 'sources':return list(v.sources,20,source);
 case 'packages':return list(v.plugins,64,plugin);
 case 'installed':return plugin(v.plugin);
 case 'package_install_status':return v.status===null||installStatus(v.status);
 case 'source':return object(v.window) && source(v.window.source) && integer(v.window.totalCues) && list(v.window.cues,16,cue);
 case 'transcript':return object(v.page) && string(v.page.sourceId) && string(v.page.subtitleRevision) && list(v.page.cues,16,cue) && (v.page.nextIndex===null||integer(v.page.nextIndex));
 case 'cue_position':return object(v.position) && string(v.position.sourceId) && string(v.position.subtitleRevision) && integer(v.position.cueIndex) && integer(v.position.positionMs);
 case 'position_saved':return true;
 case 'language':return object(v.description) && string(v.description.language) && string(v.description.label) && string(v.description.annotationCapability) && string(v.description.attribution) && list(v.description.capabilities,8,capability);
 case 'entry':return object(v.entry) && ['targetId','headword','partOfSpeech','definition','attribution'].every(k=>string((v.entry as RecordValue)[k])) && optionalString(v.entry.reading) && optionalString(v.entry.summary) && (v.entry.senses===null || list(v.entry.senses,128,sense) && Array.isArray(v.entry.senses) && v.entry.senses.length>0) && list(v.entry.capabilities,8,capability);
 case 'knowledge':return list(v.projections,256,projection);
 case 'claim_changed':return projection(v.projection);
 case 'analysis':return object(v.batch) && ['sourceId','subtitleRevision','packageId','packageVersion'].every(k=>string((v.batch as RecordValue)[k])) && list(v.batch.knowledge,256,projection) && list(v.batch.annotations,8192,a=>object(a)&&integer(a.cueIndex)&&integer(a.tokenStart)&&string(a.status)) && list(v.batch.cues,16,a=>object(a)&&cue(a.cue)&&list(a.tokens,512,token));
 default:return false;
 }
}
