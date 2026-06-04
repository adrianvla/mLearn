import type { FlashcardContent, DictionaryEntry, PitchData, Token, TranslationEntry } from '../../../shared/types';
import { WORD_STATUS, SRS_EASE, ANKI_EASE } from '../../../shared/constants';
import type { WordStatus } from '../../../shared/constants';
import type { AnkiWordStatusRecord } from '../../../shared/backends/types';
import { normalizeReading } from '../../../shared/utils/textUtils';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import { getLogger } from '../../../shared/utils/logger';
import { getBridge } from '../../../shared/bridges';
import { generateUUID } from '../../services/srsAlgorithm';
import { captureElementAndSave } from '../../services/canvasCapture';

const log = getLogger("renderer.components.wordHoverHelpers");

export type { WordStatus } from '../../../shared/constants';
export { WORD_STATUS_VALUES } from '../../../shared/constants';

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
  wordStatus: WordStatus;
  colourCodes: Record<string, string>;
  ocrCropPadding?: number;
  tokenize: (text: string) => Promise<Token[]>;
  /** When 'video', the caller will clip a video segment and attach it post-build */
  flashcardMediaType?: 'image' | 'video';
  /** Anki ease factor for Learning status (integer, e.g. 1550) */
  ankiLearningEase?: number;
  /** Anki ease factor for Known status (integer, e.g. 1800) */
  ankiKnownEase?: number;
  /** Built-in SRS ease for Learning status (float, e.g. 1.55) */
  srsLearningEase?: number;
  /** Built-in SRS ease for Known status (float, e.g. 1.8) */
  srsKnownEase?: number;
  screenshotDataUrl?: string;
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

const STATUS_RANK: Record<WordStatus, number> = { unknown: 0, learning: 1, known: 2 };

function getAnkiQueueTypeStatus(card: Pick<AnkiWordStatusRecord, 'queue' | 'type'>): WordStatus | null {
  if (card.queue === 2 || card.type === 2) {
    return 'known';
  }

  if (card.queue === 1 || card.queue === 3 || card.type === 1 || card.type === 3) {
    return 'learning';
  }

  if (card.queue === 0 || card.type === 0) {
    return 'unknown';
  }

  return null;
}

function getAnkiFactorStatus(
  factor: number | null | undefined,
  learningThreshold: number,
  knownThreshold: number,
): WordStatus | null {
  if (factor == null || factor <= 0) {
    return null;
  }

  if (factor >= knownThreshold) {
    return 'known';
  }

  if (factor >= learningThreshold) {
    return 'learning';
  }

  return 'unknown';
}

/** Resolve a word-level Anki status from cached card scheduling/factor metadata. */
export function getAnkiWordKnowledgeStatus(
  cards: readonly Pick<AnkiWordStatusRecord, 'factor' | 'queue' | 'type'>[] | null | undefined,
  learningThreshold: number,
  knownThreshold: number,
): WordStatus | null {
  if (!cards || cards.length === 0) {
    return null;
  }

  let bestStatus: WordStatus = 'unknown';

  for (const card of cards) {
    const queueTypeStatus = getAnkiQueueTypeStatus(card);
    const factorStatus = getAnkiFactorStatus(card.factor, learningThreshold, knownThreshold);
    const statuses = [queueTypeStatus, factorStatus].filter((status): status is WordStatus => status !== null);
    const cardStatus = statuses.length > 0
      ? statuses.reduce((best, current) => STATUS_RANK[current] > STATUS_RANK[best] ? current : best)
      : 'unknown';

    if (STATUS_RANK[cardStatus] > STATUS_RANK[bestStatus]) {
      bestStatus = cardStatus;
    }
  }

  return bestStatus;
}

export function getEaseFromWordStatus(
  status: WordStatus,
  srsLearningEase?: number,
  srsKnownEase?: number,
): number {
  switch (status) {
    case 'learning':
      return srsLearningEase ?? SRS_EASE.DEFAULT_LEARNING;
    case 'known':
      return srsKnownEase ?? SRS_EASE.DEFAULT_KNOWN;
    default:
      return SRS_EASE.MIN;
  }
}

