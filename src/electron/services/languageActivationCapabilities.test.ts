import { describe, expect, it } from 'vitest';
import { languageActivationComponents } from './languageActivationCapabilities';
import type { LanguageData } from '../../shared/types';
const metadata = (runtime?: LanguageData['runtime']): LanguageData => ({ name: 'Future package', settings: { fixed: {} }, runtime });
describe('language activation capability admission', () => {
  it('does not require optional capabilities absent from a core-only package', () => {
    expect(languageActivationComponents(metadata({ nlp: {} }), ['core', 'voice', 'ocr', 'llm'])).toEqual(['core']);
  });
  it('strictly admits declared runtime capabilities and arbitrary package-owned dependency components', () => {
    expect(languageActivationComponents(metadata({ stt: { whisperLanguage: 'auto' }, ocr: {}, python: { importChecksByComponent: { 'future:capability': ['future_adapter'] } } }), ['voice', 'ocr', 'future:capability'])).toEqual(['core', 'voice', 'ocr', 'future:capability']);
  });
  it('does not turn disabled package capabilities into activation requirements', () => {
    expect(languageActivationComponents(metadata({ tts: { engine: 'future:engine' }, ocr: {} }), ['core'])).toEqual(['core']);
  });
});
