import type { LocalState } from './model';

const DATABASE = 'zaction-local-v1';
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); database = undefined; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Browser storage is unavailable.'));
      request.onblocked = () => reject(new Error('Close other Zaction tabs to open browser storage.'));
    }).catch(error => { database = undefined; throw error; });
  }
  return database;
}

async function read<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('records', 'readonly');
    const request = transaction.objectStore('records').get(key);
    let value: T | undefined;
    request.onsuccess = () => { value = request.result as T | undefined; };
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Storage read was interrupted.'));
  });
}

export function emptyLocal(): LocalState {
  return { memberId: null, snapshot: null, draft: '', progress: { read: false, reviewed: false }, pending: [], receipts: [], lastSync: null, identityFingerprint: '' };
}

function validateLocal(stored: LocalState | undefined) {
  if (stored && (!Array.isArray(stored.pending) || !Array.isArray(stored.receipts) || typeof stored.draft !== 'string' || !stored.progress)) {
    throw new Error('Saved data needs review. Your browser data has been preserved.');
  }
}

// Read and update in the same transaction so a polling tab cannot replace
// another tab's newly saved draft or pending submission with its old snapshot.
export async function updateLocal(update: (previous: LocalState) => LocalState): Promise<LocalState> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('records', 'readwrite');
    const records = transaction.objectStore('records');
    const request = records.get('state');
    let next: LocalState;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        validateLocal(request.result);
        next = update(request.result ? { ...emptyLocal(), ...request.result } : emptyLocal());
        records.put(next, 'state');
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Storage update was interrupted.'));
  });
}

async function identityIfAbsent(candidate: CryptoKeyPair): Promise<CryptoKeyPair> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('records', 'readwrite');
    const records = transaction.objectStore('records');
    const request = records.get('identity');
    let chosen: CryptoKeyPair;
    request.onsuccess = () => {
      chosen = request.result ?? candidate;
      if (!request.result) records.put(candidate, 'identity');
    };
    transaction.oncomplete = () => resolve(chosen);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Identity storage was interrupted.'));
  });
}

export async function loadLocal(): Promise<LocalState> {
  const stored = await read<LocalState>('state');
  validateLocal(stored);
  // Standard Web Crypto keys stay on this device. The synthetic demo profiles
  // are separate: a device key does not prove a unique human or authorize votes.
  let keys = await read<CryptoKeyPair>('identity');
  if (!keys) {
    keys = await identityIfAbsent(await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']));
  }
  const publicKey = await crypto.subtle.exportKey('spki', keys.publicKey);
  const digest = await crypto.subtle.digest('SHA-256', publicKey);
  const identityFingerprint = [...new Uint8Array(digest)].slice(0, 8).map(value => value.toString(16).padStart(2, '0')).join('');
  return updateLocal(previous => ({ ...previous, identityFingerprint }));
}
