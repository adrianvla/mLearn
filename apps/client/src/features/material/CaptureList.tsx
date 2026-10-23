import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { CaptureExclusion, MaterialContent, MaterialCreate, MaterialCaptureResult, MaterialEligibility } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Row } from '@mlearn/ui/layout';
import { Badge } from '@mlearn/ui/badge';

export type CaptureCandidate = {
  readonly key: string;
  readonly content: MaterialContent;
  readonly resolveCuePosition?: boolean;
};
type Entry = { readonly candidate: CaptureCandidate; readonly command: MaterialCreate; readonly result?: MaterialCaptureResult };

/** One bounded availability read and one capture owner for every source surface. */
export function CaptureList({ client, candidates, onOpenMaterial, refreshKey = 0 }: {
  readonly client: RuntimeClient;
  readonly candidates: readonly CaptureCandidate[];
  readonly onOpenMaterial?: (id: string) => void;
  readonly refreshKey?: number;
}) {
  const [availability, setAvailability] = useState<MaterialEligibility[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [exclusionRetry, setExclusionRetry] = useState<CaptureExclusion | null>(null);
  const owner = useRef<object | null>(null);
  const lock = useRef(false);
  const identity = JSON.stringify(candidates);
  // Reject callbacks immediately on a new source/range, before effect cleanup.
  const current = useRef(identity); current.current = identity;
  useEffect(() => {
    const scope = {}; owner.current = scope;
    lock.current = false; setPending(false);
    setEntries([]); setAvailability([]); setError(''); setAvailabilityError(''); setExclusionRetry(null);
    return () => { if (owner.current === scope) owner.current = null; };
  }, [client, identity]);
  useEffect(() => {
    const scope = owner.current;
    let active = true;
    setAvailabilityError('');
    const targets = candidates.flatMap(({ content }) => content.targetId ? [{ packageId: content.packageId, targetId: content.targetId }] : []);
    void client.materialEligibility(targets).then(items => {
      if (active && scope && owner.current === scope && current.current === identity) setAvailability(items);
    }).catch((cause: unknown) => {
      if (active && scope && owner.current === scope && current.current === identity) setAvailabilityError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [client, identity, reload, refreshKey]);
  function available(candidate: CaptureCandidate) {
    return availability.find(item => item.target.packageId === candidate.content.packageId && item.target.targetId === candidate.content.targetId)?.availability;
  }
  async function capture(selected: Entry[]) {
    if (lock.current || !selected.length) return;
    lock.current = true; setPending(true); setError('');
    const scope = owner.current;
    // Retain intent before admission: even a whole-call rejection can lose a
    // committed receipt. Until a result arrives, only this command may retry.
    setEntries(previous => [...previous.filter(item => !selected.some(next => next.candidate.key === item.candidate.key)), ...selected]);
    try {
      const results = await client.captureMaterials({ packageId: selected[0].command.content.packageId, commands: selected.map(item => item.command) });
      if (scope && owner.current === scope && current.current === identity) {
        setEntries(previous => {
          const replacements = selected.map(item => ({ ...item, result: results.find(result => result.commandId === item.command.commandId) }));
          return [...previous.filter(item => !selected.some(next => next.candidate.key === item.candidate.key)), ...replacements];
        });
        setReload(value => value + 1);
      }
    } catch (cause) {
      if (scope && owner.current === scope && current.current === identity) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (owner.current === scope) { lock.current = false; setPending(false); } }
  }
  async function begin(selected: readonly CaptureCandidate[], distinct = false) {
    if (lock.current) return;
    const scope = owner.current;
    lock.current = true; setPending(true); setError('');
    try {
      const next: Entry[] = [];
      const positions = new Map<string, number>();
      for (const candidate of selected) {
        const source = candidate.content.source;
        let content = candidate.content;
        if (candidate.resolveCuePosition && source?.locator.kind === 'video' && source.locator.cueIndex !== null && source.locator.subtitleRevision !== null) {
          const key = JSON.stringify([source.sourceId, source.locator.subtitleRevision, source.locator.cueIndex]);
          let position = positions.get(key);
          if (position === undefined) {
            position = await client.cuePosition(source.sourceId, source.locator.subtitleRevision, source.locator.cueIndex);
            positions.set(key, position);
          }
          if (!scope || owner.current !== scope || current.current !== identity) return;
          content = { ...content, source: { ...source, locator: { ...source.locator, positionMs: position } } };
        }
        next.push({ candidate, command: client.prepareMaterial(content, distinct) });
      }
      lock.current = false;
      if (scope && owner.current === scope && current.current === identity) await capture(next);
    } catch (cause) {
      if (scope && owner.current === scope && current.current === identity) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (owner.current === scope) { lock.current = false; setPending(false); } }
  }
  async function reuse(candidate: CaptureCandidate, id: string) {
    if (lock.current) return;
    const scope = owner.current;
    lock.current = true; setPending(true); setError('');
    try {
      const material = await client.material(id);
      const targets = candidates.flatMap(({ content }) => content.targetId ? [{ packageId: content.packageId, targetId: content.targetId }] : []);
      const items = await client.materialEligibility(targets);
      if (scope && owner.current === scope && current.current === identity) {
        setAvailability(items);
        setEntries(previous => previous.filter(item => item.candidate.key !== candidate.key));
        onOpenMaterial?.(material.id);
      }
    } catch (cause) {
      if (scope && owner.current === scope && current.current === identity) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (owner.current === scope) { lock.current = false; setPending(false); } }
  }
  async function exclude(command: CaptureExclusion) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    const scope = owner.current;
    try {
      const item = await client.setCaptureExclusion(command);
      if (scope && owner.current === scope && current.current === identity) {
        setAvailability(previous => [...previous.filter(value => value.target.targetId !== item.target.targetId || value.target.packageId !== item.target.packageId), item]);
        setExclusionRetry(null);
      }
    } catch (cause) {
      if (scope && owner.current === scope && current.current === identity) {
        setError(cause instanceof Error ? cause.message : String(cause)); setExclusionRetry(command);
      }
    } finally { if (owner.current === scope) { lock.current = false; setPending(false); } }
  }
  const eligible = candidates.filter(candidate => available(candidate)?.state === 'eligible' && !entries.some(item => item.candidate.key === candidate.key));
  const failed = entries.filter(item => !item.result || item.result.state === 'failed');
  return <View style={styles.list}>
    <Row><Button label="Capture all eligible in this view" size="compact" disabled={pending || !eligible.length} onPress={() => begin(eligible)} />
      {failed.length ? <Button label={`Retry failed captures (${failed.length})`} size="compact" disabled={pending} onPress={() => void capture(failed)} /> : null}</Row>
    {candidates.map(candidate => {
      const item = entries.find(entry => entry.candidate.key === candidate.key);
      const result = item?.result;
      const status = available(candidate);
      const excluded = status?.state === 'excluded' || status?.state === 'existing' && status.excluded;
      return <View key={candidate.key} style={styles.item}>
        <Text selectable>{candidate.content.phrase}</Text>
        {status ? <Badge label={excluded ? 'Capture excluded' : status.state === 'existing' ? 'Existing Material' : 'Eligible'} /> : <Text muted variant="caption">Checking capture availability…</Text>}
        <Row>
          {!item && status?.state === 'eligible' ? <Button label={`Capture ${candidate.content.phrase}`} size="compact" disabled={pending} onPress={() => begin([candidate])} /> : null}
          {status?.state === 'existing' ? <Button label={`Open saved ${candidate.content.phrase}`} variant="secondary" size="compact"
            onPress={() => onOpenMaterial?.(status.materialId)} /> : null}
          {!item && status?.state === 'existing' && !excluded ? <Button label={`Capture this context: ${candidate.content.phrase}`}
            size="compact" variant="secondary" disabled={pending} onPress={() => void begin([candidate])} /> : null}
          {status && candidate.content.targetId ? <Button label={excluded ? `Allow capture ${candidate.content.phrase}` : `Exclude capture ${candidate.content.phrase}`}
            variant="quiet" size="compact" disabled={pending} onPress={() => {
              if (candidate.content.targetId) void exclude(client.prepareCaptureExclusion({ packageId: candidate.content.packageId, targetId: candidate.content.targetId }, !excluded));
            }} /> : null}
        </Row>
        {result?.state === 'saved' ? <Text accessibilityLiveRegion="polite">{result.reused ? 'Reused' : 'Saved'} · {result.materialId} · revision {result.committedRevision}</Text> : null}
        {item && (!result || result.state === 'failed') ? <>{result?.state === 'failed' ? <Text accessibilityRole="alert">{result.message}</Text> : null}
          <Button label={`Retry capture ${candidate.content.phrase}`} disabled={pending} onPress={() => void capture([item])} /></> : null}
        {result?.state === 'duplicate' ? <>
          <Text>Choose existing Material or keep this context distinct.</Text>
          {result.materialIds.map(id => <Button key={id} label={`Use existing ${id}`} variant="secondary" disabled={pending}
            onPress={() => void reuse(candidate, id)} />)}
          <Button label={`Keep distinct ${candidate.content.phrase}`} disabled={pending} onPress={() => begin([candidate], true)} />
        </> : null}
      </View>;
    })}
    {error ? <><Text accessibilityRole="alert">{error}</Text>
      {exclusionRetry ? <Button label="Retry capture exclusion" disabled={pending} onPress={() => void exclude(exclusionRetry)} /> : null}</> : null}
    {availabilityError ? <><Text accessibilityRole="alert">{availabilityError}</Text>
      <Button label="Retry availability" disabled={pending} onPress={() => setReload(value => value + 1)} /></> : null}
  </View>;
}
const styles = StyleSheet.create(theme => ({
  list: { gap: theme.spacing.compact, minWidth: 0 },
  item: { gap: theme.spacing.small, paddingVertical: theme.spacing.small, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
}));
