import { describe, it, expect } from 'vitest';
import {
  getJapanesePitchAccentInfo,
  buildJapanesePitchAccentHtml,
  getJapanesePitchAccentCategory,
  getJapanesePitchAccentCategoryForReading,
  getJapanesePitchAccentCategoryLabelForReading,
  getJapaneseMoraCount,
} from './japanesePitchAccent';

describe('getJapaneseMoraCount', () => {
  it('counts plain kana correctly', () => {
    expect(getJapaneseMoraCount('あめ')).toBe(2);
    expect(getJapaneseMoraCount('あたま')).toBe(3);
  });

  it('collapses small kana into preceding mora', () => {
    expect(getJapaneseMoraCount('ちゃ')).toBe(1);
    expect(getJapaneseMoraCount('きょう')).toBe(2);
    expect(getJapaneseMoraCount('ちゃん')).toBe(2);
  });

  it('counts long vowel and sokuon as separate morae', () => {
    expect(getJapaneseMoraCount('がっこう')).toBe(4);
    expect(getJapaneseMoraCount('たー')).toBe(2);
  });
});

describe('getJapanesePitchAccentInfo', () => {
  it('returns null for undefined accentType', () => {
    expect(getJapanesePitchAccentInfo(undefined, 'あめ')).toBeNull();
  });

  it('returns null for null accentType', () => {
    expect(getJapanesePitchAccentInfo(null, 'あめ')).toBeNull();
  });

  it('returns null for empty reading', () => {
    expect(getJapanesePitchAccentInfo(0, '')).toBeNull();
  });

  it('returns null when reading is not a string', () => {
    // @ts-expect-error intentional non-string input
    expect(getJapanesePitchAccentInfo(0, 123)).toBeNull();
  });

  it('returns null when reading is null', () => {
    // @ts-expect-error intentional non-string input
    expect(getJapanesePitchAccentInfo(0, null)).toBeNull();
  });

  it('returns null for invalid accent positions instead of rendering an impossible contour', () => {
    expect(getJapanesePitchAccentInfo(-1, 'あめ')).toBeNull();
    expect(getJapanesePitchAccentInfo(Number.NaN, 'あめ')).toBeNull();
    expect(getJapanesePitchAccentInfo(3, 'あめ')).toBeNull();
  });

  it('heiban (0): あめ → low-high, particleAccent true', () => {
    expect(getJapanesePitchAccentInfo(0, 'あめ')).toEqual({
      accentType: 0,
      pattern: [false, true],
      particleAccent: true,
      length: 2,
      moraCharCounts: [1, 1],
    });
  });

  it('heiban (0): three-mora reading → low-high-high', () => {
    expect(getJapanesePitchAccentInfo(0, 'あたま')).toEqual({
      accentType: 0,
      pattern: [false, true, true],
      particleAccent: true,
      length: 3,
      moraCharCounts: [1, 1, 1],
    });
  });

  it('atamadaka (1): あめ → high-low, particleAccent false', () => {
    expect(getJapanesePitchAccentInfo(1, 'あめ')).toEqual({
      accentType: 1,
      pattern: [true, false],
      particleAccent: false,
      length: 2,
      moraCharCounts: [1, 1],
    });
  });

  it('atamadaka (1): three-mora → high-low-low', () => {
    expect(getJapanesePitchAccentInfo(1, 'あたま')).toEqual({
      accentType: 1,
      pattern: [true, false, false],
      particleAccent: false,
      length: 3,
      moraCharCounts: [1, 1, 1],
    });
  });

  it('accentType 2: あたま → low-high-low', () => {
    expect(getJapanesePitchAccentInfo(2, 'あたま')).toEqual({
      accentType: 2,
      pattern: [false, true, false],
      particleAccent: false,
      length: 3,
      moraCharCounts: [1, 1, 1],
    });
  });

  it('accentType 2: four-mora reading → low-high-low-low', () => {
    expect(getJapanesePitchAccentInfo(2, 'あいうえ')).toEqual({
      accentType: 2,
      pattern: [false, true, false, false],
      particleAccent: false,
      length: 4,
      moraCharCounts: [1, 1, 1, 1],
    });
  });

  it('accentType 3: four-mora reading → low-high-high-low', () => {
    expect(getJapanesePitchAccentInfo(3, 'あいうえ')).toEqual({
      accentType: 3,
      pattern: [false, true, true, false],
      particleAccent: false,
      length: 4,
      moraCharCounts: [1, 1, 1, 1],
    });
  });

  it('accentType 3: five-mora reading → low-high-high-high-low', () => {
    expect(getJapanesePitchAccentInfo(3, 'あいうえお')).toEqual({
      accentType: 3,
      pattern: [false, true, true, true, false],
      particleAccent: false,
      length: 5,
      moraCharCounts: [1, 1, 1, 1, 1],
    });
  });

  it('accentType 4 (default): five-mora → low-high-high-high-low', () => {
    expect(getJapanesePitchAccentInfo(4, 'あいうえお')).toEqual({
      accentType: 4,
      pattern: [false, true, true, true, false],
      particleAccent: false,
      length: 5,
      moraCharCounts: [1, 1, 1, 1, 1],
    });
  });

  it('accentType 5 (default): six-mora → positions 1-4 high, others low', () => {
    expect(getJapanesePitchAccentInfo(5, 'あいうえおか')?.pattern).toEqual([false, true, true, true, true, false]);
  });

  it('single-mora heiban: ね → low, particleAccent true', () => {
    expect(getJapanesePitchAccentInfo(0, 'ね')?.pattern).toEqual([false]);
  });

  it('single-mora atamadaka: ね → high, particleAccent false', () => {
    expect(getJapanesePitchAccentInfo(1, 'ね')?.pattern).toEqual([true]);
  });

  it('small kana 1-mora heiban: ちゃ → low (1 mora, not 2 chars)', () => {
    expect(getJapanesePitchAccentInfo(0, 'ちゃ')?.pattern).toEqual([false]);
  });

  it('small kana 1-mora atamadaka: ちゃ → high (1 mora, not 2 chars)', () => {
    expect(getJapanesePitchAccentInfo(1, 'ちゃ')?.pattern).toEqual([true]);
  });

  it('small kana 2-mora heiban: ちゃん → low-high', () => {
    expect(getJapanesePitchAccentInfo(0, 'ちゃん')?.pattern).toEqual([false, true]);
  });

  it('small kana 2-mora atamadaka: きょう → high-low', () => {
    expect(getJapanesePitchAccentInfo(1, 'きょう')?.pattern).toEqual([true, false]);
  });

  it('preserves accentType in returned info', () => {
    expect(getJapanesePitchAccentInfo(2, 'あいう')?.accentType).toBe(2);
  });

  it('length equals number of morae', () => {
    expect(getJapanesePitchAccentInfo(0, 'あいうえお')?.length).toBe(5);
    expect(getJapanesePitchAccentInfo(0, 'ちゃ')?.length).toBe(1);
    expect(getJapanesePitchAccentInfo(0, 'きょう')?.length).toBe(2);
  });
});

