#!/usr/bin/env node
/** Verify retained evidence from a disposable mounted V10 Electron profile. */
const fs = require('fs');
const path = require('path');

const profile = process.env.V10_PROFILE;
if (!profile) {
  console.error('V10_PROFILE is required');
  process.exit(2);
}
const roomId = process.env.V10_ROOM_ID || 'room-v10-real';
const world = JSON.parse(fs.readFileSync(path.join(profile, 'world.json'), 'utf8'));
const rows = fs.readFileSync(path.join(profile, 'journal', roomId, 'sea.ndjson'), 'utf8')
  .trim().split('\n').filter(Boolean).map(JSON.parse);
const contact = (world.contacts ?? []).find(item => item.roomId === roomId && item.modality === 'call');
const invitation = rows.find(row => row.id === contact?.eventIds?.[0] && row.type === 'contact.invitation');
const voiceUser = rows.find(row => row.type === 'message.user' && row.payload?.modality === 'voice');
const voiceReply = rows.find(row => row.type === 'message.character' && row.payload?.modality === 'voice' && row.seq > (voiceUser?.seq ?? Infinity));
const logFiles = fs.readdirSync(path.join(profile, 'logs'))
  .filter(name => /^renderer\.log(?:\.\d+)?$/.test(name))
  .map(name => fs.readFileSync(path.join(profile, 'logs', name), 'utf8'))
  .join('\n');
const checks = {
  acceptedCanonicalCall: contact?.status === 'accepted' && invitation?.provenance?.contactId === contact.contactId,
  sameRoomAndPerson: invitation?.roomId === roomId
    && invitation?.actorId === contact?.participantId
    && voiceReply?.actorId === contact?.participantId,
  exactOfferBeforeVoice: invitation?.seq < voiceUser?.seq,
  spokenInputReachedStt: typeof voiceUser?.payload?.text === 'string' && voiceUser.payload.text.length > 0,
  modelReplyPersisted: typeof voiceReply?.payload?.text === 'string' && voiceReply.payload.text.length > 0,
  productionSttLoaded: /2026-09-21 .*STT loaded \(mlx\)/.test(logFiles),
  productionModelInvoked: /2026-09-21 .*Prompt sent to LLM/.test(logFiles),
  audibleTtsPlayback: /2026-09-21 .*TTS status .*"playing":true/.test(logFiles),
};
const record = {
  profile,
  roomId,
  contact: contact && { contactId: contact.contactId, callId: contact.callId, participantId: contact.participantId, status: contact.status, history: contact.history, eventIds: contact.eventIds },
  invitation: invitation && { id: invitation.id, roomId: invitation.roomId, actorId: invitation.actorId, witnesses: invitation.witnesses, payload: invitation.payload },
  voiceUser: voiceUser && { id: voiceUser.id, seq: voiceUser.seq, payload: voiceUser.payload },
  voiceReply: voiceReply && { id: voiceReply.id, seq: voiceReply.seq, actorId: voiceReply.actorId, payload: voiceReply.payload },
  checks,
};
const output = '/tmp/v10-mounted-record.json';
fs.writeFileSync(output, JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
const pass = Object.values(checks).every(Boolean);
console.log(`\nV10_MOUNTED_CALL_EVIDENCE=${pass ? 'PASS' : 'BLOCKED'}`);
console.log(`RECORD=${output}`);
process.exit(pass ? 0 : 2);
