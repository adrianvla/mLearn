/**
 * RoleplayQuickStart
 * A step-by-step wizard that helps users quickly set up a roleplay character
 * by searching a Fandom wiki, extracting character info, and building a persona.
 */

import { Component, createSignal, createMemo, createEffect, Show, For, Match, Switch } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import {
  ModalForm,
  Input,
  Btn,
  HintText,
  FormField,
  Select,
  Spinner,
  FloatingStatus,
} from '../../components/common';
import type { AgentConfig, LLMChatMessage, LLMStreamChunk } from '../../../shared/types';
import { getBridge } from '../../../shared/bridges';
import { exploreWikiForStoryContext } from './wikiExplorationAgent';
import './RoleplayQuickStart.css';

type Step = 'character-name' | 'fandom-url' | 'searching' | 'media-type' | 'progress-point' | 'extracting' | 'review';

interface FandomSearchResult {
  title: string;
  pageid: number;
  snippet: string;
}

interface ExtractedCharacter {
  name: string;
  lore: string;
  quotes: string[];
  fandomUrl: string;
  storyContext: string;
}

interface RoleplayQuickStartProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (config: Partial<AgentConfig>) => void;
}

/** Strip wikitext markup to plain text */
function stripWikitext(text: string): string {
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
function extractQuotesFromSection(wikitext: string): string[] {
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

interface ChapterLink {
  title: string;
  num: number;
}

/**
 * Extract a chapter/episode number from a page title.
 * Handles patterns like "Chapter 43", "Episode 12", "Chapter 43: Title", etc.
 * Also tries to extract trailing numbers from titles like "Naruto Uzumaki!! (chapter 1)".
 */
function extractChapterNumber(title: string): number | null {
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
function extractChapterSummary(wikitext: string): string {
  // Try to extract ==Summary== section
  const summaryMatch = wikitext.match(/^==\s*Summary\s*==\s*\n([\s\S]*?)(?=\n==[^=]|$)/mi);
  if (summaryMatch) return stripWikitext(summaryMatch[1]).slice(0, 1500);
  // Fall back to intro (before first section header)
  const introEnd = wikitext.indexOf('\n==');
  if (introEnd > 0) return stripWikitext(wikitext.slice(0, introEnd)).slice(0, 1500);
  return stripWikitext(wikitext.slice(0, 1500));
}

/** Validate progress point input — must be "all" or match a recognized pattern */
function isValidProgressPoint(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return true; // empty is valid (means no progress)
  if (trimmed === 'all') return true;
  // "Chapter 43", "Episode 12", "Season 3", "Ch. 5", "Ep 10", "Arc 2"
  if (/^(?:chapter|episode|season|arc|volume|ch\.?|ep\.?|vol\.?)\s*\d+/i.test(trimmed)) return true;
  // Bare number: "43", "100"
  if (/^\d+$/.test(trimmed)) return true;
  return false;
}

interface ParsedLLMFields {
  lore: string;
  quotes: string[];
  context: string;
}

/** Incrementally parse streaming JSON to extract fields as they appear */
function parseStreamingJSON(raw: string): ParsedLLMFields {
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
      console.error(e);
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

/**
 * Fetch chapter summaries from a Fandom wiki's story listing page.
 * Extracts chapter links from the listing page, then batch-fetches
 * their content up to the specified progress point.
 */
async function fetchChapterSummaries(
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
  const summaries: Array<{ num: number; title: string; summary: string }> = [];

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
      console.error(e);
      // Continue with remaining batches
    }
  }

  // 5. Sort summaries by chapter number and assemble
  summaries.sort((a, b) => a.num - b.num);
  return summaries.map((s) => `[${s.title}]\n${s.summary}`).join('\n\n');
}

export const RoleplayQuickStart: Component<RoleplayQuickStartProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();

  const langName = () => {
    const code = settings.language || '';
    const key = `mlearn.Languages.${code}`;
    const localized = t(key);
    return localized !== key ? localized : code;
  };

  const [step, setStep] = createSignal<Step>('character-name');
  const [characterName, setCharacterName] = createSignal('');
  const [fandomUrl, setFandomUrl] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<FandomSearchResult[]>([]);
  const [error, setError] = createSignal('');
  const [mediaTypeOptions, setMediaTypeOptions] = createSignal<string[]>([]);
  const [selectedMediaType, setSelectedMediaType] = createSignal('');
  const [progressPoint, setProgressPoint] = createSignal('');
  const [extracted, setExtracted] = createSignal<ExtractedCharacter | null>(null);
  const [llmProgress, setLlmProgress] = createSignal('');
  const [storyContext, setStoryContext] = createSignal('');
  const [storyPageTitle, setStoryPageTitle] = createSignal('');

  /** Parsed fields from the streaming LLM response, updated live */
  const parsedProgress = createMemo((): ParsedLLMFields & { isFetching: boolean } => {
    const raw = llmProgress();
    // If it doesn't look like JSON yet, it's a fetch progress message
    if (!raw.includes('"') && !raw.includes('{')) {
      return { lore: '', quotes: [], context: '', isFetching: !!raw };
    }
    return { ...parseStreamingJSON(raw), isFetching: false };
  });

  const reset = () => {
    setStep('character-name');
    setCharacterName('');
    setFandomUrl('');
    setSearchResults([]);
    setError('');
    setMediaTypeOptions([]);
    setSelectedMediaType('');
    setProgressPoint('');
    setExtracted(null);
    setLlmProgress('');
    setStoryContext('');
    setStoryPageTitle('');
  };

  const handleClose = () => {
    reset();
    props.onClose();
  };

  /** Normalize a Fandom URL to the base wiki URL */
  const normalizeFandomUrl = (url: string): string => {
    let cleaned = url.trim().replace(/\/+$/, '');
    // Accept URLs like "https://xyz.fandom.com/wiki/SomePage" → "https://xyz.fandom.com"
    const fandomMatch = cleaned.match(/^(https?:\/\/[^/]*\.fandom\.com)/i);
    if (fandomMatch) return fandomMatch[1];
    // Accept just "xyz" → "https://xyz.fandom.com"
    if (!cleaned.includes('.') && !cleaned.includes('/')) {
      return `https://${cleaned}.fandom.com`;
    }
    return cleaned;
  };

  /** Search Fandom wiki for the character */
  const searchFandom = async () => {
    setError('');
    setStep('searching');

    const baseUrl = normalizeFandomUrl(fandomUrl());
    const encodedQuery = encodeURIComponent(characterName());
    const apiUrl = `${baseUrl}/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&formatversion=2&srlimit=10`;

    try {
      const result = await getBridge().generic.fetchUrl(apiUrl);
      if (result?.error) {
        setError(result.error);
        setStep('fandom-url');
        return;
      }

      const data = JSON.parse(result.content);
      const results = data?.query?.search as FandomSearchResult[] | undefined;

      if (!results || results.length === 0) {
        setError(t('mlearn.ConversationAgent.QuickStart.NoResults'));
        setStep('fandom-url');
        return;
      }

      setSearchResults(results);
      // Auto-select first result if it's an exact or near match
      const exactMatch = results.find(
        (r) => r.title.toLowerCase() === characterName().toLowerCase(),
      );
      if (exactMatch) {
        await selectCharacterPage(exactMatch, baseUrl);
      } else {
        setStep('fandom-url');
      }
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
      setStep('fandom-url');
    }
  };

  /** Select a character page and extract initial data */
  const selectCharacterPage = async (page: FandomSearchResult, baseUrl?: string) => {
    const base = baseUrl || normalizeFandomUrl(fandomUrl());
    setStep('searching');
    setError('');

    try {
      // Fetch sections to find Personality, Quotes, and identify media type pages
      const sectionsUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=sections&format=json&formatversion=2`;
      const sectionsResult = await getBridge().generic.fetchUrl(sectionsUrl);
      const sectionsData = JSON.parse(sectionsResult.content);
      const sections: Array<{ index: string; line: string; level: string }> = sectionsData?.parse?.sections || [];

      // Fetch full page wikitext for overview
      const contentUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=wikitext&format=json&formatversion=2`;
      const contentResult = await getBridge().generic.fetchUrl(contentUrl);
      const contentData = JSON.parse(contentResult.content);
      const fullWikitext: string = contentData?.parse?.wikitext || '';

      // Extract quotes from the dedicated Quotes section
      let foundQuotes: string[] = [];
      const quotesSection = sections.find(
        (s) => s.line.toLowerCase() === 'quotes',
      );
      if (quotesSection) {
        const quotesUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=wikitext&section=${quotesSection.index}&format=json&formatversion=2`;
        const quotesResult = await getBridge().generic.fetchUrl(quotesUrl);
        const quotesData = JSON.parse(quotesResult.content);
        const quotesWikitext: string = quotesData?.parse?.wikitext || '';
        foundQuotes = extractQuotesFromSection(quotesWikitext);
      }

      // Fetch Personality section if it exists
      let personalityText = '';
      const personalitySection = sections.find(
        (s) => s.line.toLowerCase() === 'personality',
      );
      if (personalitySection) {
        const persUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=wikitext&section=${personalitySection.index}&format=json&formatversion=2`;
        const persResult = await getBridge().generic.fetchUrl(persUrl);
        const persData = JSON.parse(persResult.content);
        personalityText = stripWikitext(persData?.parse?.wikitext || '');
      }

      // Get intro text (before first section)
      const introEnd = fullWikitext.indexOf('\n==');
      const introText = introEnd > 0
        ? stripWikitext(fullWikitext.slice(0, introEnd))
        : stripWikitext(fullWikitext.slice(0, 2000));

      // Check for story/history sections on the character page itself
      // Some wikis (e.g. Naruto) have arc subsections under Part I, Part II, etc.
      const storyKeywords = ['history', 'biography', 'synopsis', 'plot', 'story'];
      const storySections = sections.filter(
        (s) => s.level === '2' && storyKeywords.some((kw) => s.line.toLowerCase().includes(kw)),
      );
      // Also detect arc-style sections: level 2 headers like "Part I", "Part II", etc.
      const arcSections = sections.filter(
        (s) => s.level === '2' && /^part\s+[ivxlcdm0-9]+$/i.test(s.line.replace(/<[^>]+>/g, '').trim()),
      );
      const hasCharacterStory = storySections.length > 0 || arcSections.length > 0;

      // Search the wiki for story summary pages (chapters, episodes, arcs)
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
            // Prefer exact title match
            const exactMatch = results.find((r) => r.title.toLowerCase() === term.toLowerCase());
            // Then match any result (no subpages) whose title contains a story keyword
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
          console.error(e);
          // Not critical — continue without story context
        }
      }
      setStoryPageTitle(foundStoryPage);

      // Fetch story context: prefer character page history, fall back to story page
      let fetchedStoryContext = '';
      if (hasCharacterStory) {
        // Fetch all story/arc subsections from the character page
        const relevantSections = [...storySections, ...arcSections];
        for (const sec of relevantSections.slice(0, 3)) {
          const secUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=wikitext&section=${sec.index}&format=json&formatversion=2`;
          try {
            const secResult = await getBridge().generic.fetchUrl(secUrl);
            const secData = JSON.parse(secResult.content);
            const secText = stripWikitext(secData?.parse?.wikitext || '');
            if (secText) {
              fetchedStoryContext += `\n\n=== ${sec.line} ===\n${secText}`;
            }
          } catch (e) {
            console.error(e);
            // Skip this section
          }
        }
      } else if (foundStoryPage) {
        // Fetch the story overview page sections for arc names
        const storySecUrl = `${base}/api.php?action=parse&page=${encodeURIComponent(foundStoryPage)}&prop=sections&format=json&formatversion=2`;
        try {
          const storySecResult = await getBridge().generic.fetchUrl(storySecUrl);
          const storySecData = JSON.parse(storySecResult.content);
          const storySecs: Array<{ index: string; line: string; level: string }> = storySecData?.parse?.sections || [];
          // Extract a structured list of arc/volume names
          const arcNames = storySecs
            .filter((s) => s.level === '2' || s.level === '3')
            .map((s) => s.line.replace(/<[^>]+>/g, '').trim())
            .filter((name) => name.length > 0);
          if (arcNames.length > 0) {
            fetchedStoryContext = `Story structure from "${foundStoryPage}":\n${arcNames.map((n) => `- ${n}`).join('\n')}`;
          }
        } catch (e) {
          console.error(e);
          // Not critical
        }
      }

      setStoryContext(fetchedStoryContext.trim());

      // Determine available media types from section names and content
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

      setMediaTypeOptions(Array.from(mediaTypes));
      setSelectedMediaType(Array.from(mediaTypes)[0]);

      // Store intermediate data on a temp extracted object
      setExtracted({
        name: page.title,
        lore: personalityText || introText,
        quotes: foundQuotes.slice(0, 10),
        fandomUrl: base,
        storyContext: fetchedStoryContext.trim(),
      });

      setStep('media-type');
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
      setStep('fandom-url');
    }
  };

  /** Use LLM to build the final persona card from the extracted data */
  const buildPersona = async () => {
    // Validate progress point
    const pp = progressPoint().trim();
    if (pp && !isValidProgressPoint(pp)) {
      setError(t('mlearn.ConversationAgent.QuickStart.InvalidProgressPoint'));
      return;
    }
    setError('');
    setStep('extracting');
    setLlmProgress('');

    const ext = extracted();
    if (!ext) return;

    // Fetch chapter summaries if a story listing page was found and progress is set
    let chapterSummaries = '';
    const storyPage = storyPageTitle();
    if (storyPage && progressPoint().trim()) {
      setLlmProgress(t('mlearn.ConversationAgent.QuickStart.FetchingChapters'));
      try {
        chapterSummaries = await fetchChapterSummaries(
          ext.fandomUrl,
          storyPage,
          progressPoint().trim(),
          (msg) => setLlmProgress(msg),
        );
      } catch (e) {
        console.error(e);
        // Continue without chapter summaries
      }
    }

    // Fallback: use LLM agent to explore the wiki when chapter summaries couldn't be fetched.
    // The character page story section is just a brief overview — the agent can find
    // detailed chapter/arc data that standard scraping missed.
    let exploredContext = '';
    if (!chapterSummaries && settings.llmEnabled) {
      setLlmProgress(t('mlearn.ConversationAgent.QuickStart.ExploringWiki'));
      try {
        const exploration = await exploreWikiForStoryContext(
          ext.fandomUrl,
          ext.name,
          ext.lore,
          selectedMediaType(),
          progressPoint().trim(),
          (msg) => setLlmProgress(t('mlearn.ConversationAgent.QuickStart.ExploringWikiDetail', { detail: msg })),
        );
        exploredContext = exploration.storyContext;
        if (exploration.storyPageTitle && !storyPage) {
          setStoryPageTitle(exploration.storyPageTitle);
        }
      } catch (e) {
        console.error(e);
        // Continue without explored context
      }
    }

    const loreSnippet = ext.lore.slice(0, 3000);
    const quotesText = ext.quotes.length > 0
      ? ext.quotes.slice(0, 8).map((q) => `- "${q}"`).join('\n')
      : 'No quotes found.';
    const progressInfo = progressPoint().trim()
      ? `The user has progressed up to: ${progressPoint().trim()} (${selectedMediaType()}). The character should be at this point in the story — do not reference events after this point.`
      : '';

    // Build story context section for the LLM — prefer chapter summaries over arc names, then explored context
    let storySection = '';
    if (chapterSummaries) {
      storySection = `\n\nChapter summaries from the wiki (up to the user's progress point):\n${chapterSummaries.slice(0, 30000)}`;
    } else if (exploredContext) {
      storySection = `\n\nStory context gathered from wiki exploration:\n${exploredContext.slice(0, 15000)}`;
    } else {
      const story = ext.storyContext || storyContext();
      if (story) {
        storySection = `\n\nStory/arc context from the wiki:\n${story.slice(0, 4000)}`;
      }
    }

    const hasStoryData = !!chapterSummaries || !!exploredContext || !!ext.storyContext || !!storyContext();
    const language = langName();

    const systemMsg: LLMChatMessage = {
      role: 'system',
      content: `You are a helpful assistant that creates roleplay character cards for a language learning app where the user is learning ${language}.

Output ONLY a JSON object with these fields:
- "lore": A detailed persona card (5-8 sentences) in ${language}. Describe the character's core personality traits, attitudes, emotional tendencies, taboos (things they would never say or do), and distinctive speaking style. Be specific and vivid. ${progressInfo}
- "quotes": An array of 2-4 of the BEST original quotes from the reference quotes below. Pick quotes that best capture the character's personality and voice. Keep them in their original language. If no reference quotes are provided, write 2-4 characteristic quotes in ${language}.${hasStoryData ? `
- "context": A comprehensive story summary (10-20 sentences) in ${language}. Summarize the plot up to the user's progress point. Focus on major events, character development, key relationships, and current story state. This will be used as context for roleplay conversations — make it detailed enough that someone unfamiliar with the story could understand the character's current situation. Do NOT mention events past the user's progress point.` : ''}

Do not include any other text outside the JSON object. No markdown fences.`,
    };

    const userMsg: LLMChatMessage = {
      role: 'user',
      content: `Create a roleplay persona card for "${ext.name}".

Character information:
${loreSnippet}

Reference quotes (select the best 2-4 from these):
${quotesText}

Media type: ${selectedMediaType()}
${progressInfo}${storySection}

Remember: the "lore" field should be detailed (5-8 sentences). For "quotes", pick the 2-4 most characteristic quotes from the reference list above.${hasStoryData ? ' For "context", write a comprehensive plot summary up to the progress point.' : ''}
Generate the JSON object now.`,
    };

    setLlmProgress('');

    try {
      const result = await new Promise<{ lore: string; quotes: string[]; context: string }>((resolve, reject) => {
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
            setLlmProgress(accumulated);
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
                lore: parsed.lore || ext.lore.slice(0, 500),
                quotes: Array.isArray(parsed.quotes) ? parsed.quotes.slice(0, 4) : ext.quotes,
                context: parsed.context || '',
              });
            } catch (e) {
              console.error(e);
              // Use the raw extracted data as fallback
              resolve({ lore: ext.lore.slice(0, 500), quotes: ext.quotes, context: '' });
            }
          }
        });

        if (settings.devMode) {
          console.log('[QuickStart] Prompt sent to LLM:', JSON.stringify([systemMsg, userMsg], null, 2));
        }

        bridge.llm.llmStream([systemMsg, userMsg], []);
      });

      setExtracted({
        ...ext,
        lore: result.lore,
        quotes: result.quotes,
        storyContext: result.context,
      });
      setStep('review');
    } catch (e) {
      console.error(e);
      // Fallback to raw extracted data
      setStep('review');
    }
  };

  const handleConfirm = () => {
    const ext = extracted();
    if (!ext) return;

    props.onComplete({
      agentName: ext.name,
      roleplayName: ext.name,
      roleplayLore: ext.lore,
      roleplayQuotes: ext.quotes.filter((q) => q.trim()),
      roleplayFandomUrl: ext.fandomUrl,
      roleplayContext: ext.storyContext || undefined,
    });
    reset();
  };

  const mediaTypeLabels: Record<string, string> = {
    anime: 'Anime',
    manga: 'Manga',
    novel: 'Novel',
    'tv-series': 'TV Series',
    film: 'Film',
    game: 'Game',
    book: 'Book',
    other: 'Other',
  };

  const handleFormSubmit = () => {
    const s = step();
    if (s === 'character-name' && characterName().trim()) {
      setStep('fandom-url');
    } else if (s === 'fandom-url' && fandomUrl().trim()) {
      searchFandom();
    } else if (s === 'media-type') {
      buildPersona();
    }
  };

  return (
    <ModalForm
      isOpen={props.isOpen}
      onClose={handleClose}
      title={t('mlearn.ConversationAgent.QuickStart.Title', {name:characterName()})}
      size="lg"
      showCloseButton={true}
      closeOnEscape={true}
      headerDraggable={true}
      onSubmit={handleFormSubmit}
    >
      <div class="quickstart-content">
        <Switch>
          <Match when={step() === 'character-name'}>
            <FormField label={t('mlearn.ConversationAgent.QuickStart.CharacterNameLabel')}>
              <Input
                value={characterName()}
                onInput={(e) => setCharacterName(e.currentTarget.value)}
                placeholder={t('mlearn.ConversationAgent.QuickStart.CharacterNamePlaceholder')}
                size="md"
              />
            </FormField>
            <div class="quickstart-actions">
              <Btn
                variant="primary"
                onClick={() => setStep('fandom-url')}
                disabled={!characterName().trim()}
              >
                {t('mlearn.ConversationAgent.QuickStart.Next')}
              </Btn>
            </div>
          </Match>

          <Match when={step() === 'fandom-url'}>
            <FormField
              label={t('mlearn.ConversationAgent.QuickStart.FandomUrlLabel')}
              hint={t('mlearn.ConversationAgent.QuickStart.FandomUrlHint')}
            >
              <Input
                value={fandomUrl()}
                onInput={(e) => setFandomUrl(e.currentTarget.value)}
                placeholder={t('mlearn.ConversationAgent.QuickStart.FandomUrlPlaceholder')}
                size="md"
              />
            </FormField>

            <Show when={error()}>
              <HintText>{error()}</HintText>
            </Show>

            <Show when={searchResults().length > 0}>
              <div class="quickstart-search-results">
                <HintText>{t('mlearn.ConversationAgent.QuickStart.SelectResult')}</HintText>
                <For each={searchResults()}>
                  {(result) => (
                    <Btn
                      variant="ghost"
                      onClick={() => selectCharacterPage(result)}
                    >
                      {result.title}
                    </Btn>
                  )}
                </For>
              </div>
            </Show>

            <div class="quickstart-actions">
              <Btn variant="ghost" onClick={() => setStep('character-name')}>
                {t('mlearn.ConversationAgent.QuickStart.Back')}
              </Btn>
              <Btn
                variant="primary"
                onClick={searchFandom}
                disabled={!fandomUrl().trim()}
              >
                {t('mlearn.ConversationAgent.QuickStart.Search')}
              </Btn>
            </div>
          </Match>

          <Match when={step() === 'searching'}>
            <div class="quickstart-loading">
              <Spinner />
              <HintText>{t('mlearn.ConversationAgent.QuickStart.Searching')}</HintText>
            </div>
          </Match>

          <Match when={step() === 'media-type'}>
            <FormField label={t('mlearn.ConversationAgent.QuickStart.MediaTypeLabel')}>
              <Select
                options={mediaTypeOptions().map((mt) => ({
                  value: mt,
                  label: mediaTypeLabels[mt] || mt,
                }))}
                value={selectedMediaType()}
                onChange={(e) => setSelectedMediaType(e.currentTarget.value)}
              />
            </FormField>

            <FormField
              label={t('mlearn.ConversationAgent.QuickStart.ProgressPointLabel')}
              hint={t('mlearn.ConversationAgent.QuickStart.ProgressPointHint')}
            >
              <Input
                value={progressPoint()}
                onInput={(e) => { setProgressPoint(e.currentTarget.value); setError(''); }}
                placeholder={t('mlearn.ConversationAgent.QuickStart.ProgressPointPlaceholder')}
                size="md"
              />
            </FormField>

            <Show when={error()}>
              <HintText>{error()}</HintText>
            </Show>

            <div class="quickstart-actions">
              <Btn variant="ghost" onClick={() => setStep('fandom-url')}>
                {t('mlearn.ConversationAgent.QuickStart.Back')}
              </Btn>
              <Btn variant="primary" onClick={buildPersona}>
                {t('mlearn.ConversationAgent.QuickStart.Generate')}
              </Btn>
            </div>
          </Match>

          <Match when={step() === 'extracting'}>
            <div class="quickstart-extracting">
              <div class="quickstart-live-preview" ref={(el) => {
                createEffect(() => {
                  // Auto-scroll to bottom as content streams in
                  parsedProgress();
                  el.scrollTop = el.scrollHeight;
                });
              }}>
                <Show when={parsedProgress().lore}>
                  <FormField label={t('mlearn.ConversationAgent.QuickStart.ReviewLore')}>
                    <p class="quickstart-review-text">{parsedProgress().lore}</p>
                  </FormField>
                </Show>
                <Show when={parsedProgress().quotes.length > 0}>
                  <FormField label={t('mlearn.ConversationAgent.QuickStart.ReviewQuotes')}>
                    <ul class="quickstart-review-quotes">
                      <For each={parsedProgress().quotes}>
                        {(q) => <li>"{q}"</li>}
                      </For>
                    </ul>
                  </FormField>
                </Show>
                <Show when={parsedProgress().context}>
                  <FormField label={t('mlearn.ConversationAgent.QuickStart.ReviewContext')}>
                    <p class="quickstart-review-text">{parsedProgress().context}</p>
                  </FormField>
                </Show>
              </div>
              <FloatingStatus
                visible={step() === 'extracting'}
                indeterminate
                statusText={parsedProgress().isFetching
                  ? llmProgress()
                  : t('mlearn.ConversationAgent.QuickStart.Generating')}
                size={36}
                strokeWidth={4}
              />
            </div>
          </Match>

          <Match when={step() === 'review'}>
            <Show when={extracted()}>
              {(ext) => (
                <div class="quickstart-review">
                  <FormField label={t('mlearn.ConversationAgent.QuickStart.ReviewName')}>
                    <HintText>{ext().name}</HintText>
                  </FormField>

                  <FormField label={t('mlearn.ConversationAgent.QuickStart.ReviewLore')}>
                    <p class="quickstart-review-text">{ext().lore}</p>
                  </FormField>

                  <Show when={ext().quotes.length > 0}>
                    <FormField label={t('mlearn.ConversationAgent.QuickStart.ReviewQuotes')}>
                      <ul class="quickstart-review-quotes">
                        <For each={ext().quotes}>
                          {(q) => <li>"{q}"</li>}
                        </For>
                      </ul>
                    </FormField>
                  </Show>

                  <Show when={ext().storyContext}>
                    <FormField label={t('mlearn.ConversationAgent.QuickStart.ReviewContext')}>
                      <p class="quickstart-review-text">{ext().storyContext}</p>
                    </FormField>
                  </Show>

                  <FormField label={t('mlearn.ConversationAgent.QuickStart.ReviewFandom')}>
                    <HintText>{ext().fandomUrl}</HintText>
                  </FormField>
                </div>
              )}
            </Show>

            <div class="quickstart-actions">
              <Btn variant="ghost" onClick={() => setStep('media-type')}>
                {t('mlearn.ConversationAgent.QuickStart.Back')}
              </Btn>
              <Btn variant="primary" onClick={handleConfirm}>
                {t('mlearn.ConversationAgent.QuickStart.Confirm')}
              </Btn>
            </div>
          </Match>
        </Switch>
      </div>
    </ModalForm>
  );
};
