import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import OperationalLogs from './OperationalLogs';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/services')) {
      return json([{ id: 'container-1', service_name: 'mlearn-backend', container_name: 'mlearn-backend-1', status: 'running', health: '', image: 'mlearn', tag: null, ports: [] }]);
    }
    if (url.includes('/api/services/container-1/logs?tail=300')) {
      return json({ service_id: 'container-1', truncated: false, lines: [{ stream: 'stdout', timestamp: '2026-07-12T01:00:00Z', message: 'ready' }] });
    }
    return new Response('not found', { status: 404 });
  }));
});

it('loads redacted logs for the selected operational service', async () => {
  render(<OperationalLogs />);
  expect(await screen.findByLabelText('Operational log output')).toHaveTextContent('[stdout] ready');
  expect(fetch).toHaveBeenCalledWith('/api/services/container-1/logs?tail=300', expect.any(Object));
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
