function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPitchFromRecord(record: Record<string, unknown>): number | null {
  const pitches = record.pitches;
  if (!Array.isArray(pitches) || pitches.length === 0) {
    return null;
  }

  const firstPitch = pitches[0];
  if (!isRecord(firstPitch)) {
    return null;
  }

  return typeof firstPitch.position === 'number' ? firstPitch.position : null;
}

export function extractPitchPosition(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractPitchPosition(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const directPitch = getPitchFromRecord(value);
  if (directPitch !== null) {
    return directPitch;
  }

  for (const child of Object.values(value)) {
    const found = extractPitchPosition(child);
    if (found !== null) {
      return found;
    }
  }

  return null;
}

export function extractReadingValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const reading = extractReadingValue(item);
      if (reading) {
        return reading;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.reading === 'string' && value.reading) {
    return value.reading;
  }

  for (const child of Object.values(value)) {
    const reading = extractReadingValue(child);
    if (reading) {
      return reading;
    }
  }

  return null;
}

function stripHtmlTags(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').trim();
}

export function hasDefinition(value: unknown): boolean {
  return extractFirstDefinition(value) !== null;
}

function collectDefinitions(record: Record<string, unknown>): string[] {
  const definitions = record.definitions;
  if (!definitions) return [];

  const raw: string[] = [];
  if (typeof definitions === 'string') {
    raw.push(definitions);
  } else if (Array.isArray(definitions)) {
    for (const item of definitions) {
      if (typeof item === 'string') raw.push(item);
    }
  }

  return raw.map(stripHtmlTags).filter((d) => d.length > 0);
}

export function extractFirstDefinition(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const def = extractFirstDefinition(item);
      if (def) return def;
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const direct = collectDefinitions(value);
  if (direct.length > 0) return direct[0];

  for (const child of Object.values(value)) {
    const def = extractFirstDefinition(child);
    if (def) return def;
  }

  return null;
}
