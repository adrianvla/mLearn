import { useEffect, useState } from 'react';
import type { MediaTrack, SourceRecord, SourceWindow } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { failure, type Failure } from '../failure';

function languageName(code: string | null) {
  if (!code) return null;
  try { return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) ?? code; } catch { return code; }
}
function label(track: MediaTrack) {
  const parts = [track.name, languageName(track.language)].filter((part): part is string => !!part);
  return parts.length ? [...new Set(parts)].join(' · ') : `Track ${track.ordinal + 1}`;
}
const unavailable = {
  image_subtitles: 'These subtitles are pictures, so they can’t be shown as text.',
  unsupported_codec: 'This subtitle format isn’t supported.',
} as const;

export function MediaTracks({ client, source, busy, playerAudioTracks, onChange }: {
  readonly client: RuntimeClient;
  readonly source: SourceRecord;
  readonly busy: boolean;
  /** How many audio tracks the player itself can switch between. */
  readonly playerAudioTracks: number;
  readonly onChange: (operation: (client: RuntimeClient) => Promise<SourceWindow>, reanalyze?: boolean) => unknown;
}) {
  const [tracks, setTracks] = useState<readonly MediaTrack[] | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setTracks(null); setError(null);
    client.sourceTracks(source.id).then(value => { if (active) setTracks(value); })
      .catch((cause: unknown) => { if (active) setError(failure(cause, 'This video’s tracks couldn’t be read.')); });
    return () => { active = false; };
  }, [client, source.id, source.mediaRevision, reload]);

  if (error) return <FailureNotice message={error.message} detail={error.detail}>
    <Button label="Retry" accessibilityLabel="Retry reading tracks" variant="secondary" onPress={() => setReload(value => value + 1)} />
  </FailureNotice>;
  if (!tracks) return <Text variant="caption" muted accessibilityLiveRegion="polite">Reading this video’s tracks…</Text>;
  const audio = tracks.filter(track => track.kind === 'audio');
  const subtitles = tracks.filter(track => track.kind === 'subtitles');
  const switchable = playerAudioTracks >= audio.length;
  const selected = source.audioTrack ?? audio.find(track => track.default)?.ordinal ?? 0;
  return <>
    {audio.length > 1 ? <>
      <Text>Audio track</Text>
      <Select label="Audio track" value={String(selected)} disabled={busy || !switchable}
        options={audio.map(track => ({ value: String(track.ordinal), label: label(track) }))}
        onValueChange={value => void onChange(next => next.setAudioTrack(source.id, Number(value)))} />
      {!switchable ? <Text variant="caption" muted>This player can’t switch between this video’s audio tracks.</Text> : null}
    </> : null}
    {subtitles.length ? <>
      <Text>Subtitles in this video</Text>
      {subtitles.map(track => <Row key={track.number}>
        <Text>{label(track)}</Text>
        {track.availability === 'available'
          ? <Button label="Use" accessibilityLabel={`Use ${label(track)} subtitles`} variant="secondary" size="compact" disabled={busy}
            onPress={() => void onChange(next => next.attachEmbeddedSubtitles(source.id, track.number), true)} />
          : <Text variant="caption" muted>{unavailable[track.availability]}</Text>}
      </Row>)}
    </> : null}
  </>;
}
