// Server-only assistant tool layer.
// كل الاستعلامات تتم على الخادم عبر عميل Supabase المصادَق (RLS مفعّل)،
// ولا يُسمح بـ SQL حر — فقط أدوات مقيّدة ومحددة المعاملات.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

// يمنع محلل الأنواع من تفسير سلاسل select (أداء typecheck)
const sel = (s: string): string => s;

const MAX_ROWS = 200;
const clampLimit = (n: unknown, def = 20): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.min(Math.max(v, 1), MAX_ROWS);
};
const isUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const dateOnly = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "");

export interface ToolTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export interface ToolResult {
  ok: boolean;
  data: unknown;
  table?: ToolTable;
}

const fail = (message: string): ToolResult => ({ ok: false, data: { error: message } });

// ─────────────────────────── أدوات المساعد ───────────────────────────
export const ASSISTANT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_customers",
      description:
        "البحث عن مشتركين بالاسم أو رقم الحساب (pay_account) أو رقم الهاتف أو رقم/سيريال العداد. يعيد المعرّف الحقيقي (UUID) لكل مشترك. استخدمها دائماً قبل أي أداة تحتاج customer_id.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "نص البحث: اسم أو جزء منه، رقم حساب، هاتف، أو رقم عداد" },
          limit: { type: "number", description: "أقصى عدد نتائج (افتراضي 10)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_overview",
      description:
        "ملف مشترك واحد: بياناته، عداده، رصيده الحالي (مصدر الحقيقة customer_balances)، إجمالي المفوتر والمدفوع والمتأخرات، آخر قراءة وآخر فاتورة وآخر دفعة.",
      parameters: {
        type: "object",
        properties: { customer_id: { type: "string", description: "UUID المشترك من search_customers" } },
        required: ["customer_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_customers",
      description:
        "قائمة المشتركين مع فلاتر وترتيب — للأسئلة الجماعية مثل: أعلى المديونين، المشتركون الجدد، المعلقون، مشتركو مديرية معينة.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "حالة المشترك مثل active أو suspended أو pending" },
          directorate: { type: "string", description: "اسم المديرية (بحث جزئي)" },
          min_balance: { type: "number", description: "أدنى رصيد مستحق" },
          created_from: { type: "string", description: "تاريخ إنشاء من (YYYY-MM-DD) — للمشتركين الجدد" },
          created_to: { type: "string", description: "تاريخ إنشاء إلى (YYYY-MM-DD)" },
          order_by: { type: "string", enum: ["balance", "name", "created_at"], description: "حقل الترتيب" },
          direction: { type: "string", enum: ["asc", "desc"] },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_bills",
      description: "قائمة الفواتير مع فلاتر (مشترك، حالة، مدى زمني) وترتيب زمني.",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string" },
          status: { type: "string", description: "paid أو unpaid أو partial أو issued" },
          unpaid_only: { type: "boolean", description: "الفواتير غير المسددة بالكامل فقط" },
          from: { type: "string", description: "من تاريخ الإصدار YYYY-MM-DD" },
          to: { type: "string", description: "إلى تاريخ الإصدار YYYY-MM-DD" },
          direction: { type: "string", enum: ["asc", "desc"] },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_payments",
      description: "قائمة المدفوعات/التحصيل مع فلاتر (مشترك، حالة، طريقة، مدى زمني).",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string" },
          status: { type: "string", description: "approved أو pending أو rejected" },
          method: { type: "string" },
          from: { type: "string", description: "من تاريخ الدفع YYYY-MM-DD" },
          to: { type: "string", description: "إلى تاريخ الدفع YYYY-MM-DD" },
          direction: { type: "string", enum: ["asc", "desc"] },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_readings",
      description: "قائمة قراءات العدادات مع فلاتر (مشترك، حالة، مدى زمني).",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string" },
          status: { type: "string", description: "approved أو pending أو rejected" },
          from: { type: "string", description: "من تاريخ القراءة YYYY-MM-DD" },
          to: { type: "string", description: "إلى تاريخ القراءة YYYY-MM-DD" },
          direction: { type: "string", enum: ["asc", "desc"] },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_summary_stats",
      description:
        "مؤشرات إجمالية للمنشأة خلال مدى زمني: عدد المشتركين، المفوتر، المحصّل، المتأخرات، نسبة التحصيل، الاستهلاك، الإنتاج والفاقد.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "من تاريخ YYYY-MM-DD" },
          to: { type: "string", description: "إلى تاريخ YYYY-MM-DD" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rank_customers",
      description:
        "ترتيب المشتركين حسب مقياس خلال مدى زمني: أعلى استهلاك، أعلى تحصيل/دفعات، أعلى متأخرات، أكثر تأخراً في السداد.",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: ["consumption", "payments", "arrears", "billed"],
            description: "المقياس المطلوب",
          },
          from: { type: "string" },
          to: { type: "string" },
          direction: { type: "string", enum: ["asc", "desc"] },
          limit: { type: "number" },
        },
        required: ["metric"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_meters",
      description: "بيانات العدادات وارتباطها بالمشتركين (بحث بالسيريال أو بمشترك محدد).",
      parameters: {
        type: "object",
        properties: {
          serial: { type: "string" },
          customer_id: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
] as const;

// ─────────────────────────── مساعدات داخلية ───────────────────────────
async function balancesFor(supabase: DB, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from("customer_balances")
    .select(sel("customer_id, current_balance"))
    .in("customer_id", ids)
    .returns<Array<{ customer_id: string; current_balance: number }>>();
  for (const r of data ?? []) map.set(r.customer_id, num(r.current_balance));
  return map;
}

async function metersFor(supabase: DB, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from("meter_assignments")
    .select(sel("customer_id, ended_at, meters(serial)"))
    .in("customer_id", ids)
    .is("ended_at", null)
    .returns<Array<{ customer_id: string; meters: { serial: string } | null }>>();
  for (const r of data ?? []) if (r.meters?.serial) map.set(r.customer_id, r.meters.serial);
  return map;
}

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  pay_account: string | null;
  directorate: string | null;
  status: string;
  balance: number;
  created_at: string;
}

async function decorateCustomers(supabase: DB, rows: CustomerRow[]) {
  const ids = rows.map((r) => r.id);
  const [bal, met] = await Promise.all([balancesFor(supabase, ids), metersFor(supabase, ids)]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone ?? "",
    pay_account: r.pay_account ?? "",
    directorate: r.directorate ?? "",
    status: r.status,
    meter_serial: met.get(r.id) ?? "",
    balance: bal.has(r.id) ? bal.get(r.id)! : num(r.balance),
    created_at: dateOnly(r.created_at),
  }));
}

const CUSTOMER_COLS = "id, name, phone, pay_account, directorate, status, balance, created_at";

function customersTable(title: string, list: Awaited<ReturnType<typeof decorateCustomers>>): ToolTable {
  return {
    title,
    columns: ["الاسم", "رقم الحساب", "الهاتف", "العداد", "المديرية", "الحالة", "الرصيد المستحق"],
    rows: list.map((c) => [c.name, c.pay_account, c.phone, c.meter_serial, c.directorate, c.status, c.balance]),
  };
}

// ─────────────────────────── منفّذ الأدوات ───────────────────────────
export async function runAssistantTool(
  supabase: DB,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "search_customers":
      return searchCustomers(supabase, args);
    case "get_customer_overview":
      return customerOverview(supabase, args);
    case "list_customers":
      return listCustomers(supabase, args);
    case "list_bills":
      return listBills(supabase, args);
    case "list_payments":
      return listPayments(supabase, args);
    case "list_readings":
      return listReadings(supabase, args);
    case "get_summary_stats":
      return summaryStats(supabase, args);
    case "rank_customers":
      return rankCustomers(supabase, args);
    case "get_meters":
      return getMeters(supabase, args);
    default:
      return fail(`أداة غير معروفة: ${name}`);
  }
}

