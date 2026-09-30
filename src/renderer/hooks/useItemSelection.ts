import { createEffect, createMemo, createSignal, type Accessor } from 'solid-js';

/**
 * Selection over a list of ids, kept equal to what is actually there.
 *
 * A selection is a claim about rows on screen: "2 selected" is only true while
 * two of those rows still exist. Every surface that offers a multi-select bulk
 * bar held its own `Set<string>` and never checked it back against the
 * collection, so a row that left the list by any route other than a bulk
 * action stayed selected forever.
 *
 * The routes are ordinary, not exotic. Deleting one card from its own row
 * leaves the id in the set, so the count keeps counting a card that is gone,
 * the bulk bar still reads as armed, and the next bulk action reports the
 * number of ids it was handed rather than the number of cards it actually
 * deleted. The same drift happens when another window commits a deletion, and
 * when a collection changes under a selection that was made before it.
 *
 * The invariant is that the set only ever holds ids the collection still has.
 * It is enforced by projecting the selection onto the live collection rather
 * than by asking every surface to remember to prune it, so a surface that
 * adopts this cannot reintroduce the drift by adding another removal route.
 */
export interface ItemSelection {
  /** The selected ids, narrowed to the ids that still exist. */
  selected: Accessor<ReadonlySet<string>>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Adds ids, ignoring any the collection does not have. */
  select: (ids: readonly string[]) => void;
  deselect: (ids: readonly string[]) => void;
  clear: () => void;
  /**
   * Drops ids the collection no longer has, keeping the rest. A bulk action
   * that only partly landed uses this instead of `clear`, so the rows it could
   * not act on stay selected and the retry is the learner's to make.
   */
  reconcile: () => void;
  /** True when every id in `ids` is currently selected. */
  allSelected: (ids: readonly string[]) => boolean;
}

/**
 * @param existingIds Every id the surface is currently showing. It is read on
 * every render, so a row leaving the list narrows the selection without the
 * surface having to notice that it left.
 */
export function useItemSelection(existingIds: Accessor<readonly string[]>): ItemSelection {
  const [chosen, setChosen] = createSignal<ReadonlySet<string>>(new Set<string>());

  // A single source of truth: what renders is the raw set projected onto the
  // collection. The projection is what holds the invariant for every route
  // into and out of the list, including routes no caller told this hook about.
  const selected = createMemo<ReadonlySet<string>>(() => {
    const live = new Set(existingIds());
    const next = new Set<string>();
    for (const id of chosen()) if (live.has(id)) next.add(id);
    return next;
  });

  createEffect(() => {
    // Reading both signals subscribes this effect to changes in either, so a
    // set that has drifted is rewritten as soon as the drift is observable
    // rather than being left to a later bulk action to trip over.
    const raw = chosen();
    const pruned = selected();
    if (pruned.size === raw.size) return;
    setChosen(pruned);
  });

  return {
    selected,
    isSelected: (id) => selected().has(id),
    toggle: (id) => setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    }),
    select: (ids) => setChosen((prev) => new Set([...prev, ...ids])),
    deselect: (ids) => setChosen((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    }),
    clear: () => setChosen(new Set<string>()),
    reconcile: () => setChosen((prev) => {
      const live = new Set(existingIds());
      const next = new Set<string>();
      for (const id of prev) if (live.has(id)) next.add(id);
      return next;
    }),
    allSelected: (ids) => ids.length > 0 && ids.every((id) => selected().has(id)),
  };
}
