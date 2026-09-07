import { Component } from 'solid-js';

interface FitViewProps {
  color: string;
  class: string;
}

const FitView: Component<FitViewProps> = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class={props.class} xmlns="http://www.w3.org/2000/svg">
    <path d="M4 9V5a1 1 0 0 1 1-1h4" stroke={props.color} stroke-width="2" stroke-linecap="round" />
    <path d="M15 4h4a1 1 0 0 1 1 1v4" stroke={props.color} stroke-width="2" stroke-linecap="round" />
    <path d="M20 15v4a1 1 0 0 1-1 1h-4" stroke={props.color} stroke-width="2" stroke-linecap="round" />
    <path d="M9 20H5a1 1 0 0 1-1-1v-4" stroke={props.color} stroke-width="2" stroke-linecap="round" />
    <circle cx="12" cy="12" r="2.5" stroke={props.color} stroke-width="2" />
  </svg>
);

export default FitView;
