import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AuthoredPracticePreview, Material } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Badge } from '@mlearn/ui/badge';
import { Panel, Row, Stack } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Material owns authored input; the package owns every displayed probe. */
export function ExpertProbeSetup({ client, materialId, disabled, onStart, onEdit }: {
  readonly client: RuntimeClient;
  readonly materialId: string;
  readonly disabled: boolean;
  readonly onStart: (preview: AuthoredPracticePreview) => Promise<boolean>;
  readonly onEdit: () => void;
}) {
  const [material, setMaterial] = useState<Material | null>(null);
  const [preview, setPreview] = useState<AuthoredPracticePreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [assessmentDetails, setAssessmentDetails] = useState(false);
  const owner = useRef<object | null>(null);
  const operation = useRef<AbortController | null>(null);
  const flight = useRef(false);
  useFocusEffect(useCallback(() => {
    const scope = {}; owner.current = scope;
    setLoading(true); setError(''); setPreview(null);
    setPending(operation.current !== null);
    void client.material(materialId).then(value => {
      if (owner.current !== scope) return;
      setMaterial(value);
      if (!value) setError('Saved Material is unavailable.');
    }).catch((cause: unknown) => {
      if (owner.current === scope) setError(messageOf(cause));
    }).finally(() => { if (owner.current === scope) setLoading(false); });
    return () => { if (owner.current === scope) owner.current = null; operation.current?.abort(); };
  }, [client, materialId]));
  async function inspect() {
    const scope = owner.current;
    if (!scope || flight.current || disabled) return;
    const controller = new AbortController();
    operation.current = controller; flight.current = true;
    setPending(true); setError(''); setCancelled(false); setPreview(null);
    try {
      const current = await client.material(materialId);
      if (owner.current !== scope) return;
      if (!current) throw new RuntimeError('invalid_material', 'Saved Material is unavailable.');
      setMaterial(current);
      const value = await client.authoredPracticePreview(current.id, current.revision, controller.signal);
      if (owner.current === scope) setPreview(value);
    } catch (cause) {
      if (owner.current !== scope) return;
      if (controller.signal.aborted && cause instanceof RuntimeError && cause.code === 'cancelled')
        setCancelled(true);
      else setError(messageOf(cause));
    } finally {
      if (operation.current === controller) operation.current = null;
      flight.current = false;
      if (owner.current) setPending(false);
    }
  }
  async function start() {
    const scope = owner.current;
    if (!scope || !preview || disabled || flight.current) return;
    flight.current = true;
    try {
      if (!await onStart(preview) && owner.current === scope) setPreview(null);
    } finally { flight.current = false; }
  }
  return <Stack>
    {loading ? <Text accessibilityLiveRegion="polite">Loading saved Material...</Text> : null}
    {material ? <>
      <Text variant="entryTitle" selectable>{material.content.phrase}</Text>
      <Text selectable>{material.content.meaning}</Text>
    </> : null}
    <Row><Badge label="Self-rated" variant="label" /><Badge label="Source-assisted" variant="label" /></Row>
    <Row>
    <Button label="Edit cue and answer" variant="quiet" disabled={disabled || pending} onPress={onEdit} />
    <Button label="Preview authored probes" variant={preview ? 'secondary' : 'primary'}
      busy={pending} disabled={disabled || loading || !material || pending}
      onPress={() => void inspect()} />
    </Row>
    {pending ? <Button label="Cancel probe preview" variant="quiet" onPress={() => operation.current?.abort()} /> : null}
    {cancelled ? <Text testID="authored-preview-cancelled" accessibilityLiveRegion="polite">Probe preview cancelled.</Text> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {preview ? <View testID="authored-probe-preview"><Stack>
      <Button label="Practice authored probes" disabled={disabled || pending} onPress={() => void start()} />
      {preview.probes.map(probe => <Panel key={probe.id} inset="compact">
        <Text variant="section" accessibilityRole="header">{probe.direction} recall</Text>
        <Text variant="caption" muted>Cue</Text><Text selectable>{probe.cue}</Text>
        <Text variant="caption" muted>Expected answer</Text><Text selectable>{probe.answer}</Text>
        <Text variant="caption" muted>Recall targets</Text>
        {probe.targets.map(target => <Text key={target.id} selectable>{target.label}
          {!target.key ? ' · no Knowledge measurement' : ''}</Text>)}
        {assessmentDetails ? <>
          <Text variant="caption" muted>Package contract {probe.contractVersion}</Text>
          {probe.targets.map(target => target.key ? <Text key={target.id} variant="caption" muted selectable>
            {target.label} · {target.key.targetId} · {target.key.capability}
          </Text> : null)}
          <Text variant="caption" muted selectable>Supplied information: {probe.supplied.length
            ? probe.supplied.map(key => `${key.targetId} · ${key.capability}`).join('; ') : 'none'}</Text>
        </> : null}
      </Panel>)}
    </Stack></View> : null}
    <Button label="Assessment limits" variant="disclosure" size="compact"
      icon={assessmentDetails ? 'chevronDown' : 'chevronRight'} iconPosition="trailing"
      accessibilityState={{ expanded: assessmentDetails }} onPress={() => setAssessmentDetails(value => !value)} />
    {assessmentDetails ? <>
      <Text variant="caption" muted>Self-rated. Previewed answers count as assistance.</Text>
      {material ? <>
        <Text variant="caption" muted>Material revision {material.revision}</Text>
        <Text variant="caption" muted selectable>Language package: {material.content.packageId}</Text>
      </> : null}
    </> : null}
  </Stack>;
}
