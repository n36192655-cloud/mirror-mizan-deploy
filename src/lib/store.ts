import { create } from "zustand";
import { toast } from "sonner";
import { calcConsumption, type MeterType } from "./pricing";
import { supabase } from "@/integrations/supabase/client";
import { useTariff } from "./tariff";

/**
 * PostgREST يفرض حدًّا افتراضيًا (1000 صف) على كل استعلام. عند تجاوز أي جدول
 * هذا الحد كانت الصفوف الأحدث تختفي من الواجهة تمامًا. هذا المُحمِّل يجلب كل
 * الصفوف على دفعات مرتبة تصاعديًا بمفتاح ثابت — لا حدود، ولا بيانات مخفية.
 */
const PAGE = 1000;
async function fetchAll<T = Record<string, unknown>>(
  table: string,
  orderBy: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table as never)
      .select("*")
      .order(orderBy, { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`[Mizan] fetchAll(${table}) failed:`, error.message);
      break;
    }
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** العدد الحقيقي للصفوف في قاعدة البيانات (COUNT(*)) وليس طول المصفوفة. */
async function countRows(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table as never)
    .select("id", { count: "exact", head: true });
  if (error) return 0;
  return count ?? 0;
}


export type ApprovalStatus = "pending" | "approved" | "rejected";
/** حالة القراءة كما تخزَّن في قاعدة البيانات (موحّدة بين الواجهة والخادم). */
export type ReadingStatus = "pending_approval" | "approved" | "rejected";

export interface Customer {
  id: number;
  name: string;
  phone: string;
  city: string;
  directorate?: string;
  address?: string;
  pay_account: string;
  status?: "active" | "pending" | "rejected" | "suspended";
  submitted_by?: string;
  submitted_at?: string;
  latitude?: number;
  longitude?: number;
  geo_accuracy?: number;
  geo_captured_at?: string;
  family_members: number;
  /** رصيد المشترك كما تحسبه قاعدة البيانات (مصدر الحقيقة الوحيد للمديونية). */
  balance?: number;
}

export interface Meter {
  id: number;
  customer_id: number;
  number: string;
  type: MeterType;
  status: "active" | "inactive" | "pending";
  photo?: string;
}

export interface Reading {
  id: number;
  serial: string;
  meter_id: number;
  previous: number;
  current: number;
  consumption: number;
  date: string;
  flag: "ok" | "suspicious" | "error";
  status: ReadingStatus;
  photo?: string;
  ocr_serial?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  by?: string;
}

export interface Bill {
  id: number;
  serial: string;
  customer_id: number;
  meter_id: number;
  reading_id: number;
  subtotal: number;
  arrears: number;
  total: number;
  /** المبلغ المعتمد المسدَّد كما تسجّله قاعدة البيانات (water_bills.paid_amount). */
  paid?: number;
  status: "unpaid" | "paid" | "partial";
  date: string;
  photo?: string;
}

/** فئات طرق الدفع الموحّدة — تطابق ما يخزّنه الخادم في payments.method. */
export type PaymentMethod = "cash" | "wallet" | "transfer";

/** ترجمة قيمة قاعدة البيانات إلى فئة موحّدة. */
export function normalizePaymentMethod(raw: string): PaymentMethod {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "cash" || v === "نقدي") return "cash";
  if (v === "wallet" || v === "الكريمي" || v === "محفظة") return "wallet";
  if (v === "transfer" || v === "تحويل") return "transfer";
  return "cash";
}

/** عرض اسم طريقة الدفع بالعربية للواجهة. */
export function paymentMethodLabel(m: PaymentMethod | string): string {
  const n = normalizePaymentMethod(m);
  if (n === "cash") return "نقدي";
  if (n === "wallet") return "الكريمي";
  return "تحويل";
}

export interface Payment {
  id: number;
  bill_id: number;
  amount: number;
  method: PaymentMethod;
  date: string;
  status: ApprovalStatus;
  by?: string;
}

export interface ProductionLog {
  id: number;
  type: MeterType;
  units: number;
  date: string;
  note?: string;
  photo?: string;
}

