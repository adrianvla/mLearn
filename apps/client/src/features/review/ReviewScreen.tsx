import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { StyleSheet } from 'react-native-unistyles';
import type { AuthoredMediaId, AuthoredPracticePreview, ReviewCommand, ReviewDelivery, ReviewEncounterId, ReviewGrade, ReviewMode, ReviewSession, TaskResponse } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { AppShell, Panel, Row, Stack } from '@mlearn/ui/layout';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { ReviewAudio } from '../review-media';
import { ActivityNavigation } from '../navigation';
import { RatingMatrix } from './RatingMatrix';
import { useReviewKeys } from './useReviewKeys';
import { CalibrationSetup } from './CalibrationSetup';
import { ExpertProbeSetup } from './ExpertProbeSetup';

type MutationAction = Parameters<RuntimeClient['prepareReviewMutation']>[1];
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

function practiceScope(mode: ReviewMode): string | null {
  switch (mode.kind) {
    case 'practice': return `${mode.items.length} selected Materials`;
    case 'authored_practice': return '1 authored Material';
    case 'target_practice':
      return `${mode.items.length} selected ${mode.items.length === 1 ? 'target' : 'targets'}`;
    case 'collection_practice': return 'Frozen collection selection';
    case 'calibration':
      return `${mode.items.length} selected calibration ${mode.items.length === 1 ? 'target' : 'targets'}`;
    case 'continuous':
    case 'finite': return null;
  }
}

export function ReviewScreen() {
  const host = useRuntime();
  return host.available ? <ReviewWorkspace client={host.client} media={host.authoredMedia} />
    : <AppShell header={<ActivityNavigation active="review">
      <Text variant="heading" accessibilityRole="header">Review</Text>
    </ActivityNavigation>}>
      <Text accessibilityRole="alert">{host.reason}</Text></AppShell>;
}