async function searchCustomers(supabase: DB, args: Record<string, unknown>): Promise<ToolResult> {
  const raw = typeof args["query"] === "string" ? args["query"].trim() : "";
  if (raw.length < 2) return fail("نص البحث قصير جداً؛ اطلب من المستخدم اسماً أو رقماً أوضح.");
  const limit = clampLimit(args["limit"], 10);
  const q = raw.replace(/[%,()]/g, " ").trim();
  const like = `%${q}%`;

  const { data: direct, error } = await supabase
    .from("customers")
    .select(sel(CUSTOMER_COLS))
    .or(`name.ilike.${like},pay_account.ilike.${like},phone.ilike.${like}`)
    .limit(limit)
    .returns<CustomerRow[]>();
  if (error) return fail(error.message);

  const found = new Map<string, CustomerRow>();
  for (const r of direct ?? []) found.set(r.id, r);

  // البحث برقم/سيريال العداد
  if (found.size < limit) {
    const { data: meters } = await supabase
      .from("meters")
      .select(sel("id, serial"))
      .ilike("serial", like)
      .limit(limit)
      .returns<Array<{ id: string; serial: string }>>();
    const meterIds = (meters ?? []).map((m) => m.id);
    if (meterIds.length > 0) {
      const { data: asg } = await supabase
        .from("meter_assignments")
        .select(sel("customer_id, meter_id, ended_at"))
        .in("meter_id", meterIds)
        .is("ended_at", null)
        .returns<Array<{ customer_id: string }>>();
      const custIds = [...new Set((asg ?? []).map((a) => a.customer_id))].filter((id) => !found.has(id));
      if (custIds.length > 0) {
        const { data: more } = await supabase
          .from("customers")
          .select(sel(CUSTOMER_COLS))
          .in("id", custIds.slice(0, limit))
          .returns<CustomerRow[]>();
        for (const r of more ?? []) found.set(r.id, r);
      }
    }
  }

  const list = await decorateCustomers(supabase, [...found.values()].slice(0, limit));
  if (list.length === 0) {
    return {
      ok: true,
      data: {
        found: false,
        count: 0,
        matches: [],
        note: "لا يوجد مشترك مطابق. لا تعرض بيانات أي مشترك آخر؛ أخبر المستخدم بعدم العثور واطلب توضيحاً.",
      },
    };
  }
  return {
    ok: true,
    data: { found: true, count: list.length, matches: list },
    table: list.length > 1 ? customersTable("نتائج البحث", list) : undefined,
  };
}

