import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LanguageData } from '../types';
import { clearMappingTables, registerMappingTable } from '../languageFeatures';
import { canonicalKeyHash, type CanonicalWordKeyDeps } from './canonicalWordKey';

const hashWord = (word: string) => createHash('sha256').update(word).digest('hex');
const sha256 = hashWord;

const zhDataWithMappingAsset: LanguageData = {
  name: 'Chinese',
  settings: { fixed: {} },
  textProcessing: {
    lexemeNormalization: { mappingTableAsset: 'mapping/zh-t2s.json' },
  },
};

const zhDataWithVariantScriptConversion: LanguageData = {
  name: 'Chinese',
  settings: { fixed: {} },
  variants: {
    hans: {
      name: 'Simplified',
      scriptConversion: { engine: 'opencc', config: 't2s', mappingAsset: 'mapping/zh-t2s.json' },
      overrides: {},
    },
  },
};

const jaData: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
};

const MAPPING_TABLE = { words: { 學習: '学习' }, chars: { 學: '学' } };

function deps(languageData?: LanguageData | null, legacyLanguageCodes?: Record<string, string>): CanonicalWordKeyDeps {
  return { hashWord, languageData, legacyLanguageCodes };
}

describe('canonicalKeyHash', () => {
  beforeEach(() => {
    clearMappingTables();
  });

  it('gives 學習 and 学习 the same canonical hash once a mapping table is registered', () => {
    registerMappingTable('zh', MAPPING_TABLE);
    const key1 = canonicalKeyHash('zh', '學習', deps(zhDataWithMappingAsset));
    const key2 = canonicalKeyHash('zh', '学习', deps(zhDataWithMappingAsset));
    expect(key1).toBe(key2);
    expect(key1).toBe(`zh:${sha256('学习')}`);
  });

  it('gates script conversion on lexemeNormalization.mappingTableAsset', () => {
    registerMappingTable('zh', MAPPING_TABLE);
    expect(canonicalKeyHash('zh', '學習', deps())).toBe(`zh:${sha256('學習')}`);
    expect(canonicalKeyHash('zh', '學習', deps(jaData))).toBe(`zh:${sha256('學習')}`);
  });

  it('gates script conversion on variants[].scriptConversion.mappingAsset', () => {
    registerMappingTable('zh', MAPPING_TABLE);
    expect(canonicalKeyHash('zh', '學習', deps(zhDataWithVariantScriptConversion))).toBe(`zh:${sha256('学习')}`);
  });

  it('falls back to char-by-char mapping when no word-level hit exists', () => {
    registerMappingTable('zh', MAPPING_TABLE);
    expect(canonicalKeyHash('zh', '學生', deps(zhDataWithMappingAsset))).toBe(`zh:${sha256('学生')}`);
  });

  it('folds legacy language codes into the canonical language before hashing', () => {
    registerMappingTable('zh', MAPPING_TABLE);
    const legacy = canonicalKeyHash('zh-Hant', '學習', deps(zhDataWithMappingAsset, { 'zh-Hant': 'zh' }));
    const canonical = canonicalKeyHash('zh', '学习', deps(zhDataWithMappingAsset));
    expect(legacy).toBe(canonical);
    expect(legacy).toBe(`zh:${sha256('学习')}`);
  });

  it('keeps identity behavior for other languages (no table, no script conversion)', () => {
    registerMappingTable('zh', MAPPING_TABLE);
    expect(canonicalKeyHash('ja', '日本', deps(jaData))).toBe(`ja:${sha256('日本')}`);
    expect(canonicalKeyHash('en', 'hello', deps())).toBe(`en:${sha256('hello')}`);
  });

  it('is byte-identical to legacy identity behavior when nothing is registered', () => {
    expect(canonicalKeyHash('zh', '學習', deps(zhDataWithMappingAsset))).toBe(`zh:${sha256('學習')}`);
  });
});
