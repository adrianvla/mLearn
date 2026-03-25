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
import { getBridge } from '../../shared/bridges';

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

const LOCAL_MEDIA_SCHEME = 'local-media://';

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

async function fetchVideoData(videoUrl: string): Promise<Uint8Array | null> {
  console.log('[VideoClip] fetchVideoData: url=', videoUrl);
  if (videoUrl.startsWith(LOCAL_MEDIA_SCHEME)) {
    let filePath = videoUrl.slice(LOCAL_MEDIA_SCHEME.length);
    console.log('[VideoClip] fetchVideoData: detected local-media scheme, raw path=', filePath);
    if (process.platform === 'win32' && filePath.startsWith('/') && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
      console.log('[VideoClip] fetchVideoData: Windows path corrected to=', filePath);
    }
    console.log('[VideoClip] fetchVideoData: calling readMediaFile with path=', filePath);
    const buffer = await getBridge().files.readMediaFile(filePath);
    console.log('[VideoClip] fetchVideoData: readMediaFile result=', buffer == null ? 'null' : `ArrayBuffer(${buffer.byteLength})`);
    if (!buffer) return null;
    return new Uint8Array(buffer);
  }
  console.log('[VideoClip] fetchVideoData: using fetchFile for non-local-media URL');
  return fetchFile(videoUrl);
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

  console.log('[VideoClip] clipVideo: url=', videoUrl, 'start=', start, 'end=', end);

  try {
    console.log('[VideoClip] clipVideo: fetching video data...');
    const sourceData = await fetchVideoData(videoUrl);
    console.log('[VideoClip] clipVideo: sourceData=', sourceData == null ? 'null' : `Uint8Array(${sourceData.byteLength})`);
    if (!sourceData) return null;

    const maxSize = isDesktop() ? MAX_FILE_SIZE_DESKTOP : MAX_FILE_SIZE_MOBILE;
    if (sourceData.byteLength > maxSize) {
      console.warn(
        `Video file too large for clipping (${(sourceData.byteLength / 1024 / 1024).toFixed(0)}MB). ` +
        `Max: ${(maxSize / 1024 / 1024).toFixed(0)}MB. Falling back to image.`
      );
      return null;
    }

    console.log('[VideoClip] clipVideo: loading ffmpeg...');
    const ffmpeg = await getFFmpeg();
    console.log('[VideoClip] clipVideo: ffmpeg loaded, loaded=', ffmpeg.loaded);

    const urlPath = videoUrl.split('?')[0];
    const ext = urlPath.match(/\.(\w{2,5})$/)?.[1] || 'mp4';
    const inputName = `input.${ext}`;
    const outputName = 'output.mp4';

    console.log('[VideoClip] clipVideo: writing input file:', inputName);
    await ffmpeg.writeFile(inputName, sourceData);

    const startStr = start.toFixed(3);
    const endStr = end.toFixed(3);

    console.log('[VideoClip] clipVideo: running stream copy from', startStr, 'to', endStr);
    let exitCode = await ffmpeg.exec([
      '-ss', startStr,
      '-to', endStr,
      '-i', inputName,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outputName,
    ]);
    console.log('[VideoClip] clipVideo: stream copy exit code=', exitCode);

    if (exitCode !== 0) {
      console.warn('Stream copy failed, falling back to re-encoding');
      try { await ffmpeg.deleteFile(outputName); } catch (e) {
        console.error(e);
      }

      console.log('[VideoClip] clipVideo: running re-encode...');
      exitCode = await ffmpeg.exec([
        '-ss', startStr,
        '-to', endStr,
        '-i', inputName,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-avoid_negative_ts', 'make_zero',
        outputName,
      ]);
      console.log('[VideoClip] clipVideo: re-encode exit code=', exitCode);
    }

    if (exitCode !== 0) {
      console.error('ffmpeg.wasm clipping failed with exit code:', exitCode);
      await cleanup(ffmpeg, inputName, outputName);
      return null;
    }

    console.log('[VideoClip] clipVideo: reading output file...');
    const result = await ffmpeg.readFile(outputName);
    console.log('[VideoClip] clipVideo: result type=', typeof result, result instanceof Uint8Array ? `Uint8Array(${result.byteLength})` : String(result).slice(0, 80));
    await cleanup(ffmpeg, inputName, outputName);

    if (typeof result === 'string') {
      console.error('ffmpeg.readFile returned string instead of Uint8Array');
      return null;
    }

    console.log('[VideoClip] clipVideo: SUCCESS, returning clip of', result.byteLength, 'bytes');
    return result;
  } catch (err) {
    console.error('Video clipping failed:', err);
    return null;
  }
}

async function cleanup(ffmpeg: FFmpeg, ...files: string[]): Promise<void> {
  for (const file of files) {
    try { await ffmpeg.deleteFile(file); } catch (e) {
      console.error(e);
    }
  }
}
