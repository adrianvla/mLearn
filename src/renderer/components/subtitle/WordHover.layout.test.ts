import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/components/subtitle/WordHover.css', 'utf8');

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match![1];
}

describe('WordHover compact action-strip layout', () => {
  it('keeps the footer pills on one larger, naturally sized row', () => {
    const panelRule = ruleFor('.subtitle_hover');
    const pillsRule = ruleFor('.subtitle_hover .pills');
    const pillSizingRule = css.match(/\.subtitle_hover \.pills \.label-pill,\s*\.subtitle_hover \.pills \.btn-pill\s*\{([^}]*)\}/)?.[1];

    expect(panelRule).toMatch(/width:\s*fit-content/);
    expect(panelRule).toMatch(/max-width:\s*calc\(100vw - var\(--spacing-4\)\)/);
    expect(pillsRule).toMatch(/flex-wrap:\s*nowrap/);
    expect(pillsRule).toMatch(/width:\s*max-content/);
    expect(pillSizingRule).toMatch(/font-size:\s*0\.8em/);
    expect(pillSizingRule).toMatch(/padding:\s*5px 10px/);
    expect(pillSizingRule).toMatch(/height:\s*var\(--size-md\)/);
    expect(pillSizingRule).toMatch(/min-height:\s*var\(--size-md\)/);
  });

  it('keeps narrow or localized action strips inside the viewport without wrapping', () => {
    const footerRule = ruleFor('.subtitle_hover .footer');

    expect(footerRule).toMatch(/max-width:\s*100%/);
    expect(footerRule).toMatch(/overflow-x:\s*auto/);
  });
});
