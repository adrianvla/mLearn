import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/test'),
  },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => '/tmp/test'),
}));

import { validateManifest } from './pluginManager';

const baseManifest = {
  id: 'demo.plugin',
  name: 'Demo Plugin',
  version: '1.0.0',
  apiVersion: '1.0.0',
  capabilities: ['ui-panel'],
  permissions: ['open-window'],
};

describe('validateManifest ui validation', () => {
  it('rejects schema ui contributions without an object schema', () => {
    expect(() => validateManifest({
      ...baseManifest,
      ui: {
        type: 'schema',
        schema: 'not-an-object',
      },
    }, '/plugins/demo.plugin')).toThrow("Invalid 'ui.schema' contribution");
  });

  it('rejects component ui contributions without a non-empty componentPath', () => {
    expect(() => validateManifest({
      ...baseManifest,
      ui: {
        type: 'component',
        componentPath: '',
      },
    }, '/plugins/demo.plugin')).toThrow("Invalid 'ui.componentPath' contribution");
  });

  it('rejects ui contributions with unsupported types', () => {
    expect(() => validateManifest({
      ...baseManifest,
      ui: {
        type: 'iframe',
      },
    }, '/plugins/demo.plugin')).toThrow("Invalid 'ui.type' contribution");
  });
});
