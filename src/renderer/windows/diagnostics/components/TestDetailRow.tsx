/**
 * Test Detail Row Component
 */

import { Component, Show } from 'solid-js';
import type { TestResult } from '../../../../shared/diagnostics/types';

interface TestDetailRowProps {
  test: TestResult;
}

export const TestDetailRow: Component<TestDetailRowProps> = (props) => {
  const statusIcon = () => {
    switch (props.test.status) {
      case 'passed': return '✓';
      case 'failed': return '✗';
      case 'skipped': return '−';
      default: return '○';
    }
  };

  return (
    <div class={`diagnostics-test-row ${props.test.status}`}>
      <span class="diagnostics-test-icon">{statusIcon()}</span>
      <span class="diagnostics-test-name">{props.test.name}</span>
      <span class="diagnostics-test-duration">{props.test.durationMs}ms</span>
      <Show when={props.test.error}>
        <div class="diagnostics-test-error">
          {props.test.error}
        </div>
      </Show>
    </div>
  );
};
