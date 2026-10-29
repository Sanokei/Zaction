import type { LocalState } from './model';
import { emptyLocalState, normalizeLocal } from './migrations';

const DATABASE = 'zaction-local-v1';
export interface CommunitySession { memberId: string; token: string }
export interface SessionChange extends CommunitySession { roomId: string }
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
  return emptyLocalState();
}

// Read and update in the same transaction so a polling tab cannot replace
// another tab's newly saved draft or pending submission with its old snapshot.
export async function updateLocal(update: (previous: LocalState) => LocalState, session?: SessionChange): Promise<LocalState> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('records', 'readwrite');
    const records = transaction.objectStore('records');
    const request = records.get('state');
    let next: LocalState;
    let failure: unknown;
    const persist = () => {
      if (!session) { records.put(next, 'state'); return; }
      const privateRecord = records.get('community-sessions');
      privateRecord.onsuccess = () => {
        if (privateRecord.result !== undefined && (!privateRecord.result || typeof privateRecord.result !== 'object' || Array.isArray(privateRecord.result))) {
          failure = new Error('Private profile storage needs review. Your saved data was preserved.'); transaction.abort(); return;
        }
        records.put({ ...(privateRecord.result ?? {}), [session.roomId]: { memberId: session.memberId, token: session.token } }, 'community-sessions');
        records.put(next, 'state');
      };
    };
    request.onsuccess = () => {
      try {
        const raw = request.result;
        next = update(normalizeLocal(raw));
        normalizeLocal(next);
        if (raw && raw.schemaVersion !== 2) {
          const backup = records.get('state-v1-backup');
          backup.onsuccess = () => {
            if (backup.result !== undefined && JSON.stringify(backup.result) !== JSON.stringify(raw)) {
              failure = new Error('An existing migration backup differs. Your saved data was preserved for review.'); transaction.abort(); return;
            }
            if (backup.result === undefined) records.add(raw, 'state-v1-backup');
            persist();
          };
        } else persist();
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Storage update was interrupted.'));
  });
}

export async function loadCommunitySession(roomId: string): Promise<CommunitySession | undefined> {
  const sessions = await read<Record<string, CommunitySession>>('community-sessions');
  if (sessions === undefined) return undefined;
  if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) throw new Error('Private profile storage needs review.');
  if (!Object.hasOwn(sessions, roomId)) return undefined;
  const session = sessions[roomId];
  if (!session || typeof session.memberId !== 'string' || typeof session.token !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(session.token)) throw new Error('The saved profile session needs review.');
  return session;
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
  const stored = await read<unknown>('state');
  normalizeLocal(stored);
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