describe('getJapanesePitchAccentCategoryLabelForReading', () => {
  const t = (key: string, params?: Record<string, string | number>) => {
    if (key === 'mlearn.JapanesePitchAccent.Heiban') return 'Heiban';
    if (key === 'mlearn.JapanesePitchAccent.Atamadaka') return 'Atamadaka';
    if (key === 'mlearn.JapanesePitchAccent.Odaka') return 'Odaka';
    if (key === 'mlearn.JapanesePitchAccent.DropAfterMora') return `Drop after mora ${params?.mora}`;
    return key;
  };

  it('labels odaka from the reading mora count instead of the raw position alone', () => {
    expect(getJapanesePitchAccentCategoryLabelForReading(2, 'あめ', t)).toBe('Odaka');
    expect(getJapanesePitchAccentCategoryLabelForReading(2, 'あたま', t)).toBe('Drop after mora 2');
  });
});

describe('buildJapanesePitchAccentHtml', () => {
  it('returns empty string for null info', () => {
    expect(buildJapanesePitchAccentHtml(null)).toBe('');
  });

  it('2-mora heiban: generates correct box divs without particle', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html).toBe('<div class="box bottom"></div><div class="box top left"></div>');
  });

  it('first mora has no left class', () => {
    const info = getJapanesePitchAccentInfo(1, 'あめ')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html).toContain('<div class="box top"></div>');
    expect(html).toContain('<div class="box bottom left"></div>');
  });

  it('left class added only at transition points', () => {
    const info = getJapanesePitchAccentInfo(0, 'あいうえ')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html.match(/left/g)?.length).toBe(1);
  });

  it('no left class on consecutive same-value moras', () => {
    const info = getJapanesePitchAccentInfo(0, 'あいう')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html.match(/left/g)?.length).toBe(1);
  });

  it('includeParticleBox true (default) adds particle div', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    expect(buildJapanesePitchAccentHtml(info)).toContain('particle-box');
  });

  it('includeParticleBox false omits particle div and style', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html).not.toContain('particle-box');
    expect(html).not.toContain('style=');
  });

  it('homogenous: true — particle box omits particle-box class', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { homogenous: true });
    expect(html).not.toContain('particle-box');
    expect(html).toContain('style=');
  });

  it('particle box gets top class for heiban (particleAccent true)', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    const particlePart = buildJapanesePitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).toContain('top');
    expect(particlePart).not.toContain('bottom');
  });

  it('particle box gets bottom class for atamadaka (particleAccent false)', () => {
    const info = getJapanesePitchAccentInfo(1, 'あめ')!;
    const particlePart = buildJapanesePitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).toContain('bottom');
  });

  it('particle box has no left class when last mora matches particleAccent (heiban)', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    const particlePart = buildJapanesePitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).not.toContain('left');
  });

  it('particle box has no left class when last mora matches particleAccent (atamadaka)', () => {
    const info = getJapanesePitchAccentInfo(1, 'あめ')!;
    const particlePart = buildJapanesePitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).not.toContain('left');
  });

  it('particle box has left class when last mora differs from particleAccent', () => {
    const info = getJapanesePitchAccentInfo(2, 'あい')!;
    const particlePart = buildJapanesePitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).toContain('left');
  });

  it('margin-right on particle box defaults to -100 / unitCount', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    expect(buildJapanesePitchAccentHtml(info)).toContain('margin-right:-50%');
  });

  it('margin-right uses provided particleMarginPercent', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    expect(buildJapanesePitchAccentHtml(info, undefined, { particleMarginPercent: -25 })).toContain('margin-right:-25%');
  });

  it('margin-right for 4-mora: -100 / 4 = -25', () => {
    const info = getJapanesePitchAccentInfo(0, 'あいうえ')!;
    expect(buildJapanesePitchAccentHtml(info)).toContain('margin-right:-25%');
  });

  it('padTo adds extra empty box divs', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { includeParticleBox: false, padTo: 4 });
    expect(html.match(/<div class="box"><\/div>/g)?.length).toBe(2);
  });

  it('padTo does nothing when padTo <= unitCount', () => {
    const info = getJapanesePitchAccentInfo(0, 'あいうえ')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { includeParticleBox: false, padTo: 2 });
    expect(html.match(/<div class="box/g)?.length).toBe(4);
  });

  it('realWordLength used as padTo when padTo option not provided', () => {
    const info = getJapanesePitchAccentInfo(0, 'あめ')!;
    const html = buildJapanesePitchAccentHtml(info, 5, { includeParticleBox: false });
    expect(html.match(/<div class="box"><\/div>/g)?.length).toBe(3);
  });

  it('generates correct number of mora boxes', () => {
    const info = getJapanesePitchAccentInfo(0, 'あいうえお')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html.match(/<div class="box/g)?.length).toBe(5);
  });

  it('applies proportional flex-grow for multi-char morae', () => {
    const info = getJapanesePitchAccentInfo(0, 'ちゃん')!;
    const html = buildJapanesePitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html).toContain('flex-grow:2');
  });
});

