import {test} from 'node:test';import assert from 'node:assert/strict';
import {isWatchResponse} from '../src/watchProtocol';
import {createRuntimeClient} from '../src/client';
test('bounded JSON is validated instead of trusting a response discriminator',()=>{
 assert.equal(isWatchResponse({type:'source',window:{source:{id:'fake'},cues:[],totalCues:0}}),false);
 assert.equal(isWatchResponse({type:'knowledge',projections:[{key:{packageId:'p',targetId:'t',capability:'c'},claim:true,assessed:null,prediction:null,revision:1,status:'claimed_known'}]}),true);
 assert.equal(isWatchResponse({type:'knowledge',projections:new Array(257).fill(null)}),false);
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
