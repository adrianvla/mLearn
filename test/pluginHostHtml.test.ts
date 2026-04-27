import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const htmlPath = path.resolve(__dirname, '../src/html/plugin-host.html');

describe('plugin-host html CSP', () => {
  it('allows plugin-ui assets needed by component plugins', () => {
    const html = fs.readFileSync(htmlPath, 'utf-8');

    expect(html).toContain("script-src 'self' plugin-ui:");
    expect(html).toContain("img-src 'self' data: blob: flashcard-image: local-media: plugin-ui:");
    expect(html).toContain("media-src 'self' blob: * flashcard-audio: flashcard-video: local-media: plugin-ui:");
  });
});
