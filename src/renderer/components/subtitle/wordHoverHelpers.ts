import type { Flashcard, FlashcardContent, DictionaryEntry, PitchData, Token, TranslationEntry } from '../../../shared/types';
import { WORD_STATUS } from '../../../shared/constants';
import { normalizeReading } from '../../../shared/utils/textUtils';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';

export type WordStatus = 'unknown' | 'learning' | 'known';

export interface WordHoverTranslationData {
  data?: (TranslationEntry | PitchData | null | undefined)[];
}

export interface BuildWordHoverFlashcardContentParams {
  token: Token;
  word: string;
  translationData?: WordHoverTranslationData;
  entry?: DictionaryEntry;
  contextPhrase?: string;
  isOcr?: boolean;
  ocrImageElement?: HTMLImageElement | null;
  anchorRect?: DOMRect;
  wordUuid?: string;
  level?: number;
  manualStatus: WordStatus;
  colourCodes: Record<string, string>;
  ocrCropPadding?: number;
  tokenize: (text: string) => Promise<Token[]>;
  /** When 'video', the caller will clip a video segment and attach it post-build */
  flashcardMediaType?: 'image' | 'video';
}

export function numericToWordStatus(num: number): WordStatus {
  switch (num) {
    case WORD_STATUS.LEARNING:
      return 'learning';
    case WORD_STATUS.KNOWN:
      return 'known';
    default:
      return 'unknown';
  }
}

export function wordStatusToNumeric(status: WordStatus): number {
  switch (status) {
    case 'learning':
      return WORD_STATUS.LEARNING;
    case 'known':
      return WORD_STATUS.KNOWN;
    default:
      return WORD_STATUS.UNKNOWN;
  }
}

export type StatusSource = 'nothing' | 'manual' | 'anki' | 'flashcards';

export function getEffectiveWordStatus(card: Flashcard | null, manualStatus: WordStatus): WordStatus {
  if (card) {
    if (card.state === 'new' || card.state === 'learning' || card.state === 'relearning') {
      return 'learning';
    }
    if (card.state === 'review') {
      return 'known';
    }
  }
  return manualStatus;
}

/**
 * Determine which source is driving the effective word status.
 * Priority: Flashcards > Anki > Manual > Nothing
 */
export function getStatusSource(
  card: Flashcard | null,
  manualStatus: WordStatus,
  isInAnki: boolean,
): StatusSource {
  if (card) return 'flashcards';
  if (isInAnki) return 'anki';
  if (manualStatus !== 'unknown') return 'manual';
  return 'nothing';
}

export function getEaseFromWordStatus(status: WordStatus): number {
  const statusNum = wordStatusToNumeric(status);
  return Math.max((statusNum - 1) * 0.25, 0) + 1.3;
}

export function extractReadingFromEntries(entries: unknown[]): string {
  if (!Array.isArray(entries)) return '';
  for (const entry of entries) {
    if (entry && typeof entry === 'object' && 'reading' in entry) {
      const reading = (entry as { reading?: unknown }).reading;
      if (typeof reading === 'string' && reading) {
        return reading;
      }
    }
  }
  return '';
}

