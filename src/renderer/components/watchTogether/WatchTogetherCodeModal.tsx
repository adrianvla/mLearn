import { Component, Show, createEffect, createSignal } from 'solid-js';
import { useLocalization } from '../../context';
import type { WatchTogetherRoomSession } from '../../services/watchTogetherRoomService';
import { Btn, HintText, Input, Modal, Panel } from '../common';
import './WatchTogetherCodeModal.css';

export interface WatchTogetherCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSignedIn: boolean;
  canHost: boolean;
  currentSession: WatchTogetherRoomSession | null;
  isBusy?: boolean;
  error?: string;
  onCreateRoom: () => void;
  onJoinRoom: (roomCode: string) => void;
  onCopyRoomCode: () => void;
  onDisconnect: () => void;
  onOpenSignIn: () => void;
}

type CodeModalTab = 'host' | 'join';

export const WatchTogetherCodeModal: Component<WatchTogetherCodeModalProps> = (props) => {
  const { t } = useLocalization();
  const [activeTab, setActiveTab] = createSignal<CodeModalTab>('host');
  const [joinCode, setJoinCode] = createSignal('');

  createEffect(() => {
    if (!props.isOpen) {
      setActiveTab('host');
      setJoinCode('');
      return;
    }

    const session = props.currentSession;
    if (!session) return;

    setActiveTab(session.role === 'owner' ? 'host' : 'join');
    setJoinCode(session.room.roomCode);
  });

  const handleJoin = () => {
    const roomCode = joinCode().trim();
    if (!roomCode) return;
    props.onJoinRoom(roomCode);
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.WatchTogether.Code.Title')}
      subtitle={t('mlearn.WatchTogether.Code.Subtitle')}
      size="md"
    >
      <div class="watch-together-code-modal">
        <Show when={props.currentSession} fallback={
          <>
            <Show when={props.isSignedIn} fallback={
              <Panel variant="solid" rounded="lg" padding="lg" class="watch-together-code-panel">
                <div class="watch-together-code-panel-copy">
                  <h3>{t('mlearn.WatchTogether.Code.SignInRequiredTitle')}</h3>
                  <p>{t('mlearn.WatchTogether.Code.SignInRequiredMessage')}</p>
                </div>
                <Btn variant="primary" onClick={props.onOpenSignIn}>
                  {t('mlearn.Connection.SignIn')}
                </Btn>
              </Panel>
            }>
              <div class="watch-together-code-tabs" role="tablist" aria-label={t('mlearn.WatchTogether.Code.TabAriaLabel')}>
                <button
                  type="button"
                  class={`watch-together-code-tab ${activeTab() === 'host' ? 'active' : ''}`}
                  onClick={() => setActiveTab('host')}
                >
                  {t('mlearn.WatchTogether.Code.HostTab')}
                </button>
                <button
                  type="button"
                  class={`watch-together-code-tab ${activeTab() === 'join' ? 'active' : ''}`}
                  onClick={() => setActiveTab('join')}
                >
                  {t('mlearn.WatchTogether.Code.JoinTab')}
                </button>
              </div>

              <Show when={activeTab() === 'host'}>
                <Panel variant="solid" rounded="lg" padding="lg" class="watch-together-code-panel">
                  <div class="watch-together-code-panel-copy">
                    <h3>{t('mlearn.WatchTogether.Code.HostTitle')}</h3>
                    <p>{t('mlearn.WatchTogether.Code.HostDescription')}</p>
                    <Show when={!props.canHost}>
                      <HintText>{t('mlearn.WatchTogether.Code.HostDisabled')}</HintText>
                    </Show>
                  </div>
                  <Btn variant="primary" onClick={props.onCreateRoom} disabled={!props.canHost} loading={props.isBusy}>
                    {t('mlearn.WatchTogether.Code.CreateAction')}
                  </Btn>
                </Panel>
              </Show>

              <Show when={activeTab() === 'join'}>
                <Panel variant="solid" rounded="lg" padding="lg" class="watch-together-code-panel watch-together-code-join-panel">
                  <div class="watch-together-code-panel-copy">
                    <h3>{t('mlearn.WatchTogether.Code.JoinTitle')}</h3>
                    <p>{t('mlearn.WatchTogether.Code.JoinDescription')}</p>
                  </div>
                  <div class="watch-together-code-join-controls">
                    <Input
                      value={joinCode()}
                      onInput={(event) => setJoinCode(event.currentTarget.value)}
                      placeholder={t('mlearn.WatchTogether.Code.RoomCodePlaceholder')}
                      fullWidth
                    />
                    <Btn variant="primary" onClick={handleJoin} disabled={!joinCode().trim()} loading={props.isBusy}>
                      {t('mlearn.WatchTogether.Code.JoinAction')}
                    </Btn>
                  </div>
                </Panel>
              </Show>
            </Show>
          </>
        }>
          {(session) => (
            <Panel variant="solid" rounded="lg" padding="lg" class="watch-together-code-panel">
              <div class="watch-together-code-panel-copy">
                <h3>
                  {session().role === 'owner'
                    ? t('mlearn.WatchTogether.Code.ActiveOwnerTitle')
                    : t('mlearn.WatchTogether.Code.ActiveViewerTitle')}
                </h3>
                <p>
                  {session().role === 'owner'
                    ? t('mlearn.WatchTogether.Code.ActiveOwnerDescription')
                    : t('mlearn.WatchTogether.Code.ActiveViewerDescription')}
                </p>
              </div>

              <div class="watch-together-code-room-code-block">
                <span class="watch-together-code-room-code-label">{t('mlearn.WatchTogether.Code.RoomCodeLabel')}</span>
                <strong class="watch-together-code-room-code-value">{session().room.roomCode}</strong>
              </div>

              <div class="watch-together-code-room-actions">
                <Show when={session().role === 'owner'}>
                  <Btn variant="secondary" onClick={props.onCopyRoomCode}>
                    {t('mlearn.WatchTogether.Code.CopyCodeAction')}
                  </Btn>
                </Show>
                <Btn variant="primary" onClick={props.onDisconnect}>
                  {t('mlearn.WatchTogether.Code.DisconnectAction')}
                </Btn>
              </div>
            </Panel>
          )}
        </Show>

        <Show when={props.error}>
          <div class="watch-together-code-error">{props.error}</div>
        </Show>
      </div>
    </Modal>
  );
};