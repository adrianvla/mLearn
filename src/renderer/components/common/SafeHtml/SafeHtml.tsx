import { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { sanitizeHtml } from '../../../utils/sanitizeHtml';

export interface SafeHtmlProps {
  tag: 'span' | 'div' | 'p' | 'h1';
  class?: string;
  html?: string;
}

export const SafeHtml: Component<SafeHtmlProps> = (props) => (
  <Dynamic component={props.tag} class={props.class} innerHTML={sanitizeHtml(props.html ?? '')} />
);
