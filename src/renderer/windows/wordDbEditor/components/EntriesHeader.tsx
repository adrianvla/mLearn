/**
 * Entries Header Component for Word Database Editor
 */

import { Component, Accessor } from 'solid-js';

export interface EntriesHeaderProps {
  sortKey: Accessor<string>;
  sortDir: Accessor<1 | -1>;
  onSort: (key: string) => void;
}

export const EntriesHeader: Component<EntriesHeaderProps> = (props) => {
  const getSortIndicator = (key: string) => {
    if (props.sortKey() !== key) return '';
    return props.sortDir() === 1 ? ' ▲' : ' ▼';
  };

  return (
    <div class="entries-header">
      <div class="col word" onClick={() => props.onSort('word')}>
        Word{getSortIndicator('word')}
      </div>
      <div class="col translation" onClick={() => props.onSort('translation')}>
        Translation{getSortIndicator('translation')}
      </div>
      <div class="col level" onClick={() => props.onSort('level')}>
        Level{getSortIndicator('level')}
      </div>
      <div class="col tracker">Tracked By</div>
      <div class="col status" onClick={() => props.onSort('status')}>
        Status{getSortIndicator('status')}
      </div>
    </div>
  );
};

export default EntriesHeader;
