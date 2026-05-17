/**
 * useVideoTouch
 * Touch gesture handler for the video player on mobile:
 * - Single tap: toggle play/pause
 * - Double tap left third: seek back 5s
 * - Double tap right third: seek forward 5s
 * - Swipe left/right: seek ±10s (min 50px horizontal swipe)
 */

import { onCleanup, onMount } from 'solid-js';
import { isMobile } from '../../shared/platform';

interface VideoTouchTarget {
  state: { currentTime: number };
  seek: (time: number) => void;
  togglePlay: () => void;
}

const DOUBLE_TAP_MS = 300;
const SWIPE_MIN_PX = 50;

export function useVideoTouch(video: VideoTouchTarget, containerRef: () => HTMLElement | undefined) {
  if (!isMobile()) return;

  let tapTimeoutId: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    const el = containerRef();
    if (!el) return;

    let lastTapTime = 0;
    let lastTapX = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      isSwiping = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const dx = Math.abs(touch.clientX - touchStartX);
      const dy = Math.abs(touch.clientY - touchStartY);
      if (dx > 20 && dx > dy) {
        isSwiping = true;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch) return;

      // Handle swipe
      const dx = touch.clientX - touchStartX;
      if (isSwiping && Math.abs(dx) >= SWIPE_MIN_PX) {
        const dir = dx > 0 ? 1 : -1;
        video.seek(video.state.currentTime + dir * 10);
        return;
      }

      // Handle tap / double-tap
      const now = Date.now();
      const tapX = touch.clientX;

      if (now - lastTapTime < DOUBLE_TAP_MS && Math.abs(tapX - lastTapX) < 50) {
        // Double tap
        const rect = el.getBoundingClientRect();
        const relX = (tapX - rect.left) / rect.width;

        if (relX < 0.33) {
          video.seek(video.state.currentTime - 5);
        } else if (relX > 0.67) {
          video.seek(video.state.currentTime + 5);
        } else {
          video.togglePlay();
        }
        lastTapTime = 0;
        // Cancel pending single-tap timeout
        if (tapTimeoutId) {
          clearTimeout(tapTimeoutId);
          tapTimeoutId = null;
        }
      } else {
        // Single tap — handled after a delay to distinguish from double tap
        lastTapTime = now;
        lastTapX = tapX;
        tapTimeoutId = setTimeout(() => {
          tapTimeoutId = null;
          if (lastTapTime === now) {
            video.togglePlay();
          }
        }, DOUBLE_TAP_MS);
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    onCleanup(() => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      if (tapTimeoutId) {
        clearTimeout(tapTimeoutId);
        tapTimeoutId = null;
      }
    });
  });
}
