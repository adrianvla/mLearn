import { Component, For, Show } from 'solid-js';
import { PillLabel } from './Label';
import './LevelPillsFilter.css';

interface LevelPillsFilterProps {
  allLabel: string;
  levels: number[];
  selectedLevel: number | null;
  onLevelChange: (level: number | null) => void;
  getLevelLabel: (level: number) => string;
  class?: string;
}

export const LevelPillsFilter: Component<LevelPillsFilterProps> = (props) => {
  return (
    <Show when={props.levels.length > 1}>
      <div class={`level-pills-filter ${props.class ?? ''}`.trim()}>
        <PillLabel
          variant="gray"
          clickable
          active={props.selectedLevel === null}
          onClick={() => {
            props.onLevelChange(null);
          }}
        >
          {props.allLabel}
        </PillLabel>
        <For each={props.levels}>
          {(level) => (
            <PillLabel
              level={level}
              clickable
              active={props.selectedLevel === level}
              onClick={() => {
                props.onLevelChange(level);
              }}
            >
              {props.getLevelLabel(level)}
            </PillLabel>
          )}
        </For>
      </div>
    </Show>
  );
};
