import { useStore, billBalance, type Customer, type Bill, type Payment, type Reading } from "./store";
import { fmtYER, fmtNum } from "./pricing";
import { lookupCustomer, extractMeterToken } from "./assistant/customer-lookup";
import { setContext, getContext, setCustomerContext, setDisambiguation } from "./assistant/conversation-context";

// ─── Legacy Chat Context API (preserved for backward compat) ─────────
export function setChatContext(c: Partial<{ lastCustomer: Customer | null; lastMeterNumber: string | null; lastBillId: number | null }>) {
  if (c.lastCustomer) setContext({ currentCustomer: c.lastCustomer });
  if (c.lastMeterNumber !== undefined) setContext({ currentMeterNumber: c.lastMeterNumber });
}
export function resetChatContext() {
  setContext({ currentCustomer: null, currentMeterNumber: null, currentBill: null, currentReading: null, currentReport: null, lastDisambiguation: null, currentRanking: null, currentTimeRange: null });
}
export function getChatContext() {
  const c = getContext();
  return { lastCustomer: c.currentCustomer, lastMeterNumber: c.currentMeterNumber, lastBillId: c.currentBill?.id ?? null };
}

// ─── Response Types ──────────────────────────────────────────────────
export type AiResponse =
  | { kind: "text"; text: string; suggestions?: string[] }
  | { kind: "suggestions"; text: string; suggestions: string[] }
  | {
      kind: "disambiguation";
      text: string;
      customers: Array<{ id: number; name: string; meterNumber?: string; phone: string; directorate?: string; status?: string; balance?: number }>;
    }
  | {
      kind: "subscriber_ledger";
      customer: { id: number; name: string; phone: string; pay_account: string; directorate?: string };
      totals: { paid: number; arrears: number; billed: number };
      series: Array<{ label: string; consumption: number; amount: number }>;
    }
  | {
      kind: "account_statement";
      customer: {
        id: number; name: string; phone: string; pay_account: string;
        directorate?: string; status?: string; meterNumber?: string;
      };
      totals: { billed: number; paid: number; arrears: number; balance: number };
      stats: { billCount: number; paidCount: number; unpaidCount: number; avgConsumption: number; collectionPct: number; highestBill: number; lowestBill: number };
      lastReading: { date: string; current: number; consumption: number } | null;
      readings: Array<{ id: number; date: string; current: number; previous: number; consumption: number; status: string }>;
      monthlyConsumption: Array<{ month: string; consumption: number }>;
      bills: Array<{ id: number; serial: string; date: string; consumption: number; total: number; paid: number; status: string; }>;
      payments: Array<{ id: number; date: string; amount: number; method: string; status: string; }>;
      timeline: Array<{ date: string; type: "reading" | "bill" | "payment"; description: string; amount?: number; }>;
    }
  | {
      kind: "loss_analysis";
      range: { from: string; to: string };
      water: { produced: number; consumed: number; loss: number; pct: number };
      electric: { produced: number; consumed: number; loss: number; pct: number };
      alerts: string[];
    }
  | {
      kind: "payment_status";
      paid: Array<{ id: number; name: string; serial: string; total: number }>;
      unpaid: Array<{ id: number; name: string; serial: string; total: number; balance: number }>;
    }
  | {
      kind: "revenue_report";
      range: { from: string; to: string; label: string };
      totals: { cash: number; bank: number; total: number; count: number; avg: number };
      series: Array<{ day: string; cash: number; bank: number; total: number }>;
      suggestions?: string[];
    }
  | {
      kind: "clarification";
      text: string;
      options: Array<{ label: string; query: string }>;
    };

// ─── Helpers ─────────────────────────────────────────────────────────
function todayRange() { const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); return { start, end: start + 86400000, label: "اليوم" }; }
function monthRange() { const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); return { start, end, label: "هذا الشهر" }; }
function yearRange() { const d = new Date(); const start = new Date(d.getFullYear(), 0, 1).getTime(); const end = new Date(d.getFullYear() + 1, 0, 1).getTime(); return { start, end, label: "هذه السنة" }; }
function weekRange() { const now = new Date(); const start = now.getTime() - 7 * 86400000; return { start, end: now.getTime(), label: "آخر 7 أيام" }; }
function iso(t: number) { return new Date(t).toISOString().slice(0, 10); }

