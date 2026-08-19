import { useEffect, useState } from "react";
import { useStore } from "./store";
import { supabase } from "./supabase";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type ReadingInsert = Database["public"]["Tables"]["water_readings"]["Insert"];

// Pending water-reading queue kept in localStorage so meter readers can keep
// working in low-connectivity zones. On reconnect the queue is flushed
// straight into `water_readings`; the database owns previous index,
// consumption, anomaly flags, status and billing. `clientId` is sent as
// `client_uuid`, which is UNIQUE per tenant — replays are no-ops.
export interface PendingReading {
  clientId: string;
  /** customer uuid */
  customerId: string;
  /** meters.id uuid */
  meterId: string;
  meterNumber: string;
  current: number;
  readingDate?: string;
  createdAt: string;
  by?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  tenantId?: string;
}

// v3: payload carries the real meters.id uuid and is flushed to the database
// (v1/v2 payloads used client-side ids and are intentionally dropped).
const KEY = "mizan-pending-readings-v3";

function load(): PendingReading[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingReading[]) : [];
  } catch {
    return [];
  }
}

function save(arr: PendingReading[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(arr));
  window.dispatchEvent(new Event("mizan-pending-updated"));
}

export function getPending(): PendingReading[] {
  return load();
}

export function addPending(
  p: Omit<PendingReading, "clientId" | "createdAt"> & { clientId?: string },
): PendingReading {
  const list = load();
  const item: PendingReading = {
    ...p,
    clientId: p.clientId ?? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  save([...list, item]);
  return item;
}

export function removePending(clientId: string) {
  save(load().filter((p) => p.clientId !== clientId));
}

export async function syncPending(): Promise<{ synced: number }> {
  const list = load();
  if (!list.length) return { synced: 0 };

  let n = 0;
  const remaining: PendingReading[] = [];

  for (const p of list) {
    const { data: tenantRow } = await supabase.rpc("current_tenant_id");
    const tenantId = p.tenantId ?? (tenantRow as unknown as string | null);
    if (!tenantId) { remaining.push(p); continue; }

    const { error } = await supabase.from("water_readings").insert({
      tenant_id: tenantId,
      customer_id: p.customerId,
      meter_id: p.meterId,
      current_reading: p.current,
      reading_date: p.readingDate,
      client_uuid: p.clientId,
      lat: p.latitude ?? null,
      lng: p.longitude ?? null,
      accuracy: p.accuracy ?? null,
      gps_verified: p.latitude != null,
    } as ReadingInsert);

    // 23505 = already stored under this client_uuid → the queue entry is done.
    const duplicate = error?.code === "23505";
    if (error && !duplicate) {
      toast.error(`تعذّرت مزامنة قراءة مؤجلة: ${error.message}`);
      remaining.push(p);
      continue;
    }
    n++;
    if (p.tenantId) {
      void broadcastTenantEvent(p.tenantId, "reading", {
        customerId: p.customerId, meterNumber: p.meterNumber, current: p.current, by: p.by, at: new Date().toISOString(),
      });
    }
  }

  save(remaining);
  if (n > 0) void useStore.getState().hydrateFromSupabase();
  return { synced: n };
}

// ─── Supabase Realtime broadcast ────────────────────────────────────────────
// Cheap tenant-scoped broadcasts (no DB write per message). Managers and
// collectors listening to `tenant:<id>` receive updates instantly.
export type TenantEventType = "reading" | "bill" | "payment";

export async function broadcastTenantEvent(
  tenantId: string,
  type: TenantEventType,
  payload: Record<string, unknown>,
) {
  try {
    const channel = supabase.channel(`tenant:${tenantId}`);
    await channel.subscribe();
    await channel.send({ type: "broadcast", event: type, payload });
    await supabase.removeChannel(channel);
  } catch (err) {
    console.warn("[Mizan] broadcast failed:", err);
  }
}

export function subscribeToTenantEvents(
  tenantId: string,
  onEvent: (type: TenantEventType, payload: Record<string, unknown>) => void,
) {
  const channel = supabase.channel(`tenant:${tenantId}`);
  (["reading", "bill", "payment"] as const).forEach((event) => {
    channel.on("broadcast", { event }, (msg) =>
      onEvent(event, (msg.payload ?? {}) as Record<string, unknown>),
    );
  });
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const on = () => {
      setOnline(true);
      setTimeout(() => {
        void syncPending().then((result) => {
          if (result.synced > 0) {
            toast.success(`تمت مزامنة ${result.synced} قراءة مؤجلة`);
          }
        });
      }, 1000);
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}

export function usePendingCount() {
  const [count, setCount] = useState<number>(0);
  useEffect(() => {
    const refresh = () => setCount(load().length);
    refresh();
    window.addEventListener("mizan-pending-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("mizan-pending-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return count;
}
