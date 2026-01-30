/**
 * Search Bar Component for Word Database Editor
 */

import { Component, For, Show, Accessor, Setter } from 'solid-js';
import { Btn, Progress, HintText, Select } from '../../../components/common';
import { useLocalization } from '../../../context';

export interface SearchBarProps {
  searchQuery: Accessor<string>;
  setSearchQuery: Setter<string>;
  selectedLevel: Accessor<number | null>;
  setSelectedLevel: Setter<number | null>;
  isLoading: Accessor<boolean>;
  loadProgress: Accessor<number>;
  levelNames: Record<number, string>;
  onSearch: () => void;
  onLoadAll: () => void;
}

export const SearchBar: Component<SearchBarProps> = (props) => {
  const { t } = useLocalization();
  
  return (
    <div class="search-bar">
      <input
        type="text"
        class="glass-input search-input"
        placeholder={t('mlearn.WordDbEditor.SearchPlaceholder')}
        value={props.searchQuery()}
        onInput={(e) => props.setSearchQuery(e.currentTarget.value)}
        onKeyPress={(e) => e.key === 'Enter' && props.onSearch()}
      />
      <Btn onClick={props.onSearch}>{t('mlearn.Global.Search')}</Btn>
      <Btn onClick={props.onLoadAll} disabled={props.isLoading()}>
        {t('mlearn.WordDbEditor.LoadAll')}
      </Btn>
      
      <Show when={props.isLoading()}>
        <Progress 
          progress={props.loadProgress()} 
          variant="thin" 
          class="load-progress"
        />
      </Show>
      
      <Select
        class="level-select"
        placeholder={t('mlearn.WordDbEditor.AllLevels')}
        value={props.selectedLevel()?.toString() ?? ''}
        onChange={(e) => {
          const val = e.currentTarget.value;
          props.setSelectedLevel(val ? parseInt(val) : null);
        }}
      >
        <For each={Object.entries(props.levelNames)}>
          {([level, name]) => <option value={level}>{name}</option>}
        </For>
      </Select>
      
      <HintText>
        {t('mlearn.WordDbEditor.SearchHintDetailed')}
      </HintText>
    </div>
  );
};

export default SearchBar;
