import {test} from 'node:test';import assert from 'node:assert/strict';
import {isWatchResponse} from '../src/watchProtocol';
import {createRuntimeClient} from '../src/client';
test('bounded JSON is validated instead of trusting a response discriminator',()=>{
 assert.equal(isWatchResponse({type:'source',window:{source:{id:'fake'},cues:[],totalCues:0}}),false);
 assert.equal(isWatchResponse({type:'knowledge',projections:[{key:{packageId:'p',targetId:'t',capability:'c'},claim:true,assessed:null,prediction:null,revision:1,status:'claimed_known'}]}),true);
 assert.equal(isWatchResponse({type:'knowledge',projections:new Array(257).fill(null)}),false);
});
test('structured dictionary senses remain bounded typed values at transport admission',()=>{
 const entry={targetId:'target',headword:'form',reading:null,partOfSpeech:'noun',definition:'complete definition',summary:'nearby meaning',
  attribution:'dictionary',capabilities:[],senses:[{heading:'noun',labels:['source taxonomy'],definitions:['one; intact gloss','second gloss'],notes:[]}]};
 assert.equal(isWatchResponse({type:'entry',entry}),true);
 assert.equal(isWatchResponse({type:'entry',entry:{...entry,senses:null}}),true);
 assert.equal(isWatchResponse({type:'entry',entry:{...entry,senses:[{...entry.senses[0],definitions:'flattened'}]}}),false);
 assert.equal(isWatchResponse({type:'entry',entry:{...entry,senses:new Array(129).fill(entry.senses[0])}}),false);
});
test('retry keeps the admitted claim identity and exact payload',async()=>{
 const requests:string[]=[];let attempt=0;
 const client=createRuntimeClient({commandId:()=> 'same-command',execute:async(raw)=>{requests.push(raw);if(attempt++===0)throw new Error('connection lost after commit');return JSON.stringify({type:'claim_changed',projection:{key:{packageId:'p',targetId:'t',capability:'c'},claim:true,assessed:null,prediction:null,revision:1,status:'claimed_known'}});}});
 const change=client.prepareClaim({packageId:'p',targetId:'t',capability:'c'},true);
 await assert.rejects(client.changeClaim(change));await client.changeClaim(change);assert.equal(requests[0],requests[1]);
});
test('cancelling a queued source request prevents transport admission and stale publication',async()=>{
 let unblock:()=>void=()=>{};const gate=new Promise<void>(resolve=>{unblock=resolve;});const admitted:string[]=[];let cancellations=0;
 const client=createRuntimeClient({commandId:()=> 'id',cancelSourceOpen:async()=>{cancellations++;},execute:async(raw)=>{const request=JSON.parse(raw);admitted.push(request.type);await gate;return JSON.stringify({type:'sources',sources:[]});}});
 const first=client.recentSources();const opening=client.resumeSource('source');const failure=assert.rejects(opening,/cancelled/);
 await client.cancelSourceOpen();unblock();await first;await failure;assert.deepEqual(admitted,['recent_sources']);assert.equal(cancellations,1);
});
test('cancellation rejects obsolete analysis without discarding an admitted checkpoint',{timeout:5000},async()=>{
 let release!:()=>void;let entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const client=createRuntimeClient({
  commandId:()=> 'analysis-epoch',cancelSourceOpen:async()=>{},
  execute:async raw=>{
   const command:unknown=JSON.parse(raw);
   assert.ok(command&&typeof command==='object'&&'type'in command);
   if(command.type==='save_position'){entered();await gate;return JSON.stringify({type:'position_saved'});}
   assert.equal(command.type,'analyze_source');
   assert.ok('sourceId'in command&&typeof command.sourceId==='string');
   return JSON.stringify({type:'analysis',batch:{sourceId:command.sourceId,subtitleRevision:'revision',packageId:'package',packageVersion:'1',cues:[],knowledge:[],annotations:[]}});
  }
 });
 const checkpoint=client.savePosition('old',0,30000);await started;
 const obsolete=client.analyzeSource('old',0);
 const rejected=assert.rejects(obsolete,{code:'cancelled'});
 await client.cancelSourceOpen();release();
 await checkpoint;await rejected;
 assert.equal((await client.analyzeSource('new',0)).sourceId,'new');
});
test('display work keeps only the latest desired position without blocking durable checkpoints',{timeout:5000},async()=>{
 let release!:()=>void;let entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const positions:number[]=[];
 const client=createRuntimeClient({commandId:()=> 'bounded-display',execute:async raw=>{
  const command:unknown=JSON.parse(raw);
  assert.ok(command&&typeof command==='object'&&'type'in command);
  if(command.type==='save_position')return JSON.stringify({type:'position_saved'});
  assert.equal(command.type,'analyze_source');
  assert.ok('positionMs'in command&&typeof command.positionMs==='number');
  positions.push(command.positionMs);
  if(command.positionMs===0){entered();await gate;}
  return JSON.stringify({type:'analysis',batch:{sourceId:'source',subtitleRevision:'revision',packageId:'package',packageVersion:'1',cues:[],knowledge:[],annotations:[]}});
 }});
 const first=client.analyzeSource('source',0);await started;
 const second=client.analyzeSource('source',2000);
 const superseded=assert.rejects(second,{code:'cancelled'});
 const latest=client.analyzeSource('source',4000);
 try{await client.savePosition('source',4000,30000);await superseded;assert.deepEqual(positions,[0]);}
 finally{release();}
 await first;await latest;assert.deepEqual(positions,[0,4000]);
});
test('old source cleanup cannot cancel its replacement session',async()=>{
 let cancellations=0;
 const client=createRuntimeClient({commandId:()=> 'session',cancelSourceOpen:async()=>{cancellations++;},execute:async()=>JSON.stringify({type:'position_saved'})});
 const old=client.beginSourceSession();await old.ready;
 const current=client.beginSourceSession();await current.ready;
 await old.cancel();
 assert.equal(old.isCurrent(),false);assert.equal(current.isCurrent(),true);assert.equal(cancellations,2);
 await current.cancel();assert.equal(current.isCurrent(),false);assert.equal(cancellations,3);
});
