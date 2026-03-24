import { Component } from 'solid-js';

interface Cross2Props {
  color: string;
  class: string;
}

const Cross2: Component<Cross2Props> = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class={props.class} xmlns="http://www.w3.org/2000/svg" style={{ transform: 'rotate(45deg)' }}>
    <g id="SVGRepo_bgCarrier" stroke-width="0"/>
    <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"/>
    <g id="SVGRepo_iconCarrier">
      <circle cx="12" cy="12" r="10" stroke={props.color} stroke-width="2"/>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M13.0001 7C13.0001 6.44771 12.5524 6 12.0001 6C11.4479 6 11.0001 6.44771 11.0001 7V11H7C6.44771 11 6 11.4477 6 12C6 12.5523 6.44772 13 7 13H11.0001V17C11.0001 17.5523 11.4479 18 12.0001 18C12.5524 18 13.0001 17.5523 13.0001 17V13H17C17.5523 13 18 12.5523 18 12C18 11.4477 17.5523 11 17 11H13.0001V7Z" fill={props.color}/>
    </g>
  </svg>
);

export default Cross2;