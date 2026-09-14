import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/windows/wordDbEditor/components/WordEntryRow.css', 'utf8');

describe('Word Database pill sizing', () => {
  it('gives level labels and knowledge buttons the same exact height', () => {
    const sizingRule = css.match(/\.word-db-editor \.col\.level \.label-pill,\s*\.word-db-editor \.col\.knowledge \.btn-pill\s*\{([^}]*)\}/)?.[1];

    expect(sizingRule).toMatch(/height:\s*var\(--size-md\)/);
    expect(sizingRule).toMatch(/min-height:\s*var\(--size-md\)/);
    expect(sizingRule).toMatch(/padding-top:\s*0/);
    expect(sizingRule).toMatch(/padding-bottom:\s*0/);
  });
});
