import { describe, expect, it, vi } from 'vitest';
import { registerStartupSchemes } from './startupSchemes';

const mocks = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged: mocks.register } }));

describe('early startup schemes', () => {
  it('registers every renderer asset scheme before app readiness', () => {
    registerStartupSchemes();
    expect(mocks.register.mock.calls.map(([entries]) => entries[0].scheme)).toEqual([
      'local-media', 'plugin-ui', 'flashcard-image', 'flashcard-audio', 'flashcard-video',
    ]);
    expect(mocks.register.mock.calls[0][0][0].privileges).toMatchObject({
      standard: true, stream: true, corsEnabled: true,
    });
  });
});
