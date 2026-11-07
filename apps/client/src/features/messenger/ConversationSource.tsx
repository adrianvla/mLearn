import { useEffect, useRef, useState } from 'react';
import type { ConversationAnalysisBatch, Response } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Text } from '@mlearn/ui/text';
import { AnnotatedText } from '../annotated-text';
import { Inspector, type Inspection } from '../inspector';
import { SourceActions } from '../explanation';
import { messageAnchor } from './messageFlow';

type Original = Extract<Response, { type: 'conversation_material_source' }>;
const readOnly = 'Captured original · open the current conversation to capture or explain again.';

/** A captured revision is distinct from the editable current conversation. */
export function ConversationSource({ client, materialId, proposalId, reviewSessionId, reviewEncounterId, onKnowledgeChanged }: {
  readonly client: RuntimeClient;
  readonly materialId?: string;
  readonly proposalId?: string;
  readonly reviewSessionId?: string;
  readonly reviewEncounterId?: string;
  readonly onKnowledgeChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  const originKey = JSON.stringify([materialId, proposalId, reviewSessionId, reviewEncounterId]);
  const [snapshot, setSnapshot] = useState<{ key: string; value: Original } | null>(null);
  const original = snapshot?.key === originKey ? snapshot.value : null;
  const scope = useRef<object | null>(null);
  const [batch, setBatch] = useState<ConversationAnalysisBatch | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const owner = {};
    scope.current = owner;
    setOpen(true);
    setPending(true);
    setError('');
    setBatch(null);
    setInspection(null);
    const read = async () => {
      const result = materialId ? await client.returnMaterialSource(materialId)
        : proposalId ? await client.returnMaterialProposalSource(proposalId)
        : reviewSessionId && reviewEncounterId ? await client.returnReviewSource(reviewSessionId, reviewEncounterId) : null;
      if (!result || result.type !== 'conversation_material_source')
        throw new Error('This saved source does not identify an original conversation message.');
      if (!active) return;
      setSnapshot({ key: originKey, value: result });
      const prepared = await client.analyzeConversationSource(result.anchor);
      if (active) setBatch(prepared);
    };
    void read().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; if (scope.current === owner) scope.current = null; };
  }, [client, materialId, proposalId, reviewSessionId, reviewEncounterId, reload]);
  const analyzed = original ? batch?.messages.find(message => message.messageId === original.message.id
    && message.messageRevision === original.message.revision
    && message.contentRevision === original.message.contentRevision) : null;
  const selected = original ? new TextDecoder().decode(new TextEncoder().encode(original.anchor.text).subarray(
    original.anchor.locator.selectionStart, original.anchor.locator.selectionEnd,
  )) : '';
  return <>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setInspection(null); }}
      title="Captured message" description={original
        ? `${original.conversation.title} · original message revision ${original.message.revision}`
        : 'Restoring the saved source revision.'}
      trigger={<Button label="Captured source" variant="quiet" size="compact" onPress={() => setOpen(true)} />}>
      {selected ? <Text variant="heading" selectable>{selected}</Text> : null}
      {original ? <>
        <AnnotatedText variant="body" rawText={original.message.text} analysis={analyzed ?? null}
          annotations={batch?.annotations.filter(value => value.messageId === original.message.id) ?? []}
          onInspect={(token, anchor) => {
            if (!batch || !analyzed) return;
            setInspection({
              sourceForm: token.text, targets: token.targets, context: original.message.text,
              sourceAnchor: messageAnchor(original.message, batch.packageId, batch.packageVersion, token),
              packageRevision: batch.packageRevision, anchor, showContext: true,
            });
          }} />
        <SourceActions client={client} source={original.anchor} explanationDisabledReason={readOnly} />
        {original.conversation.discarded ? <Text variant="caption" muted>
          The temporary Thread was discarded. Its captured original remains available.
        </Text> : null}
      </> : null}
      {pending ? <Text accessibilityLiveRegion="polite">Preparing original message…</Text> : null}
      {error ? <><Text accessibilityRole="alert">{error}</Text>
        <Button label="Retry original source" variant="secondary" onPress={() => setReload(value => value + 1)} /></> : null}
      <Button label="Close captured source" variant="secondary" onPress={() => { setOpen(false); setInspection(null); }} />
    </Dialog>
    {inspection && original ? <Inspector inspection={inspection} packageId={original.anchor.packageId}
      client={client} readOnlySourceReason={readOnly} onClose={() => setInspection(null)}
      onChanged={async () => {
        const owner = scope.current;
        const refreshed = await client.analyzeConversationSource(original.anchor);
        if (owner && scope.current === owner) { setBatch(refreshed); onKnowledgeChanged(); }
      }} /> : null}
  </>;
}
