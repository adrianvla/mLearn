import { Component, For } from 'solid-js';
import { Button } from '../Button/Button';
import './SortableList.css';

export interface SortableListItem {
  id: string;
  label: string;
}

export interface SortableListProps {
  items: SortableListItem[];
  onChange: (newIds: string[]) => void;
}

export const SortableList: Component<SortableListProps> = (props) => {
  const moveUp = (index: number) => {
    if (index <= 0) return;
    const ids = props.items.map(i => i.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    props.onChange(ids);
  };

  const moveDown = (index: number) => {
    if (index >= props.items.length - 1) return;
    const ids = props.items.map(i => i.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    props.onChange(ids);
  };

  return (
    <div class="sortable-list">
      <For each={props.items}>
        {(item, index) => (
          <div class="sortable-list-item">
            <span class="sortable-list-item-rank">{index() + 1}</span>
            <span class="sortable-list-item-label">{item.label}</span>
            <div class="sortable-list-item-controls">
              <Button
                variant="ghost"
                size="sm"
                icon="chevron"
                onClick={() => moveUp(index())}
                disabled={index() === 0}
              />
              <Button
                variant="ghost"
                size="sm"
                icon="chevron"
                class="sortable-list-btn-down"
                onClick={() => moveDown(index())}
                disabled={index() === props.items.length - 1}
              />
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
