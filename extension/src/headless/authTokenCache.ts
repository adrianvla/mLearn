const AUTH_TOKEN_STORAGE_KEY = 'mlearn-extension-auth-token';

let currentToken = '';

export async function loadAuthToken(): Promise<string> {
  try {
    const result = await chrome.storage.local.get(AUTH_TOKEN_STORAGE_KEY);
    const stored = result[AUTH_TOKEN_STORAGE_KEY];
    if (typeof stored === 'string' && stored.length > 0) {
      currentToken = stored;
    } else {
      currentToken = '';
    }
  } catch {
    currentToken = '';
  }
  return currentToken;
}

export async function saveAuthToken(token: string): Promise<void> {
  currentToken = token;
  try {
    await chrome.storage.local.set({ [AUTH_TOKEN_STORAGE_KEY]: token });
  } catch {
  }
}

export async function clearAuthToken(): Promise<void> {
  await saveAuthToken('');
}

export function getAuthToken(): string {
  return currentToken;
}
