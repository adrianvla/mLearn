import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import type {
  Material, MaterialContent, MaterialProposal, MaterialProposalDecision, MaterialProposalPage,
  MaterialProposalReceipt, MaterialProposalReview, MaterialSuggestion, SourceAnchor,
} from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { MaterialFields } from './MaterialFields';
import { MaterialGenerationControls } from './MaterialGenerationControls';
import { emptyMaterial } from './content';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { failure, type Failure } from '../failure';

/** Unsubmitted fields live here; proposal identity, review and receipts stay native-owned. */
export function MaterialProposalReview({ client, open, onOpenChange, focusTarget, seed, source, onChanged, onOpenMaterial, onReturnToSource }: {
  readonly client: RuntimeClient;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly focusTarget: () => View | null;
  readonly seed: Material | null;
  readonly source?: SourceAnchor;
  readonly onChanged?: () => void;
  readonly onOpenMaterial: (id: string) => void;
  readonly onReturnToSource?: () => void;
}) {
  const router = useRouter();
  const [page, setPage] = useState<MaterialProposalPage | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<Failure | null>(null);
  const [proposal, setProposal] = useState<MaterialProposal | null>(null);
  const [draft, setDraft] = useState<MaterialContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [feedback, setFeedback] = useState('');
  const [retry, setRetry] = useState<MaterialSuggestion | MaterialProposalReview | null>(null);
  const [conflict, setConflict] = useState(false);
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const mounted = useRef(true);
  const locked = useRef(false);
  const selected = useRef<object | null>(null);
  const seedIdentity = seed ? `${seed.id}:${seed.revision}` : JSON.stringify(source);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; selected.current = null; };
  }, []);
  useEffect(() => {
    if (!seed && !source) return;
    selected.current = null;
    const content = seed ? { ...seed.content, attachments: [] } : source ? {
      ...emptyMaterial(source.packageId), source, context: source.text,
      phrase: new TextDecoder().decode(new TextEncoder().encode(source.text).subarray(
        source.locator.selectionStart, source.locator.selectionEnd)),
    } : null;
    setProposal(null); setDraft(content);
    setRetry(null); setError(null); setFeedback(''); setDuplicates([]); setConflict(false);
  }, [seedIdentity]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setListError(null);
    void client.materialProposals({ after, packageId: null, pendingOnly }).then(value => {
      if (active) setPage(value);
    }).catch((cause: unknown) => {
      if (active) setListError(failure(cause, 'Proposals couldn’t be loaded.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, open, after, pendingOnly, reload]);
  const dirty = !!proposal && !!draft && JSON.stringify(draft) !== JSON.stringify(proposal.content);
  async function show(id: string, retainDraft = false) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    const request = {}; selected.current = request;
    try {
      const item = await client.materialProposal(id);
      if (mounted.current && selected.current === request) {
        setProposal(item);
        if (!retainDraft) setDraft(item.content);
        setRetry(null); setConflict(false); setDuplicates([]); setFeedback('');
      }
    } catch (cause) {
      if (mounted.current && selected.current === request)
        setError(failure(cause, 'This proposal couldn’t be opened.'));
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  function received(receipt: MaterialProposalReceipt) {
    setProposal(receipt.proposal); setDraft(receipt.proposal.content);
    setRetry(null); setConflict(false);
    setDuplicates(receipt.acceptance?.state === 'duplicate' ? receipt.acceptance.materialIds : []);
    if (receipt.acceptance?.state === 'saved') {
      setFeedback(`${receipt.acceptance.reused ? 'Reused' : 'Saved'} Material · committed revision ${receipt.acceptance.committedRevision}`);
      onChanged?.();
    } else if (receipt.acceptance?.state === 'duplicate') {
      setFeedback('Existing Material found. This proposal remains pending.');
    } else {
      setFeedback(receipt.proposal.state.state === 'rejected' ? 'Proposal rejected.' : 'Proposal saved for review.');
    }
    setReload(value => value + 1);
  }
  async function save(command: MaterialSuggestion | MaterialProposalReview) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setFeedback('');
    try {
      const receipt = 'content' in command ? await client.suggestMaterial(command) : await client.reviewMaterialProposal(command);
      if (mounted.current) received(receipt);
    } catch (cause) {
      if (mounted.current) {
        setRetry(command);
        const conflicted = cause instanceof RuntimeError && cause.code === 'conflict';
        setConflict(conflicted);
        setError(failure(cause, conflicted ? 'This proposal changed elsewhere, so your decision wasn’t saved.' : 'Your proposal decision wasn’t saved.'));
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  function review(decision: MaterialProposalDecision) {
    if (!proposal) return;
    void save(client.prepareMaterialProposalReview(proposal, decision));
  }
  function submit() {
    if (!draft) return;
    try {
      if (!proposal) {
        void save(client.prepareMaterialSuggestion(draft, seed ? { id: seed.id, revision: seed.revision } : null));
      } else if (dirty) review({ kind: 'edit', patch: {
        phrase: draft.phrase, reading: draft.reading, meaning: draft.meaning,
        context: draft.context, notes: draft.notes, examples: draft.examples,
      } });
      else review({ kind: 'accept', distinct: false });
    } catch (cause) { setError(failure(cause, 'This proposal couldn’t be prepared.')); }
  }
  async function returnSource() {
    if (!proposal || locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      const result = await client.returnMaterialProposalSource(proposal.id);
      if (!mounted.current) return;
      onOpenChange(false);
      onReturnToSource?.();
      if (result.type === 'conversation_material_source') {
        router.push({ pathname: '../messenger', params: {
          id: result.conversation.id, messageId: result.message.id, messageSequence: String(result.message.sequence),
          proposalId: proposal.id,
        } });
      } else {
        router.push({ pathname: result.type === 'material_source' ? '/watch' : '../reader',
          params: { id: result.window.source.id, proposalId: proposal.id } });
      }
    } catch (cause) {
      if (mounted.current) setError(failure(cause, 'The source for this proposal couldn’t be reopened.'));
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const editable = !proposal || proposal.state.state === 'pending';
  const retryAction = retry ? conflict && proposal ? <Button label="Reload proposal revision" disabled={busy}
      onPress={() => { if (proposal) void show(proposal.id, true); }} />
    : <Button label="Retry proposal action" disabled={busy} onPress={() => void save(retry)} /> : null;
  return <Dialog open={open} onOpenChange={onOpenChange} focusTarget={focusTarget}
    title="Material proposals" description="Review source-grounded text before saving it as Material.">
    <MaterialGenerationControls client={client} open={open}
      basis={seed ? { kind: 'material', material: { id: seed.id, revision: seed.revision } }
        : source ? { kind: 'source', source } : null}
      onCollected={() => { setAfter(null); setReload(value => value + 1); }}
      onProposal={id => void show(id)} />
    {draft ? <View style={styles.stack}>
      <Row><Text variant="section">{proposal ? proposal.state.state === 'pending' ? 'Review proposal' : `Proposal ${proposal.state.state}` : 'Propose changes'}</Text>
        <Button label="Back to proposals" variant="quiet" disabled={busy || !!retry} onPress={() => {
          selected.current = null; setProposal(null); setDraft(null); setError(null); setFeedback(''); setDuplicates([]);
        }} /></Row>
      {proposal?.replaces || !proposal && seed ? <Text variant="caption" muted>
        Replacement for Material · revision {proposal?.replaces?.revision ?? seed?.revision}. Saved changes are checked again on acceptance.
      </Text> : null}
      <MaterialFields value={draft} disabled={!editable || busy || !!retry} onChange={update => {
        setDraft(current => current ? update(current) : current); setFeedback(''); setDuplicates([]);
      }} />
      {editable ? <Row>
        <Button label={!proposal ? 'Save proposal' : dirty ? 'Save proposal edits' : 'Accept proposal'}
          testID="material-proposal-submit" busy={busy} disabled={!!retry} onPress={submit} />
        {proposal ? <Button label="Reject proposal" variant="secondary" disabled={busy || !!retry}
          onPress={() => review({ kind: 'reject' })} /> : null}
      </Row> : null}
      {proposal?.content.source ? <Button label="Return to proposal source" variant="quiet" disabled={busy}
        onPress={() => void returnSource()} /> : null}
      {proposal?.state.state === 'accepted' ? <Button label="Open saved Material" variant="secondary"
        onPress={() => {
          if (proposal.state.state === 'accepted') {
            onOpenChange(false);
            onOpenMaterial(proposal.state.materialId);
          }
        }} /> : null}
      {feedback ? <Text accessibilityLiveRegion="polite" testID="material-proposal-result">{feedback}</Text> : null}
      {error ? <FailureNotice message={error.message} detail={error.detail}>{retryAction}</FailureNotice>
        : retryAction ? <Row>{retryAction}</Row> : null}
      {duplicates.length ? <View style={styles.stack}>
        {duplicates.map(id => <Button key={id} label="Open existing Material" detail={id} variant="secondary" disabled={busy}
          onPress={() => { onOpenChange(false); onOpenMaterial(id); }} />)}
        {!proposal?.replaces ? <Button label="Keep proposal distinct" disabled={busy || !!retry}
          onPress={() => review({ kind: 'accept', distinct: true })} /> : null}
      </View> : null}
    </View> : <View style={styles.stack}>
      <Row><Button label="Pending only" variant="secondary" accessibilityState={{ selected: pendingOnly }}
        onPress={() => { setAfter(null); setPendingOnly(value => !value); }} />
        <Button label="Refresh proposals" variant="quiet" disabled={loading} onPress={() => setReload(value => value + 1)} /></Row>
      {loading ? <Text accessibilityLiveRegion="polite">Loading proposals…</Text> : null}
      {listError ? <FailureNotice message={listError.message} detail={listError.detail}>
        <Button label="Retry" accessibilityLabel="Retry proposals" variant="secondary" disabled={loading}
          onPress={() => setReload(value => value + 1)} />
      </FailureNotice> : null}
      {error ? <FailureNotice message={error.message} detail={error.detail} /> : null}
      {!loading && page?.items.length === 0 ? <Text>No proposals in this view.</Text> : null}
      {page?.items.map(item => <Button key={item.id} label={item.content.phrase} detail={`${item.state.state} · ${item.content.meaning}`}
        variant="secondary" disabled={busy || loading} onPress={() => void show(item.id)} />)}
      <Row><Button label="First proposals page" variant="secondary" disabled={loading || after === null} onPress={() => setAfter(null)} />
        <Button label="Next proposals page" variant="secondary" disabled={loading || !page?.next}
          onPress={() => setAfter(page?.next ?? null)} /></Row>
    </View>}
  </Dialog>;
}

const styles = StyleSheet.create(theme => ({
  stack: { gap: theme.spacing.compact, minWidth: 0 },
}));
