import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import type { Snapshot } from '@mlearn/contracts';
import { Button } from '@mlearn/ui/button';
import { Panel, Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { useSourceImport } from './useSourceImport';

/** Empty Reader/Watch entry; imports retain the same shared native source owner. */
export function SourceEntryScreen({ kind, preferredPackage }: {
  readonly kind: 'document' | 'video';
  readonly preferredPackage?: string;
}) {
  const host = useRuntime();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState(preferredPackage ?? '');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const sourceImport = useSourceImport(selected);
  useEffect(() => { setSelected(preferredPackage ?? ''); }, [preferredPackage]);
  useFocusEffect(useCallback(() => {
    if (!host.available) return;
    let active = true;
    setPending(true);
    setError('');
    host.client.snapshot().then(value => {
      if (!active) return;
      const available = value.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1'));
      setSnapshot(value);
      setSelected(current => available.find(plugin => plugin.id === current)?.id
        ?? (preferredPackage ? '' : available[0]?.id ?? ''));
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [host, preferredPackage, reload]));
  const languages = snapshot?.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1')) ?? [];
  const chooseLanguage = !preferredPackage || !languages.some(plugin => plugin.id === preferredPackage);
  const disabled = !host.available || !snapshot || pending || !selected || sourceImport.busy;
  const cancelLabel = sourceImport.opening === 'images' || sourceImport.opening === 'folder'
    ? 'Cancel image opening' : sourceImport.opening === 'document' ? 'Cancel document opening' : 'Cancel opening';
  return <View style={styles.root(insets.bottom)}>
    <View style={styles.header(insets.top, host.available ? host.windowControlsWidth ?? 0 : 0)}>
      <Button label="Home" icon="arrowLeft" size="compact" variant="secondary" onPress={() => router.dismissTo('/')} />
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <View style={styles.card}><Panel inset="spacious" material="solid">
        <Text variant="entryTitle" accessibilityRole="header" align="center">
          {kind === 'document' ? 'Open a document' : 'Open a video'}
        </Text>
        <Text muted align="center">{kind === 'document'
          ? 'Import text, EPUB, PDF or images to start reading.'
          : 'Open a local video to start watching.'}</Text>
        {!host.available ? <Text accessibilityRole="alert">{host.reason}</Text> : null}
        {pending && host.available ? <Text accessibilityLiveRegion="polite" muted>Loading source languages…</Text> : null}
        {chooseLanguage && languages.length ? <Select label="Source language" value={selected}
          options={languages.map(plugin => ({ value: plugin.id, label: plugin.displayName ?? plugin.id }))}
          onValueChange={setSelected} disabled={pending || sourceImport.busy} /> : null}
        {!pending && snapshot && preferredPackage && !selected && languages.length
          ? <Text accessibilityRole="alert">The selected source language is unavailable. Choose an installed package.</Text> : null}
        {host.available && host.media.subscribeDrop ? <View style={styles.dropzone}>
          <Text muted align="center">{kind === 'document' ? 'Drop a document or image files here.' : 'Drop a video here.'}</Text>
        </View> : null}
        <View style={styles.actions}><Row>
          {kind === 'document' ? <>
            <Button testID="reader-open-document" label="Open document" variant="secondary" disabled={disabled}
              busy={sourceImport.opening === 'document'} onPress={() => void sourceImport.openDocument()} />
            <Button testID="reader-open-images" label="Open images" variant="secondary" disabled={disabled}
              busy={sourceImport.opening === 'images'} onPress={() => void sourceImport.openImages(false)} />
            {host.available && host.documents.supportsFolders ? <Button label="Open image folder" variant="secondary"
              disabled={disabled} busy={sourceImport.opening === 'folder'}
              onPress={() => void sourceImport.openImages(true)} /> : null}
          </> : <Button label="Open local video" icon="video" variant="secondary" disabled={disabled}
            busy={sourceImport.opening === 'video'} onPress={() => void sourceImport.openVideo()} />}
        </Row></View>
        {sourceImport.opening ? <Button label={cancelLabel} variant="secondary" onPress={sourceImport.cancel} /> : null}
        {sourceImport.error ? <Text accessibilityRole="alert">{sourceImport.error}</Text> : null}
        {error ? <><Text accessibilityRole="alert">{error}</Text>
          <Button label="Retry source languages" variant="secondary" onPress={() => setReload(value => value + 1)} /></> : null}
        {host.available && !pending && snapshot && !languages.length ? <>
          <Text muted>Install a language package before opening a source.</Text>
          <Button label="Get language packages" variant="secondary"
            onPress={() => router.push({ pathname: '/settings', params: { section: 'languages' } })} />
        </> : null}
      </Panel></View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create(theme => ({
  root: (bottom: number) => ({ flex: 1, minHeight: 0, paddingBottom: bottom, backgroundColor: theme.media.background }),
  header: (top: number, controls: number) => ({
    flexDirection: 'row', alignItems: 'center',
    paddingTop: top + theme.spacing.small, paddingBottom: theme.spacing.small,
    paddingLeft: controls ? controls + theme.spacing.section + theme.spacing.tiny : theme.spacing.compact,
    paddingRight: theme.spacing.compact, backgroundColor: theme.colors.surface,
    borderBottomWidth: 1, borderColor: theme.colors.border,
  }),
  scroll: { flex: 1, minHeight: 0 },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.large },
  card: { width: '100%', maxWidth: 600 },
  actions: { alignItems: 'center' },
  dropzone: { padding: theme.spacing.large, borderWidth: 2, borderStyle: 'dashed',
    borderColor: theme.colors.border, borderRadius: theme.radius },
}));
