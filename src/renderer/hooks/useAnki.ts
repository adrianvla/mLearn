/**
 * AnkiConnect Hook
 * Integration with Anki via AnkiConnect plugin.
 * All requests are routed through the Electron web server proxy
 * to avoid CORS restrictions from AnkiConnect.
 */

import { createSignal } from 'solid-js';
import { useSettings } from '../context';

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

  /** Get the proxy URL that forwards to AnkiConnect (avoids CORS) */
  const getProxyUrl = (): string => settings.ankiUrl || 'http://127.0.0.1:7753/api/fwd-to-anki';

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

    const fields: Record<string, string> = {
      [fieldExpression]: params.word,
      [fieldMeaning]: params.meaning,
    };

    if (params.reading) {
      fields[fieldReading] = params.reading;
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
      return null;
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

  return {
    isConnected,
    decks,
    models,

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
  };
}

export interface AnkiNoteInfo {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
}
