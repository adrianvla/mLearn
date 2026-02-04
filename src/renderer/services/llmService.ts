/**
 * LLM Service
 * Handles interactions with the local language model
 * Ported from llmInteractions.js in the original mLearn app
 */

import type { LLMResponse, LLMStatus, Settings } from '../../shared/types';

// Cached LLM status
let cachedLlmStatus: LLMStatus | null = null;
let cachedLlmCheckedAt: number = 0;
let llmDownloadApproved: boolean = false;

// Cache TTLs matching old app
const LLM_STATUS_CACHE_TTL = 30_000; // 30 seconds
const LLM_STATUS_CACHE_ACTIVE_TTL = 2_000; // 2 seconds while actively downloading

// LLM explanation cache - stores explanations by word+context combination
// Key format: `${word}|||${context}` where context is truncated/normalized
interface LLMExplanationCacheEntry {
  explanation: string;
  timestamp: number;
}
const llmExplanationCache = new Map<string, LLMExplanationCacheEntry>();
const LLM_EXPLANATION_CACHE_MAX = 500; // Max entries to prevent memory bloat
const LLM_EXPLANATION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Streaming chunk callback type
 */
export type StreamChunkCallback = (chunk: string, fullText: string, done: boolean) => void;

/**
 * Generate cache key for LLM explanation
 */
function getLLMCacheKey(word: string, context: string): string {
  // Normalize context: trim, lowercase first 100 chars to handle slight variations
  const normalizedContext = (context || '').trim().substring(0, 100).toLowerCase();
  return `${word}|||${normalizedContext}`;
}

/**
 * Get cached LLM explanation if available
 */
export function getCachedExplanation(word: string, context: string): string | null {
  const key = getLLMCacheKey(word, context);
  const entry = llmExplanationCache.get(key);
  
  if (!entry) return null;
  
  // Check if expired
  if (Date.now() - entry.timestamp > LLM_EXPLANATION_CACHE_TTL) {
    llmExplanationCache.delete(key);
    return null;
  }
  
  return entry.explanation;
}

/**
 * Cache an LLM explanation
 */
export function cacheExplanation(word: string, context: string, explanation: string): void {
  const key = getLLMCacheKey(word, context);
  
  // Simple LRU: if at max, delete oldest entries
  if (llmExplanationCache.size >= LLM_EXPLANATION_CACHE_MAX) {
    // Delete first 10% of entries (FIFO since Map maintains insertion order)
    const toDelete = Math.ceil(LLM_EXPLANATION_CACHE_MAX * 0.1);
    let deleted = 0;
    for (const k of llmExplanationCache.keys()) {
      if (deleted >= toDelete) break;
      llmExplanationCache.delete(k);
      deleted++;
    }
  }
  
  llmExplanationCache.set(key, {
    explanation,
    timestamp: Date.now(),
  });
}

/**
 * Clear all cached explanations
 */
export function clearExplanationCache(): void {
  llmExplanationCache.clear();
}

/**
 * Derive LLM URL from settings
 */
function deriveLLMUrl(settings: Settings): string | null {
  if (settings.llmEnabled === false) return null;
  if ((settings as any).llmUrl) return (settings as any).llmUrl;
  if (settings.getTranslationUrl && settings.getTranslationUrl.includes('/translate')) {
    return settings.getTranslationUrl.replace('/translate', '/llm');
  }
  if (settings.tokeniserUrl && settings.tokeniserUrl.includes('/tokenize')) {
    return settings.tokeniserUrl.replace('/tokenize', '/llm');
  }
  // Default fallback
  return 'http://127.0.0.1:7752/llm';
}

/**
 * Derive LLM status URL from LLM URL (like old app)
 */
function deriveLLMStatusUrl(llmUrl: string | null): string | null {
  if (!llmUrl) return null;
  if (llmUrl.endsWith('/llm/status')) return llmUrl;
  if (llmUrl.endsWith('/llm')) return `${llmUrl}/status`;
  return `${llmUrl.replace(/\/$/, '')}/status`;
}

/**
 * Build the prompt for LLM word explanation
 */
export function buildExplanationPrompt(word: string, contextPhrase: string): string {
  const language = 'English';
  return `You are a ${language}-only language assistant. You must always respond entirely in ${language}.

Task:
1. Translate the following sentence into ${language}.
2. Add a blank line.
3. Explain what the word 「${word}」 means in this sentence, focusing on its nuance in context. Keep it 1-2 sentences.
4. Add a blank line.
5. List the main grammar points as bullet points, each explaining its function or nuance in context. Keep bullets short (1-2 sentences each).
6. STOP after providing translation, word explanation, and grammar points. Do NOT add extra commentary. Do NOT add romaji, nor any reading information.

Sentence:
${contextPhrase}`;
}

/**
 * Clean output by removing the echoed prompt
 */
export function cleanLLMOutput(output: string, prompt: string, contextPhrase: string): string {
  if (!output) return output;
  return output
    .replaceAll(prompt, '')
    .replaceAll(contextPhrase, '')
    .trim();
}

/**
 * Check LLM status using GET endpoint (like old app)
 */
