import type { LLMChatMessage, LLMStreamChunk } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { getLogger } from '../../shared/utils/logger';
import type { CanonCoordinate, ScenarioGrounding } from '../../shared/world';

const log = getLogger('renderer.wikiResearch');

export interface FandomSearchResult {
  title: string;
  pageid: number;
  snippet: string;
}

export interface WikiExtractedCharacter {
  name: string;
  lore: string;
  quotes: string[];
  fandomUrl: string;
  storyContext: string;
}

export interface ParsedLLMFields {
  lore: string;
  quotes: string[];
  context: string;
}

export interface WikiResearchResult {
  searchResults: FandomSearchResult[];
  extracted?: WikiExtractedCharacter;
  mediaTypeOptions: string[];
  selectedMediaType: string;
  storyPageTitle: string;
}

export interface WikiResearchError {
  error: string;
}

export interface BuildPersonaInput {
  extracted: WikiExtractedCharacter;
  storyPageTitle: string;
  progressPoint: string;
  mediaType: string;
  languageName: string;
}

export interface BuildPersonaDeps {
  canExploreWiki: boolean;
  devMode: boolean;
  exploreWikiForStoryContext?: WikiExplorer;
}

type WikiExplorer = (
  baseUrl: string,
  characterName: string,
  characterPageIntro: string,
  mediaType: string,
  progressPoint: string,
  onProgress: (message: string) => void,
) => Promise<{ storyContext: string; storyPageTitle?: string }>;

export interface WikiPersonaProgress {
  phase: 'fetching-chapters' | 'chapter-progress' | 'exploring-wiki' | 'wiki-exploration' | 'stream';
  message?: string;
}

export interface WikiPersonaResult {
  lore: string;
  quotes: string[];
  context: string;
  storyPageTitle?: string;
}

interface ChapterLink {
  title: string;
  num: number;
}

export interface ChapterSummary {
  num: number;
  title: string;
  summary: string;
}

export interface BuildScenarioGroundingInput {
  workTitle: string;
  fandomBaseUrl: string;
  characterPageTitle: string;
  coordinate: CanonCoordinate;
  presentCharacters: string[];
  chapterSummaries: ChapterSummary[];
  storyContext?: string;
  fetchedAt: number;
  fillSegments?: string[];
}

interface WikiSection {
  index: string;
  line: string;
  level: string;
}

/** Strip wikitext markup to plain text */
export function stripWikitext(text: string): string {
  return text
    // Remove file/image links
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    // Convert wiki links [[Page|Display]] → Display, [[Page]] → Page
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    // Remove templates {{ ... }}
    .replace(/\{\{[^}]*\}\}/g, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Remove refs
    .replace(/\{\{Ref\|[^}]*\}\}/gi, '')
    // Remove multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    // Remove leading/trailing whitespace per line
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

/** Extract quotes from a Quotes section's wikitext.
 * Handles common Fandom formats:
 *   *(To X) ''"quote"''{{Ref|...}}
 *   * (To X) "''quote''"<ref>...</ref>
 *   * ''quote text''  (no attribution)
 */