function ReviewWorkspace({ client, media }: {
  readonly client: RuntimeClient;
  readonly media: { readonly uri: (id: AuthoredMediaId) => Promise<string> };
}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string; activity?: string; packageId?: string; materialId?: string }>();
  const navigation = useNavigation();
  const [sessions, setSessions] = useState<ReviewSession[]>([]);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const current = useRef<ReviewSession | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [failed, setFailed] = useState<ReviewCommand | null>(null);
  const [limit, setLimit] = useState('20');
  const [sessionOptions, setSessionOptions] = useState(false);
  const [focused, setFocused] = useState(false);
  const scope = useRef<object | null>(null);
  const flight = useRef<Promise<ReviewSession | null> | null>(null);
  const endingScope = useRef(false);
  const failedCommand = useRef<ReviewCommand | null>(null);
  const readOwner = useRef<object | null>(null);
  const [returning, setReturning] = useState(false);
  const returnLock = useRef(false);
  const [returnError, setReturnError] = useState('');
  const audio = useRef<{ readonly cancel: () => Promise<void> } | null>(null);
  const validation = useRef<AbortController | null>(null);
  const [validating, setValidating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [taskDetails, setTaskDetails] = useState(false);
  const [draft, setDraft] = useState<{ readonly encounterId: ReviewEncounterId; readonly response: TaskResponse } | null>(null);

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
      if (restored && (current.current?.id !== restored.id || current.current.revision <= restored.revision)) {
        current.current = restored; setSession(restored);
      }
    } catch (cause) {
      if (scope.current === active && readOwner.current === read) setReadError(messageOf(cause));
    } finally {
      if (scope.current === active && readOwner.current === read) setLoading(false);
    }
  }, [client, params.sessionId]);
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  useFocusEffect(useCallback(() => {
    const active = {}; scope.current = active; setFocused(true);
    setPending(flight.current !== null); setFailed(failedCommand.current);
    void refresh();
    return () => {
      if (scope.current === active) { scope.current = null; readOwner.current = null; }
      validation.current?.abort();
      setFocused(false);
    };
  }, [refresh]));

  /** One prepared durable operation is retained through uncertain writes. */
  function execute(command: ReviewCommand): Promise<ReviewSession | null> {
    if (endingScope.current && command.kind !== 'stop') return Promise.resolve(null);
    if (flight.current) return flight.current;
    const active = scope.current;
    const controller = command.kind === 'capture_response' ? new AbortController() : null;
    validation.current = controller;
    setValidating(controller !== null); setStopping(false);
    setPending(true); setError('');
    const result = client.review(command, controller?.signal).then(commit => {
      failedCommand.current = null;
      if (scope.current === active && active) {
        publish(commit.session);
        setFailed(null);
      }
      return commit.session;
    }).catch(async (cause: unknown) => {
      let failure = cause;
      if (controller?.signal.aborted && cause instanceof RuntimeError && cause.code === 'cancelled'
        && command.kind === 'capture_response') {
        // Only confirmed native termination permits retiring this intent.
        // A commit can win the Stop race, so reload the authoritative capture.
        try {
          const restored = await client.reviewSession(command.mutation.sessionId);
          failedCommand.current = null;
          if (scope.current === active && active) { publish(restored); setFailed(null); }
          return restored;
        } catch (refreshFailure) { failure = refreshFailure; }
      }
      const rejectedAuthored = failure instanceof RuntimeError && failure.code === 'stale_authored_preview'
        && command.kind === 'start' && command.start.mode.kind === 'authored_practice';
      failedCommand.current = rejectedAuthored ? null : command;
      if (scope.current === active && active) {
        setFailed(rejectedAuthored ? null : command); setError(messageOf(failure));
      }
      return null;
    }).finally(() => {
      flight.current = null;
      if (validation.current === controller) validation.current = null;
      setValidating(false); setStopping(false);
      // Updating the saved-session route can renew focus during this write.
      // Pending belongs to the shared flight, not its previous focus scope.
      if (scope.current) setPending(false);
      if (scope.current && scope.current !== active) void latestRefresh.current();
    });
    flight.current = result;
    return result;
  }
  function mutate(action: MutationAction) {
    const value = current.current;
    if (!value || flight.current || failedCommand.current) return Promise.resolve(null);
    return execute(client.prepareReviewMutation(value, action));
  }
  async function endPractice() {
    const value = current.current;
    if (!value || value.mode.kind !== 'collection_practice' || flight.current || endingScope.current) return;
    const failed = failedCommand.current;
    if (failed === null) { await mutate({ kind: 'stop' }); return; }
    if (failed.kind !== 'next' || !scope.current) return;
    const active = scope.current;
    endingScope.current = true;
    setPending(true);
    try {
      // Next may already own a new encounter. End at the durable revision,
      // without abandoning an uncertain capture, grade or correction.
      const restored = await client.reviewSession(value.id);
      if (scope.current !== active) return;
      failedCommand.current = null;
      setFailed(null); setError('');
      if (restored.state === 'complete' || restored.state === 'stopped') publish(restored);
      else
        await execute(client.prepareReviewMutation(restored, { kind: 'stop' }));
    } catch (cause) {
      if (scope.current === active) setError(messageOf(cause));
    } finally {
      endingScope.current = false;
      if (scope.current === active) setPending(false);
    }
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

  async function depart(complete: () => void) {
    if (flight.current || failedCommand.current || returnLock.current) return;
    const active = scope.current;
    if (!active) return;
    const value = current.current;
    const encounterId = value?.encounter?.id;
    returnLock.current = true; setReturning(true);
    try {
      // Keep the existing command/retry owner live until this attempt drains.
      await audio.current?.cancel();
      if (scope.current !== active || failedCommand.current) return;
      const latest = current.current;
      if (latest?.id !== value?.id || latest?.encounter?.id !== encounterId) return;
      // A retried uncertain Started write can outlive its stopped audio owner.
      // Settle its acknowledged condition through the same delivery callback.
      if (latest?.state === 'active' && latest.encounter
        && (latest.encounter.conditions.delivery === 'pending' || latest.encounter.conditions.delivery === 'started')) {
        await delivery(latest.encounter.id, 'interrupted');
      }
      if (scope.current === active && !failedCommand.current
        && current.current?.id === value?.id && current.current?.encounter?.id === encounterId) complete();
    } catch (cause) {
      if (scope.current === active && !failedCommand.current) setError(messageOf(cause));
    } finally {
      returnLock.current = false;
      if (scope.current) setReturning(false);
    }
  }
  // Keep the write/retry owner alive for Back and gestures as well as Home.
  // Replay the original removal only after its audio interruption is durable.
  usePreventRemove(focused && (pending || failed !== null || returning
    || session?.state === 'active' && session.encounter?.requiredMedia != null
      && (session.encounter.conditions.delivery === 'pending' || session.encounter.conditions.delivery === 'started')),
  ({ data }) => { void depart(() => navigation.dispatch(data.action)); });

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
    if (flight.current || failedCommand.current || loading || returnLock.current) return;
    const value = await execute(client.prepareReviewStart(finite ? { kind: 'finite', limit: Number(limit) } : { kind: 'continuous' }));
    if (value && scope.current) router.setParams({ sessionId: value.id });
  }
  async function startAuthored(preview: AuthoredPracticePreview): Promise<boolean> {
    const active = scope.current;
    if (!active || flight.current || failedCommand.current || loading || returnLock.current) return false;
    const value = await execute(client.prepareReviewStart({
      kind: 'authored_practice', materialId: preview.materialId, materialRevision: preview.materialRevision,
      packageRevision: preview.packageRevision, fingerprint: preview.fingerprint,
    }));
    if (value && scope.current === active) {
      router.setParams({ sessionId: value.id });
      return true;
    }
    return false;
  }
  async function startCalibration(mode: Extract<ReviewMode, { kind: 'calibration' }>) {
    const active = scope.current;
    if (!active || flight.current || failedCommand.current || loading || returnLock.current) return;
    const value = await execute(client.prepareReviewStart(mode));
    if (value && scope.current === active) router.setParams({ sessionId: value.id });
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
      if (active && scope.current === active) {
        if (result.type === 'conversation_material_source') {
          router.push({ pathname: '../messenger', params: {
            id: result.conversation.id, messageId: result.message.id,
            messageSequence: String(result.message.sequence),
            reviewSessionId: value.id, reviewEncounterId: encounter.id,
          } });
        } else {
          router.push({ pathname: result.type === 'material_source' ? '/watch' : '../reader',
            params: { id: result.window.source.id, reviewSessionId: value.id, reviewEncounterId: encounter.id } });
        }
      }
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
  const responseSpec = encounter?.task?.responseSpec;
  const requiresCapture = responseSpec !== undefined && responseSpec.kind !== 'self_report';
  const response = encounter?.capture?.response ?? (draft?.encounterId === encounter?.id ? draft?.response : null);
  const canReveal = !requiresCapture || encounter?.capture != null;
  function captureResponse() {
    if (!actionable || !encounter || encounter.capture || !responseSpec) return;
    let input: TaskResponse;
    switch (responseSpec.kind) {
      case 'self_report': return;
      case 'typed_text': input = { kind: 'typed_text', text: response?.kind === 'typed_text' ? response.text : '' }; break;
      case 'choice_id':
        if (response?.kind !== 'choice_id') return;
        input = response; break;
    }
    try {
      void mutate({ kind: 'capture_response', encounterId: encounter.id, response: input });
    } catch (cause) { setError(messageOf(cause)); }
  }
  function reveal() {
    if (actionable && canReveal && encounter && !encounter.conditions.revealed && !audioPlaying)
      void mutate({ kind: 'reveal', encounterId: encounter.id });
  }
  useReviewKeys(focused && !blocked, (key, _at, alt) => {
    if (alt) return false;
    if ((key === ' ' || key === 'Enter') && actionable && canReveal && !encounter?.conditions.revealed && !audioPlaying) {
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
    await advance(await mutate({ kind: encounter.correction ? 'correct' : 'submit', response: {
      encounterId: encounter.id, grades, ...(encounter.capture ? { captureId: encounter.capture.id } : {}),
    } }));
  }
  const finiteValid = /^[1-9]\d{0,2}$/.test(limit) && Number(limit) <= 128;
  const selectedScope = session ? practiceScope(session.mode) : null;
  const calibrationSetup = params.activity === 'calibration';
  const authoringSetup = params.activity === 'authoring';
  const purpose = session?.mode.kind === 'calibration' || !session && calibrationSetup
    ? 'Word Sync' : !session && authoringSetup ? 'Author probes' : selectedScope ? 'Word Practice' : 'Review';
  const requestedSession = typeof params.sessionId === 'string' && params.sessionId.length > 0;
  const packageId = typeof params.packageId === 'string' ? params.packageId : undefined;
  const continuation = sessions.find(value => value.state === 'active' || value.state === 'paused' || value.state === 'unavailable');
  const recentSessions = !session && !requestedSession && sessions.length ? <Stack>
    <Text variant="section" accessibilityRole="header">{continuation ? 'Continue learning' : 'Recent sessions'}</Text>
    {[...(continuation ? [continuation] : []), ...sessions.filter(value => value.id !== continuation?.id)].map(value => {
      const selected = practiceScope(value.mode);
      const savedPurpose = value.mode.kind === 'calibration' ? 'Word Sync' : selected ? 'Word Practice' : 'Review';
      const continuing = value.id === continuation?.id;
      return <View key={value.id} style={styles.sessionRow}>
        <View style={styles.sessionCopy}>
          <Text variant="listTitle">{savedPurpose}</Text>
          <Text variant="caption" muted>{value.state} · {value.total === null
            ? `${value.completed} completed` : `${value.completed} / ${value.total}`}</Text>
          {selected ? <Text variant="caption" muted>{selected}</Text> : null}
        </View>
        <Button label={continuing ? `Continue ${savedPurpose}` : 'Open session'}
          accessibilityLabel={`Open ${savedPurpose} ${value.id}`}
          variant={continuing ? 'primary' : 'quiet'} disabled={blocked} onPress={() => void open(value.id)} />
      </View>;
    })}
  </Stack> : null;
  return <AppShell header={<Row>
    {session || requestedSession ? <>
      <Button label="Home" variant="quiet" disabled={pending || returning || failed !== null}
        onPress={() => router.dismissTo('/')} />
      <Text variant="heading" accessibilityRole="header">{purpose}</Text>
    </> : <ActivityNavigation active="review" {...(packageId ? { packageId } : {})}>
      <Text variant="heading" accessibilityRole="header">{purpose}</Text>
    </ActivityNavigation>}
    {!session && !requestedSession && (calibrationSetup || authoringSetup) ? <Button label="Back to Review" variant="quiet" disabled={blocked}
      onPress={() => router.setParams({ activity: '', materialId: '' })} /> : null}
    {session ? <Text variant="caption" muted>{session.total === null ? `${session.completed} ${selectedScope ? 'completed' : 'reviewed'}` : `${session.completed} / ${session.total}`}</Text> : null}
  </Row>}>
    <View style={styles.workspace}>
      {readError ? <Panel><Text accessibilityRole="alert">{readError}</Text><Button label="Retry Review sessions" onPress={() => void refresh()} /></Panel> : null}
      {loading ? <Text accessibilityLiveRegion="polite">Loading Review sessions…</Text> : null}
      {!calibrationSetup && !authoringSetup ? recentSessions : null}
      {!session && !requestedSession ? <Panel>
        {calibrationSetup ? <CalibrationSetup client={client}
          initialPackageId={typeof params.packageId === 'string' ? params.packageId : ''}
          disabled={blocked} onStart={startCalibration}
          onOpenKnowledge={packageId => router.push({ pathname: '/knowledge', params: { packageId } })} />
          : authoringSetup ? <ExpertProbeSetup client={client}
            materialId={typeof params.materialId === 'string' ? params.materialId : ''}
            disabled={blocked} onStart={startAuthored}
            onEdit={() => router.canGoBack() ? router.back()
              : router.push({ pathname: '/materials', params: { id: typeof params.materialId === 'string' ? params.materialId : '' } })} /> : <>
        <Text variant="section" accessibilityRole="header">Review what's due</Text>
        <Text muted>Review saved material when it is due.</Text>
        <Button label="Start Review" variant={continuation ? 'secondary' : 'primary'}
          disabled={blocked} onPress={() => void start(false)} />
        <View style={styles.optionGroup}>
          <Button label="Session size" variant="quiet" size="compact"
            icon={sessionOptions ? 'chevronDown' : 'chevronRight'} accessibilityState={{ expanded: sessionOptions }}
            onPress={() => setSessionOptions(value => !value)} />
          {sessionOptions ? <>
            <Text variant="caption" muted>Choose up to 128 items.</Text>
            <Row><TextField label="Finite Review limit" value={limit} onChangeText={setLimit} keyboardType="number-pad" maxLength={4} />
              <Button label="Start finite Review" variant="secondary" disabled={blocked || !finiteValid} onPress={() => void start(true)} /></Row>
          </> : null}
        </View>
        <View style={styles.optionGroup}>
          <Text variant="caption" muted>Practice a selection, or check unmeasured words.</Text>
          <Row><Button label="Word Practice" variant="secondary" disabled={blocked} onPress={() => router.push({
            pathname: '/knowledge', ...(packageId ? { params: { packageId } } : {}),
          })} />
          <Button label="Word Sync" variant="secondary" disabled={blocked} onPress={() => router.push({
            pathname: '/review', params: { activity: 'calibration', ...(packageId ? { packageId } : {}) },
          })} /></Row>
        </View>
        </>}
      </Panel> : session ? <>
        {selectedScope ? <Text variant="caption" muted>{selectedScope}</Text> : null}
        {session.message ? <Text accessibilityLiveRegion="polite">{session.message}</Text> : null}
        {session.state === 'paused' ? <Panel><Text>{purpose} paused</Text></Panel>
          : session.state === 'stopped' ? <Panel><Text>{purpose} ended</Text></Panel>
          : session.state === 'complete' ? <Panel><Text>{purpose} complete</Text></Panel>
          : session.state === 'unavailable' ? <Panel><Text>{purpose} unavailable</Text></Panel>
          : encounter ? <>
            <View style={styles.face} testID="review-cue">
              <Text variant="caption" muted>{encounter.direction === 'audio' ? 'Listen' : encounter.direction === 'focused' ? 'Focused recall' : 'Recall'}</Text>
              <Text selectable align="center" variant={encounter.direction === 'focused' ? 'reviewFocused' : 'reviewCue'}>{encounter.cue}</Text>
              {encounter.requiredMedia ? <ReviewAudio ref={audio} key={encounter.id} encounter={encounter} media={media}
                disabled={blocked} onDelivery={delivery} /> : null}
              {encounter.conditions.revealed && encounter.answer !== null ?
                <Text testID="review-answer" selectable align="center" variant="reviewExample">{encounter.answer}</Text> : null}
            </View>
            {responseSpec?.kind === 'typed_text' ? <TextField label="Your response"
              value={response?.kind === 'typed_text' ? response.text : ''}
              editable={!blocked && !encounter.capture} multiline multilineSize="compact" maxLength={responseSpec.maxBytes}
              onChangeText={text => setDraft({ encounterId: encounter.id, response: { kind: 'typed_text', text } })} /> : null}
            {responseSpec?.kind === 'choice_id' ? <Stack>
              {responseSpec.options.map(option => <Button key={option.id} label={option.label} variant="secondary"
                accessibilityState={{ selected: response?.kind === 'choice_id' && response.id === option.id }}
                disabled={blocked || !!encounter.capture}
                onPress={() => setDraft({ encounterId: encounter.id, response: { kind: 'choice_id', id: option.id } })} />)}
            </Stack> : null}
            {requiresCapture && !encounter.capture ? <Button label="Check response"
              disabled={!actionable || responseSpec?.kind === 'choice_id' && response?.kind !== 'choice_id'}
              onPress={captureResponse} /> : null}
            {validating ? <Button label={stopping ? 'Stopping validation' : 'Stop validation'} variant="secondary"
              disabled={stopping} onPress={() => { setStopping(true); validation.current?.abort(); }} /> : null}
            {encounter.capture?.feedback ? <Stack>
              {encounter.capture.feedback.outcomes.map(outcome => <Text key={outcome.targetId}>
                {encounter.targets.find(target => target.id === outcome.targetId)?.label}: {outcome.result}
                {outcome.reason ? ` · ${outcome.reason}` : ''}
              </Text>)}
            </Stack> : null}
            {encounter.correction ? <Text accessibilityLiveRegion="polite">Correct the original response. Its original retrieval conditions are retained.</Text> : null}
            {encounter.conditions.assistance.length ? <Text variant="caption" muted>Assistance: {encounter.conditions.assistance.join(', ')}</Text> : null}
            {encounter.conditions.revealed && encounter.answer !== null ?
              <RatingMatrix key={`${encounter.id}:${encounter.correction}`} targets={encounter.targets}
                focused={encounter.direction === 'focused'} disabled={!canRate} onSubmit={grades => void submit(grades)} />
              : <Button label="Reveal" detail="Space" disabled={!actionable || !canReveal || !!audioPlaying} onPress={reveal} />}
            {encounter.task && encounter.conditions.revealed ? <Stack>
              <Button label="Task details" variant="quiet" accessibilityState={{ expanded: taskDetails }}
                onPress={() => setTaskDetails(value => !value)} />
              {taskDetails ? <>
                <Text variant="caption" muted>{encounter.task.attribution}</Text>
                {encounter.task.limitations ? <Text variant="caption" muted>{encounter.task.limitations}</Text> : null}
              </> : null}
            </Stack> : null}
            {encounter.source ? <Button label="Return to source" variant="quiet" disabled={blocked || !!audioPlaying}
              onPress={() => void returnSource()} /> : null}
            {returnError ? <Text accessibilityRole="alert">{returnError}</Text> : null}
          </> : null}
        <View style={styles.optionGroup}>
          <Row>
            {session.state === 'active' ? <Button label="Pause" variant="quiet" disabled={blocked} onPress={() => void mutate({ kind: 'pause' })} />
              : session.state === 'paused' ? <Button label="Resume" disabled={blocked} onPress={() => void mutate({ kind: 'resume' })} /> : null}
            <Button label="Undo" detail="Z" variant="quiet" disabled={blocked || !session.canUndo || !!encounter?.correction || !!audioPlaying}
              onPress={() => void mutate({ kind: 'undo' })} />
            {!encounter && (session.state === 'active' || session.state === 'unavailable') ? <Button label={session.state === 'unavailable' ? 'Retry due Review' : 'Next'} disabled={blocked}
              onPress={() => void mutate({ kind: 'next' })} /> : null}
            <Button label="Sessions" variant="quiet" disabled={blocked || !!audioPlaying}
              onPress={() => { current.current = null; setSession(null); router.setParams({ sessionId: '' }); }} />
            {session.mode.kind === 'collection_practice' && session.state !== 'complete' && session.state !== 'stopped'
              ? <Button label="End Practice" variant="quiet"
                disabled={pending || loading || returning || failed !== null && failed.kind !== 'next' || !!audioPlaying}
                onPress={() => void endPractice()} /> : null}
          </Row>
        </View>
      </> : null}
      {pending ? <Text accessibilityLiveRegion="polite">Saving {purpose}…</Text> : null}
      {error ? <Panel><Text accessibilityRole="alert">{error}</Text>
        {failed ? <Button label="Retry Review save" busy={pending} onPress={() => {
          void execute(failed).then(value => {
            if (value && scope.current && failed.kind === 'start') router.setParams({ sessionId: value.id });
            return failed.kind === 'submit' || failed.kind === 'correct' ? advance(value) : undefined;
          });
        }} /> : null}</Panel> : null}
      {calibrationSetup || authoringSetup ? recentSessions : null}
    </View>
  </AppShell>;
}
const styles = StyleSheet.create(theme => ({
  workspace: { width: '100%', maxWidth: 500, alignSelf: 'center', minWidth: 0, gap: theme.spacing.medium },
  optionGroup: { gap: theme.spacing.small, paddingTop: theme.spacing.medium, borderTopWidth: 1, borderColor: theme.colors.border },
  sessionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.small,
    paddingVertical: theme.spacing.small, borderBottomWidth: 1, borderColor: theme.colors.border },
  sessionCopy: { flexGrow: 1, flexBasis: '50%', minWidth: 0, gap: theme.spacing.tiny },
  face: {
    minHeight: 300, width: '100%', minWidth: 0, alignItems: 'center', justifyContent: 'center',
    padding: theme.spacing.large, gap: theme.spacing.medium, backgroundColor: theme.surfaces.glass,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius,
  },
}));
