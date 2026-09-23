import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { LOGO_COMPRESSED, LOGO_SIZE } from '../src/splash/logo-data.js';
import { LOGO_SVG } from '../src/splash/logo-svg.js';

const paths = (source: string) => [...source.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(match => match[1]);

function half(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >> 10) & 31;
  const fraction = value & 1023;
  return exponent === 0 ? sign * fraction * 2 ** -24
    : exponent === 31 ? NaN : sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

describe('splash logo geometry', () => {
  it('uses the exact app logo paths in the fallback and baked atlas source', () => {
    const canonical = readFileSync('src/renderer/components/common/Icons/raw/MLearnLogo.tsx', 'utf8');
    const svg = readFileSync('src/splash/logo.svg', 'utf8');
    const html = readFileSync('src/html/splash.html', 'utf8');
    expect(svg).toContain('viewBox="735 788 385 222"');
    expect(paths(canonical)).toHaveLength(2);
    expect(paths(svg)).toEqual(paths(canonical));
    expect(paths(LOGO_SVG)).toEqual(paths(canonical));
    expect(paths(html)).toEqual(paths(canonical));
  });

  it('ships a finite signed-distance atlas with the expected letter counters', () => {
    const bytes = inflateSync(Buffer.from(LOGO_COMPRESSED, 'base64'));
    expect(bytes.length).toBe(LOGO_SIZE[0] * LOGO_SIZE[1] * 2);
    for (let index = 0; index < bytes.length; index += 2) {
      expect(Number.isFinite(half(bytes.readUInt16LE(index)))).toBe(true);
    }
    const sample = (x: number, y: number) => {
      const u = Math.max(0, Math.min(511, Math.floor((x - 721) / 416 * 512)));
      const v = Math.max(0, Math.min(319, Math.floor((y - 768) / 260 * 320)));
      return half(bytes.readUInt16LE((v * 512 + u) * 2));
    };
    expect(sample(763, 930)).toBeLessThan(0);
    expect(sample(807, 950)).toBeGreaterThan(0);
    expect(sample(891, 954)).toBeGreaterThan(0);
    expect(sample(1007, 850)).toBeLessThan(0);
    expect(sample(1050, 986)).toBeLessThan(0);
  });
});