async function customerOverview(supabase: DB, args: Record<string, unknown>): Promise<ToolResult> {
  const id = args["customer_id"];
  if (!isUuid(id)) return fail("customer_id يجب أن يكون UUID حقيقياً من search_customers.");

  const { data: cust, error } = await supabase
    .from("customers")
    .select(sel(CUSTOMER_COLS + ", address, family_members, security_deposit"))
    .eq("id", id)
    .maybeSingle()
    .returns<(CustomerRow & { address: string | null; family_members: number; security_deposit: number }) | null>();
  if (error) return fail(error.message);
  if (!cust) return { ok: true, data: { found: false, note: "المشترك غير موجود ضمن صلاحياتك." } };

  const [decorated] = await decorateCustomers(supabase, [cust]);

  const [{ data: bills }, { data: pays }, { data: reads }] = await Promise.all([
    supabase
      .from("water_bills")
      .select(sel("id, bill_number, issued_at, due_date, total, paid_amount, arrears, status"))
      .eq("customer_id", id)
      .order("issued_at", { ascending: false })
      .limit(MAX_ROWS)
      .returns<
        Array<{
          id: string; bill_number: string | null; issued_at: string; due_date: string | null;
          total: number; paid_amount: number; arrears: number; status: string;
        }>
      >(),
    supabase
      .from("payments")
      .select(sel("id, amount, paid_at, method, status"))
      .eq("customer_id", id)
      .order("paid_at", { ascending: false })
      .limit(MAX_ROWS)
      .returns<Array<{ id: string; amount: number; paid_at: string; method: string; status: string }>>(),
    supabase
      .from("water_readings")
      .select(sel("id, reading_date, current_reading, previous, consumption, status"))
      .eq("customer_id", id)
      .order("reading_date", { ascending: false })
      .limit(24)
      .returns<
        Array<{ id: string; reading_date: string; current_reading: number; previous: number | null; consumption: number | null; status: string }>
      >(),
  ]);

  const billList = bills ?? [];
  const payList = (pays ?? []).filter((p) => p.status === "approved");
  const readList = reads ?? [];

  const billed = billList.reduce((s, b) => s + num(b.total), 0);
  const paid = payList.reduce((s, p) => s + num(p.amount), 0);
  const unpaidBills = billList.filter((b) => num(b.total) - num(b.paid_amount) > 0.01);
  const outstanding = unpaidBills.reduce((s, b) => s + (num(b.total) - num(b.paid_amount)), 0);
  const consumption = readList.reduce((s, r) => s + num(r.consumption), 0);

  const lastBill = billList[0] ?? null;
  const lastPayment = payList[0] ?? null;
  const lastReading = readList[0] ?? null;

  return {
    ok: true,
    data: {
      found: true,
      customer: { ...decorated, address: cust.address ?? "", family_members: cust.family_members },
      balance_source: "customer_balances.current_balance",
      current_balance: decorated?.balance ?? 0,
      totals: {
        billed,
        paid,
        outstanding_from_bills: outstanding,
        bills_count: billList.length,
        unpaid_bills_count: unpaidBills.length,
        payments_count: payList.length,
        collection_pct: billed > 0 ? Math.round((paid / billed) * 100) : 0,
        consumption_last_readings: consumption,
      },
      last_bill: lastBill
        ? {
            bill_number: lastBill.bill_number,
            issued_at: dateOnly(lastBill.issued_at),
            due_date: dateOnly(lastBill.due_date),
            total: num(lastBill.total),
            paid_amount: num(lastBill.paid_amount),
            remaining: num(lastBill.total) - num(lastBill.paid_amount),
            status: lastBill.status,
          }
        : null,
      last_payment: lastPayment
        ? { date: dateOnly(lastPayment.paid_at), amount: num(lastPayment.amount), method: lastPayment.method }
        : null,
      last_reading: lastReading
        ? {
            date: dateOnly(lastReading.reading_date),
            current: num(lastReading.current_reading),
            previous: num(lastReading.previous),
            consumption: num(lastReading.consumption),
            status: lastReading.status,
          }
        : null,
      recent_bills: billList.slice(0, 6).map((b) => ({
        bill_number: b.bill_number,
        date: dateOnly(b.issued_at),
        total: num(b.total),
        paid: num(b.paid_amount),
        status: b.status,
      })),
      recent_payments: payList.slice(0, 6).map((p) => ({
        date: dateOnly(p.paid_at),
        amount: num(p.amount),
        method: p.method,
      })),
      recent_readings: readList.slice(0, 6).map((r) => ({
        date: dateOnly(r.reading_date),
        current: num(r.current_reading),
        consumption: num(r.consumption),
        status: r.status,
      })),
    },
    table: {
      title: `كشف حساب: ${cust.name}`,
      columns: ["البند", "القيمة"],
      rows: [
        ["الرصيد المستحق", decorated?.balance ?? 0],
        ["إجمالي المفوتر", billed],
        ["إجمالي المدفوع", paid],
        ["فواتير غير مسددة", unpaidBills.length],
        ["آخر قراءة", lastReading ? `${dateOnly(lastReading.reading_date)} — ${num(lastReading.current_reading)} م³` : "لا يوجد"],
        ["آخر دفعة", lastPayment ? `${dateOnly(lastPayment.paid_at)} — ${num(lastPayment.amount)}` : "لا يوجد"],
      ],
    },
  };
}