describe('getJapanesePitchAccentCategory', () => {
  it('returns null for undefined', () => {
    expect(getJapanesePitchAccentCategory(undefined, 3)).toBeNull();
  });

  it('returns null for null', () => {
    expect(getJapanesePitchAccentCategory(null, 3)).toBeNull();
  });

  it('returns null when moraCount is 0', () => {
    expect(getJapanesePitchAccentCategory(0, 0)).toBeNull();
  });

  it('returns null when moraCount is negative', () => {
    expect(getJapanesePitchAccentCategory(0, -1)).toBeNull();
  });

  it('returns null for invalid accent positions', () => {
    expect(getJapanesePitchAccentCategory(-1, 3)).toBeNull();
    expect(getJapanesePitchAccentCategory(Number.NaN, 3)).toBeNull();
    expect(getJapanesePitchAccentCategory(4, 3)).toBeNull();
  });

  it('accentType 0 → heiban', () => {
    expect(getJapanesePitchAccentCategory(0, 3)).toEqual({ type: 'heiban' });
  });

  it('accentType 1 → atamadaka', () => {
    expect(getJapanesePitchAccentCategory(1, 3)).toEqual({ type: 'atamadaka' });
  });

  it('accentType equals moraCount → odaka', () => {
    expect(getJapanesePitchAccentCategory(3, 3)).toEqual({ type: 'odaka' });
  });

  it('accentType 1 with moraCount 1 → atamadaka (case 1 runs before default check)', () => {
    expect(getJapanesePitchAccentCategory(1, 1)).toEqual({ type: 'atamadaka' });
  });

  it('accentType 2, moraCount 3 → nakadaka 2', () => {
    expect(getJapanesePitchAccentCategory(2, 3)).toEqual({ type: 'nakadaka', dropAfterMora: 2 });
  });

  it('accentType 3, moraCount 5 → nakadaka 3', () => {
    expect(getJapanesePitchAccentCategory(3, 5)).toEqual({ type: 'nakadaka', dropAfterMora: 3 });
  });

  it('accentType 4, moraCount 6 → nakadaka 4', () => {
    expect(getJapanesePitchAccentCategory(4, 6)).toEqual({ type: 'nakadaka', dropAfterMora: 4 });
  });

  it('moraCount 1, accentType 0 → heiban', () => {
    expect(getJapanesePitchAccentCategory(0, 1)).toEqual({ type: 'heiban' });
  });
});

describe('getJapanesePitchAccentCategoryForReading', () => {
  it('uses Japanese mora count rather than raw string length', () => {
    expect(getJapanesePitchAccentCategoryForReading(2, 'きょう')).toEqual({ type: 'odaka' });
  });
});
