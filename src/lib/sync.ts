import { useEffect, useState } from "react";
import { useStore } from "./store";
import { supabase } from "./supabase";
import { toast } from "sonner";
import {
  countQueuedReadings,
  deleteQueuedReading,
  listQueuedReadings,
  putQueuedReading,
  type QueuedAttempt,
  type QueuedReading,
} from "./offline-queue";

export type { QueuedReading, QueuedAttempt } from "./offline-queue";

// Offline field readings are persisted durably in IndexedDB (metadata + the
// original captured image). On reconnect the image is uploaded FIRST to the
// verified path `tenants/{tenant_id}/readings/{client_uuid}.{ext}`, then the
// reading is submitted through the server-verified RPC
// `insert_verified_meter_reading`, which owns previous index, consumption,
// anomaly flags, status and billing. The stable `client_uuid` keeps replays
// idempotent.

export function extForType(type: string): "jpg" | "png" | "webp" {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export function storagePathFor(tenantId: string, clientUuid: string, type: string): string {
  return `tenants/${tenantId}/readings/${clientUuid}.${extForType(type)}`;
}

export async function addPending(item: QueuedReading): Promise<void> {
  await putQueuedReading(item);
}

export async function getPending(): Promise<QueuedReading[]> {
  return listQueuedReadings();
}

export async function removePending(clientUuid: string): Promise<void> {
  await deleteQueuedReading(clientUuid);
}

async function replayAttempts(p: QueuedReading) {
  for (const a of p.attempts ?? []) {
    await supabase.rpc("record_reading_attempt", {
      p_tenant_id: p.tenantId,
      p_client_uuid: p.clientUuid,
      p_meter_id: p.meterId,
      p_outcome: a.outcome,
      p_reason: a.reason ?? null,
    });
  }
}

export async function syncPending(): Promise<{ synced: number; blocked: number }> {
  const list = await listQueuedReadings();
  if (!list.length) return { synced: 0, blocked: 0 };

  let synced = 0;
  let blocked = 0;

  for (const p of list) {
    if (!p.photo) {
      // Never silently dropped: kept in the queue and surfaced to the reader.
      blocked++;
      continue;
    }
    if (!p.tenantId) { blocked++; continue; }

    try {
      const path = storagePathFor(p.tenantId, p.clientUuid, p.photoType || p.photo.type);
      const up = await supabase.storage
        .from("meter-readings")
        .upload(path, p.photo, { contentType: p.photoType || p.photo.type || "image/jpeg", upsert: true });
      if (up.error) throw new Error(up.error.message);

      await replayAttempts(p);

      const { error } = await supabase.rpc("insert_verified_meter_reading", {
        p_tenant_id: p.tenantId,
        p_customer_id: p.customerId,
        p_meter_id: p.meterId,
        p_current_reading: p.current,
        p_reading_date: p.readingDate,
        p_client_uuid: p.clientUuid,
        p_photo_url: path,
        p_lat: p.latitude ?? null,
        p_lng: p.longitude ?? null,
        p_gps_verified: p.latitude != null,
      });
      if (error) throw new Error(error.message);

      await deleteQueuedReading(p.clientUuid);
      synced++;
      void broadcastTenantEvent(p.tenantId, "reading", {
        customerId: p.customerId, meterNumber: p.meterNumber, current: p.current,
        by: p.by, at: new Date().toISOString(),
      });
    } catch (err) {
      blocked++;
      toast.error(`تعذّرت مزامنة قراءة مؤجلة: ${(err as Error).message}`);
    }
  }

  if (blocked > 0) {
    toast.warning(`${blocked} قراءة مؤجلة لم تُرحّل بعد (تحقق من صورة الدليل أو الاتصال)`);
  }
  if (synced > 0) void useStore.getState().hydrateFromSupabase();
  return { synced, blocked };
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
    const refresh = () => { void countQueuedReadings().then(setCount); };
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
