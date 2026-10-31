import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { AnalyzedToken, CaptureExclusion, MaterialContent, MaterialCreate, MaterialCaptureResult, MaterialEligibility } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Panel, Row } from '@mlearn/ui/layout';
import { Badge } from '@mlearn/ui/badge';
import { Menu } from '@mlearn/ui/menu';
import { dialogSidebarBreakpoint } from '@mlearn/ui/dialog';
import { InlineWord, type TextAnchor } from '@mlearn/ui/inline-word';
import { LinguisticWord, Pronunciation } from '../linguistic';

export type CaptureCandidate = {
  readonly key: string;
  readonly content: MaterialContent;
  readonly resolveCuePosition?: boolean;
  readonly knowledgeStatus?: string;
  readonly presentation?: AnalyzedToken['presentation'];
};
type Entry = { readonly candidate: CaptureCandidate; readonly command: MaterialCreate; readonly result?: MaterialCaptureResult };

/** One bounded availability read and one capture owner for every source surface. */
export function CaptureList({ client, candidates, onOpenMaterial, refreshKey = 0, tone = 'content', onInspect, onLocate, presentation = 'rows', header, disabled = false }: {
  readonly client: RuntimeClient;
  readonly candidates: readonly CaptureCandidate[];
  readonly onOpenMaterial?: (id: string) => void;
  readonly refreshKey?: number;
  readonly tone?: 'content' | 'media';
  readonly onInspect?: (candidate: CaptureCandidate, anchor: TextAnchor) => void;
  readonly onLocate?: (candidate: CaptureCandidate) => void;
  readonly presentation?: 'rows' | 'cards' | 'actions';
  readonly header?: ReactNode;
  readonly disabled?: boolean;
}) {
  const { width } = useWindowDimensions();
  const [availability, setAvailability] = useState<MaterialEligibility[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [exclusionRetry, setExclusionRetry] = useState<CaptureExclusion | null>(null);
  const owner = useRef<object | null>(null);
  const lock = useRef(false);
  const identity = JSON.stringify(candidates.map(({ key, content, resolveCuePosition }) => ({ key, content, resolveCuePosition })));
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
  const primary = tone === 'media' ? 'media' : 'primary';
  const secondary = tone === 'media' ? 'media' : 'secondary';
  const quiet = tone === 'media' ? 'media' : 'quiet';
  const cards = presentation === 'cards';
  const actions = presentation === 'actions';
  const compact = cards || actions;
  const batchActions = <Row><Button label={cards ? 'Capture view' : 'Capture all eligible in this view'} accessibilityLabel="Capture all eligible in this view"
      variant={cards ? 'quiet' : primary}
      size="compact" disabled={disabled || pending || !eligible.length} onPress={() => begin(eligible)} />
      {failed.length ? <Button label={`Retry failed captures (${failed.length})`} variant={primary} size="compact" disabled={disabled || pending} onPress={() => void capture(failed)} /> : null}</Row>;
  return <View style={styles.list}>
    {cards ? <View style={styles.cardHeader(Platform.OS === 'web' && width >= dialogSidebarBreakpoint)}>
      {header}<View style={styles.batchActions}>{batchActions}</View>
    </View> : !actions ? <View>{batchActions}</View> : null}
    {candidates.map(candidate => {
      const item = entries.find(entry => entry.candidate.key === candidate.key);
      const result = item?.result;
      const status = available(candidate);
      const excluded = status?.state === 'excluded' || status?.state === 'existing' && status.excluded;
      const checking = !status ? <Text tone={tone} muted variant="caption">Checking capture availability…</Text> : null;
      const exclusion = status && candidate.content.targetId ? <Button label={cards ? excluded ? 'Allow' : 'Exclude'
        : excluded ? `Allow capture ${candidate.content.phrase}` : `Exclude capture ${candidate.content.phrase}`}
        accessibilityLabel={excluded ? `Allow capture ${candidate.content.phrase}` : `Exclude capture ${candidate.content.phrase}`}
        variant={cards ? 'pill' : quiet} size="compact" disabled={disabled || pending} onPress={() => {
          if (candidate.content.targetId) void exclude(client.prepareCaptureExclusion({ packageId: candidate.content.packageId, targetId: candidate.content.targetId }, !excluded));
        }} /> : null;
      const content = <View style={actions ? styles.action : cards ? styles.card : styles.item(tone === 'media')}>
        {!actions ? <View style={styles.wordHeading(cards)}>
        {onInspect && cards ? <LinguisticWord text={candidate.content.phrase} presentation={candidate.presentation}
          activation={{ status: candidate.knowledgeStatus ?? 'pending', onActivate: anchor => onInspect(candidate, anchor) }} />
          : onInspect ? <InlineWord text={candidate.content.phrase} status={candidate.knowledgeStatus ?? 'pending'}
          variant="body" onActivate={anchor => onInspect(candidate, anchor)} />
          : <Text tone={tone} selectable>{candidate.content.phrase}</Text>}
        {cards ? <View style={styles.meaning}><Text variant="caption" muted align="right" numberOfLines={1}>{candidate.content.meaning}</Text></View> : null}
        {!cards && status ? <Badge label={excluded ? 'Capture excluded' : status.state === 'existing' ? 'Existing Material' : 'Eligible'} /> : null}
        {!cards ? checking : null}</View> : null}
        {compact ? checking : null}
        {cards ? <Pronunciation reading={candidate.content.reading} presentation={candidate.presentation} size="compact" /> : null}
        <Row>
          {onLocate ? <Button label={`Locate ${candidate.content.phrase}`} icon="play" iconOnly={cards} variant={quiet} size="compact"
            onPress={() => onLocate(candidate)} /> : null}
          {cards ? exclusion : null}
          {!item && status?.state === 'eligible' ? <Button label={compact ? 'Capture' : `Capture ${candidate.content.phrase}`}
            accessibilityLabel={`Capture ${candidate.content.phrase}`} variant={compact ? 'pill' : primary}
            tone={compact ? 'info' : 'neutral'} icon={compact ? 'plusCircle' : undefined}
            size="compact" disabled={disabled || pending} onPress={() => begin([candidate])} /> : null}
          {!actions && status?.state === 'existing' ? <Button label={cards ? 'Saved' : `Open saved ${candidate.content.phrase}`}
            accessibilityLabel={`Open saved ${candidate.content.phrase}`} variant={cards ? 'pill' : secondary} size="compact"
            disabled={disabled}
            onPress={() => onOpenMaterial?.(status.materialId)} /> : null}
          {!item && status?.state === 'existing' && !excluded ? <Button label={compact ? 'Capture context' : `Capture this context: ${candidate.content.phrase}`}
            accessibilityLabel={`Capture this context: ${candidate.content.phrase}`}
            icon={actions ? 'plusCircle' : undefined} tone={actions ? 'info' : undefined}
            size="compact" variant={compact ? 'pill' : secondary} disabled={disabled || pending} onPress={() => void begin([candidate])} /> : null}
          {actions && result?.state === 'saved' ? <Button label={result.reused ? 'Reused' : 'Saved'}
            accessibilityLabel={`Open saved ${candidate.content.phrase}`}
            accessibilityValue={{ text: `revision ${result.committedRevision}` }} accessibilityLiveRegion="polite"
            variant="pill" size="compact" disabled={disabled || pending} onPress={() => onOpenMaterial?.(result.materialId)} /> : null}
          {actions && status ? <Menu label="Capture options" icon="more" disabled={disabled || pending} actions={[
            ...(status.state === 'existing' && result?.state !== 'saved' ? [{ id: 'open-saved-material', label: `Open saved ${candidate.content.phrase}`,
              onPress: () => onOpenMaterial?.(status.materialId) }] : []),
            ...(candidate.content.targetId ? [{ id: 'capture-exclusion',
              label: excluded ? `Allow capture ${candidate.content.phrase}` : `Exclude capture ${candidate.content.phrase}`,
              onPress: () => {
                if (candidate.content.targetId) void exclude(client.prepareCaptureExclusion({
                  packageId: candidate.content.packageId, targetId: candidate.content.targetId,
                }, !excluded));
              } }] : []),
          ]} /> : null}
          {!compact ? exclusion : null}
        </Row>
        {!actions && result?.state === 'saved' ? <Text tone={tone} accessibilityLiveRegion="polite">{result.reused ? 'Reused' : 'Saved'} · {result.materialId} · revision {result.committedRevision}</Text> : null}
        {item && (!result || result.state === 'failed') ? <>{result?.state === 'failed' ? <Text tone={tone} accessibilityRole="alert">{result.message}</Text> : null}
          <Button label={`Retry capture ${candidate.content.phrase}`} variant={primary} disabled={disabled || pending} onPress={() => void capture([item])} /></> : null}
        {result?.state === 'duplicate' ? <>
          <Text tone={tone}>Choose existing Material or keep this context distinct.</Text>
          {result.materialIds.map(id => <Button key={id} label={`Use existing ${id}`} variant={secondary} disabled={disabled || pending}
            onPress={() => void reuse(candidate, id)} />)}
          <Button label={`Keep distinct ${candidate.content.phrase}`} variant={primary} disabled={disabled || pending} onPress={() => begin([candidate], true)} />
        </> : null}
      </View>;
      return cards ? <Panel key={candidate.key} inset="compact" material="card">{content}</Panel>
        : <View key={candidate.key}>{content}</View>;
    })}
    {error ? <><Text tone={tone} accessibilityRole="alert">{error}</Text>
      {exclusionRetry ? <Button label="Retry capture exclusion" variant={primary} disabled={disabled || pending} onPress={() => void exclude(exclusionRetry)} /> : null}</> : null}
    {availabilityError ? <><Text tone={tone} accessibilityRole="alert">{availabilityError}</Text>
      <Button label="Retry availability" variant={primary} disabled={disabled || pending} onPress={() => setReload(value => value + 1)} /></> : null}
  </View>;
}
const styles = StyleSheet.create(theme => ({
  action: { gap: theme.spacing.small },
  list: { gap: theme.spacing.compact, minWidth: 0 },
  batchActions: { alignSelf: 'flex-end' },
  cardHeader: (wide: boolean) => ({ gap: theme.spacing.compact,
    backgroundColor: wide ? theme.colors.surface : undefined,
    paddingHorizontal: wide ? theme.spacing.medium : 0,
    paddingBottom: wide ? theme.spacing.medium : 0,
    marginHorizontal: wide ? -theme.spacing.medium : 0,
    marginTop: wide ? -theme.spacing.medium : 0,
    marginBottom: wide ? theme.spacing.medium + theme.spacing.tiny : 0,
    borderBottomWidth: wide ? 1 : 0, borderBottomColor: theme.colors.border }),
  card: { gap: theme.spacing.small },
  wordHeading: (cards: boolean) => ({ flexDirection: 'row', flexWrap: cards ? 'nowrap' : 'wrap',
    alignItems: 'center', gap: cards ? theme.spacing.small : theme.spacing.compact }),
  meaning: { flex: 1, minWidth: 0 },
  item: (media: boolean) => ({ gap: theme.spacing.small, paddingVertical: theme.spacing.small,
    borderBottomWidth: 1, borderBottomColor: media ? theme.media.border : theme.colors.border }),
}));
