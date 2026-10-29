import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import type { ConversationGeneration, ConversationRetry, SourceAnchor } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { MaterialProposalReview } from '../material';

type Flight = {
  readonly admit: () => Promise<ConversationGeneration>;
  readonly sourceIdentity: string;
  admission: Promise<ConversationGeneration> | null;
  cancellation: Promise<void> | null;
  cancelled: boolean;
  generation: ConversationGeneration | null;
  stop: ReturnType<RuntimeClient['prepareConversationStop']> | null;
  wake: (() => void) | null;
};
const running = (generation: ConversationGeneration | null) =>
  generation?.status === 'pending' || generation?.status === 'streaming';

/** Presentation lifetime only; the shared native generation owner owns the job. */
export function SourceActions({ client, source, tone = 'content', explanationDisabledReason, disabled = false }: {
  readonly client: RuntimeClient;
  readonly source: SourceAnchor;
  readonly tone?: 'content' | 'media';
  readonly explanationDisabledReason?: string;
  readonly disabled?: boolean;
}) {
  const host = useRuntime();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const proposalTrigger = useRef<View>(null);
  const [instruction, setInstruction] = useState('');
  const submittedInstruction = useRef('');
  const instructionChanged = instruction.trim() !== submittedInstruction.current;
  const [contextOpen, setContextOpen] = useState(false);
  const [generation, setGeneration] = useState<ConversationGeneration | null>(null);
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const mounted = useRef(true);
  const active = useRef<Flight | null>(null);
  const displayed = useRef<Flight | null>(null);
  const uncertain = useRef<Flight | null>(null);
  const intentEpoch = useRef(0);
  const sourceIdentity = JSON.stringify(source);
  const currentSource = useRef(sourceIdentity);
  currentSource.current = sourceIdentity;
  const bytes = new TextEncoder().encode(source.text);
  const selected = new TextDecoder().decode(bytes.subarray(
    source.locator.selectionStart, source.locator.selectionEnd,
  ));
  const variant = tone === 'media' ? 'pill' : 'quiet';

  function report(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (mounted.current) setError(message);
    else console.error(`Explanation cleanup failed; its saved Thread remains available in Chats: ${message}`);
  }
  function resolveAdmission(flight: Flight): Promise<ConversationGeneration> {
    if (flight.generation) return Promise.resolve(flight.generation);
    flight.admission ??= flight.admit().then(value => {
      flight.generation = value;
      return value;
    }).finally(() => { flight.admission = null; });
    return flight.admission;
  }
  function cancel(flight: Flight): Promise<void> {
    flight.cancelled = true;
    flight.wake?.();
    if (flight.cancellation) return flight.cancellation;
    uncertain.current ??= flight;
    const inFlight = flight.admission !== null;
    const stop = async () => {
      let admitted: ConversationGeneration;
      try { admitted = await resolveAdmission(flight); }
      catch (cause) {
        if (!inFlight) throw cause;
        // Closing may precede a lost admission/validation receipt. Recover
        // exactly that command through Rust's receipt, never a fresh request.
        admitted = await resolveAdmission(flight);
      }
      if (running(admitted)) {
        flight.stop ??= client.prepareConversationStop(admitted.id);
        admitted = await client.stopConversationGeneration(flight.stop);
      }
      flight.generation = admitted;
      if (uncertain.current === flight) uncertain.current = null;
      if (mounted.current && displayed.current === flight) setGeneration(admitted);
    };
    flight.cancellation = stop().catch(cause => {
      flight.cancellation = null;
      throw cause;
    });
    return flight.cancellation;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      intentEpoch.current++;
      const flight = active.current ?? displayed.current ?? uncertain.current;
      if (flight) void cancel(flight).catch(report);
    };
  }, [client]);
  useEffect(() => {
    intentEpoch.current++;
    const flight = active.current ?? displayed.current ?? uncertain.current;
    active.current = null;
    displayed.current = null;
    if (flight) void cancel(flight).catch(report);
    setPending(false);
    setOpen(false);
    setGeneration(null);
    setAnswer('');
    setError('');
    setFeedback('');
  }, [sourceIdentity]);

  async function observe(flight: Flight, admitted: ConversationGeneration) {
    flight.generation = admitted;
    if (flight.cancelled) {
      await cancel(flight);
      return;
    }
    while (!flight.cancelled) {
      const [current, page] = await Promise.all([
        client.conversationGeneration(admitted.id),
        client.conversationMessages(admitted.conversationId),
      ]);
      if (flight.cancelled || !mounted.current || active.current !== flight) return;
      const message = page.items.find(item => item.id === admitted.assistantMessageId);
      if (!message) throw new Error('The saved explanation response is unavailable. Open its Thread in Chats.');
      flight.generation = current;
      setGeneration(current);
      setAnswer(message.text);
      if (!running(current)) {
        if (current.status !== 'complete')
          setError(current.error ?? `Explanation ${current.status.replaceAll('_', ' ')}. Partial text is retained.`);
        return;
      }
      // This is bounded progress sampling across the common native command
      // transport, not a retry of generation or a token-by-token IPC stream.
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { flight.wake = null; resolve(); }, 350);
        flight.wake = () => { clearTimeout(timer); flight.wake = null; resolve(); };
      });
    }
  }
  async function begin(admit: () => Promise<ConversationGeneration>) {
    if (active.current) return;
    const flight: Flight = { admit, sourceIdentity, admission: null, cancellation: null,
      cancelled: false, generation: null, stop: null, wake: null };
    active.current = flight;
    displayed.current = flight;
    setPending(true);
    setError('');
    uncertain.current = flight;
    try {
      const admitted = await resolveAdmission(flight);
      if (!flight.cancelled && uncertain.current === flight) uncertain.current = null;
      await observe(flight, admitted);
    } catch (cause) {
      if (mounted.current && !flight.cancelled && active.current === flight) report(cause);
    } finally {
      if (active.current === flight) {
        active.current = null;
        if (mounted.current) setPending(false);
      }
    }
  }
  async function requestExplanation() {
    if (active.current) return;
    const owned = ++intentEpoch.current;
    if (uncertain.current) {
      setPending(true);
      try { await cancel(uncertain.current); }
      catch (cause) {
        if (mounted.current && currentSource.current === sourceIdentity && intentEpoch.current === owned) {
          setPending(false);
          report(cause);
        }
        return;
      }
    }
    if (!mounted.current || currentSource.current !== sourceIdentity || intentEpoch.current !== owned) return;
    const question = instruction.trim();
    const command = client.prepareConversationExplanation(source,
      question || 'Explain the selected text using its original source context. State uncertainty; do not grade the learner.');
    submittedInstruction.current = question;
    setGeneration(null);
    setAnswer('');
    void begin(() => client.explainConversationSource(command));
  }
  function retry() {
    if (instructionChanged || (!error && !uncertain.current)) {
      void requestExplanation();
      return;
    }
    if (uncertain.current) {
      const flight = uncertain.current;
      if (flight.cancelled) void cancel(flight).catch(report);
      else void begin(flight.admit);
    } else if (generation && running(generation)) {
      void begin(() => Promise.resolve(generation));
    } else if (generation && generation.status !== 'complete') {
      const previous = generation;
      let prepared: ConversationRetry | null = null;
      void begin(async () => {
        if (!prepared) {
          const conversation = await client.conversation(previous.conversationId);
          prepared = client.prepareConversationRetry(previous, conversation);
        }
        return client.retryConversationGeneration(prepared, previous);
      });
    } else {
      void requestExplanation();
    }
  }
  function changeOpen(value: boolean) {
    setOpen(value);
    if (value) {
      if (!generation && !active.current) {
        const flight = uncertain.current;
        if (flight?.sourceIdentity === sourceIdentity) {
          if (flight.cancelled) {
            displayed.current = flight;
            void cancel(flight).catch(report);
          } else void begin(flight.admit);
        } else void requestExplanation();
      }
    } else {
      intentEpoch.current++;
      setPending(false);
      const flight = active.current ?? displayed.current ?? uncertain.current;
      if (flight) void cancel(flight).catch(report);
      else if (running(generation) && generation) {
        const stop = client.prepareConversationStop(generation.id);
        void client.stopConversationGeneration(stop).then(setGeneration).catch(report);
      }
    }
  }
  async function copy(text: string) {
    try {
      if (!host.available) throw new Error(host.reason);
      await host.copyText(text);
      if (mounted.current) { setFeedback('Copied.'); setError(''); }
    } catch (cause) { report(cause); }
  }
  return <View>
    <Row wrap={tone !== 'media'}>
      <Dialog open={open} onOpenChange={changeOpen} title="Explain selected text"
        description="Feedback is linked to the original source, not learner evidence."
        trigger={<Button label="Explain" variant={variant} size="compact"
          tone={tone === 'media' ? 'info' : undefined} icon={tone === 'media' ? 'conversation' : undefined}
          disabled={disabled || !selected || !!explanationDisabledReason} />}>
        <Text selectable>{selected}</Text>
        <Button label={contextOpen ? 'Hide original context' : 'Show original context'} variant="quiet"
          accessibilityState={{ expanded: contextOpen }} onPress={() => setContextOpen(value => !value)} />
        {contextOpen ? <Text selectable variant="caption">{source.text}</Text> : null}
        <TextField testID="source-explanation-question" label="Question or correction request" value={instruction} onChangeText={setInstruction}
          maxLength={2048} editable={!pending && !running(generation)} />
        {pending ? <Text accessibilityLiveRegion="polite">{
          generation ? 'Receiving explanation…' : 'Opening explanation…'
        }</Text> : null}
        {answer ? <Text selectable>{answer}</Text> : null}
        {generation ? <Text muted variant="caption" accessibilityLiveRegion="polite">
          {generation.status.replaceAll('_', ' ')}
        </Text> : null}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
        <Row>
          {running(generation) || pending || uncertain.current ? <Button label="Stop explanation" variant="secondary"
            onPress={() => {
              intentEpoch.current++;
              setPending(false);
              const flight = active.current ?? displayed.current ?? uncertain.current;
              if (flight) void cancel(flight).catch(report);
              else if (generation) void client.stopConversationGeneration(
                client.prepareConversationStop(generation.id),
              ).then(setGeneration).catch(report);
            }} /> : null}
          {!pending ? <Button label={error && !instructionChanged ? 'Retry explanation' : 'Ask another question'} onPress={retry} /> : null}
          <Button label="Provider settings in Chats" variant="quiet" onPress={() => {
            changeOpen(false);
            router.push('../messenger');
          }} />
        </Row>
      </Dialog>
      <Button label="Copy selected text" variant={variant} size="compact" disabled={disabled || !selected}
        onPress={() => void copy(selected)} />
      <Button label="Copy context" variant={variant} size="compact" disabled={disabled || !source.text}
        onPress={() => void copy(source.text)} />
      <Button ref={proposalTrigger} label="Propose Material" variant={variant} size="compact" disabled={disabled || !selected}
        onPress={() => setProposalsOpen(true)} />
    </Row>
    <MaterialProposalReview client={client} open={proposalsOpen} onOpenChange={setProposalsOpen}
      focusTarget={() => proposalTrigger.current} seed={null} source={source}
      onOpenMaterial={id => router.navigate({ pathname: '/materials', params: { id } })} />
    {feedback ? <Text tone={tone} variant="caption" accessibilityLiveRegion="polite">{feedback}</Text> : null}
    {explanationDisabledReason ? <Text tone={tone} variant="caption" muted>{explanationDisabledReason}</Text> : null}
    {!open && error ? <Text tone={tone} variant="caption" accessibilityRole="alert">{error}</Text> : null}
  </View>;
}
