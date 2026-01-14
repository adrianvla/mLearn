/**
 * AnkiConnect Hook
 * Integration with Anki via AnkiConnect plugin
 */

import { createSignal } from 'solid-js';
import { useSettings } from '../context';

const ANKI_CONNECT_URL = 'http://localhost:8765';
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

// Make a request to AnkiConnect
async function ankiRequest<T>(action: string, params?: Record<string, unknown>): Promise<T> {
  const request: AnkiRequest = {
    action,
    version: ANKI_CONNECT_VERSION,
  };

  if (params) {
    request.params = params;
  }

  const response = await fetch(ANKI_CONNECT_URL, {
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

  // Check if AnkiConnect is available
  const checkConnection = async (): Promise<boolean> => {
    try {
      await ankiRequest('version');
      setIsConnected(true);
      return true;
    } catch {
      setIsConnected(false);
      return false;
    }
  };

  // Get available decks
  const fetchDecks = async (): Promise<string[]> => {
    try {
      const deckNames = await ankiRequest<string[]>('deckNames');
      setDecks(deckNames);
      return deckNames;
    } catch (e) {
      console.error('Failed to fetch decks:', e);
      return [];
    }
  };

  // Get available note models
  const fetchModels = async (): Promise<string[]> => {
    try {
      const modelNames = await ankiRequest<string[]>('modelNames');
      setModels(modelNames);
      return modelNames;
    } catch (e) {
      console.error('Failed to fetch models:', e);
      return [];
    }
  };

  // Get model field names
  const getModelFields = async (modelName: string): Promise<string[]> => {
    try {
      return await ankiRequest<string[]>('modelFieldNames', { modelName });
    } catch (e) {
      console.error('Failed to fetch model fields:', e);
      return [];
    }
  };

  // Create a new deck
  const createDeck = async (deckName: string): Promise<number | null> => {
    try {
      return await ankiRequest<number>('createDeck', { deck: deckName });
    } catch (e) {
      console.error('Failed to create deck:', e);
      return null;
    }
  };

  // Add a note to Anki
  const addNote = async (params: {
    word: string;
    reading?: string;
    meaning: string;
    sentence?: string;
    sentenceMeaning?: string;
    audioUrl?: string;
    imageUrl?: string;
  }): Promise<number | null> => {
    const deckName = settings.ankiDeckName || 'mLearn';
    const modelName = settings.ankiModelName || 'Basic';

    // Build fields based on model
    // This is a simplified version - the actual implementation would map to specific fields
    const fields: Record<string, string> = {
      Front: params.word,
      Back: params.meaning,
    };

    // Add reading if available
    if (params.reading) {
      fields.Reading = params.reading;
    }

    // Add sentence if available
    if (params.sentence) {
      fields.Sentence = params.sentence;
    }

    // Build note
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

    // Add audio if available
    if (params.audioUrl) {
      note.audio = [{
        url: params.audioUrl,
        filename: `${params.word}.mp3`,
        fields: ['Audio'],
      }];
    }

    // Add image if available
    if (params.imageUrl) {
      note.picture = [{
        url: params.imageUrl,
        filename: `${params.word}.png`,
        fields: ['Picture'],
      }];
    }

    try {
      return await ankiRequest<number>('addNote', { note });
    } catch (e) {
      console.error('Failed to add note:', e);
      return null;
    }
  };

  // Check if a note already exists
  const checkDuplicate = async (word: string, deckName?: string): Promise<boolean> => {
    const deck = deckName || settings.ankiDeckName || 'mLearn';
    
    try {
      const notes = await ankiRequest<number[]>('findNotes', {
        query: `deck:"${deck}" front:"${word}"`,
      });
      return notes.length > 0;
    } catch {
      return false;
    }
  };

  // Sync with Anki (trigger sync)
  const sync = async (): Promise<void> => {
    try {
      await ankiRequest('sync');
    } catch (e) {
      console.error('Failed to sync Anki:', e);
    }
  };

  // Open Anki GUI to specific deck
  const openDeck = async (deckName: string): Promise<void> => {
    try {
      await ankiRequest('guiDeckBrowser');
      await ankiRequest('guiSelectDeck', { deck: deckName });
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
    checkDuplicate,
    sync,
    openDeck,
  };
}
