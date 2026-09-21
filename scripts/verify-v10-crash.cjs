#!/usr/bin/env node
/** V10 built-production contact publication/delivery crash verifier. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVICES = path.join(ROOT, 'dist-electron', 'electron', 'services');
if (!fs.existsSync(path.join(SERVICES, 'contactService.js'))) {
  console.error('BUILD_REQUIRED: run npm run build first');
  process.exit(2);
}
const stages = fs.mkdtempSync(path.join(os.tmpdir(), 'v10-crash-stages-'));
let failures = 0;
const check = (label, value, detail) => {
  if (value) console.log(`PASS ${label}`);
  else { failures += 1; console.error(`FAIL ${label} — ${detail ?? ''}`); }
};
const run = (file, profile, label) => spawnSync(process.execPath, [file], {
  env: { ...process.env, V10_PROFILE: profile, V10_LABEL: label }, encoding: 'utf8', timeout: 120_000,
});
const common = `
const Module=require('module'),fs=require('fs'),path=require('path');
const originalLoad=Module._load;
Module._load=function(request){if(request==='electron')return {app:{getPath:()=>process.env.V10_PROFILE,isPackaged:false},ipcMain:{handle(){},on(){}}};return originalLoad.apply(this,arguments)};
const SERVICES=${JSON.stringify(SERVICES)};
const contact=require(path.join(SERVICES,'contactService.js'));
const journal=require(path.join(SERVICES,'journalService.js'));
const worldStore=require(path.join(SERVICES,'worldStore.js'));
const settingsService=require(path.join(SERVICES,'settings.js'));
const policy={kind:'local',isPermitted:()=>true,prefer:()=>true};
const getSettings=()=>settingsService.loadSettings();
const model=async raw=>{const p=JSON.parse(raw);return JSON.stringify({decision:'message',text:'The seed catalogue now has two conflicting entries. Could we review them?',reason:'The conflict affects the seed-catalogue work already discussed.',sourceEventIds:[p.eligibleSources[0].id]})};
`;
const seed = path.join(stages, 'seed.cjs');
fs.writeFileSync(seed, `${common}
(async()=>{
fs.writeFileSync(path.join(process.env.V10_PROFILE,'settings.json'),JSON.stringify({livingWorldEnabled:true,proactivityEnabled:true,llmEnabled:true,proactiveOptOutParticipantIds:[],proactiveOptOutRoomIds:[],proactiveCallOptOutParticipantIds:[],proactiveQuietHoursEnabled:false,proactiveQuietHoursStart:'22:00',proactiveQuietHoursEnd:'08:00'}));
fs.writeFileSync(path.join(process.env.V10_PROFILE,'world.json'),JSON.stringify({rooms:[{id:'room-v10',title:'Seed Library',participantIds:['mara'],createdAt:1}],threads:[],participants:[{id:'mara',displayName:'Mara',kind:'persistent',personaText:'A patient seed librarian.',setupComplete:true}],contacts:[],autonomyJobs:[]}));
await journal.appendEvent('room-v10',{roomId:'room-v10',scope:{kind:'sea'},type:'message.user',actorId:'user',witnesses:['user','mara'],payload:{text:'Let me know if the catalogue changes.'}});
await journal.appendEvent('room-v10',{roomId:'room-v10',scope:{kind:'sea'},type:'message.character',actorId:'mara',witnesses:['user','mara'],payload:{text:'I will keep watch.'}});
const occurrence=await journal.appendEvent('room-v10',{roomId:'room-v10',scope:{kind:'sea'},type:'occurrence.simulated',actorId:'mara',witnesses:['mara'],payload:{authority:'simulated-occurrence',operationId:'episode-v10',summary:'Mara found two conflicting seed catalogue entries.',actorIds:['mara'],sourceEventIds:[],intentionId:'intention-v10',outcome:'pursued',effectiveAt:Date.now()},provenance:{autonomyJobId:'job-v10'}});
const world=await worldStore.loadWorld();world.autonomyJobs=[{jobId:'job-v10',roomId:'room-v10',candidateKind:'intention-follow-through',leadParticipantId:'mara',participantIds:['mara'],sourceEventIds:[],candidateHash:'cause',status:'committed',attempts:1,createdAt:occurrence.createdAt,eligibleAt:occurrence.createdAt,settledAt:occurrence.createdAt,result:'episode',eventIds:[occurrence.id]}];await worldStore.saveWorld(world);
console.log(JSON.stringify({now:occurrence.createdAt+contact.CONTACT_LIMITS.eligibilityDelayMs+1}));
})().catch(e=>{console.error(e);process.exit(1)});`);

const publish = path.join(stages, 'publish.cjs');
fs.writeFileSync(publish, `${common}
const label=process.env.V10_LABEL;const kill=()=>process.kill(process.pid,'SIGKILL');
const originalAppend=fs.promises.appendFile.bind(fs.promises),originalRename=fs.promises.rename.bind(fs.promises);
fs.promises.appendFile=async(file,data,options)=>{await originalAppend(file,data,options);if(label==='B'&&String(data).includes('contact_'))kill()};
fs.promises.rename=async(from,to)=>{await originalRename(from,to);if(label==='C'&&String(to).endsWith('world.json')){const w=JSON.parse(fs.readFileSync(to,'utf8'));if((w.contacts??[]).some(c=>c.status==='ready'))kill()}};
(async()=>{const occurrence=(await journal.readSeaProjection('room-v10')).find(e=>e.type==='occurrence.simulated');await contact.runContactPass('room-v10',{policy,llmFn:model,now:occurrence.createdAt+contact.CONTACT_LIMITS.eligibilityDelayMs+1,getSettings});})().catch(e=>{console.error(e);process.exit(1)});`);

const recover = path.join(stages, 'recover.cjs');
fs.writeFileSync(recover, `${common}
(async()=>{const occurrence=(await journal.readSeaProjection('room-v10')).find(e=>e.type==='occurrence.simulated');const result=await contact.runContactPass('room-v10',{policy,llmFn:model,now:occurrence.createdAt+contact.CONTACT_LIMITS.eligibilityDelayMs+2,getSettings});let attempts=0;await contact.reconcileContactDelivery('room-v10',{now:occurrence.createdAt+contact.CONTACT_LIMITS.eligibilityDelayMs+3,getSettings,attempt:()=>{attempts+=1;return 'attempted'}});const id=result.contactId??(await worldStore.loadWorld()).contacts[0].contactId;const first=await contact.activateContact(id,occurrence.createdAt+contact.CONTACT_LIMITS.eligibilityDelayMs+4);const second=await contact.activateContact(id,occurrence.createdAt+contact.CONTACT_LIMITS.eligibilityDelayMs+5);console.log(JSON.stringify({attempts,first:first.ok,second:second.ok,id}));})().catch(e=>{console.error(e);process.exit(1)});`);

const read = path.join(stages, 'read.cjs');
fs.writeFileSync(read, `${common}
(async()=>{const canonical=await journal.readSeaProjection('room-v10');const world=await worldStore.loadWorld();let raw=[];try{raw=fs.readFileSync(path.join(process.env.V10_PROFILE,'journal','room-v10','sea.ndjson'),'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse)}catch{}console.log(JSON.stringify({canonical:canonical.filter(e=>e.provenance?.contactId).length,raw:raw.filter(e=>e.provenance?.contactId).length,contacts:(world.contacts??[]).map(c=>({id:c.contactId,status:c.status,eventIds:c.eventIds??[],attempts:c.deliveryAttempts,prepared:Boolean(c.prepared),opened:c.history.filter(h=>h.status==='opened').length}))}));})().catch(e=>{console.error(e);process.exit(1)});`);

for (const label of ['B', 'C']) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `v10-${label.toLowerCase()}-`));
  const seeded = run(seed, profile, label);
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr}`);
  const killed = run(publish, profile, label);
  check(`${label}: controlled SIGKILL reached`, killed.signal === 'SIGKILL', `${killed.status} ${killed.stderr}`);
  const beforeResult = run(read, profile, label);
  const before = JSON.parse(beforeResult.stdout);
  check(`${label}: no duplicate authoritative contact before recovery`, before.contacts.length === 1 && before.canonical <= 1, JSON.stringify(before));
  if (label === 'B') check('B: partial journal publication is quarantined', before.raw === 1 && before.canonical === 0 && before.contacts[0].prepared, JSON.stringify(before));
  if (label === 'C') check('C: committed contact survives before external delivery', before.canonical === 1 && before.contacts[0].status === 'ready' && before.contacts[0].attempts === 0, JSON.stringify(before));
  const recovered = run(recover, profile, label);
  check(`${label}: recovery and activation exit cleanly`, recovered.status === 0, recovered.stderr);
  const replay = run(recover, profile, label);
  check(`${label}: repeated recovery exits cleanly`, replay.status === 0, replay.stderr);
  const after = JSON.parse(run(read, profile, label).stdout);
  check(`${label}: exactly one contact/event and one delivery attempt remain`, after.contacts.length === 1 && after.canonical === 1 && after.raw === 1 && after.contacts[0].attempts === 1, JSON.stringify(after));
  check(`${label}: repeated activation is idempotent`, after.contacts[0].status === 'opened' && after.contacts[0].opened === 1, JSON.stringify(after));
}
console.log(failures === 0 ? '\nV10_CRASH_EVIDENCE=PASS' : `\nV10_CRASH_EVIDENCE=BLOCKED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
