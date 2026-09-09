// Durable offline queue for field meter readings.
// Metadata *and* the original captured image are persisted in IndexedDB so a
// reload, tab crash or phone restart never loses field evidence.

export interface QueuedAttempt {
  attemptNo: number;
  outcome: "OCR_FAILED" | "OCR_SUCCESS";
  reason?: string;
}

export interface QueuedReading {
  /** Stable client UUID: storage filename AND water_readings.client_uuid. */
  clientUuid: string;
  tenantId: string;
  customerId: string;
  meterId: string;
  meterNumber: string;
  current: number;
  readingDate: string;
  createdAt: string;
  by?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  /** Original captured image. Never dropped silently. */
  photo: Blob | null;
  photoType: string;
  attempts: QueuedAttempt[];
}

const DB_NAME = "mizan-offline";
const DB_VERSION = 1;
const STORE = "pending-readings";
const LEGACY_KEY = "mizan-pending-readings-v3";

function hasIDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clientUuid" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    t.oncomplete = () => db.close();
  });
}

export function notifyQueueChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("mizan-pending-updated"));
  }
}

export async function putQueuedReading(item: QueuedReading): Promise<void> {
  if (!hasIDB()) throw new Error("التخزين المحلي غير متاح على هذا الجهاز");
  await tx("readwrite", (s) => s.put(item));
  notifyQueueChanged();
}

export async function listQueuedReadings(): Promise<QueuedReading[]> {
  if (!hasIDB()) return [];
  try {
    await importLegacyQueue();
    const all = await tx<QueuedReading[]>("readonly", (s) => s.getAll());
    return (all ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function deleteQueuedReading(clientUuid: string): Promise<void> {
  if (!hasIDB()) return;
  await tx("readwrite", (s) => s.delete(clientUuid));
  notifyQueueChanged();
}

export async function countQueuedReadings(): Promise<number> {
  if (!hasIDB()) return 0;
  try {
    await importLegacyQueue();
    return await tx<number>("readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

/**
 * Legacy localStorage entries carried metadata only (no image). They are
 * imported with `photo: null` instead of being deleted, so the sync layer can
 * report them honestly as "evidence image missing" rather than dropping them.
 */
let legacyImported = false;
async function importLegacyQueue(): Promise<void> {
  if (legacyImported || typeof window === "undefined") return;
  legacyImported = true;
  const raw = window.localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const rows = JSON.parse(raw) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const clientUuid = String(r["clientId"] ?? r["clientUuid"] ?? "");
      if (!clientUuid) continue;
      await tx("readwrite", (s) =>
        s.put({
          clientUuid,
          tenantId: String(r["tenantId"] ?? ""),
          customerId: String(r["customerId"] ?? ""),
          meterId: String(r["meterId"] ?? ""),
          meterNumber: String(r["meterNumber"] ?? ""),
          current: Number(r["current"] ?? 0),
          readingDate: String(r["readingDate"] ?? new Date().toISOString().slice(0, 10)),
          createdAt: String(r["createdAt"] ?? new Date().toISOString()),
          by: r["by"] as string | undefined,
          latitude: r["latitude"] as number | undefined,
          longitude: r["longitude"] as number | undefined,
          accuracy: r["accuracy"] as number | undefined,
          photo: null,
          photoType: "image/jpeg",
          attempts: [],
        } satisfies QueuedReading),
      );
    }
    window.localStorage.removeItem(LEGACY_KEY);
    notifyQueueChanged();
  } catch {
    /* corrupt legacy payload — leave it in place for inspection */
  }
}
