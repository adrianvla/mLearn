import { Component } from 'solid-js';

interface StatsProps {
  color: string;
  class: string;
}

const Stats: Component<StatsProps> = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class={props.class} xmlns="http://www.w3.org/2000/svg">
    <title>Statistics</title>
    <rect x="18" y="10" width="4" height="10" rx="1" fill={props.color}/>
    <rect x="10" y="4" width="4" height="16" rx="1" fill={props.color}/>
    <rect x="2" y="14" width="4" height="6" rx="1" fill={props.color}/>
  </svg>
);

export default Stats;
