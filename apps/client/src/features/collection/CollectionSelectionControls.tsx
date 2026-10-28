import type { PluginSummary } from '@mlearn/contracts';
import { Button } from '@mlearn/ui/button';
import { Row, Stack } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import type { useCollectionSelection } from './useCollectionSelection';

export function CollectionSelectionControls({ state, count, ready, surface, packages }: {
  readonly state: ReturnType<typeof useCollectionSelection>;
  readonly count: number;
  readonly ready: boolean;
  readonly surface: 'knowledge' | 'material';
  readonly packages: readonly PluginSummary[];
}) {
  const retained = state.retained.filter(value => surface === 'knowledge'
    ? value.materialCount === 0 : value.targetCount === 0);
  const language = (id: string | null) => id === null ? 'All languages'
    : packages.find(value => value.id === id)?.displayName ?? id;
  return <Stack>
    <Row><Button label={state.enabled ? 'Close selection controls' : state.count ? `${state.count} selected` : 'Select items'}
      variant="secondary" size="compact" disabled={state.pending}
      accessibilityState={{ expanded: state.enabled }}
      onPress={() => state.setEnabled(!state.enabled)} /></Row>
    {state.enabled ? <>
      <Row>
        <Button label={`Select all ${count} matching`} variant="secondary" size="compact"
          disabled={!ready || count === 0 || state.blocked} onPress={state.matching} />
        <Button label="Clear selection" variant="quiet" size="compact"
          disabled={!state.selection || state.blocked} onPress={() => void state.clear()} />
        <Button label="Refresh selections" variant="quiet" size="compact"
          disabled={state.pending} onPress={() => void state.refresh()} />
      </Row>
      <Text variant="caption" accessibilityLiveRegion="polite">{state.count} selected{state.selection
        ? ` · ${language(state.selection.packageId)} · frozen selection` : ''}</Text>
      {retained.length ? <Select label="Retained selection" size="compact"
        value={state.selection?.id ?? ''} disabled={state.blocked}
        options={[{ value: '', label: 'No selection' }, ...retained.map((value, index) => ({
          value: value.id,
          label: `${index + 1}: ${value.targetCount + value.materialCount} items · ${language(value.packageId)}`,
        }))]} onValueChange={state.choose} /> : null}
      {state.pending ? <Text accessibilityLiveRegion="polite">Updating selection…</Text> : null}
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      {state.attempt && !state.pending ? <Button label="Retry selection" variant="secondary"
        size="compact" onPress={state.retry} /> : null}
    </> : null}
  </Stack>;
}
