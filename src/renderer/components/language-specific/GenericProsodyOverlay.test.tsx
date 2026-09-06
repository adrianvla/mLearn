import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { LanguageData } from '../../../shared/types';

// E2 synthetic fixture: a THIRD-PARTY prosody model with deliberately
// non-Japanese structure. It must render through the generic declarative
// path — no language branch, no modification of the Japanese adapter.

const syntheticPackage: LanguageData = {
  name: 'Synthetic tone-length',
  prosody: {
    type: 'x-synthetic::tone-length',
    positionLabel: 'Tone unit',
    overlay: { unit: 'character', mark: 'overline' },
  },
  settings: { fixed: {} },
};

const graphemePackage: LanguageData = {
  name: 'Synthetic grapheme',
  prosody: {
    type: 'x-synthetic::diplith',
    overlay: { unit: 'grapheme', mark: 'underline' },
  },
  settings: { fixed: {} },
};

describe('generic declarative prosody overlay (E2 synthetic fixture)', () => {
  it('renders units through the generic path for a novel package type', async () => {
    const { ProsodyOverlay } = await import('./ProsodyOverlay');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => (
      <ProsodyOverlay
        word="katana"
        reading="katana"
        prosodyType="x-synthetic::tone-length"
        prosodyPosition={2}
        languageData={syntheticPackage}
        mode="overlay"
      />
    ), container);

    const units = container.querySelectorAll('.generic-prosody-unit');
    expect(units).toHaveLength(6);
    // 1-based position: the second unit carries the overline mark.
    expect(units[1]?.classList.contains('generic-prosody-mark--overline')).toBe(true);
    expect(units[0]?.classList.contains('generic-prosody-mark--overline')).toBe(false);
    // No Japanese machinery leaked into the generic path.
    expect(container.querySelector('.pitch-accent')).toBeNull();
    expect(container.querySelector('.generic-prosody-mark--underline')).toBeNull();
    dispose();
    container.remove();
  });

  it('segments by grapheme clusters when the package declares them', async () => {
    const { ProsodyOverlay } = await import('./ProsodyOverlay');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => (
      <ProsodyOverlay
        word="égal"
        reading={'e\u0301gal'}
        prosodyType="x-synthetic::diplith"
        prosodyPosition={1}
        languageData={graphemePackage}
        mode="overlay"
      />
    ), container);

    // e + combining acute = ONE grapheme unit.
    expect(container.querySelectorAll('.generic-prosody-unit')).toHaveLength(4);
    expect(container.querySelector('.generic-prosody-unit')?.classList.contains('generic-prosody-mark--underline')).toBe(true);
    dispose();
    container.remove();
  });

  it('resolves the declarative adapter from package metadata, not registration', async () => {
    const { getProsodyOverlayRenderer, canRenderStoredProsodyWithoutMetadata } = await import('../../utils/prosodyPresentation');
    expect(getProsodyOverlayRenderer(syntheticPackage)).toBe('generic-declarative');
    expect(getProsodyOverlayRenderer(graphemePackage, 'x-synthetic::diplith')).toBe('generic-declarative');
    // A novel type WITHOUT a declarative overlay still renders nothing — absence of capability is valid.
    const barePackage: LanguageData = { name: 'Bare', prosody: { type: 'x-other::model' } };
    expect(getProsodyOverlayRenderer(barePackage)).toBeNull();
    expect(canRenderStoredProsodyWithoutMetadata('x-synthetic::tone-length')).toBe(false);
  });

  it('keeps the Japanese adapter ahead of the generic fallback', async () => {
    const japanesePackage: LanguageData = {
      name: 'Japanese',
      prosody: { type: 'japanese-pitch-accent' },
      settings: { fixed: {} },
    };
    const { getProsodyOverlayRenderer } = await import('../../utils/prosodyPresentation');
    expect(getProsodyOverlayRenderer(japanesePackage)).toBe('japanese-pitch-accent');

    const { getProsodyOverlayComponent } = await import('./prosodyOverlayRenderers');
    expect(getProsodyOverlayComponent('japanese-pitch-accent')?.name).not.toContain('Generic');
    expect(getProsodyOverlayComponent('generic-declarative')).toBeDefined();
  });

  it('falls back to a plain wrapper when no prosody capability exists', async () => {
    const { ProsodyOverlay } = await import('./ProsodyOverlay');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const spy = vi.fn();
    const dispose = render(() => (
      <ProsodyOverlay
        word="x"
        reading="x"
        prosodyType="x-unknown::model"
        languageData={{ name: 'No prosody', prosody: { type: 'x-unknown::model' } }}
        mode="overlay"
        class="keep-me"
      >
        <span ref={spy} />
      </ProsodyOverlay>
    ), container);

    expect(container.querySelector('.generic-prosody-units')).toBeNull();
    expect(container.querySelector('.prosody-overlay-wrapper')?.classList.contains('keep-me')).toBe(true);
    dispose();
    container.remove();
  });
});
