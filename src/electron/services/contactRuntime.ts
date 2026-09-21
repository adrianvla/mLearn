/** Main-owned V10 contact generation, OS delivery, and activation wrapper. */

import { Notification } from 'electron';
import { getInferencePolicy } from '../../shared/inferencePolicy';
import { livingWorldEnabled } from '../../shared/livingWorld';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import type { ContactRecord, OpenRoomEventPayload } from '../../shared/world';
import { getLogger } from '../../shared/utils/logger';
import { getUserDataPath } from '../utils/platform';
import {
  CONTACT_LIMITS,
  activateContact,
  reconcileContactDelivery,
  runContactPass,
  type ContactDeliveryInput,
  type ContactDeliveryResult,
  type ContactPassResult,
} from './contactService';
import { completeJob } from './llmRouter';
import { loadSettings } from './settings';
import { loadWorld } from './worldStore';
import { openRoomAt } from './worldIpc';

const log = getLogger('contactRuntime');
export const MAX_CONCURRENT_CONTACT_INFERENCE = 1;

let active: { roomId: string; controller: AbortController; done: Promise<ContactPassResult> } | undefined;
const liveNotifications = new Map<string, Notification>();

function enabled(settings: Settings): boolean {
  return livingWorldEnabled(settings)
    && (settings.proactivityEnabled ?? DEFAULT_SETTINGS.proactivityEnabled)
    && (settings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled);
}

async function activateAndOpen(input: ContactDeliveryInput): Promise<void> {
  const activation = await activateContact(input.contactId);
  const payload: OpenRoomEventPayload = activation.ok
    ? {
        roomId: activation.contact.roomId,
        eventId: activation.contact.messageEventId,
        contactId: activation.contact.contactId,
        callId: activation.contact.modality === 'call' ? activation.contact.callId : undefined,
      }
    : {
        roomId: activation.contact?.roomId ?? input.roomId,
        contactId: input.contactId,
        contactError: activation.reason,
      };
  openRoomAt(payload);
}

function attemptNotification(
  input: ContactDeliveryInput,
  handlers: { onShown: () => void; onFailed: (error: string) => void },
): 'attempted' | 'unsupported' {
  if (!Notification.isSupported()) return 'unsupported';
  const notification = new Notification({
    id: input.notificationId,
    groupId: input.roomId,
    title: input.title,
    body: input.body,
    silent: false,
  });
  liveNotifications.set(input.contactId, notification);
  notification.once('show', handlers.onShown);
  notification.once('failed', (_event, error) => handlers.onFailed(error));
  notification.on('click', () => { void activateAndOpen(input); });
  notification.once('close', () => liveNotifications.delete(input.contactId));
  notification.show();
  return 'attempted';
}

export async function runRoomContact(roomId: string): Promise<ContactPassResult> {
  const settings = loadSettings();
  if (!enabled(settings)) return { kind: 'waiting' };
  if (active) return active.roomId === roomId ? active.done : { kind: 'waiting' };
  const profile = getUserDataPath();
  const controller = new AbortController();
  const done = runContactPass(roomId, {
    policy: getInferencePolicy(settings),
    getSettings: loadSettings,
    llmFn: async prompt => {
      const current = loadSettings();
      if (!enabled(current) || profile !== getUserDataPath() || controller.signal.aborted) {
        throw new Error('Contact policy changed');
      }
      return completeJob(
        [{ role: 'user', content: prompt }],
        controller.signal,
        CONTACT_LIMITS.outputCharacters,
        'background',
      );
    },
  }).catch((error): ContactPassResult => {
    log.error('Contact pass failed', roomId, error);
    return { kind: 'failed' };
  }).finally(() => {
    if (active?.controller === controller) active = undefined;
  });
  active = { roomId, controller, done };
  return done;
}

export async function reconcileRoomContactDelivery(roomId: string): Promise<ContactDeliveryResult> {
  const result = await reconcileContactDelivery(roomId, {
    getSettings: loadSettings,
    attempt: (input, handlers) => attemptNotification(input, handlers),
  });
  for (const contactId of [...result.expired, ...result.suppressed]) {
    closeContactNotification(contactId);
  }
  return result;
}

export async function activateContactFromDeepLink(contactId: string): Promise<void> {
  const world = await loadWorld();
  const contact = world.contacts?.find(item => item.contactId === contactId);
  const input: ContactDeliveryInput = {
    contactId,
    notificationId: contactId,
    roomId: contact?.roomId ?? '',
    participantId: contact?.participantId ?? '',
    modality: contact?.modality ?? 'message',
    title: '',
    body: '',
    messageEventId: contact?.messageEventId,
    callId: contact?.callId,
  };
  await activateAndOpen(input);
}

export function closeContactNotification(contactId: string): void {
  liveNotifications.get(contactId)?.close();
  liveNotifications.delete(contactId);
  if ('remove' in Notification && typeof Notification.remove === 'function') {
    Notification.remove(contactId);
  }
}

export function cancelAllContacts(): void {
  active?.controller.abort();
  for (const notification of liveNotifications.values()) notification.close();
  liveNotifications.clear();
}

export function contactForCallId(contacts: readonly ContactRecord[], callId: string): ContactRecord | undefined {
  return contacts.find(contact => contact.callId === callId);
}
