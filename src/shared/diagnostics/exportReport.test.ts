import { describe, expect, it } from 'vitest';
import { diagnosticsExport } from './exportReport';
import type { DiagnosticsReport } from './types';

describe('diagnostics export', () => {
  it('keeps outcomes while excluding failure detail and unexpected renderer fields', () => {
    const report: DiagnosticsReport = {
      timestamp: '2026-09-25T00:00:00.000Z',
      appVersion: '2.9.11',
      platform: 'darwin-arm64',
      summary: { passed: 0, failed: 1, skipped: 0, total: 1, durationMs: 23 },
      suites: [{
        name: 'Cloud', status: 'failed', durationMs: 23,
        tests: [{
          name: 'auth-token-valid', status: 'failed', durationMs: 23,
          error: 'Bearer private-secret /Users/person/private-book.epub',
          stack: 'https://service.test/?token=private-secret',
        }],
      }],
    };
    const exported = diagnosticsExport(report);
    expect(exported).toContain('auth-token-valid');
    expect(JSON.parse(exported).summary.failed).toBe(1);
    expect(exported).not.toContain('private-secret');
    expect(exported).not.toContain('private-book.epub');
    expect(exported).not.toContain('stack');
  });
});
