/**
 * Test Suite Card Component
 */

import { Component, createSignal, For, Show } from 'solid-js';
import type { TestSuiteResult, TestResult } from '../../../../shared/diagnostics/types';
import { TestDetailRow } from './TestDetailRow';

interface TestSuiteCardProps {
  suite: TestSuiteResult;
  tests?: TestResult[];
  isActive?: boolean;
}

export const TestSuiteCard: Component<TestSuiteCardProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const visibleTests = () => props.tests ?? props.suite.tests;

  const statusIcon = () => {
    switch (props.suite.status) {
      case 'passed': return '✓';
      case 'failed': return '✗';
      case 'skipped': return '−';
      case 'running': return '⟳';
      default: return '○';
    }
  };

  const passedCount = () => props.suite.tests.filter((t) => t.status === 'passed').length;
  const visibleCount = () => visibleTests().length;
  const totalCount = () => props.suite.tests.length;
  const isFiltered = () => visibleCount() !== totalCount();

  return (
    <div class={`diagnostics-suite ${props.suite.status} ${props.isActive ? 'active' : ''}`}>
      <button class="diagnostics-suite-header" onClick={() => setExpanded(!expanded())}>
        <span class="diagnostics-suite-icon">{statusIcon()}</span>
        <span class="diagnostics-suite-name">{props.suite.name}</span>
        <span class="diagnostics-suite-counts">
          {isFiltered() ? `${visibleCount()} of ${totalCount()} shown` : `${passedCount()} / ${totalCount()}`}
        </span>
        <span class="diagnostics-suite-duration">{props.suite.durationMs}ms</span>
        <span class="diagnostics-suite-chevron">{expanded() ? '▼' : '▶'}</span>
      </button>

      <Show when={expanded()}>
        <div class="diagnostics-suite-tests">
          <For each={visibleTests()}>
            {(test) => <TestDetailRow test={test} />}
          </For>
        </div>
      </Show>
    </div>
  );
};
