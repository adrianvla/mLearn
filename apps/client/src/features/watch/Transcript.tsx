import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { SourceRecord, TranscriptPage, AnalysisBatch } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { AnnotatedText } from '../annotated-text';
import type { Inspection } from '../inspector';

export function cueTime(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Bounded source navigation. Cue text/timestamps are never rewritten for display. */
export function Transcript({ client, source, open, onOpenChange, onSeek, analysis, onAnalysis, onInspect, children }: PropsWithChildren<{
  client: RuntimeClient;
  source: SourceRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSeek: (positionMs: number) => void;
  analysis: AnalysisBatch | null;
  onAnalysis: (analysis: AnalysisBatch | null) => void;
  onInspect: (inspection: Inspection) => void;
}>) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [after, setAfter] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
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
  return <Dialog open={open} onOpenChange={onOpenChange} title="Transcript" presentation="sidebar"
    description="Exact, case-sensitive subtitle search."
    trigger={<Button label="Transcript" icon="transcript" iconOnly size="compact" variant="media" disabled={!source.subtitleRevision} />}>
    <TextField testID="transcript-search-input" label="Search transcript" variant="search" value={draft} onChangeText={setDraft}
      maxLength={128} autoCapitalize="none" autoCorrect={false} />
    <Row>
      <Button label="Search" size="compact" disabled={pending} onPress={() => {
        setPage(null); setAfter(null); setQuery(draft); setReload(value => value + 1);
      }} />
      <Button label="First page" icon="arrowLeft" iconOnly size="compact" variant="secondary" disabled={pending || after === null}
        onPress={() => { setPage(null); setAfter(null); }} />
      <Button label="Next page" icon="chevronRight" iconOnly size="compact" variant="secondary" disabled={pending || page?.nextIndex == null}
        onPress={() => { setAfter(page?.nextIndex ?? null); setPage(null); }} />
    </Row>
    {pending ? <Text accessibilityLiveRegion="polite">Loading transcript…</Text> : null}
    {analysisPending ? <Text accessibilityLiveRegion="polite">Analyzing transcript…</Text> : null}
    {error ? <><Text accessibilityRole="alert">{error}</Text>
      <Button label="Retry transcript" onPress={() => setReload(value => value + 1)} /></> : null}
    {analysisError ? <><Text accessibilityRole="alert">{analysisError}</Text>
      <Button label="Retry transcript analysis" onPress={() => void refreshAnalysis().catch((cause: unknown) =>
        setAnalysisError(cause instanceof Error ? cause.message : String(cause)))} /></> : null}
    {!pending && !error && page?.cues.length === 0 ? <Text>No matching cues in this subtitle file.</Text> : null}
    {page?.cues.map(cue => <View key={cue.index} style={styles.cue}>
      <View style={styles.cueTime}><Button label={cueTime(cue.startMs - source.subtitleOffsetMs)}
        accessibilityLabel={`Go to cue ${cue.index + 1} at ${cueTime(cue.startMs - source.subtitleOffsetMs)}`}
        size="compact" variant="quiet" disabled={navigating} onPress={() => void seek(cue.index)} /></View>
      {navigationError?.cueIndex === cue.index ? <Text accessibilityRole="alert">{navigationError.message}</Text> : null}
      <AnnotatedText rawText={cue.text} variant="body" inspectionMode={source.inspectionTrigger}
        analysis={prepared?.cues.find(value => value.cue.index === cue.index && value.cue.text === cue.text) ?? null}
        annotations={prepared?.annotations ?? []} onInspect={(token, anchor) => onInspect({
          sourceForm: token.text, context: cue.text, targets: token.targets, anchor,
          packageRevision: prepared?.packageRevision,
          showContext: true, onChanged: refreshAnalysis,
        })} />
    </View>)}
    {children}
  </Dialog>;
}

const styles = StyleSheet.create(theme => ({
  cueTime: { alignSelf: 'flex-start' },
  cue: { gap: theme.spacing.small, paddingVertical: theme.spacing.small,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border },
}));
