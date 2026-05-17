/**
 * Summary Header Component
 */

import { Component } from 'solid-js';
import type { DiagnosticsReport } from '../../../../shared/diagnostics/types';

interface SummaryHeaderProps {
  summary: DiagnosticsReport['summary'];
}

export const SummaryHeader: Component<SummaryHeaderProps> = (props) => {
  const total = () => props.summary.total;
  const passed = () => props.summary.passed;
  const failed = () => props.summary.failed;
  const skipped = () => props.summary.skipped;
  const duration = () => (props.summary.durationMs / 1000).toFixed(1);

  const allPassed = () => failed() === 0;

  return (
    <div class={`diagnostics-summary ${allPassed() ? 'success' : 'failure'}`}>
      <div class="diagnostics-summary-stat">
        <span class="diagnostics-summary-number">{passed()}</span>
        <span class="diagnostics-summary-label">Passed</span>
      </div>
      <div class="diagnostics-summary-stat">
        <span class="diagnostics-summary-number fail">{failed()}</span>
        <span class="diagnostics-summary-label">Failed</span>
      </div>
      <div class="diagnostics-summary-stat">
        <span class="diagnostics-summary-number skip">{skipped()}</span>
        <span class="diagnostics-summary-label">Skipped</span>
      </div>
      <div class="diagnostics-summary-stat">
        <span class="diagnostics-summary-number">{total()}</span>
        <span class="diagnostics-summary-label">Total</span>
      </div>
      <div class="diagnostics-summary-stat">
        <span class="diagnostics-summary-number">{duration()}s</span>
        <span class="diagnostics-summary-label">Duration</span>
      </div>
    </div>
  );
};
