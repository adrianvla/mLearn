export function getConversationErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;

    for (const key of ['message', 'error', 'details', 'reason']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
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