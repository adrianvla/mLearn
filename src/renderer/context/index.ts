/**
 * Context exports
 */

export { SettingsProvider, useSettings, useTheme, useSubtitleSettings, useLanguageSettings } from './SettingsContext';
export { LanguageProvider, useLanguage, useColorCodes, type LanguageFeatures } from './LanguageContext';
export { FlashcardProvider, useFlashcards } from './FlashcardContext';
export { ServerProvider, useServer } from './ServerContext';
export { LocalizationProvider, useLocalization, useT } from './LocalizationContext';
export { WindowWrapper } from './WindowWrapper';
export { ResponsiveProvider, useResponsive, BREAKPOINTS, type Breakpoint, type ResponsiveContextValue } from './ResponsiveContext';
export { useTranslation } from '../hooks/useTranslation';
