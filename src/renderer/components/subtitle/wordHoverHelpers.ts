import type { FlashcardContent, DictionaryEntry, FlashcardProsody, LanguageData, Token, TranslationEntry } from '../../../shared/types';
import { WORD_STATUS, SRS_EASE, ANKI_EASE } from '../../../shared/constants';
import type { WordStatus } from '../../../shared/constants';
import type { AnkiWordStatusRecord } from '../../../shared/backends/types';
import type { WordLookupCandidateOptions } from '../../hooks/useTranslation';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import { getLogger } from '../../../shared/utils/logger';
import { getBridge } from '../../../shared/bridges';
import { generateUUID } from '../../services/srsAlgorithm';
import { captureElementAndSave } from '../../services/canvasCapture';
import { extractDefinitionValues, extractReadingValue } from '../../utils/translationCacheParsers';
import {
  extractProsodyFromTranslationData,
  normalizeDictionaryReading,
} from '../../utils/readingProsody';
import {
  getLanguageProsodyType,
  getProsodyDisplayValueFromProsody,
  getProsodyPositionFromOverride,
  getProsodyPositionLabel,
} from '../../../shared/languageFeatures';
import { getProsodyOverlayRenderer, type ProsodyOverlayRenderer } from '../../utils/prosodyPresentation';

const log = getLogger("renderer.components.wordHoverHelpers");

export type { WordStatus } from '../../../shared/constants';
export { WORD_STATUS_VALUES } from '../../../shared/constants';

export interface WordHoverTranslationData {
  data?: unknown[];
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
  level?: number | null;
  wordStatus: WordStatus;
  colourCodes: Record<string, string>;
  languageData?: LanguageData | null;
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

export function extractReadingFromEntries(entries: unknown[], languageData?: LanguageData | null): string {
  if (!Array.isArray(entries)) return '';
  return extractReadingValue(entries, languageData) ?? '';
}

export interface ResolveProsodyForHoverOptions {
  word: string;
  reading?: string | null;
  translationData?: WordHoverTranslationData;
  showProsody: boolean;
  getCanonicalForm: (word: string) => string;
  getWordVariants?: (word: string) => string[];
  getCachedTranslation: (word: string, language?: string, lookupOptions?: WordLookupCandidateOptions) => WordHoverTranslationData | null;
  language?: string;
  languageData?: LanguageData | null;
  dictionaryTargetLanguage?: string | (() => string | undefined);
  fallbackLabel: string;
}

export interface ResolvedProsodyForHover {
  type: NonNullable<FlashcardProsody['type']>;
  renderer: 'inline-overlay' | 'label';
  overlayRenderer?: ProsodyOverlayRenderer;
  position?: number;
  reading?: string;
  label?: string;
  value?: string;
}

function resolveProsodyFromTranslationData(
  data: WordHoverTranslationData | undefined,
  languageData: LanguageData | null | undefined,
  fallbackLabel: string,
  word: string,
  reading?: string | null,
): ResolvedProsodyForHover | null {
  const prosodyType = getLanguageProsodyType(languageData);
  if (!prosodyType) return null;

  const normalizedReading = normalizeDictionaryReading(
    reading || extractReadingFromEntries(data?.data || [], languageData),
    languageData,
  );
  const overlayRenderer = getProsodyOverlayRenderer(languageData, prosodyType);
  const candidates = [
    normalizedReading ? extractProsodyFromTranslationData(data, languageData, normalizedReading) : undefined,
    reading && normalizeDictionaryReading(reading, languageData) !== normalizedReading
      ? extractProsodyFromTranslationData(data, languageData, reading)
      : undefined,
    extractProsodyFromTranslationData(data, languageData),
  ];
  const prosody = candidates.find((candidate) => {
    if (!candidate || candidate.type !== prosodyType) return false;
    if (overlayRenderer) return getProsodyPositionFromOverride(null, candidate) !== null;
    return Boolean(getProsodyDisplayValueFromProsody(candidate));
  });
  if (!prosody || prosody.type !== prosodyType) return null;

  const position = getProsodyPositionFromOverride(null, prosody);
  if (overlayRenderer) {
    if (position === null) return null;

    return {
      type: prosodyType,
      renderer: 'inline-overlay',
      overlayRenderer,
      position,
      reading: normalizedReading || word,
    };
  }

  const value = getProsodyDisplayValueFromProsody(prosody);
  if (!value) return null;

  return {
    type: prosodyType,
    renderer: 'label',
    label: getProsodyPositionLabel(languageData) ?? fallbackLabel,
    value,
    ...(position !== null ? { position } : {}),
  };
}

export function resolveProsodyForHover(
  options: ResolveProsodyForHoverOptions,
): ResolvedProsodyForHover | null {
  if (!options.showProsody || !getLanguageProsodyType(options.languageData)) return null;

  const current = resolveProsodyFromTranslationData(
    options.translationData,
    options.languageData,
    options.fallbackLabel,
    options.word,
    options.reading,
  );
  if (current) return current;

  const canonical = options.getCanonicalForm(options.word);
  if (!canonical || canonical === options.word) return null;

  const cached = options.getCachedTranslation(canonical, options.language, {
    getCanonicalForm: options.getCanonicalForm,
    getWordVariants: options.getWordVariants,
    dictionaryTargetLanguage: options.dictionaryTargetLanguage,
    languageData: options.languageData,
  });

  return resolveProsodyFromTranslationData(
    cached ?? undefined,
    options.languageData,
    options.fallbackLabel,
    options.word,
    options.reading,
  );
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
    const firstDefinitions = extractDefinitionValues(firstEntry, params.languageData);
    if (firstDefinitions.length > 0) translationArr = firstDefinitions;

    const secondEntry = translationItems[1] as TranslationEntry | undefined;
    const secondDefinitions = extractDefinitionValues(secondEntry, params.languageData, { stripHtml: false });
    if (secondDefinitions.length > 0) definitionHtml = secondDefinitions;
  }

  if (!translationArr && params.entry?.meanings) {
    translationArr = [params.entry.meanings.join('; ')];
  }

  const firstEntry = translationItems?.[0] as TranslationEntry | undefined;
  const rawReading = normalizeDictionaryReading(extractReadingValue(firstEntry, params.languageData) || params.token.reading || '', params.languageData);
  const reading = rawReading && rawReading !== word ? rawReading : '';
  const prosody = extractProsodyFromTranslationData(params.translationData, params.languageData, reading);
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
        exampleHtml = tokensToColoredHtml(tokens, params.colourCodes, word, params.languageData);
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
    reading: reading || undefined,
    prosody,
    pos: params.token.partOfSpeech ?? params.token.type ?? '',
    level: params.level ?? undefined,
    example: exampleHtml,
    exampleMeaning: '',
    word,
    pronunciation: reading || undefined,
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
