import { afterEach, describe, expect, it } from 'vitest';
import { buildLexemeIndex, clearMappingTables, detectScriptForm, getCanonicalLexeme, getLanguagePromptName, registerMappingTable } from './languageFeatures';
import { resolveEffectiveLanguageData } from './languageVariants';
import type { LanguageData } from './types';

const data: LanguageData = {
  name: 'Example',
  variants: {
    simplified: {
      name: 'Simplified',
      overrides: {},
    },
    traditional: {
      name: 'Traditional',
      scriptConversion: { engine: 'opencc', config: 't2s', mappingAsset: 'languages/example.t2s.json' },
      overrides: { 'runtime.adapter.config': { pinyinInputConversion: 't2s' } },
    },
  },
};

afterEach(clearMappingTables);

describe('detectScriptForm', () => {
  it('uses mapping behavior and variant metadata rather than variant-id literals', () => {
    registerMappingTable('example', { words: {}, chars: { 學: '学' } });

    expect(detectScriptForm('學', 'example', data)).toBe('traditional');
    expect(detectScriptForm('学', 'example', data)).toBe('simplified');
  });

  it('leaves languages without script conversion unchanged', () => {
    expect(detectScriptForm('學', 'example', { name: 'Example' })).toBeUndefined();
  });

  it('normalizes mapped lexemes and uses the effective variant prompt name', () => {
    const chinese: LanguageData = {
      ...data,
      name: 'Chinese',
      textProcessing: {
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          surfaceNormalizers: [{ type: 'mapping-table' }],
        },
      },
    };
    chinese.variants!.traditional.overrides.name = 'Traditional Chinese';
    registerMappingTable('example', { words: {}, chars: { 學: '学', 習: '习' } });
    const frequency = { 学习: { reading: '', level: '', raw_level: 0 } };
    const index = buildLexemeIndex([['学习', '']], chinese, 'example');

    expect(getCanonicalLexeme('學習', frequency, index, chinese, 'example')).toBe('学习');
    expect(getLanguagePromptName('example', resolveEffectiveLanguageData(chinese, { languageVariants: { example: 'traditional' } }, 'example'))).toBe('Traditional Chinese');
  });
});