export function extractQuotesFromSection(wikitext: string): string[] {
  const quotes: string[] = [];
  const lines = wikitext.split('\n');
  for (const line of lines) {
    // Lines starting with * are quote entries
    if (!line.trim().startsWith('*')) continue;
    // Remove the leading * and any sub-level markers
    let text = line.replace(/^\*+\s*/, '');
    // Strip context like "(To X) " at the start
    text = text.replace(/^\([^)]*\)\s*/, '');
    // Strip {{Ref|...}} and <ref>...</ref> and <ref ... />
    text = text.replace(/\{\{Ref\|[^}]*\}\}/gi, '');
    text = text.replace(/<ref[^>]*>.*?<\/ref>/gi, '');
    text = text.replace(/<ref[^/]*\/>/gi, '');
    // Strip wikitext italic markers '' and bold '''
    text = text.replace(/'{2,3}/g, '');
    // Strip remaining wiki markup
    text = stripWikitext(text);
    // Remove surrounding quotes/punctuation
    text = text.replace(/^[\s'"\u201C\u201D\u2018\u2019]+|[\s'"\u201C\u201D\u2018\u2019]+$/g, '').trim();
    if (text.length > 10 && text.length < 500) {
      quotes.push(text);
    }
  }
  return quotes;
}

/**
 * Extract a chapter/episode number from a page title.
 * Handles patterns like "Chapter 43", "Episode 12", "Chapter 43: Title", etc.
 * Also tries to extract trailing numbers from titles like "Naruto Uzumaki!! (chapter 1)".
 */
export function extractChapterNumber(title: string): number | null {
  // "Chapter 43", "Episode 12", "Ch. 5", "Ep 10", "Vol 3"
  const explicit = title.match(/(?:chapter|episode|ch\.?|ep\.?|vol\.?)\s*(\d+)/i);
  if (explicit) return parseInt(explicit[1], 10);
  // Trailing number in parens: "Title (chapter 1)"
  const paren = title.match(/\((?:chapter|episode|ch\.?|ep\.?|vol\.?)\s*(\d+)\)/i);
  if (paren) return parseInt(paren[1], 10);
  // Hash-style: "#43" or "No. 43"
  const hash = title.match(/(?:#|no\.?)\s*(\d+)/i);
  if (hash) return parseInt(hash[1], 10);
  return null;
}

/**
 * Extract the ==Summary== section from a chapter page's wikitext.
 * Falls back to intro text (before first ==heading==) if no Summary section.
 */
export function extractChapterSummary(wikitext: string): string {
  // Try to extract ==Summary== section
  const summaryMatch = wikitext.match(/^==\s*Summary\s*==\s*\n([\s\S]*?)(?=\n==[^=]|$)/mi);
  if (summaryMatch) return stripWikitext(summaryMatch[1]).slice(0, 1500);
  // Fall back to intro (before first section header)
  const introEnd = wikitext.indexOf('\n==');
  if (introEnd > 0) return stripWikitext(wikitext.slice(0, introEnd)).slice(0, 1500);
  return stripWikitext(wikitext.slice(0, 1500));
}

/** Validate progress point input — must be "all" or match a recognized pattern */
export function isValidProgressPoint(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return true; // empty is valid (means no progress)
  if (trimmed === 'all') return true;
  // "Chapter 43", "Episode 12", "Season 3", "Ch. 5", "Ep 10", "Arc 2"
  if (/^(?:chapter|episode|season|arc|volume|ch\.?|ep\.?|vol\.?)\s*\d+/i.test(trimmed)) return true;
  // Bare number: "43", "100"
  if (/^\d+$/.test(trimmed)) return true;
  return false;
}

/** Incrementally parse streaming JSON to extract fields as they appear */
export function parseStreamingJSON(raw: string): ParsedLLMFields {
  const result: ParsedLLMFields = { lore: '', quotes: [], context: '' };

  // Strip markdown fences if present
  let text = raw.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/, '');

  // Try full JSON parse first
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.lore) result.lore = parsed.lore;
      if (Array.isArray(parsed.quotes)) result.quotes = parsed.quotes;
      if (parsed.context) result.context = parsed.context;
      return result;
    } catch (e) {
      log.error('error', e);
      // Incomplete JSON — fall through to incremental parsing
    }
  }

  // Incremental: extract "lore": "..." (possibly incomplete)
  const loreMatch = text.match(/"lore"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/);
  if (loreMatch) result.lore = loreMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');

  // Extract "quotes": ["...", "..."] (possibly incomplete array)
  const quotesMatch = text.match(/"quotes"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
  if (quotesMatch) {
    const quotesStr = quotesMatch[1];
    const quoteItems = [...quotesStr.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
    result.quotes = quoteItems.map((m) => m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  }

  // Extract "context": "..." (possibly incomplete)
  const contextMatch = text.match(/"context"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/);
  if (contextMatch) result.context = contextMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');

  return result;
}

/** Normalize a Fandom URL to the base wiki URL */
export function normalizeFandomUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, '');
  // Accept URLs like "https://xyz.fandom.com/wiki/SomePage" → "https://xyz.fandom.com"
  const fandomMatch = cleaned.match(/^(https?:\/\/[^/]*\.fandom\.com)/i);
  if (fandomMatch) return fandomMatch[1];
  // Accept just "xyz" → "https://xyz.fandom.com"
  if (!cleaned.includes('.') && !cleaned.includes('/')) {
    return `https://${cleaned}.fandom.com`;
  }
  return cleaned;
}

