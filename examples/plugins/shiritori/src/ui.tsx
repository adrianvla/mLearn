import { createSignal, createEffect, For, Show, onMount } from 'solid-js';
import type { Component } from 'solid-js';
import {
  getInitialState,
  validateUserWord,
  processComputerTurn,
  getLastKana,
  normalizeForComparison,
  type GameState,
  type HostApi,
} from './game';

type PluginComponentProps = {
  context: Record<string, any>;
  host: {
    kvGet: (key: string) => Promise<string | null>;
    kvSet: (key: string, value: string) => Promise<void>;
    closeWindow: () => void;
    translate: (word: string) => Promise<{ data: Array<unknown> }>;
    components: Record<string, Component<any>>;
  };
};

const ShiritoriGame: Component<PluginComponentProps> = (props) => {
  const { Btn, Input, Card, Panel, Loader } = props.host.components as {
    Btn: Component<{ variant?: string; onClick?: () => void; children: unknown }>;
    Input: Component<{ value: string; onInput?: (e: Event) => void; onKeyDown?: (e: KeyboardEvent) => void; placeholder?: string; disabled?: boolean }>;
    Card: Component<{ children: unknown; class?: string }>;
    Panel: Component<{ children: unknown; class?: string }>;
    Loader: Component<{ size?: string }>;
  };

  const AlertBanner = (alertProps: { variant: 'error' | 'warning'; children: unknown }) => {
    const bgColor = alertProps.variant === 'error'
      ? 'var(--bg-danger, rgba(231, 76, 60, 0.08))'
      : 'var(--bg-warning, rgba(241, 196, 15, 0.08))';
    const borderColor = alertProps.variant === 'error'
      ? 'var(--border-danger, rgba(231, 76, 60, 0.35))'
      : 'var(--border-warning, rgba(241, 196, 15, 0.35))';
    const textColor = alertProps.variant === 'error'
      ? 'var(--color-error, #e74c3c)'
      : 'var(--color-warning, #f1c40f)';

    return (
      <div style={{
        padding: 'var(--spacing-3, 0.75rem) var(--spacing-4, 1rem)',
        'border-radius': 'var(--radius-md, 8px)',
        'background-color': bgColor,
        border: `1px solid ${borderColor}`,
        color: textColor,
        'font-size': 'var(--font-size-sm, 0.875rem)',
        'font-weight': 'var(--font-weight-medium, 500)',
      }}>
        {alertProps.children}
      </div>
    );
  };

  const [state, setState] = createSignal<GameState>(getInitialState());
  const [inputValue, setInputValue] = createSignal('');
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  let computerTurnInProgress = false;

  const host: HostApi = {
    kvGet: props.host.kvGet,
    kvSet: props.host.kvSet,
    closeWindow: props.host.closeWindow,
    translate: props.host.translate,
  };

  const currentLanguage = props.context.__mlearnLanguage as string | undefined;
  const isJapanese = currentLanguage === 'ja';

  onMount(() => {
    const pluginBaseUrl = (import.meta as unknown as { url: string }).url;
    const cssUrl = pluginBaseUrl.replace(/\.js$/, '.css');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    document.head.appendChild(link);
  });

  createEffect(() => {
    const currentState = state();
    if (
      currentState.currentPlayer === 'computer' &&
      !currentState.gameOver &&
      currentState.lastKana &&
      !computerTurnInProgress
    ) {
      computerTurnInProgress = true;
      setState((prev) => ({ ...prev, computerThinking: true }));

      const timer = setTimeout(() => {
        void processComputerTurn(currentState).then((nextState) => {
          computerTurnInProgress = false;
          setState(nextState);
        });
      }, 150);

      return () => clearTimeout(timer);
    }
  });

  const handleSubmit = async () => {
    const word = inputValue().trim();
    if (!word || isSubmitting() || state().gameOver || state().computerThinking) {
      return;
    }

    setIsSubmitting(true);
    setState((prev) => ({ ...prev, errorMessage: null }));

    const currentState = state();
    const usedWords = new Set(currentState.words.map((w) => normalizeForComparison(w.word)));

    const result = await validateUserWord(word, host, usedWords, currentState.lastKana);

    if (!result.valid) {
      if (result.error === 'Word ends in ん — you lose!') {
        const newWords = [
          ...currentState.words,
          { word, reading: result.reading ?? word, player: 'user' as const },
        ];
        setState({
          ...currentState,
          words: newWords,
          gameOver: true,
          winner: 'computer',
          errorMessage: result.error,
        });
      } else {
        setState((prev) => ({
          ...prev,
          errorMessage: result.error,
        }));
      }
      setIsSubmitting(false);
      return;
    }

    const newWords = [
      ...currentState.words,
      { word, reading: result.reading ?? word, player: 'user' as const },
    ];

    const lastKana = getLastKana(result.reading ?? word);

    setState({
      ...currentState,
      words: newWords,
      currentPlayer: 'computer',
      lastKana,
      errorMessage: null,
    });

    setInputValue('');
    setIsSubmitting(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleRestart = () => {
    computerTurnInProgress = false;
    setState(getInitialState());
    setInputValue('');
    setIsSubmitting(false);
  };

  const getTurnText = () => {
    const s = state();
    if (s.gameOver) {
      if (s.winner === 'user') {
        return 'You win!';
      }
      return 'Computer wins!';
    }
    if (s.computerThinking) {
      return 'Computer is thinking...';
    }
    if (s.currentPlayer === 'user') {
      return s.lastKana ? `Your turn — say a word starting with "${s.lastKana}"` : 'Your turn — say any Japanese noun';
    }
    return "Computer's turn";
  };

  const getPlayerColor = (player: 'user' | 'computer') => {
    return player === 'user' ? 'var(--color-primary, #4a90d9)' : 'var(--color-purple, #9b59b6)';
  };

  return (
    <div class="shiritori-game">
      <Panel>
        <div class="shiritori-game__content">
          <Show when={!isJapanese}>
            <div class="shiritori-game__header">
              <h1 class="shiritori-game__title">
                しりとり
              </h1>
            </div>
            <AlertBanner variant="warning">
              This plugin is only available when Japanese is the active language.
              Please switch to Japanese in the settings to play.
            </AlertBanner>
          </Show>

          <Show when={isJapanese}>
            <div class="shiritori-game__header">
              <h1 class="shiritori-game__title">
                しりとり
              </h1>
              <p class="shiritori-game__description">
                Chain Japanese nouns. The next word must start with the last kana.
                Words ending in ん make you lose. No duplicates allowed.
              </p>
            </div>

          <Show when={state().errorMessage}>
            <AlertBanner variant="error">
              {state().errorMessage}
            </AlertBanner>
          </Show>

          <div class="shiritori-game__turn-indicator">
            <span class="shiritori-game__turn-text">
              {getTurnText()}
            </span>
            <Show when={state().computerThinking}>
              <Loader size="sm" />
            </Show>
          </div>

          <Show when={state().words.length > 0}>
            <Card>
              <div class="shiritori-game__word-chain">
                <For each={state().words}>
                  {(entry, index) => (
                    <div class="shiritori-game__word-entry">
                      <Show when={index() > 0}>
                        <span class="shiritori-game__arrow">→</span>
                      </Show>
                      <div
                        class="shiritori-game__word-card"
                        style={{ 'background-color': getPlayerColor(entry.player) }}
                      >
                        <span>{entry.word}</span>
                        <span class="shiritori-game__word-reading">
                          ({entry.reading})
                        </span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Card>
          </Show>

          <Show when={!state().gameOver}>
            <div class="shiritori-game__input-row">
              <Input
                value={inputValue()}
                onInput={(e: Event) => setInputValue((e.target as HTMLInputElement).value)}
                onKeyDown={handleKeyDown}
                placeholder={state().lastKana ? `Word starting with ${state().lastKana}...` : 'Enter a Japanese noun...'}
                disabled={isSubmitting() || state().computerThinking}
              />
              <Btn
                variant="primary"
                onClick={() => void handleSubmit()}
              >
                Submit
              </Btn>
            </div>
          </Show>

          <Show when={state().gameOver}>
            <div class="shiritori-game__game-over">
              <h2
                class={
                  state().winner === 'user'
                    ? 'shiritori-game__winner-text shiritori-game__winner-text--user'
                    : 'shiritori-game__winner-text shiritori-game__winner-text--computer'
                }
              >
                {state().winner === 'user' ? 'You win!' : 'Computer wins!'}
              </h2>
              <Btn variant="primary" onClick={handleRestart}>
                Play Again
              </Btn>
            </div>
          </Show>
          </Show>
        </div>
      </Panel>
    </div>
  );
};

export default ShiritoriGame;
