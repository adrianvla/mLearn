import { describe, expect, it } from 'vitest';

import { getWindowControlsInsets } from './windowChrome';

describe('getWindowControlsInsets', () => {
  it('reserves space only when macOS traffic lights overlap renderer content', () => {
    expect(getWindowControlsInsets({
      isElectron: true,
      isMacOS: true,
      contentOverlapsNativeControls: true,
    })).toEqual({ inlineStart: '100px', blockStart: '28px' });
  });

  it.each([
    { isElectron: true, isMacOS: false, contentOverlapsNativeControls: true },
    { isElectron: false, isMacOS: true, contentOverlapsNativeControls: true },
    { isElectron: true, isMacOS: true, contentOverlapsNativeControls: false },
  ])('does not reserve native-control space when no controls obstruct content', (environment) => {
    expect(getWindowControlsInsets(environment)).toEqual({ inlineStart: '0px', blockStart: '0px' });
  });
});
