import { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { sanitizeHtml } from '../../../utils/sanitizeHtml';
import './SafeHtml.css';

export interface SafeHtmlProps {
  tag: 'span' | 'div' | 'p' | 'h1';
  class?: string;
  html?: string;
  /** Old generated word snapshots keep their markup but use the current theme. */
  storedWordPresentation?: boolean;
}

export const SafeHtml: Component<SafeHtmlProps> = (props) => (
  <Dynamic component={props.tag} class={props.class}
    classList={{ 'safe-html--stored-words': props.storedWordPresentation }}
    innerHTML={sanitizeHtml(props.html ?? '')} />
);
