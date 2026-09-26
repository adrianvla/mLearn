import { createEffect, createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createReaderPageVisits } from './readerPageVisits';

describe('createReaderPageVisits', () => {
  it('keeps identity through UI churn and reacts when a cached image page returns', async () => {
    let setVisible!: (ids: string[]) => void;
    let visits!: () => ReadonlyMap<string, number>;
    const observed: number[] = [];
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [visible, updateVisible] = createSignal(['page-a']);
      setVisible = updateVisible;
      visits = createReaderPageVisits(() => 'book', visible);
      createEffect(() => {
        const visit = visits().get('book\0page-a');
        if (visit !== undefined) observed.push(visit);
      });
    });

    await Promise.resolve();
    const firstVisit = visits().get('book\0page-a');
    expect(firstVisit).toBeDefined();

    setVisible(['page-a']); // Sidebar/reflow may recreate the visible list.
    await Promise.resolve();
    expect(visits().get('book\0page-a')).toBe(firstVisit);

    setVisible(['page-b']);
    await Promise.resolve();
    expect(visits().has('book\0page-a')).toBe(false);

    setVisible(['page-a']);
    await Promise.resolve();
    expect(visits().get('book\0page-a')).toBeGreaterThan(firstVisit!);
    expect(observed.slice(0, -1).every((visit) => visit === firstVisit)).toBe(true);
    expect(observed.at(-1)).toBe(visits().get('book\0page-a'));
    dispose();
  });

  it('preserves an overlapping spread page but renews a page that left view', () => {
    createRoot((dispose) => {
      const [visible, setVisible] = createSignal(['page-a', 'page-b']);
      const visits = createReaderPageVisits(() => 'book', visible);
      const firstA = visits().get('book\0page-a');
      const firstB = visits().get('book\0page-b');

      setVisible(['page-b', 'page-c']);
      expect(visits().get('book\0page-b')).toBe(firstB);
      expect(visits().has('book\0page-a')).toBe(false);

      setVisible(['page-a', 'page-b']);
      expect(visits().get('book\0page-a')).toBeGreaterThan(firstA!);
      expect(visits().get('book\0page-b')).toBe(firstB);
      dispose();
    });
  });
});
