/**
 * Shared types for the diagnostics/testing framework
 */

export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface TestResult {
  name: string;
  status: TestStatus;
  durationMs: number;
  error?: string;
  stack?: string;
}

export interface TestSuiteResult {
  name: string;
  status: TestStatus;
  tests: TestResult[];
  durationMs: number;
}

export interface DiagnosticsReport {
  timestamp: string;
  appVersion: string;
  platform: string;
  suites: TestSuiteResult[];
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
    durationMs: number;
  };
}

export interface DiagnosticsProgressEvent {
  suiteName: string;
  testName: string;
  status: TestStatus;
  currentSuiteIndex: number;
  totalSuites: number;
  currentTestIndex: number;
  totalTestsInSuite: number;
}

export type TestFunction = () => Promise<void> | void;

export interface DiagnosticTest {
  name: string;
  fn: TestFunction;
  timeoutMs?: number;
}

export interface DiagnosticTestSuite {
  name: string;
  tests: DiagnosticTest[];
}
