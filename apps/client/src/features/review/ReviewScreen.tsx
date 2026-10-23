import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import type { AuthoredMediaId, ReviewCommand, ReviewDelivery, ReviewEncounterId, ReviewGrade, ReviewSession } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { AppShell, Panel, Row, Stack } from '@mlearn/ui/layout';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { ReviewAudio } from '../review-media';
import { RatingMatrix } from './RatingMatrix';
import { useReviewKeys } from './useReviewKeys';

type MutationAction = Parameters<RuntimeClient['prepareReviewMutation']>[1];
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function ReviewScreen() {
  const host = useRuntime();
  const router = useRouter();
  return host.available ? <ReviewWorkspace client={host.client} media={host.authoredMedia} />
    : <AppShell header={<Row><Button label="Home" variant="quiet" onPress={() => router.replace('/')} />
      <Text variant="heading" accessibilityRole="header">Review</Text></Row>}>
      <Text accessibilityRole="alert">{host.reason}</Text></AppShell>;
}

function ReviewWorkspace({ client, media }: {
  readonly client: RuntimeClient;
  readonly media: { readonly uri: (id: AuthoredMediaId) => Promise<string> };
}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const current = useRef<ReviewSession | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [failed, setFailed] = useState<ReviewCommand | null>(null);
  const [limit, setLimit] = useState('20');
  const [focused, setFocused] = useState(false);
  const scope = useRef<object | null>(null);
  const flight = useRef<Promise<ReviewSession | null> | null>(null);
  const failedCommand = useRef<ReviewCommand | null>(null);
  const readOwner = useRef<object | null>(null);
  const [returning, setReturning] = useState(false);
  const returnLock = useRef(false);
  const [returnError, setReturnError] = useState('');

  function publish(value: ReviewSession) {
    current.current = value;
    setSession(value);
    setSessions(previous => [value, ...previous.filter(item => item.id !== value.id)].slice(0, 32));
  }
  const refresh = useCallback(async () => {
    const active = scope.current;
    if (!active) return;
    const read = {}; readOwner.current = read;
    setLoading(true); setReadError('');
    try {
      const values = await client.reviewSessions();
      const requested = typeof params.sessionId === 'string' ? params.sessionId : null;
      const restored = requested ? await client.reviewSession(requested) : null;
      if (scope.current !== active || readOwner.current !== read) return;
      setSessions(values);
      if (restored && (!current.current || current.current.id === restored.id && current.current.revision <= restored.revision)) {
        current.current = restored; setSession(restored);
      }
    } catch (cause) {
      if (scope.current === active && readOwner.current === read) setReadError(messageOf(cause));
    } finally {
      if (scope.current === active && readOwner.current === read) setLoading(false);
    }
  }, [client, params.sessionId]);
  useFocusEffect(useCallback(() => {
    const active = {}; scope.current = active; setFocused(true);
    setPending(flight.current !== null); setFailed(failedCommand.current);
    void refresh();
    return () => {
      if (scope.current === active) { scope.current = null; readOwner.current = null; }
      setFocused(false);
    };
  }, [refresh]));

  /** One prepared durable operation is retained through uncertain writes. */
  function execute(command: ReviewCommand): Promise<ReviewSession | null> {
    if (flight.current) return flight.current;
    const active = scope.current;
    setPending(true); setError('');
    const result = client.review(command).then(commit => {
      failedCommand.current = null;
      if (scope.current === active && active) {
        publish(commit.session);
        setFailed(null);
      }
      return commit.session;
    }).catch((cause: unknown) => {
      failedCommand.current = command;
      if (scope.current === active && active) { setFailed(command); setError(messageOf(cause)); }
      return null;
    }).finally(() => {
      flight.current = null;
      // Updating the saved-session route can renew focus during this write.
      // Pending belongs to the shared flight, not its previous focus scope.
      if (scope.current) setPending(false);
    });
    flight.current = result;
    return result;
  }
  function mutate(action: MutationAction) {
    const value = current.current;
    if (!value || flight.current || failedCommand.current) return Promise.resolve(null);
    return execute(client.prepareReviewMutation(value, action));
  }
  const delivery = useCallback(async (encounterId: ReviewEncounterId, value: ReviewDelivery) => {
    // Playback owns at most one awaited transition. Prepare only after the
    // preceding command commits, so it cannot reuse a stale session revision.
    if (flight.current) await flight.current;
    const latest = current.current;
    if (!scope.current || latest?.encounter?.id !== encounterId)
      throw new RuntimeError('cancelled', 'The audio encounter is no longer active.');
    // Pause atomically persists interruption before unmounting the player.
    // Its cleanup acknowledges that state instead of issuing a paused mutation.
    if (latest.state === 'paused' && value === 'interrupted' && latest.encounter.conditions.delivery === 'interrupted')
      return;
    if (latest.state !== 'active')
      throw new RuntimeError('cancelled', 'The audio session is no longer active.');
    if (failedCommand.current)
      throw new RuntimeError('busy', 'Retry the pending Review save first.');
    const saved = await execute(client.prepareReviewMutation(latest, { kind: 'delivery', encounterId, delivery: value }));
    if (!saved) throw new RuntimeError('unavailable', 'Audio delivery could not be saved. Retry the Review save.');
  }, [client]);

  async function open(id: string) {
    if (flight.current || failedCommand.current || loading || returnLock.current) return;
    const active = scope.current;
    const read = {}; readOwner.current = read;
    setLoading(true); setReadError('');
    try {
      const value = await client.reviewSession(id);
      if (active && scope.current === active && readOwner.current === read) {
        publish(value);
        router.setParams({ sessionId: value.id });
      }
    } catch (cause) {
      if (scope.current === active && readOwner.current === read) setReadError(messageOf(cause));
    } finally {
      if (scope.current === active && readOwner.current === read) setLoading(false);
    }
  }
  async function start(finite: boolean) {
    if (flight.current || failedCommand.current || loading) return;
    const value = await execute(client.prepareReviewStart(finite ? { kind: 'finite', limit: Number(limit) } : { kind: 'continuous' }));
    if (value && scope.current) router.setParams({ sessionId: value.id });
  }
  async function returnSource() {
    const value = current.current;
    const encounter = value?.encounter;
    if (!value || !encounter?.source || flight.current || failedCommand.current || returnLock.current) return;
    returnLock.current = true; setReturning(true); setReturnError('');
    const active = scope.current;
    try {
      // Persist changed retrieval conditions before opening any source content.
      const marked = await mutate({ kind: 'assistance', encounterId: encounter.id, assistance: 'source' });
      if (!marked || scope.current !== active) return;
      const result = await client.returnReviewSource(value.id, encounter.id);
      if (active && scope.current === active)
        router.push({ pathname: result.type === 'document_material_source' ? '../reader' : '/watch',
          params: { id: result.window.source.id, reviewSessionId: value.id, reviewEncounterId: encounter.id } });
    } catch (cause) {
      if (scope.current === active) setReturnError(messageOf(cause));
    } finally {
      returnLock.current = false;
      if (scope.current === active) setReturning(false);
    }
  }
  const encounter = session?.encounter;
  const audioPlaying = encounter?.conditions.delivery === 'pending' || encounter?.conditions.delivery === 'started';
  const blocked = pending || failed !== null || loading || returning;
  const actionable = focused && session?.state === 'active' && !!encounter && !blocked;
  const canRate = actionable && encounter.conditions.revealed && encounter.answer !== null && !audioPlaying;
  function reveal() {
    if (actionable && encounter && !encounter.conditions.revealed && !audioPlaying)
      void mutate({ kind: 'reveal', encounterId: encounter.id });
  }
  useReviewKeys(focused && !blocked, (key, _at, alt) => {
    if (alt) return false;
    if ((key === ' ' || key === 'Enter') && actionable && !encounter?.conditions.revealed && !audioPlaying) {
      reveal(); return true;
    }
    if ((key.toLowerCase() === 'z' || key === 'Backspace') && session?.canUndo && !encounter?.correction && !audioPlaying) {
      void mutate({ kind: 'undo' }); return true;
    }
    return false;
  });
  async function advance(value: ReviewSession | null) {
    if (scope.current && value?.state === 'active' && !value.encounter) await mutate({ kind: 'next' });
  }
  async function submit(grades: ReviewGrade[]) {
    if (!canRate || !encounter) return;
    await advance(await mutate({ kind: encounter.correction ? 'correct' : 'submit', response: { encounterId: encounter.id, grades } }));
  }
  const finiteValid = /^[1-9]\d{0,2}$/.test(limit) && Number(limit) <= 128;
  return <AppShell header={<Row>
    <Button label="Home" variant="quiet" disabled={pending || returning}
      onPress={() => router.replace('/')} />
    <Text variant="heading" accessibilityRole="header">Review</Text>
    {session ? <Text variant="caption" muted>{session.total === null ? `${session.completed} reviewed` : `${session.completed} / ${session.total}`}</Text> : null}
  </Row>}>
    <View style={styles.workspace}>
      {readError ? <Panel><Text accessibilityRole="alert">{readError}</Text><Button label="Retry Review sessions" onPress={() => void refresh()} /></Panel> : null}
      {loading ? <Text accessibilityLiveRegion="polite">Loading Review sessions…</Text> : null}
      {!session ? <Panel>
        <Button label="Start Review" disabled={blocked} onPress={() => void start(false)} />
        <Row><TextField label="Finite Review limit" value={limit} onChangeText={setLimit} keyboardType="number-pad" maxLength={4} />
          <Button label="Start finite Review" disabled={blocked || !finiteValid} onPress={() => void start(true)} /></Row>
      </Panel> : <>
        <Row>
          {session.state === 'active' ? <Button label="Pause" disabled={blocked} onPress={() => void mutate({ kind: 'pause' })} />
            : session.state === 'paused' ? <Button label="Resume" disabled={blocked} onPress={() => void mutate({ kind: 'resume' })} /> : null}
          <Button label="Undo" detail="Z" disabled={blocked || !session.canUndo || !!encounter?.correction || !!audioPlaying}
            onPress={() => void mutate({ kind: 'undo' })} />
          {!encounter && (session.state === 'active' || session.state === 'unavailable') ? <Button label={session.state === 'unavailable' ? 'Retry due Review' : 'Next'} disabled={blocked}
            onPress={() => void mutate({ kind: 'next' })} /> : null}
          <Button label="Sessions" variant="quiet" disabled={blocked || !!audioPlaying}
            onPress={() => { current.current = null; setSession(null); router.setParams({ sessionId: '' }); }} />
        </Row>
        {session.message ? <Text accessibilityLiveRegion="polite">{session.message}</Text> : null}
        {session.state === 'paused' ? <Panel><Text>Review paused</Text></Panel>
          : session.state === 'complete' ? <Panel><Text>Review complete</Text></Panel>
          : session.state === 'unavailable' ? <Panel><Text>Review unavailable</Text></Panel>
          : encounter ? <>
            <View style={styles.face} testID="review-cue">
              <Text variant="caption" muted>{encounter.direction === 'audio' ? 'Listen' : encounter.direction === 'focused' ? 'Focused recall' : 'Recall'}</Text>
              <Text selectable align="center" variant={encounter.direction === 'focused' ? 'reviewFocused' : 'reviewCue'}>{encounter.cue}</Text>
              {encounter.requiredMedia ? <ReviewAudio key={encounter.id} encounter={encounter} media={media}
                disabled={blocked} onDelivery={delivery} /> : null}
              {encounter.conditions.revealed && encounter.answer !== null ?
                <Text testID="review-answer" selectable align="center" variant="reviewExample">{encounter.answer}</Text> : null}
            </View>
            {encounter.correction ? <Text accessibilityLiveRegion="polite">Correct the original response. Its original retrieval conditions are retained.</Text> : null}
            {encounter.conditions.assistance.length ? <Text variant="caption" muted>Assistance: {encounter.conditions.assistance.join(', ')}</Text> : null}
            {encounter.conditions.revealed && encounter.answer !== null ?
              <RatingMatrix key={`${encounter.id}:${encounter.correction}`} targets={encounter.targets}
                focused={encounter.direction === 'focused'} disabled={!canRate} onSubmit={grades => void submit(grades)} />
              : <Button label="Reveal" detail="Space" disabled={!actionable || !!audioPlaying} onPress={reveal} />}
            {encounter.source ? <Button label="Return to source" variant="quiet" disabled={blocked || !!audioPlaying}
              onPress={() => void returnSource()} /> : null}
            {returnError ? <Text accessibilityRole="alert">{returnError}</Text> : null}
          </> : null}
      </>}
      {pending ? <Text accessibilityLiveRegion="polite">Saving Review…</Text> : null}
      {error ? <Panel><Text accessibilityRole="alert">{error}</Text>
        {failed ? <Button label="Retry Review save" busy={pending} onPress={() => {
          void execute(failed).then(value => failed.kind === 'submit' || failed.kind === 'correct' ? advance(value) : undefined);
        }} /> : null}</Panel> : null}
      {!session && sessions.length ? <Stack><Text variant="section">Recent sessions</Text>
        {sessions.map(value => <Panel key={value.id}>
          <Text>{value.mode.kind === 'finite' ? 'Finite Review' : 'Continuous Review'} · {value.state} · {value.completed} reviewed</Text>
          <Button label={`Open Review ${value.id}`} disabled={blocked} onPress={() => void open(value.id)} />
        </Panel>)}</Stack> : null}
    </View>
  </AppShell>;
}
const styles = StyleSheet.create(theme => ({
  workspace: { width: '100%', maxWidth: 500, alignSelf: 'center', minWidth: 0, gap: theme.spacing.medium },
  face: {
    minHeight: 300, width: '100%', minWidth: 0, alignItems: 'center', justifyContent: 'center',
    padding: theme.spacing.large, gap: theme.spacing.medium, backgroundColor: theme.surfaces.glass,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius,
  },
}));
