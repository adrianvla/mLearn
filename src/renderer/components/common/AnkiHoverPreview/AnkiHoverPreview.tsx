import { Component, Show, JSX } from 'solid-js';
import { useLocalization } from '../../../context';
import './AnkiHoverPreview.css';

export interface AnkiCardFields {
  Expression?: { value: string; order: number };
  Reading?: { value: string; order: number };
  Meaning?: { value: string; order: number };
  [key: string]: { value: string; order: number } | undefined;
}

export interface AnkiHoverPreviewProps {
  loading: boolean;
  fields: AnkiCardFields | null;
  footer?: JSX.Element;
}

export const AnkiHoverPreview: Component<AnkiHoverPreviewProps> = (props) => {
  const { t } = useLocalization();

  return (
    <div class="anki-hover-preview">
      <Show when={props.loading}>
        <span class="anki-hover-preview__loading">{t('mlearn.Global.Loading')}</span>
      </Show>
      <Show when={!props.loading && props.fields}>
        {(fields) => (
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
