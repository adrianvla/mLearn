import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/components/common/GraphNeighborhoodViz/GraphNeighborhoodViz.css', 'utf8');

describe('GraphNeighborhoodViz detail layout', () => {
  it('keeps long localized actions within the detail rail', () => {
    const rule = css.match(/\.graph-viz__detail \.btn\s*\{([^}]*)\}/)?.[1];

    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
