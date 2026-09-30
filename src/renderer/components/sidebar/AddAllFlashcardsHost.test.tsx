// @vitest-environment happy-dom

/**
 * The Add-All confirmation is one decision, shown from two surfaces.
 *
 * The reader and video sidebars are the same control on the same sidebar
 * component, and both open the same confirm. What each used to own
 * independently was the lifecycle around it: whether the dialog was open, which
 * two entry lists it was opened with, and closing it again. Those are the same
 * transitions on both surfaces, so a change to how the confirmation opens or
 * closes had to be made twice and could be made wrongly once.
 *
 * These tests pin the lifecycle itself rather than the wording. The modal is a
 * presenter; what belongs to the host is opening with both lists, handing the
 * confirmed selection back, and closing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { SidebarWordEntry } from './UnknownWordsSidebar';

let lastModalProps: Record<string, any> = {};

vi.mock('../../windows/main/routes/components/AddAllFlashcardsModal', () => ({
  AddAllFlashcardsModal: (props: Record<string, unknown>) => {
    lastModalProps = props as Record<string, any>;
    return <div data-testid="add-all-modal" />;
  },
}));

const entry = (key: string, word: string): SidebarWordEntry =>
  ({ key, word } as unknown as SidebarWordEntry);

const labels = { title: 'Add all' } as never;

describe('AddAllFlashcardsHost', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    lastModalProps = {};
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('stays closed until the sidebar asks for it', async () => {
    const { AddAllFlashcardsHost } = await import('./AddAllFlashcardsHost');
    const dispose = render(() => (
      <AddAllFlashcardsHost labels={labels} onAdd={() => {}}>
        {() => <div data-testid="sidebar" />}
      </AddAllFlashcardsHost>
    ), container);
    expect(lastModalProps.isOpen).toBe(false);
    expect(lastModalProps.allEntries).toEqual([]);
    dispose();
  });

  it('opens with both entry lists and keeps them apart', async () => {
    const { AddAllFlashcardsHost } = await import('./AddAllFlashcardsHost');
    let host!: any;
    const dispose = render(() => (
      <AddAllFlashcardsHost labels={labels} onAdd={() => {}}>
        {(c) => { host = c; return <div data-testid="sidebar" />; }}
      </AddAllFlashcardsHost>
    ), container);

    // The two lists mean different claims: "found in a dictionary" and "all of
    // them". Collapsing them here is exactly the ambiguity the button's count
    // is supposed to remove.
    host.open([entry('a', '昨日'), entry('b', '同じ')], [entry('a', '昨日')]);

    expect(lastModalProps.isOpen).toBe(true);
    expect(lastModalProps.allEntries.map((e: SidebarWordEntry) => e.word)).toEqual(['昨日', '同じ']);
    expect(lastModalProps.dictionaryEntries.map((e: SidebarWordEntry) => e.word)).toEqual(['昨日']);
    dispose();
  });

  it('hands the confirmed selection back and closes', async () => {
    const { AddAllFlashcardsHost } = await import('./AddAllFlashcardsHost');
    const added: string[][] = [];
    let host!: any;
    const dispose = render(() => (
      <AddAllFlashcardsHost labels={labels} onAdd={(e) => { added.push(e.map((x) => x.word)); }}>
        {(c) => { host = c; return <div data-testid="sidebar" />; }}
      </AddAllFlashcardsHost>
    ), container);

    host.open([entry('a', '昨日'), entry('b', '同じ')], [entry('a', '昨日')]);
    lastModalProps.onAdd([entry('b', '同じ')]);

    expect(added).toEqual([['同じ']]);
    expect(lastModalProps.isOpen).toBe(false);
    dispose();
  });

  it('reopening replaces the previous entries rather than merging them', async () => {
    const { AddAllFlashcardsHost } = await import('./AddAllFlashcardsHost');
    let host!: any;
    const dispose = render(() => (
      <AddAllFlashcardsHost labels={labels} onAdd={() => {}}>
        {(c) => { host = c; return <div />; }}
      </AddAllFlashcardsHost>
    ), container);

    host.open([entry('a', '昨日')], [entry('a', '昨日')]);
    host.open([entry('c', '思う')], []);

    // A confirm left showing the previous scan's words would offer to create
    // cards the sidebar can no longer see.
    expect(lastModalProps.allEntries.map((e: SidebarWordEntry) => e.word)).toEqual(['思う']);
    expect(lastModalProps.dictionaryEntries).toEqual([]);
    dispose();
  });

  it('cancelling closes without adding anything', async () => {
    const { AddAllFlashcardsHost } = await import('./AddAllFlashcardsHost');
    const added: string[][] = [];
    let host!: any;
    const dispose = render(() => (
      <AddAllFlashcardsHost labels={labels} onAdd={(e) => { added.push(e.map((x) => x.word)); }}>
        {(c) => { host = c; return <div />; }}
      </AddAllFlashcardsHost>
    ), container);

    host.open([entry('a', '昨日')], []);
    lastModalProps.onClose();

    expect(added).toEqual([]);
    expect(lastModalProps.isOpen).toBe(false);
    dispose();
  });
});
