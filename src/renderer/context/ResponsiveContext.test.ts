import { describe, it, expect } from 'vitest';
import { BREAKPOINTS } from './ResponsiveContext';
import type { Breakpoint } from './ResponsiveContext';

function resolveBreakpoint(width: number): Breakpoint {
  if (width <= BREAKPOINTS.sm) return 'xs';
  if (width <= BREAKPOINTS.md) return 'sm';
  if (width <= BREAKPOINTS.lg) return 'md';
  if (width <= BREAKPOINTS.xl) return 'lg';
  return 'xl';
}

describe('BREAKPOINTS', () => {
  it('sm is 480', () => expect(BREAKPOINTS.sm).toBe(480));
  it('md is 768', () => expect(BREAKPOINTS.md).toBe(768));
  it('lg is 1024', () => expect(BREAKPOINTS.lg).toBe(1024));
  it('xl is 1280', () => expect(BREAKPOINTS.xl).toBe(1280));
});

describe('resolveBreakpoint', () => {
  it('returns xs for width well below sm threshold', () => {
    expect(resolveBreakpoint(320)).toBe('xs');
  });

  it('returns xs at exactly the sm boundary (480)', () => {
    expect(resolveBreakpoint(480)).toBe('xs');
  });

  it('returns sm just above the sm boundary (481)', () => {
    expect(resolveBreakpoint(481)).toBe('sm');
  });

  it('returns sm at exactly the md boundary (768)', () => {
    expect(resolveBreakpoint(768)).toBe('sm');
  });

  it('returns md just above the md boundary (769)', () => {
    expect(resolveBreakpoint(769)).toBe('md');
  });

  it('returns md at exactly the lg boundary (1024)', () => {
    expect(resolveBreakpoint(1024)).toBe('md');
  });

  it('returns lg just above the lg boundary (1025)', () => {
    expect(resolveBreakpoint(1025)).toBe('lg');
  });

  it('returns lg at exactly the xl boundary (1280)', () => {
    expect(resolveBreakpoint(1280)).toBe('lg');
  });

  it('returns xl just above the xl boundary (1281)', () => {
    expect(resolveBreakpoint(1281)).toBe('xl');
  });

  it('returns xl for very wide viewports', () => {
    expect(resolveBreakpoint(2560)).toBe('xl');
  });

  it('returns xs for width 0', () => {
    expect(resolveBreakpoint(0)).toBe('xs');
  });
});
