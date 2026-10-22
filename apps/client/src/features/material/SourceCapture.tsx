import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { MaterialCreate, SourceRecord } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Row } from '@mlearn/ui/layout';
import { captureSourcePage } from './captureSource';

/** A source-scoped operation; only its current native page stays in memory. */
export function SourceCapture({ client, source, onChanged }: {
  readonly client: RuntimeClient;
  readonly source: SourceRecord;
  readonly onChanged?: () => void;
}) {
  const operation = useRef<AbortController | null>(null);
  const cursor = useRef<number | null>(null);
  const failures = useRef<readonly MaterialCreate[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const [saved, setSaved] = useState(0);
  const identity = JSON.stringify([source.id, source.mediaRevision, source.subtitleRevision,
    source.packageId, source.packageVersion, source.subtitleOffsetMs, source.playbackRate]);
  const current = useRef(identity); current.current = identity;
  useEffect(() => {
    cursor.current = null; failures.current = [];
    setPending(false); setMessage(''); setError(''); setRetry(false); setSaved(0);
    return () => { operation.current?.abort(); operation.current = null; };
  }, [identity]);
  async function run() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true); setError(''); setRetry(false);
    setMessage('Capturing eligible words from the entire source…');
    const active = () => current.current === identity && operation.current === controller;
    try {
      if (failures.current.length) {
        const commands = failures.current;
        const results = await client.captureMaterials({ packageId: source.packageId, commands: [...commands] });
        if (!active()) return;
        setSaved(value => value + results.filter(result => result.state === 'saved').length);
        failures.current = commands.filter(command => results.some(result => result.commandId === command.commandId && result.state === 'failed'));
        if (failures.current.length) {
          setError(results.filter(result => result.state === 'failed').map(result => result.message).join('\n'));
          setRetry(true); return;
        }
      }
      while (!controller.signal.aborted) {
        const page = await captureSourcePage(client, source, cursor.current, controller.signal,
          count => { if (active()) setSaved(value => value + count); });
        if (!active()) return;
        cursor.current = page.next;
        failures.current = page.failed;
        if (page.failed.length) {
          setError(page.results.filter(result => result.state === 'failed').map(result => result.message).join('\n'));
          setRetry(true); return;
        }
        if (page.done) {
          cursor.current = null;
          setMessage('Source capture complete. Existing and excluded words were retained.');
          return;
        }
      }
      if (active()) { setMessage('Source capture stopped. Saved Material is retained.'); setRetry(true); }
    } catch (cause) {
      if (active()) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setRetry(true);
      }
    } finally {
      if (active()) { operation.current = null; setPending(false); onChanged?.(); }
    }
  }
  return <View>
    <Row>
      <Button label={retry ? 'Resume source capture' : 'Capture all eligible words in source'}
        variant="secondary" size="compact" busy={pending} disabled={!source.subtitleRevision}
        onPress={() => void run()} />
      {pending ? <Button label="Stop source capture" variant="quiet" size="compact"
        onPress={() => operation.current?.abort()} /> : null}
    </Row>
    {message ? <Text variant="caption" accessibilityLiveRegion="polite">{message} Saved: {saved}.</Text> : null}
    {error ? <Text accessibilityRole="alert" selectable>{error}</Text> : null}
  </View>;
}
