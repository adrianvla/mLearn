import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { PluginSummary, Snapshot, ThemeDocument } from '@mlearn/contracts';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Screen, Stack, Row } from '@mlearn/ui/layout';
import { TextField } from '@mlearn/ui/text-field';
import { Dialog } from '@mlearn/ui/dialog';
import { applyTheme } from '@mlearn/theme/runtime';
import { builtInThemes, initialTheme, parseThemePreview } from '@mlearn/theme';
import { useRuntime } from '../../bootstrap/RuntimeProvider';

type FeedbackTarget = 'runtime' | 'plugin' | 'theme';
type Feedback = { target: FeedbackTarget; message: string; error: boolean };

export function SettingsScreen() {
  const host = useRuntime();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const { width } = useWindowDimensions();
  const [section, setSection] = useState<'appearance' | 'languages' | 'runtime'>(
    params.section === 'languages' || params.section === 'runtime' ? params.section : 'appearance',
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [catalog, setCatalog] = useState<PluginSummary[]>([]);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [name, setName] = useState('world');
  const [editing, setEditing] = useState(false);
  const [themeJson, setThemeJson] = useState(JSON.stringify(initialTheme, null, 2));

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

  return <Screen>
    <View style={styles.header}>
      <Text variant="heading" accessibilityRole="header">Settings</Text>
      <Button label="Home" variant="quiet" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
    </View>
    <View style={styles.layout}>
      <View style={styles.navigation(width < 700)}>
        {(['appearance', 'languages', 'runtime'] as const).map(value => <Button key={value}
          label={`${section === value ? '✓ ' : ''}${value === 'appearance' ? 'Appearance' : value === 'languages' ? 'Languages' : 'Runtime'}`}
          accessibilityLabel={value === 'appearance' ? 'Appearance' : value === 'languages' ? 'Language packages' : 'Runtime'}
          accessibilityState={{ selected: section === value }}
          variant={section === value ? 'secondary' : 'quiet'} onPress={() => setSection(value)} />)}
      </View>
      <View style={styles.content}>
      {section === 'appearance' ? <Stack>
        <Text variant="section" accessibilityRole="header">Appearance</Text>
        <View style={styles.setting}>
          <View style={styles.settingLabel}>
            <Text>Theme</Text>
            <Text variant="caption" muted>{snapshot ? `Current: ${snapshot.theme.name}. Saved in the native SQLite profile.` : 'Preview only. Native storage is not connected.'}</Text>
          </View>
          <Row>{builtInThemes.map(theme => <Button key={theme.id} label={theme.name} variant="secondary"
            accessibilityState={{ selected: snapshot?.theme.id === theme.id }} disabled={busy} onPress={() => {
              if (canSave) void perform('theme', () => saveTheme(theme));
              else { applyTheme(theme); report('theme', 'Unsaved visual preview. No native data was written.'); }
            }} />)}</Row>
        </View>
        <View style={styles.setting}>
          <View style={styles.settingLabel}>
            <Text>Custom theme</Text>
            <Text variant="caption" muted>Palette, text size, spacing and corner radius.</Text>
          </View>
          <Dialog open={editing} onOpenChange={setEditing} title="Custom theme"
            description="Edit a versioned theme document. Rust validates and commits saved changes."
            trigger={<Button label="Edit theme JSON" variant="secondary" />}>
            <TextField testID="theme-json-input" label="Theme JSON" value={themeJson} onChangeText={setThemeJson} multiline maxLength={24000} autoCapitalize="none" autoCorrect={false} />
            <Button label="Save custom theme" disabled={!canSave} onPress={() => void perform('theme', () => saveTheme(parseThemePreview(themeJson)))} />
            {!canSave && <Text variant="caption" muted>Native runtime required to save.</Text>}
            {editing && feedback?.target === 'theme' && feedback.error ? feedbackAt('theme') : null}
          </Dialog>
        </View>
        {!editing && feedbackAt('theme')}
      </Stack> : null}
      {section === 'languages' ? <Stack>
        <Text variant="section" accessibilityRole="header">Language packages</Text>
        {!host.available ? <Text accessibilityRole="alert">{host.reason}</Text> : <>
          {snapshot?.packageIssues?.map(issue => <View key={issue.packageId} style={styles.setting}>
            <View style={styles.settingLabel}>
              <Text>Package unavailable</Text>
              <Text variant="caption" muted selectable>{issue.packageId}</Text>
              <Text accessibilityRole="alert" selectable>{issue.message}</Text>
            </View>
          </View>)}
          {snapshot?.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1')).map(plugin =>
            <View key={plugin.id} style={styles.setting}>
              <View style={styles.settingLabel}>
                <Text>{plugin.displayName ?? 'Language name unavailable'}</Text>
                <Text variant="caption" muted selectable>{plugin.id} · {plugin.version}</Text>
              </View>
              <Text variant="caption" muted>Installed</Text>
            </View>)}
          {snapshot?.catalogConfigured ? <>
            <Row><Button label="Check for packages" variant="secondary" disabled={busy}
              onPress={() => void perform('plugin', async () => {
                setCatalog((await host.client.availablePackages()).filter(plugin => plugin.capabilities.includes('text.analyze.v1')));
              })} /></Row>
            {catalog.map(plugin => <View key={plugin.id} style={styles.setting}>
              <View style={styles.settingLabel}>
                <Text>{plugin.displayName ?? 'Unnamed language package'}</Text>
                <Text variant="caption" muted selectable>{plugin.version}</Text>
              </View>
              <Button label={`${snapshot.installedPlugins.some(installed => installed.id === plugin.id) ? 'Update' : 'Install'} ${plugin.displayName ?? plugin.id}`}
                variant="secondary" disabled={busy} onPress={() => void perform('plugin', async () => {
                  await host.client.installPlugin(plugin.id);
                  await refresh();
                })} />
            </View>)}
          </> : <Text muted>{snapshot?.codePolicy === 'mobile-bundled' ? 'Language code is included with this app.' : 'No trusted language catalog is configured.'}</Text>}
          {feedbackAt('plugin')}
        </>}
      </Stack> : null}
      {section === 'runtime' ? <Stack>
      <Text variant="section" accessibilityRole="header">Runtime</Text>
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
      </Stack> : null}
      </View>
    </View>
  </Screen>;
}

const styles = StyleSheet.create(theme => ({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.medium },
  layout: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: theme.spacing.section },
  navigation: (compact: boolean) => ({ flexDirection: compact ? 'row' : 'column', flexWrap: 'wrap', width: compact ? '100%' : 180, gap: theme.spacing.small }),
  content: { flex: 1, minWidth: 260, gap: theme.spacing.large },
  setting: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.medium, paddingVertical: theme.spacing.large, borderBottomWidth: 1, borderColor: theme.colors.border },
  settingLabel: { flex: 1, minWidth: 180, gap: theme.spacing.small },
  runtimeExample: { borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: theme.spacing.large, gap: theme.spacing.medium },
}));
