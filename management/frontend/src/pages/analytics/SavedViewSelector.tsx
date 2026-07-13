import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Label, ListBox, ListBoxItem, Modal, Select, TextField, useOverlayState } from '@heroui/react';
import { ApiClient } from '../../api/client';
import type { SavedAnalyticsView, SavedAnalyticsViewDefinition } from '../../api/types';

const api = new ApiClient();

interface SavedViewSelectorProps {
  groupId: string | null;
  definition: SavedAnalyticsViewDefinition;
  onApply(definition: SavedAnalyticsViewDefinition): void;
}

export function SavedViewSelector({ groupId, definition, onApply }: SavedViewSelectorProps) {
  const [views, setViews] = useState<SavedAnalyticsView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const [name, setName] = useState('');
  const selectedView = useMemo(() => views.find((view) => view.id === selectedId) ?? null, [selectedId, views]);

  useEffect(() => {
    setSelectedId(null);
    if (groupId === null) {
      setViews([]);
      return;
    }
    const controller = new AbortController();
    void api.get<{ items: SavedAnalyticsView[] }>(`/api/analytics/views?groupId=${encodeURIComponent(groupId)}`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setViews(response.items); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [groupId]);

  const saveNew = async () => {
    if (name.trim().length === 0 || name.length > 80) return;
    try {
      const saved = await api.post<SavedAnalyticsView>('/api/analytics/views', { name: name.trim(), definition });
      setViews((current) => [saved, ...current]);
      setSelectedId(saved.id);
      setCreateOpen(false);
      setName('');
      setError(null);
    } catch (cause) { setError(errorMessage(cause)); }
  };

  const overwrite = async () => {
    if (selectedView === null) return;
    try {
      const saved = await api.put<SavedAnalyticsView>(`/api/analytics/views/${encodeURIComponent(selectedView.id)}`, { name: selectedView.name, definition });
      setViews((current) => current.map((view) => view.id === saved.id ? saved : view));
      setOverwriteOpen(false);
      setError(null);
    } catch (cause) { setError(errorMessage(cause)); }
  };

  if (groupId === null) return null;
  return <div className="saved-view-selector">
    <Select selectedKey={selectedId} onSelectionChange={(key) => {
      const id = key === null ? null : String(key);
      setSelectedId(id);
      const view = views.find((item) => item.id === id);
      if (view !== undefined) onApply(view.definition);
    }}>
      <Label>Saved view</Label>
      <Select.Trigger aria-label="Saved view"><Select.Value>{selectedView?.name ?? 'Choose saved view'}</Select.Value><Select.Indicator /></Select.Trigger>
      <Select.Popover><ListBox>{views.map((view) => <ListBoxItem id={view.id} key={view.id} textValue={view.name}>{view.name}</ListBoxItem>)}</ListBox></Select.Popover>
    </Select>
    <Button variant="secondary" onPress={() => selectedView === null ? setCreateOpen(true) : setOverwriteOpen(true)}>Save view</Button>
    {error !== null ? <p role="alert">Saved views: {error}</p> : null}
    <NameDialog open={createOpen} name={name} onNameChange={setName} onClose={() => setCreateOpen(false)} onSave={() => void saveNew()} />
    <OverwriteDialog open={overwriteOpen} name={selectedView?.name ?? ''} onClose={() => setOverwriteOpen(false)} onOverwrite={() => void overwrite()} />
  </div>;
}

function NameDialog({ open, name, onNameChange, onClose, onSave }: { open: boolean; name: string; onNameChange(value: string): void; onClose(): void; onSave(): void }) {
  const state = useOverlayState({ isOpen: open, onOpenChange: (next) => { if (!next) onClose(); } });
  if (!open) return null;
  return <Modal state={state}><Modal.Backdrop><Modal.Container><Modal.Dialog aria-label="Save analytics view"><Modal.Header><Modal.Heading>Save analytics view</Modal.Heading></Modal.Header><Modal.Body><TextField value={name} onChange={onNameChange}><Label>View name</Label><Input aria-label="View name" maxLength={80} /></TextField></Modal.Body><Modal.Footer><Button variant="secondary" onPress={onClose}>Cancel</Button><Button isDisabled={name.trim().length === 0 || name.length > 80} onPress={onSave}>Save view</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}

function OverwriteDialog({ open, name, onClose, onOverwrite }: { open: boolean; name: string; onClose(): void; onOverwrite(): void }) {
  const state = useOverlayState({ isOpen: open, onOpenChange: (next) => { if (!next) onClose(); } });
  if (!open) return null;
  return <Modal state={state}><Modal.Backdrop><Modal.Container><Modal.Dialog aria-label="Overwrite saved analytics view"><Modal.Header><Modal.Heading>Overwrite saved analytics view?</Modal.Heading></Modal.Header><Modal.Body><p>Replace “{name}” with the current analytics controls.</p></Modal.Body><Modal.Footer><Button variant="secondary" onPress={onClose}>Cancel</Button><Button onPress={onOverwrite}>Overwrite view</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request did not complete.';
}
