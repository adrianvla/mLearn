import type { SitePlatform, PlatformSubtitleResult } from './types.js';

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
          const cues: string[] = [];
          const cueList = tt.cues;
          if (cueList) {
            for (let j = 0; j < cueList.length; j++) {
              const cue = cueList[j] as VTTCue;
              if (cue.text) cues.push(cue.text);
            }
          }
          if (cues.length > 0) {
            textTracks.push({
              language: tt.language || tt.label || 'unknown',
              text: cues.join('\n'),
            });
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
