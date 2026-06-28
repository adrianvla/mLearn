import { Component, Show, JSX, createMemo, splitProps } from 'solid-js';
import { useLocalization } from '../../../context';
import { dueDateToString } from '../../../services/srsAlgorithm';
import { Tooltip } from '../Tooltip';
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
      <Show when={props.loading}>
        <span class="anki-hover-preview__loading">{t('mlearn.Global.Loading')}</span>
      </Show>
      <Show when={!props.loading && props.fields}>
        {(fields) => (
          <>
            <div class="anki-hover-preview__fields">
              <Show when={fields().Expression}>
                <div class="anki-hover-preview__field">
                  <span class="anki-hover-preview__label">Expression</span>
                  <span class="anki-hover-preview__value" innerHTML={fields().Expression!.value} />
                </div>
              </Show>
              <Show when={fields().Reading}>
                <div class="anki-hover-preview__field">
                  <span class="anki-hover-preview__label">Reading</span>
                  <span class="anki-hover-preview__value" innerHTML={fields().Reading!.value} />
                </div>
              </Show>
              <Show when={fields().Meaning}>
                <div class="anki-hover-preview__field">
                  <span class="anki-hover-preview__label">Meaning</span>
                  <span class="anki-hover-preview__value" innerHTML={fields().Meaning!.value} />
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
        <span class="anki-hover-preview__loading">{t('mlearn.WordDbEditor.Anki.NoCardFound')}</span>
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
