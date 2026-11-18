import { useEffect, useRef, useState } from 'react';
import type { LevelScale, Request, Snapshot } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { RuntimeError } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { SettingRow } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { failure, type Failure } from '../failure';

type Command = Extract<Request, { type: 'save_inline_level_scale' | 'save_star_collapse' }>;

export function InlineLevelScaleSetting({ client, snapshot, onSaved }: {
  readonly client: RuntimeClient;
  readonly snapshot: Snapshot;
  readonly onSaved: () => Promise<void>;
}) {
  const [scales, setScales] = useState<LevelScale[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Failure | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [errorTarget, setErrorTarget] = useState<'scale' | 'collapse'>('scale');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Command | null>(null);
  const [reload, setReload] = useState(0);
  const admitted = useRef(false);
  const packages = snapshot.installedPlugins.filter(plugin => plugin.capabilities.includes('language.describe.v1'))
    .map(plugin => plugin.id).join('\n');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    async function load() {
      const available: LevelScale[] = [];
      // Language execution has a bounded shared admission owner, not one worker per option.
      for (const id of packages.split('\n').filter(Boolean)) {
        const description = await client.describeLanguage(id);
        if (!active) return;
        available.push(...description.levelScales ?? []);
      }
      if (active) setScales(available);
    }
    void load().catch((cause: unknown) => {
      if (active) setLoadError(failure(cause, 'Level scales couldn’t be loaded.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, packages, reload]);

  async function save(command: Command) {
    if (admitted.current) return;
    admitted.current = true;
    setBusy(true);
    setError(null);
    setErrorTarget(command.type === 'save_star_collapse' ? 'collapse' : 'scale');
    setPending(command);
    try {
      if (command.type === 'save_star_collapse') await client.saveStarCollapse(command);
      else await client.saveInlineLevelScale(command);
      await onSaved();
      setPending(null);
    } catch (cause) {
      if (cause instanceof RuntimeError && (cause.code === 'conflict' || cause.code === 'invalid_settings')) {
        setPending(null);
        try { await onSaved(); }
        catch (refreshError) {
          setError(failure(refreshError, 'Your settings couldn’t be refreshed after this change was rejected.'));
          return;
        }
      }
      setError(failure(cause, 'This change wasn’t saved.'));
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  }
  const selected = snapshot.viewPreferences?.inlineLevelScale ?? null;
  const options = [{ value: 'none', label: 'No level marks' }, ...scales.map(scale => ({ value: scale.id, label: scale.label }))];
  if (selected && !scales.some(scale => scale.id === selected))
    options.push({ value: selected, label: 'Unavailable scale' });
  function feedback(target: 'scale' | 'collapse') {
    if (errorTarget !== target) return null;
    const retry = pending && !busy ? <Button label={target === 'scale' ? 'Retry saving level marks' : 'Retry saving level mark display'}
      variant="quiet" onPress={() => void save(pending)} /> : null;
    return error ? <FailureNotice message={error.message} detail={error.detail}>{retry}</FailureNotice> : retry;
  }
  return <><SettingRow label="Level marks" description={<Text variant="detail" muted>
      {!loading && !loadError && !scales.length ? 'Installed languages don’t provide a level scale.' : 'Marks words by level while reading.'}</Text>}>
    <Select label="Level marks" value={selected ?? 'none'} options={options}
      disabled={loading || !!loadError || busy || pending !== null}
      onValueChange={value => {
        const scale = value === 'none' ? null : value;
        if (scale !== selected) void save(client.prepareInlineLevelScale(scale, snapshot.viewPreferences?.revision ?? 0));
      }} />
    {loading ? <Text variant="detail" muted>Loading level scales…</Text> : null}
    {busy ? <Text variant="detail" muted accessibilityLiveRegion="polite">Saving…</Text> : null}
    {loadError ? <FailureNotice message={loadError.message} detail={loadError.detail}>
      <Button label="Reload level scales" variant="quiet" onPress={() => setReload(value => value + 1)} /></FailureNotice> : null}
    {feedback('scale')}
  </SettingRow>
  <SettingRow label="Level mark display" description={<Text variant="detail" muted>How marks fit above a word.</Text>}>
    <Select label="Level mark display" value={snapshot.viewPreferences?.starCollapse ?? 'auto'}
      options={[{value:'auto',label:'Fit to word'},{value:'always',label:'Compact'},{value:'never',label:'Show every mark'}]}
      disabled={busy || pending !== null} onValueChange={value => {
        if ((value === 'auto' || value === 'always' || value === 'never') && value !== (snapshot.viewPreferences?.starCollapse ?? 'auto'))
          void save(client.prepareStarCollapse(value, snapshot.viewPreferences?.revision ?? 0));
      }} />
    {feedback('collapse')}
  </SettingRow></>;
}
