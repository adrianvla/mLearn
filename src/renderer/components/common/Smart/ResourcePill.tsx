import { Component, Match, Switch, createEffect, createMemo, createSignal } from 'solid-js';
import { useFlashcards, useLocalization, useSettings } from '../../../context';
import type { WordStatus } from '../../subtitle/wordHoverHelpers';
import type { AnkiCardFields, AnkiCardSchedulingInfo } from '../AnkiHoverPreview';
import { FlashcardHoverPreview } from '../FlashcardHoverPreview';
import { PillBtn } from '../Button';
import { ClockIcon } from '../Misc';
import { EasePill } from './EasePill';
import { getLogger } from '../../../../shared/utils/logger';

const log = getLogger("renderer.components.resourcePill");

const ICON_CROSS2 = 'cross2';
const ICON_ANKI = 'anki';

export interface ResourcePillProps {
  word: string;
  isTracked: boolean;
  isAdding: boolean;
  isInAnki: boolean;
  ankiWord?: string | null;
  ease?: number;
  effectiveStatus: WordStatus;
  onAdd: (event?: MouseEvent) => void;
}

export const ResourcePill: Component<ResourcePillProps> = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();
  const { getCardByWordSync } = useFlashcards();
  const builtInCard = createMemo(() => getCardByWordSync(props.word));
  const [ankiHoverCard, setAnkiHoverCard] = createSignal<AnkiCardFields | null>(null);
  const [ankiHoverCardInfo, setAnkiHoverCardInfo] = createSignal<AnkiCardSchedulingInfo | null>(null);
  const [ankiHoverLoading, setAnkiHoverLoading] = createSignal(false);
  let ankiHoverFetched = false;
  let previousAnkiWord = '';

  createEffect(() => {
    props.word;
    props.ankiWord;
    props.isInAnki;
    ankiHoverFetched = false;
    previousAnkiWord = '';
    setAnkiHoverCard(null);
    setAnkiHoverCardInfo(null);
    setAnkiHoverLoading(false);
  });

  const fetchAnkiCardForHover = async () => {
    if (!props.isInAnki) {
      return;
    }

    const word = props.ankiWord ?? props.word;
    if (!word || (ankiHoverFetched && previousAnkiWord === word)) {
      return;
    }

    ankiHoverFetched = true;
    previousAnkiWord = word;
    setAnkiHoverLoading(true);

    try {
      const { getBackend } = await import('../../../../shared/backends');
      const result = await getBackend().getCard({ word }) as {
        cards: Array<{
          fields: AnkiCardFields;
          factor?: number;
          due?: number;
          queue?: number;
          type?: number;
          interval?: number;
          mod?: number;
        }>;
        error: boolean;
        poor: boolean;
      };

      if (!result.error && result.cards.length > 0) {
        const card = result.cards[0];
        setAnkiHoverCard(card.fields || null);
        setAnkiHoverCardInfo({
          ease: card.factor ?? null,
          due: card.due ?? null,
          queue: card.queue ?? null,
          type: card.type ?? null,
          interval: card.interval ?? null,
          mod: card.mod ?? null,
        });
      } else {
        setAnkiHoverCard(null);
        setAnkiHoverCardInfo(null);
      }
    } catch (error) {
      log.error("error", error);
      setAnkiHoverCard(null);
      setAnkiHoverCardInfo(null);
    } finally {
      setAnkiHoverLoading(false);
    }
  };

  const handleTooltipShow = () => {
    if (!settings.use_anki || !props.isInAnki) {
      return;
    }

    void fetchAnkiCardForHover();
  };

  const addActionUsesAnki = createMemo(() => settings.use_anki && !settings.enable_flashcard_creation);

  return (
    <Switch>
      <Match when={props.isAdding}>
        <PillBtn
          variant="yellow"
          icon={<ClockIcon size={14} />}
          label={t('mlearn.Global.Status.Adding')}
          disabled={true}
        />
      </Match>
      <Match when={props.isTracked}>
        <EasePill
          ease={props.ease}
          isInAnki={props.isInAnki}
          effectiveStatus={props.effectiveStatus}
          ankiHoverLoading={ankiHoverLoading()}
          ankiHoverCard={ankiHoverCard()}
          ankiHoverCardInfo={ankiHoverCardInfo()}
          builtInCard={builtInCard()}
          onTooltipShow={handleTooltipShow}
        />
      </Match>
      <Match when={props.isInAnki}>
        <FlashcardHoverPreview
          builtInCard={builtInCard()}
          ankiLoading={ankiHoverLoading()}
          ankiFields={ankiHoverCard()}
          ankiCardInfo={ankiHoverCardInfo()}
          footer={<div class="anki-hover-preview__footer">{t('mlearn.WordHover.AddToBuiltInSrs')}</div>}
          onShow={handleTooltipShow}
        >
          <span onClick={(event: MouseEvent) => props.onAdd(event)}>
            <PillBtn
              variant="blue"
              icon={ICON_ANKI}
              label={t('mlearn.WordHover.InAnki')}
            />
          </span>
        </FlashcardHoverPreview>
      </Match>
      <Match when={true}>
        <PillBtn
          variant="blue"
          icon={addActionUsesAnki() ? ICON_ANKI : ICON_CROSS2}
          iconRotation={addActionUsesAnki() ? undefined : 45}
          label={addActionUsesAnki() ? t('mlearn.WordHover.AddToAnki') : t('mlearn.Global.Flashcard')}
          onClick={props.onAdd}
        />
      </Match>
    </Switch>
  );
};
