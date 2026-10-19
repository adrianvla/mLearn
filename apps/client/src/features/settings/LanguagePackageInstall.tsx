import { useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { PackageInstallPhase, PluginSummary, Snapshot } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Row, Stack } from '@mlearn/ui/layout';
import type { usePackageInstall } from './usePackageInstall';

const phases = {
  downloading: 'Downloading',
  validating: 'Validating',
  succeeded: 'Installed',
  failed: 'Installation failed',
  cancelled: 'Cancelled',
} satisfies Record<PackageInstallPhase, string>;

export function LanguagePackageInstall({ client, snapshot, install }: {
  readonly client: RuntimeClient;
  readonly snapshot: Snapshot;
  readonly install: ReturnType<typeof usePackageInstall>;
}) {
  const [catalog, setCatalog] = useState<PluginSummary[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  const status = install.status;
  const active = status?.phase === 'downloading' || status?.phase === 'validating';
  const retryable = status?.phase === 'failed' || status?.phase === 'cancelled';
  const packageName = catalog.find(plugin => plugin.id === install.command?.pluginId)?.displayName
    ?? snapshot.installedPlugins.find(plugin => plugin.id === install.command?.pluginId)?.displayName
    ?? install.command?.pluginId;

  async function checkCatalog() {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      setCatalog((await client.availablePackages()).filter(plugin => plugin.capabilities.includes('text.analyze.v1')));
      setCatalogError(null);
    } catch (cause: unknown) {
      setCatalogError(cause instanceof Error ? cause.message : String(cause));
    } finally { checkingRef.current = false; setChecking(false); }
  }

  return <Stack>
    {snapshot.catalogConfigured ? <Row>
      <Button label={checking ? 'Checking packages…' : 'Check for packages'} variant="secondary"
        disabled={checking || active || install.submitting} onPress={() => void checkCatalog()} />
    </Row> : <Text muted>No trusted language catalog is configured.</Text>}
    {catalogError && <Text accessibilityRole="alert" selectable>{catalogError}</Text>}
    {install.command && <View style={styles.setting}>
      <View style={styles.label}>
        <Text>{packageName}</Text>
        <Text accessibilityLiveRegion="polite">{status ? phases[status.phase] : 'Waiting for native install status'}</Text>
        {status && <Text variant="caption" muted selectable>
          {status.downloadedBytes} bytes received{status.totalBytes === null ? ' · total not yet declared' : ` / ${status.totalBytes} bytes declared`}
        </Text>}
        {status?.message && <Text accessibilityRole={status.phase === 'failed' ? 'alert' : undefined} selectable>{status.message}</Text>}
        {active && install.cancelRequested === status.command.commandId && <Text variant="caption">
          Cancellation requested; waiting for native acknowledgement.
        </Text>}
      </View>
      <Row>
        {active && <Button label={install.cancelError ? 'Retry cancellation' : 'Cancel installation'} variant="secondary"
          disabled={install.cancelRequested === status.command.commandId && !install.cancelError}
          onPress={() => void install.cancel()} />}
        {retryable && <Button label="Retry installation" variant="secondary" disabled={!install.canStart}
          onPress={() => install.start(status.command.pluginId)} />}
      </Row>
    </View>}
    {install.installError && <Text accessibilityRole="alert" selectable>Install response: {install.installError}</Text>}
    {install.canReplay && <Row><Button label="Replay same install request" variant="secondary" onPress={install.replay} /></Row>}
    {install.cancelError && <Text accessibilityRole="alert" selectable>Cancellation: {install.cancelError}</Text>}
    {install.readError && <Row>
      <Text accessibilityRole="alert" selectable>Install status: {install.readError}</Text>
      <Button label="Retry install status" variant="secondary" onPress={install.retryRead} />
    </Row>}
    {install.refreshError && <Row>
      <Text accessibilityRole="alert" selectable>Installed package list: {install.refreshError}</Text>
      <Button label="Reload installed packages" variant="secondary" onPress={install.retryRefresh} />
    </Row>}
    {catalog.map(plugin => <View key={plugin.id} style={styles.setting}>
      <View style={styles.label}>
        <Text>{plugin.displayName ?? 'Unnamed language package'}</Text>
        <Text variant="caption" muted selectable>{plugin.version}</Text>
      </View>
      <Button label={`${snapshot.installedPlugins.some(value => value.id === plugin.id) ? 'Update' : 'Install'} ${plugin.displayName ?? plugin.id}`}
        variant="secondary" disabled={!snapshot.catalogConfigured || !install.canStart} onPress={() => install.start(plugin.id)} />
    </View>)}
  </Stack>;
}

const styles = StyleSheet.create(theme => ({
  setting: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.medium, paddingVertical: theme.spacing.large, borderBottomWidth: 1, borderColor: theme.colors.border },
  label: { flex: 1, minWidth: 180, gap: theme.spacing.small },
}));
