import { Component } from 'solid-js';

interface PlayProps {
  color: string;
  class: string;
}

const Play: Component<PlayProps> = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class={props.class} xmlns="http://www.w3.org/2000/svg">
    <title>Play</title>
    <path d="M8 5v14l11-7z" fill={props.color}/>
  </svg>
);

export default Play;
