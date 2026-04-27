/**
 * FlashcardSyncModal Component
 * Handles QR-code based peer-to-peer flashcard syncing
 */

import { Component, createSignal, Show, onCleanup, createEffect } from 'solid-js';
import { Modal, Btn, ProgressBar, Spinner, CheckIcon, CrossIcon } from '../../components/common';
import { useFlashcards, useLocalization } from '../../context';
import { getBridge } from '../../../shared/bridges';
import {
  splitForQR,
  mergeFlashcards,
  ChunkCollector,
  sendChunkedWithBackpressure,
  type FlashcardStore,
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

interface JsQrCode {
  data: string;
}

type JsQrScanner = (data: Uint8ClampedArray, width: number, height: number) => JsQrCode | null;

let SimplePeerConstructor: Window['SimplePeer'] | null = null;
let QRCodeLib: QRCodeRenderer | null = null;
let jsQR: JsQrScanner | null = null;

export interface FlashcardSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SyncPhase = 'init' | 'showing-qr' | 'scanning' | 'connecting' | 'syncing' | 'complete' | 'error';

export const FlashcardSyncModal: Component<FlashcardSyncModalProps> = (props) => {
  const { store } = useFlashcards();
  const { t } = useLocalization();
  
  const [phase, setPhase] = createSignal<SyncPhase>('init');
  const [statusText, setStatusText] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [qrChunks, setQrChunks] = createSignal<string[]>([]);
  const [currentQrIndex, setCurrentQrIndex] = createSignal(0);
  const [numberOfChunks, setNumberOfChunks] = createSignal(30);
  const [progress, setProgress] = createSignal(0);
  
  let peer: SimplePeerInstance | null = null;
  let qrCodeEl: HTMLDivElement | undefined;
  let videoEl: HTMLVideoElement | undefined;
  let canvasEl: HTMLCanvasElement | undefined;
  let qrIntervalId: number | null = null;
  let videoStream: MediaStream | null = null;
  let scanAnimationId: number | null = null;
  
  const chunkCollector = new ChunkCollector();

  const getThemeColor = (variableName: string): string =>
    getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();

  // Load libraries when modal opens
  createEffect(async () => {
    if (!props.isOpen) return;
    
    try {
      setPhase('init');
      setStatusText(t('mlearn.Flashcards.Sync.LoadingLibraries'));
      
      // Load SimplePeer from pre-bundled browser-compatible version
      // The npm version has issues with Vite's externalization of Node.js modules
      if (!SimplePeerConstructor) {
        // Import the browser-bundled version that doesn't depend on Node.js streams/events
        // @ts-ignore - Dynamic import of bundled JS file
        await import('../../services/simplepeer.min.js');
        SimplePeerConstructor = window.SimplePeer;
        if (!SimplePeerConstructor) {
          throw new Error('SimplePeer failed to load');
        }
      }
      
      // Load QRCode library
      if (!QRCodeLib) {
        const module = await import('qrcode');
        QRCodeLib = (module.default || module) as QRCodeRenderer;
      }
      
      // Load jsQR for scanning
      if (!jsQR) {
        const module = await import('jsqr');
        jsQR = (module.default || module) as JsQrScanner;
      }
      
      // Start connection
      await startConnection();
    } catch (e) {
      log.error('Failed to load sync libraries:', e);
      setError(t('mlearn.Flashcards.Sync.Error.LoadLibraries', { error: e instanceof Error ? e.message : String(e) }));
      setPhase('error');
    }
  });

  // Cleanup on close
  onCleanup(() => {
    cleanup();
  });

  const cleanup = () => {
    if (qrIntervalId !== null) {
      clearInterval(qrIntervalId);
      qrIntervalId = null;
    }
    if (scanAnimationId !== null) {
      cancelAnimationFrame(scanAnimationId);
      scanAnimationId = null;
    }
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }
    if (peer) {
      try {
        peer.destroy();
      } catch (e) {
        log.error('Error destroying peer:', e);
      }
      peer = null;
    }
    chunkCollector.reset();
  };

  const startConnection = async () => {
    try {
      cleanup();
      setPhase('showing-qr');
      setStatusText(t('mlearn.Flashcards.Sync.GeneratingCode'));
      
      // Create peer as initiator
      if (!SimplePeerConstructor) {
        throw new Error('SimplePeer is not available');
      }

      peer = new SimplePeerConstructor({ initiator: true, trickle: false });
      
      peer.on('signal', (data: unknown) => {
        const signalStr = JSON.stringify(data);
        log.info('Generated signal data:', signalStr.length, 'bytes');
        
        // Calculate number of chunks
        const numChunks = Math.ceil(signalStr.length / 60);
        setNumberOfChunks(numChunks);
        
        // Split signal into QR-friendly chunks
        const chunks = splitForQR(signalStr);
        setQrChunks(chunks);
        
        // Start displaying QR codes
        startQRDisplay();
        setStatusText(t('mlearn.Flashcards.Sync.ScanInstructions', { numChunks }));
      });
      
      peer.on('connect', () => {
        log.info('Peer connected!');
        setPhase('syncing');
        setStatusText(t('mlearn.Flashcards.Sync.ConnectedSyncing'));
        stopScanning();
        
        // Send our flashcards
        sendFlashcards();
      });
      
      peer.on('data', (data) => {
        handleIncomingData(data);
      });
      
      peer.on('error', (err: Error) => {
        log.error('Peer error:', err);
        setError(err.message);
        setPhase('error');
      });
      
    } catch (e) {
      log.error('Connection error:', e);
      setError(t('mlearn.Flashcards.Sync.Error.Connection'));
      setPhase('error');
    }
  };

  const startQRDisplay = () => {
    if (qrIntervalId !== null) {
      clearInterval(qrIntervalId);
    }
    
    const displayQR = async () => {
      const chunks = qrChunks();
      if (chunks.length === 0 || !qrCodeEl) return;
      
      const index = currentQrIndex();
      const chunkData = JSON.stringify([index, chunks[index]]);
      
      // Clear and render QR code
      qrCodeEl.innerHTML = '';
      
      try {
        if (!QRCodeLib) {
          return;
        }

        const canvas = document.createElement('canvas');
        await QRCodeLib.toCanvas(canvas, chunkData, {
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
      
      // Cycle to next chunk
      setCurrentQrIndex((index + 1) % chunks.length);
    };
    
    displayQR();
    qrIntervalId = window.setInterval(displayQR, 100);
  };

  const stopQRDisplay = () => {
    if (qrIntervalId !== null) {
      clearInterval(qrIntervalId);
      qrIntervalId = null;
    }
  };

  const startScanning = async () => {
    setPhase('scanning');
    setStatusText(t('mlearn.Flashcards.Sync.PointCamera'));
    stopQRDisplay();
    
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      
      if (videoEl) {
        videoEl.srcObject = videoStream;
        videoEl.setAttribute('playsinline', 'true');
        await videoEl.play();
        
        // Start scanning loop
        const scan = () => {
          if (!videoEl || phase() !== 'scanning') return;
          
          if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
            const canvas = canvasEl || document.createElement('canvas');
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(videoEl, 0, 0);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              if (!jsQR) {
                return;
              }
              const code = jsQR(imageData.data, canvas.width, canvas.height);
              
              if (code && code.data) {
                handleScannedQR(code.data);
              }
            }
          }
          
          scanAnimationId = requestAnimationFrame(scan);
        };
        
        scan();
      }
    } catch (e) {
      log.error('Camera access error:', e);
      setError(t('mlearn.Flashcards.Sync.Error.CameraAccess'));
      setPhase('error');
    }
  };

  const stopScanning = () => {
    if (scanAnimationId !== null) {
      cancelAnimationFrame(scanAnimationId);
      scanAnimationId = null;
    }
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }
  };

  const handleScannedQR = (data: string) => {
    try {
      const parsed = JSON.parse(data) as [number, string];
      const [index, chunk] = parsed;
      
      const isComplete = chunkCollector.addChunk(index, chunk, numberOfChunks());
      const { current, total } = chunkCollector.getProgress();
      setProgress((current / total) * 100);
      
      if (isComplete) {
        log.info('All QR chunks collected');
        const assembled = chunkCollector.assemble();
        const signal = JSON.parse(assembled);
        peer?.signal(signal);
        stopScanning();
        setPhase('connecting');
        setStatusText(t('mlearn.Flashcards.Sync.EstablishingConnection'));
      }
    } catch (e) {
      log.error("error", e);
      // Ignore invalid QR codes
    }
  };

  const sendFlashcards = async () => {
    if (!peer) return;
    const storeData = JSON.stringify(store);
    try {
      await sendChunkedWithBackpressure(peer, 'sync', storeData);
    } catch (e) {
      log.error('Error sending flashcards:', e);
      setError(t('mlearn.Flashcards.Sync.Error.Connection'));
      setPhase('error');
    }
  };

  const receivedChunkCollector = new ChunkCollector();

  const handleIncomingData = async (rawData: string | ArrayBuffer | Uint8Array) => {
    try {
      const str = typeof rawData === 'string'
        ? rawData
        : rawData instanceof Uint8Array
          ? new TextDecoder().decode(rawData)
          : new TextDecoder().decode(new Uint8Array(rawData));
      const parsed = JSON.parse(str);
      
      if (parsed.type === 'sync-chunk') {
        const [index, chunk, total] = parsed.data;
        const isComplete = receivedChunkCollector.addChunk(index, chunk, total);
        const { current, total: totalChunks } = receivedChunkCollector.getProgress();
        setProgress((current / totalChunks) * 100);
        
        if (isComplete) {
          const assembled = receivedChunkCollector.assemble();
          const remoteStore = JSON.parse(assembled) as FlashcardStore;
          
          // Merge flashcards
          const merged = await mergeFlashcards(store, remoteStore);
          
          // Save merged store via IPC
          getBridge().flashcards.saveFlashcards(merged);
          
          setPhase('complete');
          setStatusText(t('mlearn.Flashcards.Sync.Complete'));
          
          // Auto-close after 2 seconds
          setTimeout(() => {
            props.onClose();
          }, 2000);
        }
      }
    } catch (e) {
      log.error('Error handling incoming data:', e);
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
        
        {/* QR Code Display */}
        <Show when={phase() === 'showing-qr' || phase() === 'init'}>
          <div class="qr-container">
            <div class="qr-code" ref={qrCodeEl}>
              <Spinner size={40} shape="square" />
            </div>
            <p class="qr-hint">
              {t('mlearn.Flashcards.Sync.QRHint')}
            </p>
            <Btn onClick={startScanning}>
              {t('mlearn.Flashcards.Sync.ScanQRInstead')}
            </Btn>
          </div>
        </Show>
        
        {/* Camera Scanning */}
        <Show when={phase() === 'scanning'}>
          <div class="scan-container">
            <video
              ref={videoEl}
              class="scan-video"
              autoplay
              playsinline
              muted
            />
            <canvas ref={canvasEl} class="scan-canvas" />
            <ProgressBar value={progress()} showPercent variant="primary" animated />
            <Btn onClick={() => { stopScanning(); startConnection(); }}>
              {t('mlearn.Flashcards.Sync.ShowQRInstead')}
            </Btn>
          </div>
        </Show>
        
        {/* Syncing */}
        <Show when={phase() === 'syncing' || phase() === 'connecting'}>
          <div class="sync-progress">
            <Spinner size={48} shape="square" text={t('mlearn.Flashcards.Sync.SyncingFlashcards')} />
            <ProgressBar value={progress()} showPercent variant="primary" animated />
          </div>
        </Show>
        
        {/* Complete */}
        <Show when={phase() === 'complete'}>
          <div class="sync-complete">
            <div class="complete-icon"><CheckIcon size={24} /></div>
            <p>{t('mlearn.Flashcards.Sync.SyncedSuccessfully')}</p>
          </div>
        </Show>
        
        {/* Error */}
        <Show when={phase() === 'error'}>
          <div class="sync-error">
            <div class="error-icon"><CrossIcon size={24} /></div>
            <p>{error()}</p>
            <Btn onClick={startConnection}>
              {t('mlearn.Global.TryAgain')}
            </Btn>
          </div>
        </Show>
      </div>
    </Modal>
  );
};

export default FlashcardSyncModal;
