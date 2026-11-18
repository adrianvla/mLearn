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
import { SegmentedControl } from '@mlearn/ui/segmented-control';
import { applyTheme } from '@mlearn/theme/runtime';
import { builtInThemes, initialTheme, parseThemePreview, resolveBuiltInTheme } from '@mlearn/theme';
import { Select } from '@mlearn/ui/select';
import { Icon, type IconName } from '@mlearn/ui/icon';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { useViewPreferences } from '../../bootstrap/ViewPreferences';
import { LanguagePackageInstall, releaseVersion } from './LanguagePackageInstall';
import { usePackageInstall } from './usePackageInstall';
import { OcrModels } from './OcrModels';
import { InlineLevelScaleSetting } from './InlineLevelScaleSetting';
import { VoiceSettings } from './VoiceSettings';
import { useDeveloperMode } from '../../bootstrap/developerMode';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { failure, type Failure } from '../failure';

type FeedbackTarget = 'runtime' | 'plugin' | 'theme';
const failedAction: Record<FeedbackTarget, string> = {
  runtime: 'Settings couldn’t be reloaded.',
  plugin: 'The example plugin didn’t run.',
  theme: 'This theme wasn’t saved.',
};
type Feedback = { target: FeedbackTarget; message: string; error: boolean; detail?: string | null };

type SectionId = 'general' | 'reader' | 'ai' | 'plugins' | 'components' | 'developer';
const sections: readonly { value: SectionId; label: string; icon: IconName; terms: string; developer?: true }[] = [
  { value: 'general', label: 'General', icon: 'settings', terms: 'general appearance theme colors developer mode' },
  { value: 'reader', label: 'Reader', icon: 'book', terms: 'reader reading aids level marks scale display' },
  { value: 'ai', label: 'AI', icon: 'conversation', terms: 'ai voice speech service model listening default voice session key test' },
  { value: 'plugins', label: 'Plugins', icon: 'package', terms: 'plugins language packages install update catalog' },
  { value: 'components', label: 'Components', icon: 'settings', terms: 'components text recognition ocr models install remove' },
  { value: 'developer', label: 'Developer', icon: 'settings', terms: 'developer runtime reload sdk example custom theme json', developer: true },
];
// Older links name the previous sections; they keep opening the section that now owns that content.
const sectionLinks: Record<string, SectionId> = {
  general: 'general', appearance: 'general', reader: 'reader', ai: 'ai', voice: 'ai',
  plugins: 'plugins', languages: 'plugins', components: 'components', developer: 'developer', runtime: 'developer',
};
const unavailableHere = 'These settings need the mLearn app.';

