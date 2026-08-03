/**
 * WelcomeFeatureCard
 * Route-specific compound card for the welcome feature grid: a stretched
 * main-action button with a visible header and an optional sibling preview
 * area that may carry its own real controls.
 */

import { Component, createUniqueId, JSX, Show } from 'solid-js';
import './WelcomeFeatureCard.css';

export interface WelcomeFeatureCardProps {
  /** Icon shown in the card header */
  icon: JSX.Element;
  /** Title text */
  title: string;
  /** Description text (clamped to two lines) */
  description: string;
  /** Optional sibling preview area rendered under the header */
  preview?: JSX.Element;
  /** Click handler for the main action */
  onClick?: () => void;
  /** Disables only the main action; preview controls stay available */
  disabled?: boolean;
  /** Additional class names */
  class?: string;
}

export const WelcomeFeatureCard: Component<WelcomeFeatureCardProps> = (props) => {
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();

  const handleClick = () => {
    if (!props.disabled && props.onClick) {
      props.onClick();
    }
  };

  return (
    <article
      class={`welcome-feature-card ${props.disabled ? 'is-main-disabled' : ''} ${props.class || ''}`}
    >
      <button
        type="button"
        class="welcome-feature-card-main"
        onClick={handleClick}
        disabled={props.disabled}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      />
      <header class="welcome-feature-card-header">
        <span class="welcome-feature-card-icon" aria-hidden="true">{props.icon}</span>
        <div class="welcome-feature-card-text">
          <h3 id={titleId}>{props.title}</h3>
          <p id={descriptionId}>{props.description}</p>
        </div>
      </header>
      <Show when={props.preview}>
        {(preview) => (
          <div class="welcome-feature-card-preview">{preview()}</div>
        )}
      </Show>
    </article>
  );
};

export default WelcomeFeatureCard;