export function payAccountFor(id: number): string {
  return `KRM-YE-${String(id).padStart(6, "0")}`;
}

function dayStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function nextSerial(prefix: string, id: number): string {
  return `${prefix}-${dayStamp()}-${String(id).padStart(4, "0")}`;
}

const DIRECTORATES = [
  "المظفر", "القاهرة", "صالة", "المعافر", "الشمايتين", "المسراخ", "جبل حبشي", "أخرى",
];
export const TAIZ_DIRECTORATES = DIRECTORATES;

/**
 * المتبقي على الفاتورة = نفس معادلة الخادم في `record_payment`:
 *   total - (المدفوع المعتمد) - (المدفوع قيد الاعتماد)
 * المدفوع المعتمد تؤخذ قيمته المباشرة من `water_bills.paid_amount` عند توفرها.
 */
export function billBalance(bill: Bill, payments: Payment[]): number {
  if (!bill) return 0;
  const approved = bill.paid !== undefined
    ? Number(bill.paid)
    : payments
        .filter((p) => p.bill_id === bill.id && p.status === "approved")
        .reduce((a, p) => a + Number(p.amount || 0), 0);

  const pending = payments
    .filter((p) => p.bill_id === bill.id && p.status === "pending")
    .reduce((a, p) => a + Number(p.amount || 0), 0);

  return Math.max(0, Number(bill.total || 0) - approved - pending);
}

// Stable UUID -> numeric hash so UI keeps numeric IDs while DB uses UUIDs.
function hashId(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) h = ((h << 5) - h + uuid.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

// Map: local numeric id <-> Supabase UUID.
const ID_MAP_KEY = "mizan-idmap-v1";
type IdMapKind = "customer" | "meter" | "reading" | "bill" | "payment" | "productionLog";

const idMap: Record<IdMapKind, Map<number, string>> = {
  customer: new Map<number, string>(),
  meter: new Map<number, string>(),
  reading: new Map<number, string>(),
  bill: new Map<number, string>(),
  payment: new Map<number, string>(),
  productionLog: new Map<number, string>(),
};

function loadIdMap() {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(ID_MAP_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, [number, string][]>;
    (Object.keys(idMap) as IdMapKind[]).forEach((k) => {
      if (Array.isArray(parsed[k])) idMap[k] = new Map(parsed[k]);
    });
  } catch { /* corrupted cache — rebuilt on next hydration */ }
}

function saveIdMap() {
  if (typeof window === "undefined") return;
  try {
    const out: Record<string, [number, string][]> = {};
    (Object.keys(idMap) as IdMapKind[]).forEach((k) => { out[k] = [...idMap[k].entries()]; });
    window.localStorage.setItem(ID_MAP_KEY, JSON.stringify(out));
  } catch { /* quota — non fatal */ }
}

loadIdMap();

export function uuidForCustomer(id: number) { return idMap.customer.get(id); }
export function uuidForMeter(id: number) { return idMap.meter.get(id); }
export function uuidForReading(id: number) { return idMap.reading.get(id); }
export function uuidForBill(id: number) { return idMap.bill.get(id); }
export function uuidForPayment(id: number) { return idMap.payment.get(id); }

/** ترجمة رسائل أخطاء الدوال المالية في الخادم إلى نص عربي واضح للمستخدم. */
function financialError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("exceeds remaining balance")) return "المبلغ يتجاوز المتبقي على الفاتورة";
  if (m.includes("exceed bill total")) return "الاعتماد يتجاوز إجمالي الفاتورة";
  if (m.includes("amount must be positive")) return "المبلغ يجب أن يكون أكبر من صفر";
  if (m.includes("not pending")) return "الدفعة لم تعد بانتظار الاعتماد";
  if (m.includes("forbidden")) return "لا تملك صلاحية تنفيذ هذه العملية";
  if (m.includes("not authenticated")) return "انتهت الجلسة — سجّل الدخول مجدداً";
  if (m.includes("bill not found")) return "الفاتورة غير موجودة";
  if (m.includes("payment not found")) return "الدفعة غير موجودة";
  return message;
}

