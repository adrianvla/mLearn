import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { render } from 'solid-js/web';
import { PillLabel } from './Label';

describe('PillLabel', () => {
  it('uses visualLevel for styling while preserving the raw language level', () => {
    const container = document.createElement('div');
    const dispose = render(() => (
      <PillLabel level={1} visualLevel={7}>A1</PillLabel>
    ), container);

    const label = container.querySelector('.label-pill');
    expect(label?.getAttribute('data-level')).toBe('7');
    expect(label?.getAttribute('data-raw-level')).toBe('1');
    expect(label?.textContent).toContain('A1');

    dispose();
  });

  it('keeps the five-step JLPT-style palette in the original N5-to-N1 order', () => {
    const themeCss = readFileSync(path.join(process.cwd(), 'src/renderer/styles/index.css'), 'utf-8');

    // JLPT N1
    expect(themeCss).toContain('--pill-level-1-text: rgb(255, 60, 89);');
    // JLPT N2
    expect(themeCss).toContain('--pill-level-2-text: rgb(60, 145, 255);');
    // JLPT N3
    expect(themeCss).toContain('--pill-level-3-text: rgb(66, 214, 49);');
    // JLPT N4
    expect(themeCss).toContain('--pill-level-4-text: rgb(255, 141, 60);');
    // JLPT N5
    expect(themeCss).toContain('--pill-level-5-text: rgb(255, 60, 170);');
    expect(themeCss).toContain('--pill-level-5-bg: rgb(255, 223, 239);');
  });

  it('applies pill palette filters only in dark themes', () => {
    const themeDir = path.join(process.cwd(), 'src/renderer/styles/themes');
    const labelCss = readFileSync(path.join(process.cwd(), 'src/renderer/components/common/Label/Label.css'), 'utf-8');
    const baseThemeCss = readFileSync(path.join(process.cwd(), 'src/renderer/styles/index.css'), 'utf-8');
    const defaultCustomThemeCss = readFileSync(path.join(process.cwd(), 'src/shared/defaultCustomThemeCss.ts'), 'utf-8');
    const darkThemeFiles = [
      { file: 'dark.css', themeClass: 'theme-dark' },
      { file: 'darker.css', themeClass: 'theme-darker' },
      { file: 'dark-high-contrast.css', themeClass: 'theme-dark-high-contrast' },
      { file: 'glass-dark.css', themeClass: 'theme-glass-dark' },
    ];
    const lightThemeFiles = [
      'glass-light.css',
      'light-high-contrast.css',
    ];

    expect(baseThemeCss).toContain('--pill-default-filter: none;');
    expect(labelCss).toContain('filter: var(--pill-default-filter);');
    for (const level of [1, 2, 3, 4, 5, 6, 7]) {
      expect(baseThemeCss).toContain(`--pill-level-${level}-filter: none;`);
      expect(labelCss).toMatch(new RegExp(`\\.label-pill\\[data-level="${level}"\\] \\{[\\s\\S]*?filter: var\\(--pill-level-${level}-filter\\);`));
    }
    const variantLevels = {
      red: 1,
      blue: 2,
      green: 3,
      orange: 4,
      purple: 5,
      yellow: 6,
      gray: 7,
    } as const;
    for (const [variant, level] of Object.entries(variantLevels)) {
      expect(labelCss).toMatch(new RegExp(`\\.label-pill\\.label-${variant},\\s*\\.label-status\\.label-${variant}\\s*\\{[\\s\\S]*?filter: var\\(--pill-level-${level}-filter\\);`));
    }

    for (const { file, themeClass } of darkThemeFiles) {
      const themeCss = readFileSync(path.join(themeDir, file), 'utf-8');
      expect(themeCss).toMatch(new RegExp(`body\\.${themeClass},\\s*\\.${themeClass}\\s*\\{`));
      expect(themeCss).toContain('--pill-default-filter: invert(1) hue-rotate(180deg) saturate(200%);');
      expect(themeCss).toMatch(
        new RegExp(`body\\.${themeClass} \\.label-pill,\\s*\\.${themeClass} \\.label-pill\\s*\\{[\\s\\S]*?filter: var\\(--pill-default-filter\\);`),
      );
      expect(themeCss).not.toMatch(/\.label-pill[^{}]*,[^{]*\{[^}]*filter:\s*invert\(1\)\s*hue-rotate\(180deg\)\s*saturate\(200%\)/);
      expect(themeCss).not.toMatch(/\.label-pill(?:\[data-level="[1-7]"\])?\s*\{[^}]*filter:\s*invert\(1\)\s*hue-rotate\(180deg\)\s*saturate\(200%\)/);
      for (const level of [1, 2, 3, 4, 5, 6, 7]) {
        expect(themeCss).toContain(`--pill-level-${level}-filter: invert(1) hue-rotate(180deg) saturate(200%);`);
        expect(themeCss).toMatch(
          new RegExp(`body\\.${themeClass} \\.label-pill\\[data-level="${level}"\\],\\s*\\.${themeClass} \\.label-pill\\[data-level="${level}"\\]\\s*\\{[\\s\\S]*?filter: var\\(--pill-level-${level}-filter\\);`),
        );
        expect(themeCss).not.toMatch(new RegExp(`\\.label-pill\\[data-level="${level}"\\]\\s*\\{[^}]*filter:\\s*invert\\(1\\)\\s*hue-rotate\\(180deg\\)\\s*saturate\\(200%\\)`));
      }
      expect(themeCss).toMatch(/\.btn-pill,[\s\S]*?\.label-status\s*\{[\s\S]*?filter:\s*invert\(1\)\s*hue-rotate\(180deg\)\s*saturate\(200%\)/);
      expect(themeCss).toMatch(/\.label-status \.label-svg-icon \{[\s\S]*?filter:\s*invert\(1\)\s*hue-rotate\(180deg\)/);
    }

    for (const file of lightThemeFiles) {
      const themeCss = readFileSync(path.join(themeDir, file), 'utf-8');
      expect(themeCss).not.toMatch(/\.label-pill,[\s\S]*?filter:\s*invert\(1\)\s*hue-rotate\(180deg\)/);
    }
    const customPillBlock = defaultCustomThemeCss.match(
      /body\.theme-custom \.label-pill,[\s\S]*?body\.theme-custom \.label-status \{([\s\S]*?)\}/,
    )?.[1] ?? '';
    expect(customPillBlock).not.toContain('filter:');
  });
});
