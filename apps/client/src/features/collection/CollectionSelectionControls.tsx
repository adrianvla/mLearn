import { useRef, useState } from 'react';
import { View } from 'react-native';
import type { PluginSummary } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Stack } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import type { useCollectionSelection } from './useCollectionSelection';
import { CollectionBulkActions } from './CollectionBulkActions';

export function CollectionSelectionControls({ state, count, ready, surface, packages, client, onChanged }: {
  readonly state: ReturnType<typeof useCollectionSelection>;
  readonly count: number;
  readonly ready: boolean;
  readonly surface: 'knowledge' | 'material';
  readonly packages: readonly PluginSummary[];
  readonly client: RuntimeClient;
  readonly onChanged: () => void;
}) {
  const [savedOpen, setSavedOpen] = useState(false);
  const actions = useRef<View>(null);
  const retained = state.retained.filter(value => surface === 'knowledge'
    ? value.materialCount === 0 : value.targetCount === 0);
  const language = (id: string | null) => id === null ? 'All languages'
    : packages.find(value => value.id === id)?.displayName ?? id;
  const toggle = <Button label={state.enabled ? 'Done' : state.count ? `${state.count} selected` : 'Select items'}
      accessibilityLabel={state.enabled ? 'Close selection controls' : undefined}
      variant="secondary" size="compact" disabled={state.pending}
      accessibilityState={{ expanded: state.enabled }}
      onPress={() => state.setEnabled(!state.enabled)} />;
  return <Stack>
    {state.enabled ? <>
      <CollectionBulkActions client={client} selection={state.selection} blocked={state.blocked} surface={surface} onChanged={onChanged}
        leading={<>{toggle}<Text variant="caption" accessibilityLiveRegion="polite">{state.count} selected</Text>
          {state.selection ? <Text variant="caption" muted>{language(state.selection.packageId)}</Text> : null}</>}
        menuRef={actions} additionalActions={[
          { id: 'matching', label: `Select all ${count} matching`, disabled: !ready || count === 0 || state.blocked, onPress: state.matching },
          { id: 'clear', label: 'Clear selection', disabled: !state.selection || state.blocked, onPress: () => void state.clear() },
          { id: 'saved', label: 'Saved selections', disabled: state.pending || !retained.length, onPress: () => setSavedOpen(true) },
          { id: 'refresh-selection', label: 'Refresh selections', disabled: state.pending, onPress: () => void state.refresh() },
        ]} />
      {state.pending ? <Text accessibilityLiveRegion="polite">Updating selection…</Text> : null}
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      {state.attempt && !state.pending ? <Button label="Retry selection" variant="secondary"
        size="compact" onPress={state.retry} /> : null}
    </> : toggle}
    <Dialog open={savedOpen && state.enabled} onOpenChange={setSavedOpen} title="Saved selections"
      focusTarget={() => actions.current}>
      <Select label="Retained selection" size="compact"
        value={state.selection?.id ?? ''} disabled={state.pending}
        options={[{ value: '', label: 'No selection' }, ...retained.map((value, index) => ({
          value: value.id,
          label: `${index + 1}: ${value.targetCount + value.materialCount} items · ${language(value.packageId)}`,
        }))]} onValueChange={id => { state.choose(id); setSavedOpen(false); }} />
    </Dialog>
  </Stack>;
}
