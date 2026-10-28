import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type {
  CollectionItemId, CollectionQuery, CollectionSelection, CollectionSelectionCreate,
} from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';

function key(item: CollectionItemId): string {
  switch (item.kind) {
    case 'target': return item.targetId;
    case 'material': return item.id;
  }
}

/** View state for native frozen selections, shared by both real collection consumers. */
export function useCollectionSelection(
  client: RuntimeClient | null,
  query: CollectionQuery,
  items: readonly CollectionItemId[],
) {
  const [enabled, setEnabled] = useState(false);
  const [selection, setSelection] = useState<CollectionSelection | null>(null);
  const [retained, setRetained] = useState<CollectionSelection[]>([]);
  const [membership, setMembership] = useState<ReadonlySet<string> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<CollectionSelectionCreate | null>(null);
  const [revision, setRevision] = useState(0);
  const owner = useRef<object | null>(null);
  const busy = useRef(false);
  const visibleKey = JSON.stringify(items);

  useFocusEffect(useCallback(() => {
    if (!client || !enabled) return;
    const scope = {}; owner.current = scope;
    busy.current = false; setPending(false);
    void client.collectionSelections().then(values => {
      if (owner.current !== scope) return;
      setRetained(values);
      setSelection(previous => values.find(value => value.id === previous?.id) ?? null);
      setRevision(value => value + 1);
    }).catch((cause: unknown) => {
      if (owner.current === scope) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { if (owner.current === scope) owner.current = null; };
  }, [client, enabled]));

  useEffect(() => {
    setMembership(null);
    if (!client || !enabled || !selection) return;
    let active = true;
    void client.collectionSelectionMembership(selection.id, query, [...items]).then(rows => {
      if (active) setMembership(new Set(rows.filter(row => row.selected).map(row => key(row.item))));
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [client, enabled, selection?.id, query.packageId, query.surface, visibleKey, revision]);

  async function submit(command: CollectionSelectionCreate) {
    if (!client || !owner.current || busy.current) return;
    const scope = owner.current;
    const previous = selection;
    busy.current = true; setPending(true); setError(''); setAttempt(command);
    try {
      const selected = await client.createCollectionSelection(command);
      if (owner.current === scope) { setSelection(selected); setAttempt(null); }
      // A bulk job owns its original snapshot until its recovery results clear.
      // Do not silently release pinned snapshots when a row is toggled.
      if (previous && previous.id !== selected.id) {
        const jobs = await client.materialBulkJobs();
        if (!jobs.some(job => job.resultsAvailable && job.command.selectionId === previous.id))
          await client.releaseCollectionSelection(previous.id);
      }
      const values = await client.collectionSelections();
      if (owner.current === scope) setRetained(values);
    } catch (cause) {
      if (owner.current === scope) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (owner.current === scope) { busy.current = false; setPending(false); }
    }
  }

  async function refresh() {
    if (!client || !owner.current || busy.current) return;
    const scope = owner.current;
    busy.current = true; setPending(true); setError('');
    try {
      const values = await client.collectionSelections();
      if (owner.current === scope) {
        setRetained(values);
        setSelection(previous => values.find(value => value.id === previous?.id) ?? null);
        setRevision(value => value + 1);
      }
    } catch (cause) {
      if (owner.current === scope) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (owner.current === scope) { busy.current = false; setPending(false); }
    }
  }

  async function clear() {
    if (!client || !selection || !owner.current || busy.current) return;
    const scope = owner.current;
    busy.current = true; setPending(true); setError('');
    try {
      await client.releaseCollectionSelection(selection.id);
      const values = await client.collectionSelections();
      if (owner.current === scope) { setSelection(null); setRetained(values); setMembership(null); }
    } catch (cause) {
      if (owner.current === scope) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (owner.current === scope) { busy.current = false; setPending(false); }
    }
  }

  const compatible = !selection || selection.targetCount === 0
    || query.surface === 'knowledge' && selection.packageId === query.packageId;
  const blocked = pending || attempt !== null;
  return {
    enabled, setEnabled, selection, retained, pending, error, attempt,
    count: selection ? selection.targetCount + selection.materialCount : 0,
    blocked,
    canToggle: !blocked && compatible && (!selection || membership !== null),
    selected: (item: CollectionItemId) => membership?.has(key(item)) ?? false,
    toggle(item: CollectionItemId) {
      if (!client || blocked || !compatible || selection && membership === null) return;
      const selected = membership?.has(key(item)) ?? false;
      void submit(client.prepareCollectionSelection(selection ? {
        kind: 'amend', selectionId: selection.id, query,
        add: selected ? [] : [item], remove: selected ? [item] : [],
      } : { kind: 'items', query, items: [item] }));
    },
    matching() {
      if (client && !blocked) void submit(client.prepareCollectionSelection({ kind: 'matching', query }));
    },
    choose(id: string) {
      if (!blocked) { setSelection(retained.find(value => value.id === id) ?? null); setError(''); }
    },
    retry() { if (attempt) void submit(attempt); },
    refresh,
    clear,
  };
}