async function listCustomers(supabase: DB, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = clampLimit(args["limit"], 20);
  const orderBy = ["balance", "name", "created_at"].includes(String(args["order_by"]))
    ? String(args["order_by"])
    : "created_at";
  const asc = args["direction"] === "asc";

  let q = supabase.from("customers").select(sel(CUSTOMER_COLS));
  if (typeof args["status"] === "string" && args["status"]) q = q.eq("status", args["status"]);
  if (typeof args["directorate"] === "string" && args["directorate"])
    q = q.ilike("directorate", `%${args["directorate"]}%`);
  if (typeof args["min_balance"] === "number") q = q.gte("balance", args["min_balance"]);
  if (typeof args["created_from"] === "string") q = q.gte("created_at", args["created_from"]);
  if (typeof args["created_to"] === "string") q = q.lte("created_at", `${args["created_to"]}T23:59:59`);

  const { data, error } = await q
    .order(orderBy, { ascending: asc })
    .limit(limit)
    .returns<CustomerRow[]>();
  if (error) return fail(error.message);

  const list = await decorateCustomers(supabase, data ?? []);
  return {
    ok: true,
    data: { count: list.length, customers: list },
    table: list.length > 0 ? customersTable("قائمة المشتركين", list) : undefined,
  };
}

async function listBills(supabase: DB, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = clampLimit(args["limit"], 20);
  const asc = args["direction"] === "asc";
  let q = supabase
    .from("water_bills")
    .select(sel("id, bill_number, customer_id, issued_at, due_date, total, paid_amount, arrears, status, customers(name, pay_account)"));
  if (args["customer_id"] !== undefined) {
    if (!isUuid(args["customer_id"])) return fail("customer_id غير صالح.");
    q = q.eq("customer_id", args["customer_id"] as string);
  }
  if (typeof args["status"] === "string" && args["status"]) q = q.eq("status", args["status"]);
  if (typeof args["from"] === "string") q = q.gte("issued_at", args["from"]);
  if (typeof args["to"] === "string") q = q.lte("issued_at", `${args["to"]}T23:59:59`);

  const { data, error } = await q
    .order("issued_at", { ascending: asc })
    .limit(limit)
    .returns<
      Array<{
        id: string; bill_number: string | null; customer_id: string; issued_at: string; due_date: string | null;
        total: number; paid_amount: number; arrears: number; status: string;
        customers: { name: string; pay_account: string | null } | null;
      }>
    >();
  if (error) return fail(error.message);

  let rows = data ?? [];
  if (args["unpaid_only"] === true) rows = rows.filter((b) => num(b.total) - num(b.paid_amount) > 0.01);

  const list = rows.map((b) => ({
    bill_number: b.bill_number ?? "",
    customer_id: b.customer_id,
    customer_name: b.customers?.name ?? "",
    issued_at: dateOnly(b.issued_at),
    due_date: dateOnly(b.due_date),
    total: num(b.total),
    paid_amount: num(b.paid_amount),
    remaining: num(b.total) - num(b.paid_amount),
    status: b.status,
  }));

  return {
    ok: true,
    data: {
      count: list.length,
      total_amount: list.reduce((s, b) => s + b.total, 0),
      total_remaining: list.reduce((s, b) => s + b.remaining, 0),
      bills: list,
    },
    table:
      list.length > 0
        ? {
            title: "الفواتير",
            columns: ["رقم الفاتورة", "المشترك", "التاريخ", "الإجمالي", "المسدد", "المتبقي", "الحالة"],
            rows: list.map((b) => [b.bill_number, b.customer_name, b.issued_at, b.total, b.paid_amount, b.remaining, b.status]),
          }
        : undefined,
  };
}

