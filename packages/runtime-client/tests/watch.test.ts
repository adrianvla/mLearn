import {test} from 'node:test';import assert from 'node:assert/strict';
import {isWatchResponse} from '../src/watchProtocol';
import {createRuntimeClient} from '../src/client';
test('bounded JSON is validated instead of trusting a response discriminator',()=>{
 assert.equal(isWatchResponse({type:'source',window:{source:{id:'fake'},cues:[],totalCues:0}}),false);
 assert.equal(isWatchResponse({type:'knowledge',projections:[{key:{packageId:'p',targetId:'t',capability:'c'},claim:true,assessed:null,prediction:null,revision:1,status:'claimed_known'}]}),true);
 assert.equal(isWatchResponse({type:'knowledge',projections:new Array(257).fill(null)}),false);
});
test('transcript admission stays bounded and retains untouched source coordinates',()=>{
 const cue={index:7,startMs:1000,endMs:2000,text:' e\u0301 日本語\n%_'};
 const page={sourceId:'source',subtitleRevision:'revision',cues:[cue],nextIndex:7};
 assert.equal(isWatchResponse({type:'transcript',page}),true);
 assert.equal(isWatchResponse({type:'transcript',page:{...page,cues:Array(17).fill(cue)}}),false);
 assert.equal(isWatchResponse({type:'transcript',page:{...page,nextIndex:-1}}),false);
});
test('structured dictionary senses remain bounded typed values at transport admission',()=>{
 const entry={targetId:'target',headword:'form',reading:null,partOfSpeech:'noun',definition:'complete definition',summary:'nearby meaning',
  attribution:'dictionary',capabilities:[],senses:[{heading:'noun',labels:['source taxonomy'],definitions:['one; intact gloss','second gloss'],notes:[]}]};
 const response={type:'entry',entry,packageVersion:'1',packageRevision:'a'.repeat(64),knowledge:{projections:[],claim:'unavailable'}};
 assert.equal(isWatchResponse(response),true);
 assert.equal(isWatchResponse({...response,entry:{...entry,senses:null}}),true);
 assert.equal(isWatchResponse({...response,entry:{...entry,senses:[{...entry.senses[0],definitions:'flattened'}]}}),false);
 assert.equal(isWatchResponse({...response,entry:{...entry,senses:new Array(129).fill(entry.senses[0])}}),false);
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
   return JSON.stringify({type:'analysis',batch:{sourceId:command.sourceId,subtitleRevision:'revision',packageId:'package',packageVersion:'1',packageRevision:'a'.repeat(64),cues:[],knowledge:[],annotations:[]}});
  }
 });
 const checkpoint=client.savePosition('old',0,30000);await started;
 const obsolete=client.analyzeSource('old',0);
 const rejected=assert.rejects(obsolete,{code:'cancelled'});
 await client.cancelSourceOpen();release();
 await checkpoint;await rejected;
 assert.equal((await client.analyzeSource('new',0)).sourceId,'new');
});
test('source and transcript display work share the latest desired read without blocking checkpoints',{timeout:5000},async()=>{
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
  return JSON.stringify({type:'analysis',batch:{sourceId:'source',subtitleRevision:'revision',packageId:'package',packageVersion:'1',packageRevision:'a'.repeat(64),cues:[],knowledge:[],annotations:[]}});
 }});
 const first=client.analyzeSource('source',0);await started;
 const second=client.analyzeTranscript('source',null,'came');
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
test('source cancellation drops queued Inspector lookups without dropping durable writes',{timeout:5000},async()=>{
 for(const lookup of [
  (client:ReturnType<typeof createRuntimeClient>)=>client.inspectTarget('package','target'),
  (client:ReturnType<typeof createRuntimeClient>)=>client.inspectTargets('source','subtitles','a'.repeat(64),['target']),
 ]){
  let release!:()=>void;let entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const admitted:string[]=[];
  const client=createRuntimeClient({commandId:()=> 'inspection-epoch',cancelSourceOpen:async()=>{},execute:async raw=>{
   const command:unknown=JSON.parse(raw);
   assert.ok(command&&typeof command==='object'&&'type'in command&&typeof command.type==='string');
   admitted.push(command.type);
   if(command.type!=='save_position')throw new Error('Obsolete lookup reached native transport');
   entered();await gate;return JSON.stringify({type:'position_saved'});
  }});
  const checkpoint=client.savePosition('source',4000,30000);await started;
  const obsolete=lookup(client);
  const rejected=assert.rejects(obsolete,{code:'cancelled'});
  try{await client.cancelSourceOpen();}finally{release();}
  await checkpoint;await rejected;
  assert.deepEqual(admitted,['save_position']);
 }
});
test('linguistic transport rejects executable colors and excessive nested pronunciation data',()=>{
 const presentation={readings:[],labels:[{id:'p:level',label:'Level A',color:'#00b84a',attribution:'Vocabulary list'}],
  contours:[{id:'p:pattern-a',reading:'ab',units:[{text:'a',height:0},{text:'b',height:1}],followingHeight:0,label:'Pattern A',color:null,attribution:'Dictionary'}]};
 const response={type:'dictionary',batch:{sourceId:'s',subtitleRevision:'r',packageId:'p',packageVersion:'1',packageRevision:'a'.repeat(64),
  items:[{state:'available',summary:{targetId:'t',headword:'ab',reading:'ab',summary:'meaning',presentation}}]}};
 assert.equal(isWatchResponse(response),true);
 const unsafe=structuredClone(response);unsafe.batch.items[0].summary.presentation.labels[0].color='url(unsafe)';
 assert.equal(isWatchResponse(unsafe),false);
 const oversized=structuredClone(response);oversized.batch.items[0].summary.presentation.contours[0].units=Array(65).fill({text:'a',height:0});
 assert.equal(isWatchResponse(oversized),false);
 const tooManyPatterns=structuredClone(response);tooManyPatterns.batch.items[0].summary.presentation.contours=Array(17).fill(presentation.contours[0]);
 assert.equal(isWatchResponse(tooManyPatterns),false);
 assert.equal(isWatchResponse({...response,batch:{...response.batch,items:Array(7).fill(response.batch.items[0])}}),false);
});
test('dictionary batches reject mismatched source and target identities',async()=>{
 const revision='a'.repeat(64);
 const client=createRuntimeClient({commandId:()=> 'dictionary',execute:async()=>JSON.stringify({type:'dictionary',
  batch:{sourceId:'source',subtitleRevision:'r',packageId:'p',packageVersion:'1',packageRevision:revision,
   items:[{state:'unavailable',targetId:'other',message:'Unavailable'}]}})});
 await assert.rejects(client.inspectTargets('source','r',revision,['target']),{code:'protocol'});
 await assert.rejects(client.inspectTargets('replacement','r',revision,['other']),{code:'protocol'});
});
test('optional source bases and nearby meaning eligibility remain typed bounded projections',()=>{
 const token={start:0,end:12,text:'a(reading)',targets:['t'],partOfSpeech:[],nearbyMeaning:false,
  presentation:{readings:[{start:0,end:12,text:'reading',base:'a',attribution:'Package'}],labels:[],contours:[]}};
 const batch={sourceId:'s',subtitleRevision:'r',packageId:'p',packageVersion:'1',packageRevision:'a'.repeat(64),
  cues:[{cue:{index:0,startMs:0,endMs:1000,text:token.text},tokens:[token]}],knowledge:[],annotations:[]};
 const response={type:'analysis',batch};
 assert.equal(isWatchResponse(response),true);
 for(const nearbyMeaning of [true,null,undefined])assert.equal(isWatchResponse({...response,batch:{...batch,
  cues:[{...batch.cues[0],tokens:[{...token,nearbyMeaning}]}]}}),true);
 assert.equal(isWatchResponse({...response,batch:{...batch,cues:[{...batch.cues[0],tokens:[{...token,nearbyMeaning:'yes'}]}]}}),false);
 for(const base of ['',42,'a'.repeat(513)])assert.equal(isWatchResponse({...response,batch:{...batch,cues:[{...batch.cues[0],
  tokens:[{...token,presentation:{...token.presentation,readings:[{...token.presentation.readings[0],base}]}}]}]}}),false);
});
