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