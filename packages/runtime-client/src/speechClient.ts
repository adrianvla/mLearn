import type { MessageReference, Request, Response, SpeechCommand, SpeechDelivery, SpeechResult, SpeechSettings } from '@mlearn/contracts';
import { RuntimeError } from './errors';
import { isConversationMessage } from './conversationProtocol';

const encoder = new TextEncoder();
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && encoder.encode(v).length <= max;
const uint = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4294967295;
const AUDIO_BASE64 = Math.ceil(2 * 1024 * 1024 / 3) * 4;

function isSpeechSettings(v: unknown): v is SpeechSettings {
  return object(v) && uint(v.revision) && text(v.endpoint, 2048) && text(v.synthesisModel, 256)
    && text(v.transcriptionModel, 256) && text(v.voice, 256) && typeof v.sessionCredentialReady === 'boolean';
}

function isSpeechResult(v: unknown): v is SpeechResult {
  if (!object(v)) return false;
  switch (v.kind) {
    case 'settings': return isSpeechSettings(v.settings);
    case 'audio': return text(v.audio, AUDIO_BASE64) && v.audio.length > 0 && text(v.mime, 128)
      && v.mime.startsWith('audio/') && text(v.model, 256) && text(v.voice, 256);
    case 'transcript': return text(v.text, 8192) && text(v.model, 256);
    case 'delivery': return isConversationMessage(v.message);
    default: return false;
  }
}

export function createSpeechClient(request: (request: Request) => Promise<unknown>, identity: () => string) {
  const malformed = () => new RuntimeError('protocol', 'Malformed speech response.');
  async function read(command: SpeechCommand): Promise<SpeechResult> {
    const response = await request({ type: 'speech', command });
    if (!object(response) || response.type !== 'speech' || !isSpeechResult(response.result)) throw malformed();
    return (response as Extract<Response, { type: 'speech' }>).result;
  }
  async function settings(command: SpeechCommand) {
    const r = await read(command);
    if (r.kind !== 'settings') throw malformed();
    return r.settings;
  }
  return {
    speechSettings: () => settings({ action: 'read_settings' }),
    prepareSpeechSettings(previous: SpeechSettings, value: Pick<SpeechSettings, 'endpoint' | 'synthesisModel' | 'transcriptionModel' | 'voice'>): Extract<SpeechCommand, { action: 'save_settings' }> {
      return { action: 'save_settings', commandId: identity(), expectedRevision: previous.revision, ...value };
    },
    async saveSpeechSettings(command: Extract<SpeechCommand, { action: 'save_settings' }>) {
      const saved = await settings(command);
      if (saved.revision !== command.expectedRevision + 1 || saved.endpoint !== command.endpoint) throw malformed();
      return saved;
    },
    setSpeechSessionCredential: (credential: string | null) => settings({ action: 'set_session_credential', credential }),
    async synthesize(textToSpeak: string, voice: string | null = null) {
      const r = await read({ action: 'synthesize', text: textToSpeak, voice });
      if (r.kind !== 'audio') throw malformed();
      return r;
    },
    async transcribe(audio: string, mime: string) {
      const r = await read({ action: 'transcribe', audio, mime });
      if (r.kind !== 'transcript') throw malformed();
      return r;
    },
    async recordSpeechDelivery(message: MessageReference, delivery: SpeechDelivery) {
      const r = await read({ action: 'record_delivery', commandId: identity(),
        message: { id: message.id, revision: message.revision }, delivery });
      if (r.kind !== 'delivery' || r.message.id !== message.id) throw malformed();
      return r.message;
    },
  };
}
