import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import type { Contact, Conversation, ConversationGeneration } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import type { SpeechHost } from '../../bootstrap/RuntimeProvider';
import { failure, type Failure } from '../failure';

type Phase = 'listening' | 'transcribing' | 'waiting' | 'speaking';
const phaseLabel: Record<Phase, string> = {
  listening: 'Listening…', transcribing: 'Understanding…', waiting: 'Replying…', speaking: 'Speaking',
};

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Call ended', 'AbortError')); }, { once: true });
  });
}

/** A spoken conversation in place of the composer. Each heard utterance becomes a normal
 * message; each reply is spoken and its actually heard portion is recorded. */
export function CallPanel({ client, speech, conversation, participants, speaker, say, refresh, onEnd }: {
  readonly client: RuntimeClient;
  readonly speech: SpeechHost | undefined;
  readonly conversation: Conversation;
  readonly participants: readonly Contact[];
  readonly speaker: () => Promise<string | null>;
  readonly say: (participantId: string, text: string) => Promise<ConversationGeneration>;
  readonly refresh: () => Promise<void>;
  readonly onEnd: () => void;
}) {
  // The call loop outlives renders; it always uses the latest callbacks.
  const latest = useRef({ speaker, say, refresh, participants });
  latest.current = { speaker, say, refresh, participants };
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('listening');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [heard, setHeard] = useState('');
  const playback = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!speech) return;
    const call = new AbortController();
    const { signal } = call;
    (async () => {
      while (!signal.aborted) {
        setPhase('listening'); setLevel(0);
        const utterance = await speech.listen({ signal, onLevel: setLevel });
        if (!utterance || signal.aborted) return;
        setPhase('transcribing');
        const transcript = await client.transcribe(utterance.audio, utterance.mime);
        if (signal.aborted) return;
        if (!transcript.text) continue;
        setHeard(transcript.text);
        const participantId = await latest.current.speaker();
        if (!participantId) throw new Error('Nobody in this conversation is present to answer.');
        setPhase('waiting');
        let generation = await latest.current.say(participantId, transcript.text);
        while (generation.status === 'pending' || generation.status === 'streaming') {
          await wait(400, signal);
          generation = await client.conversationGeneration(generation.id);
        }
        if (generation.status !== 'complete') throw new Error(generation.error ?? `Reply ${generation.status}`);
        const page = await client.conversationMessages(conversation.id);
        const reply = page.items.find(message => message.id === generation.assistantMessageId);
        if (!reply || signal.aborted) return;
        const person = latest.current.participants.find(contact => contact.id === reply.participantId);
        const audio = await client.synthesize(reply.text, person?.voice || null);
        if (signal.aborted) return;
        setPhase('speaking');
        const playing = speech.play(audio.audio, audio.mime);
        playback.current = playing.stop;
        const barge = new AbortController();
        signal.addEventListener('abort', () => barge.abort(), { once: true });
        void speech.watchForSpeech(barge.signal, playing.stop).catch(() => {});
        const outcome = await playing.done;
        barge.abort(); playback.current = null;
        const characters = [...reply.text].length;
        await client.recordSpeechDelivery(reply, {
          deliveredChars: outcome.completed ? characters : Math.floor(characters * outcome.fraction),
          interrupted: !outcome.completed,
        });
        await latest.current.refresh();
      }
    })().catch(cause => {
      if (signal.aborted) return;
      const denied = cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');
      setError(failure(cause, denied ? 'Allow microphone access to talk.' : 'The call stopped.'));
    });
    return () => { call.abort(); playback.current?.(); };
  }, [client, speech, conversation.id, attempt]);
  if (!speech) return <View style={styles.panel} testID="call-panel">
    <FailureNotice message="Voice calls aren’t available on this device.">
      <Button label="End call" variant="secondary" onPress={onEnd} /></FailureNotice>
  </View>;
  return <View style={styles.panel} testID="call-panel">
    <Row>
      <View style={styles.grow}>
        <Text accessibilityLiveRegion="polite">{error ? 'Call paused' : phaseLabel[phase]}</Text>
        {heard ? <Text muted variant="caption" selectable>You said: {heard}</Text> : null}
      </View>
      {phase === 'listening' && !error ? <View accessibilityLabel={`Microphone level ${Math.round(level * 100)} percent`}
        style={styles.meter}><View style={[styles.level, { width: `${Math.round(level * 100)}%` }]} /></View> : null}
      {phase === 'speaking' && !error ? <Button label="Interrupt" variant="secondary" size="compact"
        onPress={() => playback.current?.()} /> : null}
      <Button label="End call" icon="phone" variant="secondary" size="compact" onPress={onEnd} />
    </Row>
    {error ? <FailureNotice message={error.message} detail={error.detail}>
      {error.detail?.includes('speech_unavailable')
        ? <Button label="Set up voice" variant="secondary" size="compact" onPress={() => router.push('/settings?section=voice')} />
        : <Button label="Retry" accessibilityLabel="Retry call" variant="secondary" size="compact"
          onPress={() => { setError(null); setAttempt(value => value + 1); }} />}
    </FailureNotice> : null}
  </View>;
}

const styles = StyleSheet.create(theme => ({
  panel: { gap: theme.spacing.small, padding: theme.spacing.comfortable, borderTopWidth: 1, borderColor: theme.colors.border },
  grow: { flex: 1, minWidth: 0 },
  meter: { width: 96, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: theme.surfaces.secondary },
  level: { height: 6, backgroundColor: theme.colors.accent },
}));
