import type {
  EffectiveManagementPolicy,
  ManagementPolicyPublicKey,
} from '../../shared/managementPolicy';

const DB_NAME = 'mlearn-management-policy';
const DB_VERSION = 1;
const STORE_RECORDS = 'records';
const KEY_PREFIX = 'key\u0000';
const POLICY_PREFIX = 'policy\u0000';

interface CacheRow<T> {
  key: string;
  value: T;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export class ManagementPolicyKeyChangeError extends Error {
  constructor(origin: string) {
    super(`Management policy key changed unexpectedly for ${origin}; explicit re-enrollment is required`);
    this.name = 'ManagementPolicyKeyChangeError';
  }
}

export function normalizeManagementOrigin(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Management API origin must use HTTP or HTTPS');
  }
  return url.origin;
}

function requireCachePart(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes('\u0000')) {
    throw new Error(`${name} is invalid for management policy cache`);
  }
  return normalized;
}

export function managementPolicyCacheKey(origin: string, userId: string): string {
  return `${normalizeManagementOrigin(origin)}\u0000${requireCachePart(userId, 'User ID')}`;
}

function trustedKeyCacheKey(origin: string): string {
  return `${KEY_PREFIX}${normalizeManagementOrigin(origin)}`;
}

function policyCacheRowKey(origin: string, userId: string): string {
  return `${POLICY_PREFIX}${managementPolicyCacheKey(origin, userId)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable'));
  }
  dbPromise = new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      dbPromise = null;
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_RECORDS)) {
        request.result.createObjectStore(STORE_RECORDS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        dbPromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open management policy cache'));
    };
  });
  return dbPromise;
}

async function getRow<T>(key: string): Promise<T | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_RECORDS, 'readonly').objectStore(STORE_RECORDS).get(key);
    request.onsuccess = () => {
      const row = request.result as CacheRow<T> | undefined;
      resolve(row?.value ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to read management policy cache'));
  });
}

async function putRow<T>(key: string, value: T): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_RECORDS, 'readwrite');
    transaction.objectStore(STORE_RECORDS).put({ key, value, updatedAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to write management policy cache'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Management policy cache transaction aborted'));
  });
}

export async function loadTrustedPublicKey(
  origin: string,
): Promise<ManagementPolicyPublicKey | null> {
  return getRow<ManagementPolicyPublicKey>(trustedKeyCacheKey(origin));
}

export async function enrollTrustedPublicKey(
  origin: string,
  publicKey: ManagementPolicyPublicKey,
): Promise<void> {
  const rowKey = trustedKeyCacheKey(origin);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_RECORDS, 'readwrite');
    const store = transaction.objectStore(STORE_RECORDS);
    const request = store.get(rowKey);
    let enrollmentError: Error | null = null;
    request.onsuccess = () => {
      const existing = (request.result as CacheRow<ManagementPolicyPublicKey> | undefined)?.value;
      if (existing && (
        existing.keyId !== publicKey.keyId
        || existing.algorithm !== publicKey.algorithm
        || existing.publicKey !== publicKey.publicKey
      )) {
        enrollmentError = new ManagementPolicyKeyChangeError(normalizeManagementOrigin(origin));
        transaction.abort();
        return;
      }
      if (!existing) {
        store.put({ key: rowKey, value: publicKey, updatedAt: Date.now() });
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to read trusted policy key'));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      if (!enrollmentError) {
        reject(transaction.error ?? new Error('Failed to enroll trusted policy key'));
      }
    };
    transaction.onabort = () => reject(
      enrollmentError ?? transaction.error ?? new Error('Trusted policy key enrollment aborted'),
    );
  });
}

export async function loadCachedPolicy(
  origin: string,
  userId: string,
): Promise<EffectiveManagementPolicy | null> {
  return getRow<EffectiveManagementPolicy>(policyCacheRowKey(origin, userId));
}

export async function saveCachedPolicy(
  origin: string,
  userId: string,
  policy: EffectiveManagementPolicy,
): Promise<void> {
  await putRow(policyCacheRowKey(origin, userId), policy);
}

export function resetManagementPolicyCacheConnectionForTests(): void {
  dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
}
