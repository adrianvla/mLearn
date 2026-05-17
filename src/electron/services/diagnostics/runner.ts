/**
 * Diagnostics Test Runner
 * Executes suites and tests with timeouts, collects results, and reports progress.
 */

import { BrowserWindow } from 'electron';
import { getDiagnosticSuites } from '../../../shared/diagnostics/registry';
import type {
  DiagnosticsReport,
  DiagnosticsProgressEvent,
  TestSuiteResult,
  TestResult,
} from '../../../shared/diagnostics/types';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../../shared/diagnostics/constants';
import { DIAGNOSTICS_IPC } from '../../../shared/diagnostics/constants';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger('electron.diagnostics');

let currentReport: DiagnosticsReport | null = null;

function createReport(): DiagnosticsReport {
  return {
    timestamp: new Date().toISOString(),
    appVersion: require('electron').app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
    suites: [],
    summary: { passed: 0, failed: 0, skipped: 0, total: 0, durationMs: 0 },
  };
}

async function runWithTimeout<T>(fn: () => Promise<T> | T, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Test timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(fn())
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function runAllDiagnostics(
  progressWindow: BrowserWindow | null,
): Promise<DiagnosticsReport> {
  const suites = getDiagnosticSuites();
  const report = createReport();
  const startTime = Date.now();

  log.info(`Starting diagnostics: ${suites.length} suites`);

  for (let suiteIndex = 0; suiteIndex < suites.length; suiteIndex++) {
    const suite = suites[suiteIndex];
    const suiteResult: TestSuiteResult = {
      name: suite.name,
      status: 'pending',
      tests: [],
      durationMs: 0,
    };

    const suiteStart = Date.now();
    let suiteHasFailure = false;
    let suiteHasSkip = false;

    for (let testIndex = 0; testIndex < suite.tests.length; testIndex++) {
      const test = suite.tests[testIndex];
      const testResult: TestResult = {
        name: test.name,
        status: 'running',
        durationMs: 0,
      };

      // Report progress
      const progress: DiagnosticsProgressEvent = {
        suiteName: suite.name,
        testName: test.name,
        status: 'running',
        currentSuiteIndex: suiteIndex,
        totalSuites: suites.length,
        currentTestIndex: testIndex,
        totalTestsInSuite: suite.tests.length,
      };

      if (progressWindow && !progressWindow.isDestroyed()) {
        progressWindow.webContents.send(DIAGNOSTICS_IPC.TEST_PROGRESS, progress);
      }

      const testStart = Date.now();
      try {
        await runWithTimeout(test.fn, test.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS);
        testResult.status = 'passed';
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('SKIP:')) {
          testResult.status = 'skipped';
          testResult.error = err.message.replace(/^SKIP:\s*/, '');
          suiteHasSkip = true;
        } else {
          testResult.status = 'failed';
          testResult.error = err instanceof Error ? err.message : String(err);
          testResult.stack = err instanceof Error ? err.stack : undefined;
          suiteHasFailure = true;
          log.warn(`Diagnostic failed [${suite.name}::${test.name}]:`, testResult.error);
        }
      }
      testResult.durationMs = Date.now() - testStart;
      suiteResult.tests.push(testResult);

      // Update progress with final status
      progress.status = testResult.status;
      if (progressWindow && !progressWindow.isDestroyed()) {
        progressWindow.webContents.send(DIAGNOSTICS_IPC.TEST_PROGRESS, progress);
      }
    }

    suiteResult.durationMs = Date.now() - suiteStart;
    if (suiteHasFailure) {
      suiteResult.status = 'failed';
    } else if (suiteHasSkip && suiteResult.tests.every((t) => t.status === 'skipped')) {
      suiteResult.status = 'skipped';
    } else {
      suiteResult.status = 'passed';
    }

    report.suites.push(suiteResult);
  }

  report.summary.durationMs = Date.now() - startTime;
  for (const suite of report.suites) {
    for (const test of suite.tests) {
      report.summary.total++;
      if (test.status === 'passed') report.summary.passed++;
      else if (test.status === 'failed') report.summary.failed++;
      else if (test.status === 'skipped') report.summary.skipped++;
    }
  }

  currentReport = report;
  log.info(`Diagnostics complete: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`);

  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.webContents.send(DIAGNOSTICS_IPC.TEST_COMPLETE, report);
  }

  return report;
}

export function getCurrentDiagnosticsReport(): DiagnosticsReport | null {
  return currentReport;
}
