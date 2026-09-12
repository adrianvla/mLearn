import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { PolicyLlmRules } from './PolicyLlmRules';

it('edits governed routes and removable hard quotas in the active policy document', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ items: String(input).includes('/providers?') ? [{ id: 'provider', name: 'School provider' }] : [] }), { status: 200 })));
  function Editor() {
    const [draft, setDraft] = useState<Parameters<typeof PolicyLlmRules>[0]['value']>({ enabled: true, quotas: [] });
    return <><PolicyLlmRules groupId="school" value={draft} disabled={false} canConfigure onChange={setDraft} /><output>{JSON.stringify(draft)}</output></>;
  }
  render(<Editor />);
  fireEvent.click(await screen.findByLabelText('School provider'));
  fireEvent.click(screen.getByRole('button', { name: 'Add quota' }));
  expect(screen.getByLabelText('Hard limit')).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('"allowedProviders":["provider"]');
  fireEvent.click(screen.getByRole('button', { name: 'Remove quota' }));
  expect(screen.getByRole('status')).toHaveTextContent('"quotas":[]');
});
