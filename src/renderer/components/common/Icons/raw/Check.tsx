import { Component } from 'solid-js';

interface CheckProps {
  color: string;
  class: string;
}

const Check: Component<CheckProps> = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class={props.class} xmlns="http://www.w3.org/2000/svg">
    <path d="M7.29417 12.9577L10.5048 16.1681L17.6729 9" stroke={props.color} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="10" stroke={props.color} stroke-width="2"/>
  </svg>
);

export default Check;