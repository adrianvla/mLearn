import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { Button, type ButtonProps } from '../Button';
import './ListRow.css';

export interface ListRowProps extends Omit<ButtonProps, 'children' | 'label' | 'buttonType'> {
  headline: JSX.Element;
  description?: JSX.Element;
  leading?: JSX.Element;
  trailing?: JSX.Element;
  selected?: boolean;
}

/** One shared, keyboard-accessible row for contact pickers and navigation lists. */
export const ListRow: Component<ListRowProps> = (props) => {
  const [local, button] = splitProps(props, ['headline', 'description', 'leading', 'trailing', 'selected', 'class']);
  return <Button type="button" variant="ghost" {...button}
    class={`list-row ${local.selected ? 'list-row--selected' : ''} ${local.class ?? ''}`}>
    <Show when={local.leading}><span class="list-row__leading">{local.leading}</span></Show>
    <span class="list-row__copy">
      <span class="list-row__headline">{local.headline}</span>
      <Show when={local.description}><span class="list-row__description">{local.description}</span></Show>
    </span>
    <Show when={local.trailing}><span class="list-row__trailing">{local.trailing}</span></Show>
  </Button>;
};
