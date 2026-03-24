import { Component } from 'solid-js';

interface ChevronProps {
  color: string;
  class: string;
}

const Chevron: Component<ChevronProps> = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class={props.class} xmlns="http://www.w3.org/2000/svg">
    <path d="M6 15L12 9L18 15" stroke={props.color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
);

export default Chevron;