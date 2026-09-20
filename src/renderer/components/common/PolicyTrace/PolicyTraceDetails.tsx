import { Component, For, Show } from 'solid-js';
import { useLocalization } from '../../../context';
import type { PolicyTrace } from '../../../learning/types';
import './PolicyTraceDetails.css';

/** Bounded numeric rendering: 3 decimals, no invented precision. */
const fmt = (value: number): string => (Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : String(value));

/** Scalar metadata entries only — the explanation renders what the policy
 *  carried verbatim; nothing is invented or interpreted here (R20). */
const scalarMeta = (meta: Record<string, unknown> | undefined): Array<[string, string]> => {
  if (meta === undefined) return [];
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      entries.push([key, String(value)]);
    }
    if (entries.length >= 6) break;
  }
  return entries;
};

/**
 * R20 expanded details view of ONE emitted policy trace: effective weights
 * (with each rule's exact arithmetic and reason), the ranking (selected
 * first) with per-dimension contributions and carried provenance, bounded
 * exclusions, and the honesty limits. Renders the trace VERBATIM — it never
 * recomputes, reinterprets, or narrates. Used by the inline review
 * explanation (PolicyWhy) and the knowledge Inspector drawer, so both
 * surfaces show the SAME calculation.
 */
export const PolicyTraceDetails: Component<{ trace: PolicyTrace }> = (props) => {
  const { t } = useLocalization();
  return (
    <>
      <div class="policy-why__section">
        <span class="policy-why__heading">{t('mlearn.Review.Why.Weights')}</span>
        <For each={Object.entries(props.trace.weights.effective)}>
          {([dimension, weight]) => (
            <span class="policy-why__kv" data-dimension={dimension}>
              <span>{dimension}</span>
              <span>{fmt(weight ?? 0)}</span>
            </span>
          )}
        </For>
        <For each={props.trace.weights.rules}>
          {(rule) => (
            <span class="policy-why__kv policy-why__kv--rule">
              <span>{rule.rule}</span>
              <span>{`×${fmt(rule.multiplier)} ${rule.addend ? `+${fmt(rule.addend)}` : ''}`}</span>
              <span class="policy-why__why">{rule.why}</span>
            </span>
          )}
        </For>
      </div>
      <div class="policy-why__section">
        <span class="policy-why__heading">
          {t('mlearn.Review.Why.Ranking')}
          <Show when={props.trace.rankingOmitted > 0}>
            {` +${props.trace.rankingOmitted}`}
          </Show>
        </span>
        <For each={props.trace.ranking}>
          {(row) => (
            <div class="policy-why__rank" data-key={row.key} data-selected={row.key === props.trace.selectedKey}>
              <span class="policy-why__kv">
                <span>{`${row.key} · ${row.origin}`}</span>
                <span>{fmt(row.total)}</span>
              </span>
              <For each={row.contributions}>
                {(contribution) => (
                  <span class="policy-why__kv policy-why__kv--term">
                    <span>{contribution.dimension}</span>
                    <span>{`${fmt(contribution.score)} × ${fmt(contribution.weight)} (${fmt(contribution.value)})`}</span>
                  </span>
                )}
              </For>
              <For each={scalarMeta(row.meta)}>
                {([key, value]) => (
                  <span class="policy-why__kv policy-why__kv--term">
                    <span>{key}</span>
                    <span>{value}</span>
                  </span>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
      <Show when={props.trace.exclusions.length > 0}>
        <div class="policy-why__section">
          <span class="policy-why__heading">
            {t('mlearn.Review.Why.Excluded')}
            <Show when={props.trace.exclusionsOmitted > 0}>
              {` +${props.trace.exclusionsOmitted}`}
            </Show>
          </span>
          <For each={props.trace.exclusions}>
            {(exclusion) => (
              <span class="policy-why__kv policy-why__kv--term" data-key={exclusion.key}>
                <span>{exclusion.key}</span>
                <span>{exclusion.reason}</span>
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="policy-why__section">
        <span class="policy-why__heading">{t('mlearn.Review.Why.Limits')}</span>
        <For each={props.trace.limits}>
          {(limit) => <span class="policy-why__limit">{limit}</span>}
        </For>
      </div>
    </>
  );
};

export default PolicyTraceDetails;
