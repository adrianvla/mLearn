import { Component, JSX, Show, splitProps } from 'solid-js';
import './Panel.css';

export interface PanelProps {
  title?: string;
  actions?: JSX.Element;
  children: JSX.Element;
  padding?: 'sm' | 'md' | 'lg';
  noBorder?: boolean;
}

export const Panel: Component<PanelProps> = (props) => {
  const [local] = splitProps(props, ['title', 'actions', 'children', 'padding', 'noBorder']);
  return (
    <section
      class="mlearn-panel"
      classList={{ 'mlearn-panel--no-border': local.noBorder === true }}
    >
      <Show when={local.title !== undefined || local.actions !== undefined}>
        <header class="mlearn-panel__header">
          <Show when={local.title !== undefined} fallback={<span class="mlearn-panel__spacer" />}>
            <h3 class="mlearn-panel__title">{local.title}</h3>
          </Show>
          <Show when={local.actions !== undefined}>
            <div class="mlearn-panel__actions">{local.actions}</div>
          </Show>
        </header>
      </Show>
      <div
        class="mlearn-panel__body"
        classList={{
          'mlearn-panel__body--sm': local.padding === 'sm',
          'mlearn-panel__body--md': local.padding === undefined || local.padding === 'md',
          'mlearn-panel__body--lg': local.padding === 'lg',
        }}
      >
        {local.children}
      </div>
    </section>
  );
};