/**
 * Fetch chapter summaries from a Fandom wiki's story listing page.
 * Extracts chapter links from the listing page, then batch-fetches
 * their content up to the specified progress point.
 */
export async function fetchChapterSummaries(
  baseUrl: string,
  storyPageTitle: string,
  progressPoint: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const bridge = getBridge();

  // 1. Get all links from the story listing page
  const linksUrl = `${baseUrl}/api.php?action=parse&page=${encodeURIComponent(storyPageTitle)}&prop=links&format=json&formatversion=2`;
  const linksResult = await bridge.generic.fetchUrl(linksUrl);
  const linksData = JSON.parse(linksResult.content);
  const allLinks: Array<{ title: string; exists: boolean }> = (linksData?.parse?.links || [])
    .filter((l: { ns: number; exists: boolean }) => l.ns === 0 && l.exists);

  // 2. Identify chapter/episode links by extracting numbers
  const chapterLinks: ChapterLink[] = [];
  for (const link of allLinks) {
    const num = extractChapterNumber(link.title);
    if (num !== null) {
      chapterLinks.push({ title: link.title, num });
    }
  }

  if (chapterLinks.length === 0) return '';

  // Sort by chapter number
  chapterLinks.sort((a, b) => a.num - b.num);

  // 3. Determine how many chapters to fetch based on progress point
  const isAll = progressPoint.trim().toLowerCase() === 'all';
  let chaptersToFetch: ChapterLink[];
  if (isAll) {
    chaptersToFetch = chapterLinks;
  } else {
    const progressNum = extractChapterNumber(progressPoint);
    let maxChapter: number;
    if (progressNum !== null) {
      maxChapter = progressNum;
    } else {
      const bareNum = progressPoint.match(/\d+/);
      if (!bareNum) return '';
      maxChapter = parseInt(bareNum[0], 10);
    }
    chaptersToFetch = chapterLinks.filter((c) => c.num <= maxChapter);
  }
  if (chaptersToFetch.length === 0) return '';

  // 4. Batch-fetch chapter pages (MediaWiki supports ~50 titles per request)
  const BATCH_SIZE = 50;
  const summaries: ChapterSummary[] = [];

  for (let i = 0; i < chaptersToFetch.length; i += BATCH_SIZE) {
    const batch = chaptersToFetch.slice(i, i + BATCH_SIZE);
    onProgress?.(`Fetching chapters ${batch[0].num}-${batch[batch.length - 1].num}...`);

    const titles = batch.map((c) => c.title).join('|');
    const batchUrl = `${baseUrl}/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(titles)}&format=json&formatversion=2`;
    try {
      const batchResult = await bridge.generic.fetchUrl(batchUrl);
      const batchData = JSON.parse(batchResult.content);
      const pages = batchData?.query?.pages || [];

      for (const page of pages) {
        const wikitext = page?.revisions?.[0]?.slots?.main?.content || '';
        if (!wikitext) continue;
        const chapterLink = batch.find((c) => c.title === page.title);
        if (!chapterLink) continue;
        const summary = extractChapterSummary(wikitext);
        if (summary) {
          summaries.push({ num: chapterLink.num, title: page.title, summary });
        }
      }
    } catch (e) {
      log.error('error', e);
      // Continue with remaining batches
    }
  }

  // 5. Sort summaries by chapter number and assemble
  summaries.sort((a, b) => a.num - b.num);
  return summaries.map((s) => `[${s.title}]\n${s.summary}`).join('\n\n');
}

