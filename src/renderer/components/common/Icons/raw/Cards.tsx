import { Component } from 'solid-js';

interface CardsProps {
  color: string;
  class: string;
}

const Cards: Component<CardsProps> = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" role="img" xmlns="http://www.w3.org/2000/svg" aria-labelledby="cardsIconTitle" stroke={props.color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" class={props.class} color={props.color}>
    <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
    <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
    <g id="SVGRepo_iconCarrier">
      <title id="cardsIconTitle">Cards</title>
      <rect width="13" height="13" x="3" y="3"></rect>
      <polyline points="16 8 21 8 21 21 8 21 8 16"></polyline>
    </g>
  </svg>
);

export default Cards;