async function listPayments(supabase: DB, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = clampLimit(args["limit"], 20);
  const asc = args["direction"] === "asc";
  let q = supabase
    .from("payments")
    .select(sel("id, customer_id, amount, paid_at, method, status, customers(name, pay_account)"));
  if (args["customer_id"] !== undefined) {
    if (!isUuid(args["customer_id"])) return fail("customer_id غير صالح.");
    q = q.eq("customer_id", args["customer_id"] as string);
  }
  if (typeof args["status"] === "string" && args["status"]) q = q.eq("status", args["status"]);
  if (typeof args["method"] === "string" && args["method"]) q = q.eq("method", args["method"]);
  if (typeof args["from"] === "string") q = q.gte("paid_at", args["from"]);
  if (typeof args["to"] === "string") q = q.lte("paid_at", `${args["to"]}T23:59:59`);

  const { data, error } = await q
    .order("paid_at", { ascending: asc })
    .limit(limit)
    .returns<
      Array<{
        id: string; customer_id: string | null; amount: number; paid_at: string; method: string; status: string;
        customers: { name: string; pay_account: string | null } | null;
      }>
    >();
  if (error) return fail(error.message);

  const list = (data ?? []).map((p) => ({
    customer_id: p.customer_id,
    customer_name: p.customers?.name ?? "",
    date: dateOnly(p.paid_at),
    amount: num(p.amount),
    method: p.method,
    status: p.status,
  }));

  return {
    ok: true,
    data: {
      count: list.length,
      total_amount: list.reduce((s, p) => s + p.amount, 0),
      approved_amount: list.filter((p) => p.status === "approved").reduce((s, p) => s + p.amount, 0),
      payments: list,
    },
    table:
      list.length > 0
        ? {
            title: "المدفوعات",
            columns: ["المشترك", "التاريخ", "المبلغ", "الطريقة", "الحالة"],
            rows: list.map((p) => [p.customer_name, p.date, p.amount, p.method, p.status]),
          }
        : undefined,
  };
}