export function SettingsScreen() {
  const host = useRuntime();
  const viewPreferences = useViewPreferences();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const [developerMode, setDeveloperMode] = useDeveloperMode();
  const [chosen, setChosen] = useState<SectionId>(sectionLinks[params.section ?? ''] ?? 'general');
  useEffect(() => { const linked = sectionLinks[params.section ?? '']; if (linked) setChosen(linked); }, [params.section]);
  const section: SectionId = chosen === 'developer' && !developerMode ? 'general' : chosen;
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
    section === 'plugins' && snapshot?.codePolicy === 'desktop-downloaded', refresh);

  useEffect(() => {
    if (!host.available) return;
    let active = true;
    host.client.snapshot().then((value) => {
      if (!active) return;
      setSnapshot(value);
      viewPreferences.publish(value.viewPreferences ?? null);
      setThemeJson(JSON.stringify(value.theme, null, 2));
      applyTheme(value.theme);
    }).catch((cause: unknown) => { if (active) fail('runtime', failure(cause, 'Settings couldn’t be loaded.')); });
    return () => { active = false; };
  }, [host]);

  async function refresh() {
    if (!host.available) return;
    const value = await host.client.snapshot();
    setSnapshot(value);
    viewPreferences.publish(value.viewPreferences ?? null);
    setThemeJson(JSON.stringify(value.theme, null, 2));
    applyTheme(value.theme);
  }
  function report(target: FeedbackTarget, message: string) {
    setFeedback({ target, message, error: false });
  }
  function fail(target: FeedbackTarget, { message, detail }: Failure) {
    setFeedback({ target, message, error: true, detail });
  }
  function feedbackAt(target: FeedbackTarget) {
    if (!feedback || feedback.target !== target) return null;
    if (feedback.error) return <FailureNotice testID="runtime-message" message={feedback.message} detail={feedback.detail} />;
    return <Text testID="runtime-message" variant={target === 'theme' ? 'detail' : 'body'} muted={target === 'theme'}
      accessibilityLiveRegion="polite">{feedback.message}</Text>;
  }
  async function perform(target: FeedbackTarget, operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try { await operation(); }
    catch (cause) { fail(target, failure(cause, failedAction[target])); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function saveTheme(theme: ThemeDocument) {
    if (!host.available || !snapshot) return;
    await host.client.saveTheme(theme, snapshot.revision);
    await refresh();
    setEditing(false);
  }
  const installed = snapshot?.installedPlugins.find((plugin) => plugin.id === 'example.hello');
  const canSave = host.available && snapshot !== null && !busy;
  const displayedTheme = resolveBuiltInTheme(snapshot?.theme ?? previewTheme);
  const selectedPreset = builtInThemes.find(preset =>
    preset.id === displayedTheme.id && preset.name === displayedTheme.name
    && preset.schemaVersion === displayedTheme.schemaVersion && preset.radius === displayedTheme.radius
    && preset.textScale === displayedTheme.textScale && preset.spacingScale === displayedTheme.spacingScale
    && Object.keys(displayedTheme.extensions).length === 0
    && (['background', 'surface', 'text', 'muted', 'accent', 'onAccent', 'border'] as const)
      .every(key => preset.colors[key] === displayedTheme.colors[key]));
  const themeOptions = builtInThemes.map(preset => ({ value: preset.id, label: preset.name }));
  // A custom document may keep a preset ID. Its view-only value must still
  // let choosing that preset replace the custom document through native save.
  if (!selectedPreset) themeOptions.push({ value: 'custom', label: `${displayedTheme.name} (custom)` });
  const query = search.trim().toLowerCase();
  const visible = sections.filter(item => (!item.developer || developerMode) && item.terms.includes(query));
  const current = sections.find(item => item.value === section)!;
  const unavailable = !host.available ? <Text muted>{unavailableHere}</Text> : null;

  return <AppShell header={<>
    <View style={styles.header}>
      <View style={styles.heading}>
        <View style={styles.title}><Icon name={current.icon} size={20} color={theme.colors.text} />
          <Text variant="heading" accessibilityRole="header" selectable={false}>
            {section === 'general' ? 'Settings' : current.label}</Text></View>
      </View>
      <View style={styles.home}><Button label="Home" icon="arrowLeft" iconOnly={width < 700} variant="quiet"
        onPress={() => router.canGoBack() ? router.back() : router.replace('/')} /></View>
    </View>
  </>} navigation={<View style={styles.chrome}>
    <View style={styles.search}><TextField label="Search settings" variant="search" value={search} maxLength={128}
      onChangeText={setSearch} placeholder="Search settings…" autoCorrect={false} /></View>
    {visible.map(item =>
      <Button key={item.value} label={item.label} icon={item.icon}
        accessibilityState={{ selected: section === item.value }}
        variant="navigation" onPress={() => setChosen(item.value)} />)}
    {!visible.length ? <Text muted variant="caption" selectable={false}>No matching settings.</Text> : null}
  </View>}>
      <View style={[styles.content, styles.chrome]}>
      {section === 'general' ? <Section title="Appearance">
        <SettingRow label="Theme" description={<Text variant="detail" muted>
          {snapshot ? 'Select the visual theme for the application.' : 'Preview only. Changes are not saved.'}</Text>}>
          <Select label="Select theme" value={selectedPreset?.id ?? 'custom'}
            options={themeOptions}
            disabled={busy} onValueChange={id => {
              const preset = builtInThemes.find(value => value.id === id);
              if (!preset) return;
              if (canSave) void perform('theme', () => saveTheme(preset));
              else { setPreviewTheme(preset); applyTheme(preset); }
            }} />
        </SettingRow>
        {busy && feedback === null ? <Text variant="detail" muted accessibilityLiveRegion="polite">Saving…</Text> : null}
        {!editing && feedbackAt('theme')}
        <SettingRow label="Developer mode" description={<Text variant="detail" muted>Show developer tools and diagnostics.</Text>}>
          <SegmentedControl value={developerMode ? 'on' : 'off'}
            options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
            onValueChange={value => setDeveloperMode(value === 'on')} />
        </SettingRow>
      </Section> : null}
      {section === 'reader' ? <Section title="Reading aids">
        {!host.available ? unavailable : (snapshot
          ? <InlineLevelScaleSetting client={host.client} snapshot={snapshot} onSaved={refresh} />
          : <Text variant="detail" muted>Loading…</Text>)}
      </Section> : null}
      {section === 'ai' ? <Section title="Voice">
        {!host.available ? unavailable : <VoiceSettings client={host.client} speech={host.speech} />}
      </Section> : null}
      {section === 'plugins' ? <Section title="Language packages">
        {!host.available ? unavailable : <>
          {snapshot?.packageIssues?.map(issue => <SettingRow key={issue.packageId} label="Package unavailable" description={
              <FailureNotice message="This language package can’t be used." detail={developerMode
                ? `${issue.packageId}: ${issue.message}` : issue.message} />} />)}
          {snapshot?.codePolicy !== 'desktop-downloaded' ? snapshot?.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1')).map(plugin =>
            <SettingRow key={plugin.id} label={plugin.displayName ?? 'Language package'} description={
                <Text variant="detail" muted>Version {releaseVersion(plugin.version)}</Text>
            }>
              <Text variant="detail" tone="success">Installed</Text>
            </SettingRow>) : null}
          {snapshot?.codePolicy === 'desktop-downloaded'
            ? <LanguagePackageInstall client={host.client} snapshot={snapshot} install={packageInstall} onRemoved={refresh} />
            : snapshot ? <Text muted>{snapshot.codePolicy === 'mobile-bundled'
              ? 'Languages are included with this app.' : 'Language downloads aren’t available here.'}</Text> : null}
        </>}
      </Section> : null}
      {section === 'components' ? <Section title="OCR models">
        {!host.available ? unavailable : host.ocrModels ? <OcrModels models={host.ocrModels} />
          : <Text muted>Text recognition is built into this device.</Text>}
      </Section> : null}
      {section === 'developer' ? <>
      <Section title="Runtime">
      <Text>{host.label}</Text>
      {!host.available ? <Text muted>{host.reason}</Text> : <>
        <Text>Plugin code: {snapshot?.codePolicy ?? 'Connecting…'}</Text>
        <Text variant="caption" muted>Desktop downloads executable plugins. iOS and Android ship their executable plugins in the app. Language data remains separately packaged.</Text>
        <Row><Button label="Reload native state" variant="secondary" disabled={busy} onPress={() => void perform('runtime', refresh)} /></Row>
        {feedbackAt('runtime')}
      </>}
      <View style={styles.runtimeExample}>
      <Text variant="section" accessibilityRole="header">SDK example</Text>
      <TextField label="Your name" value={name} onChangeText={setName} maxLength={128} autoCapitalize="none" editable={!busy} />
      <Row>
        {snapshot?.codePolicy === 'desktop-downloaded' && <Button label="Install SDK example" variant="secondary" disabled={!snapshot.catalogConfigured || busy} onPress={() => void perform('plugin', async () => {
          if (!host.available) return;
          await host.client.installPlugin('example.hello'); await refresh();
        })} />}
        <Button label="Run hello" disabled={!installed || busy || !name.trim()} onPress={() => void perform('plugin', async () => {
          if (!host.available) return;
          const result = await host.client.invokePlugin('example.hello', 'example::hello', { name });
          report('plugin', typeof result === 'object' && result !== null && 'message' in result && typeof result.message === 'string' ? result.message : JSON.stringify(result));
        })} />
        {feedbackAt('plugin')}
      </Row>
      {!host.available ? <Text variant="caption" muted>Needs the native runtime.</Text>
        : !installed && snapshot?.codePolicy === 'desktop-downloaded' && snapshot.catalogConfigured ? <Text variant="caption" muted>Install the example before running it.</Text>
        : !installed && snapshot?.codePolicy !== 'desktop-downloaded' ? <Text variant="caption" muted>The example isn’t bundled with this app.</Text> : null}
      {snapshot?.codePolicy === 'desktop-downloaded' && !snapshot.catalogConfigured && <Text variant="caption" muted>No trusted catalog configured. Desktop development starts a local signed catalog; release builds need a publisher URL and public key.</Text>}
      </View>
      </Section>
      <Section title="Custom theme">
        <SettingRow label="Theme document" description={<Text variant="detail" muted>Edit the active theme as JSON.</Text>}>
          <Dialog open={editing} onOpenChange={setEditing} title="Custom theme"
            trigger={<Button label="Edit theme JSON" variant="secondary" />}>
            <TextField testID="theme-json-input" label="Theme JSON" value={themeJson} onChangeText={setThemeJson} multiline maxLength={24000} autoCapitalize="none" autoCorrect={false} />
            <Button label="Save custom theme" disabled={!canSave} onPress={() => void perform('theme', () => saveTheme(parseThemePreview(themeJson)))} />
            {!canSave && <Text variant="caption" muted>Native runtime required to save.</Text>}
            {editing && feedback?.target === 'theme' && feedback.error ? feedbackAt('theme') : null}
          </Dialog>
        </SettingRow>
        {!editing && feedbackAt('theme')}
      </Section>
      </> : null}
      </View>
  </AppShell>;
}

const styles = StyleSheet.create(theme => ({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.spacing.medium },
  heading: { flex: 1, minWidth: 0, gap: theme.spacing.tiny },
  home: { flexShrink: 0 },
  title: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.compact },
  chrome: { userSelect: 'none' },
  search: { width: '100%', marginBottom: theme.spacing.compact },
  content: { minWidth: 0, gap: theme.spacing.large },
  runtimeExample: { borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: theme.spacing.large, gap: theme.spacing.medium },
}));
