/**
 * Media Distribution Service
 *
 * Handles chunked media file transfer over WebRTC data channels.
 * Torrent-like: every peer that has a chunk can redistribute it to any peer
 * that needs it. Missing chunks can be re-requested from any peer.
 *
 * Protocol overview:
 * 1. Owner sends `media-offer` to all peers (JSON)
 * 2. Peers respond with `media-accept` or `media-reject` (JSON)
 * 3. Owner (and any peer with chunks) sends binary chunks
 * 4. Peers broadcast `media-have` with their chunk indices
 * 5. Peers send `media-need` to request specific chunks
 * 6. On completion, peer sends `media-complete` (JSON)
 */

import type { PeerDataMessage, PeerServiceInstance } from './watchTogetherPeerService';
import { BINARY_TYPE_VIDEO_CHUNK } from './watchTogetherPeerService';

/** Default chunk size: 64 KB */
const DEFAULT_CHUNK_SIZE = 64 * 1024;

/** How many chunks to report in each `media-have` broadcast. */
const HAVE_BROADCAST_BATCH = 50;

export interface MediaTransferMetadata {
  mediaId: string;
  fileName: string;
  fileSize: number;
  chunkCount: number;
  chunkSize: number;
  subtitleContent: string | null;
}

export interface MediaDistributionCallbacks {
  /** Called when overall send progress changes (0–1). */
  onSendProgress: (progress: number) => void;
  /** Called when all accepting peers have received all chunks. */
  onSendComplete: () => void;
  /** Called on send error. */
  onSendError: (error: string) => void;
}

export interface MediaReceiveCallbacks {
  /** Called when media offer arrives. Return via accept()/reject() on the handle. */
  onOffer: (meta: MediaTransferMetadata, handle: MediaOfferHandle) => void;
  /** Called when receive progress changes (0–1). */
  onReceiveProgress: (progress: number) => void;
  /** Called when all chunks are received. */
  onReceiveComplete: (file: Blob, meta: MediaTransferMetadata) => void;
  /** Called on receive error. */
  onReceiveError: (error: string) => void;
}

export interface MediaOfferHandle {
  accept: () => void;
  reject: () => void;
  meta: MediaTransferMetadata;
}

export interface MediaDistributionInstance {
  /** Start distributing a file to all connected peers. */
  startDistribution: (file: Blob, fileName: string, subtitleContent: string | null) => void;
  /** Cancel an active distribution. */
  cancelDistribution: () => void;
  /** Handle incoming data messages from the peer service. */
  handleDataMessage: (fromUserId: string, message: PeerDataMessage) => void;
  /** Handle incoming binary chunks from the peer service. */
  handleBinaryChunk: (fromUserId: string, chunkType: number, chunkIndex: number, data: Uint8Array) => void;
  /** Clean up all state. */
  destroy: () => void;
  /** Whether a distribution is currently active (sending or receiving). */
  isActive: () => boolean;
}

