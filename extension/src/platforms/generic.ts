import type { SitePlatform, PlatformSubtitleResult } from './types.js';

function toSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export const genericPlatform: SitePlatform = {
  name: 'generic',

  matchesUrl(): boolean {
    return true;
  },

  startMonitoring(video: HTMLVideoElement, onSubtitlesChanged: (result: PlatformSubtitleResult) => void): () => void {
    const result = this.extractOnce?.(video);
    if (result) {
      onSubtitlesChanged(result);
    }
    return () => {};
  },

  extractOnce(video: HTMLVideoElement): PlatformSubtitleResult | null {
    const tracks: Array<{ kind: string; src: string; srclang: string; label: string }> = [];
    const textTracks: Array<{ language: string; text: string }> = [];

    for (const track of Array.from(video.querySelectorAll('track'))) {
      tracks.push({
        kind: track.kind,
        src: track.src,
        srclang: track.srclang,
        label: track.label,
      });
    }

    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        const tt = video.textTracks[i];
        if (tt.mode === 'showing' || tt.mode === 'hidden') {
          const cueList = tt.cues;
          if (cueList && cueList.length > 0) {
            const srtCues: string[] = [];
            for (let j = 0; j < cueList.length; j++) {
              const cue = cueList[j] as VTTCue;
              if (cue.text) {
                srtCues.push(
                  `${j + 1}\n${toSRTTime(cue.startTime)} --> ${toSRTTime(cue.endTime)}\n${cue.text}`
                );
              }
            }
            if (srtCues.length > 0) {
              textTracks.push({
                language: tt.language || tt.label || 'unknown',
                text: srtCues.join('\n\n'),
              });
            }
          }
        }
      }
    }

    if (tracks.length === 0 && textTracks.length === 0) {
      return null;
    }

    return { tracks, textTracks };
  },
};