/** ترجمة أخطاء عمليات العدادات القادمة من دوال الخادم. */
function meterError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already assigned to another customer")) return "رقم العداد مرتبط بمشترك آخر";
  if (m.includes("serial is required")) return "رقم العداد مطلوب";
  if (m.includes("customer not found")) return "المشترك غير موجود";
  if (m.includes("forbidden")) return "لا تملك صلاحية إدارة العدادات";
  if (m.includes("not authenticated")) return "انتهت الجلسة — سجّل الدخول مجدداً";
  return message;
}

/** العدّادات الحقيقية القادمة من COUNT(*) في قاعدة البيانات. */
export interface DbCounts {
  customers: number;
  readings: number;
  bills: number;
  payments: number;
}

interface State {
  customers: Customer[];
  meters: Meter[];
  readings: Reading[];
  bills: Bill[];
  payments: Payment[];
  productionLogs: ProductionLog[];
  counts: DbCounts;
  seeded: boolean;
  hydrated: boolean;
  hydrateFromSupabase: () => Promise<void>;
  adminCreateSubscriber: (data: {
    name: string; phone: string; directorate: string; address: string;
    meterType: MeterType; meterNumber: string; submittedBy?: string;
    familyMembers?: number;
    latitude?: number; longitude?: number; geoAccuracy?: number;
  }) => Promise<{ customer: Customer; meter: Meter }>;

  updateCustomer: (id: number, c: Partial<Customer>) => void;
  deactivateCustomer: (id: number, reason?: string) => Promise<void>;
  assignMeter: (customerId: number, serial: string, initialIndex?: number) => Promise<void>;
  replaceMeter: (customerId: number, newSerial: string, newInitialIndex?: number) => Promise<void>;
  unassignMeter: (customerId: number, reason?: string) => Promise<void>;
  approveReading: (id: number) => void;
  rejectReading: (id: number, reason?: string) => void;
  addPayment: (input: { billId: number; amount: number; method: PaymentMethod | string; by?: string }) => Payment;
  approvePayment: (id: number) => void;
  rejectPayment: (id: number) => void;
  addProductionLog: (p: Omit<ProductionLog, "id">) => void;
  deleteProductionLog: (id: number) => void;
  computeArrears: (customerId: number, excludeBillId?: number) => number;
  reset: () => void;
}

function initial() {
  return {
    customers: [] as Customer[],
    meters: [] as Meter[],
    readings: [] as Reading[],
    bills: [] as Bill[],
    payments: [] as Payment[],
    productionLogs: [] as ProductionLog[],
    counts: { customers: 0, readings: 0, bills: 0, payments: 0 } as DbCounts,
    seeded: false,
    hydrated: false,
  };
}

// لا يوجد persist للبيانات التشغيلية: مصدر الحقيقة الوحيد هو قاعدة البيانات،
// وأي لقطة محلية قديمة كانت تُظهر بيانات Seed بدل الفواتير الحديثة.
if (typeof window !== "undefined") {
  try { window.localStorage.removeItem("mizan-utility-v2"); } catch { /* ignore */ }
}

