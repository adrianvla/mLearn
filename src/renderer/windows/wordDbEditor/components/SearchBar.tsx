/**
 * Search Bar Component for Word Database Editor
 */

import { Component, Show, Accessor, Setter, createSignal } from 'solid-js';
import {
  Btn,
  ProgressBar,
  HintText,
  Select,
  Input,
  FilterBuilder,
  type FieldConfig,
  type FilterToken,
  type PaletteItem,
  type ValidationResult,
} from '../../../components/common';
import { useLocalization } from '../../../context';
import './SearchBar.css';

export type WordDbBrowseMode = 'all' | 'ignored';

export interface SearchBarProps {
  searchQuery: Accessor<string>;
  setSearchQuery: Setter<string>;
  browseMode: Accessor<WordDbBrowseMode>;
  setBrowseMode: Setter<WordDbBrowseMode>;
  isLoading: Accessor<boolean>;
  loadProgress: Accessor<number>;
  levelNames: Record<number, string>;
  onSearch: () => void;
  filterTokens: Accessor<FilterToken[]>;
  setFilterTokens: Setter<FilterToken[]>;
  filterFields: FieldConfig<unknown>[];
  filterPaletteItems: PaletteItem[];
  filterEvaluation: ValidationResult;
}

export const SearchBar: Component<SearchBarProps> = (props) => {
  const { t } = useLocalization();
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  
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

      <button
        type="button"
        class="search-bar-advanced-toggle"
        onClick={() => setShowAdvanced((v) => !v)}
        aria-expanded={showAdvanced()}
      >
        {t('mlearn.WordDbEditor.AdvancedFilters')}
        <span class="search-bar-advanced-chevron">{showAdvanced() ? '\u25BE' : '\u25B8'}</span>
      </button>

      <Show when={showAdvanced()}>
        <div class="search-bar-advanced-content">
          <FilterBuilder
            fields={props.filterFields}
            paletteItems={props.filterPaletteItems}
            tokens={props.filterTokens()}
            onChange={props.setFilterTokens}
            evaluation={props.filterEvaluation}
          />
        </div>
      </Show>

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
      
      <HintText>
        {t('mlearn.WordDbEditor.SearchHintDetailed')}
      </HintText>
    </div>
  );
};

export default SearchBar;
