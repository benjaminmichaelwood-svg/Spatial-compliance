import type { BoundaryRegion, Mode, Settings, SurfaceRole, UploadedSurface } from '../types';

/**
 * Silent, automatic crash/refresh recovery via IndexedDB.
 *
 * This is deliberately NOT the explicit, named "Save Project" feature
 * (that's a separate item — a user-initiated, shareable file). This is
 * background persistence purely so an accidental refresh, tab close, or
 * a crash (e.g. a bad file panicking the WASM module before Priority 2's
 * hardening) doesn't silently cost 20 minutes of re-uploading and
 * re-configuring.
 *
 * What's persisted and why: role assignments + settings + boundaries are
 * cheap (a few KB) and always saved. The parsed surface positions/indices
 * arrays are the expensive part — up to 250MB per surface, 5 surfaces —
 * but they're also the single most valuable thing to recover, since
 * re-parsing them from the original file is exactly the slow operation a
 * refresh would otherwise force the user to redo. So: attempt to persist
 * the full binary data too, but if IndexedDB's quota can't hold it (very
 * plausible at 5x250MB on a constrained device), fall back to metadata
 * only for that surface and say so explicitly — never fail silently or
 * partially without telling the user what happened.
 */

const DB_NAME = 'spatial-compliance-session';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const SESSION_KEY = 'current';

// Bump this if the shape of PersistedSession changes incompatibly — lets
// loadSession() detect and discard an old-format session instead of
// crashing trying to restore it.
const SESSION_FORMAT_VERSION = 1;

export interface PersistedRole {
  role: SurfaceRole;
  fileName: string;
  name: string;
  vertexCount: number;
  triangleCount: number;
  // Present only if the full binary payload fit within quota — see
  // `truncatedRoles` for which roles fell back to metadata-only.
  positions?: Float32Array;
  indices?: Uint32Array;
}

export interface PersistedSession {
  formatVersion: number;
  savedAt: number;
  comparisonName: string;
  mode: Mode;
  settings: Settings;
  boundaries: BoundaryRegion[];
  roles: PersistedRole[];
  /** Roles whose surface data could not be saved (quota) — metadata only, will need re-attaching. */
  truncatedRoles: SurfaceRole[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(db: IDBDatabase, value: PersistedSession): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, SESSION_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function idbGet(db: IDBDatabase): Promise<PersistedSession | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(SESSION_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(SESSION_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface SaveSessionInput {
  comparisonName: string;
  mode: Mode;
  settings: Settings;
  boundaries: BoundaryRegion[];
  uploads: Map<SurfaceRole, UploadedSurface>;
}

/**
 * Save the current session. Always persists metadata for every assigned
 * role; attempts to also persist each role's binary positions/indices.
 * Returns which roles (if any) had to fall back to metadata-only, so the
 * caller can inform the user rather than silently losing data.
 */
export async function saveSession(input: SaveSessionInput): Promise<{ truncatedRoles: SurfaceRole[] }> {
  const db = await openDb();
  try {
    const buildRoles = (includeBinary: boolean): PersistedRole[] =>
      [...input.uploads.entries()].map(([role, u]) => ({
        role,
        fileName: u.fileName,
        name: u.name,
        vertexCount: u.vertexCount,
        triangleCount: u.triangleCount,
        ...(includeBinary ? { positions: u.positions, indices: u.indices } : {}),
      }));

    const base = {
      formatVersion: SESSION_FORMAT_VERSION,
      savedAt: Date.now(),
      comparisonName: input.comparisonName,
      mode: input.mode,
      settings: input.settings,
      boundaries: input.boundaries,
    };

    try {
      await idbPut(db, { ...base, roles: buildRoles(true), truncatedRoles: [] });
      return { truncatedRoles: [] };
    } catch (fullSaveError) {
      // Most likely a QuotaExceededError from the full binary payload.
      // Fall back to metadata-only rather than losing the save entirely.
      const truncatedRoles = [...input.uploads.keys()];
      await idbPut(db, { ...base, roles: buildRoles(false), truncatedRoles });
      return { truncatedRoles };
    }
  } finally {
    db.close();
  }
}

export async function loadSession(): Promise<PersistedSession | null> {
  const db = await openDb();
  try {
    const session = await idbGet(db);
    if (!session || session.formatVersion !== SESSION_FORMAT_VERSION) return null;
    return session;
  } finally {
    db.close();
  }
}

export async function clearSession(): Promise<void> {
  const db = await openDb();
  try {
    await idbDelete(db);
  } finally {
    db.close();
  }
}

/** Simple debounce — used so a burst of state changes (typing in a
 * settings field, drawing a boundary point-by-point) doesn't trigger a
 * save per keystroke/click. */
export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
