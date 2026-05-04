/**
 * Central registry for diagnostic test suites.
 * Main process registers suites here; renderer requests them via IPC.
 */

import type { DiagnosticTestSuite } from './types';

const suites: DiagnosticTestSuite[] = [];

export function registerDiagnosticSuite(suite: DiagnosticTestSuite): void {
  const existingIndex = suites.findIndex(s => s.name === suite.name);
  if (existingIndex !== -1) {
    suites[existingIndex] = suite;
  } else {
    suites.push(suite);
  }
}

export function getDiagnosticSuites(): DiagnosticTestSuite[] {
  return [...suites];
}

export function clearDiagnosticSuites(): void {
  suites.length = 0;
}
