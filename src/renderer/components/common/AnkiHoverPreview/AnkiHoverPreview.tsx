import { Component, Show, JSX, createMemo, splitProps } from 'solid-js';
import { useLocalization } from '../../../context';
import { dueDateToString } from '../../../services/srsAlgorithm';
import { Tooltip } from '../Tooltip';
import { SafeHtml } from '../SafeHtml/SafeHtml';
import { SkeletonText } from '../Skeleton';
import { getAnkiDueDisplayValue, shouldShowAnkiEase, type AnkiCardSchedulingInfo } from './ankiHoverPreviewLogic';
import './AnkiHoverPreview.css';

export interface AnkiCardFields {
  Expression?: { value: string; order: number };
  Reading?: { value: string; order: number };
  Meaning?: { value: string; order: number };
  [key: string]: { value: string; order: number } | undefined;
}

export interface AnkiHoverPreviewContentProps {
  loading: boolean;
  fields: AnkiCardFields | null;
  cardInfo?: AnkiCardSchedulingInfo | null;
  footer?: JSX.Element;
}

export interface AnkiHoverPreviewProps extends AnkiHoverPreviewContentProps {
  children: JSX.Element;
  onShow?: () => void;
  position?: 'top' | 'bottom';
  class?: string;
}

export const AnkiHoverPreviewContent: Component<AnkiHoverPreviewContentProps> = (props) => {
  const { t } = useLocalization();
  const dueValue = createMemo(() => getAnkiDueDisplayValue(
    props.cardInfo,
    (timestamp) => dueDateToString(timestamp, t),
    t('mlearn.Flashcards.Card.Unseen'),
  ));

  return (
    <div class="anki-hover-preview">
      {/* Loading state: hold the preview's shape instead of a text label. */}
      <Show when={props.loading}>
        <span class="anki-hover-preview__loading" aria-busy="true"><SkeletonText lines={2} /></span>
      </Show>
      <Show when={!props.loading && props.fields}>
        {(fields) => (
          <>
            <div class="anki-hover-preview__fields">
              <Show when={fields().Expression}>
                <div class="anki-hover-preview__field">
                  <span class="anki-hover-preview__label">Expression</span>
                  <SafeHtml tag="span" class="anki-hover-preview__value" html={fields().Expression!.value} />
                </div>
              </Show>
              <Show when={fields().Reading}>
                <div class="anki-hover-preview__field">
                  <span class="anki-hover-preview__label">Reading</span>
                  <SafeHtml tag="span" class="anki-hover-preview__value" html={fields().Reading!.value} />
                </div>
              </Show>
              <Show when={fields().Meaning}>
                <div class="anki-hover-preview__field">
                  <span class="anki-hover-preview__label">Meaning</span>
                  <SafeHtml tag="span" class="anki-hover-preview__value" html={fields().Meaning!.value} />
                </div>
              </Show>
            </div>
            <Show when={shouldShowAnkiEase(props.cardInfo?.ease) || dueValue()}>
              <div class="anki-hover-preview__footer">
                <Show when={shouldShowAnkiEase(props.cardInfo?.ease)}>
                  <div class="anki-hover-preview__footer-field">
                    <span class="anki-hover-preview__label">{t('mlearn.Flashcards.Card.Ease')}</span>
                    <span class="anki-hover-preview__value">{props.cardInfo!.ease}</span>
                  </div>
                </Show>
                <Show when={dueValue()}>
                  <div class="anki-hover-preview__footer-field">
                    <span class="anki-hover-preview__label">{t('mlearn.Flashcards.Card.Due')}</span>
                    <span class="anki-hover-preview__value">{dueValue()!}</span>
                  </div>
                </Show>
              </div>
            </Show>
          </>
        )}
      </Show>
      <Show when={!props.loading && !props.fields}>
        <span class="anki-hover-preview__empty">{t('mlearn.WordDbEditor.Anki.NoCardFound')}</span>
      </Show>
      <Show when={props.footer}>
        {props.footer}
      </Show>
    </div>
  );
};

export const AnkiHoverPreview: Component<AnkiHoverPreviewProps> = (props) => {
  const [local, contentProps] = splitProps(props, ['children', 'onShow', 'position', 'class']);

  return (
    <Tooltip
      content={<AnkiHoverPreviewContent {...contentProps} />}
      onShow={local.onShow}
      position={local.position}
    >
      <span class={local.class}>{local.children}</span>
    </Tooltip>
  );
};

export type { AnkiCardSchedulingInfo } from './ankiHoverPreviewLogic';
