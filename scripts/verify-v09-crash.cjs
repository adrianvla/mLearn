#!/usr/bin/env node
/**
 * V09 autonomous-publication crash verifier against BUILT production services.
 * Uses actual SIGKILL and real JSON/NDJSON storage on disposable profiles.
 * Run after `npm run build`.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVICES = path.join(ROOT, 'dist-electron', 'electron', 'services');
const SHARED = path.join(ROOT, 'dist-electron', 'shared');
if (!fs.existsSync(path.join(SERVICES, 'autonomyService.js'))) {
  console.error('BUILD_REQUIRED: dist-electron autonomyService.js is missing');
  process.exit(2);
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`PASS ${label}`);
  else { failures += 1; console.error(`FAIL ${label} — ${detail ?? ''}`); }
}
function run(script, profile, label) {
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, V09_PROFILE: profile, V09_LABEL: label },
    encoding: 'utf8', timeout: 120_000,
  });
  return { code: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const stages = fs.mkdtempSync(path.join(os.tmpdir(), 'v09-crash-stages-'));
const common = `
const Module=require('module'),fs=require('fs'),path=require('path');
const originalLoad=Module._load;
Module._load=function(request){if(request==='electron')return {app:{getPath:()=>process.env.V09_PROFILE,isPackaged:false},ipcMain:{handle(){},on(){}}};return originalLoad.apply(this,arguments)};
const SERVICES=${JSON.stringify(SERVICES)};
const SHARED=${JSON.stringify(SHARED)};
const policy={kind:'local',isPermitted:()=>true,prefer:()=>true};
const settings=()=>require(path.join(SERVICES,'settings.js')).loadSettings();
const parse=(raw)=>JSON.parse(raw);
const actionModel=async(raw,id)=>{const p=parse(raw);if(String(p.task).startsWith('From only'))return JSON.stringify({decision:'accept',responseText:'I will label the envelopes while you sort.'});const ids=p.eligibleSources.map(x=>x.id);return JSON.stringify({decision:'act',actionText:'sorted the saved seeds into labeled envelopes.',leadMessage:'Please label these envelopes while I sort the seeds.',inviteParticipantId:'b',outcome:'completed',sourceEventIds:ids,referencesUserContributionEventIds:[],affectedParticipantIds:['a','b']})};
`;

const seed = path.join(stages, 'seed.cjs');
fs.writeFileSync(seed, `${common}
const autonomy=require(path.join(SERVICES,'autonomyService.js')),journal=require(path.join(SERVICES,'journalService.js'));
(async()=>{
fs.writeFileSync(path.join(process.env.V09_PROFILE,'settings.json'),JSON.stringify({livingWorldEnabled:true,worldAutonomyEnabled:true,llmEnabled:true,llmProvider:'ollama'}));
fs.writeFileSync(path.join(process.env.V09_PROFILE,'world.json'),JSON.stringify({rooms:[{id:'room-v09',title:'Garden',participantIds:['a','b'],createdAt:1}],threads:[],participants:[{id:'a',displayName:'Ava',kind:'persistent',personaText:'A practical gardener who enjoys patient shared projects.',setupComplete:true},{id:'b',displayName:'Bea',kind:'persistent',personaText:'A careful illustrator who likes organizing shared work.',setupComplete:true}]}));
const user=await journal.appendEvent('room-v09',{roomId:'room-v09',scope:{kind:'sea'},type:'message.user',actorId:'user',witnesses:['user','a','b'],payload:{text:'The shared garden table is ready.'}});
const reply=await journal.appendEvent('room-v09',{roomId:'room-v09',scope:{kind:'sea'},type:'message.character',actorId:'a',witnesses:['user','a','b'],payload:{text:'I have been thinking about a small seed project.'}});
const intentionModel=async raw=>{const p=parse(raw);return JSON.stringify({decision:'intend',text:'Sort the saved seeds with Bea because practical garden projects matter to me.',sourceEventIds:p.eligibleSources.map(x=>x.id)})};
const result=await autonomy.runAutonomyPass('room-v09',{policy,llmFn:intentionModel,now:reply.createdAt+autonomy.AUTONOMY_LIMITS.interestDelayMs+1,getSettings:settings});
if(result.kind!=='committed')throw new Error('seed intention did not commit: '+JSON.stringify(result));
console.log(JSON.stringify({user:user.id,reply:reply.id,intentionJob:result.jobId}));
})().catch(e=>{console.error(e);process.exit(1)});
`);

const runEpisode = path.join(stages, 'run-episode.cjs');
fs.writeFileSync(runEpisode, `${common}
const autonomy=require(path.join(SERVICES,'autonomyService.js')),journal=require(path.join(SERVICES,'journalService.js'));
const label=process.env.V09_LABEL;const kill=()=>process.kill(process.pid,'SIGKILL');
const originalAppend=fs.promises.appendFile.bind(fs.promises),originalRename=fs.promises.rename.bind(fs.promises);
fs.promises.appendFile=async(file,data,options)=>{await originalAppend(file,data,options);if(label==='B'&&String(data).includes('autonomyJobId'))kill()};
fs.promises.rename=async(from,to)=>{await originalRename(from,to);if(label==='C'&&String(to).endsWith('world.json')){const w=JSON.parse(fs.readFileSync(to,'utf8'));if((w.autonomyJobs??[]).some(j=>j.status==='committed'&&j.result==='episode'))kill()}};
(async()=>{
const intention=(await journal.readSeaProjection('room-v09')).filter(e=>e.type==='intention').at(-1);
const model=async(raw,id)=>{if(label==='A')kill();return actionModel(raw,id)};
const result=await autonomy.runAutonomyPass('room-v09',{policy,llmFn:model,now:intention.createdAt+autonomy.AUTONOMY_LIMITS.followThroughDelayMs+1,getSettings:settings});
console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exit(1)});
`);

const recover = path.join(stages, 'recover.cjs');
fs.writeFileSync(recover, `${common}
const autonomy=require(path.join(SERVICES,'autonomyService.js')),journal=require(path.join(SERVICES,'journalService.js'));
(async()=>{
const world=require(path.join(SERVICES,'worldStore.js'));const pending=(await world.loadWorld()).autonomyJobs?.find(j=>j.status==='pending'&&j.result!=='intention');
if(pending?.prepared)await autonomy.reconcilePendingAutonomy(Date.now()+60000);
else if(pending){const intention=(await journal.readSeaProjection('room-v09')).filter(e=>e.type==='intention').at(-1);await autonomy.runAutonomyPass('room-v09',{policy,llmFn:actionModel,now:intention.createdAt+autonomy.AUTONOMY_LIMITS.followThroughDelayMs+60000,getSettings:settings})}
console.log('recovered');
})().catch(e=>{console.error(e);process.exit(1)});
`);

const read = path.join(stages, 'read.cjs');
fs.writeFileSync(read, `${common}
const journal=require(path.join(SERVICES,'journalService.js')),world=require(path.join(SERVICES,'worldStore.js'));
(async()=>{const canonical=await journal.readSeaProjection('room-v09');let raw=[];try{raw=fs.readFileSync(path.join(process.env.V09_PROFILE,'journal','room-v09','sea.ndjson'),'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse)}catch{}const jobs=(await world.loadWorld()).autonomyJobs??[];console.log(JSON.stringify({canonicalAutonomy:canonical.filter(e=>e.provenance?.autonomyJobId).length,canonicalOccurrences:canonical.filter(e=>e.type==='occurrence.simulated').length,rawEpisodeRows:raw.filter(e=>e.provenance?.autonomyJobId&&jobs.some(j=>j.jobId===e.provenance.autonomyJobId&&j.result==='episode')).length,jobs:jobs.map(j=>({id:j.jobId,status:j.status,result:j.result,prepared:Boolean(j.prepared),eventIds:j.eventIds??[]}))}));})().catch(e=>{console.error(e);process.exit(1)});
`);

function seedProfile(label) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `v09-${label.toLowerCase()}-`));
  const result = run(seed, profile, `seed-${label}`);
  if (result.code !== 0) throw new Error(`seed ${label} failed: ${result.stderr}`);
  return profile;
}
function state(profile) {
  const result = run(read, profile, 'read');
  if (result.code !== 0) throw new Error(`read failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

for (const label of ['A', 'B', 'C']) {
  const profile = seedProfile(label);
  const killed = run(runEpisode, profile, label);
  check(`probe ${label} reaches controlled SIGKILL`, killed.signal === 'SIGKILL', `code=${killed.code} ${killed.stderr.slice(-200)}`);
  const before = state(profile);
  if (label === 'A') check('A: inference crash leaves no half-authoritative episode', before.canonicalOccurrences === 0 && before.rawEpisodeRows === 0 && before.jobs.some(j => j.status === 'pending' && !j.prepared), JSON.stringify(before));
  if (label === 'B') check('B: partial physical publication remains entirely hidden', before.canonicalOccurrences === 0 && before.rawEpisodeRows === 1 && before.jobs.some(j => j.status === 'pending' && j.prepared), JSON.stringify(before));
  if (label === 'C') check('C: atomic commit exposes exactly one certified episode', before.canonicalOccurrences === 1 && before.jobs.some(j => j.status === 'committed' && j.result === 'episode' && j.eventIds.length === 4), JSON.stringify(before));
  const recovery = run(recover, profile, `recover-${label}`);
  check(`${label}: recovery process exits cleanly`, recovery.code === 0, recovery.stderr.slice(-300));
  const after = state(profile);
  check(`${label}: recovery/replay has one episode and four certified rows`, after.canonicalOccurrences === 1 && after.rawEpisodeRows === 4 && after.jobs.filter(j => j.status === 'committed' && j.result === 'episode').length === 1, JSON.stringify(after));
  run(recover, profile, `replay-${label}`);
  const replay = state(profile);
  check(`${label}: identical restart replay remains idempotent`, replay.canonicalOccurrences === 1 && replay.rawEpisodeRows === 4, JSON.stringify(replay));
}

console.log(failures === 0 ? '\nV09 crash verification: ALL PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