/** Assemble deterministic, coordinate-scoped canon grounding from fetched summaries. */
export function buildScenarioGrounding(input: BuildScenarioGroundingInput): ScenarioGrounding {
  const coordinateChapter = Number.parseInt(input.coordinate.value, 10);
  const hasChapterCoordinate = input.coordinate.kind === 'chapter' && Number.isFinite(coordinateChapter);
  const ordered = input.chapterSummaries.slice().sort((a, b) => a.num - b.num);
  const known = hasChapterCoordinate ? ordered.filter((chapter) => chapter.num <= coordinateChapter) : ordered;
  const unknown = hasChapterCoordinate ? ordered.filter((chapter) => chapter.num > coordinateChapter) : [];
  const chapterSource = (chapter: ChapterSummary) => ({
    pageTitle: chapter.title,
    section: 'Summary',
    fetchedAt: input.fetchedAt,
  });
  const provenance = [
    ...known.map(chapterSource),
    ...unknown.map(chapterSource),
    ...(input.storyContext ? [{ pageTitle: input.characterPageTitle, section: 'Story context', fetchedAt: input.fetchedAt }] : []),
  ];
  const knows = known.map((chapter) => chapter.summary);
  const doesNotKnow = unknown.map((chapter) => chapter.summary);

  return {
    coordinate: input.coordinate,
    presentCharacters: input.presentCharacters.slice(),
    setting: input.storyContext ?? '',
    priorEvents: knows,
    conflicts: [],
    perParticipant: Object.fromEntries(input.presentCharacters.map((name) => [name, {
      knows: knows.slice(),
      doesNotKnow: doesNotKnow.slice(),
      relationships: [],
      motivations: [],
      speechTraits: [],
    }])),
    provenance,
    fillSegments: input.fillSegments?.slice() ?? [],
  };
}

