import { splitProps, type Component, type JSX } from 'solid-js';
import './Disclosure.css';
export interface DisclosureProps extends Omit<JSX.DetailsHtmlAttributes<HTMLDetailsElement>, 'title'> {
  title: JSX.Element;
}
/** Native keyboard behaviour and one shared disclosure presentation. */
export const Disclosure: Component<DisclosureProps> = (props) => {
  const [local, rest] = splitProps(props, ['title', 'children', 'class']);
  return <details {...rest} class={`disclosure ${local.class ?? ''}`}>
    <summary class="disclosure__summary">{local.title}</summary>
    <div class="disclosure__body">{local.children}</div>
  </details>;
};
