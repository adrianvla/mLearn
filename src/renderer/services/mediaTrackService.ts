import { getFFmpeg, fetchVideoData } from './videoClipService';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.services.mediaTrack");

export interface DetectedTrack {
  index: number;
  label: string;
  language: string | null;
}

export interface DetectTracksResult {
  audioTracks: DetectedTrack[];
  subtitleTracks: DetectedTrack[];
}

function parseStreamInfo(logOutput: string): DetectTracksResult {
  const audioTracks: DetectedTrack[] = [];
  const subtitleTracks: DetectedTrack[] = [];

  const streamRegex = /Stream\s+#0:(\d+)[^(]*\(([^)]*)\)[^:]*:\s*(\w+)[^,]*,\s*(\w+)/gi;
  const streamMatches = Array.from(logOutput.matchAll(streamRegex));
  for (const m of streamMatches) {
    const index = parseInt(m[1], 10);
    const lang = m[2].trim();
    const codec = m[3];
    const type = m[4];

    if (type === 'Audio' || codec === 'audio') {
      audioTracks.push({ index, label: lang || `Audio ${audioTracks.length + 1}`, language: lang || null });
    } else if (type === 'Subtitle' || codec === 'subtitle') {
      subtitleTracks.push({ index, label: lang || `Subtitle ${subtitleTracks.length + 1}`, language: lang || null });
    }
  }

  const altRegex = /Stream\s+#0:(\d+)(?:\([^)]*\))?:\s*Subtitle:\s*(\w+)/gi;
  const altMatches = Array.from(logOutput.matchAll(altRegex));
  for (const m of altMatches) {
    const index = parseInt(m[1], 10);
    if (!subtitleTracks.some(t => t.index === index)) {
      subtitleTracks.push({ index, label: `Subtitle ${subtitleTracks.length + 1}`, language: null });
    }
  }

  return { audioTracks, subtitleTracks };
}

const TRACK_DETECTION_CHUNK_SIZE = 50 * 1024 * 1024;

export async function detectMediaTracks(videoUrl: string): Promise<DetectTracksResult> {
  try {
    log.info('[MediaTrack] detectMediaTracks: url=', videoUrl);
    const sourceData = await fetchVideoData(videoUrl, TRACK_DETECTION_CHUNK_SIZE);
    if (!sourceData) {
      log.warn('[MediaTrack] detectMediaTracks: failed to fetch video data');
      return { audioTracks: [], subtitleTracks: [] };
    }

    log.info('[MediaTrack] detectMediaTracks: fetched', sourceData.byteLength, 'bytes (chunked)');

    const ffmpeg = await getFFmpeg();
    const ext = videoUrl.split('?')[0].match(/\.(\w{2,5})$/)?.[1] || 'mkv';
    const inputName = `input_detect.${ext}`;

    log.info('[MediaTrack] detectMediaTracks: writing input file');
    await ffmpeg.writeFile(inputName, sourceData);

    const logs: string[] = [];
    const logHandler = ({ message }: { message: string }) => logs.push(message);
    ffmpeg.on('log', logHandler);

    log.info('[MediaTrack] detectMediaTracks: running ffmpeg -i for stream info');
    await ffmpeg.exec(['-i', inputName]);

    ffmpeg.off('log', logHandler);
    await ffmpeg.deleteFile(inputName);

    const logOutput = logs.join('\n');
    const result = parseStreamInfo(logOutput);
    log.info('[MediaTrack] detectMediaTracks: found audio=', result.audioTracks.length, 'subtitle=', result.subtitleTracks.length);
    return result;
  } catch (err) {
    log.error('[MediaTrack] detectMediaTracks error:', err);
    return { audioTracks: [], subtitleTracks: [] };
  }
}

const MAX_EXTRACTION_SIZE = 512 * 1024 * 1024;

export async function extractSubtitleTrack(
  videoUrl: string,
  streamIndex: number,
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    log.info('[MediaTrack] extractSubtitleTrack: url=', videoUrl, 'streamIndex=', streamIndex);
    const sourceData = await fetchVideoData(videoUrl);
    if (!sourceData) {
      return { success: false, error: 'Failed to fetch video data' };
    }
    if (sourceData.byteLength > MAX_EXTRACTION_SIZE) {
      log.warn('[MediaTrack] extractSubtitleTrack: file too large for wasm extraction', sourceData.byteLength);
      return { success: false, error: 'File too large for in-app subtitle extraction' };
    }

    const ffmpeg = await getFFmpeg();
    const ext = videoUrl.split('?')[0].match(/\.(\w{2,5})$/)?.[1] || 'mkv';
    const inputName = `input_extract.${ext}`;
    const outputName = `subtitle_output.ass`;

    await ffmpeg.writeFile(inputName, sourceData);

    log.info('[MediaTrack] extractSubtitleTrack: extracting stream', streamIndex);
    const exitCode = await ffmpeg.exec([
      '-i', inputName,
      '-map', `0:s:${streamIndex}`,
      '-y',
      outputName,
    ]);

    await ffmpeg.deleteFile(inputName);

    if (exitCode !== 0) {
      log.error('[MediaTrack] extractSubtitleTrack: ffmpeg failed with code', exitCode);
      try { await ffmpeg.deleteFile(outputName); } catch {}
      return { success: false, error: `ffmpeg exited with code ${exitCode}` };
    }

    const result = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(outputName);

    if (typeof result === 'string') {
      return { success: true, content: result };
    }
    if (result instanceof Uint8Array) {
      return { success: true, content: new TextDecoder().decode(result) };
    }

    return { success: false, error: 'Unexpected output format' };
  } catch (err) {
    log.error('[MediaTrack] extractSubtitleTrack error:', err);
    return { success: false, error: String(err) };
  }
}