async function listReadings(supabase: DB, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = clampLimit(args["limit"], 20);
  const asc = args["direction"] === "asc";
  let q = supabase
    .from("water_readings")
    .select(sel("id, customer_id, reading_date, current_reading, previous, consumption, status, flag, customers(name)"));
  if (args["customer_id"] !== undefined) {
    if (!isUuid(args["customer_id"])) return fail("customer_id غير صالح.");
    q = q.eq("customer_id", args["customer_id"] as string);
  }
  if (typeof args["status"] === "string" && args["status"]) q = q.eq("status", args["status"]);
  if (typeof args["from"] === "string") q = q.gte("reading_date", args["from"]);
  if (typeof args["to"] === "string") q = q.lte("reading_date", `${args["to"]}T23:59:59`);

  const { data, error } = await q
    .order("reading_date", { ascending: asc })
    .limit(limit)
    .returns<
      Array<{
        customer_id: string; reading_date: string; current_reading: number; previous: number | null;
        consumption: number | null; status: string; flag: string | null; customers: { name: string } | null;
      }>
    >();
  if (error) return fail(error.message);

  const list = (data ?? []).map((r) => ({
    customer_id: r.customer_id,
    customer_name: r.customers?.name ?? "",
    date: dateOnly(r.reading_date),
    current: num(r.current_reading),
    previous: num(r.previous),
    consumption: num(r.consumption),
    status: r.status,
    flag: r.flag ?? "",
  }));

  return {
    ok: true,
    data: { count: list.length, total_consumption: list.reduce((s, r) => s + r.consumption, 0), readings: list },
    table:
      list.length > 0
        ? {
            title: "القراءات",
            columns: ["المشترك", "التاريخ", "القراءة الحالية", "السابقة", "الاستهلاك م³", "الحالة"],
            rows: list.map((r) => [r.customer_name, r.date, r.current, r.previous, r.consumption, r.status]),
          }
        : undefined,
  };
}

async function summaryStats(supabase: DB, args: Record<string, unknown>): Promise<ToolResult> {
  const from = typeof args["from"] === "string" ? args["from"] : null;
  const to = typeof args["to"] === "string" ? `${args["to"]}T23:59:59` : null;

  let billsQ = supabase.from("water_bills").select(sel("total, paid_amount, status, issued_at"));
  if (from) billsQ = billsQ.gte("issued_at", from);
  if (to) billsQ = billsQ.lte("issued_at", to);

  let paysQ = supabase.from("payments").select(sel("amount, status, paid_at"));
  if (from) paysQ = paysQ.gte("paid_at", from);
  if (to) paysQ = paysQ.lte("paid_at", to);

  let readsQ = supabase.from("water_readings").select(sel("consumption, status, reading_date"));
  if (from) readsQ = readsQ.gte("reading_date", from);
  if (to) readsQ = readsQ.lte("reading_date", to);

  let prodQ = supabase.from("production_log").select(sel("produced_m3, logged_at"));
  if (from) prodQ = prodQ.gte("logged_at", from);
  if (to) prodQ = prodQ.lte("logged_at", to);

  const [billsR, paysR, readsR, prodR, custR, balR, unpaidR] = await Promise.all([
    billsQ.limit(5000).returns<Array<{ total: number; paid_amount: number; status: string }>>(),
    paysQ.limit(5000).returns<Array<{ amount: number; status: string }>>(),
    readsQ.limit(5000).returns<Array<{ consumption: number | null; status: string }>>(),
    prodQ.limit(5000).returns<Array<{ produced_m3: number }>>(),
    supabase.from("customers").select(sel("id, status, balance")).limit(5000)
      .returns<Array<{ id: string; status: string; balance: number }>>(),
    supabase.from("customer_balances").select(sel("customer_id, current_balance")).limit(5000)
      .returns<Array<{ customer_id: string; current_balance: number }>>(),
    supabase.from("water_bills").select(sel("total, paid_amount, status")).neq("status", "paid").limit(5000)
      .returns<Array<{ total: number; paid_amount: number; status: string }>>(),
  ]);

  const bills = billsR.data ?? [];
  const pays = (paysR.data ?? []).filter((p) => p.status === "approved");
  const reads = (readsR.data ?? []).filter((r) => r.status === "approved");
  const billed = bills.reduce((s, b) => s + num(b.total), 0);
  const collected = pays.reduce((s, p) => s + num(p.amount), 0);
  const consumed = reads.reduce((s, r) => s + num(r.consumption), 0);
  const produced = (prodR.data ?? []).reduce((s, p) => s + num(p.produced_m3), 0);
  const customers = custR.data ?? [];
  // مصدر الحقيقة للأرصدة: سجل customer_balances، ومع غيابه المتبقي على الفواتير غير المسددة (نفس منطق لوحة المؤشرات)
  const ledgerTotal = (balR.data ?? []).reduce((s, b) => s + Math.max(num(b.current_balance), 0), 0);
  const unpaidTotal = (unpaidR.data ?? []).reduce(
    (s, b) => s + Math.max(num(b.total) - num(b.paid_amount), 0),
    0,
  );
  const outstanding = ledgerTotal > 0 ? ledgerTotal : unpaidTotal;


  const stats = {
    range: { from: from ?? "منذ البداية", to: to ? dateOnly(to) : "حتى الآن" },
    customers_total: customers.length,
    customers_active: customers.filter((c) => c.status === "active").length,
    bills_count: bills.length,
    billed_amount: billed,
    collected_amount: collected,
    payments_count: pays.length,
    outstanding_total: outstanding,
    collection_pct: billed > 0 ? Math.round((collected / billed) * 100) : 0,
    consumption_m3: consumed,
    produced_m3: produced,
    loss_m3: produced - consumed,
    loss_pct: produced > 0 ? Math.round(((produced - consumed) / produced) * 100) : 0,
  };

  return {
    ok: true,
    data: stats,
    table: {
      title: "المؤشرات الإجمالية",
      columns: ["المؤشر", "القيمة"],
      rows: [
        ["عدد المشتركين", stats.customers_total],
        ["النشطون", stats.customers_active],
        ["إجمالي المفوتر", stats.billed_amount],
        ["إجمالي المحصّل", stats.collected_amount],
        ["إجمالي المتأخرات", stats.outstanding_total],
        ["نسبة التحصيل %", stats.collection_pct],
        ["الاستهلاك م³", stats.consumption_m3],
        ["الإنتاج م³", stats.produced_m3],
        ["الفاقد م³", stats.loss_m3],
        ["نسبة الفاقد %", stats.loss_pct],
      ],
    },
  };
}

