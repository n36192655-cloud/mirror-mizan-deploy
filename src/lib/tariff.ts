import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

export interface Tier {
  id?: string;
  tier_order: number;
  /** null = الشريحة الأخيرة المفتوحة (ما فوق) */
  upper_bound: number | null;
  rate_per_m3: number;
}

/**
 * نسخة عميل مطابقة تماماً لدالة قاعدة البيانات public.compute_tiered_amount.
 * تُستخدم للمعاينة فقط — القيمة المعتمدة مالياً تُحسب في قاعدة البيانات.
 */
export function priceWithTariff(fixedFee: number, tiers: Tier[], consumption: number): number {
  let remaining = Math.max(consumption, 0);
  let prevUpper = 0;
  let total = fixedFee || 0;
  for (const t of [...tiers].sort((a, b) => a.tier_order - b.tier_order)) {
    if (remaining <= 0) break;
    if (t.upper_bound == null) {
      total += remaining * t.rate_per_m3;
      remaining = 0;
    } else {
      const slab = Math.min(remaining, t.upper_bound - prevUpper);
      if (slab > 0) {
        total += slab * t.rate_per_m3;
        remaining -= slab;
      }
      prevUpper = t.upper_bound;
    }
  }
  return Math.round(total * 100) / 100;
}

interface TariffState {
  tariffId: string | null;
  tenantId: string | null;
  name: string;
  currency: string;
  fixedFee: number;
  tiers: Tier[];
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  save: (input: { name: string; fixedFee: number; tiers: Tier[] }) => Promise<{ ok: boolean; error?: string }>;
  price: (consumption: number) => number;
}

export const useTariff = create<TariffState>()((set, get) => ({
  tariffId: null,
  tenantId: null,
  name: "التعرفة الأساسية",
  currency: "YER",
  fixedFee: 0,
  tiers: [],
  loading: false,
  loaded: false,

  load: async () => {
    set({ loading: true });
    try {
      const { data: tenantId } = await supabase.rpc("current_tenant_id");
      if (!tenantId) {
        set({ loading: false, loaded: true });
        return;
      }
      const { data: tariff } = await supabase
        .from("tariffs")
        .select("*")
        .eq("tenant_id", tenantId as unknown as string)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!tariff) {
        set({ tenantId: tenantId as unknown as string, tariffId: null, tiers: [], loading: false, loaded: true });
        return;
      }
      const { data: tiers } = await supabase
        .from("tariff_tiers")
        .select("*")
        .eq("tariff_id", tariff.id)
        .order("tier_order", { ascending: true });

      set({
        tenantId: tariff.tenant_id,
        tariffId: tariff.id,
        name: tariff.name,
        currency: tariff.currency,
        fixedFee: Number(tariff.fixed_fee ?? 0),
        tiers: (tiers ?? []).map((t) => ({
          id: t.id,
          tier_order: t.tier_order,
          upper_bound: t.upper_bound == null ? null : Number(t.upper_bound),
          rate_per_m3: Number(t.rate_per_m3),
        })),
        loading: false,
        loaded: true,
      });
    } catch {
      set({ loading: false, loaded: true });
    }
  },

  save: async ({ name, fixedFee, tiers }) => {
    const { data: tenantIdRaw } = await supabase.rpc("current_tenant_id");
    const tenantId = tenantIdRaw as unknown as string | null;
    if (!tenantId) return { ok: false, error: "لا يمكن تحديد المؤسسة الحالية" };

    // تحقق منطقي: الحدود تصاعدية والأسعار موجبة
    const sorted = [...tiers].sort((a, b) => a.tier_order - b.tier_order);
    let last = 0;
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      if (t.rate_per_m3 < 0) return { ok: false, error: "السعر لا يمكن أن يكون سالباً" };
      if (t.upper_bound == null) {
        if (i !== sorted.length - 1) return { ok: false, error: "الشريحة المفتوحة يجب أن تكون الأخيرة" };
      } else {
        if (t.upper_bound <= last) return { ok: false, error: "حدود الشرائح يجب أن تكون تصاعدية" };
        last = t.upper_bound;
      }
    }

    let tariffId = get().tariffId;
    if (!tariffId) {
      const { data, error } = await supabase
        .from("tariffs")
        .insert({ tenant_id: tenantId, name, fixed_fee: fixedFee, is_active: true })
        .select("id")
        .single();
      if (error || !data) return { ok: false, error: error?.message ?? "تعذّر إنشاء التعرفة" };
      tariffId = data.id;
    } else {
      const { error } = await supabase
        .from("tariffs")
        .update({ name, fixed_fee: fixedFee })
        .eq("id", tariffId);
      if (error) return { ok: false, error: error.message };
    }

    // استبدال كامل للشرائح ضمن نفس التعرفة
    const { error: delErr } = await supabase.from("tariff_tiers").delete().eq("tariff_id", tariffId);
    if (delErr) return { ok: false, error: delErr.message };

    const rows = sorted.map((t, i) => ({
      tariff_id: tariffId!,
      tenant_id: tenantId,
      tier_order: i + 1,
      upper_bound: t.upper_bound,
      rate_per_m3: t.rate_per_m3,
    }));
    if (rows.length) {
      const { error: insErr } = await supabase.from("tariff_tiers").insert(rows);
      if (insErr) return { ok: false, error: insErr.message };
    }

    await get().load();
    return { ok: true };
  },

  price: (consumption) => {
    const s = get();
    return priceWithTariff(s.fixedFee, s.tiers, consumption);
  },
}));
