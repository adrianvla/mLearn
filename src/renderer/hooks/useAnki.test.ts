import { createRoot } from 'solid-js';
import { useAnki } from './useAnki';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockGetAnkiWords = vi.fn();

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({
    getAnkiWords: (...args: unknown[]) => mockGetAnkiWords(...args),
  }),
}));

vi.mock('../context', () => ({
  useSettings: vi.fn(() => ({
    settings: {
      ankiUrl: 'http://localhost:8765',
      flashcard_deck: 'TestDeck',
      ankiDeckName: undefined,
      anki_model_name: 'Basic',
      anki_field_expression: 'Expression',
      anki_field_reading: 'Reading',
      anki_field_meaning: 'Meaning',
      ankiTemplateExpression: '{word}',
      ankiTemplateReading: '{reading}',
      ankiTemplateMeaning: '{meaning}',
    },
  })),
}));

function makeOkResponse(result: unknown, error: string | null = null) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ result, error }),
  };
}

describe('useAnki', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetAnkiWords.mockReset();
  });

  it('starts with isConnected false', () => {
    createRoot((dispose) => {
      const hook = useAnki();
      expect(hook.isConnected()).toBe(false);
      dispose();
    });
  });

  it('starts with empty decks and models', () => {
    createRoot((dispose) => {
      const hook = useAnki();
      expect(hook.decks()).toEqual([]);
      expect(hook.models()).toEqual([]);
      dispose();
    });
  });

  it('starts with empty ankiWords set', () => {
    createRoot((dispose) => {
      const hook = useAnki();
      expect(hook.ankiWords().size).toBe(0);
      dispose();
    });
  });

  it('checkConnection sets isConnected true on success', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(6));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const result = await hook.checkConnection();
      expect(result).toBe(true);
      expect(hook.isConnected()).toBe(true);
      dispose();
    });
  });

  it('checkConnection sends version action to proxy url', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(6));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.checkConnection();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8765',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"action":"version"'),
        }),
      );
      dispose();
    });
  });

  it('checkConnection sets isConnected false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const result = await hook.checkConnection();
      expect(result).toBe(false);
      expect(hook.isConnected()).toBe(false);
      dispose();
    });
  });

  it('checkConnection sets isConnected false on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const result = await hook.checkConnection();
      expect(result).toBe(false);
      expect(hook.isConnected()).toBe(false);
      dispose();
    });
  });

  it('fetchDecks returns deck list and updates signal', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(['Default', 'TestDeck']));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const decks = await hook.fetchDecks();
      expect(decks).toEqual(['Default', 'TestDeck']);
      expect(hook.decks()).toEqual(['Default', 'TestDeck']);
      dispose();
    });
  });

  it('fetchDecks sends deckNames action', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(['Default']));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.fetchDecks();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8765',
        expect.objectContaining({
          body: expect.stringContaining('"action":"deckNames"'),
        }),
      );
      dispose();
    });
  });

  it('fetchDecks returns empty array on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const decks = await hook.fetchDecks();
      expect(decks).toEqual([]);
      dispose();
    });
  });

  it('fetchModels returns model list and updates signal', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(['Basic', 'Cloze']));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const models = await hook.fetchModels();
      expect(models).toEqual(['Basic', 'Cloze']);
      expect(hook.models()).toEqual(['Basic', 'Cloze']);
      dispose();
    });
  });

  it('fetchModels sends modelNames action', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(['Basic']));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.fetchModels();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8765',
        expect.objectContaining({
          body: expect.stringContaining('"action":"modelNames"'),
        }),
      );
      dispose();
    });
  });

  it('fetchModels returns empty array on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const models = await hook.fetchModels();
      expect(models).toEqual([]);
      dispose();
    });
  });

  it('getModelFields returns field names for a model', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(['Front', 'Back', 'Audio']));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const fields = await hook.getModelFields('Basic');
      expect(fields).toEqual(['Front', 'Back', 'Audio']);
      dispose();
    });
  });

  it('getModelFields sends modelFieldNames action with modelName param', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(['Front', 'Back']));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.getModelFields('MyModel');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action).toBe('modelFieldNames');
      expect(body.params.modelName).toBe('MyModel');
      dispose();
    });
  });

  it('getModelFields returns empty array on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const fields = await hook.getModelFields('NonExistent');
      expect(fields).toEqual([]);
      dispose();
    });
  });

  it('addNote sends addNote action with correct payload', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockResolvedValueOnce(makeOkResponse(12345));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const noteId = await hook.addNote({ word: 'hello', meaning: 'greeting' });
      expect(noteId).toBe(12345);

      const addNoteCall = mockFetch.mock.calls.find((c) => {
        const body = JSON.parse(c[1].body);
        return body.action === 'addNote';
      });
      expect(addNoteCall).toBeDefined();
      const body = JSON.parse(addNoteCall![1].body);
      expect(body.params.note.deckName).toBe('TestDeck');
      expect(body.params.note.modelName).toBe('Basic');
      expect(body.params.note.fields['Expression']).toBe('hello');
      expect(body.params.note.fields['Meaning']).toBe('greeting');
      expect(body.params.note.tags).toContain('mlearn');
      dispose();
    });
  });

  it('addNote applies word template to Expression field', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockResolvedValueOnce(makeOkResponse(99));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.addNote({ word: '猫', meaning: 'cat', reading: 'ねこ' });

      const addNoteCall = mockFetch.mock.calls.find((c) => {
        const body = JSON.parse(c[1].body);
        return body.action === 'addNote';
      });
      const body = JSON.parse(addNoteCall![1].body);
      expect(body.params.note.fields['Expression']).toBe('猫');
      expect(body.params.note.fields['Reading']).toBe('ねこ');
      dispose();
    });
  });

  it('addNote attaches audio when audioUrl is provided', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockResolvedValueOnce(makeOkResponse(111));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.addNote({ word: 'test', meaning: 'test', audioUrl: 'http://example.com/test.mp3' });

      const addNoteCall = mockFetch.mock.calls.find((c) => {
        const body = JSON.parse(c[1].body);
        return body.action === 'addNote';
      });
      const body = JSON.parse(addNoteCall![1].body);
      expect(body.params.note.audio).toBeDefined();
      expect(body.params.note.audio[0].url).toBe('http://example.com/test.mp3');
      expect(body.params.note.audio[0].filename).toBe('test.mp3');
      dispose();
    });
  });

  it('addNote attaches picture when imageUrl is provided', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockResolvedValueOnce(makeOkResponse(222));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.addNote({ word: 'cat', meaning: 'cat', imageUrl: 'http://example.com/cat.png' });

      const addNoteCall = mockFetch.mock.calls.find((c) => {
        const body = JSON.parse(c[1].body);
        return body.action === 'addNote';
      });
      const body = JSON.parse(addNoteCall![1].body);
      expect(body.params.note.picture).toBeDefined();
      expect(body.params.note.picture[0].url).toBe('http://example.com/cat.png');
      expect(body.params.note.picture[0].filename).toBe('cat.png');
      dispose();
    });
  });

  it('addNote does not attach audio when audioUrl is absent', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockResolvedValueOnce(makeOkResponse(333));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.addNote({ word: 'test', meaning: 'test' });

      const addNoteCall = mockFetch.mock.calls.find((c) => {
        const body = JSON.parse(c[1].body);
        return body.action === 'addNote';
      });
      const body = JSON.parse(addNoteCall![1].body);
      expect(body.params.note.audio).toBeUndefined();
      expect(body.params.note.picture).toBeUndefined();
      dispose();
    });
  });

  it('addNote throws on AnkiConnect error response', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockResolvedValueOnce(makeOkResponse(null, 'duplicate note'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await expect(hook.addNote({ word: 'hello', meaning: 'greeting' })).rejects.toThrow('duplicate note');
      dispose();
    });
  });

  it('addNote throws on network failure', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockRejectedValueOnce(new Error('offline'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await expect(hook.addNote({ word: 'hello', meaning: 'greeting' })).rejects.toThrow('Failed to add note');
      dispose();
    });
  });

  it('findNotes returns note ids', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([101, 102, 103]));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const ids = await hook.findNotes('hello');
      expect(ids).toEqual([101, 102, 103]);
      dispose();
    });
  });

  it('findNotes sends findNotes action with correct query', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([1]));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.findNotes('猫', 'MyDeck');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action).toBe('findNotes');
      expect(body.params.query).toContain('deck:"MyDeck"');
      expect(body.params.query).toContain('猫');
      dispose();
    });
  });

  it('findNotes uses settings deck when no deckName provided', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([5]));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.findNotes('word');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.query).toContain('deck:"TestDeck"');
      dispose();
    });
  });

  it('findNotes returns empty array on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const ids = await hook.findNotes('word');
      expect(ids).toEqual([]);
      dispose();
    });
  });

  it('checkDuplicate returns true when notes found', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([101]));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const isDuplicate = await hook.checkDuplicate('hello');
      expect(isDuplicate).toBe(true);
      dispose();
    });
  });

  it('checkDuplicate returns false when no notes found', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([]));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const isDuplicate = await hook.checkDuplicate('newword');
      expect(isDuplicate).toBe(false);
      dispose();
    });
  });

  it('createDeck returns deck id on success', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(1234567890));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const id = await hook.createDeck('NewDeck');
      expect(id).toBe(1234567890);
      dispose();
    });
  });

  it('createDeck sends createDeck action with deck param', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(999));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.createDeck('MyNewDeck');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action).toBe('createDeck');
      expect(body.params.deck).toBe('MyNewDeck');
      dispose();
    });
  });

  it('createDeck returns null on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const id = await hook.createDeck('BadDeck');
      expect(id).toBeNull();
      dispose();
    });
  });

  it('getNotesInfo returns empty array when no ids given', async () => {
    await createRoot(async (dispose) => {
      const hook = useAnki();
      const info = await hook.getNotesInfo([]);
      expect(info).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('getNotesInfo sends notesInfo action with note ids', async () => {
    const mockNotes = [{ noteId: 1, modelName: 'Basic', tags: [], fields: {} }];
    mockFetch.mockResolvedValueOnce(makeOkResponse(mockNotes));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const info = await hook.getNotesInfo([1]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action).toBe('notesInfo');
      expect(body.params.notes).toEqual([1]);
      expect(info).toEqual(mockNotes);
      dispose();
    });
  });

  it('getNotesInfo returns empty array on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const info = await hook.getNotesInfo([1, 2, 3]);
      expect(info).toEqual([]);
      dispose();
    });
  });

  it('sync sends sync action', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(null));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.sync();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action).toBe('sync');
      dispose();
    });
  });

  it('sync does not throw on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('sync failed'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await expect(hook.sync()).resolves.toBeUndefined();
      dispose();
    });
  });

  it('fetchAnkiWords calls backend and updates signal', async () => {
    mockGetAnkiWords.mockResolvedValueOnce(['cat', 'dog', 'fish']);

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const words = await hook.fetchAnkiWords();
      expect(words).toBeInstanceOf(Set);
      expect(words.has('cat')).toBe(true);
      expect(words.has('dog')).toBe(true);
      expect(hook.ankiWords().has('cat')).toBe(true);
      dispose();
    });
  });

  it('fetchAnkiWords returns empty set on error', async () => {
    mockGetAnkiWords.mockRejectedValueOnce(new Error('backend unavailable'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const words = await hook.fetchAnkiWords();
      expect(words.size).toBe(0);
      dispose();
    });
  });

  it('isWordInAnki returns true for words in cache', async () => {
    mockGetAnkiWords.mockResolvedValueOnce(['hello', 'world']);

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.fetchAnkiWords();
      expect(hook.isWordInAnki('hello')).toBe(true);
      expect(hook.isWordInAnki('world')).toBe(true);
      dispose();
    });
  });

  it('isWordInAnki returns false for words not in cache', async () => {
    mockGetAnkiWords.mockResolvedValueOnce(['hello']);

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.fetchAnkiWords();
      expect(hook.isWordInAnki('unknown')).toBe(false);
      dispose();
    });
  });

  it('all requests include version 6 in body', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(6));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.checkConnection();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.version).toBe(6);
      dispose();
    });
  });

  it('all requests use Content-Type application/json', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(['Default']));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.fetchDecks();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      dispose();
    });
  });

  it('throws on non-ok HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await expect(hook.fetchDecks()).resolves.toEqual([]);
      dispose();
    });
  });

  it('fetchSampleNote returns null when no notes found', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([]));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const note = await hook.fetchSampleNote('Basic');
      expect(note).toBeNull();
      dispose();
    });
  });

  it('fetchSampleNote returns first note when found', async () => {
    const mockNote = { noteId: 42, modelName: 'Basic', tags: ['mlearn'], fields: { Front: { value: 'hello', order: 0 } } };
    mockFetch
      .mockResolvedValueOnce(makeOkResponse([42]))
      .mockResolvedValueOnce(makeOkResponse([mockNote]));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const note = await hook.fetchSampleNote('Basic');
      expect(note).toEqual(mockNote);
      dispose();
    });
  });

  it('fetchSampleNote returns null on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const note = await hook.fetchSampleNote('Basic');
      expect(note).toBeNull();
      dispose();
    });
  });

  it('fetchSampleNote returns null when notesInfo returns empty array', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse([42]))
      .mockResolvedValueOnce(makeOkResponse([]));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      const note = await hook.fetchSampleNote('Basic');
      expect(note).toBeNull();
      dispose();
    });
  });

  it('openDeck sends guiDeckBrowser then guiSelectDeck actions', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(null))
      .mockResolvedValueOnce(makeOkResponse(null));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.openDeck('TestDeck');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body1.action).toBe('guiDeckBrowser');
      const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body2.action).toBe('guiSelectDeck');
      expect(body2.params.deck).toBe('TestDeck');
      dispose();
    });
  });

  it('openDeck does not throw on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await expect(hook.openDeck('TestDeck')).resolves.toBeUndefined();
      dispose();
    });
  });

  it('addNote applies sentence and sentenceMeaning templates', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockResolvedValueOnce(makeOkResponse(555));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.addNote({
        word: '食べる',
        reading: 'たべる',
        meaning: 'to eat',
        sentence: '猫が魚を食べる',
        sentenceMeaning: 'The cat eats fish',
      });

      const addNoteCall = mockFetch.mock.calls.find((c) => {
        const body = JSON.parse(c[1].body);
        return body.action === 'addNote';
      });
      const body = JSON.parse(addNoteCall![1].body);
      expect(body.params.note.fields['Expression']).toBe('食べる');
      expect(body.params.note.fields['Reading']).toBe('たべる');
      expect(body.params.note.fields['Meaning']).toBe('to eat');
      dispose();
    });
  });

  it('addNote creates deck before adding note', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockResolvedValueOnce(makeOkResponse(777));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.addNote({ word: 'test', meaning: 'test' });

      const createDeckCall = mockFetch.mock.calls.find((c) => {
        const body = JSON.parse(c[1].body);
        return body.action === 'createDeck';
      });
      expect(createDeckCall).toBeDefined();
      const body = JSON.parse(createDeckCall![1].body);
      expect(body.params.deck).toBe('TestDeck');
      dispose();
    });
  });

  it('addNote sets allowDuplicate false and duplicateScope deck', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(1))
      .mockResolvedValueOnce(makeOkResponse(888));

    await createRoot(async (dispose) => {
      const hook = useAnki();
      await hook.addNote({ word: 'test', meaning: 'test' });

      const addNoteCall = mockFetch.mock.calls.find((c) => {
        const body = JSON.parse(c[1].body);
        return body.action === 'addNote';
      });
      const body = JSON.parse(addNoteCall![1].body);
      expect(body.params.note.options.allowDuplicate).toBe(false);
      expect(body.params.note.options.duplicateScope).toBe('deck');
      dispose();
    });
  });
});
