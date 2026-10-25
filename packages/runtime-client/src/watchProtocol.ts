import type { AnalyzedToken, PackageInstallStatus, Response } from '@mlearn/contracts';
type RecordValue = Record<string, unknown>;
function object(v: unknown): v is RecordValue { return !!v && typeof v === 'object' && !Array.isArray(v); }
const string = (v: unknown): v is string => typeof v === 'string' && v.length <= 32768;
const integer = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 4294967295;
const optionalString = (v: unknown) => v === null || string(v);
const optionalBoolean = (v: unknown) => v === null || typeof v === 'boolean';
function list(v: unknown, limit: number, guard: (v: unknown) => boolean): boolean { return Array.isArray(v) && v.length <= limit && v.every(guard); }
function source(v: unknown): boolean { return object(v) && ['id','title','mediaPath','mediaRevision','packageId','packageVersion'].every(k=>string(v[k])) && optionalString(v.subtitlePath) && optionalString(v.subtitleRevision) && integer(v.positionMs) && integer(v.durationMs) && integer(v.subtitleOffsetRevision) && Number.isInteger(v.subtitleOffsetMs) && Math.abs(Number(v.subtitleOffsetMs))<=86400000 && typeof v.playbackRate==='number' && v.playbackRate>=0.5 && v.playbackRate<=2 && typeof v.inspectionTrigger==='string' && ['click','immediate','delayed','modifier'].includes(v.inspectionTrigger); }
function cue(v: unknown): boolean { return object(v) && integer(v.index) && integer(v.startMs) && integer(v.endMs) && Number(v.endMs)>Number(v.startMs) && string(v.text); }
function capability(v: unknown): boolean { return object(v) && string(v.id) && string(v.label); }
function levelScale(v: unknown): boolean {
 return object(v)&&string(v.id)&&v.id.includes(':')&&v.id.length<=512
  &&string(v.label)&&v.label.length>0&&v.label.length<=128
  &&string(v.attribution)&&v.attribution.length>0&&v.attribution.length<=2048;
}
function key(v: unknown): boolean { return object(v) && string(v.packageId) && string(v.targetId) && string(v.capability); }
function projection(v: unknown): boolean { return object(v) && key(v.key) && optionalBoolean(v.claim) && optionalBoolean(v.assessed) && (v.prediction===null || typeof v.prediction==='number' && Number.isFinite(v.prediction)) && integer(v.revision) && string(v.status); }
function plugin(v: unknown): boolean { return object(v) && string(v.id) && string(v.version) && list(v.capabilities,64,string); }
export function isPackageInstallStatus(v: unknown, maximumBytes = 272629760): v is PackageInstallStatus {
 const bytes = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximumBytes;
 if(!object(v)||!object(v.command)||!string(v.command.commandId)||v.command.commandId.length<1||v.command.commandId.length>128||!string(v.command.pluginId)||v.command.pluginId.length<1||v.command.pluginId.length>128)return false;
 if(!bytes(v.downloadedBytes)||!optionalString(v.message)||(typeof v.message==='string'&&v.message.length>2048))return false;
 if(v.totalBytes===null){if(v.downloadedBytes!==0)return false;}
 else if(!bytes(v.totalBytes)||v.downloadedBytes>v.totalBytes)return false;
 switch(v.phase){
 case 'downloading':case 'failed':case 'cancelled':return true;
 case 'validating':case 'succeeded':return v.totalBytes!==null&&v.downloadedBytes===v.totalBytes;
 default:return false;
 }
}
function token(v: unknown): boolean { return object(v) && integer(v.start) && integer(v.end) && Number(v.end)>Number(v.start) && string(v.text) && list(v.targets,128,string) && (v.nearbyMeaning===undefined||optionalBoolean(v.nearbyMeaning)); }
export { projection as isKnowledgeProjection };
export function isAnalyzedToken(value: unknown): value is AnalyzedToken {
 return token(value)&&object(value)&&typeof value.text==='string'&&presentation(value.presentation,value.text);
}
function sense(v: unknown): boolean {
 return object(v) && string(v.heading) && list(v.labels,32,string) && list(v.notes,32,string)
  && list(v.definitions,128,string) && Array.isArray(v.definitions) && v.definitions.length>0;
}
function presentation(v: unknown, text: string): boolean {
 if(v===undefined||v===null)return true;
 if(!object(v))return false;
 const namespaced=(id:unknown)=>string(id)&&id.includes(':')&&id.length<=512;
 const color=(c:unknown)=>c===null||typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c);
 const attribution=(a:unknown)=>string(a)&&a.length>0&&a.length<=2048;
 return JSON.stringify(v).length<=8192
  &&list(v.readings,16,r=>object(r)&&integer(r.start)&&integer(r.end)&&Number(r.end)>Number(r.start)
   &&Number(r.end)<=text.length*4&&string(r.text)&&r.text.length>0&&r.text.length<=512&&attribution(r.attribution)
   &&(r.base===undefined||r.base===null||string(r.base)&&r.base.length>0&&r.base.length<=512))
  &&list(v.labels,16,l=>object(l)&&namespaced(l.id)&&string(l.label)&&l.label.length>0&&l.label.length<=512&&color(l.color)&&attribution(l.attribution))
  &&(v.levels===undefined||v.levels===null||list(v.levels,16,l=>object(l)&&namespaced(l.scaleId)
   &&string(l.level)&&l.level.length>0&&l.level.length<=128&&string(l.label)&&l.label.length>0&&l.label.length<=512
   &&integer(l.rank)&&Number(l.rank)>=1&&Number(l.rank)<=7&&attribution(l.attribution)))
  &&list(v.contours,16,c=>object(c)&&namespaced(c.id)&&string(c.reading)&&c.reading.length>0&&string(c.label)
   &&color(c.color)&&attribution(c.attribution)&&(c.followingHeight===null||typeof c.followingHeight==='number'&&Number.isFinite(c.followingHeight)&&c.followingHeight>=0&&c.followingHeight<=1)
   &&list(c.units,64,u=>object(u)&&string(u.text)&&u.text.length>0&&u.text.length<=32&&typeof u.height==='number'&&Number.isFinite(u.height)&&u.height>=0&&u.height<=1)
   &&Array.isArray(c.units)&&c.units.length>0);
}
function entry(v:unknown):boolean {
 return object(v)&&['targetId','headword','partOfSpeech','definition','attribution'].every(k=>string(v[k]))
  &&typeof v.headword==='string'&&presentation(v.presentation,v.headword)&&optionalString(v.reading)&&optionalString(v.summary)
  &&(v.senses===null||list(v.senses,128,sense)&&Array.isArray(v.senses)&&v.senses.length>0)&&list(v.capabilities,8,capability);
}
function targetKnowledge(v:unknown):boolean {
 return object(v)&&list(v.projections,8,projection)&&typeof v.claim==='string'
  &&['unavailable','untracked','claimed_known','claimed_unknown','mixed'].includes(v.claim);
}
const revision=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
/** Structure validation at the native JSON transport boundary, not a TypeScript cast. */
export function isWatchResponse(v: unknown): v is Response {
 if(!object(v))return false;
 switch(v.type){
 case 'sources':return list(v.sources,20,source);
 case 'packages':return list(v.plugins,64,plugin);
 case 'installed':return plugin(v.plugin);
 case 'package_install_status':return v.status===null||isPackageInstallStatus(v.status);
 case 'source':return object(v.window) && source(v.window.source) && integer(v.window.totalCues) && list(v.window.cues,16,cue);
 case 'transcript':return object(v.page) && string(v.page.sourceId) && string(v.page.subtitleRevision) && list(v.page.cues,16,cue) && (v.page.nextIndex===null||integer(v.page.nextIndex));
 case 'cue_position':return object(v.position) && string(v.position.sourceId) && string(v.position.subtitleRevision) && integer(v.position.cueIndex) && integer(v.position.positionMs);
 case 'position_saved':return true;
 case 'language':return object(v.description) && string(v.description.language) && string(v.description.label) && string(v.description.annotationCapability) && string(v.description.attribution) && list(v.description.capabilities,8,capability)
  &&(v.description.levelScales===undefined||v.description.levelScales===null||list(v.description.levelScales,16,levelScale));
 case 'entry':return entry(v.entry)&&string(v.packageVersion)&&revision(v.packageRevision)&&targetKnowledge(v.knowledge);
 case 'dictionary':return object(v.batch)&&['sourceId','subtitleRevision','packageId','packageVersion'].every(k=>string((v.batch as RecordValue)[k]))
  &&revision(v.batch.packageRevision)&&list(v.batch.items,6,item=>object(item)&&(item.state==='unavailable'&&string(item.targetId)&&string(item.message)
   ||item.state==='available'&&object(item.summary)&&string(item.summary.targetId)&&string(item.summary.headword)&&optionalString(item.summary.reading)
   &&string(item.summary.summary)&&Array.from(item.summary.summary).length<=512&&presentation(item.summary.presentation,item.summary.headword)));
 case 'knowledge':return list(v.projections,256,projection);
 case 'claim_changed':return projection(v.projection);
 case 'analysis':return object(v.batch) && ['sourceId','subtitleRevision','packageId','packageVersion'].every(k=>string((v.batch as RecordValue)[k])) && revision(v.batch.packageRevision) && list(v.batch.knowledge,256,projection) && list(v.batch.annotations,8192,a=>object(a)&&integer(a.cueIndex)&&integer(a.tokenStart)&&string(a.status)) && list(v.batch.cues,16,a=>object(a)&&cue(a.cue)&&list(a.tokens,512,isAnalyzedToken));
 default:return false;
 }
}
