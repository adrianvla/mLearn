/**
 * Search Bar Component for Word Database Editor
 */

import { Component, For, Show, Accessor, Setter } from 'solid-js';
import { GlassBtn, Progress, HintText, Select } from '../../../components/common';

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
  return (
    <div class="search-bar">
      <input
        type="text"
        class="glass-input search-input"
        placeholder="Search word..."
        value={props.searchQuery()}
        onInput={(e) => props.setSearchQuery(e.currentTarget.value)}
        onKeyPress={(e) => e.key === 'Enter' && props.onSearch()}
      />
      <GlassBtn onClick={props.onSearch}>Search</GlassBtn>
      <GlassBtn onClick={props.onLoadAll} disabled={props.isLoading()}>
        Load All
      </GlassBtn>
      
      <Show when={props.isLoading()}>
        <Progress 
          progress={props.loadProgress()} 
          variant="thin" 
          class="load-progress"
        />
      </Show>
      
      <Select
        class="level-select"
        placeholder="All Levels"
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
        Enter to search; exact matches prioritized. Press Load All first.
      </HintText>
    </div>
  );
};

export default SearchBar;
