/**
 * Entries Header Component for Word Database Editor
 */

import { Component, Accessor } from 'solid-js';
import { useLocalization } from '../../../context';
import { SortAscIcon, SortDescIcon } from '../../../components/common';
import './EntriesHeader.css';

export interface EntriesHeaderProps {
  sortKey: Accessor<string>;
  sortDir: Accessor<1 | -1>;
  onSort: (key: string) => void;
}

export const EntriesHeader: Component<EntriesHeaderProps> = (props) => {
  const { t } = useLocalization();
  
  const getSortIndicator = (key: string) => {
    if (props.sortKey() !== key) return null;
    return props.sortDir() === 1 ? <SortAscIcon size={12} /> : <SortDescIcon size={12} />;
  };

  return (
    <div class="entries-header">
      <div class="col word" onClick={() => props.onSort('word')}>
        {t('mlearn.WordDbEditor.Columns.Word')}{getSortIndicator('word')}
      </div>
      <div class="col translation" onClick={() => props.onSort('translation')}>
        {t('mlearn.WordDbEditor.Columns.Translation')}{getSortIndicator('translation')}
      </div>
      <div class="col level" onClick={() => props.onSort('level')}>
        {t('mlearn.WordDbEditor.Columns.Level')}{getSortIndicator('level')}
      </div>
      <div class="col tracker">{t('mlearn.WordDbEditor.Columns.TrackedBy')}</div>
      <div class="col status" onClick={() => props.onSort('status')}>
        {t('mlearn.WordDbEditor.Columns.Status')}{getSortIndicator('status')}
      </div>
    </div>
  );
};

export default EntriesHeader;
