import { expect, it } from 'vitest';
import { tutorSessionIntent } from './tutorSessionIntent';
it('preserves purpose and explicit practice choices without IDs, scores or claims of measured failure', () => {
  const text = tutorSessionIntent({ customInstructions: 'Describe my work', selectedWords: [{ word: 'work', ease: 0 }],
    selectedGrammar: [{ pattern: 'pattern', meaning: 'meaning', level: 0 }],
    selectedMedia: [{ mediaHash: 'private-storage-key', mediaName: 'My story', mediaType: 'book', failedWords: [], failedGrammar: [] }],
  });
  expect(text).toContain('Describe my work');
  expect(text).toContain('Words selected for practice (not evidence of difficulty): work');
  expect(text).toContain('pattern: meaning');
  expect(text).toContain('My story');
  expect(text).not.toContain('private-storage-key');
  expect(text).not.toContain('ease');
});
