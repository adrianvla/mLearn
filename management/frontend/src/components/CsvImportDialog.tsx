import { useState } from 'react';
import { ApiClient } from '../api/client';
import type { CsvPreview } from '../api/types';
import { ConsoleButton, ConsoleDialog, ConsoleTextArea } from './console';

const api = new ApiClient();

export function CsvImportDialog({ groupId, onImported }: { groupId: string; onImported(): void }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('email,display_name,identity_type,group_slug\n');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const runPreview = async () => {
    if (pending) return;
    setPending(true); setError(null); setPreview(null);
    try {
      setPreview(await api.post<CsvPreview>(`/api/groups/${encodeURIComponent(groupId)}/provisioning/csv/preview`, { csv }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'CSV preview failed'); }
    finally { setPending(false); }
  };
  const runImport = async () => {
    if (pending || !preview || preview.errors.length || !preview.validRows) return;
    setPending(true); setError(null);
    try {
      await api.post(`/api/groups/${encodeURIComponent(groupId)}/provisioning/csv/import`, { csv, idempotencyKey });
      setOpen(false); setPreview(null); setIdempotencyKey(crypto.randomUUID()); onImported();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'CSV import failed'); }
    finally { setPending(false); }
  };
  return <>
    <ConsoleButton variant="secondary" onClick={() => setOpen(true)}>Import CSV</ConsoleButton>
    <ConsoleDialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }} title="Import users from CSV" footer={<>
      <ConsoleButton variant="secondary" isDisabled={pending} onClick={() => setOpen(false)}>Cancel</ConsoleButton>
      <ConsoleButton variant="secondary" isDisabled={pending} onClick={() => void runPreview()}>Preview</ConsoleButton>
      <ConsoleButton variant="primary" isDisabled={pending || preview === null || preview.errors.length > 0 || preview.validRows === 0} onClick={() => void runImport()}>Import</ConsoleButton>
    </>}>
      <p>Preview validates every row before any account is changed. Invite imported accounts to let them set a sign-in password.</p>
      <ConsoleTextArea label="CSV data" value={csv} isDisabled={pending} onChange={(value) => { setCsv(value); setPreview(null); setIdempotencyKey(crypto.randomUUID()); }} />
      {error && <p role="alert">{error}</p>}
      {preview && <div aria-label="CSV preview"><strong>{preview.validRows} valid rows</strong>{preview.errors.map((item) => <p key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</p>)}</div>}
    </ConsoleDialog>
  </>;
}
