// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMStreamChunk } from '../../shared/types';
import type { CanonCoordinate } from '../../shared/world';
import {
  buildScenarioGrounding,
  buildPersonaFromWiki,
  extractChapterNumber,
  extractQuotesFromSection,
  isValidProgressPoint,
  parseStreamingJSON,
  searchAndExtractCharacter,
} from './wikiResearch';

let streamCallback: (chunk: LLMStreamChunk) => void = () => {};
const mockCleanup = vi.fn();
const mockFetchUrl = vi.fn<(url: string) => Promise<{ content: string; error?: string }>>();
const mockLlmStream = vi.fn();

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    generic: { fetchUrl: mockFetchUrl },
    llm: {
      onLLMStreamChunk: vi.fn((callback: (chunk: LLMStreamChunk) => void) => {
        streamCallback = callback;
        return mockCleanup;
      }),
      llmStream: mockLlmStream,
    },
  }),
}));

const character = { title: 'Hero', pageid: 1, snippet: 'A hero' };

function json(value: unknown): Promise<{ content: string }> {
  return Promise.resolve({ content: JSON.stringify(value) });
}

function installWikiFixtures(): void {
  mockFetchUrl.mockImplementation((url) => {
    if (url.includes('list=search') && url.includes('srsearch=Hero')) {
      return json({ query: { search: [character] } });
    }
    if (url.includes('page=Hero') && url.includes('prop=sections')) {
      return json({ parse: { sections: [
        { index: '1', line: 'Quotes', level: '2' },
        { index: '2', line: 'Personality', level: '2' },
      ] } });
    }
    if (url.includes('page=Hero') && url.includes('prop=wikitext') && url.includes('section=1')) {
      return json({ parse: { wikitext: '* (To friend) \'\'"I will protect everyone."\'\'{{Ref|1}}' } });
    }
    if (url.includes('page=Hero') && url.includes('prop=wikitext') && url.includes('section=2')) {
      return json({ parse: { wikitext: 'Calm, [[Brave|brave]], and loyal.' } });
    }
    if (url.includes('page=Hero') && url.includes('prop=wikitext')) {
      return json({ parse: { wikitext: 'Hero is an anime and manga protagonist.\n== History ==' } });
    }
    if (url.includes('list=search')) {
      return json({ query: { search: [{ title: 'Chapters', pageid: 2, snippet: '' }] } });
    }
    if (url.includes('page=Chapters') && url.includes('prop=sections')) {
      return json({ parse: { sections: [{ index: '1', line: 'Arc One', level: '2' }] } });
    }
    if (url.includes('page=Chapters') && url.includes('prop=links')) {
      return json({ parse: { links: [{ title: 'Chapter 1', ns: 0, exists: true }] } });
    }
    if (url.includes('prop=revisions')) {
      return json({ query: { pages: [{
        title: 'Chapter 1',
        revisions: [{ slots: { main: { content: 'Intro\n== Summary ==\nHero begins the journey.' } } }],
      }] } });
    }
    return json({});
  });
}

