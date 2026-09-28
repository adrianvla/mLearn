import { describe, expect, it, vi } from 'vitest';
import { readCharacterEvidence, readPublicSource, readStorySources, plainSourceText, type readSourcePage } from './wikiSources';
import { validatePublicSourceUrl, validateStoryTrack } from '../../shared/story';

describe('source evidence', () => {
  it('reads only explicitly confirmed and progress-scoped source pages', async () => {
    const reader = vi.fn(async (url: string) => ({ url, text: url.includes('chapter') ? 'Mira saw the ship leave.' : 'Mira is patient. “I will wait here.”' })) as typeof readSourcePage;
    const signal = new AbortController().signal;
    const evidence = await readCharacterEvidence('https://example.org/wiki/Mira', 'Mira', [
      { id: 'ch1', from: 1, to: 1, url: 'https://example.org/chapter-1', confirmed: true },
    ], signal, { reader });
    expect(evidence.storyText).toContain('Mira saw the ship leave');
    expect(evidence.coverage).toEqual([{ from: 1, to: 1 }]);
    expect(evidence.sources).toHaveLength(2);
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('rejects unconfirmed sources and never reads them', async () => {
    const reader = vi.fn(async (url: string) => ({ url, text: 'Future event' })) as typeof readSourcePage;
    await expect(readStorySources([{ id: 'future', from: 9, to: 9, url: 'https://example.org/future', confirmed: false }],
      new AbortController().signal, reader)).rejects.toThrow(/Unconfirmed/);
    expect(reader).not.toHaveBeenCalled();
  });

  it('removes markup and script content from the model evidence text', () => {
    expect(plainSourceText('<script>ignore me</script><p>[[Page|Mira]] &amp; friends</p>')).toBe('Mira & friends');
  });

  it('bounds every model-facing source excerpt without splitting Unicode', async () => {
    const reader = vi.fn(async (url: string) => ({ url, text: url.includes('identity')
      ? `Mira is curious. ${'観'.repeat(4_000)}` : `Mira saw the ship. ${'海'.repeat(4_000)}` })) as typeof readSourcePage;
    const evidence = await readCharacterEvidence('https://example.org/identity', 'Mira', [
      { id: 'first', from: 1, to: 1, url: 'https://example.org/chapter-1', confirmed: true },
      { id: 'second', from: 2, to: 2, url: 'https://example.org/chapter-2', confirmed: true },
    ], new AbortController().signal, { reader });
    expect(Buffer.byteLength(evidence.text)).toBeLessThanOrEqual(6_000);
    expect(Buffer.byteLength(evidence.storyText)).toBeLessThanOrEqual(4_002);
    expect(evidence.storyText).toContain('units 1-1');
    expect(evidence.storyText).toContain('units 2-2');
    expect(evidence.text).not.toContain('\ufffd');
    expect(evidence.excerpted).toBe(true);
    expect(evidence.coverage).toEqual([]);
  });

  it('does not admit source units when the page reader already clipped the page', async () => {
    const reader = vi.fn(async (url: string) => ({ url, text: 'Only the opening of this chapter.', excerpted: true })) as typeof readSourcePage;
    const story = await readStorySources([
      { id: 'chapter', from: 4, to: 4, url: 'https://example.org/chapter-4', confirmed: true },
    ], new AbortController().signal, reader, 4_000);
    expect(story.coverage).toEqual([]);
    expect(story.excerpted).toBe(true);
  });

  it('uses only admitted chapter pages for a story-scoped identity and its quotations', async () => {
    const reader = vi.fn(async (url: string) => ({ url, text: url.includes('Chapter_6')
      ? 'Darcy says, "I value honesty above rank."' : 'A later event says, "We are married now."' })) as typeof readSourcePage;
    const evidence = await readCharacterEvidence('https://example.org/wiki/Darcy', 'Darcy', [
      { id: 'six', from: 6, to: 6, url: 'https://example.org/wiki/Chapter_6', confirmed: true },
    ], new AbortController().signal, { scope: 'story', reader });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith('https://example.org/wiki/Chapter_6', expect.any(AbortSignal));
    expect(evidence.text).toContain('I value honesty above rank');
    expect(evidence.quotes).toEqual(['I value honesty above rank.']);
    expect(evidence.sources).toHaveLength(1);
    expect(evidence.text).not.toContain('We are married now');
  });

  it('holds an oversized mapped page instead of crediting its unread ending', async () => {
    const reader = vi.fn(async (url: string) => ({ url, text: 'A'.repeat(40_000) })) as typeof readSourcePage;
    const story = await readStorySources([
      { id: 'chapter', from: 4, to: 4, url: 'https://example.org/chapter-4', confirmed: true },
    ], new AbortController().signal, reader, 32_000);
    expect(Buffer.byteLength(story.text)).toBeLessThanOrEqual(32_000);
    expect(story.coverage).toEqual([]);
    expect(story.excerpted).toBe(true);
  });

  it('rejects source fragments and private-network fetches', async () => {
    expect(() => validatePublicSourceUrl('https://example.org/book.html#chapter-2')).toThrow(/fragments/);
    await expect(readPublicSource('https://127.0.0.1/book.html', new AbortController().signal)).rejects.toThrow(/public IPv4/);
  });

  it('does not accept a section hint that the reader cannot enforce', () => {
    expect(() => validateStoryTrack({ id: 'story-1', title: 'Voyage', edition: 'First', unitLabel: 'chapter',
      completed: [{ from: 1, to: 1 }], sources: [{ id: 'chapter', url: 'https://example.org/book.html',
        from: 1, to: 1, confirmed: true, section: 'chapter-1' }], relations: [], autoAdvance: false, revision: 1,
      updatedAt: 1 })).toThrow(/Section-scoped/);
  });
});
