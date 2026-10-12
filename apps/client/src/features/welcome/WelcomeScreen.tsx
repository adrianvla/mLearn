import { useEffect, useState } from 'react';
import type { Snapshot, ThemeDocument } from '@mlearn/contracts';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Screen, Panel, Stack, Row } from '@mlearn/ui/layout';
import { TextField } from '@mlearn/ui/text-field';
import { Dialog } from '@mlearn/ui/dialog';
import { applyTheme } from '@mlearn/theme/runtime';
import { builtInThemes, initialTheme, parseThemePreview } from '@mlearn/theme';
import { useRuntime } from '../../bootstrap/RuntimeProvider';

/** Temporary integration surface: no learner data, fake reviews or parallel JS backend. */
export function WelcomeScreen() {
  const host = useRuntime();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
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
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [host]);

  async function refresh() {
    if (!host.available) return;
    const value = await host.client.snapshot();
    setSnapshot(value);
    setThemeJson(JSON.stringify(value.theme, null, 2));
    applyTheme(value.theme);
  }
  async function perform(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function saveTheme(theme: ThemeDocument) {
    if (!host.available || !snapshot) return;
    const revision = await host.client.saveTheme(theme, snapshot.revision);
    await refresh();
    setMessage(`Theme saved by Rust · revision ${revision}`);
    setEditing(false);
  }
  const installed = snapshot?.installedPlugins.find((plugin) => plugin.id === 'example.hello');
  const canSave = host.available && snapshot !== null && !busy;

  return <Screen>
    <Stack><Text variant="caption" muted>mLearn · v3 foundation</Text><Text variant="heading" accessibilityRole="header">One app. Native at the core.</Text><Text muted>This is an integration placeholder, not a learning session.</Text></Stack>
    <Panel>
      <Text variant="heading" accessibilityRole="header">Runtime</Text>
      <Text>{host.label}</Text>
      {!host.available ? <Text muted>{host.reason}</Text> : <>
        <Text>Plugin code: {snapshot?.codePolicy ?? 'Connecting…'}</Text>
        <Text variant="caption" muted>Desktop downloads executable plugins. iOS and Android ship their executable plugins in the app. Language data remains separately packaged.</Text>
        <Button label="Reload native state" variant="secondary" disabled={busy} onPress={() => void perform(refresh)} />
      </>}
    </Panel>
    <Panel>
      <Text variant="heading" accessibilityRole="header">Hello, plugin</Text>
      <Text muted>A Rust SDK fixture executed by Wasmi. Its greeting comes from a separate data asset.</Text>
      <TextField label="Your name" value={name} onChangeText={setName} maxLength={128} autoCapitalize="none" editable={!busy} />
      <Row>
        {snapshot?.codePolicy === 'desktop-downloaded' && <Button label="Install SDK example" variant="secondary" disabled={!snapshot.catalogConfigured || busy} onPress={() => void perform(async () => {
          if (!host.available) return;
          await host.client.installPlugin('example.hello'); await refresh(); setMessage('Verified plugin installed from the catalog.');
        })} />}
        <Button label="Run hello" disabled={!installed || busy || !name.trim()} onPress={() => void perform(async () => {
          if (!host.available) return;
          const result = await host.client.invokePlugin('example.hello', 'example::hello', { name });
          setMessage(typeof result === 'object' && result !== null && 'message' in result && typeof result.message === 'string' ? result.message : JSON.stringify(result));
        })} />
      </Row>
      {snapshot?.codePolicy === 'desktop-downloaded' && !snapshot.catalogConfigured && <Text variant="caption" muted>No trusted catalog configured. Desktop development starts a local signed catalog; release builds need a publisher URL and public key.</Text>}
    </Panel>
    <Panel>
      <Text variant="heading" accessibilityRole="header">Theme</Text>
      <Text muted>{snapshot ? `Current: ${snapshot.theme.name}. Saved in the native SQLite profile.` : 'Preview only. Native storage is not connected.'}</Text>
      <Row>{builtInThemes.map((theme) => <Button key={theme.id} label={theme.name} variant="secondary" disabled={busy} onPress={() => {
        if (canSave) void perform(() => saveTheme(theme));
        else { applyTheme(theme); setMessage('Unsaved visual preview. No native data was written.'); }
      }} />)}</Row>
      <Dialog open={editing} onOpenChange={setEditing} title="Custom theme" description="Edit a versioned theme document. Rust validates and commits saved changes." trigger={<Button label="Edit theme JSON" variant="secondary" />}>
        <TextField label="Theme JSON" value={themeJson} onChangeText={setThemeJson} multiline maxLength={24000} autoCapitalize="none" autoCorrect={false} />
        <Button label="Save custom theme" disabled={!canSave} onPress={() => void perform(() => saveTheme(parseThemePreview(themeJson)))} />
        {!canSave && <Text variant="caption" muted>Native runtime required to save.</Text>}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      </Dialog>
    </Panel>
    {message ? <Text accessibilityLiveRegion="polite" testID="runtime-message">{message}</Text> : null}
    {error && !editing ? <Panel><Text accessibilityRole="alert">{error}</Text></Panel> : null}
    <Text variant="caption" muted>The learner model, real language packages, sync and neural inference are not implemented by this placeholder.</Text>
  </Screen>;
}
