/**
 * Tokenizer Test Component
 * Component for testing NLP tokenization with real backends
 * 
 * This component demonstrates:
 * - Using useNLPTokenizer hook
 * - Handling tokenization results
 * - Displaying token information
 * - Error handling
 */

import { createSignal, Show, For, createEffect } from 'solid-js';
import type { TokenizationResult } from '../../../shared/nlp-backend-abstraction';
import type { LanguageCode } from '../../../shared/language-abstraction';
import { useNLPTokenizer } from '../../hooks/useNLPTokenizer';
import './TokenizerTestComponent.css';

interface TokenizerTestComponentProps {
  initialText?: string;
  initialLanguage?: LanguageCode;
}

/**
 * Test component for NLP tokenization
 * 
 * Usage:
 * ```tsx
 * <TokenizerTestComponent initialText="こんにちは" initialLanguage="ja" />
 * ```
 */
export function TokenizerTestComponent(props: TokenizerTestComponentProps) {
  const [text, setText] = createSignal(props.initialText || '');
  const [language, setLanguage] = createSignal<LanguageCode>(props.initialLanguage || 'ja');
  const [result, setResult] = createSignal<TokenizationResult | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const { tokenize, getCached } = useNLPTokenizer();

  // Handle tokenization
  const handleTokenize = async () => {
    if (!text().trim()) {
      setError('Please enter text to tokenize');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const tokenizationResult = await tokenize(text(), language());
      setResult(tokenizationResult);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Tokenization failed: ${errorMessage}`);
      console.error('[TokenizerTestComponent] Tokenization error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Check cache on text/language change
  createEffect(() => {
    const currentText = text();
    const currentLanguage = language();
    
    if (currentText.trim()) {
      const cached = getCached(currentText, currentLanguage);
      if (cached) {
        setResult(cached);
      }
    }
  });

  return (
    <div class="tokenizer-test-component">
      <div class="tokenizer-header">
        <h2>NLP Tokenizer Test</h2>
        <p class="subtitle">Test tokenization with MeCab (Japanese) and spaCy (German)</p>
      </div>

      <div class="tokenizer-controls">
        <div class="control-group">
          <label for="language-select">Language:</label>
          <select
            id="language-select"
            value={language()}
            onChange={(e) => setLanguage(e.currentTarget.value as LanguageCode)}
            disabled={isLoading()}
          >
            <option value="ja">Japanese (MeCab)</option>
            <option value="de">German (spaCy)</option>
          </select>
        </div>

        <div class="control-group">
          <label for="text-input">Text to tokenize:</label>
          <textarea
            id="text-input"
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            placeholder={language() === 'ja' ? 'Enter Japanese text...' : 'Enter German text...'}
            disabled={isLoading()}
            rows={4}
          />
        </div>

        <button
          onClick={handleTokenize}
          disabled={isLoading() || !text().trim()}
          class="tokenize-button"
        >
          {isLoading() ? 'Tokenizing...' : 'Tokenize'}
        </button>
      </div>

      <Show when={error()}>
        <div class="error-message">
          <strong>Error:</strong> {error()}
        </div>
      </Show>

      <Show when={result()}>
        {(tokenizationResult) => (
          <div class="tokenizer-results">
            <div class="result-header">
              <h3>Tokenization Results</h3>
              <div class="result-metadata">
                <span class="metadata-item">
                  <strong>Language:</strong> {tokenizationResult().language}
                </span>
                <span class="metadata-item">
                  <strong>Tokens:</strong> {tokenizationResult().tokens.length}
                </span>
                <Show when={tokenizationResult().processingTime}>
                  <span class="metadata-item">
                    <strong>Time:</strong> {tokenizationResult().processingTime}ms
                  </span>
                </Show>
                <Show when={tokenizationResult().confidence}>
                  <span class="metadata-item">
                    <strong>Confidence:</strong> {(tokenizationResult().confidence! * 100).toFixed(1)}%
                  </span>
                </Show>
              </div>
            </div>

            <div class="tokens-table">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Surface</th>
                    <th>Base</th>
                    <th>POS</th>
                    <Show when={language() === 'ja'}>
                      <th>Reading</th>
                      <th>Pitch</th>
                    </Show>
                  </tr>
                </thead>
                <tbody>
                  <For each={tokenizationResult().tokens}>
                    {(token, index) => (
                      <tr>
                        <td class="index">{index() + 1}</td>
                        <td class="surface">{token.surface}</td>
                        <td class="base">{token.base}</td>
                        <td class="pos">{token.pos}</td>
                        <Show when={language() === 'ja'}>
                          <td class="reading">{token.reading || '—'}</td>
                          <td class="pitch">{token.pitchAccent !== undefined ? token.pitchAccent : '—'}</td>
                        </Show>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>

            <div class="raw-result">
              <h4>Raw Result (JSON)</h4>
              <pre>{JSON.stringify(tokenizationResult(), null, 2)}</pre>
            </div>
          </div>
        )}
      </Show>

      <Show when={!result() && !error() && !isLoading()}>
        <div class="placeholder">
          <p>Enter text and click "Tokenize" to see results</p>
        </div>
      </Show>
    </div>
  );
}
