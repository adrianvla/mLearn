import { For, JSX } from 'solid-js';
import './Table.css';

export interface TableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => JSX.Element;
  width?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export function Table<T>(props: TableProps<T>): JSX.Element {
  const cellValue = (col: TableColumn<T>, row: T): string => {
    const value = (row as unknown as Record<string, unknown>)[col.key];
    return value === null || value === undefined ? '' : String(value);
  };

  return (
    <div class="mlearn-table-wrapper">
      <table class="mlearn-table">
        <thead>
          <tr>
            <For each={props.columns}>
              {(col) => (
                <th
                  class="mlearn-table__th"
                  style={col.width ? { width: col.width } : undefined}
                  scope="col"
                >
                  {col.header}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For
            each={props.rows}
            fallback={
              <tr class="mlearn-table__empty-row">
                <td class="mlearn-table__empty" colspan={props.columns.length}>
                  {props.emptyMessage ?? 'No data'}
                </td>
              </tr>
            }
          >
            {(row) => (
              <tr
                class="mlearn-table__row"
                classList={{
                  'mlearn-table__row--clickable': props.onRowClick !== undefined,
                }}
                data-key={props.rowKey(row)}
                onClick={
                  props.onRowClick !== undefined
                    ? () => {
                        props.onRowClick?.(row);
                      }
                    : undefined
                }
              >
                <For each={props.columns}>
                  {(col) => (
                    <td class="mlearn-table__td" data-key={col.key}>
                      {col.render ? col.render(row) : cellValue(col, row)}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
