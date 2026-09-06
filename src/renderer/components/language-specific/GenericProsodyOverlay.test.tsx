import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { LanguageData } from '../../../shared/types';
import { ProsodyOverlay } from './ProsodyOverlay';

// E2 synthetic fixture: a THIRD-PARTY prosody model with deliberately
// non-Japanese structure. It must render through the generic declarative
// path — no language branch, no modification of the Japanese adapter.

let mockSettings: { showProsody?: boolean } = { showProsody: true };

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useLanguage: () => ({}),
}));

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

function mountOverlay(jsx: () => import("solid-js").JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(jsx, container);
  return {
    container,
    cleanup: () => {
      dispose();
      container.remove();
    },
  };
}

describe('generic declarative prosody overlay (E2 synthetic fixture)', () => {
  it('marks the payload unit over preserved children for a novel package type', () => {
    const mounted = mountOverlay(() => (
      <ProsodyOverlay
        word="katana"
        reading="katana"
        prosodyType="x-synthetic::tone-length"
        prosodyPosition={2}
        languageData={syntheticPackage}
        mode="overlay"
      >
        <span>katana</span>
      </ProsodyOverlay>
    ));
    const wrapper = mounted.container.querySelector('.prosody-overlay-wrapper')!;
    // Children (the styled word text) stay visible, like the Japanese overlay.
    expect(wrapper.textContent).toContain('katana');
    const bar = wrapper.querySelector('.generic-prosody-markbar')!;
    // 1-based position 2 of 6 units: the bar spans the second sixth.
    expect(bar.getAttribute('style')).toContain('left: 16.66');
    expect(bar.getAttribute('style')).toContain('width: 16.66');
    expect(bar.classList.contains('generic-prosody-markbar--overline')).toBe(true);
    // No Japanese machinery leaked into the generic path.
    expect(mounted.container.querySelectorAll('.pitch-accent')).toHaveLength(0);
    mounted.cleanup();
  });

  it('segments by grapheme clusters when the package declares them', () => {
    const mounted = mountOverlay(() => (
      <ProsodyOverlay
        word="égal"
        reading={'e\u0301gal'}
        prosodyType="x-synthetic::diplith"
        prosodyPosition={1}
        languageData={graphemePackage}
        mode="overlay"
      />
    ));
    const bar = mounted.container.querySelector('.generic-prosody-markbar')!;
    // e + combining acute = ONE of FOUR grapheme units.
    expect(bar.getAttribute('style')).toContain('width: 25%');
    expect(bar.classList.contains('generic-prosody-markbar--underline')).toBe(true);
    mounted.cleanup();
  });

  it('honors the global prosody visibility setting', () => {
    mockSettings = { showProsody: false };
    const mounted = mountOverlay(() => (
      <ProsodyOverlay
        word="katana"
        reading="katana"
        prosodyType="x-synthetic::tone-length"
        prosodyPosition={2}
        languageData={syntheticPackage}
        mode="overlay"
      />
    ));
    expect(mounted.container.querySelector('.generic-prosody-markbar')).toBeNull();
    mounted.cleanup();
    mockSettings = { showProsody: true };
  });

  it('does not render a stored type that belongs to a different model', () => {
    const mounted = mountOverlay(() => (
      <ProsodyOverlay
        word="katana"
        reading="katana"
        prosodyType="x-other::model"
        prosodyPosition={2}
        languageData={syntheticPackage}
        mode="overlay"
      />
    ));
    expect(mounted.container.querySelector('.generic-prosody-markbar')).toBeNull();
    mounted.cleanup();
  });

  it('respects an explicit none as prosody suppression', () => {
    const mounted = mountOverlay(() => (
      <ProsodyOverlay
        word="katana"
        reading="katana"
        prosodyType="none"
        prosodyPosition={2}
        languageData={syntheticPackage}
        mode="overlay"
      />
    ));
    expect(mounted.container.querySelector('.generic-prosody-markbar')).toBeNull();
    mounted.cleanup();
  });

  it('resolves the declarative adapter from package metadata, not registration', async () => {
    const { getProsodyOverlayRenderer, canRenderStoredProsodyWithoutMetadata } = await import('../../utils/prosodyPresentation');
    expect(getProsodyOverlayRenderer(syntheticPackage)).toBe('generic-declarative');
    expect(getProsodyOverlayRenderer(graphemePackage, 'x-synthetic::diplith')).toBe('generic-declarative');
    // A stored type foreign to the installed package does not adopt this package's overlay.
    expect(getProsodyOverlayRenderer(syntheticPackage, 'x-other::model')).toBeNull();
    expect(getProsodyOverlayRenderer(syntheticPackage, 'none')).toBeNull();
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
    expect(getProsodyOverlayComponent('generic-declarative')).toBeDefined();
  });
});
