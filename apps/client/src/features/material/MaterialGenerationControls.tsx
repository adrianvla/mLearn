import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type {
  MaterialGenerationBasis, MaterialGenerationPage, MaterialGenerationReport,
} from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';

const active = (report: MaterialGenerationReport) =>
  report.generation.status === 'pending' || report.generation.status === 'streaming';

/** A bounded view of the shared conversation worker, not another generation owner. */
export function MaterialGenerationControls({ client, open, basis, onProposal, onCollected }: {
  readonly client: RuntimeClient;
  readonly open: boolean;
  readonly basis: MaterialGenerationBasis | null;
  readonly onProposal: (id: string) => void;
  readonly onCollected: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [maximum, setMaximum] = useState(4);
  const [page, setPage] = useState<MaterialGenerationPage | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<MaterialGenerationReport | null>(null);
  const [pending, setPending] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [retry, setRetry] = useState<(() => Promise<MaterialGenerationReport>) | null>(null);
  const mounted = useRef(true);
  const actionOwner = useRef<object | null>(null);
  const controllingRef = useRef(false);
  const uncertain = useRef<(() => Promise<MaterialGenerationReport>) | null>(null);
  const stopped = useRef<string | null>(null);
  const reportRef = useRef<MaterialGenerationReport | null>(null);
  reportRef.current = report;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!open || !expanded) return;
    let current = true;
    setLoading(true); setListError('');
    void client.materialGenerations(after).then(value => {
      if (current) setPage(value);
    }).catch((cause: unknown) => {
      if (current) setListError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, open, expanded, after, reload]);
  const runningId = report && active(report) ? report.generation.id : null;
  useEffect(() => {
    if (!open || !expanded || !runningId) return;
    const id = runningId;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const value = await client.materialGeneration(id);
        if (!current) return;
        if (!(stopped.current === value.generation.id && active(value))) setReport(value);
        // Only the displayed live job is sampled, with one bounded read in flight.
        if (active(value)) timer = setTimeout(() => void refresh(), 350);
        else setReload(value => value + 1);
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
    void refresh();
    return () => { current = false; clearTimeout(timer); };
  }, [client, open, expanded, runningId]);
  async function execute(action: () => Promise<MaterialGenerationReport>) {
    if (actionOwner.current) return;
    const actionScope = {}; actionOwner.current = actionScope;
    setPending(true); setError('');
    try {
      const value = await action();
      // A concurrent Cancel may already have a newer terminal readback.
      if (mounted.current && actionOwner.current === actionScope
        && !(stopped.current === value.generation.id && active(value))) {
        setReport(value); setRetry(null); setReload(value => value + 1);
      }
    } catch (cause) {
      if (mounted.current && actionOwner.current === actionScope) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setRetry(() => action);
      }
    } finally {
      if (actionOwner.current === actionScope) {
        actionOwner.current = null;
        if (mounted.current) setPending(false);
      }
    }
  }
  function start() {
    if (!basis || actionOwner.current || uncertain.current) return;
    try {
      const command = client.prepareMaterialGeneration(basis, instruction, maximum);
      const admit = () => client.generateMaterial(command);
      uncertain.current = admit;
      setReport(null);
      void execute(async () => {
        const value = await admit();
        if (uncertain.current === admit) uncertain.current = null;
        return value;
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function cancel() {
    if (controllingRef.current) return;
    const admit = uncertain.current;
    const current = reportRef.current;
    if (!admit && !current) return;
    controllingRef.current = true; setControlling(true); setError('');
    try {
      // Resolve the same native admission if its first wire receipt is held/lost.
      const value = admit ? await admit() : current;
      if (!value) return;
      if (uncertain.current === admit) uncertain.current = null;
      stopped.current = value.generation.id;
      if (active(value)) await client.stopConversationGeneration(client.prepareConversationStop(value.generation.id));
      const latest = await client.materialGeneration(value.generation.id);
      if (mounted.current) {
        // A successful control receipt supersedes the held original admission,
        // including its eventual failure. It must not lock out later user work.
        actionOwner.current = null;
        setPending(false); setReport(latest); setRetry(null); setReload(value => value + 1);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { controllingRef.current = false; if (mounted.current) setControlling(false); }
  }
  function retryGeneration(previous: MaterialGenerationReport) {
    if (actionOwner.current || uncertain.current) return;
    let prepared: ReturnType<RuntimeClient['prepareConversationRetry']> | null = null;
    let preparing: Promise<ReturnType<RuntimeClient['prepareConversationRetry']>> | null = null;
    const admit = async () => {
      if (!prepared) {
        // Admission and Cancel share preparation, but never share a potentially
        // held transport receipt. A failed pre-admission read remains retryable.
        preparing ??= client.conversation(previous.generation.conversationId)
          .then(conversation => client.prepareConversationRetry(previous.generation, conversation));
        try { prepared = await preparing; }
        finally { preparing = null; }
      }
      const generation = await client.retryConversationGeneration(prepared, previous.generation);
      return client.materialGeneration(generation.id);
    };
    uncertain.current = admit;
    void execute(async () => {
      const value = await admit();
      if (uncertain.current === admit) uncertain.current = null;
      return value;
    });
  }
  const status = report?.generation.status;
  const canCollect = status === 'complete' || status === 'failed' || status === 'interrupted';
  return <View style={styles.stack}>
    <Button label={expanded ? 'Hide proposal generation' : 'Proposal generation and saved jobs'} variant="quiet"
      accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} />
    {expanded ? <>
      {basis ? <>
        <Text variant="caption" muted>{basis.kind === 'material'
          ? `Use saved Material revision ${basis.material.revision}; unsaved editor fields are not sent.`
          : 'Use the original selected source text. Generated candidates require explicit review.'}</Text>
        <TextField label="Proposal instruction" value={instruction} maxLength={2048}
          editable={!pending && !uncertain.current} onChangeText={setInstruction} />
        <Select label="Maximum proposals" value={String(maximum)}
          options={Array.from({ length: 8 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))}
          onValueChange={value => setMaximum(Number(value))} />
        <Button label="Generate text proposals" variant="secondary" disabled={pending || controlling || !!uncertain.current}
          onPress={start} />
      </> : null}
      {pending ? <Text accessibilityLiveRegion="polite">Reading generation receipt…</Text> : null}
      {report ? <View style={styles.stack} testID="material-generation-report">
        <Text variant="section">{report.label}</Text>
        <Text accessibilityLiveRegion="polite">{report.generation.status.replaceAll('_', ' ')}
          {report.collected ? ` · ${report.proposalIds.length} of up to ${report.maximum} proposals retained` : ''}</Text>
        {report.generation.error ? <Text accessibilityRole="alert">{report.generation.error}</Text> : null}
        {report.errors.map((message, index) => <Text key={index} accessibilityRole="alert">{message}</Text>)}
        <Row>
          <Button label="Refresh generation" variant="secondary" disabled={pending || controlling}
            onPress={() => void execute(() => client.materialGeneration(report.generation.id))} />
          {!report.collected && canCollect ? <Button label="Collect generated proposals" variant="secondary" disabled={pending || controlling}
            onPress={() => void execute(async () => {
              const value = await client.collectMaterialGeneration(report.generation.id);
              if (mounted.current) onCollected();
              return value;
            })} /> : null}
          {!active(report) && status !== 'complete' && status !== 'invalidated' ? <Button label="Retry proposal generation"
            variant="secondary" disabled={pending || controlling || !!retry} onPress={() => retryGeneration(report)} /> : null}
        </Row>
        {report.proposalIds.map((id, index) => <Button key={id} label={`Review generated proposal ${index + 1}`} variant="secondary"
          disabled={pending || controlling} onPress={() => { setExpanded(false); onProposal(id); }} />)}
      </View> : null}
      {uncertain.current || report && active(report) ? <Button label="Cancel proposal generation" variant="secondary"
        busy={controlling} onPress={() => void cancel()} /> : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {retry ? <Button label="Recover generation action" variant="secondary" disabled={pending || controlling}
        onPress={() => void execute(retry)} /> : null}
      <Text variant="caption" muted>Closing this view does not cancel a job. Saved jobs remain available in Review proposals.</Text>
      <Row><Button label="Refresh generation jobs" variant="quiet" disabled={loading || pending || controlling}
        onPress={() => setReload(value => value + 1)} /></Row>
      {loading ? <Text accessibilityLiveRegion="polite">Loading generation jobs…</Text> : null}
      {listError ? <Text accessibilityRole="alert">{listError}</Text> : null}
      {!loading && page?.items.length === 0 ? <Text>No saved generation jobs.</Text> : null}
      {page?.items.map(item => <Button key={item.generation.id} label={item.label}
        detail={item.generation.status.replaceAll('_', ' ')} variant="secondary" disabled={pending || controlling}
        onPress={() => void execute(() => client.materialGeneration(item.generation.id))} />)}
      <Row>
        <Button label="First generation page" variant="secondary" disabled={loading || after === null} onPress={() => setAfter(null)} />
        <Button label="Next generation page" variant="secondary" disabled={loading || !page?.next} onPress={() => setAfter(page?.next ?? null)} />
      </Row>
    </> : null}
  </View>;
}

const styles = StyleSheet.create(theme => ({
  stack: { gap: theme.spacing.compact, minWidth: 0 },
}));
