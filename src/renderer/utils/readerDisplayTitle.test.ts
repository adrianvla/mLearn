import { describe, expect, it } from 'vitest';
import { readerBookDisplayTitle } from './readerDisplayTitle';

describe('readerBookDisplayTitle', () => {
  it('prefers a book-provided title over the filename', () => {
    expect(readerBookDisplayTitle('  The Real Book  ', 'hash-and-release__1234567890abcdef.epub'))
      .toBe('The Real Book');
  });

  it('cleans filename artifacts while retaining meaningful volume information', () => {
    expect(readerBookDisplayTitle(undefined, 'Saga_Vol_02_1234567890abcdef.epub'))
      .toBe('Saga Vol 02');
  });

  it('keeps short hexadecimal titles and falls back to the original name when cleanup is empty', () => {
    expect(readerBookDisplayTitle(undefined, 'DeadBeef.epub')).toBe('DeadBeef');
    expect(readerBookDisplayTitle(undefined, '0000000000000000.pdf')).toBe('0000000000000000');
  });
});
