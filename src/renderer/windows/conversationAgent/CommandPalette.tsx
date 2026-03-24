import { Component, For, Show } from 'solid-js';
import './CommandPalette.css';

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
}

interface CommandPaletteProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  return (
    <Show when={props.commands.length > 0}>
      <div class="command-palette">
        <For each={props.commands}>
          {(cmd, index) => (
            <div
              class={`command-palette-item ${index() === props.selectedIndex ? 'command-palette-item--selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); props.onSelect(cmd); }}
            >
              <span class="command-palette-name">/{cmd.id}</span>
              <span class="command-palette-desc">{cmd.description}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
};
