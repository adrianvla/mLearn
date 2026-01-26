/**
 * FlashcardSyncModal Component
 * Handles QR-code based peer-to-peer flashcard syncing
 */

import { Component, createSignal, Show, onCleanup, createEffect } from 'solid-js';
import { GlassModal, GlassBtn, Progress, Spinner } from '../../components/common';
import { useFlashcards } from '../../context';
import {
  splitTextIntoChunks,
  splitForQR,
  mergeFlashcards,
  ChunkCollector,
  type FlashcardStore,
} from '../../services/flashcardSyncService';
import './FlashcardSyncModal.css';

// Import SimplePeer and QRCode dynamically
let SimplePeer: any = null;
let QRCodeLib: any = null;
let jsQR: any = null;

export interface FlashcardSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SyncPhase = 'init' | 'showing-qr' | 'scanning' | 'connecting' | 'syncing' | 'complete' | 'error';

export const FlashcardSyncModal: Component<FlashcardSyncModalProps> = (props) => {
  const { store } = useFlashcards();
  
  const [phase, setPhase] = createSignal<SyncPhase>('init');
  const [statusText, setStatusText] = createSignal('Initializing...');
  const [error, setError] = createSignal<string | null>(null);
  const [qrChunks, setQrChunks] = createSignal<string[]>([]);
  const [currentQrIndex, setCurrentQrIndex] = createSignal(0);
  const [numberOfChunks, setNumberOfChunks] = createSignal(30);
  const [progress, setProgress] = createSignal(0);
  
  let peer: any = null;
  let qrCodeEl: HTMLDivElement | undefined;
  let videoEl: HTMLVideoElement | undefined;
  let canvasEl: HTMLCanvasElement | undefined;
  let qrIntervalId: number | null = null;
  let videoStream: MediaStream | null = null;
  let scanAnimationId: number | null = null;
  
  const chunkCollector = new ChunkCollector();

  // Load libraries when modal opens
  createEffect(async () => {
    if (!props.isOpen) return;
    
    try {
      setPhase('init');
      setStatusText('Loading libraries...');
      
      // Load SimplePeer
      if (!SimplePeer) {
        const module = await import('simple-peer');
        SimplePeer = module.default || module;
      }
      
      // Load QRCode library
      if (!QRCodeLib) {
        const module = await import('qrcode');
        QRCodeLib = module.default || module;
      }
      
      // Load jsQR for scanning
      if (!jsQR) {
        const module = await import('jsqr');
        jsQR = module.default || module;
      }
      
      // Start connection
      await startConnection();
    } catch (e) {
      console.error('Failed to load sync libraries:', e);
      setError('Failed to load required libraries');
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
        console.error('Error destroying peer:', e);
      }
      peer = null;
    }
    chunkCollector.reset();
  };

  const startConnection = async () => {
    try {
      cleanup();
      setPhase('showing-qr');
      setStatusText('Generating connection code...');
      
      // Create peer as initiator
      peer = new SimplePeer({ initiator: true, trickle: false });
      
      peer.on('signal', (data: any) => {
        const signalStr = JSON.stringify(data);
        console.log('Generated signal data:', signalStr.length, 'bytes');
        
        // Calculate number of chunks
        const numChunks = Math.ceil(signalStr.length / 60);
        setNumberOfChunks(numChunks);
        
        // Split signal into QR-friendly chunks
        const chunks = splitForQR(signalStr);
        setQrChunks(chunks);
        
        // Start displaying QR codes
        startQRDisplay();
        setStatusText(`Enter ${numChunks} in mLearn app, then scan this QR code`);
      });
      
      peer.on('connect', () => {
        console.log('Peer connected!');
        setPhase('syncing');
        setStatusText('Connected! Syncing...');
        stopScanning();
        
        // Send our flashcards
        sendFlashcards();
      });
      
      peer.on('data', (data: any) => {
        handleIncomingData(data);
      });
      
      peer.on('error', (err: Error) => {
        console.error('Peer error:', err);
        setError(err.message);
        setPhase('error');
      });
      
    } catch (e) {
      console.error('Connection error:', e);
      setError('Failed to start connection');
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
        const canvas = document.createElement('canvas');
        await QRCodeLib.toCanvas(canvas, chunkData, {
          width: 300,
          margin: 1,
          color: { dark: '#000', light: '#fff' },
        });
        qrCodeEl.appendChild(canvas);
      } catch (e) {
        console.error('QR render error:', e);
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
    setStatusText('Point camera at QR code...');
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
      console.error('Camera access error:', e);
      setError('Camera access denied');
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
        console.log('All QR chunks collected');
        const assembled = chunkCollector.assemble();
        const signal = JSON.parse(assembled);
        peer?.signal(signal);
        stopScanning();
        setPhase('connecting');
        setStatusText('Establishing connection...');
      }
    } catch (e) {
      // Ignore invalid QR codes
    }
  };

  const sendFlashcards = () => {
    const storeData = JSON.stringify(store);
    const chunks = splitTextIntoChunks(storeData, 1000);
    
    chunks.forEach((chunk, i) => {
      peer?.send(JSON.stringify({
        type: 'sync-chunk',
        data: [i, chunk, chunks.length],
      }));
    });
    
    console.log(`Sent ${chunks.length} flashcard chunks`);
  };

  const receivedChunkCollector = new ChunkCollector();

  const handleIncomingData = async (rawData: any) => {
    try {
      const str = typeof rawData === 'string' ? rawData : rawData.toString();
      const parsed = JSON.parse(str);
      
      if (parsed.type === 'sync-chunk') {
        const [index, chunk, total] = parsed.data;
        const isComplete = receivedChunkCollector.addChunk(index, chunk, total);
        const { current, total: t } = receivedChunkCollector.getProgress();
        setProgress((current / t) * 100);
        
        if (isComplete) {
          const assembled = receivedChunkCollector.assemble();
          const remoteStore = JSON.parse(assembled) as FlashcardStore;
          
          // Merge flashcards
          const merged = await mergeFlashcards(store, remoteStore);
          
          // Save merged store via IPC
          if (window.mLearnIPC) {
            window.mLearnIPC.saveFlashcards(merged);
          }
          
          setPhase('complete');
          setStatusText('Sync complete!');
          
          // Auto-close after 2 seconds
          setTimeout(() => {
            props.onClose();
          }, 2000);
        }
      }
    } catch (e) {
      console.error('Error handling incoming data:', e);
    }
  };

  const handleClose = () => {
    cleanup();
    props.onClose();
  };

  return (
    <GlassModal
      isOpen={props.isOpen}
      onClose={handleClose}
      title="Sync Flashcards"
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
              <Spinner size={40} />
            </div>
            <p class="qr-hint">
              Scan with mLearn mobile app to sync flashcards
            </p>
            <GlassBtn onClick={startScanning}>
              Scan QR Instead
            </GlassBtn>
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
            <Progress progress={progress()} showPercent />
            <GlassBtn onClick={() => { stopScanning(); startConnection(); }}>
              Show QR Instead
            </GlassBtn>
          </div>
        </Show>
        
        {/* Syncing */}
        <Show when={phase() === 'syncing' || phase() === 'connecting'}>
          <div class="sync-progress">
            <Spinner size={48} text="Syncing flashcards..." />
            <Progress progress={progress()} showPercent animated />
          </div>
        </Show>
        
        {/* Complete */}
        <Show when={phase() === 'complete'}>
          <div class="sync-complete">
            <div class="complete-icon">✓</div>
            <p>Flashcards synced successfully!</p>
          </div>
        </Show>
        
        {/* Error */}
        <Show when={phase() === 'error'}>
          <div class="sync-error">
            <div class="error-icon">✕</div>
            <p>{error()}</p>
            <GlassBtn onClick={startConnection}>
              Try Again
            </GlassBtn>
          </div>
        </Show>
      </div>
    </GlassModal>
  );
};

export default FlashcardSyncModal;
