import { Component, Show, createSignal } from 'solid-js';
import { useLocalization } from '../../context';
import { Btn, Modal, Panel, ProgressBar } from '../common';
import './MediaDistributionModal.css';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface MediaDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectedPeerCount: number;
  isSending: boolean;
  sendProgress: number;
  sendComplete: boolean;
  onStartDistribution: (file: Blob, fileName: string, subtitleContent: string | null) => void;
  onCancel: () => void;
  videoSrc: string;
  subtitleContent: string | null;
}

export const MediaDistributionModal: Component<MediaDistributionModalProps> = (props) => {
  const { t } = useLocalization();
  const [selectedFile, setSelectedFile] = createSignal<File | null>(null);
  const [loadingFile, setLoadingFile] = createSignal(false);

  let fileInputRef: HTMLInputElement | undefined;

  const handleFileSelect = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    setSelectedFile(file);
  };

  const handleStartDistribution = async () => {
    const file = selectedFile();
    if (!file) return;

    setLoadingFile(true);
    try {
      props.onStartDistribution(file, file.name, props.subtitleContent);
    } finally {
      setLoadingFile(false);
    }
  };

  const progressPercent = () => Math.round(props.sendProgress * 100);

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.WatchTogether.Media.DistributeTitle')}
      subtitle={t('mlearn.WatchTogether.Media.DistributeSubtitle')}
      size="md"
    >
      <div class="media-distribution-modal">
        <Show when={!props.isSending && !props.sendComplete}>
          <Panel variant="solid" rounded="lg" padding="lg">
            <div class="media-distribution-info">
              <span class="media-distribution-info-label">
                {t('mlearn.WatchTogether.Media.SelectFile')}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,audio/*,.mkv,.srt,.vtt,.ass"
                onChange={handleFileSelect}
              />
            </div>
          </Panel>

          <Show when={selectedFile()}>
            <Panel variant="solid" rounded="lg" padding="lg">
              <div class="media-distribution-stats">
                <div class="media-distribution-stat">
                  <span class="media-distribution-stat-label">
                    {t('mlearn.WatchTogether.Media.FileName')}
                  </span>
                  <span class="media-distribution-stat-value">
                    {selectedFile()!.name}
                  </span>
                </div>
                <div class="media-distribution-stat">
                  <span class="media-distribution-stat-label">
                    {t('mlearn.WatchTogether.Media.FileSize')}
                  </span>
                  <span class="media-distribution-stat-value">
                    {formatFileSize(selectedFile()!.size)}
                  </span>
                </div>
              </div>
            </Panel>
          </Show>

          <Panel variant="solid" rounded="lg" padding="lg">
            <div class="media-distribution-stats">
              <div class="media-distribution-stat">
                <span class="media-distribution-stat-label">
                  {t('mlearn.WatchTogether.Media.ConnectedPeers')}
                </span>
                <span class="media-distribution-stat-value">
                  {props.connectedPeerCount}
                </span>
              </div>
              <Show when={props.subtitleContent}>
                <div class="media-distribution-stat">
                  <span class="media-distribution-stat-label">
                    {t('mlearn.WatchTogether.Media.SubtitlesIncluded')}
                  </span>
                  <span class="media-distribution-stat-value">
                    {t('mlearn.Global.Yes')}
                  </span>
                </div>
              </Show>
            </div>
          </Panel>

          <div class="media-distribution-actions">
            <Btn variant="secondary" onClick={props.onClose}>
              {t('mlearn.Global.Cancel')}
            </Btn>
            <Btn
              variant="primary"
              onClick={handleStartDistribution}
              disabled={!selectedFile() || props.connectedPeerCount === 0}
              loading={loadingFile()}
            >
              {t('mlearn.WatchTogether.Media.StartDistribution')}
            </Btn>
          </div>
        </Show>

        <Show when={props.isSending}>
          <Panel variant="solid" rounded="lg" padding="lg">
            <div class="media-distribution-info">
              <span class="media-distribution-info-label">
                {t('mlearn.WatchTogether.Media.Sending')}
              </span>
              <ProgressBar value={progressPercent()} showPercent variant="primary" animated />
            </div>
          </Panel>

          <div class="media-distribution-actions">
            <Btn variant="secondary" onClick={props.onCancel}>
              {t('mlearn.Global.Cancel')}
            </Btn>
          </div>
        </Show>

        <Show when={props.sendComplete}>
          <Panel variant="solid" rounded="lg" padding="lg">
            <div class="media-distribution-info">
              <span class="media-distribution-info-value">
                {t('mlearn.WatchTogether.Media.DistributionComplete')}
              </span>
            </div>
          </Panel>

          <div class="media-distribution-actions">
            <Btn variant="primary" onClick={props.onClose}>
              {t('mlearn.Global.Close')}
            </Btn>
          </div>
        </Show>
      </div>
    </Modal>
  );
};
