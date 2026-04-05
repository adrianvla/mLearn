import { Component, Show } from 'solid-js';
import { useLocalization } from '../../context';
import type { MediaTransferMetadata } from '../../services/mediaDistributionService';
import { Btn, Modal, Panel, ProgressBar } from '../common';
import './MediaReceiveModal.css';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface MediaReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pending offer waiting for user decision. */
  offerMeta: MediaTransferMetadata | null;
  /** Whether we've accepted and are actively receiving. */
  isReceiving: boolean;
  /** Receive progress 0–1. */
  receiveProgress: number;
  /** Received file result — null until complete. */
  receiveResult: { file: Blob; meta: MediaTransferMetadata } | null;
  onAccept: () => void;
  onReject: () => void;
  onLoadReceived: (file: Blob, meta: MediaTransferMetadata) => void;
  onDismiss: () => void;
}

export const MediaReceiveModal: Component<MediaReceiveModalProps> = (props) => {
  const { t } = useLocalization();

  const progressPercent = () => Math.round(props.receiveProgress * 100);

  const handleLoad = () => {
    const result = props.receiveResult;
    if (!result) return;
    props.onLoadReceived(result.file, result.meta);
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.WatchTogether.Media.ReceiveTitle')}
      size="md"
    >
      <div class="media-receive-modal">
        {/* Pending offer: accept or reject */}
        <Show when={props.offerMeta && !props.isReceiving && !props.receiveResult}>
          <Panel variant="solid" rounded="lg" padding="lg">
            <div class="media-receive-info">
              <span class="media-receive-info-label">
                {t('mlearn.WatchTogether.Media.ReceivePrompt')}
              </span>
            </div>

            <div class="media-receive-stats">
              <div class="media-receive-stat">
                <span class="media-receive-stat-label">
                  {t('mlearn.WatchTogether.Media.FileName')}
                </span>
                <span class="media-receive-stat-value">
                  {props.offerMeta!.fileName}
                </span>
              </div>
              <div class="media-receive-stat">
                <span class="media-receive-stat-label">
                  {t('mlearn.WatchTogether.Media.FileSize')}
                </span>
                <span class="media-receive-stat-value">
                  {formatFileSize(props.offerMeta!.fileSize)}
                </span>
              </div>
            </div>

            <Show when={props.offerMeta!.subtitleContent}>
              <div class="media-receive-info">
                <span class="media-receive-info-label">
                  {t('mlearn.WatchTogether.Media.SubtitlesIncluded')}
                </span>
              </div>
            </Show>
          </Panel>

          <div class="media-receive-actions">
            <Btn variant="secondary" onClick={props.onReject}>
              {t('mlearn.Global.Decline')}
            </Btn>
            <Btn variant="primary" onClick={props.onAccept}>
              {t('mlearn.Global.Accept')}
            </Btn>
          </div>
        </Show>

        {/* Receiving in progress */}
        <Show when={props.isReceiving}>
          <Panel variant="solid" rounded="lg" padding="lg">
            <div class="media-receive-info">
              <span class="media-receive-info-label">
                {t('mlearn.WatchTogether.Media.Receiving')}
              </span>
              <ProgressBar value={progressPercent()} showPercent variant="primary" animated />
            </div>
          </Panel>
        </Show>

        {/* Receive complete */}
        <Show when={props.receiveResult}>
          <Panel variant="solid" rounded="lg" padding="lg">
            <div class="media-receive-info">
              <span class="media-receive-info-value">
                {t('mlearn.WatchTogether.Media.ReceiveComplete')}
              </span>
              <span class="media-receive-info-label">
                {props.receiveResult!.meta.fileName} — {formatFileSize(props.receiveResult!.meta.fileSize)}
              </span>
            </div>
          </Panel>

          <div class="media-receive-actions">
            <Btn variant="secondary" onClick={props.onDismiss}>
              {t('mlearn.Global.Close')}
            </Btn>
            <Btn variant="primary" onClick={handleLoad}>
              {t('mlearn.WatchTogether.Media.LoadMedia')}
            </Btn>
          </div>
        </Show>
      </div>
    </Modal>
  );
};
