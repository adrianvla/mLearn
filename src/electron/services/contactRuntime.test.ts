import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { ContactDeliveryHandlers, ContactDeliveryInput } from './contactService';

const notificationInstances = vi.hoisted(() => [] as Array<{
  options: Record<string, unknown>;
  handlers: Map<string, (...args: unknown[]) => void>;
  show: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}>);

vi.mock('electron', () => ({
  Notification: class MockNotification {
    static isSupported = vi.fn(() => true);
    static remove = vi.fn();
    options: Record<string, unknown>;
    handlers = new Map<string, (...args: unknown[]) => void>();
    show = vi.fn();
    close = vi.fn();
    constructor(options: Record<string, unknown>) {
      this.options = options;
      notificationInstances.push(this);
    }
    once(event: string, handler: (...args: unknown[]) => void): this { this.handlers.set(event, handler); return this; }
    on(event: string, handler: (...args: unknown[]) => void): this { this.handlers.set(event, handler); return this; }
  },
}));

const mockOpenRoomAt = vi.hoisted(() => vi.fn());
vi.mock('./worldIpc', () => ({ openRoomAt: mockOpenRoomAt }));
const mockActivateContact = vi.hoisted(() => vi.fn());
const mockReconcile = vi.hoisted(() => vi.fn());
vi.mock('./contactService', async importOriginal => {
  const original = await importOriginal<typeof import('./contactService')>();
  return {
    ...original,
    activateContact: mockActivateContact,
    reconcileContactDelivery: mockReconcile,
    runContactPass: vi.fn(async () => ({ kind: 'waiting' as const })),
  };
});
vi.mock('./settings', () => ({ loadSettings: () => ({ ...DEFAULT_SETTINGS, livingWorldEnabled: true }) }));
vi.mock('./worldStore', () => ({ loadWorld: vi.fn(async () => ({ rooms: [], threads: [], participants: [], contacts: [] })) }));
vi.mock('../utils/platform', () => ({ getUserDataPath: () => '/tmp/contact-runtime' }));
vi.mock('../../shared/inferencePolicy', () => ({ getInferencePolicy: () => ({}) }));
vi.mock('./llmRouter', () => ({ completeJob: vi.fn() }));

describe('contactRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
    notificationInstances.length = 0;
    mockOpenRoomAt.mockReset();
    mockActivateContact.mockReset();
    mockReconcile.mockReset();
  });

  it('uses the stable contact id for real notification delivery and opens the exact canonical target on click', async () => {
    const input: ContactDeliveryInput = {
      contactId: 'contact-1', notificationId: 'contact-1', roomId: 'room-1', participantId: 'mara',
      modality: 'message', title: 'New message', body: 'Mara sent you a message', messageEventId: 'evt-message',
    };
    mockReconcile.mockImplementation(async (_roomId: string, deps: { attempt: (value: ContactDeliveryInput, handlers: ContactDeliveryHandlers) => string }) => {
      deps.attempt(input, { onShown: vi.fn(), onFailed: vi.fn(), onActivated: vi.fn() });
      return { attempted: ['contact-1'], unavailable: [], expired: [], suppressed: [] };
    });
    mockActivateContact.mockResolvedValue({ ok: true, contact: {
      contactId: 'contact-1', roomId: 'room-1', participantId: 'mara', modality: 'message', messageEventId: 'evt-message',
    } });
    const runtime = await import('./contactRuntime');

    await runtime.reconcileRoomContactDelivery('room-1');
    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].options).toMatchObject({
      id: 'contact-1', groupId: 'room-1', body: 'Mara sent you a message',
    });
    expect(notificationInstances[0].show).toHaveBeenCalledTimes(1);

    notificationInstances[0].handlers.get('click')?.();
    await vi.waitFor(() => expect(mockOpenRoomAt).toHaveBeenCalledWith({
      roomId: 'room-1', eventId: 'evt-message', contactId: 'contact-1', callId: undefined,
    }));
    expect(mockActivateContact).toHaveBeenCalledTimes(1);
  });

  it('opens a safe activation error instead of recreating an erased destination', async () => {
    mockActivateContact.mockResolvedValue({ ok: false, reason: 'This conversation is no longer available.' });
    const runtime = await import('./contactRuntime');
    await runtime.activateContactFromDeepLink('contact-erased');
    expect(mockOpenRoomAt).toHaveBeenCalledWith({
      roomId: '', contactId: 'contact-erased', contactError: 'This conversation is no longer available.',
    });
  });

  it('removes a previously shown notification when the contact expires or is suppressed', async () => {
    const input: ContactDeliveryInput = {
      contactId: 'contact-expiring', notificationId: 'contact-expiring', roomId: 'room-1', participantId: 'mara',
      modality: 'call', title: 'Incoming call', body: 'Incoming call from Mara', callId: 'call-1',
    };
    mockReconcile.mockImplementationOnce(async (_roomId: string, deps: { attempt: (value: ContactDeliveryInput, handlers: ContactDeliveryHandlers) => string }) => {
      deps.attempt(input, { onShown: vi.fn(), onFailed: vi.fn(), onActivated: vi.fn() });
      return { attempted: ['contact-expiring'], unavailable: [], expired: [], suppressed: [] };
    }).mockResolvedValueOnce({ attempted: [], unavailable: [], expired: ['contact-expiring'], suppressed: [] });
    const runtime = await import('./contactRuntime');
    await runtime.reconcileRoomContactDelivery('room-1');
    await runtime.reconcileRoomContactDelivery('room-1');
    expect(notificationInstances[0].close).toHaveBeenCalledTimes(1);
  });
});
