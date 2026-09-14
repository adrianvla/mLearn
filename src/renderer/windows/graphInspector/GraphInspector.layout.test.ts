import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/windows/graphInspector/GraphInspector.css', 'utf8');

describe('standalone graph inspector layout', () => {
  it('bounds the entry root and gives the content its own vertical scroller', () => {
    const rootRule = css.match(/#root\s*\{([^}]*)\}/)?.[1];
    const inspectorRule = css.match(/\.graph-inspector\s*\{([^}]*)\}/)?.[1];

    expect(rootRule).toMatch(/height:\s*100%/);
    expect(inspectorRule).toMatch(/height:\s*100%/);
    expect(inspectorRule).toMatch(/overflow-y:\s*auto/);
    expect(inspectorRule).toMatch(/overflow-x:\s*hidden/);
  });
});
