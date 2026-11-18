import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { SpeechSettings } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { Row, SettingRow } from '@mlearn/ui/layout';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import type { SpeechHost } from '../../bootstrap/RuntimeProvider';
import { failure, type Failure } from '../failure';

type Target = 'load' | 'save' | 'key' | 'test';
type SaveCommand = ReturnType<RuntimeClient['prepareSpeechSettings']>;
const SAMPLE = 'This is how the voice sounds.';

export function VoiceSettings({ client, speech }: { readonly client: RuntimeClient; readonly speech: SpeechHost | undefined }) {
  const [settings, setSettings] = useState<SpeechSettings | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [synthesisModel, setSynthesisModel] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [voice, setVoice] = useState('');
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState<Target | null>('load');
  const [error, setError] = useState<{ target: Target; failure: Failure } | null>(null);
  const [pending, setPending] = useState<SaveCommand | null>(null);
  const [saved, setSaved] = useState(false);
  const [played, setPlayed] = useState<{ model: string; voice: string } | null>(null);
  const playback = useRef<{ stop: () => void } | null>(null);
  const alive = useRef(true);

  function adopt(value: SpeechSettings) {
    setSettings(value);
    setEndpoint(value.endpoint); setSynthesisModel(value.synthesisModel);
    setTranscriptionModel(value.transcriptionModel); setVoice(value.voice);
  }
  async function act(target: Target, action: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(target); setError(null); setSaved(false);
    try { await action(); }
    catch (cause) { if (alive.current) setError({ target, failure: failure(cause, message) }); }
    finally { if (alive.current) setBusy(null); }
  }
  async function load() {
    setBusy('load'); setError(null);
    try { const value = await client.speechSettings(); if (alive.current) adopt(value); }
    catch (cause) { if (alive.current) setError({ target: 'load', failure: failure(cause, 'Voice settings couldn’t be loaded.') }); }
    finally { if (alive.current) setBusy(null); }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; playback.current?.stop(); };
  }, [client]);

  function save() {
    if (!settings || busy) return;
    const command = pending ?? client.prepareSpeechSettings(settings, { endpoint: endpoint.trim(), synthesisModel: synthesisModel.trim(),
      transcriptionModel: transcriptionModel.trim(), voice: voice.trim() });
    setPending(command);
    setBusy('save'); setError(null); setSaved(false);
    void client.saveSpeechSettings(command).then(value => {
      if (!alive.current) return;
      setPending(null); adopt(value); setSaved(true);
    }, (cause: unknown) => {
      if (!alive.current) return;
      // Rejections before admission release the command; an unknown outcome keeps it for an exact retry.
      const rejected = cause instanceof RuntimeError && (cause.code === 'invalid_speech' || cause.code === 'conflict');
      if (rejected) setPending(null);
      setError({ target: 'save', failure: failure(cause, rejected
        ? 'These voice settings weren’t accepted. Check the address and model names.'
        : 'Voice settings weren’t saved. Retry to send the same change.') });
    }).finally(() => { if (alive.current) setBusy(null); });
  }
  function setKey(clear: boolean) {
    const key = clear ? null : credential;
    setCredential('');
    void act('key', async () => {
      const value = await client.setSpeechSessionCredential(key);
      if (alive.current) setSettings(previous => previous && { ...previous, sessionCredentialReady: value.sessionCredentialReady });
    }, 'The session key wasn’t updated. Enter it again to retry.');
  }
  function test() {
    if (!speech) return;
    playback.current?.stop();
    setPlayed(null);
    void act('test', async () => {
      const audio = await client.synthesize(SAMPLE, null);
      if (!alive.current) return;
      playback.current = speech.play(audio.audio, audio.mime);
      setPlayed({ model: audio.model, voice: audio.voice });
    }, 'The test voice didn’t play.');
  }

  const editable = settings !== null && busy === null && pending === null;
  const changed = settings !== null && (endpoint.trim() !== settings.endpoint || synthesisModel.trim() !== settings.synthesisModel
    || transcriptionModel.trim() !== settings.transcriptionModel || voice.trim() !== settings.voice);
  const notice = (target: Target, action?: ReactNode) => error?.target === target
    ? <FailureNotice message={error.failure.message} detail={error.failure.detail}>{action}</FailureNotice> : null;

  return <View style={styles.root}>
    {notice('load', <Button label="Retry loading voice settings" variant="secondary" disabled={busy !== null} onPress={() => void load()} />)}
    <Field label="Speech service address" description="Where speech is generated and recognized." value={endpoint}
      onChange={setEndpoint} editable={editable} maxLength={2048} />
    <Field label="Speech model" description="Model that reads text aloud." value={synthesisModel}
      onChange={setSynthesisModel} editable={editable} maxLength={256} />
    <Field label="Listening model" description="Model that turns your speech into text." value={transcriptionModel}
      onChange={setTranscriptionModel} editable={editable} maxLength={256} />
    <Field label="Default voice" description="Voice used when a conversation doesn’t choose one." value={voice}
      onChange={setVoice} editable={editable} maxLength={256} />
    <View style={styles.actions}>
      <Row>
        <Button label={pending ? 'Retry saving voice settings' : 'Save voice settings'} busy={busy === 'save'}
          disabled={!settings || busy !== null || (!pending && !changed)} onPress={save} />
        {pending && busy === null ? <Button label="Discard change" variant="quiet"
          onPress={() => { setPending(null); setError(null); if (settings) adopt(settings); }} /> : null}
      </Row>
      {!settings && busy === 'load' ? <Text variant="detail" muted>Loading voice settings…</Text> : null}
      {settings && !pending && !changed && busy === null && !saved ? <Text variant="detail" muted>No unsaved changes.</Text> : null}
      {saved ? <Text variant="detail" tone="success" accessibilityLiveRegion="polite">Saved.</Text> : null}
      {notice('save')}
    </View>
    <SettingRow label="Session key (not saved)" description={<Text variant="detail" muted>
      {settings?.sessionCredentialReady ? 'A key is set until mLearn closes.' : 'No key set. Some speech services need one.'}</Text>}>
      <View style={styles.control}>
        <TextField label="Session key" value={credential} onChangeText={setCredential} secureTextEntry
          autoCapitalize="none" autoCorrect={false} autoComplete="off" editable={settings !== null && busy === null} maxLength={4096} />
        <Row>
          <Button label="Set" accessibilityLabel="Set session key" variant="secondary" busy={busy === 'key'}
            disabled={!settings || busy !== null || !credential} onPress={() => setKey(false)} />
          <Button label="Clear" accessibilityLabel="Clear session key" variant="quiet"
            disabled={!settings?.sessionCredentialReady || busy !== null} onPress={() => setKey(true)} />
        </Row>
      </View>
    </SettingRow>
    {notice('key')}
    <SettingRow label="Test voice" description={<>
      {!speech ? <Text variant="detail" muted>Voice playback isn’t available on this device.</Text>
        : changed || pending ? <Text variant="detail" muted>Save your changes to test them.</Text>
        : <Text variant="detail" muted>Plays a short sentence with the saved settings.</Text>}
      {played ? <Text variant="detail" accessibilityLiveRegion="polite">Played with {played.model} · {played.voice}</Text> : null}
      {notice('test', <Button label="Try again" accessibilityLabel="Test voice again" variant="secondary" onPress={test} />)}
    </>}>
      <Button label="Test voice" icon="volume" variant="secondary" busy={busy === 'test'}
        disabled={!speech || !settings || busy !== null || changed || pending !== null} onPress={test} />
    </SettingRow>
  </View>;
}

function Field({ label, description, value, onChange, editable, maxLength }: {
  readonly label: string; readonly description: string; readonly value: string;
  readonly onChange: (value: string) => void; readonly editable: boolean; readonly maxLength: number;
}) {
  return <View style={styles.field}>
    <TextField label={label} value={value} onChangeText={onChange} editable={editable}
      autoCapitalize="none" autoCorrect={false} maxLength={maxLength} />
    <Text variant="detail" muted>{description}</Text>
  </View>;
}

const styles = StyleSheet.create(theme => ({
  root: { gap: theme.spacing.medium, minWidth: 0 },
  field: { gap: theme.spacing.tiny, minWidth: 0 },
  actions: { gap: theme.spacing.compact },
  control: { gap: theme.spacing.compact, flexBasis: 240, flexGrow: 1, maxWidth: 360, minWidth: 0 },
}));
