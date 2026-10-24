import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeClient, RuntimeError } from '../src/client.ts';

test('native failure never becomes a success-shaped UI value', async () => {
  const client = createRuntimeClient({ commandId: () => 'test', execute: async () => JSON.stringify({ type: 'error', code: 'conflict', message: 'Reload settings' }) });
  await assert.rejects(client.snapshot(), (error: unknown) => error instanceof RuntimeError && error.code === 'conflict');
});
test('protocol mismatch is explicit', async () => {
  const client = createRuntimeClient({ commandId: () => 'test', execute: async () => JSON.stringify({ type: 'snapshot', snapshot: { protocolVersion: 99 } }) });
  await assert.rejects(client.snapshot(), /Unsupported native protocol/);
});

test('install controls bypass a pending transfer and retain command identity', {timeout:5000}, async () => {
  // Given a transfer held at the native transport boundary.
  let release:()=>void=()=>{};
  let entered:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const requests:string[]=[];
  let installs=0;
  let sourceCancels=0;
  const command={pluginId:'example.hello',commandId:'install-once'};
  const status={command,phase:'downloading',downloadedBytes:20,totalBytes:100,message:null};
  const client=createRuntimeClient({
    commandId:()=>command.commandId,
    cancelSourceOpen:async()=>{sourceCancels++;},
    execute:async raw=>{
      requests.push(raw);
      const request:unknown=JSON.parse(raw);
      assert.ok(request&&typeof request==='object'&&'type'in request);
      if(request.type==='install_package'){
        entered();await gate;
        if(installs++===0)throw new Error('installation receipt lost');
        return JSON.stringify({type:'installed',plugin:{id:'example.hello',version:'1',capabilities:['hello']}});
      }
      return JSON.stringify({type:'package_install_status',status});
    },
  });
  // When status/cancel are requested while the install receipt is still pending.
  const prepared=client.prepareInstall('example.hello');
  const pending=client.installPackage(prepared);
  const lostReceipt=assert.rejects(pending,/installation receipt lost/);
  await started;
  try{
    assert.deepEqual(await client.currentPackageInstall(),status);
    assert.deepEqual(await client.packageInstallStatus(prepared.commandId),status);
    assert.deepEqual(await client.cancelPackageInstall(prepared.commandId),status);
    assert.equal(sourceCancels,0);
    await client.cancelSourceOpen();
  }finally{release();}
  // Then neither control queues behind the transfer, and a replay is identical.
  await lostReceipt;
  assert.equal((await client.installPackage(prepared)).version,'1');
  const submissions=requests.filter(raw=>JSON.parse(raw).type==='install_package');
  assert.equal(submissions[0],submissions[1]);
  assert.equal(sourceCancels,1);
});

test('package status rejects unbounded bytes and mismatched identities', async () => {
  const command={pluginId:'p',commandId:'expected'};
  for(const status of [
    {command,phase:'downloading',downloadedBytes:101,totalBytes:100,message:null},
    {command,phase:'succeeded',downloadedBytes:20,totalBytes:100,message:null},
    {command:{...command,commandId:'other'},phase:'downloading',downloadedBytes:20,totalBytes:100,message:null},
  ]){
    const client=createRuntimeClient({commandId:()=> 'unused',execute:async()=>JSON.stringify({type:'package_install_status',status})});
    await assert.rejects(client.packageInstallStatus('expected'),{code:'protocol'});
  }
});
