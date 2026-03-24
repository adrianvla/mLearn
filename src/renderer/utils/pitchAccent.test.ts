import { describe, it, expect } from 'vitest';
import {
  getPitchAccentInfo,
  buildPitchAccentHtml,
  getPitchAccentName,
  SMALL_KANA_CHARS,
} from './pitchAccent';
import { SMALL_KANA } from '../../shared/utils/textUtils';

describe('SMALL_KANA_CHARS', () => {
  it('exists and equals SMALL_KANA from textUtils', () => {
    expect(SMALL_KANA_CHARS).toBe(SMALL_KANA);
  });
});

describe('getPitchAccentInfo', () => {
  it('returns null for undefined accentType', () => {
    expect(getPitchAccentInfo(undefined, 'あめ')).toBeNull();
  });

  it('returns null for null accentType', () => {
    expect(getPitchAccentInfo(null, 'あめ')).toBeNull();
  });

  it('returns null for empty reading', () => {
    expect(getPitchAccentInfo(0, '')).toBeNull();
  });

  it('returns null when reading is not a string', () => {
    // @ts-expect-error intentional non-string input
    expect(getPitchAccentInfo(0, 123)).toBeNull();
  });

  it('returns null when reading is null', () => {
    // @ts-expect-error intentional non-string input
    expect(getPitchAccentInfo(0, null)).toBeNull();
  });

  it('heiban (0): あめ → low-high, particleAccent true', () => {
    expect(getPitchAccentInfo(0, 'あめ')).toEqual({
      accentType: 0,
      pattern: [false, true],
      particleAccent: true,
      length: 2,
    });
  });

  it('heiban (0): three-mora reading → low-high-high', () => {
    expect(getPitchAccentInfo(0, 'あたま')).toEqual({
      accentType: 0,
      pattern: [false, true, true],
      particleAccent: true,
      length: 3,
    });
  });

  it('atamadaka (1): あめ → high-low, particleAccent false', () => {
    expect(getPitchAccentInfo(1, 'あめ')).toEqual({
      accentType: 1,
      pattern: [true, false],
      particleAccent: false,
      length: 2,
    });
  });

  it('atamadaka (1): three-mora → high-low-low', () => {
    expect(getPitchAccentInfo(1, 'あたま')).toEqual({
      accentType: 1,
      pattern: [true, false, false],
      particleAccent: false,
      length: 3,
    });
  });

  it('accentType 2: あたま → low-high-low', () => {
    expect(getPitchAccentInfo(2, 'あたま')).toEqual({
      accentType: 2,
      pattern: [false, true, false],
      particleAccent: false,
      length: 3,
    });
  });

  it('accentType 2: four-mora reading → low-high-low-low', () => {
    expect(getPitchAccentInfo(2, 'あいうえ')).toEqual({
      accentType: 2,
      pattern: [false, true, false, false],
      particleAccent: false,
      length: 4,
    });
  });

  it('accentType 3: four-mora reading → low-high-high-low', () => {
    expect(getPitchAccentInfo(3, 'あいうえ')).toEqual({
      accentType: 3,
      pattern: [false, true, true, false],
      particleAccent: false,
      length: 4,
    });
  });

  it('accentType 3: five-mora reading → low-high-high-high-low', () => {
    expect(getPitchAccentInfo(3, 'あいうえお')).toEqual({
      accentType: 3,
      pattern: [false, true, true, true, false],
      particleAccent: false,
      length: 5,
    });
  });

  it('accentType 4 (default): five-mora → low-high-high-high-low', () => {
    expect(getPitchAccentInfo(4, 'あいうえお')).toEqual({
      accentType: 4,
      pattern: [false, true, true, true, false],
      particleAccent: false,
      length: 5,
    });
  });

  it('accentType 5 (default): six-mora → positions 1-4 high, others low', () => {
    expect(getPitchAccentInfo(5, 'あいうえおか')?.pattern).toEqual([false, true, true, true, true, false]);
  });

  it('small kana: きょ with accent 1 — boundary absorbed when no char follows ょ', () => {
    // ょ is small kana at index 1; the high→low boundary shifts past ょ but there is no
    // following char to receive the low value, so ょ keeps pattern[0]=true
    expect(getPitchAccentInfo(1, 'きょ')?.pattern).toEqual([true, true]);
  });

  it('small kana: きょう with accent 1 — boundary shifted past ょ onto う', () => {
    // ょ at index 1 is small kana; shift assigns pattern[1]=pattern[0]=true, pattern[2]=false
    expect(getPitchAccentInfo(1, 'きょう')?.pattern).toEqual([true, true, false]);
  });

  it('small kana: ちゃ with accent 0 — low→high boundary absorbed by ゃ', () => {
    // ゃ at index 1 is small kana; shift assigns pattern[1]=pattern[0]=false, no char follows
    expect(getPitchAccentInfo(0, 'ちゃ')?.pattern).toEqual([false, false]);
  });

  it('small kana: ちゃん with accent 0 — boundary shifted past ゃ onto ん', () => {
    // ゃ at index 1; shift assigns pattern[1]=false (same as pattern[0]), pattern[2]=true
    expect(getPitchAccentInfo(0, 'ちゃん')?.pattern).toEqual([false, false, true]);
  });

  it('preserves accentType in returned info', () => {
    expect(getPitchAccentInfo(2, 'あいう')?.accentType).toBe(2);
  });

  it('length equals number of chars in reading', () => {
    expect(getPitchAccentInfo(0, 'あいうえお')?.length).toBe(5);
  });
});

