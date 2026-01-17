/**
 * Search Bar Component for Word Database Editor
 */

import { Component, For, Show, Accessor, Setter } from 'solid-js';
import { GlassButton } from '../../../components/common';

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
      <GlassButton onClick={props.onSearch}>Search</GlassButton>
      <GlassButton onClick={props.onLoadAll} disabled={props.isLoading()}>
        Load All
      </GlassButton>
      
      <Show when={props.isLoading()}>
        <div class="load-progress">
          <div class="bar" style={{ width: `${props.loadProgress()}%` }} />
        </div>
      </Show>
      
      <select
        class="glass-select level-select"
        value={props.selectedLevel() ?? ''}
        onChange={(e) => {
          const val = e.currentTarget.value;
          props.setSelectedLevel(val ? parseInt(val) : null);
        }}
      >
        <option value="">All Levels</option>
        <For each={Object.entries(props.levelNames)}>
          {([level, name]) => <option value={level}>{name}</option>}
        </For>
      </select>
      
      <span class="hint">
        Enter to search; exact matches prioritized. Press Load All first.
      </span>
    </div>
  );
};

export default SearchBar;
