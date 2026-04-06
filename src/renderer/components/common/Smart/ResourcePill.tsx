import { Component, createEffect, createSignal } from 'solid-js';
import { useLocalization, useSettings } from '../../../context';
import type { WordStatus } from '../../subtitle/wordHoverHelpers';
import type { AnkiCardFields, AnkiCardSchedulingInfo } from '../AnkiHoverPreview';
import { AnkiHoverPreview } from '../AnkiHoverPreview';
import { PillBtn } from '../Button';
import { ClockIcon } from '../Misc';
import { Tooltip } from '../Tooltip';
import { EasePill } from './EasePill';

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

      if (!result.error && !result.poor && result.cards.length > 0) {
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
      console.error(error);
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

  if (props.isAdding) {
    return (
      <PillBtn
        variant="yellow"
        icon={<ClockIcon size={14} />}
        label={t('mlearn.Global.Status.Adding')}
        disabled={true}
      />
    );
  }

  if (props.isTracked) {
    return (
      <EasePill
        ease={props.ease}
        isInAnki={props.isInAnki}
        effectiveStatus={props.effectiveStatus}
        ankiHoverLoading={ankiHoverLoading()}
        ankiHoverCard={ankiHoverCard()}
        ankiHoverCardInfo={ankiHoverCardInfo()}
        onTooltipShow={handleTooltipShow}
      />
    );
  }

  if (props.isInAnki) {
    return (
      <Tooltip
        content={
          <AnkiHoverPreview
            loading={ankiHoverLoading()}
            fields={ankiHoverCard()}
            cardInfo={ankiHoverCardInfo()}
            footer={<div class="anki-hover-preview__footer">{t('mlearn.WordHover.AddToBuiltInSrs')}</div>}
          />
        }
        onShow={handleTooltipShow}
      >
        <span onClick={(event: MouseEvent) => props.onAdd(event)}>
          <PillBtn
            variant="blue"
            icon={ICON_ANKI}
            label={t('mlearn.WordHover.InAnki')}
          />
        </span>
      </Tooltip>
    );
  }

  return (
    <PillBtn
      variant="blue"
      icon={settings.use_anki && !settings.enable_flashcard_creation ? ICON_ANKI : ICON_CROSS2}
      iconRotation={settings.use_anki && !settings.enable_flashcard_creation ? undefined : 45}
      label={settings.use_anki && !settings.enable_flashcard_creation ? t('mlearn.WordHover.AddToAnki') : t('mlearn.Global.Flashcard')}
      onClick={props.onAdd}
    />
  );
};