export async function checkLlmStatus(settings: Settings): Promise<LLMStatus | null> {
  const now = Date.now();
  
  // Use shorter cache TTL when actively downloading
  const cacheTtl = (cachedLlmStatus && cachedLlmStatus.downloading === true && 
    (typeof cachedLlmStatus.progress !== 'number' || cachedLlmStatus.progress < 1))
    ? LLM_STATUS_CACHE_ACTIVE_TTL
    : LLM_STATUS_CACHE_TTL;
    
  if (cachedLlmStatus && now - cachedLlmCheckedAt < cacheTtl) {
    return cachedLlmStatus;
  }

  const llmUrl = deriveLLMUrl(settings);
  const statusUrl = deriveLLMStatusUrl(llmUrl);
  if (!statusUrl) return null;

  try {
    // Use GET method like old app (not POST)
    const response = await fetch(statusUrl, {
      method: 'GET',
      cache: 'no-store',
    });

    if (response.ok) {
      const data = await response.json();
      if (typeof data === 'object' && data) {
        cachedLlmStatus = data;
        cachedLlmCheckedAt = now;
        return data;
      }
    }
  } catch (err) {
    console.warn('Failed to check LLM status:', err);
  }

  return null;
}

/**
 * Get word explanation using LLM (non-streaming, original implementation)
 */
export async function getWordExplanation(
  word: string,
  contextPhrase: string,
  settings: Settings
): Promise<LLMResponse> {
  if (settings.llmEnabled === false) {
    return { error: 'LLM disabled' };
  }

  // Check cache first - this implements the "memory" for LLM explanations
  const cachedExplanation = getCachedExplanation(word, contextPhrase);
  if (cachedExplanation) {
    console.log(`%cUsing cached LLM explanation for "${word}"`, 'color: cyan;');
    return { output: cachedExplanation };
  }

  const llmUrl = deriveLLMUrl(settings);
  if (!llmUrl) {
    return { error: 'LLM URL not configured' };
  }

  // Check status first
  const status = await checkLlmStatus(settings);
  const isReady = status?.downloaded === true;
  const isCached = status?.cached === true;

  if (!isReady && !isCached && !llmDownloadApproved) {
    llmDownloadApproved = true;
  }

  const prompt = buildExplanationPrompt(word, contextPhrase);

  try {
    const response = await fetch(llmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        max_new_tokens: 256,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      return { error: `LLM request failed: ${response.status}` };
    }

    const data = await response.json();

    // Update cached status
    if (data.downloaded !== undefined) {
      cachedLlmStatus = {
        downloaded: true,
        cached: true,
        device: data.device ?? null,
        downloading: false,
        progress: 1,
        downloadedBytes: cachedLlmStatus?.downloadedBytes || 0,
        expectedBytes: cachedLlmStatus?.expectedBytes || 0,
      };
      cachedLlmCheckedAt = Date.now();
    }

    // Clean output by removing the prompt prefix and context phrase
    if (data.output) {
      data.output = cleanLLMOutput(data.output, prompt, contextPhrase);
      cacheExplanation(word, contextPhrase, data.output);
      console.log(`%cCached LLM explanation for "${word}"`, 'color: lime;');
    }

    return data;
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Get word explanation using LLM with streaming (SSE)
 * Returns an abort controller to allow cancellation
 */
export async function getWordExplanationStreaming(
  word: string,
  contextPhrase: string,
  settings: Settings,
  onChunk: StreamChunkCallback
): Promise<{ abort: () => void }> {
  const abortController = new AbortController();
  
  const runStream = async () => {
    if (settings.llmEnabled === false) {
      onChunk('', 'LLM disabled', true);
      return;
    }

    // Check cache first
    const cachedExplanation = getCachedExplanation(word, contextPhrase);
    if (cachedExplanation) {
      console.log(`%cUsing cached LLM explanation for "${word}"`, 'color: cyan;');
      // For cached responses, emit the full text at once
      onChunk(cachedExplanation, cachedExplanation, true);
      return;
    }

    const llmUrl = deriveLLMUrl(settings);
    if (!llmUrl) {
      onChunk('', 'LLM URL not configured', true);
      return;
    }

    const streamUrl = `${llmUrl}/stream`;
    const prompt = buildExplanationPrompt(word, contextPhrase);

    try {
      const response = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          max_new_tokens: 256,
          temperature: 0.3,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        onChunk('', `LLM request failed: ${response.status}`, true);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onChunk('', 'Failed to get response reader', true);
        return;
      }

      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // Process SSE messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.error) {
                onChunk('', `Error: ${data.error}`, true);
                return;
              }
              
              if (data.chunk) {
                fullText += data.chunk;
                // Clean the full text progressively
                const cleanedText = cleanLLMOutput(fullText, prompt, contextPhrase);
                onChunk(data.chunk, cleanedText, false);
              }
              
              if (data.done) {
                const finalText = data.full_text 
                  ? cleanLLMOutput(data.full_text, prompt, contextPhrase)
                  : cleanLLMOutput(fullText, prompt, contextPhrase);
                
                // Cache the successful explanation
                if (finalText) {
                  cacheExplanation(word, contextPhrase, finalText);
                  console.log(`%cCached streamed LLM explanation for "${word}"`, 'color: lime;');
                }
                
                onChunk('', finalText, true);
                return;
              }
            } catch (e) {
              // Ignore parse errors for incomplete data
            }
          }
        }
      }
      
      // If we exit the loop without a done signal, emit final
      const finalText = cleanLLMOutput(fullText, prompt, contextPhrase);
      if (finalText) {
        cacheExplanation(word, contextPhrase, finalText);
      }
      onChunk('', finalText, true);
      
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        console.log('LLM stream aborted');
        return;
      }
      onChunk('', `Error: ${String(e)}`, true);
    }
  };

  // Start the stream (don't await, let it run in background)
  runStream();

  return { abort: () => abortController.abort() };
}

/**
 * Get LLM download status (for progress display)
 */
export function getLLMStatus(): LLMStatus | null {
  return cachedLlmStatus;
}

/**
 * Set LLM download approved flag
 */
export function approveLLMDownload(): void {
  llmDownloadApproved = true;
}
