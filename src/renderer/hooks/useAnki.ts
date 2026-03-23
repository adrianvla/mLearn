/**
 * AnkiConnect Hook
 * Integration with Anki via AnkiConnect plugin.
 * All requests are routed through the Electron web server proxy
 * to avoid CORS restrictions from AnkiConnect.
 */

import { createSignal } from 'solid-js';
import { useSettings } from '../context';
import { PROXY_SERVER_PORT } from '../../shared/constants';
import { getBackend } from '../../shared/backends';

const ANKI_CONNECT_VERSION = 6;

interface AnkiRequest {
  action: string;
  version: number;
  params?: Record<string, unknown>;
}

interface AnkiResponse<T = unknown> {
  result: T;
  error: string | null;
}

/** Send a request to AnkiConnect via the Electron web server proxy */
async function ankiRequest<T>(proxyUrl: string, action: string, params?: Record<string, unknown>): Promise<T> {
  const request: AnkiRequest = {
    action,
    version: ANKI_CONNECT_VERSION,
  };

  if (params) {
    request.params = params;
  }

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect request failed: ${response.status}`);
  }

  const data: AnkiResponse<T> = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
}

export function useAnki() {
  const { settings } = useSettings();
  const [isConnected, setIsConnected] = createSignal(false);
  const [decks, setDecks] = createSignal<string[]>([]);
  const [models, setModels] = createSignal<string[]>([]);
  const [ankiWords, setAnkiWords] = createSignal<Set<string>>(new Set());

  /** Get the proxy URL that forwards to AnkiConnect (avoids CORS) */
  const getProxyUrl = (): string => settings.ankiUrl || `http://127.0.0.1:${PROXY_SERVER_PORT}/api/fwd-to-anki`;

  const checkConnection = async (): Promise<boolean> => {
    try {
      await ankiRequest(getProxyUrl(), 'version');
      setIsConnected(true);
      return true;
    } catch {
      setIsConnected(false);
      return false;
    }
  };

  const fetchDecks = async (): Promise<string[]> => {
    try {
      const deckNames = await ankiRequest<string[]>(getProxyUrl(), 'deckNames');
      setDecks(deckNames);
      return deckNames;
    } catch (e) {
      console.error('Failed to fetch decks:', e);
      return [];
    }
  };

  const fetchModels = async (): Promise<string[]> => {
    try {
      const modelNames = await ankiRequest<string[]>(getProxyUrl(), 'modelNames');
      setModels(modelNames);
      return modelNames;
    } catch (e) {
      console.error('Failed to fetch models:', e);
      return [];
    }
  };

  const getModelFields = async (modelName: string): Promise<string[]> => {
    try {
      return await ankiRequest<string[]>(getProxyUrl(), 'modelFieldNames', { modelName });
    } catch (e) {
      console.error('Failed to fetch model fields:', e);
      return [];
    }
  };

  const createDeck = async (deckName: string): Promise<number | null> => {
    try {
      return await ankiRequest<number>(getProxyUrl(), 'createDeck', { deck: deckName });
    } catch (e) {
      console.error('Failed to create deck:', e);
      return null;
    }
  };

  const addNote = async (params: {
    word: string;
    reading?: string;
    meaning: string;
    sentence?: string;
    sentenceMeaning?: string;
    audioUrl?: string;
    imageUrl?: string;
  }): Promise<number | null> => {
    const deckName = settings.flashcard_deck || settings.ankiDeckName || 'mLearn';
    const modelName = settings.anki_model_name || 'Basic';
    const fieldExpression = settings.anki_field_expression || 'Expression';
    const fieldReading = settings.anki_field_reading || 'Reading';
    const fieldMeaning = settings.anki_field_meaning || 'Meaning';

    // Apply templates — replace placeholders with actual values
    const applyTemplate = (template: string): string => {
      return template
        .replace(/\{word\}/g, params.word)
        .replace(/\{reading\}/g, params.reading || '')
        .replace(/\{meaning\}/g, params.meaning)
        .replace(/\{example\}/g, params.sentence || '')
        .replace(/\{exampleMeaning\}/g, params.sentenceMeaning || '');
    };

    const templateExpression = settings.ankiTemplateExpression || '{word}';
    const templateReading = settings.ankiTemplateReading || '{reading}';
    const templateMeaning = settings.ankiTemplateMeaning || '{meaning}';

    // Ensure the deck exists before adding
    try {
      await ankiRequest(getProxyUrl(), 'createDeck', { deck: deckName });
    } catch {
      // Ignore - deck may already exist
    }

    const fields: Record<string, string> = {
      [fieldExpression]: applyTemplate(templateExpression),
      [fieldMeaning]: applyTemplate(templateMeaning),
    };

    if (fieldReading) {
      fields[fieldReading] = applyTemplate(templateReading);
    }

    const note: Record<string, unknown> = {
      deckName,
      modelName,
      fields,
      options: {
        allowDuplicate: false,
        duplicateScope: 'deck',
      },
      tags: ['mlearn'],
    };

    if (params.audioUrl) {
      note.audio = [{
        url: params.audioUrl,
        filename: `${params.word}.mp3`,
        fields: ['Audio'],
      }];
    }

    if (params.imageUrl) {
      note.picture = [{
        url: params.imageUrl,
        filename: `${params.word}.png`,
        fields: ['Picture'],
      }];
    }

    try {
      return await ankiRequest<number>(getProxyUrl(), 'addNote', { note });
    } catch (e) {
      console.error('Failed to add note:', e);
      throw new Error(`Failed to add note: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const findNotes = async (word: string, deckName?: string): Promise<number[]> => {
    const deck = deckName || settings.flashcard_deck || settings.ankiDeckName || 'mLearn';
    const fieldExpression = settings.anki_field_expression || 'Expression';
    try {
      return await ankiRequest<number[]>(getProxyUrl(), 'findNotes', {
        query: `deck:"${deck}" "${fieldExpression}:${word}"`,
      });
    } catch {
      return [];
    }
  };

  const checkDuplicate = async (word: string, deckName?: string): Promise<boolean> => {
    const notes = await findNotes(word, deckName);
    return notes.length > 0;
  };

  const getNotesInfo = async (noteIds: number[]): Promise<AnkiNoteInfo[]> => {
    if (noteIds.length === 0) return [];
    try {
      return await ankiRequest<AnkiNoteInfo[]>(getProxyUrl(), 'notesInfo', { notes: noteIds });
    } catch (e) {
      console.error('Failed to get notes info:', e);
      return [];
    }
  };

  /** Fetch a sample note from a given model for field preview */
  const fetchSampleNote = async (modelName: string): Promise<AnkiNoteInfo | null> => {
    try {
      const noteIds = await ankiRequest<number[]>(getProxyUrl(), 'findNotes', {
        query: `note:"${modelName}"`,
      });
      if (noteIds.length === 0) return null;
      const notes = await ankiRequest<AnkiNoteInfo[]>(getProxyUrl(), 'notesInfo', {
        notes: [noteIds[0]],
      });
      return notes.length > 0 ? notes[0] : null;
    } catch (e) {
      console.error('Failed to fetch sample note:', e);
      return null;
    }
  };

  const sync = async (): Promise<void> => {
    try {
      await ankiRequest(getProxyUrl(), 'sync');
    } catch (e) {
      console.error('Failed to sync Anki:', e);
    }
  };

  const openDeck = async (deckName: string): Promise<void> => {
    try {
      await ankiRequest(getProxyUrl(), 'guiDeckBrowser');
      await ankiRequest(getProxyUrl(), 'guiSelectDeck', { deck: deckName });
    } catch (e) {
      console.error('Failed to open deck in Anki:', e);
    }
  };

  /** Fetch all words currently in Anki from the Python backend cache */
  const fetchAnkiWords = async (): Promise<Set<string>> => {
    try {
      const words = await getBackend().getAnkiWords();
      const wordSet = new Set<string>(words);
      setAnkiWords(wordSet);
      return wordSet;
    } catch (e) {
      console.error('Failed to fetch Anki words from backend:', e);
      return new Set();
    }
  };

  /** Check if a word exists in the Anki cache */
  const isWordInAnki = (word: string): boolean => {
    return ankiWords().has(word);
  };

  /** Find card IDs matching a query */
  const findCards = async (query: string): Promise<number[]> => {
    try {
      return await ankiRequest<number[]>(getProxyUrl(), 'findCards', { query });
    } catch {
      return [];
    }
  };

  /** Get detailed info for cards by their IDs */
  const getCardsInfo = async (cardIds: number[]): Promise<AnkiCardInfo[]> => {
    if (cardIds.length === 0) return [];
    try {
      return await ankiRequest<AnkiCardInfo[]>(getProxyUrl(), 'cardsInfo', { cards: cardIds });
    } catch (e) {
      console.error('Failed to get cards info:', e);
      return [];
    }
  };

  /** Set ease factors for multiple cards (Anki integer scale, e.g. 2500 = 2.5×) */
  const setEaseFactors = async (cardIds: number[], easeFactors: number[]): Promise<boolean[]> => {
    try {
      return await ankiRequest<boolean[]>(getProxyUrl(), 'setEaseFactors', {
        cards: cardIds,
        easeFactors,
      });
    } catch (e) {
      console.error('Failed to set ease factors:', e);
      return cardIds.map(() => false);
    }
  };

  /** Set due date for cards. days = "0" makes them due today. */
  const setDueDate = async (cardIds: number[], days: string): Promise<boolean> => {
    try {
      await ankiRequest(getProxyUrl(), 'setDueDate', { cards: cardIds, days });
      return true;
    } catch (e) {
      console.error('Failed to set due date:', e);
      return false;
    }
  };

  /**
   * Find all Anki cards for a given word in the configured deck.
   * Returns card IDs for all card types (e.g. Reading + Listening).
   */
  const findCardsForWord = async (word: string): Promise<number[]> => {
    const deck = settings.flashcard_deck || settings.ankiDeckName || 'mLearn';
    const fieldExpression = settings.anki_field_expression || 'Expression';
    return findCards(`deck:"${deck}" "${fieldExpression}:${word}"`);
  };

  /**
   * Update Anki cards for a word: set ease and reposition new cards to front.
   * Handles multiple card types (Reading, Listening, etc.) for the same word.
   */
  const updateWordCards = async (word: string, ankiEase: number): Promise<{ updated: number; repositioned: number }> => {
    const cardIds = await findCardsForWord(word);
    if (cardIds.length === 0) return { updated: 0, repositioned: 0 };

    const cardsInfo = await getCardsInfo(cardIds);
    if (cardsInfo.length === 0) return { updated: 0, repositioned: 0 };

    // Set ease for all cards
    const easeFactors = cardIds.map(() => ankiEase);
    await setEaseFactors(cardIds, easeFactors);

    // For new/unseen cards (type=0, queue=0), make them due today
    const newCardIds = cardsInfo
      .filter(c => c.type === 0 || c.queue === 0)
      .map(c => c.cardId);

    let repositioned = 0;
    if (newCardIds.length > 0) {
      const success = await setDueDate(newCardIds, '0');
      if (success) repositioned = newCardIds.length;
    }

    return { updated: cardIds.length, repositioned };
  };

  return {
    isConnected,
    decks,
    models,
    ankiWords,

    checkConnection,
    fetchDecks,
    fetchModels,
    getModelFields,
    createDeck,
    addNote,
    findNotes,
    checkDuplicate,
    getNotesInfo,
    fetchSampleNote,
    sync,
    openDeck,
    fetchAnkiWords,
    isWordInAnki,
    findCards,
    getCardsInfo,
    setEaseFactors,
    setDueDate,
    findCardsForWord,
    updateWordCards,
  };
}

export interface AnkiNoteInfo {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
}

export interface AnkiCardInfo {
  cardId: number;
  /** 0 = new, 1 = learning, 2 = review, 3 = relearning */
  type: number;
  /** 0 = new, 1 = learning, 2 = review, 3 = day-learn, -1 = suspended, -2 = buried, -3 = buried (sched) */
  queue: number;
  /** For new cards: position in new queue. For review: days since epoch. */
  due: number;
  /** Ease factor (integer, e.g. 2500 = 2.5×) */
  factor: number;
  /** Inter-review interval in days */
  interval: number;
  note: number;
  fields: Record<string, { value: string; order: number }>;
}
