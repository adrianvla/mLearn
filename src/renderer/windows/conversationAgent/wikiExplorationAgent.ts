/**
 * Wiki Exploration Agent
 *
 * An LLM-powered agent that autonomously navigates a Fandom wiki to find
 * story/plot context for a character. Used as a fallback when structured
 * wiki data (chapter lists, biography sections) cannot be found through
 * standard scraping.
 */

import type { LLMChatMessage, LLMToolCall, LLMToolDefinition, LLMStreamChunk } from '../../../shared/types';
import { getBridge } from '../../../shared/bridges';

export interface WikiExplorationResult {
  storyContext: string;
  storyPageTitle?: string;
}

/** Strip wikitext markup to plain text */
function stripWikitext(text: string): string {
  return text
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{Ref\|[^}]*\}\}/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

const WIKI_TOOLS: LLMToolDefinition[] = [
  {
    name: 'search_wiki',
    description: 'Search the wiki for pages matching a query. Returns a list of page titles.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_page_sections',
    description: 'Get the list of sections (headings) in a wiki page. Returns section index, level, and title.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Exact page title' },
      },
      required: ['title'],
    },
  },
  {
    name: 'read_section',
    description: 'Read the text content of a specific section of a wiki page.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Exact page title' },
        section_index: { type: 'string', description: 'Section index number from get_page_sections' },
      },
      required: ['title', 'section_index'],
    },
  },
  {
    name: 'get_page_intro',
    description: 'Get the introductory text of a wiki page (content before the first heading).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Exact page title' },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_page_links',
    description: 'Get all internal links from a wiki page. Useful for finding related pages.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Exact page title' },
      },
      required: ['title'],
    },
  },
  {
    name: 'submit_result',
    description: 'Submit the final compiled story context. Call this when you have gathered enough information or exhausted all approaches.',
    parameters: {
      type: 'object',
      properties: {
        story_context: {
          type: 'string',
          description: 'The compiled story/plot summary to use as roleplay backstory. If no story data was found, submit an empty string.',
        },
        story_page_title: {
          type: 'string',
          description: 'Title of the main story/chapter listing page, if one was found.',
        },
      },
      required: ['story_context'],
    },
  },
];

const KNOWN_WIKI_TOOL_NAMES = new Set(WIKI_TOOLS.map((t) => t.name));

async function executeWikiTool(
  toolCall: LLMToolCall,
  baseUrl: string,
): Promise<string> {
  const bridge = getBridge();
  const args = toolCall.arguments;

  switch (toolCall.name) {
    case 'search_wiki': {
      const query = args.query as string;
      const url = `${baseUrl}/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&formatversion=2&srlimit=10`;
      const result = await bridge.generic.fetchUrl(url);
      if (result.error) return `Error: ${result.error}`;
      const data = JSON.parse(result.content);
      const results = (data?.query?.search || []) as Array<{ title: string; snippet: string }>;
      if (results.length === 0) return 'No results found.';
      return results
        .map((r) => `- ${r.title}: ${r.snippet.replace(/<[^>]+>/g, '').slice(0, 100)}`)
        .join('\n');
    }

    case 'get_page_sections': {
      const title = args.title as string;
      const url = `${baseUrl}/api.php?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json&formatversion=2`;
      const result = await bridge.generic.fetchUrl(url);
      if (result.error) return `Error: ${result.error}`;
      const data = JSON.parse(result.content);
      const sections = (data?.parse?.sections || []) as Array<{ index: string; line: string; level: string }>;
      if (sections.length === 0) return 'No sections found on this page.';
      return sections
        .map((s) => `[${s.index}] ${'  '.repeat(parseInt(s.level) - 1)}${s.line}`)
        .join('\n');
    }

    case 'read_section': {
      const title = args.title as string;
      const sectionIndex = (args.section_index ?? args.sectionIndex) as string;
      const url = `${baseUrl}/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&section=${encodeURIComponent(sectionIndex)}&format=json&formatversion=2`;
      const result = await bridge.generic.fetchUrl(url);
      if (result.error) return `Error: ${result.error}`;
      const data = JSON.parse(result.content);
      const wikitext: string = data?.parse?.wikitext || '';
      return stripWikitext(wikitext).slice(0, 3000) || 'Section is empty.';
    }

    case 'get_page_intro': {
      const title = args.title as string;
      const url = `${baseUrl}/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2`;
      const result = await bridge.generic.fetchUrl(url);
      if (result.error) return `Error: ${result.error}`;
      const data = JSON.parse(result.content);
      const wikitext: string = data?.parse?.wikitext || '';
      const introEnd = wikitext.indexOf('\n==');
      const intro = introEnd > 0 ? wikitext.slice(0, introEnd) : wikitext.slice(0, 3000);
      return stripWikitext(intro).slice(0, 2000) || 'Page intro is empty.';
    }

    case 'get_page_links': {
      const title = args.title as string;
      const url = `${baseUrl}/api.php?action=parse&page=${encodeURIComponent(title)}&prop=links&format=json&formatversion=2`;
      const result = await bridge.generic.fetchUrl(url);
      if (result.error) return `Error: ${result.error}`;
      const data = JSON.parse(result.content);
      const links = ((data?.parse?.links || []) as Array<{ title: string; ns: number; exists: boolean }>)
        .filter((l) => l.ns === 0 && l.exists);
      if (links.length === 0) return 'No internal links found.';
      return links.slice(0, 50).map((l) => `- ${l.title}`).join('\n');
    }

    default:
      return 'Unknown tool.';
  }
}

