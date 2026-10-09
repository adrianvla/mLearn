import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/windows/graphInspector/GraphInspector.css', 'utf8');

describe('standalone graph inspector layout', () => {
  it('bounds the canvas host and gives expanded details their own vertical scroller', () => {
    const rootRule = css.match(/#root\s*\{([^}]*)\}/)?.[1];
    const inspectorRule = css.match(/\.graph-inspector\s*\{([^}]*)\}/)?.[1];

    expect(rootRule).toMatch(/height:\s*100%/);
    expect(inspectorRule).toMatch(/height:\s*100%/);
    expect(inspectorRule).toMatch(/overflow:\s*hidden/);
    expect(inspectorRule).toMatch(/display:\s*flex/);
    const detailsRule = css.match(/\.graph-inspector__details-panel\s*\{([^}]*)\}/)?.[1];
    expect(detailsRule).toMatch(/overflow-y:\s*auto/);
    expect(detailsRule).toMatch(/max-height:\s*35%/);
  });
});
