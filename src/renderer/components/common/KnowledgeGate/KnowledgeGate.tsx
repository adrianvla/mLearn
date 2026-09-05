import { Component, Show, type JSX } from 'solid-js';
import { useFlashcards } from '../../../context';
import './KnowledgeGate.css';

/**
 * Shared readiness gate for knowledge-derived UI.
 *
 * One primitive, one skeleton vocabulary: knowledge consumers render their
 * content only once the learner projection has hydrated AND the legacy
 * migration settled (`useFlashcards().isKnowledgeReady()`), and otherwise
 * render the shared placeholder. This is the single sanctioned way to express
 * "unresolved ≠ untracked" in components — no per-component spinners, no
 * ad-hoc skeleton markup.
 */

export type KnowledgeSkeletonVariant = 'pill' | 'lines' | 'word-sync';

export const KnowledgeSkeleton: Component<{ variant?: KnowledgeSkeletonVariant; class?: string }> = (props) => {
  const variant = () => props.variant ?? 'lines';
  return (
    <Show when={variant() === 'word-sync'} fallback={
      <span class={`knowledge-skeleton knowledge-skeleton--${variant()}${props.class ? ` ${props.class}` : ''}`} aria-busy="true" />
    }>
      <div class={`knowledge-skeleton knowledge-skeleton--word-sync${props.class ? ` ${props.class}` : ''}`} aria-busy="true">
        <span class="knowledge-skeleton__word" />
        <span class="knowledge-skeleton__line" />
        <span class="knowledge-skeleton__actions">
          <span class="knowledge-skeleton__action" />
          <span class="knowledge-skeleton__action" />
          <span class="knowledge-skeleton__action" />
        </span>
      </div>
    </Show>
  );
};

export interface KnowledgeGateProps {
  children: JSX.Element;
  /** Placeholder shown while knowledge has not hydrated. Defaults to the shared skeleton. */
  fallback?: JSX.Element;
  /** Skeleton variant used when no explicit fallback is supplied. */
  variant?: KnowledgeSkeletonVariant;
  class?: string;
}

export const KnowledgeGate: Component<KnowledgeGateProps> = (props) => {
  const { isKnowledgeReady } = useFlashcards();
  return (
    <Show
      when={isKnowledgeReady()}
      fallback={props.fallback ?? <KnowledgeSkeleton variant={props.variant} class={props.class} />}
    >
      {props.children}
    </Show>
  );
};
