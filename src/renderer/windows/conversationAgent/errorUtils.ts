export function getConversationErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return stripJsonFromString(error);
  }

  if (error instanceof Error && error.message) {
    return stripJsonFromString(error.message);
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;

    for (const key of ['message', 'error', 'details', 'reason']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return stripJsonFromString(value);
      }
    }

    const status = getConversationErrorStatus(error);
    if (status !== undefined) {
      return `Request failed with status ${status}`;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }

  if (error === null || error === undefined) {
    return 'Unknown error';
  }

  return String(error);
}

function stripJsonFromString(input: string): string {
  const result: string[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (char === '{' || char === '[') {
      const endChar = char === '{' ? '}' : ']';
      let depth = 1;
      let j = i + 1;

      while (j < input.length && depth > 0) {
        if (input[j] === char) depth++;
        else if (input[j] === endChar) depth--;
        else if (input[j] === '"') {
          j++;
          while (j < input.length && input[j] !== '"') {
            if (input[j] === '\\') j++;
            j++;
          }
        }
        j++;
      }

      const jsonText = input.slice(i, j);
      const humanReadable = extractHumanReadableFromJson(jsonText);
      if (humanReadable) {
        result.push(humanReadable);
      }

      i = j;
      while (i < input.length && /\s/.test(input[i])) i++;
      if (result.length > 0 && !/\s$/.test(result[result.length - 1])) {
        result.push(' ');
      }
      continue;
    }

    result.push(char);
    i++;
  }

  return result.join('').trim().replace(/\s+/g, ' ');
}

function extractHumanReadableFromJson(jsonText: string): string | undefined {
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === 'object') {
      for (const key of ['error', 'message', 'reason', 'detail', 'description']) {
        const value = parsed[key];
        if (typeof value === 'string' && value.trim()) {
          return `Reason: ${value.trim()}`;
        }
      }
    }
  } catch {
  }
  return undefined;
}

export function isCloudSessionError(error: unknown): boolean {
  const message = getConversationErrorMessage(error).toLowerCase();
  const status = getConversationErrorStatus(error);
  const code = getConversationErrorCode(error)?.toLowerCase();

  return status === 401
    || code === '401'
    || code === 'unauthorized'
    || code === 'invalid_session'
    || message.includes('401')
    || message.includes('unauthorized')
    || message.includes('invalid session');
}

function getConversationErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const record = error as Record<string, unknown>;

  for (const key of ['status', 'statusCode']) {
    const value = record[key];
    if (typeof value === 'number') {
      return value;
    }
  }

  return undefined;
}

function getConversationErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  return typeof record.code === 'string' ? record.code : undefined;
}