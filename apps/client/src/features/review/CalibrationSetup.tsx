import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { CollectionFilter, LanguageDescription, PluginSummary, ReviewMode } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Stack } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { CollectionFilters } from '../collection';

type CalibrationMode = Extract<ReviewMode, { kind: 'calibration' }>;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Unsubmitted scope only; native Knowledge and Review own selection and evidence. */
export function CalibrationSetup({ client, initialPackageId, disabled, onStart, onOpenKnowledge }: {
  readonly client: RuntimeClient;
  readonly initialPackageId: string;
  readonly disabled: boolean;
  readonly onStart: (mode: CalibrationMode) => Promise<void>;
  readonly onOpenKnowledge: (packageId: string) => void;
}) {
  const [packages, setPackages] = useState<PluginSummary[]>([]);
  const [packageId, setPackageId] = useState(initialPackageId);
  const [description, setDescription] = useState<LanguageDescription | null>(null);
  const [capability, setCapability] = useState('');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<CollectionFilter>({ kind: 'all', filters: [] });
  const [limit, setLimit] = useState('8');
  const [loading, setLoading] = useState(true);
  const [metadataError, setMetadataError] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<'empty' | 'cancelled' | null>(null);
  const [assessmentDetails, setAssessmentDetails] = useState(false);
  const owner = useRef<object | null>(null);
  const operation = useRef<AbortController | null>(null);
  const flight = useRef(false);
  useFocusEffect(useCallback(() => {
    const scope = {}; owner.current = scope;
    setLoading(true); setMetadataError(''); setDescription(null);
    setSelecting(operation.current !== null);
    void (async () => {
      const snapshot = await client.snapshot();
      if (owner.current !== scope) return;
      const available = snapshot.installedPlugins.filter(item => item.capabilities.includes('learning.probes.v2'));
      setPackages(available);
      if (!packageId) { setPackageId(available[0]?.id ?? ''); return; }
      const language = await client.describeLanguage(packageId);
      if (owner.current !== scope) return;
      setDescription(language);
      const allowed = language.catalog?.calibrationCapabilities ?? [];
      setCapability(previous => allowed.includes(previous) ? previous : allowed[0] ?? '');
    })().catch((cause: unknown) => {
      if (owner.current === scope) setMetadataError(messageOf(cause));
    }).finally(() => { if (owner.current === scope) setLoading(false); });
    return () => {
      if (owner.current === scope) owner.current = null;
      operation.current?.abort();
    };
  }, [client, packageId, reload]));
  function changed() { setNotice(null); setError(''); }
  const capabilities = description?.catalog?.capabilities.filter(item =>
    description.catalog?.calibrationCapabilities?.includes(item.id)) ?? [];
  const valid = /^[1-9]\d?$/.test(limit) && Number(limit) <= 32
    && capabilities.some(item => item.id === capability);
  async function select() {
    const scope = owner.current;
    if (!scope || disabled || loading || flight.current || !valid) return;
    const controller = new AbortController();
    operation.current = controller; flight.current = true;
    setSelecting(true); setCancelling(false); changed();
    const query = { packageId, capability, limit: Number(limit),
      filter: { kind: 'all' as const, filters: [{ kind: 'text' as const, text }, filter] } };
    try {
      const items = await client.calibrationCandidates(query, controller.signal);
      if (owner.current !== scope) return;
      if (!items.length) { setNotice('empty'); return; }
      operation.current = null; setSelecting(false);
      await onStart({ kind: 'calibration', query, items });
    } catch (cause) {
      if (owner.current !== scope) return;
      if (controller.signal.aborted && cause instanceof RuntimeError && cause.code === 'cancelled')
        setNotice('cancelled');
      else setError(messageOf(cause));
    } finally {
      if (operation.current === controller) operation.current = null;
      flight.current = false;
      if (owner.current) { setSelecting(false); setCancelling(false); }
    }
  }
  if (selecting) return <Stack>
    <Text accessibilityLiveRegion="polite">Selecting unmeasured targets...</Text>
    <Button label={cancelling ? 'Stopping selection' : 'Cancel selection'} variant="secondary"
      disabled={cancelling} onPress={() => { setCancelling(true); operation.current?.abort(); }} />
  </Stack>;
  if (disabled) return <Text accessibilityLiveRegion="polite">Saving Word Sync...</Text>;
  return <Stack>
    <Text variant="section" accessibilityRole="header">Find your starting point</Text>
    <Text muted>Choose a skill and a small set of words or topics you haven't measured yet.</Text>
    <Text variant="caption">Language</Text>
    <Select label="Word Sync language" value={packageId} disabled={loading}
      options={packages.map(item => ({ value: item.id, label: item.displayName ?? item.id }))}
      onValueChange={value => {
        changed(); setPackageId(value); setCapability(''); setText('');
        setFilter({ kind: 'all', filters: [] });
      }} />
    {loading ? <Text accessibilityLiveRegion="polite">Loading Word Sync options...</Text> : null}
    {metadataError ? <><Text accessibilityRole="alert">{metadataError}</Text>
      <Button label="Retry Word Sync options" variant="secondary" onPress={() => setReload(value => value + 1)} /></> : null}
    {!loading && !metadataError && !capabilities.length
      ? <Text>This package does not declare supported Word Sync probes.</Text> : null}
    <Text variant="caption">Skill to check</Text>
    <Select label="Word Sync capability" value={capability} disabled={loading}
      options={capabilities.map(item => ({ value: item.id, label: item.label }))}
      onValueChange={value => { changed(); setCapability(value); }} />
    <TextField label="Scope text" placeholder="All words and topics, or search to narrow" value={text} maxLength={2048}
      onChangeText={value => { changed(); setText(value); }} />
    <CollectionFilters key={packageId} client={client} packageId={packageId || null} value={filter}
      onApply={value => { changed(); setFilter(value); }} />
    <TextField label="Maximum targets" value={limit} keyboardType="number-pad" maxLength={2}
      onChangeText={value => { changed(); setLimit(value); }} />
    <Text variant="caption" muted>Only supported, unmeasured items in this scope will be selected.</Text>
    <Button label="How Word Sync is assessed" variant="quiet" accessibilityState={{ expanded: assessmentDetails }}
      onPress={() => setAssessmentDetails(value => !value)} />
    {assessmentDetails ? <Text variant="caption" muted>Claims remain separate from measured responses.
      Recall is self-reported; typed and choice tasks use their declared validators.</Text> : null}
    <Button label="Start Word Sync" disabled={loading || !valid || !!metadataError} onPress={() => void select()} />
    {notice === 'empty' ? <Text testID="calibration-empty" accessibilityLiveRegion="polite">No unmeasured targets match this scope.</Text> : null}
    {notice === 'cancelled' ? <Text testID="calibration-cancelled" accessibilityLiveRegion="polite">Selection cancelled.</Text> : null}
    {error ? <><Text accessibilityRole="alert">{error}</Text>
      <Button label="Retry selection" variant="secondary" disabled={loading || !valid} onPress={() => void select()} /></> : null}
    <Button label="Open Knowledge catalog" variant="quiet" disabled={!packageId}
      onPress={() => onOpenKnowledge(packageId)} />
  </Stack>;
}
