import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { useItemSelection } from './useItemSelection';

/**
 * A selection is a claim about rows that exist. These cover the routes by which
 * a row leaves a list without the surface deciding to clear the selection.
 */
describe('useItemSelection', () => {
  const withSelection = (initial: string[], run: (selection: ReturnType<typeof useItemSelection>, setIds: (next: string[]) => void) => void) => {
    createRoot((dispose) => {
      const [ids, setIds] = createSignal<string[]>(initial);
      const selection = useItemSelection(() => ids());
      try { run(selection, setIds); } finally { dispose(); }
    });
  };

  it('keeps only the ids the collection still has', () => {
    withSelection(['a', 'b', 'c'], (selection, setIds) => {
      selection.select(['a', 'b']);
      expect([...selection.selected()].sort()).toEqual(['a', 'b']);

      setIds(['a', 'c']);
      expect([...selection.selected()]).toEqual(['a']);
    });
  });

  it('empties when the collection empties', () => {
    withSelection(['a', 'b'], (selection, setIds) => {
      selection.select(['a', 'b']);
      setIds([]);
      expect(selection.selected().size).toBe(0);
    });
  });

  it('never holds an id the collection did not have', () => {
    withSelection(['a'], (selection) => {
      selection.select(['ghost']);
      expect(selection.selected().size).toBe(0);
    });
  });

  it('reports allSelected against the live selection, not a stale copy', () => {
    withSelection(['a', 'b'], (selection, setIds) => {
      selection.select(['a', 'b']);
      expect(selection.allSelected(['a', 'b'])).toBe(true);
      setIds(['a']);
      expect(selection.allSelected(['a', 'b'])).toBe(false);
    });
  });

  it('reconcile keeps the ids that survived and drops the ones that did not', () => {
    withSelection(['a', 'b', 'c'], (selection, setIds) => {
      selection.select(['a', 'b', 'c']);
      setIds(['b', 'c']);
      selection.reconcile();
      expect([...selection.selected()].sort()).toEqual(['b', 'c']);
    });
  });

  it('toggle and deselect operate on the projected selection', () => {
    withSelection(['a', 'b'], (selection, setIds) => {
      selection.select(['a', 'b']);
      setIds(['a']);
      selection.toggle('a');
      expect(selection.selected().size).toBe(0);
      selection.toggle('a');
      expect([...selection.selected()]).toEqual(['a']);
      selection.deselect(['a']);
      expect(selection.selected().size).toBe(0);
    });
  });

  it('narrows the selection on its own when a bulk action removes rows', () => {
    // The live defect: a bulk delete removed the rows and then cleared the
    // whole selection, so a row that could NOT be removed was swept out of it
    // too. With the ids the action actually claimed gone from the list, the
    // hook narrows to exactly the rows the learner still has.
    withSelection(['a', 'b', 'c'], (selection, setIds) => {
      selection.select(['a', 'b', 'c']);
      setIds(['c']);
      expect([...selection.selected()]).toEqual(['c']);
      expect(selection.allSelected(['a', 'b', 'c'])).toBe(false);
    });
  });
});