async function rankCustomers(supabase: DB, args: Record<string, unknown>): Promise<ToolResult> {
  const metric = String(args["metric"] ?? "arrears");
  const limit = clampLimit(args["limit"], 10);
  const asc = args["direction"] === "asc";
  const from = typeof args["from"] === "string" ? args["from"] : null;
  const to = typeof args["to"] === "string" ? `${args["to"]}T23:59:59` : null;

  const totals = new Map<string, number>();
  const add = (id: string | null, v: number) => {
    if (!id) return;
    totals.set(id, (totals.get(id) ?? 0) + v);
  };

  if (metric === "consumption") {
    let q = supabase.from("water_readings").select(sel("customer_id, consumption, status, reading_date"));
    if (from) q = q.gte("reading_date", from);
    if (to) q = q.lte("reading_date", to);
    const { data, error } = await q
      .limit(5000)
      .returns<Array<{ customer_id: string; consumption: number | null; status: string }>>();
    if (error) return fail(error.message);
    for (const r of data ?? []) if (r.status === "approved") add(r.customer_id, num(r.consumption));
  } else if (metric === "payments") {
    let q = supabase.from("payments").select(sel("customer_id, amount, status, paid_at"));
    if (from) q = q.gte("paid_at", from);
    if (to) q = q.lte("paid_at", to);
    const { data, error } = await q
      .limit(5000)
      .returns<Array<{ customer_id: string | null; amount: number; status: string }>>();
    if (error) return fail(error.message);
    for (const p of data ?? []) if (p.status === "approved") add(p.customer_id, num(p.amount));
  } else if (metric === "billed") {
    let q = supabase.from("water_bills").select(sel("customer_id, total, issued_at"));
    if (from) q = q.gte("issued_at", from);
    if (to) q = q.lte("issued_at", to);
    const { data, error } = await q.limit(5000).returns<Array<{ customer_id: string; total: number }>>();
    if (error) return fail(error.message);
    for (const b of data ?? []) add(b.customer_id, num(b.total));
  } else {
    const [{ data: bal }, { data: unpaid }] = await Promise.all([
      supabase
        .from("customer_balances")
        .select(sel("customer_id, current_balance"))
        .limit(5000)
        .returns<Array<{ customer_id: string; current_balance: number }>>(),
      supabase
        .from("water_bills")
        .select(sel("customer_id, total, paid_amount, status"))
        .neq("status", "paid")
        .limit(5000)
        .returns<Array<{ customer_id: string; total: number; paid_amount: number }>>(),
    ]);
    const ledgerRows = (bal ?? []).filter((b) => num(b.current_balance) > 0);
    if (ledgerRows.length > 0) {
      for (const b of ledgerRows) add(b.customer_id, num(b.current_balance));
    } else {
      for (const b of unpaid ?? []) {
        const rest = num(b.total) - num(b.paid_amount);
        if (rest > 0) add(b.customer_id, rest);
      }
    }
  }


  const ranked = [...totals.entries()]
    .sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1]))
    .slice(0, limit);
  if (ranked.length === 0) return { ok: true, data: { count: 0, ranking: [], note: "لا توجد بيانات في هذا المدى." } };

  const ids = ranked.map(([id]) => id);
  const { data: custs } = await supabase
    .from("customers")
    .select(sel(CUSTOMER_COLS))
    .in("id", ids)
    .returns<CustomerRow[]>();
  const byId = new Map((custs ?? []).map((c) => [c.id, c]));
  const met = await metersFor(supabase, ids);

  const metricLabel =
    metric === "consumption" ? "الاستهلاك م³" : metric === "payments" ? "المدفوع" : metric === "billed" ? "المفوتر" : "الرصيد المستحق";

  const list = ranked.map(([id, value], i) => ({
    rank: i + 1,
    customer_id: id,
    name: byId.get(id)?.name ?? "",
    pay_account: byId.get(id)?.pay_account ?? "",
    meter_serial: met.get(id) ?? "",
    value,
  }));

  return {
    ok: true,
    data: { metric, count: list.length, ranking: list },
    table: {
      title: `ترتيب المشتركين — ${metricLabel}`,
      columns: ["#", "المشترك", "رقم الحساب", "العداد", metricLabel],
      rows: list.map((r) => [r.rank, r.name, r.pay_account, r.meter_serial, r.value]),
    },
  };
}

