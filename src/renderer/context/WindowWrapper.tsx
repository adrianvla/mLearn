/**
 * Window Wrapper Component
 * Provides nested context providers for all windows (Russian Doll pattern)
 */

import { ParentComponent } from 'solid-js';
import { SettingsProvider } from './SettingsContext';
import { LanguageProvider } from './LanguageContext';
import { FlashcardProvider } from './FlashcardContext';
import { ServerProvider } from './ServerContext';
import { LocalizationProvider } from './LocalizationContext';

/**
 * WindowWrapper wraps all window entry points with necessary providers
 * This ensures consistent context availability across all windows
 */
export const WindowWrapper: ParentComponent = (props) => {
  return (
    <ServerProvider>
      <LocalizationProvider>
        <SettingsProvider>
          <LanguageProvider>
            <FlashcardProvider>
              {props.children}
            </FlashcardProvider>
          </LanguageProvider>
        </SettingsProvider>
      </LocalizationProvider>
    </ServerProvider>
  );
};

export default WindowWrapper;
