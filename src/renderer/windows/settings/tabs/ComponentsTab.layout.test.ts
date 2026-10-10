import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/windows/settings/tabs/ComponentsTab.css', 'utf8');

describe('ComponentsTab active install layout', () => {
  it('pins active progress to the settings scroll viewport', () => {
    const rule = css.match(/\.components-tab__active-jobs\s*\{([^}]*)\}/)?.[1];

    expect(rule ?? '').toMatch(/position:\s*sticky/);
    expect(rule ?? '').toMatch(/top:\s*0/);
    expect(rule ?? '').toMatch(/background:/);
  });
});