describe('wikiResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamCallback = () => {};
    installWikiFixtures();
  });

  it('extracts chapter numbers from supported title patterns', () => {
    expect(extractChapterNumber('Chapter 43: Arrival')).toBe(43);
    expect(extractChapterNumber('Episode 12')).toBe(12);
    expect(extractChapterNumber('No. 7')).toBe(7);
    expect(extractChapterNumber('Unnumbered title')).toBeNull();
  });

  it('accepts only supported progress points', () => {
    expect(isValidProgressPoint('')).toBe(true);
    expect(isValidProgressPoint('all')).toBe(true);
    expect(isValidProgressPoint('Chapter 43')).toBe(true);
    expect(isValidProgressPoint('100')).toBe(true);
    expect(isValidProgressPoint('after the battle')).toBe(false);
  });

  it('incrementally parses partial streaming JSON', () => {
    expect(parseStreamingJSON('{"lore":"Calm\\nvoice","quotes":["Hello"')).toEqual({
      lore: 'Calm\nvoice', quotes: ['Hello'], context: '',
    });
  });

  it('cleans quotes from Fandom wikitext', () => {
    expect(extractQuotesFromSection('* (To ally) \'\'"[[Hero|I will win today.]]"\'\'{{Ref|source}}')).toEqual([
      'I will win today.',
    ]);
  });

  it('searches and extracts a matching character page', async () => {
    const result = await searchAndExtractCharacter('example', 'Hero', '');

    expect(result).toMatchObject({
      searchResults: [character],
      mediaTypeOptions: ['anime', 'manga'],
      selectedMediaType: 'anime',
      storyPageTitle: 'Chapters',
      extracted: {
        name: 'Hero',
        lore: 'Calm, brave, and loyal.',
        quotes: ['I will protect everyone.'],
        storyContext: 'Story structure from "Chapters":\n- Arc One',
      },
    });
  });

  it('returns a fetch error from character search', async () => {
    mockFetchUrl.mockResolvedValueOnce({ content: '', error: 'Wiki unavailable' });

    await expect(searchAndExtractCharacter('example', 'Hero', '')).resolves.toEqual({ error: 'Wiki unavailable' });
  });

  it('builds a persona from streamed JSON including chapter context', async () => {
    mockLlmStream.mockImplementation(() => {
      streamCallback({ content: '{"lore":"Focused persona","quotes":["Line"],"context":"Story so far"}' });
      streamCallback({ done: true });
    });

    const result = await buildPersonaFromWiki({
      extracted: { name: 'Hero', lore: 'Brave hero', quotes: ['Original'], fandomUrl: 'https://example.fandom.com', storyContext: '' },
      storyPageTitle: 'Chapters', progressPoint: 'Chapter 1', mediaType: 'anime', languageName: 'Japanese',
    }, { canExploreWiki: false, devMode: false });

    expect(result).toMatchObject({ lore: 'Focused persona', quotes: ['Line'], context: 'Story so far' });
    expect(mockLlmStream).toHaveBeenCalledOnce();
  });

  it('falls back to extracted data when streamed JSON is malformed', async () => {
    mockLlmStream.mockImplementation(() => {
      streamCallback({ content: '{not json}' });
      streamCallback({ done: true });
    });

    await expect(buildPersonaFromWiki({
      extracted: { name: 'Hero', lore: 'Brave hero', quotes: ['Original'], fandomUrl: 'https://example.fandom.com', storyContext: '' },
      storyPageTitle: '', progressPoint: '', mediaType: 'anime', languageName: 'Japanese',
    }, { canExploreWiki: false, devMode: false })).resolves.toMatchObject({
      lore: 'Brave hero', quotes: ['Original'], context: '',
    });
  });

  it('builds coordinate-scoped grounding with provenance and flagged fill', () => {
    const coordinate: CanonCoordinate = { kind: 'chapter', value: '40' };
    const grounding = buildScenarioGrounding({
      workTitle: 'My Hero Academia',
      fandomBaseUrl: 'https://myheroacademia.fandom.com',
      characterPageTitle: 'Izuku Midoriya',
      coordinate,
      presentCharacters: ['Izuku Midoriya'],
      chapterSummaries: [
        { num: 40, title: 'Chapter 40', summary: 'Izuku completes the rescue.' },
        { num: 41, title: 'Chapter 41', summary: 'Izuku discovers a future secret.' },
      ],
      storyContext: 'U.A. High School.',
      fetchedAt: 1234,
      fillSegments: ['Invented transition.'],
    });

    expect(grounding.perParticipant['Izuku Midoriya'].knows).toEqual(['Izuku completes the rescue.']);
    expect(grounding.perParticipant['Izuku Midoriya'].doesNotKnow).toEqual(['Izuku discovers a future secret.']);
    expect(grounding.provenance).toEqual(expect.arrayContaining([
      { pageTitle: 'Chapter 40', section: 'Summary', fetchedAt: 1234 },
      { pageTitle: 'Chapter 41', section: 'Summary', fetchedAt: 1234 },
      { pageTitle: 'Izuku Midoriya', section: 'Story context', fetchedAt: 1234 },
    ]));
    expect(grounding.fillSegments).toEqual(['Invented transition.']);
  });

  it('loads the exploration agent after its wikitext helper was consolidated', async () => {
    const { exploreWikiForStoryContext } = await import('../windows/conversationAgent/wikiExplorationAgent');
    expect(typeof exploreWikiForStoryContext).toBe('function');
  });
});
