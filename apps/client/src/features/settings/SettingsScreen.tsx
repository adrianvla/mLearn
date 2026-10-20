import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Snapshot, ThemeDocument } from '@mlearn/contracts';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { AppShell, Section, Row, SettingRow } from '@mlearn/ui/layout';
import { TextField } from '@mlearn/ui/text-field';
import { Dialog } from '@mlearn/ui/dialog';
import { applyTheme } from '@mlearn/theme/runtime';
import { builtInThemes, initialTheme, parseThemePreview, resolveBuiltInTheme } from '@mlearn/theme';
import { Select } from '@mlearn/ui/select';
import { Icon } from '@mlearn/ui/icon';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { LanguagePackageInstall } from './LanguagePackageInstall';
import { usePackageInstall } from './usePackageInstall';

type FeedbackTarget = 'runtime' | 'plugin' | 'theme';
type Feedback = { target: FeedbackTarget; message: string; error: boolean };

export function SettingsScreen() {
  const host = useRuntime();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const [section, setSection] = useState<'appearance' | 'languages' | 'runtime'>(
    params.section === 'languages' || params.section === 'runtime' ? params.section : 'appearance',
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [name, setName] = useState('world');
  const [editing, setEditing] = useState(false);
  const [themeJson, setThemeJson] = useState(JSON.stringify(initialTheme, null, 2));
  const [search, setSearch] = useState('');
  const [previewTheme, setPreviewTheme] = useState(initialTheme);
  const packageInstall = usePackageInstall(host.available ? host.client : null,
    section === 'languages' && snapshot?.codePolicy === 'desktop-downloaded', refresh);

  useEffect(() => {
    if (!host.available) return;
    let active = true;
    host.client.snapshot().then((value) => {
      if (!active) return;
      setSnapshot(value);
      setThemeJson(JSON.stringify(value.theme, null, 2));
      applyTheme(value.theme);
    }).catch((cause: unknown) => { if (active) report('runtime', cause instanceof Error ? cause.message : String(cause), true); });
    return () => { active = false; };
  }, [host]);

  async function refresh() {
    if (!host.available) return;
    const value = await host.client.snapshot();
    setSnapshot(value);
    setThemeJson(JSON.stringify(value.theme, null, 2));
    applyTheme(value.theme);
  }
  function report(target: FeedbackTarget, message: string, error = false) {
    setFeedback({ target, message, error });
  }
  function feedbackAt(target: FeedbackTarget) {
    if (!feedback || feedback.target !== target) return null;
    return <Text testID="runtime-message" accessibilityRole={feedback.error ? 'alert' : undefined}
      accessibilityLiveRegion={feedback.error ? 'assertive' : 'polite'}>{feedback.message}</Text>;
  }
  async function perform(target: FeedbackTarget, operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try { await operation(); }
    catch (cause) { report(target, cause instanceof Error ? cause.message : String(cause), true); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function saveTheme(theme: ThemeDocument) {
    if (!host.available || !snapshot) return;
    const revision = await host.client.saveTheme(theme, snapshot.revision);
    await refresh();
    report('theme', `Theme saved by Rust · revision ${revision}`);
    setEditing(false);
  }
  const installed = snapshot?.installedPlugins.find((plugin) => plugin.id === 'example.hello');
  const canSave = host.available && snapshot !== null && !busy;
  const displayedTheme = resolveBuiltInTheme(snapshot?.theme ?? previewTheme);
  const sections = [
    { value: 'appearance', label: 'Appearance', icon: 'palette', terms: 'appearance theme custom palette text size spacing radius' },
    { value: 'languages', label: 'Languages', icon: 'globe', terms: 'language packages install catalog update' },
    { value: 'runtime', label: 'Runtime', icon: 'settings', terms: 'runtime native plugin diagnostics sdk hello' },
  ] as const;

  return <AppShell header={<>
    <View style={styles.header}>
      <View style={styles.title}><Icon name="settings" size={20} color={theme.colors.text} />
        <Text variant="heading" accessibilityRole="header">Settings</Text></View>
      <View style={styles.home}><Button label="Home" icon="arrowLeft" iconOnly={width < 700} variant="quiet"
        onPress={() => router.canGoBack() ? router.back() : router.replace('/')} /></View>
    </View>
    <View style={styles.description}><Text muted variant="caption">Configure mLearn to your preferences</Text></View>
  </>} navigation={<>
    <View style={styles.search}><TextField label="Search settings" variant="search" value={search} maxLength={128}
      onChangeText={setSearch} placeholder="Search settings…" autoCorrect={false} /></View>
    {sections.filter(item => item.terms.includes(search.trim().toLowerCase())).map(item =>
      <Button key={item.value} label={item.label} icon={item.icon}
        accessibilityLabel={item.value === 'languages' ? 'Language packages' : item.label}
        accessibilityState={{ selected: section === item.value }}
        variant="navigation" onPress={() => setSection(item.value)} />)}
    {search && !sections.some(item => item.terms.includes(search.trim().toLowerCase()))
      ? <Text muted variant="caption">No matching settings.</Text> : null}
  </>}>
      <View style={styles.content}>
      {section === 'appearance' ? <Section title="Appearance">
        <SettingRow label="Theme" description={
          <Text variant="detail" muted>{snapshot ? `Current: ${displayedTheme.name}. Saved in the native SQLite profile.` : 'Preview only. Native storage is not connected.'}</Text>
        }>
          <Select label="Select theme" value={displayedTheme.id}
            options={builtInThemes.map(preset => ({ value: preset.id, label: preset.name }))}
            disabled={busy} onValueChange={id => {
              const preset = builtInThemes.find(value => value.id === id);
              if (!preset) return;
              if (canSave) void perform('theme', () => saveTheme(preset));
              else { setPreviewTheme(preset); applyTheme(preset); report('theme', 'Unsaved visual preview. No native data was written.'); }
            }} />
        </SettingRow>
        <SettingRow label="Custom theme" description={
          <Text variant="detail" muted>Palette, text size, spacing and corner radius.</Text>
        }>
          <Dialog open={editing} onOpenChange={setEditing} title="Custom theme"
            description="Edit a versioned theme document. Rust validates and commits saved changes."
            trigger={<Button label="Edit theme JSON" variant="secondary" />}>
            <TextField testID="theme-json-input" label="Theme JSON" value={themeJson} onChangeText={setThemeJson} multiline maxLength={24000} autoCapitalize="none" autoCorrect={false} />
            <Button label="Save custom theme" disabled={!canSave} onPress={() => void perform('theme', () => saveTheme(parseThemePreview(themeJson)))} />
            {!canSave && <Text variant="caption" muted>Native runtime required to save.</Text>}
            {editing && feedback?.target === 'theme' && feedback.error ? feedbackAt('theme') : null}
          </Dialog>
        </SettingRow>
        {!editing && feedbackAt('theme')}
      </Section> : null}
      {section === 'languages' ? <Section title="Language packages">
        {!host.available ? <Text accessibilityRole="alert">{host.reason}</Text> : <>
          {snapshot?.packageIssues?.map(issue => <SettingRow key={issue.packageId} label="Package unavailable" description={<>
              <Text variant="caption" muted selectable>{issue.packageId}</Text>
              <Text accessibilityRole="alert" selectable>{issue.message}</Text>
            </>} />)}
          {snapshot?.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1')).map(plugin =>
            <SettingRow key={plugin.id} label={plugin.displayName ?? 'Language name unavailable'} description={
                <Text variant="detail" muted selectable>{plugin.id} · {plugin.version}</Text>
            }>
              <Text variant="detail" tone="success">Installed</Text>
            </SettingRow>)}
          {snapshot?.codePolicy === 'desktop-downloaded'
            ? <LanguagePackageInstall client={host.client} snapshot={snapshot} install={packageInstall} />
            : <Text muted>{snapshot?.codePolicy === 'mobile-bundled' ? 'Language code is included with this app.' : 'No trusted language catalog is configured.'}</Text>}
          {feedbackAt('plugin')}
        </>}
      </Section> : null}
      {section === 'runtime' ? <Section title="Runtime">
      <Text>{host.label}</Text>
      {!host.available ? <Text muted>{host.reason}</Text> : <>
        <Text>Plugin code: {snapshot?.codePolicy ?? 'Connecting…'}</Text>
        <Text variant="caption" muted>Desktop downloads executable plugins. iOS and Android ship their executable plugins in the app. Language data remains separately packaged.</Text>
        <Button label="Reload native state" variant="secondary" disabled={busy} onPress={() => void perform('runtime', async () => { await refresh(); report('runtime', 'Native state reloaded.'); })} />
        {feedbackAt('runtime')}
      </>}
      <View style={styles.runtimeExample}>
      <Text variant="section" accessibilityRole="header">SDK example</Text>
      <Text variant="caption" muted>Run the installed example to check native plugin execution.</Text>
      <TextField label="Your name" value={name} onChangeText={setName} maxLength={128} autoCapitalize="none" editable={!busy} />
      <Row>
        {snapshot?.codePolicy === 'desktop-downloaded' && <Button label="Install SDK example" variant="secondary" disabled={!snapshot.catalogConfigured || busy} onPress={() => void perform('plugin', async () => {
          if (!host.available) return;
          await host.client.installPlugin('example.hello'); await refresh(); report('plugin', 'Verified plugin installed from the catalog.');
        })} />}
        <Button label="Run hello" disabled={!installed || busy || !name.trim()} onPress={() => void perform('plugin', async () => {
          if (!host.available) return;
          const result = await host.client.invokePlugin('example.hello', 'example::hello', { name });
          report('plugin', typeof result === 'object' && result !== null && 'message' in result && typeof result.message === 'string' ? result.message : JSON.stringify(result));
        })} />
        {feedbackAt('plugin')}
      </Row>
      {!installed && snapshot?.codePolicy === 'desktop-downloaded' && snapshot.catalogConfigured && <Text variant="caption" muted>Install the example before running it.</Text>}
      {snapshot?.codePolicy === 'desktop-downloaded' && !snapshot.catalogConfigured && <Text variant="caption" muted>No trusted catalog configured. Desktop development starts a local signed catalog; release builds need a publisher URL and public key.</Text>}
      </View>
      </Section> : null}
      </View>
  </AppShell>;
}

const styles = StyleSheet.create(theme => ({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.medium },
  home: { position: 'absolute', top: 0, right: 0 },
  description: { paddingLeft: 20 + theme.spacing.compact },
  title: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.compact },
  search: { width: '100%', marginBottom: theme.spacing.compact },
  content: { minWidth: 0, gap: theme.spacing.large },
  runtimeExample: { borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: theme.spacing.large, gap: theme.spacing.medium },
}));
