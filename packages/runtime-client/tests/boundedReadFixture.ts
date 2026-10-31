import { createRuntimeClient, RuntimeError, type Transport } from '../src/client.ts';

/** In-memory ticket owner for wire fixtures; ordinary and bounded lanes stay independent. */
export function createBoundedReadTestClient(transport: Transport) {
  let sequence = 0;
  const tickets = new Map<string, { completion: Promise<void> | null }>();
  return createRuntimeClient({
    ...transport,
    boundedReads: {
      async begin() {
        const id = `fixture-${++sequence}`;
        tickets.set(id, { completion: null });
        return id;
      },
      async execute(id, raw) {
        const ticket = tickets.get(id);
        if (!ticket || ticket.completion) throw new RuntimeError('cancelled', 'Ticket is not available.');
        const execution = transport.execute(raw);
        ticket.completion = execution.then(() => {}, () => {});
        try { return await execution; }
        finally { tickets.delete(id); }
      },
      async cancel(id) {
        const ticket = tickets.get(id);
        tickets.delete(id);
        await ticket?.completion;
      },
    },
  });
}
