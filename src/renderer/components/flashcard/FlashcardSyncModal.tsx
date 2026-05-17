import { Component, createSignal, Show, onCleanup, createEffect } from 'solid-js';
import { Modal, Btn, ProgressBar, Spinner, CheckIcon, CrossIcon } from '../../components/common';
import { useFlashcards, useLocalization, useSettings } from '../../context';
import { getBridge } from '../../../shared/bridges';
import {
  mergeFlashcards,
  createSyncRoom,
  SyncSocketClient,
  splitTextIntoChunks,
  stripMediaUrls,
  type FlashcardStore,
  type SyncSocketMessage,
} from '../../services/flashcardSyncService';
import './FlashcardSyncModal.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.flashcardSyncModal");

interface QRCodeRenderer {
  toCanvas: (
    canvas: HTMLCanvasElement,
    text: string,
    options: {
      width: number;
      margin: number;
      color: {
        dark: string;
        light: string;
      };
    },
  ) => Promise<void>;
}

let QRCodeLib: QRCodeRenderer | null = null;

export interface FlashcardSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SyncPhase = 'init' | 'showing-qr' | 'connecting' | 'syncing' | 'complete' | 'error';
type SyncRole = 'sender' | 'receiver' | null;

export const FlashcardSyncModal: Component<FlashcardSyncModalProps> = (props) => {
  const { store } = useFlashcards();
  const { t } = useLocalization();
  const { settings } = useSettings();
  
  const [phase, setPhase] = createSignal<SyncPhase>('init');
  const [statusText, setStatusText] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [role, setRole] = createSignal<SyncRole>(null);
  
  let socketClient: SyncSocketClient | null = null;
  let qrCodeEl: HTMLDivElement | undefined;

  let chunksToSend: string[] = [];
  let receivedChunks: Record<number, string> = {};
  let totalChunksExpected = 0;
  let ackedChunkCount = 0;
  let syncCompleted = false;

  const getThemeColor = (variableName: string): string =>
    getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();

  createEffect(async () => {
    if (!props.isOpen) return;
    
    try {
      setPhase('init');
      setStatusText(t('mlearn.Flashcards.Sync.LoadingLibraries'));
      
      if (!QRCodeLib) {
        const module = await import('qrcode');
        QRCodeLib = (module.default || module) as QRCodeRenderer;
      }
      
      await startAsSender();
    } catch (e) {
      log.error('Failed to load sync libraries:', e);
      setError(t('mlearn.Flashcards.Sync.Error.LoadLibraries', { error: e instanceof Error ? e.message : String(e) }));
      setPhase('error');
    }
  });

  onCleanup(() => {
    cleanup();
  });

  const cleanup = () => {
    if (socketClient) {
      socketClient.disconnect();
      socketClient = null;
    }
    chunksToSend = [];
    receivedChunks = {};
    totalChunksExpected = 0;
    ackedChunkCount = 0;
    syncCompleted = false;
  };

  const getAccessToken = (): string | null => {
    const token = settings.cloudAuthAccessToken?.trim();
    if (!token) {
      return null;
    }
    return token;
  };

  const startAsSender = async () => {
    try {
      const accessToken = getAccessToken();
      if (!accessToken) {
        setError(t('mlearn.Flashcards.Sync.Error.AuthRequired'));
        setPhase('error');
        return;
      }

      cleanup();
      setRole('sender');
      setPhase('showing-qr');
      setStatusText(t('mlearn.Flashcards.Sync.GeneratingCode'));
      
      const response = await createSyncRoom(accessToken);
      const room = response.data;
      
      log.info('Created sync room:', room.roomId);

      displayRoomQR(room.roomId, room.roomCode);
      setStatusText(t('mlearn.Flashcards.Sync.QRHint'));
      
      socketClient = new SyncSocketClient(room.roomId, 'sender', accessToken);
      setupSocketHandlers();
      await socketClient.connect();
    } catch (e) {
      log.error('Sync connection failed:', e);
      setError(e instanceof Error ? e.message : t('mlearn.Flashcards.Sync.Error.Connection'));
      setPhase('error');
    }
  };

  const setupSocketHandlers = () => {
    if (!socketClient) return;
    
    socketClient.onOpen(() => {
      log.info('Socket connected as', role());
    });
    
    socketClient.onMessage((msg: SyncSocketMessage) => {
      handleSocketMessage(msg);
    });
    
    socketClient.onClose(() => {
      log.info('Socket closed');
    });
    
    socketClient.onError((err: string) => {
      log.error('Socket error:', err);
      setError(err);
      setPhase('error');
    });
  };

  const handleSocketMessage = async (msg: SyncSocketMessage) => {
    const currentRole = role();
    
    switch (msg.type) {
      case 'peer_connected': {
        if (currentRole === 'sender' && !msg.message) {
          setPhase('syncing');
          setStatusText(t('mlearn.Flashcards.Sync.ConnectedSyncing'));
          await sendOffer();
        }
        break;
      }
      
      case 'offer': {
        if (currentRole === 'receiver') {
          setPhase('syncing');
          setStatusText(t('mlearn.Flashcards.Sync.ConnectedSyncing'));
          totalChunksExpected = msg.totalChunks || 0;
          requestNextChunk(0);
        }
        break;
      }
      
      case 'request_chunk': {
        if (currentRole === 'sender' && msg.index !== undefined) {
          await sendChunk(msg.index);
        }
        break;
      }
      
      case 'chunk_data': {
        if (currentRole === 'receiver' && msg.index !== undefined && msg.data) {
          receivedChunks[msg.index] = msg.data;
          const current = Object.keys(receivedChunks).length;
          setProgress((current / totalChunksExpected) * 100);
          
          socketClient?.send({ type: 'chunk_received', index: msg.index });
          
          if (current < totalChunksExpected) {
            requestNextChunk(current);
          } else {
            completeReceive();
          }
        }
        break;
      }
      
      case 'chunk_received': {
        if (currentRole === 'sender') {
          ackedChunkCount++;
          setProgress((ackedChunkCount / chunksToSend.length) * 100);
        }
        break;
      }
      
      case 'complete': {
        if (currentRole === 'sender') {
          syncCompleted = true;
          setPhase('complete');
          setStatusText(t('mlearn.Flashcards.Sync.Complete'));
          setTimeout(() => props.onClose(), 2000);
        }
        break;
      }

      case 'error': {
        setError(msg.message || 'Sync error');
        setPhase('error');
        break;
      }

      case 'peer_disconnected': {
        if (syncCompleted) {
          break;
        }
        setError(t('mlearn.Flashcards.Sync.Error.Connection'));
        setPhase('error');
        break;
      }
    }
  };

  const sendOffer = async () => {
    if (!socketClient) return;
    
    const strippedStore = stripMediaUrls(store);
    const storeData = JSON.stringify(strippedStore);
    chunksToSend = splitTextIntoChunks(storeData);
    
    socketClient.send({
      type: 'offer',
      totalChunks: chunksToSend.length,
      totalSize: storeData.length,
    });
  };

  const sendChunk = async (index: number) => {
    if (!socketClient || index >= chunksToSend.length) return;
    
    socketClient.send({
      type: 'chunk_data',
      index,
      data: chunksToSend[index],
    });
  };

  const requestNextChunk = (index: number) => {
    if (!socketClient) return;
    socketClient.send({
      type: 'request_chunk',
      index,
    });
  };

  const completeReceive = async () => {
    try {
      let assembled = '';
      for (let i = 0; i < totalChunksExpected; i++) {
        assembled += receivedChunks[i];
      }
      
      const remoteStore = JSON.parse(assembled) as FlashcardStore;
      const merged = await mergeFlashcards(store, remoteStore);
      
      getBridge().flashcards.saveFlashcards(merged);
      
      socketClient?.send({ type: 'complete' });
      
      setPhase('complete');
      setStatusText(t('mlearn.Flashcards.Sync.Complete'));
      setTimeout(() => props.onClose(), 2000);
    } catch (e) {
      log.error('Error completing receive:', e);
      setError(t('mlearn.Flashcards.Sync.Error.Connection'));
      setPhase('error');
    }
  };

  const displayRoomQR = async (roomIdValue: string, roomCodeValue: string) => {
    if (!qrCodeEl || !QRCodeLib) return;

    qrCodeEl.innerHTML = '';

    try {
      const canvas = document.createElement('canvas');
      const qrText = `${roomIdValue}:${roomCodeValue}`;
      await QRCodeLib.toCanvas(canvas, qrText, {
        width: 300,
        margin: 1,
        color: {
          dark: getThemeColor('--sync-qr-code-dark'),
          light: getThemeColor('--sync-qr-code-bg'),
        },
      });
      qrCodeEl.appendChild(canvas);
    } catch (e) {
      log.error('QR render error:', e);
    }
  };

  const handleClose = () => {
    cleanup();
    props.onClose();
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={handleClose}
      title={t('mlearn.Flashcards.Sync.Title')}
      size="md"
    >
      <div class="flashcard-sync-modal">
        <div class="sync-status">
          <span class="status-text">{statusText()}</span>
        </div>
        
        {<Show when={phase() === 'showing-qr' || phase() === 'init'}>
          <div class="qr-container">
            <div class="qr-code" ref={qrCodeEl}>
              <Spinner size={40} shape="square" strokeWidth={8} cornerRadius={0} />
            </div>
            <p class="qr-hint">
              {t('mlearn.Flashcards.Sync.QRHint')}
            </p>
          </div>
        </Show>}
        
        {<Show when={phase() === 'syncing' || phase() === 'connecting'}>
          <div class="sync-progress">
            <Spinner size={48} shape="square" strokeWidth={8} cornerRadius={0} text={t('mlearn.Flashcards.Sync.SyncingFlashcards')} />
            <ProgressBar value={progress()} showPercent variant="primary" animated />
          </div>
        </Show>}
        
        {<Show when={phase() === 'complete'}>
          <div class="sync-complete">
            <div class="complete-icon"><CheckIcon size={24} /></div>
            <p>{t('mlearn.Flashcards.Sync.SyncedSuccessfully')}</p>
          </div>
        </Show>}
        
        {<Show when={phase() === 'error'}>
          <div class="sync-error">
            <div class="error-icon"><CrossIcon size={24} /></div>
            <p>{error()}</p>
            <Btn onClick={startAsSender}>
              {t('mlearn.Global.TryAgain')}
            </Btn>
          </div>
        </Show>}
      </div>
    </Modal>
  );
};

export default FlashcardSyncModal;