describe('buildPitchAccentHtml', () => {
  it('returns empty string for null info', () => {
    expect(buildPitchAccentHtml(null)).toBe('');
  });

  it('2-mora heiban: generates correct box divs without particle', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    const html = buildPitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html).toBe('<div class="box bottom"></div><div class="box top left"></div>');
  });

  it('first mora has no left class', () => {
    const info = getPitchAccentInfo(1, 'あめ')!;
    const html = buildPitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html).toContain('<div class="box top"></div>');
    expect(html).toContain('<div class="box bottom left"></div>');
  });

  it('left class added only at transition points', () => {
    const info = getPitchAccentInfo(0, 'あいうえ')!;
    const html = buildPitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html.match(/left/g)?.length).toBe(1);
  });

  it('no left class on consecutive same-value moras', () => {
    const info = getPitchAccentInfo(0, 'あいう')!;
    const html = buildPitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html.match(/left/g)?.length).toBe(1);
  });

  it('includeParticleBox true (default) adds particle div', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    expect(buildPitchAccentHtml(info)).toContain('particle-box');
  });

  it('includeParticleBox false omits particle div and style', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    const html = buildPitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html).not.toContain('particle-box');
    expect(html).not.toContain('style=');
  });

  it('homogenous: true — particle box omits particle-box class', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    const html = buildPitchAccentHtml(info, undefined, { homogenous: true });
    expect(html).not.toContain('particle-box');
    expect(html).toContain('style=');
  });

  it('particle box gets top class for heiban (particleAccent true)', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    const particlePart = buildPitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).toContain('top');
    expect(particlePart).not.toContain('bottom');
  });

  it('particle box gets bottom class for atamadaka (particleAccent false)', () => {
    const info = getPitchAccentInfo(1, 'あめ')!;
    const particlePart = buildPitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).toContain('bottom');
  });

  it('particle box has no left class when last mora matches particleAccent (heiban)', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    const particlePart = buildPitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).not.toContain('left');
  });

  it('particle box has no left class when last mora matches particleAccent (atamadaka)', () => {
    const info = getPitchAccentInfo(1, 'あめ')!;
    const particlePart = buildPitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).not.toContain('left');
  });

  it('particle box has left class when last mora differs from particleAccent', () => {
    const info = getPitchAccentInfo(2, 'あい')!;
    const particlePart = buildPitchAccentHtml(info).split('<div').at(-1)!;
    expect(particlePart).toContain('left');
  });

  it('margin-right on particle box defaults to -100 / unitCount', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    expect(buildPitchAccentHtml(info)).toContain('margin-right:-50%');
  });

  it('margin-right uses provided particleMarginPercent', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    expect(buildPitchAccentHtml(info, undefined, { particleMarginPercent: -25 })).toContain('margin-right:-25%');
  });

  it('margin-right for 4-mora: -100 / 4 = -25', () => {
    const info = getPitchAccentInfo(0, 'あいうえ')!;
    expect(buildPitchAccentHtml(info)).toContain('margin-right:-25%');
  });

  it('padTo adds extra empty box divs', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    const html = buildPitchAccentHtml(info, undefined, { includeParticleBox: false, padTo: 4 });
    expect(html.match(/<div class="box"><\/div>/g)?.length).toBe(2);
  });

  it('padTo does nothing when padTo <= unitCount', () => {
    const info = getPitchAccentInfo(0, 'あいうえ')!;
    const html = buildPitchAccentHtml(info, undefined, { includeParticleBox: false, padTo: 2 });
    expect(html.match(/<div class="box/g)?.length).toBe(4);
  });

  it('realWordLength used as padTo when padTo option not provided', () => {
    const info = getPitchAccentInfo(0, 'あめ')!;
    const html = buildPitchAccentHtml(info, 5, { includeParticleBox: false });
    expect(html.match(/<div class="box"><\/div>/g)?.length).toBe(3);
  });

  it('generates correct number of mora boxes', () => {
    const info = getPitchAccentInfo(0, 'あいうえお')!;
    const html = buildPitchAccentHtml(info, undefined, { includeParticleBox: false });
    expect(html.match(/<div class="box/g)?.length).toBe(5);
  });
});

describe('getPitchAccentName', () => {
  it('returns empty string for undefined', () => {
    expect(getPitchAccentName(undefined, 3)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(getPitchAccentName(null, 3)).toBe('');
  });

  it('returns empty string when moraCount is 0', () => {
    expect(getPitchAccentName(0, 0)).toBe('');
  });

  it('returns empty string when moraCount is negative', () => {
    expect(getPitchAccentName(0, -1)).toBe('');
  });

  it('accentType 0 → heiban', () => {
    expect(getPitchAccentName(0, 3)).toBe('平板 (Heiban)');
  });

  it('accentType 1 → atamadaka', () => {
    expect(getPitchAccentName(1, 3)).toBe('頭高 (Atamadaka)');
  });

  it('accentType equals moraCount → odaka', () => {
    expect(getPitchAccentName(3, 3)).toBe('尾高 (Odaka)');
  });

  it('accentType 1 with moraCount 1 → atamadaka (case 1 runs before default check)', () => {
    expect(getPitchAccentName(1, 1)).toBe('頭高 (Atamadaka)');
  });

  it('accentType 2, moraCount 3 → nakadaka 2', () => {
    expect(getPitchAccentName(2, 3)).toBe('中高 (Nakadaka 2)');
  });

  it('accentType 3, moraCount 5 → nakadaka 3', () => {
    expect(getPitchAccentName(3, 5)).toBe('中高 (Nakadaka 3)');
  });

  it('accentType 4, moraCount 6 → nakadaka 4', () => {
    expect(getPitchAccentName(4, 6)).toBe('中高 (Nakadaka 4)');
  });

  it('moraCount 1, accentType 0 → heiban', () => {
    expect(getPitchAccentName(0, 1)).toBe('平板 (Heiban)');
  });
});
