import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { View } from 'react-native';
import type { AuthoredMediaId, ReviewDelivery, ReviewEncounter, ReviewEncounterId } from '@mlearn/contracts';
import { RuntimeError } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { AttachmentPlayer } from '../material';
import { createReviewAudioDelivery, type AudioState, type ReviewAudioDelivery } from './delivery';

export type ReviewAudioProps = {
  readonly ref?: Ref<Pick<ReviewAudioDelivery, 'cancel'>>;
  readonly encounter: ReviewEncounter;
  readonly media: { readonly uri: (id: AuthoredMediaId) => Promise<string> } | null;
  readonly disabled?: boolean;
  readonly onDelivery: (encounterId: ReviewEncounterId, delivery: ReviewDelivery) => Promise<void>;
};

export function ReviewAudio(props: ReviewAudioProps) {
  // Revision/condition updates must not restart an admitted audio attempt.
  if (props.encounter.requiredMedia === null) return null;
  return <EncounterAudio key={props.encounter.id} {...props} mediaId={props.encounter.requiredMedia} />;
}

function EncounterAudio({ ref, encounter, media, mediaId, disabled = false, onDelivery }: ReviewAudioProps & {
  readonly mediaId: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AudioState>({ kind: 'loading' });
  const owner = useRef<ReviewAudioDelivery | null>(null);
  const initialDelivery = useRef(encounter.conditions.delivery);
  initialDelivery.current = encounter.conditions.delivery;
  const callback = useRef(onDelivery);
  callback.current = onDelivery;
  // Departure awaits this attempt while its encounter's persistence scope is live.
  useImperativeHandle(ref, () => ({ cancel: async () => { await owner.current?.cancel(); } }), []);
  useEffect(() => {
    const delivery = createReviewAudioDelivery({
      encounterId: encounter.id, mediaId,
      // A retried uncertain Started write can commit after its player stopped.
      // Recover that interruption before admitting another playback attempt.
      initialDelivery: attempt === 0 || initialDelivery.current === 'started' ? initialDelivery.current : 'pending',
      uri: id => {
        if (media === null) return Promise.reject(new RuntimeError('unavailable', 'Authored audio is unavailable on this host.'));
        return media.uri(id);
      },
      onDelivery: (id, value) => callback.current(id, value),
      onState: setState,
    });
    owner.current = delivery;
    void delivery.load();
    return () => { owner.current = null; delivery.dispose(); };
  }, [encounter.id, mediaId, media, attempt]);
  const currentOwner = owner.current;
  return <View>
    <Text variant="caption" muted>Authored audio</Text>
    {(state.kind === 'ready' || state.kind === 'playing') ? <>
      <AttachmentPlayer key={attempt} uri={state.uri} label="Review audio" height={64} disabled={disabled}
        onPlaybackEvent={event => { void currentOwner?.playback(event); }} />
      <Button label="Stop audio" variant="quiet" disabled={disabled} onPress={() => { void currentOwner?.cancel(); }} />
    </> : null}
    {state.kind === 'loading' ? <>
      <Text accessibilityLiveRegion="polite">Loading audio…</Text>
      <Button label="Cancel audio" variant="quiet" disabled={disabled} onPress={() => { void currentOwner?.cancel(); }} />
    </> : null}
    {state.kind === 'settling' ? <Text accessibilityLiveRegion="polite">Saving audio delivery…</Text> : null}
    {state.kind === 'settled' ? <>
      <Text accessibilityLiveRegion="polite">{state.delivery === 'completed' ? 'Audio playback completed.' : 'Audio playback interrupted.'}</Text>
      <Button label="Play audio again" variant="secondary" disabled={disabled} onPress={() => setAttempt(value => value + 1)} />
    </> : null}
    {state.kind === 'failed' ? <Text accessibilityRole="alert">{state.message}</Text> : null}
    {state.kind === 'failed' ? <Button label="Retry audio" variant="secondary" disabled={disabled} onPress={() => setAttempt(value => value + 1)} /> : null}
  </View>;
}