/**
 * Parse tool calls from LLM text output as a fallback when structured
 * tool calls are not returned. Handles patterns like:
 *   search_wiki({"query": "..."})
 *   search_wiki{"query": "..."}
 */
function parseToolCallsFromContent(content: string): LLMToolCall[] {
  const toolCalls: LLMToolCall[] = [];

  const pattern = new RegExp(
    `(${Array.from(KNOWN_WIKI_TOOL_NAMES).join('|')})\\s*\\(?\\s*(\\{[\\s\\S]*?\\})\\s*\\)?`,
    'g',
  );

  let match;
  while ((match = pattern.exec(content)) !== null) {
    try {
      const args = JSON.parse(match[2]) as Record<string, unknown>;
      toolCalls.push({
        id: `parsed_wiki_${Date.now()}_${toolCalls.length}`,
        name: match[1],
        arguments: args,
      });
    } catch {
      // Skip malformed JSON
    }
  }

  return toolCalls;
}

/**
 * Run an LLM-powered wiki exploration agent. The agent navigates a Fandom wiki
 * to find and compile story/plot context for a character.
 *
 * Used as a fallback when standard wiki scraping (chapter lists, biography
 * sections) doesn't find usable story data.
 */
export async function exploreWikiForStoryContext(
  baseUrl: string,
  characterName: string,
  characterPageIntro: string,
  mediaType: string,
  progressPoint: string,
  onProgress: (msg: string) => void,
): Promise<WikiExplorationResult> {
  const bridge = getBridge();
  const MAX_ITERATIONS = 6;

  const progressConstraint = progressPoint
    ? `The user has progressed up to: ${progressPoint}. Only include story content up to this point — do not spoil later events.`
    : 'Include all available story content.';

  const messages: LLMChatMessage[] = [
    {
      role: 'system',
      content: `You are a wiki exploration agent. Your task is to navigate a Fandom wiki to find story/plot information about a character. You have tools to search, list sections, read content, and find links.

Goal: Compile a useful story/plot context for the character "${characterName}".
Wiki: ${baseUrl}
Media type: ${mediaType}
${progressConstraint}

Strategy:
1. Search for pages about the main plot, story arcs, timeline, or episode/chapter lists
2. Check the character's page for history, biography, or plot-related sections
3. Look for related plot pages via links
4. Read relevant sections to gather plot information
5. When you have enough context (or have exhausted useful leads), call submit_result

Tips:
- Try varied search terms: "plot", "story", "timeline", "arc", the series name, "synopsis"
- Category or list pages often link to individual arc/chapter pages
- Character pages often have "Background", "History", "Plot", or story arc sub-sections
- If the wiki is for a game, look for "storyline", "quest", "campaign" pages
- Don't read every section — pick the most relevant ones

You MUST call submit_result when done, even if you found nothing (submit empty string).`,
    },
    {
      role: 'user',
      content: `Find story context for "${characterName}". Here's the character's wiki page intro:\n\n${characterPageIntro.slice(0, 2000)}`,
    },
  ];

  return new Promise<WikiExplorationResult>((resolve) => {
    let iteration = 0;
    let resolved = false;

    function finish(result: WikiExplorationResult) {
      if (resolved) return;
      resolved = true;
      resolve(result);
    }

    function runIteration() {
      if (iteration >= MAX_ITERATIONS) {
        finish({ storyContext: '' });
        return;
      }
      iteration++;

      let accumulated = '';
      const collectedToolCalls: LLMToolCall[] = [];

      const cleanup = bridge.llm.onLLMStreamChunk((chunk: LLMStreamChunk) => {
        if (chunk.error) {
          cleanup();
          finish({ storyContext: '' });
          return;
        }
        if (chunk.content) {
          accumulated += chunk.content;
        }
        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            collectedToolCalls.push(tc);
          }
        }
        if (chunk.done) {
          cleanup();
          handleIterationComplete(accumulated, collectedToolCalls);
        }
      });

      bridge.llm.llmStream(messages, WIKI_TOOLS);
    }

    async function handleIterationComplete(
      content: string,
      toolCalls: LLMToolCall[],
    ) {
      // Also check content-based tool calls as fallback
      if (toolCalls.length === 0) {
        const parsed = parseToolCallsFromContent(content);
        if (parsed.length > 0) {
          toolCalls = parsed;
        }
      }

      // Check for submit_result
      const submitCall = toolCalls.find((tc) => tc.name === 'submit_result');
      if (submitCall) {
        const storyContext = (submitCall.arguments.story_context as string) || '';
        const storyPageTitle = submitCall.arguments.story_page_title as string | undefined;
        finish({ storyContext, storyPageTitle });
        return;
      }

      // No tools and no submit — treat accumulated text as a final response
      if (toolCalls.length === 0) {
        finish({ storyContext: '' });
        return;
      }

      // Add assistant message to history
      messages.push({
        role: 'assistant',
        content,
        toolCalls,
      });

      // Execute non-submit tools
      const executableCalls = toolCalls.filter((tc) => tc.name !== 'submit_result');
      for (const tc of executableCalls) {
        const argPreview = Object.values(tc.arguments).join(', ').slice(0, 60);
        onProgress(`${tc.name}: ${argPreview}`);

        try {
          const result = await executeWikiTool(tc, baseUrl);
          messages.push({
            role: 'tool',
            toolName: tc.name,
            content: result,
          });
        } catch (err) {
          messages.push({
            role: 'tool',
            toolName: tc.name,
            content: `Error: ${(err as Error).message}`,
          });
        }
      }

      runIteration();
    }

    runIteration();
  });
}