function resolveCustomer(query: string, requireContext = true): { customer: Customer } | { disambiguation: AiResponse } | { none: AiResponse } {
  const s = useStore.getState();
  let searchQuery = query;
  const stripped = query.replace(/(?:استعلام عن مشترك|كشف حساب|اعرض حساب|كشف الحساب|بيان حساب|تفاصيل المشترك|اعرض تفاصيل|اعرض حساب المشترك)\s*/i, "").replace(/(?:عن\s+مشترك|مشترك|حساب|المشترك)\s+/i, "").replace(/[?؟]/g, "").trim();
  if (stripped && stripped.length < query.length) searchQuery = stripped;

  const result = lookupCustomer(searchQuery);
  if (result.kind === "single") return { customer: result.customer };
  if (result.kind === "multiple") {
    setDisambiguation(result.customers);
    const lines = result.customers.map((c, i) => { const m = s.meters.find((x) => x.customer_id === c.id); return `${i + 1}. ${c.name}${m ? ` (${m.number})` : ""} — ${c.phone}`; });
    const customersData = result.customers.map((c) => { const m = s.meters.find((x) => x.customer_id === c.id); return { id: c.id, name: c.name, meterNumber: m?.number, phone: c.phone, directorate: c.directorate, status: c.status, balance: c.balance ?? 0 }; });
    return { disambiguation: { kind: "disambiguation", text: `وجدت ${result.customers.length} مشتركين مطابقين:\n${lines.join("\n")}\nاختر أحدهم بكتابة رقمه.`, customers: customersData } };
  }
  if (requireContext) { const ctx = getContext(); if (ctx.currentCustomer) return { customer: ctx.currentCustomer }; const partial = s.customers.find((c) => query.includes(c.name.split(/\s+/)[0])); if (partial) return { customer: partial }; }
  return { none: { kind: "suggestions", text: "حدد المشترك — اكتب اسمه أو رقم عداده:", suggestions: s.customers.slice(0, 6).map((c) => `استعلام عن مشترك ${c.name}`) } };
}

function getCustomerBills(customerId: number): Bill[] { return useStore.getState().bills.filter((b) => b.customer_id === customerId).sort((a, b) => +new Date(a.date) - +new Date(b.date)); }
function getCustomerPayments(customerId: number, customerBills: Bill[]): Payment[] { return useStore.getState().payments.filter((p) => customerBills.some((b) => b.id === p.bill_id)).sort((a, b) => +new Date(a.date) - +new Date(b.date)); }
function getCustomerReadings(customerId: number): Reading[] { const s = useStore.getState(); return s.readings.filter((r) => s.meters.some((m) => m.id === r.meter_id && m.customer_id === customerId)).sort((a, b) => +new Date(b.date) - +new Date(a.date)); }

function buildAccountStatement(customer: Customer): AiResponse {
  const s = useStore.getState();
  const meter = s.meters.find((m) => m.customer_id === customer.id);
  const customerBills = getCustomerBills(customer.id);
  const customerPayments = getCustomerPayments(customer.id, customerBills);
  const customerReadings = getCustomerReadings(customer.id);
  const paid = customerPayments.filter((p) => p.status === "approved").reduce((a, p) => a + p.amount, 0);
  const billed = customerBills.reduce((a, b) => a + b.total, 0);
  const arrears = customer.balance !== undefined ? customer.balance : customerBills.reduce((a, b) => a + billBalance(b, s.payments), 0);
  const lastReading = customerReadings.length > 0 ? { date: customerReadings[0].date, current: customerReadings[0].current, consumption: customerReadings[0].consumption } : null;
  const billCount = customerBills.length;
  const paidCount = customerBills.filter((b) => b.status === "paid").length;
  const unpaidCount = customerBills.filter((b) => b.status !== "paid").length;
  const avgConsumption = customerReadings.length > 0 ? Math.round(customerReadings.reduce((a, r) => a + r.consumption, 0) / customerReadings.length) : 0;
  const collectionPct = billed > 0 ? Math.round((paid / billed) * 100) : 0;
  const highestBill = customerBills.length > 0 ? Math.max(...customerBills.map((b) => b.total)) : 0;
  const lowestBill = customerBills.length > 0 ? Math.min(...customerBills.map((b) => b.total)) : 0;
  const monthlyMap = new Map<string, number>();
  customerReadings.forEach((r) => { const key = new Date(r.date).toISOString().slice(0, 7); monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + r.consumption); });
  const monthlyConsumption = [...monthlyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, consumption]) => ({ month: month.slice(5), consumption }));
  const readingRows = customerReadings.slice(0, 20).map((r) => ({ id: r.id, date: r.date, current: r.current, previous: r.previous, consumption: r.consumption, status: r.status }));
  const billsRows = customerBills.map((b) => { const r = s.readings.find((x) => x.id === b.reading_id); return { id: b.id, serial: b.serial, date: b.date, consumption: r?.consumption ?? 0, total: b.total, paid: b.paid ?? 0, status: b.status }; });
  const paymentRows = customerPayments.map((p) => ({ id: p.id, date: p.date, amount: p.amount, method: p.method, status: p.status }));
  const timeline: Array<{ date: string; type: "reading" | "bill" | "payment"; description: string; amount?: number }> = [
    ...customerReadings.map((r) => ({ date: r.date, type: "reading" as const, description: `قراءة: ${fmtNum(r.current)} — استهلاك ${fmtNum(r.consumption)} م³` })),
    ...customerBills.map((b) => ({ date: b.date, type: "bill" as const, description: `فاتورة ${b.serial} — ${fmtYER(b.total)}`, amount: b.total })),
    ...customerPayments.map((p) => ({ date: p.date, type: "payment" as const, description: `دفعة ${p.method === "cash" ? "نقدي" : p.method === "wallet" ? "الكريمي" : "تحويل"} — ${fmtYER(p.amount)}`, amount: p.amount })),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date));

  return { kind: "account_statement", customer: { id: customer.id, name: customer.name, phone: customer.phone, pay_account: customer.pay_account, directorate: customer.directorate, status: customer.status, meterNumber: meter?.number }, totals: { billed, paid, arrears, balance: customer.balance ?? arrears }, stats: { billCount, paidCount, unpaidCount, avgConsumption, collectionPct, highestBill, lowestBill }, lastReading, readings: readingRows, monthlyConsumption, bills: billsRows, payments: paymentRows, timeline: timeline.slice(0, 30) };
}

