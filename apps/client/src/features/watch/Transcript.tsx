import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { SourceRecord, TranscriptPage, AnalysisBatch, AnalyzedToken, Cue, DictionaryResult } from '@mlearn/contracts';
import type { TextAnchor } from '@mlearn/ui/inline-word';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { Select } from '@mlearn/ui/select';
import { AnnotatedText } from '../annotated-text';
import type { Inspection } from '../inspector';
import { cueAnchor, emptyMaterial, CaptureList, SourceCapture, useSourcePractice, type CaptureCandidate } from '../material';
import { useRouter } from 'expo-router';

export function cueTime(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Bounded source navigation. Cue text/timestamps are never rewritten for display. */
export function Transcript({ client, source, open, onOpenChange, onSeek, analysis, onAnalysis, onInspect,
  vocabulary, onVocabularyChange, floatingControls, children }: PropsWithChildren<{
  client: RuntimeClient;
  source: SourceRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSeek: (positionMs: number) => void;
  analysis: AnalysisBatch | null;
  onAnalysis: (analysis: AnalysisBatch | null) => void;
  onInspect: (inspection: Inspection) => void;
  vocabulary: boolean;
  onVocabularyChange: (vocabulary: boolean) => void;
  floatingControls?: (focusTarget: () => View | null) => ReactNode;
}>) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [after, setAfter] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [captureRefresh, setCaptureRefresh] = useState(0);
  const [unknownOnly, setUnknownOnly] = useState(false);
  const [dictionary, setDictionary] = useState<{ identity: string; items: DictionaryResult[] } | null>(null);
  const [dictionaryPending, setDictionaryPending] = useState(false);
  const [dictionaryError, setDictionaryError] = useState('');
  const [dictionaryReload, setDictionaryReload] = useState(0);
  const trigger = useRef<View>(null);
  const visibleWords = useRef(new Set<string>());
  const [page, setPage] = useState<TranscriptPage | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [analysisPending, setAnalysisPending] = useState(false);
  const analysisStarted = useRef(0);
  useLayoutEffect(() => {
    if (!open || !analysis || !analysisStarted.current || process.env.EXPO_PUBLIC_MLEARN_METRICS !== '1') return;
    const started = analysisStarted.current;
    const frame = requestAnimationFrame(() => {
      console.info(`annotation-ui phase=transcript_commit timestamp_ms=${Date.now()} request_to_frame_ms=${(performance.now() - started).toFixed(3)} cues=${analysis.cues.length}`);
      analysisStarted.current = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, analysis]);
  const [navigating, setNavigating] = useState(false);
  const [navigationError, setNavigationError] = useState<{ cueIndex: number; message: string } | null>(null);
  const current = useRef('');
  const generation = useRef(0);
  const identity = JSON.stringify([source.id, source.subtitleRevision, source.packageId, source.packageVersion, source.subtitleOffsetMs, after, query, open]);
  current.current = identity;
  async function refreshAnalysis() {
    if (!open || current.current !== identity) throw new Error('Transcript changed; reopen the inspection.');
    const owner = generation.current;
    analysisStarted.current = performance.now();
    const result = await client.analyzeTranscript(source.id, after, query);
    if (current.current !== identity || generation.current !== owner || result.sourceId !== source.id ||
      result.subtitleRevision !== source.subtitleRevision || result.packageId !== source.packageId ||
      result.packageVersion !== source.packageVersion) throw new Error('Transcript changed; reopen the inspection.');
    onAnalysis(result);
    setAnalysisError('');
  }
  async function seek(cueIndex: number) {
    if (navigating || !source.subtitleRevision) return;
    setNavigating(true);
    setNavigationError(null);
    const owner = generation.current;
    try {
      const position = await client.cuePosition(source.id, source.subtitleRevision, cueIndex);
      if (current.current !== identity || generation.current !== owner) return;
      onSeek(position);
    } catch (cause) {
      if (current.current === identity && generation.current === owner)
        setNavigationError({ cueIndex, message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (generation.current === owner) setNavigating(false);
    }
  }
  useEffect(() => {
    if (!open) return;
    current.current = identity;
    generation.current++;
    setNavigating(false);
    setNavigationError(null);
    let active = true;
    setPending(true);
    setError('');
    setAnalysisError('');
    setAnalysisPending(true);
    onAnalysis(null);
    void refreshAnalysis().catch((cause: unknown) => {
      if (active) setAnalysisError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setAnalysisPending(false); });
    void client.transcript(source.id, after, query).then(value => {
      if (active && value.sourceId === source.id && value.subtitleRevision === source.subtitleRevision)
        setPage(value);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; generation.current++; if (current.current === identity) current.current = ''; };
  }, [client, source.id, source.subtitleRevision, source.packageId, source.packageVersion, source.subtitleOffsetMs, open, after, query, reload, onAnalysis]);

  const prepared = analysis?.sourceId === source.id && analysis.subtitleRevision === source.subtitleRevision
    && analysis.packageId === source.packageId && analysis.packageVersion === source.packageVersion ? analysis : null;
  async function inspect(cue: Cue, token: AnalyzedToken, anchor: TextAnchor) {
    if (!source.subtitleRevision) return;
    const owner = generation.current;
    try {
      const position = await client.cuePosition(source.id, source.subtitleRevision, cue.index);
      if (current.current !== identity || owner !== generation.current) return;
      onInspect({ sourceForm: token.text, context: cue.text, targets: token.targets, anchor,
        sourceAnchor: cueAnchor(source, cue, token, position), packageRevision: prepared?.packageRevision,
        showContext: true, onChanged: refreshAnalysis });
    } catch (cause) {
      if (current.current === identity && owner === generation.current)
        setNavigationError({ cueIndex: cue.index, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  const captureCandidates: CaptureCandidate[] = [];
  const seen = new Set<string>();
  for (const analyzed of prepared?.cues ?? []) for (const token of analyzed.tokens) {
    const targetId = token.targets[0];
    const status = prepared?.annotations.find(annotation => annotation.cueIndex === analyzed.cue.index
      && annotation.tokenStart === token.start)?.status ?? 'pending';
    if (!targetId || vocabulary && token.nearbyMeaning === false || seen.has(targetId) || captureCandidates.length >= 128
      || vocabulary && unknownOnly && (status === 'claimed_known' || status === 'assessed_known')) continue;
    seen.add(targetId);
    // The bulk action resolves each selected cue's native media time on demand.
    captureCandidates.push({ key: targetId, knowledgeStatus: status, presentation: token.presentation, resolveCuePosition: true, content: { ...emptyMaterial(source.packageId),
      targetId, packageRevision: prepared?.packageRevision ?? null, phrase: token.text, context: analyzed.cue.text,
      source: cueAnchor(source, analyzed.cue, token, Math.max(0, analyzed.cue.startMs - source.subtitleOffsetMs)) } });
  }
  const dictionaryIdentity = JSON.stringify([prepared?.sourceId, prepared?.subtitleRevision,
    prepared?.packageRevision, captureCandidates.map(candidate => candidate.key)]);
  useEffect(() => {
    if (!open || !prepared) return;
    let active = true;
    setDictionary({ identity: dictionaryIdentity, items: [] });
    setDictionaryPending(true); setDictionaryError('');
    void (async () => {
      const items: DictionaryResult[] = [];
      for (let offset = 0; offset < captureCandidates.length; offset += 6) {
        const batch = await client.inspectTargets(source.id, prepared.subtitleRevision, prepared.packageRevision,
          captureCandidates.slice(offset, offset + 6).map(candidate => candidate.key));
        if (!active) return;
        items.push(...batch.items);
      }
      if (active) setDictionary({ identity: dictionaryIdentity, items });
    })().catch((cause: unknown) => {
      if (active) setDictionaryError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setDictionaryPending(false); });
    return () => { active = false; };
  }, [client, open, dictionaryIdentity, dictionaryReload]);
  const dictionaryItems = dictionary?.identity === dictionaryIdentity ? dictionary.items : [];
  const resolvedCandidates = captureCandidates.flatMap(candidate => {
    const entry = dictionaryItems.find(item => item.state === 'available' && item.summary.targetId === candidate.key);
    return entry?.state === 'available' ? [{ ...candidate, content: { ...candidate.content,
      reading: entry.summary.reading ?? '', meaning: entry.summary.summary } }] : [];
  });
  visibleWords.current = new Set(resolvedCandidates.map(candidate => candidate.key));
  const practice = useSourcePractice(client, resolvedCandidates, identity, sessionId => {
    onOpenChange(false);
    router.push({ pathname: '../review', params: { sessionId } });
  });
  return <Dialog open={open} onOpenChange={onOpenChange} title={vocabulary ? 'Vocabulary' : 'Transcript'} presentation="sidebar"
    description={vocabulary ? '' : 'Exact, case-sensitive subtitle search.'}
    floatingControls={floatingControls}
    trigger={<Button ref={trigger} label="Transcript" icon="transcript" iconOnly size="compact" variant="media" disabled={!source.subtitleRevision} />}>
    <Select label="Sidebar content" value={vocabulary ? 'vocabulary' : 'transcript'}
      options={[{ value: 'transcript', label: 'Transcript' }, { value: 'vocabulary', label: 'Vocabulary' }]}
      onValueChange={value => onVocabularyChange(value === 'vocabulary')} />
    {!vocabulary ? <><TextField testID="transcript-search-input" label="Search transcript" variant="search" value={draft} onChangeText={setDraft}
      maxLength={128} autoCapitalize="none" autoCorrect={false} />
    <Row>
      <Button label="Search" size="compact" disabled={pending} onPress={() => {
        setPage(null); setAfter(null); setQuery(draft); setReload(value => value + 1);
      }} />
      <Button label="First page" icon="arrowLeft" iconOnly size="compact" variant="secondary" disabled={pending || after === null}
        onPress={() => { setPage(null); setAfter(null); }} />
      <Button label="Next page" icon="chevronRight" iconOnly size="compact" variant="secondary" disabled={pending || page?.nextIndex == null}
        onPress={() => { setAfter(page?.nextIndex ?? null); setPage(null); }} />
    </Row></> : <Text variant="detail" muted accessibilityLiveRegion="polite">
      {dictionaryPending || dictionary?.identity !== dictionaryIdentity ? 'Loading words…'
        : dictionaryError ? 'Words unavailable' : `${resolvedCandidates.length} words in this range`}
    </Text>}
    {pending ? <Text accessibilityLiveRegion="polite">Loading transcript…</Text> : null}
    {analysisPending ? <Text accessibilityLiveRegion="polite">Analyzing transcript…</Text> : null}
    {error ? <><Text accessibilityRole="alert">{error}</Text>
      <Button label="Retry transcript" onPress={() => setReload(value => value + 1)} /></> : null}
    {analysisError ? <><Text accessibilityRole="alert">{analysisError}</Text>
      <Button label="Retry transcript analysis" onPress={() => void refreshAnalysis().catch((cause: unknown) =>
        setAnalysisError(cause instanceof Error ? cause.message : String(cause)))} /></> : null}
    {!pending && !error && page?.cues.length === 0 ? <Text>No matching cues in this subtitle file.</Text> : null}
    {!vocabulary ? page?.cues.map(cue => <View key={cue.index} style={styles.cue}>
      <View style={styles.cueTime}><Button label={cueTime(cue.startMs - source.subtitleOffsetMs)}
        accessibilityLabel={`Go to cue ${cue.index + 1} at ${cueTime(cue.startMs - source.subtitleOffsetMs)}`}
        size="compact" variant="quiet" disabled={navigating} onPress={() => void seek(cue.index)} /></View>
      {navigationError?.cueIndex === cue.index ? <Text accessibilityRole="alert">{navigationError.message}</Text> : null}
      <AnnotatedText rawText={cue.text} variant="body" inspectionMode={source.inspectionTrigger}
        analysis={prepared?.cues.find(value => value.cue.index === cue.index && value.cue.text === cue.text) ?? null}
        annotations={prepared?.annotations ?? []} onInspect={(token, anchor) => void inspect(cue, token, anchor)} />
    </View>) : <><Row>
      <Button label="Practice" accessibilityLabel={practice.retry ? 'Retry original Word Practice request' : 'Practice saved words in this view'}
        size="compact" variant="secondary" busy={practice.pending} disabled={dictionaryPending || !resolvedCandidates.length && !practice.retry}
        onPress={() => void practice.start()} />
      <Button label="All" accessibilityLabel="All words" size="compact" variant="pill" accessibilityState={{ selected: !unknownOnly }}
        onPress={() => setUnknownOnly(false)} />
      <Button label="Unknown" accessibilityLabel="Unknown words" size="compact" variant="pill" accessibilityState={{ selected: unknownOnly }}
        onPress={() => setUnknownOnly(true)} />
    </Row>
    {practice.error ? <Text accessibilityRole="alert">{practice.error}</Text> : null}</>}
    {dictionaryPending ? <Text variant="caption" accessibilityLiveRegion="polite">Loading dictionary entries…</Text> : null}
    {dictionaryError ? <><Text accessibilityRole="alert">{dictionaryError}</Text>
      <Button label="Retry source dictionary" size="compact" onPress={() => setDictionaryReload(value => value + 1)} /></> : null}
    {dictionaryItems.map(item => item.state === 'unavailable'
      ? <Text key={item.targetId} variant="caption">{item.message}</Text> : null)}
    {!vocabulary ? <SourceCapture client={client} source={source} onChanged={() => setCaptureRefresh(value => value + 1)} /> : null}
    {resolvedCandidates.length ? <CaptureList client={client} candidates={resolvedCandidates} refreshKey={captureRefresh}
      presentation={vocabulary ? 'cards' : 'rows'}
      onInspect={vocabulary ? (candidate, anchor) => {
        const locator = candidate.content.source?.locator;
        if (locator?.kind !== 'video') return;
        const analyzed = prepared?.cues.find(cue => cue.cue.index === locator.cueIndex);
        const token = analyzed?.tokens.find(token => token.targets.includes(candidate.key));
        if (analyzed && token) void inspect(analyzed.cue, token, { ...anchor, restoreFocus: () => {
          if (visibleWords.current.has(candidate.key)) anchor.restoreFocus();
          else trigger.current?.focus();
        } });
      } : undefined}
      onLocate={vocabulary ? candidate => {
        const locator = candidate.content.source?.locator;
        if (locator?.kind === 'video' && locator.cueIndex !== null) void seek(locator.cueIndex);
      } : undefined}
      onOpenMaterial={id => router.push({ pathname: '../materials', params: { id, sourceId: source.id } })} /> : null}
    {children}
  </Dialog>;
}

const styles = StyleSheet.create(theme => ({
  cueTime: { alignSelf: 'flex-start' },
  cue: { gap: theme.spacing.small, paddingVertical: theme.spacing.small,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border },
}));