export function extractPitchAccentFromTranslationData(data?: WordHoverTranslationData): number | undefined {
  const items = data?.data;
  if (!items || items.length <= 2) return undefined;

  const pitchEntry = items[2];
  if (!pitchEntry) return undefined;

  if (Array.isArray(pitchEntry) && (pitchEntry[2] as { pitches?: Array<{ position?: number }> } | undefined)?.pitches) {
    return (pitchEntry[2] as { pitches?: Array<{ position?: number }> }).pitches?.[0]?.position;
  }

  if (typeof pitchEntry === 'object' && pitchEntry !== null && 'pitches' in pitchEntry) {
    return (pitchEntry as { pitches?: Array<{ position?: number }> }).pitches?.[0]?.position;
  }

  const findPitch = (value: unknown): number | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    if ('pitches' in value) {
      return (value as { pitches?: Array<{ position?: number }> }).pitches?.[0]?.position;
    }
    for (const child of Object.values(value)) {
      const found = findPitch(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  return findPitch(pitchEntry);
}

function screenshotVideo(): string {
  try {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    if (!video || video.readyState < 2) return '';

    const targetWidth = 480;
    const videoWidth = video.videoWidth || video.clientWidth || 640;
    const videoHeight = video.videoHeight || video.clientHeight || 360;
    if (videoWidth === 0 || videoHeight === 0) return '';

    const targetHeight = Math.round(videoHeight * (targetWidth / videoWidth));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.5);
  } catch {
    return '';
  }
}

function extractExampleHtml(wordUuid: string | undefined, fallbackText: string): string {
  try {
    const subtitlesEl = document.querySelector('.subtitles, .subtitle-container, [class*="subtitle"]');
    if (!subtitlesEl) {
      return fallbackText || '-';
    }

    const clone = subtitlesEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.subtitle_hover, .word-hover-container').forEach((element) => element.remove());

    if (wordUuid) {
      const wordEl = clone.querySelector(`.subtitle_word.word_${wordUuid}, [data-uuid="${wordUuid}"]`);
      if (wordEl) {
        wordEl.classList.add('defined');
      }
    }

    return clone.innerHTML || fallbackText || '-';
  } catch {
    return fallbackText || '-';
  }
}

function captureOcrScreenshot(anchorRect: DOMRect | undefined, ocrImageElement: HTMLImageElement | null | undefined, ocrCropPadding?: number): string {
  try {
    let pageImg = ocrImageElement;

    if (!pageImg && anchorRect) {
      const anchorCenterX = (anchorRect.left + anchorRect.right) / 2;
      const anchorCenterY = (anchorRect.top + anchorRect.bottom) / 2;
      const pageImages = Array.from(document.querySelectorAll('.page img.page-image, .page-container img.page-image'));
      for (const image of pageImages) {
        const imageRect = image.getBoundingClientRect();
        if (
          anchorCenterX >= imageRect.left &&
          anchorCenterX <= imageRect.right &&
          anchorCenterY >= imageRect.top &&
          anchorCenterY <= imageRect.bottom
        ) {
          pageImg = image as HTMLImageElement;
          break;
        }
      }
    }

    if (!pageImg) {
      const ocrBox = document.querySelector('.ocr-box.hovered, .ocr-box:hover');
      const pageContainer = ocrBox?.closest('.page');
      pageImg = pageContainer?.querySelector('img.page-image') as HTMLImageElement | null;
    }

    if (!pageImg) {
      pageImg = document.querySelector('.page img.page-image, .page-container img') as HTMLImageElement | null;
    }

    if (!pageImg || !pageImg.naturalWidth || !pageImg.naturalHeight) {
      return '';
    }

    const imageRect = pageImg.getBoundingClientRect();

    if (anchorRect) {
      const padding = ocrCropPadding ?? 200;
      const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
      const sourceLeft = anchorRect.left - padding;
      const sourceTop = anchorRect.top - padding;
      const sourceWidth = anchorRect.width + padding * 2;
      const sourceHeight = anchorRect.height + padding * 2;

      const visibleLeft = clamp(sourceLeft, imageRect.left, imageRect.right);
      const visibleTop = clamp(sourceTop, imageRect.top, imageRect.bottom);
      const visibleRight = clamp(sourceLeft + sourceWidth, imageRect.left, imageRect.right);
      const visibleBottom = clamp(sourceTop + sourceHeight, imageRect.top, imageRect.bottom);
      const visibleWidth = Math.max(1, visibleRight - visibleLeft);
      const visibleHeight = Math.max(1, visibleBottom - visibleTop);
      const scaleX = pageImg.naturalWidth / Math.max(1, imageRect.width);
      const scaleY = pageImg.naturalHeight / Math.max(1, imageRect.height);
      const imageSourceX = (visibleLeft - imageRect.left) * scaleX;
      const imageSourceY = (visibleTop - imageRect.top) * scaleY;
      const imageSourceWidth = visibleWidth * scaleX;
      const imageSourceHeight = visibleHeight * scaleY;

      const canvas = document.createElement('canvas');
      canvas.width = Math.min(4096, Math.max(1, Math.floor(imageSourceWidth)));
      canvas.height = Math.min(4096, Math.max(1, Math.floor(imageSourceHeight)));
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      ctx.drawImage(pageImg, imageSourceX, imageSourceY, imageSourceWidth, imageSourceHeight, 0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.95)';
      ctx.lineWidth = 6;
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 8;
      const boxX = (anchorRect.left - visibleLeft) * (canvas.width / visibleWidth);
      const boxY = (anchorRect.top - visibleTop) * (canvas.height / visibleHeight);
      const boxWidth = anchorRect.width * (canvas.width / visibleWidth);
      const boxHeight = anchorRect.height * (canvas.height / visibleHeight);
      ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
      ctx.restore();

      return canvas.toDataURL('image/jpeg', 0.5);
    }

    const targetWidth = 480;
    const scale = targetWidth / pageImg.naturalWidth;
    const targetHeight = Math.round(pageImg.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.drawImage(pageImg, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.5);
  } catch {
    return '';
  }
}

export async function buildWordHoverFlashcardContent(params: BuildWordHoverFlashcardContentParams): Promise<{ content: FlashcardContent; ease: number }> {
  const word = params.word;
  const translationItems = params.translationData?.data;

  let translationArr: string[] | undefined;
  let definitionHtml: string[] | undefined;

  if (translationItems && Array.isArray(translationItems)) {
    const firstEntry = translationItems[0] as TranslationEntry | undefined;
    if (firstEntry?.definitions) {
      translationArr = Array.isArray(firstEntry.definitions) ? firstEntry.definitions : [firstEntry.definitions];
    }

    const secondEntry = translationItems[1] as TranslationEntry | undefined;
    if (secondEntry?.definitions) {
      definitionHtml = Array.isArray(secondEntry.definitions) ? secondEntry.definitions : [secondEntry.definitions];
    }
  }

  if (!translationArr && params.entry?.meanings) {
    translationArr = [params.entry.meanings.join('; ')];
  }

  const firstEntry = translationItems?.[0] as TranslationEntry | undefined;
  const reading = normalizeReading(firstEntry?.reading || params.token.reading || '');
  const pitchAccent = extractPitchAccentFromTranslationData(params.translationData);
  const screenshot = params.isOcr
    ? captureOcrScreenshot(params.anchorRect, params.ocrImageElement, params.ocrCropPadding)
    : screenshotVideo();

  let exampleHtml: string;
  if (params.isOcr) {
    const contextPhrase = params.contextPhrase || '';
    if (contextPhrase && contextPhrase !== '-') {
      try {
        const tokens = await params.tokenize(contextPhrase);
        exampleHtml = tokensToColoredHtml(tokens, params.colourCodes, word);
      } catch {
        exampleHtml = contextPhrase;
      }
    } else {
      exampleHtml = '-';
    }
  } else {
    exampleHtml = extractExampleHtml(params.wordUuid, params.contextPhrase || '-');
  }

  const content: FlashcardContent = {
    type: 'word',
    front: word,
    back: translationArr?.join('; ') || '-',
    reading: reading || word,
    pitchAccent,
    pos: params.token.partOfSpeech ?? params.token.type ?? '',
    level: params.level ?? -1,
    example: exampleHtml,
    exampleMeaning: '',
    imageUrl: screenshot,
    word,
    pronunciation: reading || word,
    translation: translationArr,
    definition: definitionHtml ?? (params.token.meaning ? [params.token.meaning] : undefined),
    screenshotUrl: screenshot,
  };

  return {
    content,
    ease: getEaseFromWordStatus(params.manualStatus),
  };
}