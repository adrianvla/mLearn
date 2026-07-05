import type { FlashcardProsody, LanguageData } from './types';

function createPayloadAtPositionPath(
  prosodyType: NonNullable<FlashcardProsody['type']>,
  position: number,
  path: readonly string[] | undefined,
): unknown | null {
  if (!Array.isArray(path) || path.length === 0 || path.includes('*')) return null;

  const root: Record<string, unknown> = { type: prosodyType };
  let current = root;
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i]?.trim();
    if (!segment) return null;

    if (i === path.length - 1) {
      current[segment] = position;
      return root;
    }

    const child: Record<string, unknown> = {};
    current[segment] = child;
    current = child;
  }

  return null;
}

export function createProsodyRawPayloadForPosition(
  prosodyType: NonNullable<FlashcardProsody['type']>,
  position: number,
  languageData?: LanguageData | null,
): unknown {
  const configuredPayload = languageData?.prosody?.type === prosodyType
    ? createPayloadAtPositionPath(prosodyType, position, languageData.prosody.positionPath)
    : null;
  return configuredPayload ?? { type: prosodyType, position };
}
