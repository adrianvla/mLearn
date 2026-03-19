/**
 * Video Clip Service
 * Uses ffmpeg.wasm to clip video segments from a source video.
 * Runs entirely in the renderer/WebView (WASM-based, no native dependencies).
 *
 * Uses the single-threaded @ffmpeg/core build so that SharedArrayBuffer
 * (which requires COOP/COEP headers) is NOT needed in production Electron.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { isDesktop } from '../../shared/platform';

// Vite resolves these to hashed asset URLs at build time, and serves them
// directly in dev mode. This ensures the WASM binary is always available
// without relying on node_modules at runtime or fetching from a CDN.
import coreJsUrl from '@ffmpeg/core?url';
import coreWasmUrl from '@ffmpeg/core/wasm?url';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

/** Maximum source file sizes (bytes) before we skip video clipping */
const MAX_FILE_SIZE_DESKTOP = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
const MAX_FILE_SIZE_MOBILE = 512 * 1024 * 1024; // 512 MB

/**
 * Load ffmpeg-core files as blob URLs so they work under any CSP and protocol.
 * `toBlobURL` fetches the asset and wraps it in a `blob:` URL.
 */
async function loadCoreURLs() {
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(coreJsUrl, 'text/javascript'),
    toBlobURL(coreWasmUrl, 'application/wasm'),
  ]);
  return { coreURL, wasmURL };
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  if (!loadPromise) {
    ffmpegInstance = new FFmpeg();
    loadPromise = (async () => {
      const urls = await loadCoreURLs();
      await ffmpegInstance!.load(urls);
    })().catch((err) => {
      console.error('Failed to load ffmpeg.wasm:', err);
      ffmpegInstance = null;
      loadPromise = null;
      throw err;
    });
  }

  await loadPromise;
  return ffmpegInstance!;
}

/**
 * Clip a segment from a video file.
 *
 * @param videoUrl URL of the source video (local-media://, blob:, or http)
 * @param startSeconds Start time in seconds (will be clamped to >= 0)
 * @param endSeconds End time in seconds
 * @returns Uint8Array of the clipped MP4, or null if clipping failed
 */
export async function clipVideo(
  videoUrl: string,
  startSeconds: number,
  endSeconds: number,
): Promise<Uint8Array | null> {
  const start = Math.max(0, startSeconds);
  const end = Math.max(start + 0.1, endSeconds);

  try {
    // Fetch source video data
    const sourceData = await fetchFile(videoUrl);

    // File size guard
    const maxSize = isDesktop() ? MAX_FILE_SIZE_DESKTOP : MAX_FILE_SIZE_MOBILE;
    if (sourceData.byteLength > maxSize) {
      console.warn(
        `Video file too large for clipping (${(sourceData.byteLength / 1024 / 1024).toFixed(0)}MB). ` +
        `Max: ${(maxSize / 1024 / 1024).toFixed(0)}MB. Falling back to image.`
      );
      return null;
    }

    const ffmpeg = await getFFmpeg();

    // Determine input extension from URL
    const urlPath = videoUrl.split('?')[0];
    const ext = urlPath.match(/\.(\w{2,5})$/)?.[1] || 'mp4';
    const inputName = `input.${ext}`;
    const outputName = 'output.mp4';

    await ffmpeg.writeFile(inputName, sourceData);

    // Try stream copy first (fast, no re-encoding)
    const startStr = start.toFixed(3);
    const endStr = end.toFixed(3);

    let exitCode = await ffmpeg.exec([
      '-ss', startStr,
      '-to', endStr,
      '-i', inputName,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outputName,
    ]);

    // If stream copy fails, fall back to re-encoding
    if (exitCode !== 0) {
      console.warn('Stream copy failed, falling back to re-encoding');
      // Clean up failed output
      try { await ffmpeg.deleteFile(outputName); } catch { /* ignore */ }

      exitCode = await ffmpeg.exec([
        '-ss', startStr,
        '-to', endStr,
        '-i', inputName,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-avoid_negative_ts', 'make_zero',
        outputName,
      ]);
    }

    if (exitCode !== 0) {
      console.error('ffmpeg.wasm clipping failed with exit code:', exitCode);
      await cleanup(ffmpeg, inputName, outputName);
      return null;
    }

    const result = await ffmpeg.readFile(outputName);
    await cleanup(ffmpeg, inputName, outputName);

    if (typeof result === 'string') {
      // readFile returned a string instead of Uint8Array — shouldn't happen for binary
      console.error('ffmpeg.readFile returned string instead of Uint8Array');
      return null;
    }

    return result;
  } catch (err) {
    console.error('Video clipping failed:', err);
    return null;
  }
}

async function cleanup(ffmpeg: FFmpeg, ...files: string[]): Promise<void> {
  for (const file of files) {
    try { await ffmpeg.deleteFile(file); } catch { /* ignore */ }
  }
}
