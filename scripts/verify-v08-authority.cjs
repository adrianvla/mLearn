#!/usr/bin/env node
/** V08 adversarial authority probe against built production services.
 * Controlled model output, real filesystem/validation/compiler/projection.
 * Exit 2 means unsupported history or loop closure reached canonical state.
 * Run after npm run build. This is intentionally separate from green regression
 * tests: it records the outstanding V08 architectural blocker, not a waiver.
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
console.log('UNSUPPORTED_HISTORY_IN_NEXT_CONTEXT='+JSON.stringify(context.scenario.developments));
const loop=await journal.appendEvent('r',{roomId:'r',scope:{kind:'sea'},type:'memory.belief',actorId:'A',witnesses:['A'],payload:{ownerId:'A',kind:'open-loop',text:'Find out whether B told C.',sourceEventIds:[source.id]}});
await dreamer.runDreamer('r',{policy,llmFn:async()=>JSON.stringify({beliefs:[],resolutions:[{ownerId:'A',loop:1,status:'satisfied',text:'I will consider this question.',sourceEventIds:[source.id]}]})});
const loops=require(path.join(root,'shared/memoryProjection.js')).openLoopStates(await journal.readSeaProjection('r'));
console.log('UNSUPPORTED_LOOP_CLOSE='+JSON.stringify(loops.get(loop.id)));
console.log('PROFILE='+profile);
const blocked=context.scenario.developments.some(d=>d.text==='B told C.')||loops.get(loop.id)?.status==='satisfied';
console.log('AUTHORITY_EVIDENCE='+(blocked?'BLOCKED':'PASS'));
process.exit(blocked?2:0);
})().catch(e=>{console.error(e);process.exit(1)});