// ─── Intent Matching ─────────────────────────────────────────────────
export function answerQuestion(q: string): AiResponse {
  const text = q.trim();

  // ── 0) Compound questions: split by "ثم" / "و" ────────────────────
  if (text.includes("ثم") || (text.includes(" و ") && text.length > 15)) {
    const parts = text.split(/\s+ثم\s+|\s+و\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      if (parts[0].includes("أكثر") || parts[0].includes("تأخر")) {
        const r1 = answerQuestionSingle(parts[0]);
        if (parts[1].includes("الثاني") || parts[1].includes("ثاني")) return answerQuestionSingle(parts[1]);
        if (parts[1].includes("الأول") || parts[1].includes("اول")) return answerQuestionSingle(parts[1]);
        return r1;
      }
      const r1 = answerQuestionSingle(parts[0]);
      const r2 = answerQuestionSingle(parts[1]);
      const t1 = r1.kind === "text" ? r1.text : r1.kind === "suggestions" ? r1.text : "";
      const t2 = r2.kind === "text" ? r2.text : r2.kind === "suggestions" ? r2.text : "";
      if (t1 && t2) return { kind: "text", text: `${t1}\n\n───\n\n${t2}`, suggestions: r2.kind === "text" ? r2.suggestions : undefined };
      if (r1.kind !== "text" && r1.kind !== "suggestions") return r1;
      if (r2.kind !== "text" && r2.kind !== "suggestions") return r2;
      return r1;
    }
  }

  return answerQuestionSingle(text);
}

