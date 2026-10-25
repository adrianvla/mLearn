import { useEffect, useRef, useState } from 'react';
import type { LevelScale, Request, Snapshot } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { RuntimeError } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { SettingRow } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';

type Command = Extract<Request, { type: 'save_inline_level_scale' | 'save_star_collapse' }>;

export function InlineLevelScaleSetting({ client, snapshot, onSaved }: {
  readonly client: RuntimeClient;
  readonly snapshot: Snapshot;
  readonly onSaved: () => Promise<void>;
}) {
  const [scales, setScales] = useState<LevelScale[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
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
    setLoadError('');
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
      if (active) setLoadError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, packages, reload]);

  async function save(command: Command) {
    if (admitted.current) return;
    admitted.current = true;
    setBusy(true);
    setError('');
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
          setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
          return;
        }
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  }
  const selected = snapshot.viewPreferences?.inlineLevelScale ?? null;
  const options = [{ value: 'none', label: 'No inline stars' }, ...scales.map(scale => ({ value: scale.id, label: scale.label }))];
  if (selected && !scales.some(scale => scale.id === selected))
    options.push({ value: selected, label: `Unavailable scale: ${selected}` });
  function feedback(target: 'scale' | 'collapse') {
    if (errorTarget !== target) return null;
    return <>{error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {pending && !busy ? <Button label={target === 'scale' ? 'Retry saving inline level scale' : 'Retry saving star collapse'}
        variant="quiet" onPress={() => void save(pending)} /> : null}</>;
  }
  return <><SettingRow label="Inline level scale" description={
    <Text variant="detail" muted>Choose the curriculum shown beneath words. This changes only the stars; all learning goals remain active.</Text>
  }>
    <Select label="Inline level scale" value={selected ?? 'none'} options={options}
      disabled={loading || !!loadError || busy || pending !== null}
      onValueChange={value => {
        const scale = value === 'none' ? null : value;
        if (scale !== selected) void save(client.prepareInlineLevelScale(scale, snapshot.viewPreferences?.revision ?? 0));
      }} />
    {loading ? <Text variant="detail" muted>Loading level scales…</Text> : null}
    {loadError ? <><Text accessibilityRole="alert">{loadError}</Text>
      <Button label="Reload level scales" variant="quiet" onPress={() => setReload(value => value + 1)} /></> : null}
    {feedback('scale')}
  </SettingRow>
  <SettingRow label="Star collapse" description={
    <Text variant="detail" muted>Auto uses a number and one star when the full row will not fit beneath the word.</Text>
  }>
    <Select label="Star collapse" value={snapshot.viewPreferences?.starCollapse ?? 'auto'}
      options={[{value:'auto',label:'Auto'},{value:'always',label:'Always'},{value:'never',label:'Never'}]}
      disabled={busy || pending !== null} onValueChange={value => {
        if ((value === 'auto' || value === 'always' || value === 'never') && value !== (snapshot.viewPreferences?.starCollapse ?? 'auto'))
          void save(client.prepareStarCollapse(value, snapshot.viewPreferences?.revision ?? 0));
      }} />
    {feedback('collapse')}
  </SettingRow></>;
}
