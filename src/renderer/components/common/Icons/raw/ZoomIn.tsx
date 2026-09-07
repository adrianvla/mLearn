import { Component } from 'solid-js';

interface ZoomInProps {
  color: string;
  class: string;
}

const ZoomIn: Component<ZoomInProps> = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class={props.class} xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="7" stroke={props.color} stroke-width="2" stroke-linecap="round" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" stroke={props.color} stroke-width="2" stroke-linecap="round" />
    <line x1="8" y1="11" x2="14" y2="11" stroke={props.color} stroke-width="2" stroke-linecap="round" />
    <line x1="11" y1="8" x2="11" y2="14" stroke={props.color} stroke-width="2" stroke-linecap="round" />
  </svg>
);

export default ZoomIn;
