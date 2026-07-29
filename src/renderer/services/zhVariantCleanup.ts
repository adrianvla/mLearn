import type { ConversationSession, LanguageDataMap } from '@shared/types';
import { getBridge } from '@shared/bridges';
import { invalidateOfflineCachesForLanguages } from './offlineCache';

const MARKER_KEY = 'zh-variant-merge-v1-done';
const CANONICAL_LANGUAGE = 'zh';
const LEGACY_ZH_CODES = ['zh-Hans', 'zh-Hant'];
let cleanupInFlight: Promise<boolean> | null = null;

function getLegacyCodes(languageData: LanguageDataMap): string[] {
  return languageData[CANONICAL_LANGUAGE]?.legacyCodes?.filter((code) => LEGACY_ZH_CODES.includes(code)) ?? [];
}

function parseSessions(raw: string | null, key: string): ConversationSession[] {
  if (!raw) return [];
  try {
    const sessions: unknown = JSON.parse(raw);
    if (!Array.isArray(sessions)) {
      throw new Error('Expected an array');
    }
    return sessions as ConversationSession[];
  } catch (error) {
    throw new Error(`Invalid conversation sessions payload for ${key}`, { cause: error });
  }
}

/**
 * Removes regenerable artifacts left by the zh-Hans/zh-Hant -> zh migration.
 * It is gated by installed canonical metadata and a durable marker.
 */
async function cleanupZhVariants(
  languageData: LanguageDataMap = {},
): Promise<boolean> {
  const legacyCodes = getLegacyCodes(languageData);
  if (legacyCodes.length === 0) return false;

  const bridge = getBridge();
  if (await bridge.kvStore.kvGet(MARKER_KEY)) return false;

  const canonicalSessionKey = `conversation-sessions-${CANONICAL_LANGUAGE}`;
  const sessionKeys = legacyCodes.map((code) => `conversation-sessions-${code}`);
  const [canonicalSessions, ...legacySessions] = await Promise.all(
    [canonicalSessionKey, ...sessionKeys].map(async (key) => parseSessions(await bridge.kvStore.kvGet(key), key)),
  );
  const sessionsById = new Map<string, ConversationSession>();
  for (const session of [...canonicalSessions, ...legacySessions.flat()]) {
    const existing = sessionsById.get(session.id);
    if (!existing || session.updatedAt > existing.updatedAt) {
      sessionsById.set(session.id, session);
    }
  }
  const mergedSessions = [...sessionsById.values()].sort((left, right) => left.updatedAt - right.updatedAt);

  await bridge.kvStore.kvSet(canonicalSessionKey, JSON.stringify(mergedSessions));
  await Promise.all([
    ...sessionKeys.map((key) => bridge.kvStore.kvRemove(key)),
    invalidateOfflineCachesForLanguages(legacyCodes),
    bridge.files.removeLegacyLanguageData([
      ...legacyCodes.flatMap((code) => [`languages/${code}.json`, `languages/${code}.freq.json`]),
      ...legacyCodes.map((code) => `dictionaries/${code}`),
    ]),
  ]);
  await bridge.kvStore.kvSet(MARKER_KEY, 'done');
  return true;
}

export function runZhVariantCleanup(languageData: LanguageDataMap = {}): Promise<boolean> {
  if (cleanupInFlight) return cleanupInFlight;
  cleanupInFlight = cleanupZhVariants(languageData).finally(() => {
    cleanupInFlight = null;
  });
  return cleanupInFlight;
}
