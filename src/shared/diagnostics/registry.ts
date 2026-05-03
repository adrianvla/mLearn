/**
 * Central registry for diagnostic test suites.
 * Main process registers suites here; renderer requests them via IPC.
 */

import type { DiagnosticTestSuite } from './types';

const suites: DiagnosticTestSuite[] = [];

export function registerDiagnosticSuite(suite: DiagnosticTestSuite): void {
  suites.push(suite);
}

export function getDiagnosticSuites(): DiagnosticTestSuite[] {
  return [...suites];
}

export function clearDiagnosticSuites(): void {
  suites.length = 0;
}
