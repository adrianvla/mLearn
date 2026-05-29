/**
 * Search Bar Component for Word Database Editor
 */

import { Component, For, Show, Accessor, Setter } from 'solid-js';
import { Btn, ProgressBar, HintText, Select, Input } from '../../../components/common';
import { useLocalization } from '../../../context';
import './SearchBar.css';

export type WordDbBrowseMode = 'all' | 'ignored';

export interface SearchBarProps {
  searchQuery: Accessor<string>;
  setSearchQuery: Setter<string>;
  selectedLevel: Accessor<number | null>;
  setSelectedLevel: Setter<number | null>;
  selectedSource: Accessor<string>;
  setSelectedSource: Setter<string>;
  browseMode: Accessor<WordDbBrowseMode>;
  setBrowseMode: Setter<WordDbBrowseMode>;
  isLoading: Accessor<boolean>;
  loadProgress: Accessor<number>;
  levelNames: Record<number, string>;
  onSearch: () => void;
}

export const SearchBar: Component<SearchBarProps> = (props) => {
  const { t } = useLocalization();
  
  return (
    <div class="search-bar">
      <Input
        class="search-input"
        placeholder={t('mlearn.WordDbEditor.SearchPlaceholder')}
        value={props.searchQuery()}
        onInput={(e) => props.setSearchQuery(e.currentTarget.value)}
        onKeyPress={(e) => e.key === 'Enter' && props.onSearch()}
        size="md"
      />
      <Btn onClick={props.onSearch}>{t('mlearn.Global.Search')}</Btn>

      <Select
        class="mode-select"
        value={props.browseMode()}
        onChange={(e) => props.setBrowseMode(e.currentTarget.value as WordDbBrowseMode)}
      >
        <option value="all">{t('mlearn.WordDbEditor.BrowseMode.AllWords')}</option>
        <option value="ignored">{t('mlearn.WordDbEditor.BrowseMode.IgnoredWords')}</option>
      </Select>

      <Select
        class="source-select"
        value={props.selectedSource()}
        onChange={(e) => props.setSelectedSource(e.currentTarget.value)}
      >
        <option value="all">{t('mlearn.WordDbEditor.SourceFilter.AllSources')}</option>
        <option value="KnownWordsList">{t('mlearn.WordDbEditor.SourceFilter.KnownWordsList')}</option>
        <option value="IgnoredWords">{t('mlearn.WordDbEditor.SourceFilter.IgnoredWords')}</option>
        <option value="Srs">{t('mlearn.WordDbEditor.SourceFilter.Srs')}</option>
        <option value="PassiveTracking">{t('mlearn.WordDbEditor.SourceFilter.PassiveTracking')}</option>
        <option value="None">{t('mlearn.WordDbEditor.SourceFilter.None')}</option>
      </Select>

      <Show when={props.isLoading()}>
        <ProgressBar 
          value={props.loadProgress()} 
          size="xs" 
          class="load-progress"
          variant="primary"
          rounded
          animated
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