async function getMeters(supabase: DB, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = clampLimit(args["limit"], 20);
  if (args["customer_id"] !== undefined) {
    if (!isUuid(args["customer_id"])) return fail("customer_id غير صالح.");
    const { data, error } = await supabase
      .from("meter_assignments")
      .select(sel("started_at, ended_at, meters(serial, meter_type, status, size, installed_at, initial_index)"))
      .eq("customer_id", args["customer_id"] as string)
      .order("started_at", { ascending: false })
      .limit(limit)
      .returns<
        Array<{
          started_at: string; ended_at: string | null;
          meters: { serial: string; meter_type: string; status: string; size: string | null; installed_at: string | null; initial_index: number } | null;
        }>
      >();
    if (error) return fail(error.message);
    const list = (data ?? []).map((a) => ({
      serial: a.meters?.serial ?? "",
      type: a.meters?.meter_type ?? "",
      status: a.meters?.status ?? "",
      size: a.meters?.size ?? "",
      started_at: dateOnly(a.started_at),
      ended_at: dateOnly(a.ended_at),
      active: a.ended_at === null,
    }));
    return { ok: true, data: { count: list.length, meters: list } };
  }

  let q = supabase.from("meters").select(sel("serial, meter_type, status, size, installed_at"));
  if (typeof args["serial"] === "string" && args["serial"]) q = q.ilike("serial", `%${args["serial"]}%`);
  if (typeof args["status"] === "string" && args["status"]) q = q.eq("status", args["status"]);
  const { data, error } = await q
    .limit(limit)
    .returns<Array<{ serial: string; meter_type: string; status: string; size: string | null; installed_at: string | null }>>();
  if (error) return fail(error.message);
  const list = data ?? [];
  return {
    ok: true,
    data: { count: list.length, meters: list },
    table:
      list.length > 0
        ? {
            title: "العدادات",
            columns: ["السيريال", "النوع", "الحالة", "المقاس", "تاريخ التركيب"],
            rows: list.map((m) => [m.serial, m.meter_type, m.status, m.size ?? "", dateOnly(m.installed_at)]),
          }
        : undefined,
  };
}
