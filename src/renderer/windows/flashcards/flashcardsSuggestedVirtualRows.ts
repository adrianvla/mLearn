import { createMemo, type Accessor } from 'solid-js';

export function createSuggestedVirtualRowItems<T>(
  items: Accessor<readonly T[]>,
  rowIndex: Accessor<number>,
  columns: Accessor<number>,
): Accessor<readonly T[]> {
  return createMemo(() => {
    const columnCount = columns();
    const start = rowIndex() * columnCount;
    return items().slice(start, start + columnCount);
  });
}
