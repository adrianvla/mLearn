import type { Page } from '@playwright/test';

/**
 * The microphone is host hardware. macOS headless Chromium never settles getUserMedia without the
 * OS microphone permission, so journeys substitute only the capture device: a generated voice-like
 * signal (0.3-1.3 s on, then silence, repeating every 3 s) or the OS denial error. The app's own
 * voice detection, recording, transcription, reply, playback and interruption code still runs.
 */
export async function useGeneratedMicrophone(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const tone = context.createOscillator();
      const gain = context.createGain();
      const output = context.createMediaStreamDestination();
      tone.connect(gain); gain.connect(output);
      gain.gain.setValueAtTime(0, context.currentTime);
      for (let at = 0; at < 600; at += 3) {
        gain.gain.setValueAtTime(0.6, context.currentTime + at + 0.3);
        gain.gain.setValueAtTime(0, context.currentTime + at + 1.3);
      }
      tone.start();
      return output.stream;
    };
  });
}

export async function denyMicrophone(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
}
