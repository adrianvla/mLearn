import { Component, Show, createSignal } from 'solid-js';
import { useLocalization } from '../../context';
import type { PolicyDecision } from '../../learning/types';
import './PolicyWhy.css';

/**
 * R20 explanation surface for ONE policy decision (the pinned pick the
 * review is showing). Default UX is the brief contextual reason the decision
 * itself carries; the inline "Why?" adds a short learner-facing explanation.
 * Detailed policy traces remain available in the knowledge Inspector.
 *
 * G02 boundary: this view renders ONLY its props (the decision's selection
 * fields); card answer content never enters a PolicyDecision, so nothing
 * here can leak it — the trace-content guarantee itself is pinned at the
 * policy's own trace tests (teachingPolicy.test.ts, R20).
 */
export const PolicyWhy: Component<{ decision: PolicyDecision | null | undefined }> = (props) => {
  const { t } = useLocalization();
  const [expanded, setExpanded] = createSignal(false);

  return (
    <Show when={props.decision} keyed>
      {(decision) => (
        <div class="policy-why" data-testid="policy-why" data-action={decision.action ?? 'none'}>
          <div class="policy-why__summary">
            <span class="policy-why__title">{t('mlearn.Review.Why.Title')}</span>
            <span class="policy-why__brief" data-testid="policy-why-brief">{decision.encounter.why}</span>
            <button
              type="button"
              class="policy-why__toggle"
              data-testid="policy-why-toggle"
              aria-expanded={expanded()}
              onClick={(click) => { if (click.detail > 1) return; setExpanded((value) => !value); }}
              onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
            >
              {expanded() ? t('mlearn.Review.Why.Hide') : t('mlearn.Review.Why.Show')}
            </button>
          </div>
          <Show when={expanded()}>
            <div class="policy-why__details" data-testid="policy-why-details">
              <p class="policy-why__explanation">{t('mlearn.Review.Why.Explanation')}</p>
              <p class="policy-why__reason">{decision.encounter.why}</p>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
};

export default PolicyWhy;
