import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View } from 'react-native';
import type {
  CollectionSelection, MaterialBulkAction, MaterialBulkPage, MaterialBulkPatch,
  MaterialBulkStart, MaterialBulkStatus,
} from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row, Stack } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';

const fields = [
  { value: 'phrase', label: 'Phrase' }, { value: 'reading', label: 'Reading' },
  { value: 'meaning', label: 'Meaning' }, { value: 'context', label: 'Context' },
  { value: 'notes', label: 'Notes' }, { value: 'examples', label: 'Examples' },
] as const;
type Field = typeof fields[number]['value'];
type Trigger = MaterialBulkAction['kind'] | 'include';
type Proposal = { readonly selection: CollectionSelection; readonly action: MaterialBulkAction };
type Submission = { readonly command: MaterialBulkStart; readonly retry: boolean; readonly pending: boolean; readonly error: string };

function label(action: MaterialBulkAction): string {
  switch (action.kind) {
    case 'add': return action.distinct ? 'Add distinct Material' : 'Add to Material';
    case 'edit': return 'Edit Material';
    case 'exclude': return action.excluded ? 'Exclude Material' : 'Include Material';
    case 'remove': return 'Remove Material';
  }
}

export function CollectionBulkActions({ client, selection, blocked, surface, onChanged }: {
  readonly client: RuntimeClient;
  readonly selection: CollectionSelection | null;
  readonly blocked: boolean;
  readonly surface: 'knowledge' | 'material';
  readonly onChanged: () => void;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState<MaterialBulkStatus[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [page, setPage] = useState<MaterialBulkPage | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState('');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [field, setField] = useState<Field>('notes');
  const [replacement, setReplacement] = useState('');
  const [distinct, setDistinct] = useState(false);
  const owner = useRef<object | null>(null);
  const request = useRef(0);
  const active = useRef('');
  const submitting = useRef<{ readonly commandId: string } | null>(null);
  const confirmation = useRef<View>(null);
  const triggers = useRef<Record<Trigger, View | null>>({
    add: null, edit: null, exclude: null, include: null, remove: null,
  });
  const latestChanged = useRef(onChanged);
  latestChanged.current = onChanged;

  async function load(id = active.current, cursor: string | null = null) {
    const scope = owner.current;
    if (!scope) return;
    const ticket = ++request.current;
    setLoading(true); setError('');
    try {
      const values = await client.materialBulkJobs();
      const selected = values.find(value => value.command.commandId === id)
        ?? values.find(value => value.phase === 'running') ?? values[0];
      const selectedId = selected?.command.commandId ?? '';
      const selectedCursor = selectedId === id ? cursor : null;
      const result = selected ? await client.materialBulkResults(selectedId, selectedCursor) : null;
      if (owner.current !== scope || request.current !== ticket) return;
      active.current = selectedId;
      setJobs(values); setCurrentId(selectedId); setPage(result); setAfter(selectedCursor);
      setSubmission(previous => previous && !previous.pending
        && values.some(value => value.command.commandId === previous.command.commandId) ? null : previous);
    } catch (cause) {
      if (owner.current === scope && request.current === ticket)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (owner.current === scope && request.current === ticket) setLoading(false);
    }
  }

  useFocusEffect(useCallback(() => {
    const scope = {}; owner.current = scope;
    submitting.current = null; setControlling(false);
    setSubmission(previous => previous ? { ...previous, pending: false } : null);
    void load();
    return () => { if (owner.current === scope) { owner.current = null; request.current++; } };
  }, [client]));

  async function run(command: MaterialBulkStart, retry: boolean) {
    const scope = owner.current;
    if (!scope || submitting.current) return;
    const operation = { commandId: command.commandId }; submitting.current = operation;
    setSubmission({ command, retry, pending: true, error: '' }); setError('');
    try {
      const status = retry ? await client.retryMaterialBulk(command.commandId) : await client.startMaterialBulk(command);
      if (owner.current !== scope || submitting.current !== operation) return;
      setSubmission(null);
      latestChanged.current();
      if (status.resultsAvailable) await load(command.commandId);
      else {
        await load();
        if (owner.current === scope) setError('These results were already cleared. The command was not repeated.');
      }
    } catch (cause) {
      if (owner.current === scope && submitting.current === operation) {
        setSubmission({ command, retry, pending: false, error: cause instanceof Error ? cause.message : String(cause) });
        await load(command.commandId);
      }
    } finally { if (submitting.current === operation) submitting.current = null; }
  }

  async function control(commandId: string, release: boolean) {
    const scope = owner.current;
    if (!scope || controlling) return;
    setControlling(true); setError('');
    // Invalidate an older status read before admitting cancellation/release.
    request.current++;
    setLoading(false);
    try {
      if (release) await client.releaseMaterialBulk(commandId);
      else await client.cancelMaterialBulk(commandId);
      if (owner.current === scope) {
        if (!release) {
          if (submitting.current?.commandId === commandId) submitting.current = null;
          setSubmission(previous => previous?.command.commandId === commandId ? null : previous);
        }
        latestChanged.current();
        await load(release ? '' : commandId);
      }
    } catch (cause) {
      if (owner.current === scope) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (owner.current === scope) setControlling(false); }
  }

  const current = jobs.find(value => value.command.commandId === currentId);
  const running = submission?.pending || jobs.some(value => value.phase === 'running');
  const count = selection ? selection.targetCount + selection.materialCount : 0;
  const disabled = blocked || count === 0 || !!submission || running;
  const proposedCount = proposal ? proposal.selection.targetCount + proposal.selection.materialCount : 0;
  function propose(action: MaterialBulkAction) {
    if (selection && !disabled) {
      confirmation.current = triggers.current[action.kind === 'exclude' && !action.excluded ? 'include' : action.kind];
      setError(''); setProposal({ selection, action });
    }
  }
  function editPatch(): MaterialBulkPatch {
    const patch: MaterialBulkPatch = { phrase: null, reading: null, meaning: null, context: null, notes: null, examples: null };
    switch (field) {
      case 'phrase': case 'reading': case 'meaning': case 'context': case 'notes':
        patch[field] = replacement; break;
      case 'examples': patch.examples = replacement === '' ? [] : replacement.split('\n'); break;
    }
    return patch;
  }
  return <Stack>
    <Row>
      {surface === 'knowledge' ? <>
        <Button label="Add selected to Material" variant="secondary" size="compact" disabled={disabled}
          ref={node => { triggers.current.add = node; }} onPress={() => propose({ kind: 'add', distinct })} />
        <Button label="Create distinct copies" variant="quiet" size="compact" disabled={disabled}
          accessibilityState={{ selected: distinct }} onPress={() => setDistinct(value => !value)} />
      </> : <>
        <Button label="Edit selected" variant="secondary" size="compact" disabled={disabled}
          ref={node => { triggers.current.edit = node; }} onPress={() => { setReplacement(''); propose({ kind: 'edit', patch: editPatch() }); }} />
        <Button label="Exclude selected" variant="quiet" size="compact" disabled={disabled}
          ref={node => { triggers.current.exclude = node; }}
          onPress={() => propose({ kind: 'exclude', excluded: true })} />
        <Button label="Include selected" variant="quiet" size="compact" disabled={disabled}
          ref={node => { triggers.current.include = node; }}
          onPress={() => propose({ kind: 'exclude', excluded: false })} />
        <Button label="Remove selected" variant="quiet" size="compact" tone="negative" disabled={disabled}
          ref={node => { triggers.current.remove = node; }}
          onPress={() => propose({ kind: 'remove' })} />
      </>}
      <Button label="Refresh bulk results" variant="quiet" size="compact" disabled={loading}
        onPress={() => { latestChanged.current(); void load(); }} />
    </Row>
    {submission ? <Stack>
      <Text accessibilityLiveRegion="polite">{submission.pending ? `Submitting ${label(submission.command.action)}…` : 'Submission not confirmed.'}</Text>
      {submission.error ? <Text accessibilityRole="alert">{submission.error}</Text> : null}
      <Row>{submission.pending ? <Button label="Cancel bulk operation" variant="secondary" size="compact"
        disabled={controlling} onPress={() => void control(submission.command.commandId, false)} />
        : <Button label="Retry bulk submission" variant="secondary" size="compact"
          onPress={() => void run(submission.command, submission.retry)} />}</Row>
    </Stack> : null}
    {jobs.length ? <Select label="Retained bulk operation" size="compact" value={currentId} disabled={loading}
      options={jobs.map((job, index) => ({
        value: job.command.commandId,
        label: `${index + 1}: ${label(job.command.action)} · ${job.phase} · ${job.processed}/${job.total}`,
      }))} onValueChange={id => void load(id)} /> : null}
    {loading ? <Text accessibilityLiveRegion="polite">Loading bulk results…</Text> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {current ? <Stack>
      <Text testID={`bulk-status-${current.command.commandId}`} accessibilityLiveRegion="polite">{current.phase} · {current.processed} of {current.total} processed
        {' · '}{current.succeeded} succeeded · {current.duplicates} duplicates · {current.failed} failed</Text>
      {current.message ? <Text accessibilityRole="alert">{current.message}</Text> : null}
      <Row>{current.phase === 'running' ? submission?.pending && submission.command.commandId === current.command.commandId
        ? null : <Button label="Cancel bulk operation" variant="secondary" size="compact"
          disabled={controlling} onPress={() => void control(current.command.commandId, false)} /> : <>
        {current.failed > 0 || current.processed < current.total ? <Button label="Retry unfinished items" variant="secondary"
          size="compact" disabled={!!submission || controlling} onPress={() => void run(current.command, true)} /> : null}
        <Button label="Clear bulk results" variant="quiet" size="compact" disabled={!!submission || controlling}
          onPress={() => void control(current.command.commandId, true)} />
      </>}</Row>
      {page?.items.map(item => <Stack key={item.entry.item.kind === 'material' ? item.entry.item.id : item.entry.item.targetId}>
        <Text>{item.label}</Text>
        {item.outcome === null ? <Text variant="caption" muted>Not processed</Text>
          : item.outcome.state === 'failed' ? <Text accessibilityRole="alert">{item.outcome.message}</Text>
          : item.outcome.state === 'duplicate' ? <Text variant="caption">Existing Material: {item.outcome.materialIds.join(', ')}</Text>
          : item.outcome.state === 'removed' ? <Text variant="caption">Removed · revision {item.outcome.committedRevision}</Text>
          : <Row><Text variant="caption">{item.outcome.reused ? 'Reused' : 'Saved'} · revision {item.outcome.committedRevision}</Text>
            <Button label="Open Material" variant="quiet" size="compact"
              onPress={() => {
                if (item.outcome?.state === 'saved') router.push({ pathname: '../materials', params: { id: item.outcome.materialId } });
              }} /></Row>}
      </Stack>)}
      <Row><Button label="First bulk result page" variant="secondary" size="compact"
        disabled={loading || after === null} onPress={() => void load(currentId)} />
        <Button label="Next bulk result page" variant="secondary" size="compact"
          disabled={loading || page?.next == null} onPress={() => void load(currentId, page?.next ?? null)} /></Row>
    </Stack> : null}
    <Dialog open={proposal !== null} onOpenChange={open => { if (!open) setProposal(null); }}
      title={proposal ? `${label(proposal.action)}: ${proposedCount} items` : 'Bulk change'}
      description="Only this frozen selection is affected. Changed or unavailable items are reported individually."
      focusTarget={() => confirmation.current}>
      {proposal?.action.kind === 'add' ? <Text>
        The installed package supplies each target's default sense. These entries have no source association.
        {proposal.action.distinct ? ' A distinct copy is created even when Material already exists.' : ' Exact matches are reused; other matching entries are reported as duplicates.'}
      </Text> : null}
      {proposal?.action.kind === 'edit' ? <>
        <Select label="Replace field" value={field} options={fields} onValueChange={value => {
          const selected = fields.find(option => option.value === value);
          if (selected) { setField(selected.value); setReplacement(''); }
        }} />
        <TextField label={field === 'examples' ? 'Replacement examples (one per line)' : 'Replacement text'}
          multiline value={replacement} onChangeText={setReplacement} maxLength={field === 'phrase' || field === 'reading' ? 2048 : 32768} />
        <Text variant="caption">This replaces the chosen field on every selected item. Empty text clears that field.</Text>
      </> : null}
      {proposal?.action.kind === 'exclude' ? <Text>Exclusion changes Material selection, not demonstrated Knowledge or retained learner evidence.</Text> : null}
      {proposal?.action.kind === 'remove' ? <Text>Authored content will be deleted. There is no undo. Learner evidence and already admitted Review work are retained.</Text> : null}
      <Row><Button label="Cancel change" variant="secondary" onPress={() => setProposal(null)} />
        <Button label="Apply bulk change" tone={proposal?.action.kind === 'remove' ? 'negative' : 'neutral'}
          onPress={() => {
            if (!proposal) return;
            try {
              const action = proposal.action.kind === 'edit' ? { kind: 'edit' as const, patch: editPatch() } : proposal.action;
              const command = client.prepareMaterialBulk(proposal.selection.id, action);
              setProposal(null); void run(command, false);
            } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setProposal(null); }
          }} /></Row>
    </Dialog>
  </Stack>;
}