/** Convert a WordStatus to the Anki integer ease factor (1000 = 1.0×). */
export function getAnkiEaseForStatus(
  status: WordStatus,
  ankiLearningEase: number,
  ankiKnownEase: number,
): number {
  switch (status) {
    case 'learning':
      return ankiLearningEase;
    case 'known':
      return ankiKnownEase;
    default:
      return ANKI_EASE.MIN;
  }
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

async function screenshotVideo(cardId: string): Promise<string> {
  const video = document.querySelector('video') as HTMLVideoElement | null;
  if (!video || video.readyState < 2) return '';
  return (await captureElementAndSave(video, cardId)) ?? '';
}

function extractExampleHtml(wordUuid: string | undefined, fallbackText: string): string {
  try {
    const subtitlesEl = document.querySelector('.subtitles, .subtitle-container');
    if (!subtitlesEl) {
      return fallbackText || '-';
    }

    const clone = subtitlesEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.subtitle_hover, .word-hover-container').forEach((element) => { element.remove(); });

    if (wordUuid) {
      const wordEl = clone.querySelector(`.subtitle_word.word_${wordUuid}, [data-uuid="${wordUuid}"]`);
      if (wordEl) {
        wordEl.classList.add('defined');
      }
    }

    return clone.innerHTML || fallbackText || '-';
  } catch (e) {
    log.error("error", e);
    return fallbackText || '-';
  }
}

async function captureOcrScreenshot(
  anchorRect: DOMRect | undefined,
  ocrImageElement: HTMLImageElement | null | undefined,
  ocrCropPadding?: number,
  cardId?: string,
): Promise<string> {
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

    // Fallback: try to find hovered word from DOM if anchorRect wasn't provided
    if (!anchorRect) {
      const hoveredWord = document.querySelector('.ocr-box.hovered .ocr-word, .ocr-word:hover, .ocr-box:hover .ocr-word');
      if (hoveredWord) {
        anchorRect = hoveredWord.getBoundingClientRect();
      }
    }

    // Last resort fallback: center crop of the image
    if (!anchorRect) {
      const fallbackRatio = 0.6;
      const fw = imageRect.width * fallbackRatio;
      const fh = imageRect.height * fallbackRatio;
      anchorRect = new DOMRect(
        imageRect.left + (imageRect.width - fw) / 2,
        imageRect.top + (imageRect.height - fh) / 2,
        fw,
        fh,
      );
    }

    const requestedPadding = ocrCropPadding ?? 200;
    const maxPadding = Math.floor(Math.min(imageRect.width, imageRect.height) / 3);
    const padding = Math.min(requestedPadding, maxPadding);
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

    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
    if (!cardId) return dataUrl;
    const saved = await getBridge().flashcards.saveFlashcardImage(cardId, dataUrl);
    return saved ?? '';
  } catch (e) {
    log.error("error", e);
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
  const cardId = generateUUID();
  let screenshot = '';
  if (params.screenshotDataUrl) {
    const saved = await getBridge().flashcards.saveFlashcardImage(cardId, params.screenshotDataUrl);
    screenshot = saved ?? '';
  } else if (params.isOcr) {
    screenshot = await captureOcrScreenshot(params.anchorRect, params.ocrImageElement, params.ocrCropPadding, cardId);
  } else {
    screenshot = await screenshotVideo(cardId);
  }

  let exampleHtml: string;
  if (params.isOcr) {
    const contextPhrase = params.contextPhrase || '';
    if (contextPhrase && contextPhrase !== '-') {
      try {
        const tokens = await params.tokenize(contextPhrase);
        exampleHtml = tokensToColoredHtml(tokens, params.colourCodes, word);
      } catch (e) {
        log.error("error", e);
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
    word,
    pronunciation: reading || word,
    translation: translationArr,
    definition: definitionHtml ?? (params.token.meaning ? [params.token.meaning] : undefined),
  };

  if (screenshot) {
    content.imageUrl = screenshot;
    content.screenshotUrl = screenshot;
  }

  return {
    content,
    ease: getEaseFromWordStatus(params.wordStatus, params.srsLearningEase, params.srsKnownEase),
  };
}