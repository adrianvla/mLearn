import { useRef, useState } from 'react';
import type { PackageInstallPhase, PluginSummary, Snapshot } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Progress } from '@mlearn/ui/progress';
import { Dialog } from '@mlearn/ui/dialog';
import { Row, Stack, SettingRow } from '@mlearn/ui/layout';
import type { usePackageInstall } from './usePackageInstall';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { failure, type Failure } from '../failure';

/** The release part of a package version; data-build metadata is not shown to learners. */
export function releaseVersion(version: string) {
  return version.split(/[-+]/)[0];
}

const phases = {
  downloading: 'Downloading',
  validating: 'Validating',
  succeeded: 'Installed',
  failed: 'Installation failed',
  cancelled: 'Cancelled',
} satisfies Record<PackageInstallPhase, string>;

export function LanguagePackageInstall({ client, snapshot, install, onRemoved }: {
  readonly client: RuntimeClient;
  readonly snapshot: Snapshot;
  readonly install: ReturnType<typeof usePackageInstall>;
  readonly onRemoved: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [removal, setRemoval] = useState<{ readonly id: string; readonly busy: boolean; readonly error: Failure | null } | null>(null);
  async function remove(id: string) {
    setRemoving(null);
    setRemoval({ id, busy: true, error: null });
    try {
      await client.removePackage(id);
      await onRemoved();
      setRemoval(null);
    } catch (cause: unknown) {
      setRemoval({ id, busy: false, error: failure(cause, 'This language package wasn’t removed.') });
    }
  }
  const [catalog, setCatalog] = useState<PluginSummary[]>([]);
  const [catalogError, setCatalogError] = useState<Failure | null>(null);
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  const status = install.status;
  const installedLanguages = snapshot.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1'));
  const active = status?.phase === 'downloading' || status?.phase === 'validating';
  const retryable = status?.phase === 'failed' || status?.phase === 'cancelled';
  const packageName = catalog.find(plugin => plugin.id === install.command?.pluginId)?.displayName
    ?? snapshot.installedPlugins.find(plugin => plugin.id === install.command?.pluginId)?.displayName
    ?? 'Language package';

  async function checkCatalog() {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      setCatalog((await client.availablePackages()).filter(plugin => plugin.capabilities.includes('text.analyze.v1')));
      setCatalogError(null);
    } catch (cause: unknown) {
      setCatalogError(failure(cause, 'Available language packages couldn’t be checked.'));
    } finally { checkingRef.current = false; setChecking(false); }
  }

  return <Stack>
    {snapshot.catalogConfigured ? <Row>
      <Button label={checking ? 'Checking packages…' : 'Check for packages'} variant="secondary"
        disabled={checking || active || install.submitting} onPress={() => void checkCatalog()} />
    </Row> : <Text muted>Language downloads aren’t available here.</Text>}
    {catalogError && <FailureNotice message={catalogError.message} detail={catalogError.detail}>
      <Button label="Retry" accessibilityLabel="Retry checking for packages" variant="secondary" disabled={checking}
        onPress={() => void checkCatalog()} />
    </FailureNotice>}
    {install.command && status?.phase !== 'succeeded' && <SettingRow label={packageName} description={<>
        <Text accessibilityLiveRegion="polite">{status ? phases[status.phase] : 'Starting…'}</Text>
        {active && <Progress label={`${packageName} installation progress`}
          value={status.totalBytes !== null && status.totalBytes > 0
            ? status.downloadedBytes / status.totalBytes * 100 : undefined} />}
        {status?.phase === 'failed' && <FailureNotice message="This language package wasn’t installed." detail={status.message} />}
        {active && install.cancelRequested === status.command.commandId && <Text variant="caption">Cancelling…</Text>}
      </>}>
      <Row>
        {active && <Button label={install.cancelError ? 'Retry cancellation' : 'Cancel installation'} variant="secondary"
          disabled={install.cancelRequested === status.command.commandId && !install.cancelError}
          onPress={() => void install.cancel()} />}
        {retryable && <Button label="Retry installation" variant="secondary" disabled={!install.canStart}
          onPress={() => install.start(status.command.pluginId)} />}
      </Row>
    </SettingRow>}
    {install.installError && <FailureNotice message={install.installError.message} detail={install.installError.detail}>
      {install.canReplay && <Button label="Replay same install request" variant="secondary" onPress={install.replay} />}
    </FailureNotice>}
    {!install.installError && install.canReplay && <Row><Button label="Replay same install request" variant="secondary" onPress={install.replay} /></Row>}
    {install.cancelError && <FailureNotice message={install.cancelError.message} detail={install.cancelError.detail} />}
    {install.readError && <FailureNotice message={install.readError.message} detail={install.readError.detail}>
      <Button label="Retry install status" variant="secondary" onPress={install.retryRead} />
    </FailureNotice>}
    {install.refreshError && <FailureNotice message={install.refreshError.message} detail={install.refreshError.detail}>
      <Button label="Reload installed packages" variant="secondary" onPress={install.retryRefresh} />
    </FailureNotice>}
    {[...installedLanguages, ...catalog.filter(plugin => !installedLanguages.some(value => value.id === plugin.id))].map(plugin => {
      const current = installedLanguages.find(value => value.id === plugin.id);
      const installed = current !== undefined;
      const available = catalog.find(value => value.id === plugin.id);
      // An installed package is offered again only when the catalog has a different release.
      const offered = available !== undefined && (!current || available.version !== current.version);
      return <SettingRow key={plugin.id} label={plugin.displayName ?? 'Unnamed language package'} description={
          <>
          <Text variant="detail" muted>Version {releaseVersion(plugin.version)}</Text>
          {removal?.id === plugin.id && removal.error ? <FailureNotice message={removal.error.message} detail={removal.error.detail}>
            <Button label="Retry" accessibilityLabel={`Retry removing ${plugin.displayName ?? 'language package'}`} variant="secondary"
              onPress={() => void remove(plugin.id)} />
          </FailureNotice> : null}
        </>
        }>
        <Row>
          {installed ? <Text variant="detail" tone="success"
            accessibilityLabel={`${plugin.displayName ?? 'Language package'} installed`}>Installed</Text> : null}
          {offered ? <Button label={`${installed ? 'Update' : 'Install'} ${plugin.displayName ?? 'language package'}`}
            variant="secondary" disabled={!snapshot.catalogConfigured || !install.canStart} onPress={() => install.start(plugin.id)} /> : null}
          {installed && snapshot.catalogConfigured ? <Dialog title="Remove language package"
            description={`Remove ${plugin.displayName ?? 'this language package'} from this device? Saved words, Material and progress are kept; sources in this language can be read again after you reinstall it.`}
            open={removing === plugin.id} onOpenChange={open => setRemoving(open ? plugin.id : null)}
            trigger={<Button label="Remove" accessibilityLabel={`Remove ${plugin.displayName ?? 'language package'}`} variant="quiet"
              busy={removal?.id === plugin.id && removal.busy} disabled={active || install.submitting || removal?.busy === true} />}>
            <Button label="Remove package" onPress={() => void remove(plugin.id)} />
          </Dialog> : null}
        </Row>
      </SettingRow>;
    })}
  </Stack>;
}
