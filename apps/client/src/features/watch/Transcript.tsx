import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { SourceRecord, TranscriptPage, AnalysisBatch, AnalyzedToken, Cue } from '@mlearn/contracts';
import type { TextAnchor } from '@mlearn/ui/inline-word';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Menu } from '@mlearn/ui/menu';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { failure, type Failure } from '../failure';
import { AnnotatedText } from '../annotated-text';
import type { Inspection } from '../inspector';
import { cueAnchor, emptyMaterial, CaptureList, SourceCapture, useCandidateMeanings, useSourcePractice, type CaptureCandidate } from '../material';
import { useRouter } from 'expo-router';

const known = (status: CaptureCandidate['knowledgeStatus']) => status === 'claimed_known' || status === 'assessed_known';

export function cueTime(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Bounded source navigation. Cue text/timestamps are never rewritten for display. */
export function Transcript({ client, source, open, onOpenChange, onSeek, analysis, onAnalysis, onInspect, hovered,
  vocabulary, onVocabularyChange, floatingControls, children }: PropsWithChildren<{
  client: RuntimeClient;
  source: SourceRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSeek: (positionMs: number) => number | null;
  analysis: AnalysisBatch | null;
  onAnalysis: (analysis: AnalysisBatch | null) => void;
  onInspect: (inspection: Inspection) => void;
  hovered: ReadonlySet<string>;
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
  const [order, setOrder] = useState<'subtitle' | 'unknown'>('subtitle');
  const [filter, setFilter] = useState<'all' | 'dictionary' | 'hovered'>('all');
  const trigger = useRef<View>(null);
  const visibleWords = useRef(new Set<string>());
  const [page, setPage] = useState<TranscriptPage | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [analysisError, setAnalysisError] = useState<Failure | null>(null);
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
  const [returnPosition, setReturnPosition] = useState<number | null>(null);
  const [navigationError, setNavigationError] = useState<{ cueIndex: number; failure: Failure } | null>(null);
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
    setAnalysisError(null);
  }
  async function seek(cueIndex: number) {
    if (navigating || !source.subtitleRevision) return;
    setNavigating(true);
    setNavigationError(null);
    const owner = generation.current;
    try {
      const position = await client.cuePosition(source.id, source.subtitleRevision, cueIndex);
      if (current.current !== identity || generation.current !== owner) return;
      const previous = onSeek(position);
      if (previous === null) throw new Error('Playback is not ready. Close Transcript and retry after the video loads.');
      setReturnPosition(value => value ?? previous);
    } catch (cause) {
      if (current.current === identity && generation.current === owner)
        setNavigationError({ cueIndex, failure: failure(cause, 'This line couldn’t be opened.') });
    } finally {
      if (generation.current === owner) setNavigating(false);
    }
  }
  function returnToPlayback() {
    if (returnPosition === null || navigating) return;
    try {
      if (onSeek(returnPosition) === null)
        throw new Error('Playback is not ready. Close Transcript and retry after the video loads.');
      setReturnPosition(null); setNavigationError(null);
    } catch (cause) {
      setNavigationError({ cueIndex: -1, failure: failure(cause, 'Playback couldn’t return to where you were.') });
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
    setError(null);
    setAnalysisError(null);
    setAnalysisPending(true);
    onAnalysis(null);
    void refreshAnalysis().catch((cause: unknown) => {
      if (active) setAnalysisError(failure(cause, 'Words in this transcript couldn’t be analyzed.'));
    }).finally(() => { if (active) setAnalysisPending(false); });
    void client.transcript(source.id, after, query).then(value => {
      if (active && value.sourceId === source.id && value.subtitleRevision === source.subtitleRevision)
        setPage(value);
    }).catch((cause: unknown) => {
      if (active) setError(failure(cause, 'The transcript couldn’t be loaded.'));
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
        setNavigationError({ cueIndex: cue.index, failure: failure(cause, 'This line couldn’t be opened.') });
    }
  }
  const captureCandidates: CaptureCandidate[] = [];
  const seen = new Set<string>();
  for (const analyzed of prepared?.cues ?? []) for (const token of analyzed.tokens) {
    const targetId = token.targets[0];
    const status = prepared?.annotations.find(annotation => annotation.cueIndex === analyzed.cue.index
      && annotation.tokenStart === token.start)?.status ?? 'pending';
    if (!targetId || vocabulary && filter === 'dictionary' && token.nearbyMeaning === false || seen.has(targetId) || captureCandidates.length >= 128
      || vocabulary && filter === 'hovered' && !token.targets.some(target => hovered.has(target))) continue;
    seen.add(targetId);
    // The bulk action resolves each selected cue's native media time on demand.
    captureCandidates.push({ key: targetId, knowledgeStatus: status, presentation: token.presentation, resolveCuePosition: true, content: { ...emptyMaterial(source.packageId),
      targetId, packageRevision: prepared?.packageRevision ?? null, phrase: token.text, context: analyzed.cue.text,
      source: cueAnchor(source, analyzed.cue, token, Math.max(0, analyzed.cue.startMs - source.subtitleOffsetMs)) } });
  }
  // "Unknown first" orders, it does not hide: known words keep their place after the rest (stable sort).
  if (vocabulary && order === 'unknown') captureCandidates.sort((a, b) => Number(known(a.knowledgeStatus)) - Number(known(b.knowledgeStatus)));
  const meanings = useCandidateMeanings(open && prepared ? ids => client.inspectTargets(source.id, prepared.subtitleRevision,
    prepared.packageRevision, ids).then(batch => batch.items) : null,
    JSON.stringify([prepared?.sourceId, prepared?.subtitleRevision, prepared?.packageRevision]), captureCandidates);
  const dictionaryItems = meanings.items;
  const dictionaryPending = meanings.pending;
  const dictionaryError = meanings.error;
  const resolvedCandidates = captureCandidates.flatMap(candidate => meanings.resolve(candidate) ?? []);
  visibleWords.current = new Set(resolvedCandidates.map(candidate => candidate.key));
  const practice = useSourcePractice(client, resolvedCandidates, identity, sessionId => {
    onOpenChange(false);
    router.push({ pathname: '../review', params: { sessionId } });
  });
  const sourceFeedback = <>
    {pending ? <Text accessibilityLiveRegion="polite">Loading transcript…</Text> : null}
    {analysisPending ? <Text accessibilityLiveRegion="polite">Analyzing transcript…</Text> : null}
    {error ? <FailureNotice message={error.message} detail={error.detail}>
      <Button label="Retry" accessibilityLabel="Retry transcript" onPress={() => setReload(value => value + 1)} /></FailureNotice> : null}
    {analysisError ? <FailureNotice message={analysisError.message} detail={analysisError.detail}>
      <Button label="Retry" accessibilityLabel="Retry transcript analysis" onPress={() => void refreshAnalysis().catch((cause: unknown) =>
        setAnalysisError(failure(cause, 'Words in this transcript couldn’t be analyzed.')))} /></FailureNotice> : null}
    {!pending && !error && page?.cues.length === 0 ? <Text>No matching cues</Text> : null}
  </>;
  const dictionaryFeedback = <>
    {dictionaryPending ? <Text variant="caption" accessibilityLiveRegion="polite">Loading dictionary entries…</Text> : null}
    {dictionaryError ? <FailureNotice message={dictionaryError.message} detail={dictionaryError.detail}>
      <Button label="Retry" accessibilityLabel="Retry source dictionary" size="compact" onPress={meanings.retry} /></FailureNotice> : null}
    {dictionaryItems.map(item => item.state === 'unavailable'
      ? <Text key={item.targetId} variant="caption">{item.message}</Text> : null)}
  </>;
  const vocabularyControls = <>
    <Row>
      <Button label="Practise" accessibilityLabel={practice.retry ? 'Retry original Word Practice request' : 'Practice words in this view'}
        size="compact" variant="secondary" tone="warning" busy={practice.pending} disabled={dictionaryPending || !resolvedCandidates.length && !practice.retry}
        onPress={() => void practice.start()} />
    </Row>
    <View style={styles.order}><Select label="Word order" size="compact" value={order}
      options={[{ value: 'subtitle', label: 'Subtitle order' }, { value: 'unknown', label: 'Unknown first' }]}
      onValueChange={value => setOrder(value === 'unknown' ? 'unknown' : 'subtitle')} /></View>
    <Row>
      {([['all', 'All'], ['dictionary', 'Dictionary only'], ['hovered', 'Hovered words']] as const).map(([value, label]) =>
        <Button key={value} label={label} variant="pill" tone={filter === value ? 'info' : 'neutral'} size="compact"
          accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} />)}
    </Row>
    {practice.error ? <FailureNotice message={practice.error.message} detail={practice.error.detail} /> : null}
    {sourceFeedback}
    {dictionaryFeedback}
  </>;
  return <View>
    <Menu ref={trigger} label="Transcript" icon="transcript" disabled={!source.subtitleRevision} actions={[
      { id: 'transcript', label: 'Transcript', current: open && !vocabulary,
        onPress: () => { onVocabularyChange(false); onOpenChange(true); } },
      { id: 'vocabulary', label: 'Vocabulary', current: open && vocabulary,
        onPress: () => { onVocabularyChange(true); onOpenChange(true); } },
    ]} />
    <Dialog open={open} onOpenChange={onOpenChange} title={vocabulary ? 'Vocabulary' : 'Transcript'} presentation="sidebar" modal={false}
    description={vocabulary ? dictionaryPending ? 'Loading words…'
      : dictionaryError ? 'Words unavailable' : `${resolvedCandidates.length} words in this range`
      : 'Exact, case-sensitive subtitle search.'}
    floatingControls={floatingControls}
    focusTarget={() => trigger.current}>
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
    </Row></> : null}
    {returnPosition !== null ? <Row>
      <Button label="Return to playback position" variant="secondary" size="compact"
        disabled={navigating} onPress={returnToPlayback} />
      {navigationError?.cueIndex === -1 ? <FailureNotice message={navigationError.failure.message} detail={navigationError.failure.detail} /> : null}
    </Row> : null}
    {!vocabulary ? sourceFeedback : null}
    {!vocabulary ? page?.cues.map(cue => <View key={cue.index} style={styles.cue}>
      <View style={styles.cueTime}><Button label={cueTime(cue.startMs - source.subtitleOffsetMs)}
        accessibilityLabel={`Go to cue ${cue.index + 1} at ${cueTime(cue.startMs - source.subtitleOffsetMs)}`}
        size="compact" variant="quiet" disabled={navigating} onPress={() => void seek(cue.index)} /></View>
      {navigationError?.cueIndex === cue.index ? <FailureNotice message={navigationError.failure.message} detail={navigationError.failure.detail} /> : null}
      <AnnotatedText rawText={cue.text} variant="body" inspectionMode={source.inspectionTrigger}
        analysis={prepared?.cues.find(value => value.cue.index === cue.index && value.cue.text === cue.text) ?? null}
        annotations={prepared?.annotations ?? []} onInspect={(token, anchor) => void inspect(cue, token, anchor)} />
    </View>) : null}
    {!vocabulary ? dictionaryFeedback : null}
    {!vocabulary ? <SourceCapture client={client} source={source} onChanged={() => setCaptureRefresh(value => value + 1)} /> : null}
    {resolvedCandidates.length || vocabulary ? <CaptureList client={client} candidates={resolvedCandidates} refreshKey={captureRefresh}
      presentation={vocabulary ? 'cards' : 'rows'} header={vocabulary ? vocabularyControls : undefined}
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
  </Dialog></View>;
}

const styles = StyleSheet.create(theme => ({
  cueTime: { alignSelf: 'flex-start' },
  order: { alignSelf: 'flex-start', minWidth: 160 },
  cue: { gap: theme.spacing.small, paddingVertical: theme.spacing.small,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border },
}));
