/**
 * Diagnostics Window App
 */

import { Component, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { getBridge } from '../../../shared/bridges';

import type { DiagnosticsReport, DiagnosticsProgressEvent, TestSuiteResult } from '../../../shared/diagnostics/types';
import { SummaryHeader } from './components/SummaryHeader';
import { TestSuiteCard } from './components/TestSuiteCard';
import './diagnostics.css';

export const DiagnosticsApp: Component = () => {
  const [isRunning, setIsRunning] = createSignal(false);
  const [report, setReport] = createSignal<DiagnosticsReport | null>(null);
  const [suites, setSuites] = createSignal<TestSuiteResult[]>([]);
  const [currentProgress, setCurrentProgress] = createSignal<DiagnosticsProgressEvent | null>(null);
  const [filter, setFilter] = createSignal<'all' | 'pass' | 'fail' | 'skip'>('all');
  const [exportPath, setExportPath] = createSignal<string | null>(null);

  const bridge = getBridge();
  let unlistenProgress: (() => void) | null = null;
  let unlistenComplete: (() => void) | null = null;

  onMount(() => {
    unlistenProgress = bridge.diagnostics.onDiagnosticsProgress((progress: DiagnosticsProgressEvent) => {
      setCurrentProgress(progress);
      setSuites((prev) => {
        const next = [...prev];
        const suiteIndex = next.findIndex((s) => s.name === progress.suiteName);
        if (suiteIndex >= 0) {
          const suite = { ...next[suiteIndex] };
          const testIndex = suite.tests.findIndex((t) => t.name === progress.testName);
          if (testIndex >= 0) {
            suite.tests = [...suite.tests];
            suite.tests[testIndex] = { ...suite.tests[testIndex], status: progress.status };
          } else {
            suite.tests = [...suite.tests, { name: progress.testName, status: progress.status, durationMs: 0 }];
          }
          next[suiteIndex] = suite;
        } else {
          next.push({
            name: progress.suiteName,
            status: 'running',
            tests: [{ name: progress.testName, status: progress.status, durationMs: 0 }],
            durationMs: 0,
          });
        }
        return next;
      });
    });

    unlistenComplete = bridge.diagnostics.onDiagnosticsComplete((result: DiagnosticsReport) => {
      setReport(result);
      setSuites(result.suites);
      setIsRunning(false);
      setCurrentProgress(null);
    });
  });

  onCleanup(() => {
    unlistenProgress?.();
    unlistenComplete?.();
  });

  const runDiagnostics = async () => {
    setIsRunning(true);
    setReport(null);
    setSuites([]);
    setExportPath(null);
    try {
      const result = await bridge.diagnostics.runDiagnostics();
      setReport(result);
      setSuites(result.suites);
    } catch (err) {
      console.error('Diagnostics failed:', err);
    } finally {
      setIsRunning(false);
      setCurrentProgress(null);
    }
  };

  const exportReport = async () => {
    const r = report();
    if (!r) return;
    try {
      const path = await bridge.diagnostics.saveDiagnosticsReport(JSON.stringify(r, null, 2));
      setExportPath(path);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const filteredSuites = () => {
    const f = filter();
    if (f === 'all') {
      return suites().map((s) => ({ suite: s, tests: s.tests }));
    }
    return suites()
      .map((s) => {
        const visibleTests = s.tests.filter((t) => {
          if (f === 'pass') return t.status === 'passed';
          if (f === 'fail') return t.status === 'failed';
          if (f === 'skip') return t.status === 'skipped';
          return true;
        });
        return { suite: s, tests: visibleTests };
      })
      .filter((item) => item.tests.length > 0);
  };

  return (
    <div class="diagnostics-root">
      <div class="diagnostics-header">
        <h1>mLearn Diagnostics</h1>
        <div class="diagnostics-actions">
          <Show when={!isRunning()}>
            <button class="diagnostics-btn primary" onClick={runDiagnostics} disabled={isRunning()}>
              {report() ? 'Run Again' : 'Run All Tests'}
            </button>
          </Show>
          <Show when={isRunning()}>
            <div class="diagnostics-running">
              <span class="diagnostics-spinner" />
              <span>Running…</span>
              <Show when={currentProgress()}>
                <span class="diagnostics-progress-detail">
                  {currentProgress()?.suiteName} :: {currentProgress()?.testName}
                </span>
              </Show>
            </div>
          </Show>
          <Show when={report()}>
            <button class="diagnostics-btn" onClick={exportReport}>
              Export JSON
            </button>
          </Show>
        </div>
      </div>

      <Show when={exportPath()}>
        <div class="diagnostics-export-notice">
          Report saved to: {exportPath()}
        </div>
      </Show>

      <Show when={report()}>
        <SummaryHeader summary={report()!.summary} />
      </Show>

      <Show when={report()}>
        <div class="diagnostics-filters">
          <button class={filter() === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
          <button class={filter() === 'pass' ? 'active' : ''} onClick={() => setFilter('pass')}>Pass</button>
          <button class={filter() === 'fail' ? 'active' : ''} onClick={() => setFilter('fail')}>Fail</button>
          <button class={filter() === 'skip' ? 'active' : ''} onClick={() => setFilter('skip')}>Skip</button>
        </div>
      </Show>

      <div class="diagnostics-suites">
        <For each={filteredSuites()}>
          {(item) => (
            <TestSuiteCard
              suite={item.suite}
              tests={item.tests}
              isActive={currentProgress()?.suiteName === item.suite.name}
            />
          )}
        </For>
      </div>

      <Show when={!isRunning() && !report() && suites().length === 0}>
        <div class="diagnostics-empty">
          <p>Click "Run All Tests" to validate every feature in mLearn.</p>
          <p class="diagnostics-empty-sub">
            This will test the Python backend, LLM providers, cloud connectivity,
            dictionaries, OCR, voice, storage, media protocols, and more — all using real services.
          </p>
        </div>
      </Show>
    </div>
  );
};
