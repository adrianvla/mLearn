import { Show, type Accessor, type Component, type JSX } from 'solid-js';
import type { HoverData } from '../../hooks/useWordHover';

/** Keep one popup instance alive while its active target or anchor geometry updates. */
export const StableWordHover: Component<{
  data: Accessor<HoverData | null>;
  children: (data: Accessor<HoverData>) => JSX.Element;
}> = (props) => (
  <Show when={props.data()}>{props.children}</Show>
);