function answerQuestionSingle(text: string): AiResponse {
  const s = useStore.getState();
  const has = (...kws: string[]) => kws.some((k) => text.includes(k));
  const ctx = getContext();

  // 0a) Disambiguation selection
  const numMatch = text.match(/^(?:اختر\s+)?(\d+)$/);
  if (numMatch && ctx.lastDisambiguation) { const idx = parseInt(numMatch[1], 10) - 1; if (idx >= 0 && idx < ctx.lastDisambiguation.length) { const c = ctx.lastDisambiguation[idx]; setContext({ lastDisambiguation: null }); setCustomerContext(c); return buildAccountStatement(c); } }
  if (has("اول واحد", "الأول", "الاول") && ctx.lastDisambiguation && ctx.lastDisambiguation.length > 0) { const c = ctx.lastDisambiguation[0]; setContext({ lastDisambiguation: null }); setCustomerContext(c); return buildAccountStatement(c); }
  if (has("الثاني", "ثاني واحد") && ctx.lastDisambiguation && ctx.lastDisambiguation.length > 1) { const c = ctx.lastDisambiguation[1]; setContext({ lastDisambiguation: null }); setCustomerContext(c); return buildAccountStatement(c); }
  if (has("الثالث", "ثالث واحد") && ctx.lastDisambiguation && ctx.lastDisambiguation.length > 2) { const c = ctx.lastDisambiguation[2]; setContext({ lastDisambiguation: null }); setCustomerContext(c); return buildAccountStatement(c); }

  // 0b) Context action: "اطبعه" / "طباعة"
  if (has("اطبع", "اطبعه", "طباعة", "اصدار", "اصدر", "اطبعها")) {
    if (ctx.currentCustomer) { const stmt = buildAccountStatement(ctx.currentCustomer); setContext({ currentReport: "account_statement" }); return stmt; }
    return { kind: "clarification", text: "لا يوجد كشف حساب نشط حالياً. ماذا تريد أن تطبع؟", options: [
      { label: "البحث عن مشترك لطباعة كشف حسابه", query: "استعلام عن مشترك" },
      { label: "تقرير التحصيل", query: "استعلام عن التحصيل اليوم" },
      { label: "تحليل الفاقد", query: "تحليل الفاقد لهذا الشهر" },
    ] };
  }

  // 0c) "افتح حسابه" / "اعرض الحساب"
  if (has("افتح حساب", "افتح كشف", "اعرض حسابه", "افتح الكشف", "اعرض الحساب", "اعرض حساب")) {
    const stripped = text.replace(/(?:اعرض|افتح|عرض)\s*(?:الحساب|حساب|كشف|الكشف)\s*/i, "").trim();
    if (stripped && stripped.length > 2) {
      const resolved = resolveCustomer(text, false);
      if ("customer" in resolved) { const meter = s.meters.find((m) => m.customer_id === resolved.customer.id); setCustomerContext(resolved.customer, meter?.number); setContext({ currentReport: "account_statement" }); return buildAccountStatement(resolved.customer); }
      if ("disambiguation" in resolved) return resolved.disambiguation;
    }
    if (ctx.currentCustomer) return buildAccountStatement(ctx.currentCustomer);
    return { kind: "clarification", text: "أي حساب تقصد؟", options: [
      { label: "البحث باسم المشترك", query: "استعلام عن مشترك" },
      { label: "البحث برقم العداد", query: "استعلام عن مشترك برقم العداد" },
    ] };
  }

  // 0d) "اعرض اول واحد" after debt ranking — works with both lastDisambiguation and currentRanking
  if (has("اعرض اول", "اعرض الأول", "افتح اول", "افتح الأول", "عرض الاول") && ((ctx.currentRanking && ctx.currentRanking.length > 0) || (ctx.lastDisambiguation && ctx.lastDisambiguation.length > 0))) { const list = ctx.currentRanking ?? ctx.lastDisambiguation!; const c = list[0]; setContext({ currentRanking: null, lastDisambiguation: null }); setCustomerContext(c); return buildAccountStatement(c); }
  if (has("اعرض الثاني", "افتح الثاني") && ((ctx.currentRanking && ctx.currentRanking.length > 1) || (ctx.lastDisambiguation && ctx.lastDisambiguation.length > 1))) { const list = ctx.currentRanking ?? ctx.lastDisambiguation!; const c = list[1]; setContext({ currentRanking: null, lastDisambiguation: null }); setCustomerContext(c); return buildAccountStatement(c); }
  if (has("اعرض الثالث", "افتح الثالث") && ((ctx.currentRanking && ctx.currentRanking.length > 2) || (ctx.lastDisambiguation && ctx.lastDisambiguation.length > 2))) { const list = ctx.currentRanking ?? ctx.lastDisambiguation!; const c = list[2]; setContext({ currentRanking: null, lastDisambiguation: null }); setCustomerContext(c); return buildAccountStatement(c); }
  if (has("اعرض الرابع", "افتح الرابع") && ((ctx.currentRanking && ctx.currentRanking.length > 3) || (ctx.lastDisambiguation && ctx.lastDisambiguation.length > 3))) { const list = ctx.currentRanking ?? ctx.lastDisambiguation!; const c = list[3]; setContext({ currentRanking: null, lastDisambiguation: null }); setCustomerContext(c); return buildAccountStatement(c); }
  if (has("اعرض الخامس", "افتح الخامس") && ((ctx.currentRanking && ctx.currentRanking.length > 4) || (ctx.lastDisambiguation && ctx.lastDisambiguation.length > 4))) { const list = ctx.currentRanking ?? ctx.lastDisambiguation!; const c = list[4]; setContext({ currentRanking: null, lastDisambiguation: null }); setCustomerContext(c); return buildAccountStatement(c); }

  // 1) Summary stats
  if (has("عدد المشترك", "كم عدد", "كم المشترك", "عدد المشتركين", "كم مشترك", "إجمالي المشتركين", "كم عدد المشتركين")) { const count = s.counts.customers || s.customers.length; const active = s.customers.filter((c) => c.status === "active").length; return { kind: "text", text: `عدد المشتركين الإجمالي: ${fmtNum(count)} مشترك، منهم ${fmtNum(active)} نشط.`, suggestions: ["كم إجمالي الديون؟", "ما أكثر المشتركين تأخراً؟", "كم تم تحصيله هذا الشهر؟"] }; }
  if (has("إجمالي الديون", "إجمالي الدين", "كم الدين", "كل الديون", "مجموع الديون", "إجمالي المتأخرات", "كم المديونيات", "إجمالي المديونيات", "مجموع المتأخرات", "كم المتأخرات", "إجمالي المطلوب")) { const totalDebt = s.customers.reduce((a, c) => a + (c.balance ?? 0), 0); const debtors = s.customers.filter((c) => (c.balance ?? 0) > 0).length; return { kind: "text", text: `إجمالي الديون المستحقة: ${fmtYER(totalDebt)} على ${fmtNum(debtors)} مشترك.`, suggestions: ["ما أكثر المشتركين تأخراً؟", "كم عدد المشتركين؟", "كم تم تحصيله هذا الشهر؟"] }; }
  if (has("أكثر المشتركين تأخر", "الأكثر تأخراً", "الأكثر ديناً", "أكثر المديونين", "أكبر الديون", "أعلى الديون", "أكبر المتأخرين", "الأكثر مديونية", "أعلى المتأخرات", "كبار المديونين", "اكبر دين", "اعلى دين")) {
    const top = [...s.customers].filter((c) => (c.balance ?? 0) > 0).sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0)).slice(0, 10);
    if (top.length === 0) return { kind: "text", text: "لا توجد متأخرات حالياً — جميع المشتركين سددوا مستحقاتهم." };
    setDisambiguation(top);
    setContext({ currentRanking: top, currentTimeRange: null });
    const lines = top.map((c, i) => { const m = s.meters.find((x) => x.customer_id === c.id); return `${i + 1}. ${c.name}${m ? ` (${m.number})` : ""} — ${fmtYER(c.balance ?? 0)}`; });
    return { kind: "text", text: `أكثر المشتركين تأخراً بالسداد:\n${lines.join("\n")}\n\nاكتب "اعرض الأول" لفتح كشف حساب صاحب أعلى دين.`, suggestions: ["اعرض الأول", "كم إجمالي الديون؟", "استعلام عن التحصيل اليوم"] };
  }
  if (has("إنتاج المياه", "كم إنتاج", "إنتاج اليوم", "كم أنتج", "كم الإنتاج", "كم الضخ", "حجم الإنتاج", "كم ماء", "كم مياه", "حجم الضخ", "إنتاج الماء")) { const range = has("اليوم") ? todayRange() : has("أسبوع", "اسبوع") ? weekRange() : has("سنة", "السنة") ? yearRange() : monthRange(); const produced = s.productionLogs.filter((p) => p.type === "water" && +new Date(p.date) >= range.start && +new Date(p.date) < range.end).reduce((a, b) => a + b.units, 0); const consumed = s.readings.filter((r) => r.status !== "rejected" && +new Date(r.date) >= range.start && +new Date(r.date) < range.end).reduce((a, b) => a + Math.max(0, b.consumption), 0); const loss = Math.max(0, produced - consumed); const pct = produced > 0 ? (loss / produced) * 100 : 0; return { kind: "text", text: `إنتاج المياه ${range.label}: ${fmtNum(Math.round(produced))} م³\nالاستهلاك المُفوتر: ${fmtNum(Math.round(consumed))} م³\nالفاقد: ${fmtNum(Math.round(loss))} م³ (${pct.toFixed(1)}%)`, suggestions: ["تحليل الفاقد لهذا الشهر", "كم عدد المشتركين؟", "كم تم تحصيله هذا الشهر؟"] }; }

  // 1.5) Balance synonyms
  if (has("كم عليه", "كم باقي", "كم المتأخر", "كم المطلوب", "رصيده", "ديونه", "كم المتبقي", "كم المتبقى", "كم بقي", "كم تبقى", "كم مستحق", "هل عليه", "المطلوب", "المستحق", "المديونية", "مديونية", "كم ديونه", "كم رصيده", "كم عليه دين", "دين")) {
    const meterToken = extractMeterToken(text);
    let resolved: { customer: Customer } | { disambiguation: AiResponse } | { none: AiResponse };
    if (meterToken) resolved = resolveCustomer(meterToken, false); else { const hasName = s.customers.some((c) => text.includes(c.name.split(/\s+/)[0])); resolved = hasName ? resolveCustomer(text, false) : { none: { kind: "suggestions", text: "", suggestions: [] } }; }
    if ("customer" in resolved) { setCustomerContext(resolved.customer); const balance = resolved.customer.balance ?? 0; const meter = s.meters.find((m) => m.customer_id === resolved.customer!.id); return { kind: "text", text: `المتبقي على ${resolved.customer.name}${meter ? ` (${meter.number})` : ""}: ${fmtYER(balance)}`, suggestions: ["اعرض حساب المشترك", "متى آخر قراءة؟", "هل دفع آخر فاتورة؟"] }; }
    if ("disambiguation" in resolved) return resolved.disambiguation;
    if (ctx.currentCustomer) { const balance = ctx.currentCustomer.balance ?? 0; const meter = s.meters.find((m) => m.customer_id === ctx.currentCustomer!.id); return { kind: "text", text: `المتبقي على ${ctx.currentCustomer.name}${meter ? ` (${meter.number})` : ""}: ${fmtYER(balance)}`, suggestions: ["اعرض حساب المشترك", "متى آخر قراءة؟", "هل دفع آخر فاتورة؟"] }; }
    return { kind: "suggestions", text: "حدد المشترك أولاً — اكتب اسمه أو رقم عداده، أو استعلم عن مشترك ثم اسأل عن رصيده.", suggestions: s.customers.slice(0, 6).map((c) => `استعلام عن مشترك ${c.name}`) };
  }

  // 1.6) Last reading / consumption / bill / payment
  if (has("آخر قراءة", "اخر قراءة", "آخر استهلاك", "اخر استهلاك", "متى آخر قراءة", "متى اخر قراءة", "اخر الاستهلاك", "الاستهلاك الاخير")) {
    if (!ctx.currentCustomer) return { kind: "clarification", text: "هل تقصد آخر قراءة لمشترك محدد؟", options: [{ label: "البحث عن مشترك أولاً", query: "استعلام عن مشترك" }, { label: "إلغاء", query: "استعلام عن مشترك" }] };
    const readings = getCustomerReadings(ctx.currentCustomer.id);
    if (readings.length === 0) return { kind: "text", text: `لا توجد قراءات مسجلة لـ ${ctx.currentCustomer.name}.` };
    const r = readings[0]; const meter = s.meters.find((m) => m.customer_id === ctx.currentCustomer!.id); setContext({ currentReading: r });
    return { kind: "text", text: `آخر قراءة لـ ${ctx.currentCustomer.name}${meter ? ` (${meter.number})` : ""}:\nالتاريخ: ${new Date(r.date).toLocaleDateString("ar-EG")}\nالقراءة: ${fmtNum(r.current)}\nالاستهلاك: ${fmtNum(r.consumption)} م³`, suggestions: ["كم المتبقي عليه؟", "كشف حساب المشترك", "هل دفع آخر فاتورة؟"] };
  }
  if (has("آخر فاتورة", "اخر فاتورة", "متى آخر فاتورة", "متى اخر فاتورة", "كم استهلك هذا الشهر", "كم استهلك")) {
    if (!ctx.currentCustomer) return { kind: "clarification", text: "هل تقصد آخر فاتورة لمشترك محدد أم آخر فاتورة في النظام؟", options: [{ label: "البحث عن مشترك أولاً", query: "استعلام عن مشترك" }, { label: "آخر فاتورة في النظام", query: "من لم يدفع؟" }] };
    const bills = getCustomerBills(ctx.currentCustomer.id);
    if (bills.length === 0) return { kind: "text", text: `لا توجد فواتير لـ ${ctx.currentCustomer.name}.` };
    const lastBill = bills[bills.length - 1]; const r = s.readings.find((x) => x.id === lastBill.reading_id); setContext({ currentBill: lastBill });
    return { kind: "text", text: `آخر فاتورة لـ ${ctx.currentCustomer.name}:\nرقم الفاتورة: ${lastBill.serial}\nالتاريخ: ${new Date(lastBill.date).toLocaleDateString("ar-EG")}\nالاستهلاك: ${fmtNum(r?.consumption ?? 0)} م³\nالمبلغ: ${fmtYER(lastBill.total)}\nالحالة: ${lastBill.status === "paid" ? "مدفوعة" : lastBill.status === "partial" ? "جزئية" : "غير مدفوعة"}`, suggestions: ["كم المتبقي عليه؟", "كشف حساب المشترك", "آخر دفعة"] };
  }
  // 1.7) Readings history
  if (has("سجل القراءات", "قراءات", "كل القراءات", "قائمة القراءات", "عرض القراءات", "تاريخ القراءات")) {
    if (!ctx.currentCustomer) return { kind: "clarification", text: "هل تقصد سجل قراءات لمشترك محدد؟", options: [{ label: "البحث عن مشترك أولاً", query: "استعلام عن مشترك" }, { label: "إلغاء", query: "استعلام عن مشترك" }] };
    const stmt = buildAccountStatement(ctx.currentCustomer);
    if (stmt.kind === "account_statement") return { kind: "text", text: `سجل قراءات ${ctx.currentCustomer.name} (${stmt.readings.length} قراءة):\n${stmt.readings.slice(0, 10).map((r) => `${new Date(r.date).toLocaleDateString("ar-EG")}: قراءة ${fmtNum(r.current)} — استهلاك ${fmtNum(r.consumption)} م³`).join("\n")}`, suggestions: ["كشف حساب المشترك", "كم المتبقي عليه؟", "آخر فاتورة"] };
    return { kind: "text", text: `لا توجد قراءات لـ ${ctx.currentCustomer.name}.` };
  }

  // 1.8) Top consumer
  if (has("أعلى مستهلك", "اعلى مستهلك", "أكثر استهلاك", "اكثر استهلاك", "أكبر استهلاك", "اكبر استهلاك", "أكثر المشتركين استهلاك", "الأكثر استهلاكاً", "أعلى استهلاك", "اعلى استهلاك")) {
    const range = has("اليوم") ? todayRange() : has("أسبوع", "اسبوع") ? weekRange() : has("سنة", "السنة") ? yearRange() : monthRange();
    const byCustomer = new Map<number, number>();
    s.readings.filter((r) => r.status !== "rejected" && +new Date(r.date) >= range.start && +new Date(r.date) < range.end).forEach((r) => { const m = s.meters.find((x) => x.id === r.meter_id); if (m) byCustomer.set(m.customer_id, (byCustomer.get(m.customer_id) ?? 0) + r.consumption); });
    const top = [...byCustomer.entries()].map(([cid, cons]) => ({ c: s.customers.find((x) => x.id === cid), cons })).filter((x) => x.c).sort((a, b) => b.cons - a.cons).slice(0, 10);
    if (top.length === 0) return { kind: "text", text: `لا توجد قراءات معتمدة في ${range.label}.` };
    setDisambiguation(top.map((x) => x.c!));
    setContext({ currentRanking: top.map((x) => x.c!), currentTimeRange: range.label });
    const lines = top.map((x, i) => { const m = s.meters.find((mm) => mm.customer_id === x.c!.id); return `${i + 1}. ${x.c!.name}${m ? ` (${m.number})` : ""} — ${fmtNum(x.cons)} م³`; });
    return { kind: "text", text: `أعلى المشتركين استهلاكاً ${range.label}:\n${lines.join("\n")}\n\nاكتب "اعرض الأول" لفتح كشف حساب صاحب أعلى استهلاك.`, suggestions: ["اعرض الأول", "تحليل الفاقد لهذا الشهر", "كم عدد المشتركين؟"] };
  }

  // 1.9) 12-month consumption comparison
  if (has("مقارنة", "قارن", "آخر 12 شهر", "12 شهر", "استهلاك السنة", "مقارنة استهلاك", "قارن استهلاكه", "قارن بالشهر الماضي", "مقارنة بالشهر الماضي", "مقارنة الشهور")) {
    if (!ctx.currentCustomer) return { kind: "clarification", text: "هل تقصد مقارنة استهلاك لمشترك محدد؟", options: [{ label: "البحث عن مشترك أولاً", query: "استعلام عن مشترك" }, { label: "إلغاء", query: "استعلام عن مشترك" }] };
    const stmt = buildAccountStatement(ctx.currentCustomer);
    if (stmt.kind === "account_statement" && stmt.monthlyConsumption.length > 0) return { kind: "text", text: `مقارنة استهلاك ${ctx.currentCustomer.name} — آخر ${stmt.monthlyConsumption.length} شهر:\n${stmt.monthlyConsumption.map((m) => `${m.month}: ${fmtNum(m.consumption)} م³`).join("\n")}`, suggestions: ["كشف حساب المشترك", "آخر قراءة؟", "طباعة كشف الحساب"] };
    return { kind: "text", text: `لا توجد بيانات كافية لمقارنة استهلاك ${ctx.currentCustomer.name}.` };
  }

  if (has("آخر دفعة", "اخر دفعة", "آخر تحصيل", "اخر تحصيل", "متى دفع", "متى آخر دفعة", "دفع آخر", "متى دفع آخر مرة")) {
    if (!ctx.currentCustomer) return { kind: "clarification", text: "هل تقصد آخر دفعة لمشترك محدد؟", options: [{ label: "البحث عن مشترك أولاً", query: "استعلام عن مشترك" }, { label: "تقرير التحصيل العام", query: "استعلام عن التحصيل اليوم" }] };
    const bills = getCustomerBills(ctx.currentCustomer.id);
    const payments = getCustomerPayments(ctx.currentCustomer.id, bills).filter((p) => p.status === "approved").sort((a, b) => +new Date(b.date) - +new Date(a.date));
    if (payments.length === 0) return { kind: "text", text: `لا توجد دفعات معتمدة لـ ${ctx.currentCustomer.name}.` };
    const p = payments[0];
    return { kind: "text", text: `آخر دفعة لـ ${ctx.currentCustomer.name}:\nالتاريخ: ${new Date(p.date).toLocaleDateString("ar-EG")}\nالمبلغ: ${fmtYER(p.amount)}\nالطريقة: ${p.method === "cash" ? "نقدي" : p.method === "wallet" ? "الكريمي" : "تحويل"}`, suggestions: ["كم المتبقي عليه؟", "كشف حساب المشترك", "آخر فاتورة"] };
  }
  if (has("هل دفع", "هل سدد", "هل دفع آخر فاتورة", "هل سدد آخر فاتورة", "هل دفع الفاتورة")) {
    if (!ctx.currentCustomer) return { kind: "clarification", text: "هل تقصد مشترك محدد؟", options: [{ label: "البحث عن مشترك أولاً", query: "استعلام عن مشترك" }, { label: "تقرير المدفوع وغير المدفوع", query: "من دفع ومن لم يدفع؟" }] };
    const bills = getCustomerBills(ctx.currentCustomer.id);
    if (bills.length === 0) return { kind: "text", text: `لا توجد فواتير لـ ${ctx.currentCustomer.name}.` };
    const lastBill = bills[bills.length - 1];
    const answer = lastBill.status === "paid" ? `نعم — ${ctx.currentCustomer.name} سدد آخر فاتورة (${lastBill.serial}) بالكامل.` : lastBill.status === "partial" ? `سدد جزئياً — المتبقي على آخر فاتورة (${lastBill.serial}): ${fmtYER(billBalance(lastBill, s.payments))}` : `لا — آخر فاتورة (${lastBill.serial}) غير مدفوعة. المبلغ المطلوب: ${fmtYER(billBalance(lastBill, s.payments))}`;
    return { kind: "text", text: answer, suggestions: ["كم المتبقي عليه؟", "كشف حساب المشترك", "آخر دفعة"] };
  }

  // 2) Account statement
  if (has("كشف حساب", "اعرض حساب", "كشف الحساب", "بيان حساب", "تفاصيل المشترك", "اعرض تفاصيل")) {
    const resolved = resolveCustomer(text, true);
    if ("customer" in resolved) { const meter = s.meters.find((m) => m.customer_id === resolved.customer.id); setCustomerContext(resolved.customer, meter?.number); setContext({ currentReport: "account_statement" }); return buildAccountStatement(resolved.customer); }
    if ("disambiguation" in resolved) return resolved.disambiguation;
    return resolved.none;
  }

  // 3) Subscriber ledger
  if (has("استعلام عن مشترك", "مشترك", "حساب", "كشف حساب", "ذمة", "رصيد", "فواتير المشترك", "اعرض فواتير")) {
    const resolved = resolveCustomer(text, true);
    if ("customer" in resolved) { const meter = s.meters.find((m) => m.customer_id === resolved.customer.id); setCustomerContext(resolved.customer, meter?.number); const customerBills = getCustomerBills(resolved.customer.id); const paid = getCustomerPayments(resolved.customer.id, customerBills).filter((p) => p.status === "approved").reduce((a, p) => a + p.amount, 0); const arrears = resolved.customer.balance !== undefined ? resolved.customer.balance : customerBills.reduce((a, b) => a + billBalance(b, s.payments), 0); const billed = customerBills.reduce((a, b) => a + b.total, 0); const series = customerBills.slice(-6).map((b) => { const r = s.readings.find((x) => x.id === b.reading_id); return { label: new Date(b.date).toLocaleDateString("ar-EG", { month: "short" }), consumption: r?.consumption ?? 0, amount: b.total }; }); return { kind: "subscriber_ledger", customer: { id: resolved.customer.id, name: resolved.customer.name, phone: resolved.customer.phone, pay_account: resolved.customer.pay_account, directorate: resolved.customer.directorate }, totals: { paid, arrears, billed }, series }; }
    if ("disambiguation" in resolved) return resolved.disambiguation;
    return resolved.none;
  }

  // 4) Loss analysis
  if (has("فاقد", "تسرب", "خسائر", "تحليل الفاقد", "هدر", "هدر المياه", "فاقد المياه", "فاقد الكهرباء", "نسبة الفاقد", "كم الفاقد", "كم نسبة الفاقد", "تحليل الهدر")) {
    const range = has("اليوم") ? todayRange() : has("أسبوع", "اسبوع") ? weekRange() : has("سنة", "السنة") ? yearRange() : monthRange();
    const perType = (t: "water" | "electric") => { const produced = s.productionLogs.filter((p) => p.type === t && +new Date(p.date) >= range.start && +new Date(p.date) < range.end).reduce((a, b) => a + b.units, 0); const meterIds = new Set(s.meters.filter((m) => m.type === t).map((m) => m.id)); const consumed = s.readings.filter((r) => meterIds.has(r.meter_id) && r.status !== "rejected" && +new Date(r.date) >= range.start && +new Date(r.date) < range.end).reduce((a, b) => a + b.consumption, 0); const loss = Math.max(0, produced - consumed); const pct = produced > 0 ? (loss / produced) * 100 : 0; return { produced, consumed, loss, pct }; };
    const water = perType("water"); const electric = perType("electric"); const alerts: string[] = [];
    if (water.pct > 15) alerts.push(`فاقد المياه ${water.pct.toFixed(1)}% — يُوصى بجولات تفتيش للتسريبات وفحص التوصيلات غير المشروطة في الشبكات عالية الاستهلاك`);
    if (electric.pct > 15) alerts.push(`فاقد الكهرباء ${electric.pct.toFixed(1)}% — يُوصى بمسح ميداني للتوصيلات المخالفة ومعايرة العدادات`);
    setContext({ currentReport: "loss_analysis", currentTimeRange: range.label });
    return { kind: "loss_analysis", range: { from: iso(range.start), to: iso(range.end - 1) }, water, electric, alerts };
  }

  // 5) Payment status
  if (has("من دفع", "من لم يدفع", "المدفوع", "غير المدفوع", "المتأخرين", "متأخر", "حالة الدفع", "من سدد", "من لم يسدد", "الفواتير المدفوعة", "الفواتير غير المدفوعة", "الفاتورات المتأخرة", "من تأخر")) {
    const paid = s.bills.filter((b) => b.status === "paid").slice(0, 50).map((b) => { const c = s.customers.find((x) => x.id === b.customer_id); return { id: b.id, name: c?.name ?? "—", serial: b.serial, total: b.total }; });
    const unpaid = s.bills.filter((b) => b.status !== "paid").slice(0, 50).map((b) => { const c = s.customers.find((x) => x.id === b.customer_id); return { id: b.id, name: c?.name ?? "—", serial: b.serial, total: b.total, balance: billBalance(b, s.payments) }; });
    setContext({ currentReport: "payment_status", currentTimeRange: null });
    return { kind: "payment_status", paid, unpaid };
  }

  // 6) Revenue report
  if (has("تحصيل", "محصل", "ايراد", "إيراد", "دخل", "تحصيلات", "المحصيل", "التحصيلات", "إيرادات", "ايرادات", "كم تم تحصيله", "كم محصّل", "حصيلة")) {
    const range = has("اليوم") ? todayRange() : has("أسبوع", "اسبوع") ? weekRange() : has("سنة", "السنة") ? yearRange() : monthRange();
    const payments = s.payments.filter((p) => p.status === "approved" && +new Date(p.date) >= range.start && +new Date(p.date) < range.end);
    const cash = payments.filter((p) => p.method === "cash").reduce((a, b) => a + b.amount, 0);
    const bank = payments.filter((p) => p.method === "wallet").reduce((a, b) => a + b.amount, 0);
    const total = cash + bank;
    const days = new Map<string, { cash: number; bank: number; total: number }>();
    payments.forEach((p) => { const d = iso(+new Date(p.date)); const cur = days.get(d) ?? { cash: 0, bank: 0, total: 0 }; if (p.method === "cash") cur.cash += p.amount; else if (p.method === "wallet") cur.bank += p.amount; cur.total += p.amount; days.set(d, cur); });
    const series = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day: day.slice(5), ...v }));
    setContext({ currentReport: "revenue_report", currentTimeRange: range.label });
    const topDebtor = [...s.customers].sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))[0];
    return { kind: "revenue_report", range: { from: iso(range.start), to: iso(range.end - 1), label: range.label }, totals: { cash, bank, total, count: payments.length, avg: payments.length ? total / payments.length : 0 }, series, suggestions: topDebtor ? [`أعلى مدين: ${topDebtor.name}`, "أعلى مستهلك", "تحصيل هذا الأسبوع", "تحصيل هذا الشهر"] : ["أعلى مستهلك", "تحصيل هذا الأسبوع", "تحصيل هذا الشهر"] };
  }

  return { kind: "suggestions", text: "اختر استعلاماً — ميزان الذكي يدعم هذه التقارير:", suggestions: ["استعلام عن مشترك", "كشف حساب المشترك MSR-0004", "تحليل الفاقد لهذا الشهر", "من دفع ومن لم يدفع؟", "استعلام عن التحصيل اليوم", "كم عدد المشتركين؟", "كم إجمالي الديون؟", "ما أكثر المشتركين تأخراً؟", "أعلى مستهلك", "سجل القراءات"] };
}

export { fmtYER, fmtNum };
