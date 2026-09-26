import { createMemo, type Accessor } from 'solid-js';

/** Keep a visit while a source page is visible; re-entry gets a new identity. */
export function createReaderPageVisits(
  book: Accessor<string | null | undefined>,
  visiblePageIds: Accessor<readonly string[]>,
): Accessor<ReadonlyMap<string, number>> {
  let nextVisit = 0;
  return createMemo((previous: ReadonlyMap<string, number> | undefined) => {
    const currentBook = book();
    const visits = new Map<string, number>();
    for (const pageId of visiblePageIds()) {
      const key = `${currentBook}\0${pageId}`;
      visits.set(key, previous?.get(key) ?? ++nextVisit);
    }
    return visits;
  });
}
