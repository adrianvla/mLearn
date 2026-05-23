/**
 * About Tab
 */

import { Component, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { TabContent, Btn } from '../../../components/common';
import { useLocalization, useSettings } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import './AboutTab.css';
import AppLogo from "@renderer/components/common/Misc/AppLogo";

export const AboutTab: Component = () => {
  const [version, setVersion] = createSignal('1.0.0');
  const { t } = useLocalization();
  const { settings } = useSettings();

  onMount(() => {
    const bridge = getBridge();
    bridge.server.getVersion();
    const cleanup = bridge.server.onVersionReceive((version: string) => {
      setVersion(version);
    });
    onCleanup(cleanup);
  });

  const openContact = () => {
    getBridge().window.showContact();
  };

  const openLicenses = () => {
    getBridge().window.openWindow({
      type: 'licenses',
      options: { width: 900, height: 700 },
    });
  };

  const openDiagnostics = () => {
    getBridge().window.openWindow({
      type: 'diagnostics',
      options: { width: 900, height: 700 },
    });
  };

  return (
    <TabContent padding="lg" class="about-tab">
      <div class="about-logo"><AppLogo/></div>
      
      <div class="about-version">
        <h2>{t('mlearn.About.Title')}</h2>
        <span>{t('mlearn.About.VersionLabel', { version: version() })}</span>
      </div>

      <div class="about-description">
        <p>
          {t('mlearn.About.Description')}
        </p>
      </div>

      <div class="about-links">
        <Btn variant="ghost" onClick={openContact}>
          {t('mlearn.About.Website')}
        </Btn>
        <Btn variant="ghost" onClick={openLicenses}>
          {t('mlearn.About.Licenses')}
        </Btn>
        <Show when={settings.devMode}>
          <Btn variant="ghost" onClick={openDiagnostics}>
            Run Diagnostics
          </Btn>
        </Show>
      </div>

      <div class="about-legal">
        <Btn variant="ghost" onClick={() => getBridge().window.openExternalUrl('https://mlearn.kikan.net/eula')}>
          End User License Agreement
        </Btn>
        <Btn variant="ghost" onClick={() => getBridge().window.openExternalUrl('https://mlearn.kikan.net/terms')}>
          Terms of Service
        </Btn>
        <Btn variant="ghost" onClick={() => getBridge().window.openExternalUrl('https://mlearn.kikan.net/privacy')}>
          Privacy Policy
        </Btn>
        <Btn variant="ghost" onClick={() => getBridge().window.openExternalUrl('https://mlearn.kikan.net/school-deployment')}>
          School Deployment
        </Btn>
      </div>

      <div class="about-shortcuts">
        <h3>{t('mlearn.About.KeyboardShortcuts.Title')}</h3>
        <div class="shortcuts-grid">
          <ShortcutRow shortcut="Space" description={t('mlearn.About.KeyboardShortcuts.Space')} />
          <ShortcutRow shortcut="←/→" description={t('mlearn.About.KeyboardShortcuts.LeftRight')} />
          <ShortcutRow shortcut="↑/↓" description={t('mlearn.About.KeyboardShortcuts.UpDown')} />
          <ShortcutRow shortcut="F" description={t('mlearn.About.KeyboardShortcuts.F')} />
          <ShortcutRow shortcut="M" description={t('mlearn.About.KeyboardShortcuts.M')} />
          <ShortcutRow shortcut="1-4" description={t('mlearn.About.KeyboardShortcuts.Numbers')} />
          <ShortcutRow shortcut="Cmd/Ctrl+Z" description={t('mlearn.About.KeyboardShortcuts.Undo')} />
        </div>
      </div>
    </TabContent>
  );
};

const ShortcutRow: Component<{ shortcut: string; description: string }> = (props) => (
  <div class="shortcut-row">
    <span class="shortcut-description">{props.description}</span>
    <kbd class="shortcut-key">{props.shortcut}</kbd>
  </div>
);