export const useStore = create<State>()(
    ((set, get) => ({
      ...initial(),


      hydrateFromSupabase: async () => {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user) return;
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const [cs, ms, mas, rs, bs, ps, pl, counts] = await Promise.all([
          fetchAll<any>("customers", "created_at"),
          fetchAll<any>("meters", "created_at"),
          fetchAll<any>("meter_assignments", "created_at"),
          fetchAll<any>("water_readings", "created_at"),
          fetchAll<any>("water_bills", "created_at"),
          fetchAll<any>("payments", "created_at"),
          fetchAll<any>("production_log", "logged_at"),
          Promise.all([
            countRows("customers"),
            countRows("water_readings"),
            countRows("water_bills"),
            countRows("payments"),
          ]).then(([customers, readings, bills, payments]) => ({
            customers, readings, bills, payments,
          })),
        ]);
        /* eslint-enable @typescript-eslint/no-explicit-any */


        idMap.customer.clear();
        idMap.meter.clear();
        idMap.reading.clear();
        idMap.bill.clear();
        idMap.payment.clear();
        idMap.productionLog.clear();

        const customers: Customer[] = (cs ?? []).map((c: any) => {
          const nid = hashId(c.id);
          idMap.customer.set(nid, c.id);
          return {
            id: nid, name: c.name, phone: c.phone ?? "", city: "تعز",
            directorate: c.directorate ?? undefined,
            address: c.address ?? undefined,
            pay_account: c.pay_account ?? payAccountFor(nid),
            status: (c.status === "active"
              ? "active"
              : c.status === "suspended"
                ? "suspended"
                : "pending") as Customer["status"],
            latitude: c.latitude ?? undefined, longitude: c.longitude ?? undefined,
            geo_accuracy: c.geo_accuracy ?? undefined,
            geo_captured_at: c.geo_captured_at ?? undefined,
            family_members: Number(c.family_members ?? 5) || 5,
            balance: Number(c.balance ?? 0),
          };
        });

        // العدادات كيان مستقل مرتبط بالمشترك عبر meter_assignments النشطة.
        const serialByMeterUuid = new Map<string, string>((ms ?? []).map((m: any) => [m.id, m.serial as string]));
        const activeAssignments = (mas ?? []).filter((a: any) => !a.ended_at);
        const meterUuidByCustomerUuid = new Map<string, string>();
        const customerUuidByMeterUuid = new Map<string, string>();
        activeAssignments.forEach((a: any) => {
          if (!a.customer_id || !a.meter_id) return;
          meterUuidByCustomerUuid.set(a.customer_id, a.meter_id);
          customerUuidByMeterUuid.set(a.meter_id, a.customer_id);
        });

        const meters: Meter[] = (ms ?? []).map((m: any) => {
          const mid = hashId(m.id);
          idMap.meter.set(mid, m.id);
          const custUuid = customerUuidByMeterUuid.get(m.id);
          return {
            id: mid,
            customer_id: custUuid ? hashId(custUuid) : 0,
            number: m.serial as string,
            type: "water" as MeterType,
            status: (m.status === "active" ? "active" : "inactive") as Meter["status"],
          };
        });

        const customerNumericByUuid = new Map<string, number>((cs ?? []).map((c: any) => [c.id, hashId(c.id)]));

        const readingMeter = new Map<string, number>();
        const readings: Reading[] = (rs ?? []).map((r) => {
          const nid = hashId(r.id);
          idMap.reading.set(nid, r.id);
          const custNum = customerNumericByUuid.get(r.customer_id ?? "") ?? 0;
          const meterUuid = (r as any).meter_id ?? meterUuidByCustomerUuid.get(r.customer_id ?? "") ?? null;
          const mid = meterUuid ? hashId(meterUuid) : 0;
          if (meterUuid) idMap.meter.set(mid, meterUuid);
          readingMeter.set(r.id, mid);
          return {
            id: nid, serial: nextSerial("RD", nid), meter_id: mid,
            previous: Number(r.previous), current: Number(r.current_reading),
            consumption: Number(r.consumption), date: r.created_at,
            flag: (r.flag as Reading["flag"]) ?? "ok",
            status: (r.status === "approved" ? "approved" : r.status === "rejected" ? "rejected" : "pending_approval") as ReadingStatus,
            lat: r.lat ?? undefined, lng: r.lng ?? undefined,
          };
        });

        const bills: Bill[] = (bs ?? []).map((b) => {
          const nid = hashId(b.id);
          idMap.bill.set(nid, b.id);
          return {
            id: nid, serial: nextSerial("INV", nid),
            customer_id: b.customer_id ? hashId(b.customer_id) : 0,
            meter_id: b.reading_id ? (readingMeter.get(b.reading_id) ?? 0) : 0,
            reading_id: b.reading_id ? hashId(b.reading_id) : 0,
            subtotal: Number(b.subtotal), arrears: Number(b.arrears), total: Number(b.total),
            paid: Number(b.paid_amount ?? 0),
            status: (b.status as Bill["status"]) ?? "unpaid",
            date: b.issued_at,
          };
        });

        const payments: Payment[] = (ps ?? []).map((p: any) => {
          const nid = hashId(p.id);
          idMap.payment.set(nid, p.id);
          const raw = (p.status as string | undefined) ?? "approved";
          const status: ApprovalStatus =
            raw === "approved" || raw === "pending" || raw === "rejected"
              ? (raw as ApprovalStatus)
              : "approved";
          return {
            id: nid, bill_id: p.bill_id ? hashId(p.bill_id) : 0,
            amount: Number(p.amount), method: normalizePaymentMethod(p.method), date: p.created_at,
            status,
          };
        });

        const productionLogs: ProductionLog[] = (pl ?? []).map((p) => {
          const nid = hashId(p.id);
          idMap.productionLog.set(nid, p.id);
          return { id: nid, type: "water", units: Number(p.produced_m3), date: p.logged_at, note: p.notes ?? undefined };
        });

        saveIdMap();
        // الأحدث أولاً في السجلات الزمنية حتى تظهر الفواتير/القراءات/الدفعات
        // الجديدة في أعلى الجداول بدل أن تُدفن أسفل آلاف الصفوف القديمة.
        const byNewest = <T extends { date: string }>(arr: T[]) =>
          [...arr].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

        set({
          customers,
          meters,
          readings: byNewest(readings),
          bills: byNewest(bills),
          payments: byNewest(payments),
          productionLogs,
          counts,
          hydrated: true,
          seeded: false,
        });

        void useTariff.getState().load();
      },

      adminCreateSubscriber: async (data) => {
        const s = get();
        const cid = Math.max(0, ...s.customers.map((x) => x.id)) + 1;
        const familyMembers = Math.max(1, Number(data.familyMembers ?? 5) || 5);
        const geoAt = data.latitude != null ? new Date().toISOString() : undefined;

        const { data: tenantRow, error: tenantError } = await supabase.rpc("current_tenant_id");
        if (tenantError || !tenantRow) {
          throw new Error("تعذّر تحديد المؤسسة الحالية — تأكد من تسجيل الدخول بصلاحية مدير");
        }

        const payload = {
          tenant_id: tenantRow as unknown as string,
          name: data.name,
          phone: data.phone,
          directorate: data.directorate,
          address: data.address,
          status: "active",
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          geo_accuracy: data.geoAccuracy ?? null,
          geo_captured_at: geoAt ?? null,
          family_members: familyMembers,
        };

        const taken = new Set(s.customers.map((c) => c.pay_account));
        let payAccount = payAccountFor(cid);
        while (taken.has(payAccount)) payAccount = payAccountFor(Math.floor(Math.random() * 900000) + 100000);
        let inserted: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const res = await supabase
            .from("customers")
            .insert({ ...payload, pay_account: payAccount })
            .select("*").single();
          if (!res.error && res.data) { inserted = res.data; break; }
          const conflict =
            res.error?.code === "23505" || /duplicate|conflict/i.test(res.error?.message ?? "");
          if (conflict && attempt < 4) {
            payAccount = payAccountFor(Math.floor(Math.random() * 900000) + 100000);
            continue;
          }
          throw new Error(res.error?.message ?? "تعذّر حفظ المشترك في قاعدة البيانات");
        }
        if (!inserted) throw new Error("تعذّر حفظ المشترك في قاعدة البيانات");

        const nid = hashId(inserted.id);
        idMap.customer.set(nid, inserted.id);
        saveIdMap();

        const { error: meterError2 } = await supabase.rpc("assign_meter", {
          _customer_id: inserted.id,
          _serial: data.meterNumber,
          _meter_type: data.meterType ?? "water",
        });
        if (meterError2) throw new Error(meterError(meterError2.message));

        await get().hydrateFromSupabase();

        const after = get();
        const customer =
          after.customers.find((c) => c.id === nid) ?? {
            id: nid, name: data.name, phone: data.phone, city: "تعز",
            directorate: data.directorate, address: data.address,
            pay_account: payAccount, status: "active" as const,
            family_members: familyMembers,
          };
        const serial = data.meterNumber.trim().toUpperCase();
        const meter =
          after.meters.find((m) => m.customer_id === nid && m.number.toUpperCase() === serial) ?? {
            id: 0, customer_id: nid,
            number: serial, type: data.meterType, status: "active" as const,
          };

        return { customer, meter };
      },

      updateCustomer: (id, c) => set((s) => ({
        customers: s.customers.map((x) => (x.id === id ? { ...x, ...c } : x)),
      })),

      deactivateCustomer: async (id, reason) => {
        const uuid = idMap.customer.get(id);
        if (!uuid) throw new Error("المشترك غير متزامن مع الخادم — حدّث الصفحة");
        const { error } = await supabase
          .from("customers")
          .update({ status: "suspended", suspended_reason: reason ?? null })
          .eq("id", uuid);
        if (error) throw new Error(error.message);
        await supabase.rpc("unassign_meter", { _customer_id: uuid, _reason: reason ?? undefined });
        await get().hydrateFromSupabase();
      },

      assignMeter: async (customerId, serial) => {
        const uuid = idMap.customer.get(customerId);
        if (!uuid) throw new Error("المشترك غير متزامن مع الخادم — حدّث الصفحة");
        const { error } = await supabase.rpc("assign_meter", { _customer_id: uuid, _serial: serial });
        if (error) throw new Error(meterError(error.message));
        await get().hydrateFromSupabase();
      },

      replaceMeter: async (customerId, newSerial) => {
        const uuid = idMap.customer.get(customerId);
        if (!uuid) throw new Error("المشترك غير متزامن مع الخادم — حدّث الصفحة");
        const { error } = await supabase.rpc("replace_meter", { _customer_id: uuid, _new_serial: newSerial });
        if (error) throw new Error(meterError(error.message));
        await get().hydrateFromSupabase();
      },

      unassignMeter: async (customerId) => {
        const uuid = idMap.customer.get(customerId);
        if (!uuid) throw new Error("المشترك غير متزامن مع الخادم — حدّث الصفحة");
        const { error } = await supabase.rpc("unassign_meter", { _customer_id: uuid });
        if (error) throw new Error(meterError(error.message));
        await get().hydrateFromSupabase();
      },

      computeArrears: (customerId, excludeBillId) => {
        const s = get();
        const customer = s.customers.find((c) => c.id === customerId);
        if (excludeBillId === undefined && customer?.balance !== undefined) {
          return customer.balance;
        }
        return s.bills
          .filter((b) => b.customer_id === customerId && b.id !== excludeBillId && b.status !== "paid")
          .reduce((a, b) => a + billBalance(b, s.payments), 0);
      },

      approveReading: (id) => {
        set((s) => ({
          readings: s.readings.map((r) => r.id === id ? { ...r, status: "approved" } : r),
        }));
        const uuid = idMap.reading.get(id);
        if (!uuid) {
          toast.error("تعذّر الاعتماد: القراءة غير متزامنة مع الخادم — حدّث الصفحة");
          return;
        }
        void (async () => {
          const { error } = await (supabase as unknown as {
            rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
          }).rpc("approve_reading", { _reading_id: uuid });
          if (error) {
            set((s) => ({
              readings: s.readings.map((r) => r.id === id ? { ...r, status: "pending_approval" } : r),
            }));
            toast.error(`فشل اعتماد القراءة: ${financialError(error.message)}`);
            return;
          }
          await get().hydrateFromSupabase();
          toast.success("تم اعتماد القراءة وإصدار الفاتورة");
        })();
      },

      rejectReading: (id, reason) => {
        set((s) => ({
          readings: s.readings.map((r) => r.id === id ? { ...r, status: "rejected" } : r),
        }));
        const uuid = idMap.reading.get(id);
        if (!uuid) return;
        void (async () => {
          const { error } = await (supabase as unknown as {
            rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
          }).rpc("reject_reading", { _reading_id: uuid, _reason: reason ?? null });
          if (error) {
            set((s) => ({
              readings: s.readings.map((r) => r.id === id ? { ...r, status: "pending_approval" } : r),
            }));
            toast.error(`فشل رفض القراءة: ${financialError(error.message)}`);
            return;
          }
          await get().hydrateFromSupabase();
        })();
      },

      // Phase 1 Conservative Financial RPC Integration
      addPayment: ({ billId, amount, method, by }) => {
        const s = get();
        const clientUuid = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const canonicalMethod = normalizePaymentMethod(method);
        const p: Payment = {
          id: Math.max(0, ...s.payments.map((x) => x.id)) + 1,
          bill_id: billId,
          amount,
          method: canonicalMethod,
          date: new Date().toISOString(),
          status: "pending",
          by,
        };

        // Optimistic UI update
        set({ payments: [...s.payments, p] });

        void (async () => {
          const billUuid = idMap.bill.get(billId);
          if (!billUuid) {
            set((cur) => ({ payments: cur.payments.filter((x) => x.id !== p.id) }));
            toast.error("تعذّر تسجيل الدفعة: الفاتورة غير متزامنة مع الخادم — حدّث الصفحة وأعد المحاولة");
            return;
          }

          const res = await supabase.rpc("record_payment", {
            _bill_id: billUuid,
            _amount: amount,
            _method: canonicalMethod,
            _client_uuid: clientUuid,
          });

          if (res.error) {
            set((cur) => ({ payments: cur.payments.filter((x) => x.id !== p.id) }));
            toast.error(`فشل تسجيل الدفعة: ${financialError(res.error.message)}`);
            return;
          }

          await get().hydrateFromSupabase();
          toast.success("تم تسجيل الدفعة — بانتظار اعتماد الإدارة");
        })();

        return p;
      },

      approvePayment: (id) => {
        const uuid = idMap.payment.get(id);
        if (!uuid) {
          toast.error("تعذّر الاعتماد: الدفعة غير متزامنة مع الخادم — حدّث الصفحة");
          return;
        }

        void (async () => {
          const res = await supabase.rpc("approve_payment", { _payment_id: uuid });

          if (res.error) {
            toast.error(`فشل اعتماد الدفعة: ${financialError(res.error.message)}`);
            return;
          }

          await get().hydrateFromSupabase();
          toast.success("تم اعتماد الدفعة وخصمها من رصيد المشترك");
        })();
      },

      rejectPayment: (id) => {
        const uuid = idMap.payment.get(id);
        if (!uuid) {
          toast.error("تعذّر الرفض: الدفعة غير متزامنة مع الخادم — حدّث الصفحة");
          return;
        }

        void (async () => {
          const res = await supabase.rpc("reject_payment", { _payment_id: uuid, _reason: undefined });

          if (res.error) {
            toast.error(`فشل رفض الدفعة: ${financialError(res.error.message)}`);
            return;
          }

          await get().hydrateFromSupabase();
          toast.info("تم رفض الدفعة");
        })();
      },

      addProductionLog: (p) => {
        const localId = Math.max(0, ...get().productionLogs.map((x) => x.id)) + 1;
        set((s) => ({ productionLogs: [...s.productionLogs, { ...p, id: localId }] }));
        void (async () => {
          const { data: tenantId } = await supabase.rpc("current_tenant_id");
          if (!tenantId) return;
          const { error } = await supabase.from("production_log").insert({
            tenant_id: tenantId as unknown as string,
            produced_m3: p.units,
            notes: p.note ?? null,
            logged_at: p.date.slice(0, 10),
          });
          if (error) { toast.error(`تعذّر حفظ سجل الإنتاج: ${error.message}`); return; }
          await get().hydrateFromSupabase();
        })();
      },

      deleteProductionLog: (id) => {
        const uuid = idMap.productionLog.get(id);
        void (async () => {
          if (!uuid) { toast.error("السجل غير متزامن — حدّث الصفحة"); return; }
          const { error } = await supabase.from("production_log").delete().eq("id", uuid);
          if (error) { toast.error(`تعذّر حذف السجل: ${error.message}`); return; }
          await get().hydrateFromSupabase();
        })();
        set((s) => ({ productionLogs: s.productionLogs.filter((p) => p.id !== id) }));
      },

      reset: () => set(initial()),
    })),
);


export function useCustomer(id: number) { return useStore((s) => s.customers.find((c) => c.id === id)); }
export function useMeter(id: number) { return useStore((s) => s.meters.find((m) => m.id === id)); }
export { calcConsumption };
