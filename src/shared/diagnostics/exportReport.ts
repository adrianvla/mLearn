import type { DiagnosticsReport } from './types';

/** Export only fixed diagnostic results. Failure messages and stacks may contain
 * local paths, media titles, request URLs or provider credentials. */
export function diagnosticsExport(report: DiagnosticsReport): string {
  return JSON.stringify({
    timestamp: report.timestamp,
    appVersion: report.appVersion,
    platform: report.platform,
    detailsOmitted: true,
    summary: {
      passed: report.summary.passed,
      failed: report.summary.failed,
      skipped: report.summary.skipped,
      total: report.summary.total,
      durationMs: report.summary.durationMs,
    },
    suites: report.suites.map((suite) => ({
      name: suite.name,
      status: suite.status,
      durationMs: suite.durationMs,
      tests: suite.tests.map((test) => ({
        name: test.name,
        status: test.status,
        durationMs: test.durationMs,
      })),
    })),
  }, null, 2);
}