/** Search a Fandom wiki, optionally extracting a directly selected page. */
export async function searchAndExtractCharacter(
  fandomUrl: string,
  characterPageTitleOrSearchQuery: FandomSearchResult | string,
  _mediaType: string,
): Promise<WikiResearchResult | WikiResearchError> {
  const base = normalizeFandomUrl(fandomUrl);
  try {
    let searchResults: FandomSearchResult[] = [];
    let page: FandomSearchResult | undefined;

    if (typeof characterPageTitleOrSearchQuery === 'string') {
      const encodedQuery = encodeURIComponent(characterPageTitleOrSearchQuery);
      const apiUrl = `${base}/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&formatversion=2&srlimit=10`;
      const result = await getBridge().generic.fetchUrl(apiUrl);
      if (result.error) return { error: result.error };
      const data = JSON.parse(result.content);
      const results = data?.query?.search as FandomSearchResult[] | undefined;
      if (!results || results.length === 0) return { error: 'No results found.' };
      searchResults = results;
      page = results.find((r) => r.title.toLowerCase() === characterPageTitleOrSearchQuery.toLowerCase());
      if (!page) {
        return { searchResults, mediaTypeOptions: [], selectedMediaType: '', storyPageTitle: '' };
      }
    } else {
      page = characterPageTitleOrSearchQuery;
      searchResults = [page];
    }

    const sectionsUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=sections&format=json&formatversion=2`;
    const sectionsResult = await getBridge().generic.fetchUrl(sectionsUrl);
    const sectionsData = JSON.parse(sectionsResult.content);
    const sections: WikiSection[] = sectionsData?.parse?.sections || [];

    const contentUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=wikitext&format=json&formatversion=2`;
    const contentResult = await getBridge().generic.fetchUrl(contentUrl);
    const contentData = JSON.parse(contentResult.content);
    const fullWikitext: string = contentData?.parse?.wikitext || '';

    let foundQuotes: string[] = [];
    const quotesSection = sections.find((s) => s.line.toLowerCase() === 'quotes');
    if (quotesSection) {
      const quotesUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=wikitext&section=${quotesSection.index}&format=json&formatversion=2`;
      const quotesResult = await getBridge().generic.fetchUrl(quotesUrl);
      const quotesData = JSON.parse(quotesResult.content);
      foundQuotes = extractQuotesFromSection(quotesData?.parse?.wikitext || '');
    }

    let personalityText = '';
    const personalitySection = sections.find((s) => s.line.toLowerCase() === 'personality');
    if (personalitySection) {
      const persUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=wikitext&section=${personalitySection.index}&format=json&formatversion=2`;
      const persResult = await getBridge().generic.fetchUrl(persUrl);
      const persData = JSON.parse(persResult.content);
      personalityText = stripWikitext(persData?.parse?.wikitext || '');
    }

    const introEnd = fullWikitext.indexOf('\n==');
    const introText = introEnd > 0
      ? stripWikitext(fullWikitext.slice(0, introEnd))
      : stripWikitext(fullWikitext.slice(0, 2000));

    const storyKeywords = ['history', 'biography', 'synopsis', 'plot', 'story'];
    const storySections = sections.filter(
      (s) => s.level === '2' && storyKeywords.some((kw) => s.line.toLowerCase().includes(kw)),
    );
    const arcSections = sections.filter(
      (s) => s.level === '2' && /^part\s+[ivxlcdm0-9]+$/i.test(s.line.replace(/<[^>]+>/g, '').trim()),
    );
    const hasCharacterStory = storySections.length > 0 || arcSections.length > 0;

    let foundStoryPage = '';
    const storySearchTerms = [
      'Chapters and Volumes', 'Chapters', 'List of Chapters',
      'List of Volumes', 'Volumes', 'Chapter List',
      'Episodes', 'List of Episodes', 'Episode List',
      'Story Arcs', 'Arcs', 'Arc', 'Saga',
    ];
    const storyPageKeywords = ['chapter', 'volume', 'episode', 'arc', 'saga', 'storyline'];
    for (const term of storySearchTerms) {
      const searchUrl = `${base}/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&formatversion=2&srlimit=5`;
      try {
        const searchResult = await getBridge().generic.fetchUrl(searchUrl);
        const searchData = JSON.parse(searchResult.content);
        const results = searchData?.query?.search as FandomSearchResult[] | undefined;
        if (results && results.length > 0) {
          const exactMatch = results.find((r) => r.title.toLowerCase() === term.toLowerCase());
          const keywordMatch = results.find(
            (r) => !r.title.includes('/') && storyPageKeywords.some((kw) => r.title.toLowerCase().includes(kw)),
          );
          const match = exactMatch || keywordMatch;
          if (match) {
            foundStoryPage = match.title;
            break;
          }
        }
      } catch (e) {
        log.error('error', e);
      }
    }

    let fetchedStoryContext = '';
    if (hasCharacterStory) {
      const relevantSections = [...storySections, ...arcSections];
      for (const sec of relevantSections.slice(0, 3)) {
        const secUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=wikitext&section=${sec.index}&format=json&formatversion=2`;
        try {
          const secResult = await getBridge().generic.fetchUrl(secUrl);
          const secData = JSON.parse(secResult.content);
          const secText = stripWikitext(secData?.parse?.wikitext || '');
          if (secText) fetchedStoryContext += `\n\n=== ${sec.line} ===\n${secText}`;
        } catch (e) {
          log.error('error', e);
        }
      }
    } else if (foundStoryPage) {
      const storySecUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(foundStoryPage)}&prop=sections&format=json&formatversion=2`;
      try {
        const storySecResult = await getBridge().generic.fetchUrl(storySecUrl);
        const storySecData = JSON.parse(storySecResult.content);
        const storySecs: WikiSection[] = storySecData?.parse?.sections || [];
        const arcNames = storySecs
          .filter((s) => s.level === '2' || s.level === '3')
          .map((s) => s.line.replace(/<[^>]+>/g, '').trim())
          .filter((name) => name.length > 0);
        if (arcNames.length > 0) {
          fetchedStoryContext = `Story structure from "${foundStoryPage}":\n${arcNames.map((n) => `- ${n}`).join('\n')}`;
        }
      } catch (e) {
        log.error('error', e);
      }
    }

    const mediaTypes = new Set<string>();
    const lowerWikitext = fullWikitext.toLowerCase();
    if (lowerWikitext.includes('anime') || lowerWikitext.includes('episode')) mediaTypes.add('anime');
    if (lowerWikitext.includes('manga') || lowerWikitext.includes('chapter')) mediaTypes.add('manga');
    if (lowerWikitext.includes('light novel') || lowerWikitext.includes('novel')) mediaTypes.add('novel');
    if (lowerWikitext.includes('tv series') || lowerWikitext.includes('television') || lowerWikitext.includes('season')) mediaTypes.add('tv-series');
    if (lowerWikitext.includes('film') || lowerWikitext.includes('movie')) mediaTypes.add('film');
    if (lowerWikitext.includes('game') || lowerWikitext.includes('video game')) mediaTypes.add('game');
    if (lowerWikitext.includes('book') || lowerWikitext.includes('volume')) mediaTypes.add('book');
    if (mediaTypes.size === 0) mediaTypes.add('other');
    const mediaTypeOptions = Array.from(mediaTypes);

    return {
      searchResults,
      extracted: {
        name: page.title,
        lore: personalityText || introText,
        quotes: foundQuotes.slice(0, 10),
        fandomUrl: base,
        storyContext: fetchedStoryContext.trim(),
      },
      mediaTypeOptions,
      selectedMediaType: mediaTypeOptions[0],
      storyPageTitle: foundStoryPage,
    };
  } catch (err) {
    log.error('error', err);
    return { error: (err as Error).message };
  }
}

/** Build a roleplay persona card from extracted wiki data. */
export async function buildPersonaFromWiki(
  input: BuildPersonaInput,
  deps: BuildPersonaDeps,
  onProgress?: (progress: WikiPersonaProgress) => void,
): Promise<WikiPersonaResult | WikiResearchError> {
  const { extracted, storyPageTitle, progressPoint, mediaType, languageName } = input;
  let chapterSummaries = '';
  if (storyPageTitle && progressPoint.trim()) {
    onProgress?.({ phase: 'fetching-chapters' });
    try {
      chapterSummaries = await fetchChapterSummaries(
        extracted.fandomUrl,
        storyPageTitle,
        progressPoint.trim(),
        (message) => onProgress?.({ phase: 'chapter-progress', message }),
      );
    } catch (e) {
      log.error('error', e);
    }
  }

  let exploredContext = '';
  let exploredStoryPageTitle = '';
  if (!chapterSummaries && deps.canExploreWiki && deps.exploreWikiForStoryContext) {
    onProgress?.({ phase: 'exploring-wiki' });
    try {
      const exploration = await deps.exploreWikiForStoryContext(
        extracted.fandomUrl,
        extracted.name,
        extracted.lore,
        mediaType,
        progressPoint.trim(),
        (message) => onProgress?.({ phase: 'wiki-exploration', message }),
      );
      exploredContext = exploration.storyContext;
      if (exploration.storyPageTitle && !storyPageTitle) exploredStoryPageTitle = exploration.storyPageTitle;
    } catch (e) {
      log.error('error', e);
    }
  }

  const loreSnippet = extracted.lore.slice(0, 3000);
  const quotesText = extracted.quotes.length > 0
    ? extracted.quotes.slice(0, 8).map((q) => `- "${q}"`).join('\n')
    : 'No quotes found.';
  const progressInfo = progressPoint.trim()
    ? `The user has progressed up to: ${progressPoint.trim()} (${mediaType}). The character should be at this point in the story — do not reference events after this point.`
    : '';

  let storySection = '';
  if (chapterSummaries) {
    storySection = `\n\nChapter summaries from the wiki (up to the user's progress point):\n${chapterSummaries.slice(0, 30000)}`;
  } else if (exploredContext) {
    storySection = `\n\nStory context gathered from wiki exploration:\n${exploredContext.slice(0, 15000)}`;
  } else if (extracted.storyContext) {
    storySection = `\n\nStory/arc context from the wiki:\n${extracted.storyContext.slice(0, 4000)}`;
  }

  const hasStoryData = !!chapterSummaries || !!exploredContext || !!extracted.storyContext;
  const systemMsg: LLMChatMessage = {
    role: 'system',
    content: `You are a helpful assistant that creates roleplay character cards for a language learning app where the user is learning ${languageName}.

Output ONLY a JSON object with these fields:
- "lore": A detailed persona card (5-8 sentences) in ${languageName}. Describe the character's core personality traits, attitudes, emotional tendencies, taboos (things they would never say or do), and distinctive speaking style. Be specific and vivid. ${progressInfo}
- "quotes": An array of 2-4 of the BEST original quotes from the reference quotes below. Pick quotes that best capture the character's personality and voice. Keep them in their original language. If no reference quotes are provided, write 2-4 characteristic quotes in ${languageName}.${hasStoryData ? `
- "context": A comprehensive story summary (10-20 sentences) in ${languageName}. Summarize the plot up to the user's progress point. Focus on major events, character development, key relationships, and current story state. This will be used as context for roleplay conversations — make it detailed enough that someone unfamiliar with the story could understand the character's current situation. Do NOT mention events past the user's progress point.` : ''}

Do not include any other text outside the JSON object. No markdown fences.`,
  };

  const userMsg: LLMChatMessage = {
    role: 'user',
    content: `Create a roleplay persona card for "${extracted.name}".

Character information:
${loreSnippet}

Reference quotes (select the best 2-4 from these):
${quotesText}

Media type: ${mediaType}
${progressInfo}${storySection}

Remember: the "lore" field should be detailed (5-8 sentences). For "quotes", pick the 2-4 most characteristic quotes from the reference list above.${hasStoryData ? ' For "context", write a comprehensive plot summary up to the progress point.' : ''}
Generate the JSON object now.`,
  };

  try {
    const result = await new Promise<WikiPersonaResult>((resolve, reject) => {
      const bridge = getBridge();
      let accumulated = '';

      const cleanup = bridge.llm.onLLMStreamChunk((chunk: LLMStreamChunk) => {
        if (chunk.error) {
          cleanup();
          reject(new Error(chunk.error));
          return;
        }
        if (chunk.content) {
          accumulated += chunk.content;
          onProgress?.({ phase: 'stream', message: accumulated });
        }
        if (chunk.done) {
          cleanup();
          try {
            // Try to extract JSON from the response
            const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              reject(new Error('No JSON found in response'));
              return;
            }
            const parsed = JSON.parse(jsonMatch[0]);
            resolve({
              lore: parsed.lore || extracted.lore.slice(0, 500),
              quotes: Array.isArray(parsed.quotes) ? parsed.quotes.slice(0, 4) : extracted.quotes,
              context: parsed.context || '',
              storyPageTitle: exploredStoryPageTitle || undefined,
            });
          } catch (e) {
            log.error('error', e);
            // Use the raw extracted data as fallback
            resolve({ lore: extracted.lore.slice(0, 500), quotes: extracted.quotes, context: '', storyPageTitle: exploredStoryPageTitle || undefined });
          }
        }
      });

      if (deps.devMode) {
        log.info('[QuickStart] Prompt sent to LLM:', JSON.stringify([systemMsg, userMsg], null, 2));
      }

      bridge.llm.llmStream([systemMsg, userMsg], []);
    });
    return result;
  } catch (e) {
    log.error('error', e);
    return { error: (e as Error).message };
  }
}
