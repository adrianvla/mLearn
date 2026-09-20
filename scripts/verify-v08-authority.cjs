#!/usr/bin/env node
/** V08 adversarial authority probe against built production services.
 * Controlled model output, real filesystem/validation/compiler/projection.
 * Exit 2 means interpretation text crossed into occurrence authority or a loop
 * closed without later resolving evidence. Run after npm run build.
 */
const fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');
const root=path.join(__dirname, '..', 'dist-electron');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'v08-rereview-authority-'));
const original=Module._load;
Module._load=function(name){if(name==='electron')return {app:{getPath:()=>profile,isPackaged:false},ipcMain:{handle(){},on(){}}};return original.apply(this,arguments)};
const load=n=>require(path.join(root,'electron/services',n+'.js'));
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({livingWorldEnabled:true,llmEnabled:true,llmProvider:'ollama'}));
const a={id:'A',kind:'persistent',displayName:'A',personaText:'A careful neighbor',setupComplete:true};
const room={id:'r',title:'Garden',createdAt:1,participantIds:['A'],scenario:{scene:{sharedFacts:['A garden.'],socialConstraints:[],userObjectivePrivate:''},participants:[{kind:'existing',participantId:'A'}],relationships:[],adaptations:[]}};
fs.writeFileSync(path.join(profile,'world.json'),JSON.stringify({rooms:[room],threads:[],participants:[a]}));
const journal=load('journalService'),director=load('scenarioDirector'),dreamer=load('dreamerService'),world=load('worldStore');
const policy={kind:'local',isPermitted:()=>true,prefer:()=>true};
(async()=>{
const source=await journal.appendEvent('r',{roomId:'r',scope:{kind:'sea'},type:'message.user',actorId:'user',witnesses:['user','A'],payload:{text:'A suspects B told C. Nobody has confirmed it.'}});
await director.evolveScenario({roomId:'r',scopeKind:'sea'},{policy,llmFn:async()=>JSON.stringify({developments:[{kind:'progress',text:'B told C.',sourceEventIds:[source.id]}],goalUpdates:[],retractions:[],concluded:null,reopened:null})});
const state=await world.loadWorld();
const context=require(path.join(root,'shared/contextCompiler.js')).compileContext({participant:a,participants:[a],room:state.rooms[0],seaEvents:await journal.readSeaProjection('r')});
const stored=state.rooms[0].scenario.developments;
console.log('STORED_SCENARIO_INTERPRETATIONS='+JSON.stringify(stored));
console.log('COMPILED_SCENARIO_INTERPRETATIONS='+JSON.stringify(context.scenario.interpretations));
const loop=await journal.appendEvent('r',{roomId:'r',scope:{kind:'sea'},type:'memory.belief',actorId:'A',witnesses:['A'],payload:{ownerId:'A',kind:'open-loop',text:'Find out whether B told C.',sourceEventIds:[source.id]}});
await dreamer.runDreamer('r',{policy,llmFn:async()=>JSON.stringify({beliefs:[],resolutions:[{ownerId:'A',loop:1,status:'satisfied',text:'I will consider this question.',sourceEventIds:[source.id]}]})});
let loops=require(path.join(root,'shared/memoryProjection.js')).openLoopStates(await journal.readSeaProjection('r'));
const selfResolutionBlocked=loops.get(loop.id)?.status==='open';
console.log('SELF_RESOLUTION_BLOCKED='+selfResolutionBlocked);
const answer=await journal.appendEvent('r',{roomId:'r',scope:{kind:'sea'},type:'message.character',actorId:'A',witnesses:['A'],payload:{text:'B has now confirmed that B told C.',replyToEventId:loop.id}});
await dreamer.runDreamer('r',{policy,llmFn:async()=>JSON.stringify({beliefs:[],resolutions:[{ownerId:'A',loop:1,status:'satisfied',text:'A now treats the question as answered.',sourceEventIds:[answer.id]}]})});
loops=require(path.join(root,'shared/memoryProjection.js')).openLoopStates(await journal.readSeaProjection('r'));
const laterEvidenceResolved=loops.get(loop.id)?.status==='satisfied';
console.log('LATER_EVIDENCE_RESOLVED='+laterEvidenceResolved);
console.log('PROFILE='+profile);
const interpretationBoundary=stored.length===1&&stored[0].authority==='interpretation'
  &&context.scenario.interpretations.length===1&&context.scenario.interpretations[0].authority==='interpretation'
  &&context.scenario.developments===undefined;
const blocked=!interpretationBoundary||!selfResolutionBlocked||!laterEvidenceResolved;
console.log('AUTHORITY_EVIDENCE='+(blocked?'BLOCKED':'PASS'));
process.exit(blocked?2:0);
})().catch(e=>{console.error(e);process.exit(1)});
