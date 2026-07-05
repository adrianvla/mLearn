import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

function readInterfaceBody(relativePath: string, interfaceName: string): string {
  const source = readRepoFile(relativePath);
  const declaration = new RegExp(`export\\s+interface\\s+${interfaceName}\\b[^\\{]*\\{`, 'm');
  const match = declaration.exec(source);
  expect(match).not.toBeNull();
  const start = match!.index;
  const openBrace = source.indexOf('{', start);
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, index);
      }
    }
  }

  throw new Error(`Could not read interface body for ${interfaceName}`);
}

function listSourceFiles(relativeDir: string): string[] {
  const absoluteDir = path.join(repoRoot, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(relativePath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

describe('language-agnostic runtime API naming', () => {
  it('does not expose furigana-named reading annotation settings in shared Settings', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');
    const settingsService = readRepoFile('src/electron/services/settings.ts');

    expect(sharedTypes).not.toMatch(/\bfurigana\?:/);
    expect(sharedTypes).not.toMatch(/\bshowFurigana\?:/);
    expect(sharedTypes).not.toMatch(/\bocrFurigana[A-Za-z]*\?:/);
    expect(sharedTypes).not.toMatch(/\breaderFuriganaHider\?:/);
    expect(settingsService).not.toMatch(/\bfurigana\b/);
    expect(settingsService).not.toMatch(/\bshowFurigana\b/);
    expect(settingsService).not.toMatch(/\bocrFurigana[A-Za-z]*\b/);
    expect(settingsService).not.toMatch(/\breaderFuriganaHider\b/);
  });

  it('does not expose pitch-accent-named visibility as the shared Settings API', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');
    const settingsService = readRepoFile('src/electron/services/settings.ts');

    expect(sharedTypes).toMatch(/\bshowProsody\??:/);
    expect(sharedTypes).not.toMatch(/\bshowPitchAccent:/);
    expect(sharedTypes).not.toMatch(/\bshowPitchAccent\?:/);
    expect(settingsService).not.toMatch(/\bshowPitchAccent\b/);
  });

  it('does not expose legacy pitch accent flags in language package metadata', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');

    expect(sharedTypes).toMatch(/\bprosody\?:\s*LanguageProsodyConfig/);
    expect(sharedTypes).not.toMatch(/\bhasPitchAccent\?:/);
  });

  it('does not expose unused pitch payload aliases beside generic prosody storage', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');
    const sharedIndex = readRepoFile('src/shared/index.ts');

    expect(sharedTypes).toContain('interface FlashcardProsody');
    expect(sharedTypes).toMatch(/\bposition\?:\s*number;/);
    expect(sharedTypes).not.toMatch(/\bpitchAccentPosition\?:/);
    expect(sharedTypes).not.toMatch(/\binterface\s+PitchInfo\b/);
    expect(sharedTypes).not.toMatch(/\binterface\s+PitchData\b/);
    expect(sharedIndex).not.toMatch(/\bPitchInfo\b/);
    expect(sharedIndex).not.toMatch(/\bPitchData\b/);
  });

  it('does not expose Japanese pitch accent as a top-level flashcard content field', () => {
    const flashcardContent = readInterfaceBody('src/shared/types.ts', 'FlashcardContent');
    const languageFeatures = readRepoFile('src/shared/languageFeatures.ts');
    const flashcardEditFields = readRepoFile('src/renderer/components/flashcard/flashcardEditFields.ts');
    const flashcardEditor = readRepoFile('src/renderer/components/flashcard/FlashcardEditor.tsx');
    const editTranslationDialog = readRepoFile('src/renderer/windows/wordDbEditor/components/EditTranslationDialog.tsx');
    const wordEntryRow = readRepoFile('src/renderer/windows/wordDbEditor/components/WordEntryRow.tsx');
    const flashcardContext = readRepoFile('src/renderer/context/FlashcardContext.tsx');
    const flashcardStorage = readRepoFile('src/electron/services/flashcardStorage.ts');
    const prosodyPayload = readRepoFile('src/shared/prosodyPayload.ts');

    expect(flashcardContent).toContain('prosody?: FlashcardProsody;');
    expect(flashcardContent).not.toMatch(/^\s*pitchAccent\?:/m);
    expect(languageFeatures).not.toContain("Pick<FlashcardContent, 'pitchAccent'");
    expect(languageFeatures).not.toMatch(/\bcontent\?\.pitchAccent\b/);
    expect(languageFeatures).not.toContain('pitches: [{ position }]');
    expect(languageFeatures).not.toMatch(/getProsodyPositionFromOverride\(\s*pitch:/);
    expect(languageFeatures).toMatch(/getProsodyPositionFromOverride\(\s*overridePosition:/);
    expect(languageFeatures).toContain('createProsodyRawPayloadForPosition');
    expect(prosodyPayload).not.toContain('pitches: [{ position }]');
    expect(prosodyPayload).not.toContain('RAW_PAYLOAD_FACTORIES');
    expect(prosodyPayload).not.toContain('hasProsodyRawPayloadFactory');
    expect(prosodyPayload).toContain('positionPath');
    expect(flashcardEditFields).not.toContain("'pitchAccent'");
    expect(flashcardEditor).not.toMatch(/\bpitchAccent:\s*shouldPersistJapanesePitchAccent\b/);
    expect(flashcardEditor).not.toMatch(/\bpitchName\b/);
    expect(flashcardEditor).toContain('prosodyCategoryName');
    expect(editTranslationDialog).not.toMatch(/\bconst\s+\[pitch,\s*setPitch\]/);
    expect(editTranslationDialog).not.toMatch(/\bhandlePitchChange\b/);
    expect(editTranslationDialog).toContain('prosodyPositionInput');
    expect(editTranslationDialog).toContain('handleProsodyPositionChange');
    expect(wordEntryRow).not.toMatch(/\bconst\s+pitchPosition\s*=/);
    expect(flashcardContext).not.toMatch(/\bpitchAccent:\s*content\.pitchAccent\b/);
    expect(flashcardStorage).toContain('getLanguageProsodyType');
    expect(flashcardStorage).not.toContain('languageUsesJapanesePitchAccentRenderer');
    expect(flashcardStorage).not.toContain('isJapanesePitchAccentProsodyType');
  });

  it('does not expose Japanese pitch accent as the generic prosody support API', () => {
    const languageFeatures = readRepoFile('src/shared/languageFeatures.ts');
    const languageContext = readRepoFile('src/renderer/context/LanguageContext.tsx');
    const commonIndex = readRepoFile('src/renderer/components/common/index.ts');
    const textIndex = readRepoFile('src/renderer/components/common/Text/index.ts');
    const languageSpecificIndex = readRepoFile('src/renderer/components/language-specific/index.ts');
    const flashcardIndex = readRepoFile('src/renderer/components/flashcard/index.ts');
    const sharedIndex = readRepoFile('src/shared/index.ts');
    const japanesePitchAccentUtils = readRepoFile('src/renderer/utils/japanesePitchAccent.ts');
    const rendererUtilsIndex = readRepoFile('src/renderer/utils/index.ts');
    const translationCacheParsers = readRepoFile('src/renderer/utils/translationCacheParsers.ts');
    const readingProsody = readRepoFile('src/renderer/utils/readingProsody.ts');
    const wordHoverHelpers = readRepoFile('src/renderer/components/subtitle/wordHoverHelpers.ts');

    expect(languageFeatures).toContain('languageSupportsProsody');
    expect(languageFeatures).not.toContain('languageUsesJapanesePitchAccentRenderer');
    expect(languageFeatures).not.toContain('isJapanesePitchAccentProsodyType');
    expect(languageSpecificIndex).toContain('JapanesePitchAccentOverlay');
    expect(readRepoFile('src/shared/types.ts')).not.toMatch(/\binterface\s+JapanesePitchAccentInfo\b/);
    expect(readRepoFile('src/shared/types.ts')).not.toMatch(/\binterface\s+PitchAccentInfo\b/);
    expect(sharedIndex).not.toContain('JapanesePitchAccentInfo');
    expect(japanesePitchAccentUtils).toMatch(/\binterface\s+JapanesePitchAccentInfo\b/);
    expect(japanesePitchAccentUtils).toContain('getJapanesePitchAccentInfo');
    expect(japanesePitchAccentUtils).toContain('buildJapanesePitchAccentHtml');
    expect(japanesePitchAccentUtils).toContain('getJapaneseMoraCount');
    expect(japanesePitchAccentUtils).toContain('getJapaneseMoraCharCounts');
    expect(japanesePitchAccentUtils).not.toMatch(/\bexport function getPitchAccentInfo\b/);
    expect(japanesePitchAccentUtils).not.toMatch(/\bexport function buildPitchAccentHtml\b/);
    expect(japanesePitchAccentUtils).not.toMatch(/\bexport function getMoraCount\b/);
    expect(japanesePitchAccentUtils).not.toMatch(/\bexport function getMoraCharCounts\b/);
    expect(japanesePitchAccentUtils).not.toMatch(/\bSMALL_KANA_CHARS\b/);
    expect(rendererUtilsIndex).not.toContain('./japanesePitchAccent');
    expect(translationCacheParsers).toContain('extractProsodyPayloadPosition');
    expect(readingProsody).toContain('extractProsodyFromTranslationData');
    expect(readingProsody).toContain('resolveStoredProsodyForDisplayedReading');
    expect(translationCacheParsers).not.toContain('extractJapanesePitchAccent');
    expect(translationCacheParsers).not.toContain('japanese-pitch-accent');
    expect(readRepoFile('src/renderer/utils/prosodyPayloadExtractors.ts')).toContain('extractJapanesePitchAccentPayloadPosition');
    expect(translationCacheParsers).not.toMatch(/\bexport function extractPitchPosition\b/);
    expect(translationCacheParsers).not.toMatch(/\bextractLegacyPitchAccentPosition\b/);
    expect(wordHoverHelpers).toContain('resolveProsodyForHover');
    expect(wordHoverHelpers).not.toContain('resolveJapanesePitchAccentForHover');
    expect(wordHoverHelpers).not.toContain('extractJapanesePitchAccentFromTranslationData');
    expect(wordHoverHelpers).not.toMatch(/\bresolvePitchAccentForHover\b/);
    expect(wordHoverHelpers).not.toMatch(/\bextractPitchAccentFromTranslationData\b/);
    expect(wordHoverHelpers).not.toMatch(/\bfunction\s+extractFlashcardProsodyFromTranslationData\b/);
    expect(languageFeatures).not.toContain('languageSupportsPitchAccent');
    expect(languageFeatures).not.toContain('languageUsesJapanesePitchAccentRenderer');
    expect(languageFeatures).not.toContain('isJapanesePitchAccentProsodyType');
    expect(languageContext).not.toContain('supportsPitchAccent');
    expect(languageContext).toContain('prosodyRenderer?:');
    expect(languageContext).not.toContain('usesJapanesePitchAccentRenderer: boolean');
    expect(commonIndex).not.toMatch(/\bPitchAccentOverlay\b/);
    expect(commonIndex).not.toContain('JapanesePitchAccentOverlay');
    expect(commonIndex).not.toContain('WordWithReading');
    expect(commonIndex).not.toContain('RubyText');
    expect(textIndex).not.toContain('JapanesePitchAccentOverlay');
    expect(textIndex).not.toContain('WordWithReading');
    expect(textIndex).not.toContain('RubyText');
    expect(textIndex).not.toContain("../../language-specific");
    expect(textIndex).not.toMatch(/\bPitchAccentOverlay\b/);
    expect(flashcardIndex).not.toMatch(/\bFlashcardPitchAccent\b/);
    expect(fs.existsSync(path.join(repoRoot, 'src/renderer/utils/japanesePitchAccent.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'src/renderer/utils/pitchAccent.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'src/renderer/components/language-specific/JapanesePitchAccent.css'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'src/renderer/components/language-specific/PitchAccent.css'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'src/renderer/hooks/usePitchAccent.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'src/renderer/components/flashcard/FlashcardPitchAccent.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'src/renderer/components/flashcard/FlashcardPitchAccent.css'))).toBe(false);
  });

  it('does not expose Japanese pitch accent fields in generic tokenizer surfaces', () => {
    const tokenInterface = readInterfaceBody('src/shared/types.ts', 'Token');
    const tokenizerHook = readRepoFile('src/renderer/hooks/useNLPTokenizer.ts');
    const tokenizerHookTests = readRepoFile('src/renderer/hooks/useNLPTokenizer.test.ts');

    expect(tokenInterface).toContain('features?: Record<string, string | string[]>;');
    expect(tokenInterface).not.toMatch(/\bpitchAccent\b/);
    expect(tokenizerHook).not.toMatch(/\bpitchAccent\b/);
    expect(tokenizerHookTests).not.toMatch(/\bpitchAccent\b/);
  });

  it('keeps generic reading annotation rendering independent from Japanese pitch overlays', () => {
    const wordWithReading = readRepoFile('src/renderer/components/language-specific/WordWithReading.tsx');

    expect(wordWithReading).toContain('renderText?:');
    expect(wordWithReading).not.toMatch(/import\s+\{\s*JapanesePitchAccentOverlay\s*\}/);
    expect(wordWithReading).not.toMatch(/<JapanesePitchAccentOverlay\b/);
  });

  it('routes generic word prosody rendering through the metadata prosody overlay', () => {
    const prosodyOverlay = readRepoFile('src/renderer/components/language-specific/ProsodyOverlay.tsx');
    const prosodyOverlayRenderers = readRepoFile('src/renderer/components/language-specific/prosodyOverlayRenderers.tsx');
    const prosodyOverlayProps = readInterfaceBody(
      'src/renderer/components/language-specific/ProsodyOverlay.tsx',
      'ProsodyOverlayProps',
    );
    const prosodyPresentation = readRepoFile('src/renderer/utils/prosodyPresentation.ts');
    const prosodyPresentationAdapters = readRepoFile('src/renderer/utils/prosodyPresentationAdapters.ts');
    const genericRendererPaths = [
      'src/renderer/components/flashcard/FlashcardWordTitle.tsx',
      'src/renderer/components/flashcard/FlashcardEditor.tsx',
      'src/renderer/components/subtitle/SubtitleWord.tsx',
      'src/renderer/components/subtitle/WordHover.tsx',
      'src/renderer/components/sidebar/UnknownWordsSidebar.tsx',
      'src/renderer/windows/wordDbEditor/components/WordEntryRow.tsx',
      'src/renderer/windows/wordDbEditor/components/EditTranslationDialog.tsx',
    ];
    const readingProsodyWrapperPaths = [
      'src/renderer/components/flashcard/FlashcardWordTitle.tsx',
      'src/renderer/components/subtitle/SubtitleWord.tsx',
      'src/renderer/components/sidebar/UnknownWordsSidebar.tsx',
      'src/renderer/windows/wordDbEditor/components/WordEntryRow.tsx',
    ];

    expect(prosodyOverlayProps).toContain('prosodyPosition?:');
    expect(prosodyOverlayProps).toContain('allowStoredProsodyWithoutMetadata?:');
    expect(prosodyOverlayProps).toContain('isReadingScript?:');
    expect(prosodyOverlayProps).not.toMatch(/\bpitchPosition\?:/);
    expect(prosodyOverlayProps).not.toMatch(/\ballowStoredPitchWithoutMetadata\?:/);
    expect(prosodyOverlayProps).not.toMatch(/\bisKanaOnly\?:/);
    expect(prosodyOverlay).not.toContain('JapanesePitchAccentOverlayProps');
    expect(prosodyOverlay).not.toContain('JapanesePitchAccentOverlay');
    expect(prosodyOverlay).not.toContain('isJapanesePitchAccentProsodyType');
    expect(prosodyOverlay).not.toMatch(/extends\s+Omit</);
    expect(prosodyOverlay).toContain('getProsodyOverlayComponent');
    expect(prosodyOverlayRenderers).toContain('JapanesePitchAccentOverlay');
    expect(prosodyOverlayRenderers).toContain('japanese-pitch-accent');
    expect(prosodyPresentation).toContain('getProsodyOverlayRenderer');
    expect(prosodyPresentation).toContain('type ProsodyOverlayRenderer');
    expect(prosodyPresentation).toContain('getProsodyPresentationAdapter');
    expect(prosodyPresentationAdapters).not.toMatch(/export\s+type\s+ProsodyOverlayRenderer\s*=\s*'japanese-pitch-accent'/);
    expect(prosodyPresentationAdapters).toContain("Exclude<NonNullable<FlashcardProsody['type']>, 'none'>");
    expect(prosodyPresentation).not.toContain('getJapanesePitchAccentCategoryLabelForReading');
    expect(prosodyPresentation).not.toContain('languageUsesJapanesePitchAccentRenderer');
    expect(prosodyPresentation).not.toContain('isJapanesePitchAccentProsodyType');
    expect(prosodyPresentation).not.toContain('getInlineProsodyOverlayRenderer');
    expect(prosodyPresentation).not.toContain('InlineProsodyOverlayRenderer');
    expect(prosodyPresentationAdapters).toContain('getJapanesePitchAccentCategoryLabelForReading');

    for (const relativePath of genericRendererPaths) {
      const source = readRepoFile(relativePath);
      expect(source).toContain('ProsodyOverlay');
      expect(source).not.toContain('getInlineProsodyOverlayRenderer');
      expect(source).not.toContain('InlineProsodyOverlayRenderer');
      expect(source).not.toMatch(/<ProsodyOverlay[\s\S]*?\bpitchPosition=/);
      expect(source).not.toMatch(/<ProsodyOverlay[\s\S]*?\ballowStoredPitchWithoutMetadata=/);
      expect(source).not.toMatch(/import\s+\{\s*JapanesePitchAccentOverlay\b/);
      expect(source).not.toMatch(/<JapanesePitchAccentOverlay\b/);
      expect(source).not.toMatch(/\blanguageUsesJapanesePitchAccentRenderer\b/);
      expect(source).not.toMatch(/\bisJapanesePitchAccentProsodyType\b/);
      expect(source).not.toMatch(/\bextractJapanesePitchAccentPosition\b/);
      expect(source).not.toMatch(/\bextractJapanesePitchAccentPositionFromProsody\b/);
      expect(source).not.toContain('pitch-overlay-wrapper--ruby');
    }

    for (const relativePath of readingProsodyWrapperPaths) {
      expect(readRepoFile(relativePath)).toContain('prosody-overlay-wrapper--reading');
    }
  });

  it('keeps Japanese pitch accent names out of generic hover and lookup state APIs', () => {
    const flashcardWordTitle = readRepoFile('src/renderer/components/flashcard/FlashcardWordTitle.tsx');
    const wordHover = readRepoFile('src/renderer/components/subtitle/WordHover.tsx');
    const subtitleWord = readRepoFile('src/renderer/components/subtitle/SubtitleWord.tsx');
    const wordDefinition = readRepoFile('src/renderer/windows/wordDefinition/App.tsx');

    expect(flashcardWordTitle).not.toContain('storedJapanesePitchPosition');
    expect(flashcardWordTitle).not.toContain('canRenderJapanesePitchAccent');
    expect(flashcardWordTitle).not.toContain('hasStoredJapanesePitchAccent');
    expect(flashcardWordTitle).toContain('storedProsodyPosition');
    expect(flashcardWordTitle).toContain('canRenderProsodyOverlay');
    expect(flashcardWordTitle).toContain('hasStoredProsodyOverlay');

    expect(wordHover).not.toContain('japanesePitchAccent?:');
    expect(wordHover).toContain('hoverProsody');
    expect(wordHover).not.toMatch(/\bpitchAccent\?:\s*\{/);
    expect(wordHover).not.toMatch(/\bprops\.pitchAccent\b/);
    expect(wordHover).not.toMatch(/\bpitchAccentFromData\b/);
    expect(wordHover).not.toMatch(/\beffectivePitchAccent\b/);
    expect(wordHover).not.toContain('Use provided pitchAccent');

    expect(subtitleWord).not.toMatch(/\bpitchAccentHeight\b/);
    expect(subtitleWord).not.toContain('japanesePitchAccentHeight');
    expect(subtitleWord).toContain('prosodyOverlayHeight');

    expect(wordDefinition).not.toMatch(/\[pitchAccent,\s*setPitchAccent\]/);
    expect(wordDefinition).not.toContain('japanesePitchAccent');
    expect(wordDefinition).not.toContain('setJapanesePitchAccent');
    expect(wordDefinition).toContain('definitionProsody');
  });

  it('keeps Japanese pitch accent localization under Japanese-specific keys', () => {
    const flashcardEditor = readRepoFile('src/renderer/components/flashcard/FlashcardEditor.tsx');
    const editTranslationDialog = readRepoFile('src/renderer/windows/wordDbEditor/components/EditTranslationDialog.tsx');
    const prosodyPresentation = readRepoFile('src/renderer/utils/prosodyPresentation.ts');
    const prosodyPresentationAdapters = readRepoFile('src/renderer/utils/prosodyPresentationAdapters.ts');
    const englishLocale = readRepoFile('src/root-of-app/locales/lang.en.json');

    expect(flashcardEditor).not.toContain('mlearn.CardEditor.Fields.JapanesePitchAccent');
    expect(editTranslationDialog).not.toContain('mlearn.CardEditor.Fields.JapanesePitchAccent');
    expect(prosodyPresentation).not.toContain('mlearn.CardEditor.Fields.JapanesePitchAccent');
    expect(prosodyPresentationAdapters).toContain('mlearn.CardEditor.Fields.JapanesePitchAccent');
    expect(flashcardEditor).not.toContain('mlearn.PitchAccent.');
    expect(editTranslationDialog).not.toContain('mlearn.PitchAccent.');
    expect(prosodyPresentation).not.toContain('mlearn.PitchAccent.');
    expect(prosodyPresentationAdapters).not.toContain('mlearn.PitchAccent.');
    expect(englishLocale).toContain('"JapanesePitchAccent"');
    expect(englishLocale).not.toContain('"PitchAccent": {');
    expect(englishLocale).toContain('"JapanesePitchAccent": "Pitch accent"');
    expect(englishLocale).toContain('"JapanesePitchAccentPlaceholder"');
    expect(englishLocale).not.toContain('"PitchAccent": "Pitch accent"');
    expect(englishLocale).not.toContain('"PitchAccentPlaceholder"');
  });

  it('keeps shared CardEditor labels free of Japanese-only reading/prosody wording', () => {
    const localeFiles = [
      'src/root-of-app/locales/lang.de.json',
      'src/root-of-app/locales/lang.en.json',
      'src/root-of-app/locales/lang.fr.json',
      'src/root-of-app/locales/lang.ja.json',
      'src/root-of-app/locales/lang.ru.json',
      'src/root-of-app/locales/lang.zh.json',
    ];
    const japaneseOnlyGenericWords = /kana|furigana|mora|heiban|pitch accent|かな|ふりがな|ピッチアクセント|モーラ|平板|кана|фуриган|мора|假名|拍节|平板型/i;

    for (const localeFile of localeFiles) {
      const locale = JSON.parse(readRepoFile(localeFile)) as {
        mlearn?: {
          CardEditor?: {
            Fields?: {
              Reading?: string;
              ReadingPlaceholder?: string;
            };
            Hint?: string;
          };
        };
      };
      const cardEditor = locale.mlearn?.CardEditor;
      const sharedStrings = [
        cardEditor?.Fields?.Reading ?? '',
        cardEditor?.Fields?.ReadingPlaceholder ?? '',
        cardEditor?.Hint ?? '',
      ];

      for (const value of sharedStrings) {
        expect(value).not.toMatch(japaneseOnlyGenericWords);
      }
    }
  });

  it('keeps generic styling labels free of Japanese-specific annotation names', () => {
    const subtitleWordCss = readRepoFile('src/renderer/components/subtitle/SubtitleWord.css');
    const wordHoverCss = readRepoFile('src/renderer/components/subtitle/WordHover.css');
    const flashcardEditor = readRepoFile('src/renderer/components/flashcard/FlashcardEditor.tsx');
    const flashcardEditorCss = readRepoFile('src/renderer/components/flashcard/FlashcardEditor.css');
    const flashcardDisplayCss = readRepoFile('src/renderer/components/flashcard/FlashcardDisplay.css');
    const flashcardWordTitle = readRepoFile('src/renderer/components/flashcard/FlashcardWordTitle.tsx');
    const flashcardWordTitleCss = readRepoFile('src/renderer/components/flashcard/FlashcardWordTitle.css');
    const editTranslationDialog = readRepoFile('src/renderer/windows/wordDbEditor/components/EditTranslationDialog.tsx');
    const editTranslationDialogCss = readRepoFile('src/renderer/windows/wordDbEditor/components/EditTranslationDialog.css');
    const subtitleWord = readRepoFile('src/renderer/components/subtitle/SubtitleWord.tsx');
    const wordEntryRowCss = readRepoFile('src/renderer/windows/wordDbEditor/components/WordEntryRow.css');
    const rootThemeCss = readRepoFile('src/renderer/styles/index.css');
    const defaultCustomThemeCss = readRepoFile('src/shared/defaultCustomThemeCss.ts');
    const genericCssFiles = [
      subtitleWordCss,
      wordHoverCss,
      flashcardDisplayCss,
      flashcardEditorCss,
      flashcardWordTitleCss,
      wordEntryRowCss,
      editTranslationDialogCss,
    ];
    const themeCssFiles = [
      'src/renderer/styles/themes/dark.css',
      'src/renderer/styles/themes/darker.css',
      'src/renderer/styles/themes/glass-dark.css',
      'src/renderer/styles/themes/glass-light.css',
    ].map(readRepoFile);

    for (const css of genericCssFiles) {
      expect(css).not.toContain('JapanesePitchAccent.css');
      expect(css).not.toContain('Furigana');
      expect(css).not.toMatch(/\bpitch accent\b/i);
      expect(css).not.toMatch(/\bkana\b/i);
      expect(css).not.toMatch(/\bPitchAccent\b/);
      expect(css).not.toMatch(/\bpitch-kana\b/);
    }
    expect(flashcardEditor).not.toContain('pitch-row');
    expect(flashcardEditor).not.toContain('pitch-input');
    expect(flashcardEditor).not.toContain('pitch-name');
    expect(flashcardEditor).not.toContain('pitch-preview');
    expect(editTranslationDialog).not.toContain('pitch-row');
    expect(editTranslationDialog).not.toContain('pitch-input');
    expect(editTranslationDialog).not.toContain('pitch-name');
    expect(editTranslationDialog).not.toContain('pitch-preview');
    expect(flashcardEditorCss).not.toContain('pitch-row');
    expect(flashcardEditorCss).not.toContain('pitch-input');
    expect(flashcardEditorCss).not.toContain('pitch-name');
    expect(flashcardEditorCss).not.toContain('pitch-preview');
    expect(editTranslationDialogCss).not.toContain('pitch-row');
    expect(editTranslationDialogCss).not.toContain('pitch-input');
    expect(editTranslationDialogCss).not.toContain('pitch-name');
    expect(editTranslationDialogCss).not.toContain('pitch-preview');
    expect(flashcardEditor).toContain('prosody-row');
    expect(flashcardEditor).toContain('prosody-position-input');
    expect(flashcardEditor).toContain('prosody-category-name');
    expect(flashcardEditor).toContain('prosody-overlay-preview');
    expect(editTranslationDialog).toContain('prosody-row');
    expect(editTranslationDialog).toContain('prosody-position-input');
    expect(editTranslationDialog).toContain('prosody-category-name');
    expect(editTranslationDialog).toContain('prosody-overlay-preview');
    expect(flashcardWordTitle).not.toContain('fc-pitch');
    expect(flashcardWordTitleCss).not.toContain('fc-pitch');
    expect(flashcardWordTitle).toContain('fc-prosody');
    expect(flashcardWordTitle).toContain('fc-reading-annotation');
    expect(subtitleWord).not.toContain('--pitch-accent-height');
    expect(subtitleWord).toContain('--prosody-overlay-height');
    expect(rootThemeCss).not.toContain('--pitch-accent-height');
    expect(rootThemeCss).not.toContain('--pitch-accent-high');
    expect(rootThemeCss).not.toContain('--pitch-accent-low');
    expect(rootThemeCss).toContain('--prosody-overlay-height');
    expect(rootThemeCss).toContain('--prosody-overlay-high');
    expect(rootThemeCss).toContain('--prosody-overlay-low');
    expect(defaultCustomThemeCss).not.toContain('PitchAccent');
    expect(defaultCustomThemeCss).not.toContain('pitch-accent');
    expect(defaultCustomThemeCss).toContain('prosody-overlay-wrapper');
    for (const themeCss of themeCssFiles) {
      expect(themeCss).not.toContain('JapanesePitchAccent');
      expect(themeCss).not.toContain('PitchAccent');
      expect(themeCss).not.toContain('pitch-accent');
      expect(themeCss).toContain('prosody-overlay-wrapper');
    }
  });

  it('does not expose legacy grammar capability flags in language package metadata', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');

    expect(sharedTypes).toMatch(/\bgrammar\?:\s*GrammarPoint\[\]/);
    expect(sharedTypes).not.toMatch(/\bhasGrammar\?:/);
  });

  it('does not expose legacy boolean language feature flags beside metadata sections', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');
    const languageContext = readRepoFile('src/renderer/context/LanguageContext.tsx');
    const languageFeatures = readRepoFile('src/shared/languageFeatures.ts');

    expect(sharedTypes).not.toMatch(/\bhasOcrRamSaver\?:/);
    expect(sharedTypes).not.toMatch(/\busesCJKParentheses\?:/);
    expect(sharedTypes).not.toMatch(/\busesLatinScript\?:/);
    expect(sharedTypes).not.toMatch(/\bhasCharacterNames\?:/);
    expect(sharedTypes).not.toMatch(/\bhasHonorifics\?:/);
    expect(languageContext).not.toContain('usesCJKParentheses');
    expect(languageFeatures).not.toContain('languageCharacterNamePrefixesUseCjkBrackets');
  });

  it('does not expose deprecated basic-tokenizer fallback names in shared tokenizer APIs', () => {
    const languageFeatures = readRepoFile('src/shared/languageFeatures.ts');
    const languageFeatureTests = readRepoFile('src/shared/utils/languageFeatures.test.ts');
    const genericLanguage = readRepoFile('src/root-of-app/generic_language.py');
    const genericLanguageTests = readRepoFile('src/root-of-app/test_generic_language.py');
    const conversationAgentTests = readRepoFile('src/renderer/services/conversationAgent.test.ts');
    const checkerAgentTests = readRepoFile('src/renderer/services/checkerAgent.test.ts');

    expect(languageFeatures).not.toMatch(/\ballowsBasicFallback\b/);
    expect(languageFeatures).not.toMatch(/\bcreateBasicFallbackTokens\b/);
    expect(languageFeatureTests).not.toMatch(/\ballowsBasicFallback\b/);
    expect(languageFeatureTests).not.toMatch(/\bcreateBasicFallbackTokens\b/);
    expect(genericLanguage).not.toMatch(/\bBASIC_[A-Z_]*TOKENIZER[A-Z_]*\b/);
    expect(genericLanguageTests).not.toMatch(/\bfalls?_back_to_basic\b/);
    expect(genericLanguageTests).not.toMatch(/\bbasic_segmenter\b/);
    expect(conversationAgentTests).not.toMatch(/\ballowsBasicFallback\b/);
    expect(checkerAgentTests).not.toMatch(/\ballowsBasicFallback\b/);
    expect(languageFeatures).toMatch(/\ballowsRoughFallback\b/);
    expect(languageFeatures).toMatch(/\bcreateRoughTokenizerTokens\b/);
    expect(languageFeatures).toContain("if (tokenizer.type && tokenizer.type !== 'none')");
    expect(languageFeatures).toContain("providesReadings: declaredReadings ?? false");
  });

  it('does not expose Japanese honorifics as the generic register feature API', () => {
    const languageContext = readRepoFile('src/renderer/context/LanguageContext.tsx');
    const conversationAgent = readRepoFile('src/renderer/services/conversationAgent.ts');
    const conversationAgentTests = readRepoFile('src/renderer/services/conversationAgent.test.ts');
    const checkerAgentTests = readRepoFile('src/renderer/services/checkerAgent.test.ts');

    expect(languageContext).toContain('supportsDeferentialRegister');
    expect(languageContext).not.toContain('supportsHonorifics');
    expect(conversationAgent).not.toMatch(/\bhonorific/i);
    expect(conversationAgentTests).not.toMatch(/\bhonorific/i);
    expect(checkerAgentTests).not.toMatch(/\bhonorific/i);
  });

  it('keeps legacy OCR vertical-text flags out of top-level language package metadata', () => {
    const languageDataInterface = readInterfaceBody('src/shared/types.ts', 'LanguageData');

    expect(languageDataInterface).not.toMatch(/^\s*supportsVerticalText\?:/m);
    expect(languageDataInterface).toContain('runtime?: LanguageRuntimeConfig;');
  });

  it('uses generic surface-reading lexeme metadata instead of kana-kanji API names', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');
    const languageFeatures = readRepoFile('src/shared/languageFeatures.ts');
    const textUtils = readRepoFile('src/shared/utils/textUtils.ts');
    const subtitleParsing = readRepoFile('src/renderer/utils/subtitleParsing.ts');
    const legacyType = `kana-${'kanji'}-reading`;

    expect(sharedTypes).toContain("'surface-reading'");
    expect(sharedTypes).not.toContain(legacyType);
    expect(languageFeatures).not.toContain('usesKanaKanjiLexemeNormalization');
    expect(languageFeatures).not.toContain(legacyType);
    expect(textUtils).toContain('extractHanCharacters');
    expect(textUtils).not.toContain('extractKanjiChars');
    expect(textUtils).not.toMatch(/\bexport\s+const\s+KANA_ONLY_REGEX\b/);
    expect(textUtils).not.toMatch(/\bexport\s+const\s+KANA_EXTRACT_REGEX\b/);
    expect(textUtils).not.toMatch(/\bexport\s+const\s+SMALL_KANA\b/);
    expect(textUtils).not.toMatch(/\bexport\s+function\s+isAllKana\b/);
    expect(textUtils).not.toMatch(/\bexport\s+function\s+extractKana\b/);
    expect(subtitleParsing).not.toMatch(/\bisAllKana\b/);
  });

  it('does not accept furigana-named reader commands at runtime', () => {
    const readerRoute = readRepoFile('src/renderer/windows/main/routes/ReaderRoute.tsx');

    expect(readerRoute).not.toContain('toggle-furigana');
  });

  it('resolves reader layout defaults through language metadata instead of route-level app defaults', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');
    const languageFeatures = readRepoFile('src/shared/languageFeatures.ts');
    const readerRoute = readRepoFile('src/renderer/windows/main/routes/ReaderRoute.tsx');

    expect(sharedTypes).toMatch(/\breader\?:\s*LanguageReaderConfig/);
    expect(languageFeatures).toContain('getReaderPageModeForLanguage');
    expect(languageFeatures).toContain('getReaderSpreadDirectionForLanguage');
    expect(languageFeatures).toContain('getReaderFirstPageSingleForLanguage');
    expect(languageFeatures).toContain('getReaderCollatePagesForLanguage');
    expect(readerRoute).toContain('getReaderPageModeForLanguage');
    expect(readerRoute).toContain('getReaderSpreadDirectionForLanguage');
    expect(readerRoute).toContain('getReaderFirstPageSingleForLanguage');
    expect(readerRoute).toContain('getReaderCollatePagesForLanguage');
    expect(readerRoute).not.toMatch(/settings\.readerPageMode\s*\?\?\s*DEFAULT_SETTINGS\.readerPageMode/);
    expect(readerRoute).not.toMatch(/settings\.readerSpreadDirection\s*\?\?\s*DEFAULT_SETTINGS\.readerSpreadDirection/);
    expect(readerRoute).not.toMatch(/settings\.readerFirstPageSingle\s*\?\?\s*DEFAULT_SETTINGS\.readerFirstPageSingle/);
    expect(readerRoute).not.toMatch(/settings\.readerCollatePages\s*\?\?\s*DEFAULT_SETTINGS\.readerCollatePages/);
  });

  it('does not expose non-ASCII as a language character-indexing strategy', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');
    const scriptProfile = readRepoFile('src/shared/languageScriptProfile.ts');
    const languageFeaturesTests = readRepoFile('src/shared/utils/languageFeatures.test.ts');

    expect(sharedTypes).not.toMatch(/\bcharacterFilter\?:/);
    expect(sharedTypes).not.toContain("'non-ascii'");
    expect(sharedTypes).not.toContain("'accepted-scripts'");
    expect(scriptProfile).not.toContain('non-ascii');
    expect(scriptProfile).not.toContain('characterFilter');
    expect(scriptProfile).not.toMatch(/codePoint\s*>\s*128/);
    expect(languageFeaturesTests).not.toMatch(/legacy non-ASCII|non-ascii|characterFilter/);
  });

  it('routes runtime script metadata through the script-profile resolver', () => {
    const languageDataInterface = readInterfaceBody('src/shared/types.ts', 'LanguageData');
    const scriptProfile = readRepoFile('src/shared/languageScriptProfile.ts');
    const allowedDirectReaders = new Set([
      'src/electron/services/settings.ts',
      'src/shared/languageScriptProfile.ts',
      'src/shared/types.ts',
    ]);
    const offenders = listSourceFiles('src')
      .filter((file) => !allowedDirectReaders.has(file))
      .filter((file) => readRepoFile(file).includes('supportedScripts'));

    expect(languageDataInterface).not.toMatch(/^\s*supportedScripts\??:/m);
    expect(scriptProfile).not.toMatch(/data\?\.supportedScripts/);
    expect(offenders).toEqual([]);
  });

  it('keeps romanized input acceptance package-declared instead of locale-inferred', () => {
    const scriptProfile = readRepoFile('src/shared/languageScriptProfile.ts');

    expect(scriptProfile).toContain('configuredProfile?.allowsRomanization ?? false');
    expect(scriptProfile).not.toContain('COMPOSITE_SCRIPTS_WITH_AUXILIARY_HAN');
    expect(scriptProfile).not.toMatch(/allowsRomanization\s*=\s*configuredProfile\?\.allowsRomanization\s*\?\?.*has\(/);
  });

  it('does not use top-level language translatable as the POS policy source', () => {
    const languageDataInterface = readInterfaceBody('src/shared/types.ts', 'LanguageData');
    const languageFeatures = readRepoFile('src/shared/languageFeatures.ts');
    const languageFeaturesTests = readRepoFile('src/shared/utils/languageFeatures.test.ts');

    expect(languageDataInterface).not.toMatch(/^\s*translatable\??:/m);
    expect(readRepoFile('src/shared/types.ts')).toMatch(/\bpartOfSpeech\?:\s*LanguagePartOfSpeechConfig/);
    expect(languageFeatures).toContain('textProcessing?.partOfSpeech?.translatable');
    expect(languageFeatures).not.toMatch(/data\?\.translatable/);
    expect(languageFeaturesTests).not.toMatch(/legacy POS translatability/);
  });

  it('keeps level labels and frequency boundaries inside level metadata bricks', () => {
    const languageDataInterface = readInterfaceBody('src/shared/types.ts', 'LanguageData');
    const levelConfigInterface = readInterfaceBody('src/shared/types.ts', 'LanguageFrequencyLevelConfig');
    const languageFeatures = readRepoFile('src/shared/languageFeatures.ts');
    const languageContext = readRepoFile('src/renderer/context/LanguageContext.tsx');

    expect(levelConfigInterface).toMatch(/\bnames\?:\s*FrequencyLevelNames/);
    expect(levelConfigInterface).toMatch(/\bboundaries\?:\s*number\[\]/);
    expect(languageDataInterface).not.toMatch(/^\s*freq_level_names\??:/m);
    expect(languageDataInterface).not.toMatch(/^\s*grammar_level_names\??:/m);
    expect(languageDataInterface).not.toMatch(/^\s*freq_level_boundaries\??:/m);
    expect(languageFeatures).not.toMatch(/data\?\.freq_level_names/);
    expect(languageFeatures).not.toMatch(/data\?\.grammar_level_names/);
    expect(languageContext).not.toMatch(/\bfreq_level_names\b/);
    expect(languageContext).not.toMatch(/\bgrammar_level_names\b/);
    expect(languageContext).not.toMatch(/\bfreq_level_boundaries\b/);
  });

  it('keeps package POS colors inside the part-of-speech metadata brick', () => {
    const languageDataInterface = readInterfaceBody('src/shared/types.ts', 'LanguageData');
    const partOfSpeechInterface = readInterfaceBody('src/shared/types.ts', 'LanguagePartOfSpeechConfig');
    const languageContext = readRepoFile('src/renderer/context/LanguageContext.tsx');
    const subtitleWord = readRepoFile('src/renderer/components/subtitle/SubtitleWord.tsx');
    const chatBubble = readRepoFile('src/renderer/windows/conversationAgent/ChatBubble.tsx');

    expect(partOfSpeechInterface).toMatch(/\bcolors\?:\s*ColorCodes/);
    expect(languageDataInterface).not.toMatch(/^\s*colour_codes:/m);
    expect(languageContext).not.toMatch(/currentLangData\(\)\?\.colour_codes/);
    expect(languageContext).not.toMatch(/data\?\.colour_codes/);
    expect(subtitleWord).not.toMatch(/langData\?\.colour_codes/);
    expect(chatBubble).not.toMatch(/langData\?\.colour_codes/);
  });

  it('keeps package-forced settings inside the settings metadata brick', () => {
    const languageDataInterface = readInterfaceBody('src/shared/types.ts', 'LanguageData');
    const sharedTypes = readRepoFile('src/shared/types.ts');
    const languageFeatures = readRepoFile('src/shared/languageFeatures.ts');
    const languageContext = readRepoFile('src/renderer/context/LanguageContext.tsx');

    expect(sharedTypes).toMatch(/\bsettings\?:\s*LanguageSettingsConfig/);
    expect(sharedTypes).toMatch(/\binterface\s+LanguageSettingsConfig\b/);
    expect(languageDataInterface).not.toMatch(/^\s*fixed_settings:/m);
    expect(languageFeatures).toContain('getLanguageFixedSettings');
    expect(languageFeatures).not.toMatch(/data\?\.fixed_settings/);
    expect(languageContext).not.toMatch(/data\?\.fixed_settings/);
  });

  it('keeps plugin translation helpers scoped to the host language context', () => {
    const pluginHost = readRepoFile('src/renderer/plugins/PluginHost.tsx');

    expect(pluginHost).toContain('__mlearnLanguage');
    expect(pluginHost).toContain('__mlearnDictionaryTargetLanguage');
    expect(pluginHost).not.toContain('translate: (word: string) => getBackend().translate(word)');
  });

  it('does not default a fresh profile to a bundled learning language', () => {
    const sharedTypes = readRepoFile('src/shared/types.ts');
    const settingsService = readRepoFile('src/electron/services/settings.ts');
    const pythonBackend = readRepoFile('src/electron/services/pythonBackend.ts');

    expect(sharedTypes).toMatch(/\blanguage:\s*''/);
    expect(sharedTypes).not.toMatch(/\blanguage:\s*['"]ja['"]/);
    expect(settingsService).toContain('settingsWithRecoveredInstalledLanguage');
    expect(settingsService).not.toMatch(/language:\s*['"]ja['"]/);
    expect(pythonBackend).toContain("settings.language || 'und'");
    expect(pythonBackend).not.toMatch(/settings\.language\s*\|\|\s*['"]ja['"]/);
  });

  it('does not invent Japanese flashcard metadata when language is unknown', () => {
    const flashcardStorage = readRepoFile('src/electron/services/flashcardStorage.ts');

    expect(flashcardStorage).toContain('perLanguage: {}');
    expect(flashcardStorage).toContain('if (!normalizedLanguage) return null;');
    expect(flashcardStorage).not.toMatch(/if\s*\(!normalizedLanguage\)\s*return true/);
    expect(flashcardStorage).not.toMatch(/perLanguage:\s*\{\s*ja:/);
    expect(flashcardStorage).not.toMatch(/migrateV6ToV7\(result,\s*['"]ja['"]\)/);
  });
});
