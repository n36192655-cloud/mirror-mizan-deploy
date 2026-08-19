import { create } from "zustand";
import { persist } from "zustand/middleware";
import { supabase } from "./supabase";

export const VENDOR_NAME = "انديكيتورز للإستشارات";

export type LicenseStatus = "active" | "expired" | "invalid" | "seat_limit" | "suspended";

export interface Seat {
  id: string;
  user: string;
  role: string;
  device: string;
  since: string;
  lastSeen: string;
}

interface LicenseState {
  tenantId: string;
  licenseKey: string;
  maxSeats: number;
  expiresAt: string;
  billingPaid: boolean;
  seats: Seat[];
  initialized: boolean;

  initIfNeeded: () => void;
  // Synchronous local checks (used by AppShell / login for UI gating)
  validate: () => LicenseStatus;
  acquireSeat: (user: string, role: string) => { ok: boolean; seatId?: string; reason?: LicenseStatus };
  releaseSeat: (seatId: string) => void;
  touchSeat: (seatId: string) => void;
  // Cloud-backed helpers used by the subscription admin screen
  validateRemote: () => Promise<LicenseStatus>;
  currentFingerprint: () => string;
}


function computeFingerprint(): string {
  if (typeof window === "undefined") return "ssr";
  const parts = [
    navigator.userAgent,
    navigator.language,
    String(screen.width) + "x" + String(screen.height),
    String(navigator.hardwareConcurrency ?? ""),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const useLicense = create<LicenseState>()(
  persist(
    (set, get) => ({
      tenantId: "",
      licenseKey: "",
      maxSeats: 3,
      expiresAt: "",
      billingPaid: true,
      seats: [],
      initialized: false,

      currentFingerprint: () => computeFingerprint(),

      initIfNeeded: () => {
        const s = get();
        if (s.initialized) return;
        set({ initialized: true });
      },

      validate: () => {
        const s = get();
        if (!s.billingPaid) return "suspended";
        if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) return "expired";
        return "active";
      },

      acquireSeat: (user, role) => {
        const s = get();
        const status = get().validate();
        if (status !== "active") return { ok: false, reason: status };
        const fp = computeFingerprint();
        const existing = s.seats.find((x) => x.device === fp);
        if (existing) {
          set({
            seats: s.seats.map((x) =>
              x.id === existing.id ? { ...x, lastSeen: new Date().toISOString() } : x,
            ),
          });
          return { ok: true, seatId: existing.id };
        }
        if (s.seats.length >= s.maxSeats) return { ok: false, reason: "seat_limit" };
        const seat: Seat = {
          id: `seat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          user,
          role,
          device: fp,
          since: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };
        set({ seats: [...s.seats, seat] });
        return { ok: true, seatId: seat.id };
      },

      releaseSeat: (seatId) => {
        set({ seats: get().seats.filter((s) => s.id !== seatId) });
      },

      touchSeat: (seatId) => {
        set({
          seats: get().seats.map((s) =>
            s.id === seatId ? { ...s, lastSeen: new Date().toISOString() } : s,
          ),
        });
      },

      validateRemote: async () => {
        const s = get();
        if (!s.tenantId) return get().validate();
        try {
          const { data, error } = await supabase
            .from("tenants")
            .select("subscription_status, subscription_expires_at")
            .eq("id", s.tenantId)
            .maybeSingle();
          if (error || !data) return get().validate();
          const expired =
            data.subscription_expires_at &&
            new Date(data.subscription_expires_at).getTime() < Date.now();
          set({
            billingPaid: data.subscription_status === "active",
            expiresAt: data.subscription_expires_at ?? "",
          });
          if (data.subscription_status === "suspended") return "suspended";
          if (data.subscription_status === "expired" || expired) return "expired";
          return "active";
        } catch {
          return get().validate();
        }
      },
    }),

    { name: "mizan-cloud-license-v2" },
  ),
);

export function statusLabel(s: LicenseStatus): string {
  switch (s) {
    case "active":
      return "الاشتراك نشط";
    case "expired":
      return "انتهت صلاحية الاشتراك";
    case "invalid":
      return "اشتراك غير صالح";
    case "seat_limit":
      return "تم تجاوز عدد الأجهزة المسموح بها";
    case "suspended":
      return "الاشتراك معلّق — يرجى التواصل مع مالك المنصة";
    default:
      return "حالة غير معروفة";
  }
}
