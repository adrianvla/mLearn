export interface PlatformSubtitleResult {
  tracks: Array<{ kind: string; src: string; srclang: string; label: string }>;
  textTracks: Array<{ language: string; text: string }>;
}

export interface SitePlatform {
  readonly name: string;
  matchesUrl(url: string): boolean;
  startMonitoring(video: HTMLVideoElement, onSubtitlesChanged: (result: PlatformSubtitleResult) => void): () => void;
  extractOnce?(video: HTMLVideoElement): PlatformSubtitleResult | null;
}
