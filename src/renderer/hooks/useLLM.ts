/**
 * LLM Hook
 * Integration with local language models for translation and chat
 */

import { createSignal } from 'solid-js';
import { PORTS } from '../../shared/constants';
import { useServer } from '../context';
import { useSettings } from '../context';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface LLMResponse {
  text: string;
  tokensUsed?: number;
  finishReason?: string;
}

interface StreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (text: string) => void;
  onError?: (error: string) => void;
}

export function useLLM() {
  const { isConnected } = useServer();
  const { settings } = useSettings();
  
  const [isGenerating, setIsGenerating] = createSignal(false);
  const [currentResponse, setCurrentResponse] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  // Make a completion request
  const complete = async (
    prompt: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
    }
  ): Promise<LLMResponse | null> => {
    if (!isConnected()) {
      setError('Backend not connected');
      return null;
    }

    setIsGenerating(true);
    setError(null);
    setCurrentResponse('');

    try {
      const messages: ChatMessage[] = [];
      
      if (options?.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      
      messages.push({ role: 'user', content: prompt });

      const response = await fetch(`http://localhost:${PORTS.PYTHON_BACKEND}/llm/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          max_tokens: options?.maxTokens ?? 512,
          temperature: options?.temperature ?? 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM request failed: ${response.status}`);
      }

      const result = await response.json();
      setCurrentResponse(result.text);
      
      return {
        text: result.text,
        tokensUsed: result.tokens_used,
        finishReason: result.finish_reason,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'LLM request failed';
      setError(message);
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  // Streaming completion
  const completeStream = async (
    prompt: string,
    callbacks: StreamCallbacks,
    options?: {
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
    }
  ): Promise<void> => {
    if (!isConnected()) {
      callbacks.onError?.('Backend not connected');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setCurrentResponse('');

    try {
      const messages: ChatMessage[] = [];
      
      if (options?.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      
      messages.push({ role: 'user', content: prompt });

      const response = await fetch(`http://localhost:${PORTS.PYTHON_BACKEND}/llm/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          max_tokens: options?.maxTokens ?? 512,
          temperature: options?.temperature ?? 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM stream failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              const token = parsed.token || parsed.text || '';
              
              if (token) {
                fullText += token;
                setCurrentResponse(fullText);
                callbacks.onToken?.(token);
              }
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      }

      callbacks.onComplete?.(fullText);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'LLM stream failed';
      setError(message);
      callbacks.onError?.(message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Translate text using LLM
  const translate = async (
    text: string,
    sourceLang?: string,
    targetLang?: string
  ): Promise<string | null> => {
    const source = sourceLang || settings.language || 'Japanese';
    const target = targetLang || 'English';

    const systemPrompt = `You are a professional translator. Translate the following ${source} text to ${target}. Only output the translation, nothing else.`;

    const result = await complete(text, {
      systemPrompt,
      maxTokens: 1024,
      temperature: 0.3,
    });

    return result?.text || null;
  };

  // Explain a word or phrase
  const explain = async (
    word: string,
    context?: string,
    language?: string
  ): Promise<string | null> => {
    const lang = language || settings.language || 'Japanese';
    
    let prompt = `Explain the ${lang} word/phrase "${word}" in simple English. Include:
1. Meaning(s)
2. Common usage
3. Example sentence`;

    if (context) {
      prompt += `\n\nContext: "${context}"`;
    }

    const result = await complete(prompt, {
      maxTokens: 512,
      temperature: 0.5,
    });

    return result?.text || null;
  };

  // Generate example sentences
  const generateExamples = async (
    word: string,
    count: number = 3,
    language?: string
  ): Promise<string[] | null> => {
    const lang = language || settings.language || 'Japanese';

    const prompt = `Generate ${count} example ${lang} sentences using the word "${word}". 
Format: One sentence per line, with English translation after a dash.`;

    const result = await complete(prompt, {
      maxTokens: 512,
      temperature: 0.7,
    });

    if (!result?.text) return null;

    return result.text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  };

  // Check grammar
  const checkGrammar = async (
    text: string,
    language?: string
  ): Promise<string | null> => {
    const lang = language || settings.language || 'Japanese';

    const prompt = `Check the following ${lang} text for grammar errors and suggest corrections:
"${text}"

If there are errors, explain them. If the text is correct, say so.`;

    const result = await complete(prompt, {
      maxTokens: 512,
      temperature: 0.3,
    });

    return result?.text || null;
  };

  // Abort current generation (requires backend support)
  const abort = async (): Promise<void> => {
    try {
      await fetch(`http://localhost:${PORTS.PYTHON_BACKEND}/llm/abort`, {
        method: 'POST',
      });
    } catch {
      // Ignore abort errors
    }
  };

  return {
    isGenerating,
    currentResponse,
    error,
    
    complete,
    completeStream,
    translate,
    explain,
    generateExamples,
    checkGrammar,
    abort,
    
    clearError: () => setError(null),
  };
}
