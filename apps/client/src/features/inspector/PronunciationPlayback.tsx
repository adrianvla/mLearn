import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import type { Playback, SpeechHost } from '../../bootstrap/RuntimeProvider';
import { failure, type Failure } from '../failure';

type State =
    | { readonly kind: 'idle' }
    | { readonly kind: 'preparing' }
    | { readonly kind: 'playing'; readonly playback: Playback }
    | { readonly kind: 'no_voice' }
    | { readonly kind: 'no_playback' }
    | { readonly kind: 'failed'; readonly failure: Failure };

const pronunciation = { play: 'Play pronunciation', stop: 'Stop pronunciation', preparing: 'Preparing pronunciation…' };

export function PronunciationPlayback({ client, speech, text, disabled = false, labels = pronunciation, onOpenVoiceSettings }: {
    readonly client: RuntimeClient;
    readonly labels?: { readonly play: string; readonly stop: string; readonly preparing: string };
    readonly speech: SpeechHost | undefined;
    readonly text: string;
    readonly disabled?: boolean;
    readonly onOpenVoiceSettings: () => void;
}) {
    const [state, setState] = useState<State>({ kind: 'idle' });
    const owner = useRef<object | null>(null);
    const playback = useRef<Playback | null>(null);
    useEffect(() => () => {
        owner.current = null;
        playback.current?.stop();
    }, []);
    async function play() {
        if (!speech) { setState({ kind: 'no_playback' }); return; }
        const attempt = {};
        owner.current = attempt;
        setState({ kind: 'preparing' });
        try {
            const audio = await client.synthesize(text, null);
            if (owner.current !== attempt) return;
            const started = speech.play(audio.audio, audio.mime);
            playback.current = started;
            setState({ kind: 'playing', playback: started });
            const outcome = await started.done;
            if (owner.current !== attempt) return;
            playback.current = null;
            // A rejected or broken element never reached the speaker; do not imply it did.
            setState(outcome.fraction === 0 && !outcome.completed
                ? { kind: 'failed', failure: { message: 'The pronunciation couldn’t be played.', detail: null } }
                : { kind: 'idle' });
        } catch (cause) {
            if (owner.current !== attempt) return;
            setState(cause instanceof RuntimeError && cause.code === 'speech_unavailable'
                ? { kind: 'no_voice' }
                : { kind: 'failed', failure: failure(cause, 'The pronunciation couldn’t be played.') });
        }
    }
    function stop() {
        owner.current = null;
        playback.current?.stop();
        playback.current = null;
        setState({ kind: 'idle' });
    }
    const playing = state.kind === 'playing';
    return <>
        <Button label={playing ? labels.stop : labels.play} icon={playing ? 'volumeOff' : 'volume'}
            iconOnly size="compact" variant="media" busy={state.kind === 'preparing'}
            disabled={disabled || state.kind === 'preparing'}
            onPress={() => playing ? stop() : void play()} />
        {state.kind === 'preparing' ? <Text tone="media" variant="caption" accessibilityLiveRegion="polite">{labels.preparing}</Text> : null}
        {state.kind === 'no_voice' ? <View style={styles.notice} testID="pronunciation-no-voice">
            <Text tone="media" variant="caption">Set up a voice in Settings</Text>
            <Button label="Voice settings" size="compact" variant="media" onPress={onOpenVoiceSettings} />
        </View> : null}
        {state.kind === 'no_playback' ? <Text tone="media" variant="caption" testID="pronunciation-no-playback">Audio playback isn’t available on this device</Text> : null}
        {state.kind === 'failed' ? <FailureNotice tone="media" message={state.failure.message} detail={state.failure.detail}>
            <Button label="Retry pronunciation" size="compact" variant="media" onPress={() => void play()} />
        </FailureNotice> : null}
    </>;
}

const styles = StyleSheet.create(theme => ({
    notice: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.small },
}));