function generateMediaId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createMediaDistribution(
  peerService: PeerServiceInstance,
  sendCallbacks: MediaDistributionCallbacks,
  receiveCallbacks: MediaReceiveCallbacks,
): MediaDistributionInstance {
  // --- Sender state ---
  let sendActive = false;
  let sendMediaId = '';
  let sendChunks: Uint8Array[] = [];
  const acceptedPeers = new Set<string>();
  const peerCompletions = new Set<string>();
  let sendAborted = false;

  // --- Receiver state ---
  let receiveActive = false;
  let receiveMeta: MediaTransferMetadata | null = null;
  let receiveChunks: (Uint8Array | null)[] = [];
  let receiveCount = 0;
  /** Set of chunk indices this peer has. */
  let haveSet = new Set<number>();
  let receiveAborted = false;

  // --- Sender ---

  async function startDistribution(file: Blob, fileName: string, subtitleContent: string | null): Promise<void> {
    if (sendActive) return;

    const mediaId = generateMediaId();
    const chunkSize = DEFAULT_CHUNK_SIZE;
    const fileSize = file.size;
    const chunkCount = Math.ceil(fileSize / chunkSize);

    sendMediaId = mediaId;
    sendActive = true;
    sendAborted = false;
    acceptedPeers.clear();
    peerCompletions.clear();

    const arrayBuffer = await file.arrayBuffer();
    sendChunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, fileSize);
      sendChunks.push(new Uint8Array(arrayBuffer, start, end - start));
    }

    peerService.sendToAll({
      type: 'media-offer',
      mediaId,
      fileName,
      fileSize,
      chunkCount,
      chunkSize,
      subtitleContent,
    });
  }

  function handleAccept(fromUserId: string, mediaId: string): void {
    if (!sendActive || mediaId !== sendMediaId) return;
    acceptedPeers.add(fromUserId);

    if (acceptedPeers.size === 1) {
      void sendAllChunks();
    }
  }

  function handleReject(fromUserId: string, mediaId: string): void {
    if (!sendActive || mediaId !== sendMediaId) return;
    acceptedPeers.delete(fromUserId);
    checkSendComplete();
  }

  async function sendAllChunks(): Promise<void> {
    if (!sendActive || sendAborted) return;

    for (let i = 0; i < sendChunks.length; i++) {
      if (sendAborted || !sendActive) return;

      await peerService.sendBinaryToAll(BINARY_TYPE_VIDEO_CHUNK, i, sendChunks[i]);
      sendCallbacks.onSendProgress((i + 1) / sendChunks.length);
    }
  }

  function handleNeed(fromUserId: string, mediaId: string, indices: number[]): void {
    if (!sendActive || mediaId !== sendMediaId) return;

    void (async () => {
      for (const idx of indices) {
        if (sendAborted || !sendActive) return;
        if (idx >= 0 && idx < sendChunks.length) {
          await peerService.sendBinaryTo(fromUserId, BINARY_TYPE_VIDEO_CHUNK, idx, sendChunks[idx]);
        }
      }
    })();
  }

  function handlePeerComplete(fromUserId: string, mediaId: string): void {
    if (!sendActive || mediaId !== sendMediaId) return;
    peerCompletions.add(fromUserId);
    checkSendComplete();
  }

  function checkSendComplete(): void {
    if (!sendActive) return;
    if (acceptedPeers.size > 0 && peerCompletions.size >= acceptedPeers.size) {
      sendActive = false;
      sendCallbacks.onSendComplete();
    }
  }

  function cancelDistribution(): void {
    sendAborted = true;
    sendActive = false;
    sendChunks = [];
    acceptedPeers.clear();
    peerCompletions.clear();
  }

  // --- Receiver ---

  function handleOffer(fromUserId: string, meta: MediaTransferMetadata): void {
    if (receiveActive) return;

    const handle: MediaOfferHandle = {
      meta,
      accept: () => {
        receiveActive = true;
        receiveAborted = false;
        receiveMeta = meta;
        receiveChunks = new Array(meta.chunkCount).fill(null);
        receiveCount = 0;
        haveSet = new Set();

        peerService.sendTo(fromUserId, { type: 'media-accept', mediaId: meta.mediaId });
      },
      reject: () => {
        peerService.sendTo(fromUserId, { type: 'media-reject', mediaId: meta.mediaId });
      },
    };

    receiveCallbacks.onOffer(meta, handle);
  }

  function handleIncomingChunk(chunkIndex: number, data: Uint8Array): void {
    if (!receiveActive || receiveAborted || !receiveMeta) return;
    if (chunkIndex < 0 || chunkIndex >= receiveMeta.chunkCount) return;
    if (haveSet.has(chunkIndex)) return;

    receiveChunks[chunkIndex] = data;
    receiveCount++;
    haveSet.add(chunkIndex);

    receiveCallbacks.onReceiveProgress(receiveCount / receiveMeta.chunkCount);

    if (receiveCount % HAVE_BROADCAST_BATCH === 0 || receiveCount === receiveMeta.chunkCount) {
      broadcastHave();
    }

    if (receiveCount === receiveMeta.chunkCount) {
      finalizeReceive();
    }
  }

  function broadcastHave(): void {
    if (!receiveActive || !receiveMeta) return;

    peerService.sendToAll({
      type: 'media-have',
      mediaId: receiveMeta.mediaId,
      indices: Array.from(haveSet),
    });
  }

  /** Handle `media-have` from another receiver to discover chunks for redistribution. */
  function handlePeerHave(fromUserId: string, mediaId: string, indices: number[]): void {
    if (!receiveActive || !receiveMeta || mediaId !== receiveMeta.mediaId) return;

    const needed: number[] = [];
    for (let i = 0; i < receiveMeta.chunkCount; i++) {
      if (!haveSet.has(i) && !indices.includes(i)) {
        // They don't have it either, skip
      }
    }

    // Request chunks they have that we don't
    for (const idx of indices) {
      if (!haveSet.has(idx)) {
        needed.push(idx);
      }
    }

    if (needed.length > 0) {
      peerService.sendTo(fromUserId, {
        type: 'media-need',
        mediaId: receiveMeta.mediaId,
        indices: needed,
      });
    }
  }

  /** Handle `media-need` from a peer requesting chunks we have. */
  function handlePeerNeed(fromUserId: string, mediaId: string, indices: number[]): void {
    if (!receiveMeta || mediaId !== receiveMeta.mediaId) return;

    void (async () => {
      for (const idx of indices) {
        if (receiveAborted) return;
        const chunk = receiveChunks[idx];
        if (chunk) {
          await peerService.sendBinaryTo(fromUserId, BINARY_TYPE_VIDEO_CHUNK, idx, chunk);
        }
      }
    })();
  }

  function finalizeReceive(): void {
    if (!receiveActive || !receiveMeta) return;
    const meta = receiveMeta;

    const validChunks = receiveChunks.filter((c): c is Uint8Array => c !== null);
    if (validChunks.length !== meta.chunkCount) {
      receiveCallbacks.onReceiveError('Incomplete media transfer');
      return;
    }

    const blob = new Blob(validChunks as BlobPart[], { type: 'application/octet-stream' });

    peerService.sendToAll({ type: 'media-complete', mediaId: meta.mediaId });

    receiveActive = false;
    receiveChunks = [];
    haveSet = new Set();

    receiveCallbacks.onReceiveComplete(blob, meta);
  }

  // --- Message router ---

  function handleDataMessage(fromUserId: string, message: PeerDataMessage): void {
    switch (message.type) {
      case 'media-offer':
        handleOffer(fromUserId, {
          mediaId: message.mediaId,
          fileName: message.fileName,
          fileSize: message.fileSize,
          chunkCount: message.chunkCount,
          chunkSize: message.chunkSize,
          subtitleContent: message.subtitleContent,
        });
        break;

      case 'media-accept':
        handleAccept(fromUserId, message.mediaId);
        break;

      case 'media-reject':
        handleReject(fromUserId, message.mediaId);
        break;

      case 'media-complete':
        handlePeerComplete(fromUserId, message.mediaId);
        break;

      case 'media-have':
        handlePeerHave(fromUserId, message.mediaId, message.indices);
        break;

      case 'media-need':
        if (sendActive && message.mediaId === sendMediaId) {
          handleNeed(fromUserId, message.mediaId, message.indices);
        } else {
          handlePeerNeed(fromUserId, message.mediaId, message.indices);
        }
        break;
    }
  }

  function handleBinaryChunk(_fromUserId: string, chunkType: number, chunkIndex: number, data: Uint8Array): void {
    if (chunkType === BINARY_TYPE_VIDEO_CHUNK) {
      handleIncomingChunk(chunkIndex, data);
    }
  }

  function destroy(): void {
    cancelDistribution();
    receiveAborted = true;
    receiveActive = false;
    receiveChunks = [];
    receiveMeta = null;
    haveSet = new Set();
  }

  function isActive(): boolean {
    return sendActive || receiveActive;
  }

  return {
    startDistribution,
    cancelDistribution,
    handleDataMessage,
    handleBinaryChunk,
    destroy,
    isActive,
  };
}
