/**
 * RoleplayQuickStart
 * A step-by-step wizard that helps users quickly set up a roleplay character
 * by searching a Fandom wiki, extracting character info, and building a persona.
 */

import { Component, createSignal, createMemo, createEffect, Show, For, Match, Switch } from 'solid-js';
import { useLanguage, useLocalization, useSettings } from '../../context';
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
import type { AgentConfig } from '../../../shared/types';
import './RoleplayQuickStart.css';
import { getLocalizedLanguageName } from '../../utils/languageDisplayName';
import { isLLMReady } from '../../services/llmProvider';
import { exploreWikiForStoryContext } from './wikiExplorationAgent';
import {
  buildPersonaFromWiki,
  isValidProgressPoint,
  parseStreamingJSON,
  searchAndExtractCharacter,
  type FandomSearchResult,
  type ParsedLLMFields,
  type WikiExtractedCharacter,
  type WikiResearchResult,
} from '../../services/wikiResearch';

type Step = 'character-name' | 'fandom-url' | 'searching' | 'media-type' | 'progress-point' | 'extracting' | 'review';

interface RoleplayQuickStartProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (config: Partial<AgentConfig>) => void;
}

export const RoleplayQuickStart: Component<RoleplayQuickStartProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { currentLangData } = useLanguage();

  const langName = () => {
    return getLocalizedLanguageName(settings.language, currentLangData(), t, '', settings.uiLanguage);
  };

  const [step, setStep] = createSignal<Step>('character-name');
  const [characterName, setCharacterName] = createSignal('');
  const [fandomUrl, setFandomUrl] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<FandomSearchResult[]>([]);
  const [error, setError] = createSignal('');
  const [mediaTypeOptions, setMediaTypeOptions] = createSignal<string[]>([]);
  const [selectedMediaType, setSelectedMediaType] = createSignal('');
  const [progressPoint, setProgressPoint] = createSignal('');
  const [extracted, setExtracted] = createSignal<WikiExtractedCharacter | null>(null);
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

  const applyResearchResult = (result: WikiResearchResult) => {
    if (!result.extracted) return;
    setSearchResults(result.searchResults);
    setStoryPageTitle(result.storyPageTitle);
    setStoryContext(result.extracted.storyContext);
    setMediaTypeOptions(result.mediaTypeOptions);
    setSelectedMediaType(result.selectedMediaType);
    setExtracted(result.extracted);
    setStep('media-type');
  };

  /** Search Fandom wiki for the character */
  const searchFandom = async () => {
      setError('');
      setStep('searching');
  
      const result = await searchAndExtractCharacter(fandomUrl(), characterName(), '');
      if ('error' in result) {
        setError(result.error === 'No results found.' ? t('mlearn.ConversationAgent.QuickStart.NoResults') : result.error);
        setStep('fandom-url');
        return;
      }
  
      setSearchResults(result.searchResults);
      if (!result.extracted) {
        setStep('fandom-url');
        return;
      }
      applyResearchResult(result);
    };

  /** Select a character page and extract initial data */
  const selectCharacterPage = async (page: FandomSearchResult) => {
      setStep('searching');
      setError('');
  
      const result = await searchAndExtractCharacter(fandomUrl(), page, selectedMediaType());
      if ('error' in result) {
        setError(result.error);
        setStep('fandom-url');
        return;
      }
      applyResearchResult(result);
    };

  /** Use LLM to build the final persona card from the extracted data */
  const buildPersona = async () => {
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
  
      const result = await buildPersonaFromWiki({
      extracted: { ...ext, storyContext: ext.storyContext || storyContext() },
        storyPageTitle: storyPageTitle(),
        progressPoint: pp,
        mediaType: selectedMediaType(),
        languageName: langName(),
      }, {
      canExploreWiki: isLLMReady(settings),
      devMode: settings.devMode,
      exploreWikiForStoryContext,
      }, (progress) => {
        switch (progress.phase) {
          case 'fetching-chapters':
            setLlmProgress(t('mlearn.ConversationAgent.QuickStart.FetchingChapters'));
            break;
          case 'chapter-progress':
          case 'stream':
            setLlmProgress(progress.message || '');
            break;
          case 'exploring-wiki':
            setLlmProgress(t('mlearn.ConversationAgent.QuickStart.ExploringWiki'));
            break;
          case 'wiki-exploration':
            setLlmProgress(t('mlearn.ConversationAgent.QuickStart.ExploringWikiDetail', { detail: progress.message || '' }));
            break;
        }
      });
  
      if ('error' in result) {
        setStep('review');
        return;
      }
      if (result.storyPageTitle && !storyPageTitle()) setStoryPageTitle(result.storyPageTitle);
      setExtracted({ ...ext, lore: result.lore, quotes: result.quotes, storyContext: result.context });
      setStep('review');
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
