import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AiResponse } from "@/lib/ai-intent";
import { fmtYER, fmtNum } from "@/lib/pricing";
import { AlertTriangle, CheckCircle2, XCircle, Droplets, Zap, TrendingUp, Wallet, Smartphone, CircleDollarSign, User, Phone, MapPin, Download, Printer, Droplet, Activity, FileText, Calendar, Receipt, CreditCard, BarChart3, ListOrdered, HelpCircle, ChevronLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { MizanAiIcon } from "@/components/mizan-ai-icon";
import { exportStatementPDF } from "@/lib/assistant/pdf-export";

interface Props {
  response: AiResponse;
  onSuggestion: (q: string) => void;
}

export function AiResponseRenderer({ response, onSuggestion }: Props) {
  if (response.kind === "text" || response.kind === "suggestions") {
    return (
      <div className="space-y-2 text-sm whitespace-pre-wrap">
        <p>{response.text}</p>
        {response.suggestions && response.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {response.suggestions.map((s) => (
              <button key={s} onClick={() => onSuggestion(s)} className="text-xs px-2.5 py-1 rounded-full border bg-background hover:bg-primary/10 hover:border-primary/40 transition-colors">{s}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Disambiguation card (rich clickable cards) ─────────────────
  if (response.kind === "disambiguation") {
    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold flex items-center gap-1.5 text-amber-700"><ListOrdered className="w-4 h-4" /> وجدت عدة مشتركين</div>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{response.text}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {response.customers.map((c, i) => (
              <button key={c.id} onClick={() => onSuggestion(String(i + 1))} className="text-right flex flex-col gap-2 p-3 rounded-lg border bg-background hover:border-primary/40 hover:bg-primary/5 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0"><div className="text-xs font-semibold truncate">{c.name}</div>{c.meterNumber && <div className="text-[10px] font-mono text-muted-foreground">{c.meterNumber}</div>}</div>
                  <Badge variant={c.status === "active" ? "default" : "destructive"} className="text-[9px] shrink-0">{c.status === "active" ? "نشط" : "متوقف"}</Badge>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap"><span className="inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" /> <span dir="ltr">{c.phone}</span></span>{c.directorate && <span className="inline-flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {c.directorate}</span>}</div>
                {(c.balance ?? 0) > 0 && <div className="text-[10px] font-semibold text-destructive">رصيد: {fmtYER(c.balance ?? 0)}</div>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Clarification card (interactive disambiguation) ──────────────
  if (response.kind === "clarification") {
    return (
      <Card className="border-sky-500/30 bg-sky-500/5">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold flex items-center gap-1.5 text-sky-700"><HelpCircle className="w-4 h-4" /> {response.text}</div>
          <div className="grid sm:grid-cols-1 gap-2">
            {response.options.map((opt, i) => (
              <button key={i} onClick={() => onSuggestion(opt.query)} className="text-right flex items-center gap-2 p-3 rounded-lg border bg-background hover:border-primary/40 hover:bg-primary/5 transition-colors">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center shrink-0">{i + 1}</span>
                <span className="text-sm font-medium flex-1">{opt.label}</span>
                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (response.kind === "subscriber_ledger") {
    const { customer, totals, series } = response;
    return (
      <Card className="border-primary/30"><CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2"><div>
          <div className="text-sm font-bold flex items-center gap-1.5"><User className="w-4 h-4 text-primary" /> {customer.name}</div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap"><span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> <span dir="ltr">{customer.phone}</span></span>{customer.directorate && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {customer.directorate}</span>}</div>
          <div className="text-[10px] font-mono text-muted-foreground mt-1" dir="ltr">{customer.pay_account}</div>
        </div></div>
        <div className="grid grid-cols-3 gap-2"><StatBox label="إجمالي مفوتر" value={fmtYER(totals.billed)} /><StatBox label="مدفوع" value={fmtYER(totals.paid)} tone="ok" /><StatBox label="متأخرات" value={fmtYER(totals.arrears)} tone={totals.arrears > 0 ? "danger" : undefined} /></div>
        {series.length > 0 && (<div className="h-40"><ResponsiveContainer width="100%" height="100%"><BarChart data={series}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip formatter={(v: number) => fmtNum(v)} /><Bar dataKey="consumption" name="استهلاك" fill="var(--water)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>)}
        <div className="flex gap-1.5 flex-wrap pt-1"><Button size="sm" variant="outline" onClick={() => onSuggestion("كشف حساب المشترك")}>كشف حساب كامل</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("كم المتبقي عليه؟")}>كم المتبقي؟</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("متى آخر قراءة؟")}>آخر قراءة</Button></div>
      </CardContent></Card>
    );
  }

  if (response.kind === "account_statement") return <AccountStatementCard response={response} onSuggestion={onSuggestion} />;

  if (response.kind === "loss_analysis") {
    const chart = [{ name: "مياه", produced: response.water.produced, consumed: response.water.consumed, loss: response.water.loss }, { name: "كهرباء", produced: response.electric.produced, consumed: response.electric.consumed, loss: response.electric.loss }];
    return (<Card><CardContent className="p-4 space-y-3"><div className="text-xs text-muted-foreground">الفترة: {response.range.from} → {response.range.to}</div>
      <div className="grid grid-cols-2 gap-2"><LossCard label="فاقد المياه" pct={response.water.pct} loss={response.water.loss} icon={<Droplets className="w-4 h-4 text-water" />} /><LossCard label="فاقد الكهرباء" pct={response.electric.pct} loss={response.electric.loss} icon={<Zap className="w-4 h-4 text-electric" />} /></div>
      <div className="h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v: number) => fmtNum(v)} /><Legend /><Bar dataKey="produced" name="مُنتج" fill="var(--water)" /><Bar dataKey="consumed" name="مُستهلَك" fill="var(--electric-2)" /><Bar dataKey="loss" name="فاقد" fill="#dc2626" /></BarChart></ResponsiveContainer></div>
      {response.alerts.length > 0 && (<div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-1">{response.alerts.map((a) => (<div key={a} className="flex items-start gap-2 text-xs"><AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" /><span>{a}</span></div>))}</div>)}
      <div className="flex gap-1.5 flex-wrap pt-1"><Button size="sm" variant="outline" onClick={() => onSuggestion("تحليل الفاقد اليوم")}>اليوم</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("تحليل الفاقد هذا الأسبوع")}>الأسبوع</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("تحليل الفاقد لهذا الشهر")}>الشهر</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("كم إنتاج المياه؟")}>إنتاج المياه</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("كم عدد المشتركين؟")}>عدد المشتركين</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("من دفع ومن لم يدفع؟")}>حالة الدفع</Button></div>
    </CardContent></Card>);
  }

  if (response.kind === "payment_status") {
    function exportCsv(rows: Array<Record<string, string | number>>, name: string) { if (typeof window === "undefined") return; const cols = Object.keys(rows[0] ?? {}); const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n"); const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url); }
    return (<div className="grid md:grid-cols-2 gap-3">
      <Card className="border-emerald-500/30 bg-emerald-500/5"><CardContent className="p-4 space-y-2"><div className="flex items-center justify-between"><div className="text-sm font-bold flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="w-4 h-4" /> مدفوعة ({response.paid.length})</div><Button size="sm" variant="ghost" onClick={() => exportCsv(response.paid, "paid")}><Download className="w-3 h-3 ms-1" /> CSV</Button></div>
        <ul className="text-xs space-y-1 max-h-56 overflow-auto">{response.paid.map((p) => (<li key={p.id} className="flex justify-between border-b pb-1"><span className="font-mono text-[10px]">{p.serial}</span><span className="flex-1 mx-2 truncate">{p.name}</span><span className="font-semibold">{fmtYER(p.total)}</span></li>))}{response.paid.length === 0 && <li className="text-muted-foreground text-center py-4">لا توجد</li>}</ul>
      </CardContent></Card>
      <Card className="border-destructive/30 bg-destructive/5"><CardContent className="p-4 space-y-2"><div className="flex items-center justify-between"><div className="text-sm font-bold flex items-center gap-1.5 text-destructive"><XCircle className="w-4 h-4" /> غير مدفوعة ({response.unpaid.length})</div><Button size="sm" variant="ghost" onClick={() => exportCsv(response.unpaid, "unpaid")}><Download className="w-3 h-3 ms-1" /> CSV</Button></div>
        <ul className="text-xs space-y-1 max-h-56 overflow-auto">{response.unpaid.map((p) => (<li key={p.id} className="flex justify-between border-b pb-1"><span className="font-mono text-[10px]">{p.serial}</span><span className="flex-1 mx-2 truncate">{p.name}</span><span className="font-semibold">{fmtYER(p.balance)}</span></li>))}{response.unpaid.length === 0 && <li className="text-muted-foreground text-center py-4">لا توجد</li>}</ul>
      </CardContent></Card>
      <div className="md:col-span-2 flex gap-1.5 flex-wrap"><Button size="sm" variant="outline" onClick={() => onSuggestion("ما أكثر المشتركين تأخراً؟")}>أكثر المتأخرين</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("كم إجمالي الديون؟")}>إجمالي الديون</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("استعلام عن التحصيل اليوم")}>تقرير التحصيل</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("أعلى مستهلك")}>أعلى مستهلك</Button></div>
    </div>);
  }

  if (response.kind === "revenue_report") {
    return (<Card><CardContent className="p-4 space-y-3"><div className="text-xs text-muted-foreground">{response.range.label}: {response.range.from} → {response.range.to}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2"><StatBox label="نقدي" value={fmtYER(response.totals.cash)} icon={<Wallet className="w-4 h-4 text-water" />} /><StatBox label="الكريمي" value={fmtYER(response.totals.bank)} icon={<Smartphone className="w-4 h-4 text-primary" />} /><StatBox label="الإجمالي" value={fmtYER(response.totals.total)} tone="ok" icon={<CircleDollarSign className="w-4 h-4 text-emerald-600" />} /><StatBox label="متوسط الدفعة" value={fmtYER(response.totals.avg)} icon={<TrendingUp className="w-4 h-4 text-muted-foreground" />} /></div>
      {response.series.length > 0 ? (<div className="h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={response.series}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="day" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip formatter={(v: number) => fmtYER(v)} /><Legend /><Line type="monotone" dataKey="cash" name="نقدي" stroke="var(--water)" /><Line type="monotone" dataKey="bank" name="الكريمي" stroke="var(--electric-2)" /><Line type="monotone" dataKey="total" name="الإجمالي" stroke="#059669" /></LineChart></ResponsiveContainer></div>) : (<p className="text-xs text-muted-foreground text-center py-6">لا توجد دفعات معتمدة في هذه الفترة</p>)}
      <Badge variant="outline" className="text-[11px]">{response.totals.count} عملية معتمدة</Badge>
      {response.suggestions && response.suggestions.length > 0 && (<div className="flex flex-wrap gap-1.5 pt-1">{response.suggestions.map((s) => (<button key={s} onClick={() => onSuggestion(s)} className="text-xs px-2.5 py-1 rounded-full border bg-background hover:bg-primary/10 hover:border-primary/40 transition-colors">{s}</button>))}</div>)}
    </CardContent></Card>);
  }
  return null;
}

function StatBox({ label, value, tone, icon }: { label: string; value: string; tone?: "ok" | "danger"; icon?: React.ReactNode }) {
  const cls = tone === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : tone === "danger" ? "border-destructive/30 bg-destructive/5" : "bg-muted/30";
  return (<div className={`rounded-lg border p-2.5 ${cls}`}><div className="text-[10px] text-muted-foreground flex items-center gap-1">{icon}{label}</div><div className={`text-sm font-bold mt-1 ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div></div>);
}

function LossCard({ label, pct, loss, icon }: { label: string; pct: number; loss: number; icon: React.ReactNode }) {
  const danger = pct > 15;
  return (<div className={`p-3 rounded-lg border ${danger ? "border-destructive/40 bg-destructive/5" : "bg-muted/30"}`}><div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div><div className={`text-xl font-bold mt-1 ${danger ? "text-destructive" : ""}`}>{pct.toFixed(1)}%</div><div className="text-[11px] text-muted-foreground">{fmtNum(loss)} وحدة فاقد</div></div>);
}

function AccountStatementCard({ response, onSuggestion }: { response: Extract<AiResponse, { kind: "account_statement" }>; onSuggestion: (q: string) => void; }) {
  if (response.kind !== "account_statement") return null;
  const { customer, totals, stats, lastReading, readings, monthlyConsumption, bills, payments, timeline } = response;
  const statusLabel = (s: string) => s === "paid" ? "مدفوعة" : s === "partial" ? "جزئية" : "غير مدفوعة";
  const statusVariant = (s: string): "default" | "secondary" | "destructive" => s === "paid" ? "default" : s === "partial" ? "secondary" : "destructive";
  const payStatusLabel = (s: string) => s === "approved" ? "معتمدة" : s === "pending" ? "معلقة" : "مرفوضة";
  const payStatusVariant = (s: string): "default" | "secondary" | "destructive" => s === "approved" ? "default" : s === "pending" ? "secondary" : "destructive";
  const methodLabel = (m: string) => m === "cash" ? "نقدي" : m === "wallet" ? "الكريمي" : "تحويل";
  const timelineIcon = (type: string) => type === "reading" ? <Droplet className="w-3 h-3 text-water" /> : type === "bill" ? <Receipt className="w-3 h-3 text-primary" /> : <CreditCard className="w-3 h-3 text-emerald-600" />;
  const timelineColor = (type: string) => type === "reading" ? "border-water/30" : type === "bill" ? "border-primary/30" : "border-emerald-500/30";

  return (<div className="space-y-4">
    <div className="flex items-center justify-between flex-wrap gap-2"><div className="flex items-center gap-2"><MizanAiIcon size={28} /><div><h3 className="text-base font-bold">كشف حساب المشترك</h3><p className="text-[11px] text-muted-foreground">{customer.name}</p></div></div><Button size="sm" variant="outline" onClick={() => exportStatementPDF(response)}><Printer className="w-3.5 h-3.5 ms-1" /> طباعة كشف الحساب PDF</Button></div>
    <Card><CardContent className="p-3"><div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <div className="flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-muted-foreground" /><div><div className="text-muted-foreground">الاسم</div><div className="font-semibold">{customer.name}</div></div></div>
      <div className="flex items-center gap-1.5"><Droplets className="w-3.5 h-3.5 text-muted-foreground" /><div><div className="text-muted-foreground">العداد</div><div className="font-mono font-semibold">{customer.meterNumber ?? "—"}</div></div></div>
      <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-muted-foreground" /><div><div className="text-muted-foreground">الهاتف</div><div className="font-mono" dir="ltr">{customer.phone}</div></div></div>
      <div className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-muted-foreground" /><div><div className="text-muted-foreground">الحالة</div><Badge variant={customer.status === "active" ? "default" : "destructive"} className="text-[10px]">{customer.status === "active" ? "نشط" : "متوقف"}</Badge></div></div>
    </div>{customer.directorate && <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground"><MapPin className="w-3 h-3" /> {customer.directorate}</div>}</CardContent></Card>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2"><StatBox label="إجمالي الفواتير" value={fmtYER(totals.billed)} icon={<TrendingUp className="w-3 h-3" />} /><StatBox label="المدفوع" value={fmtYER(totals.paid)} tone="ok" icon={<CheckCircle2 className="w-3 h-3" />} /><StatBox label="المتأخرات" value={fmtYER(totals.arrears)} tone="danger" icon={<AlertTriangle className="w-3 h-3" />} /><StatBox label="الرصيد الحالي" value={fmtYER(totals.balance)} tone={totals.balance > 0 ? "danger" : "ok"} icon={<Wallet className="w-3 h-3" />} /></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2"><StatBox label="عدد الفواتير" value={String(stats.billCount)} icon={<FileText className="w-3 h-3" />} /><StatBox label="نسبة التحصيل" value={`${stats.collectionPct}%`} tone={stats.collectionPct >= 70 ? "ok" : "danger"} icon={<CheckCircle2 className="w-3 h-3" />} /><StatBox label="أعلى فاتورة" value={fmtYER(stats.highestBill)} icon={<TrendingUp className="w-3 h-3" />} /><StatBox label="أدنى فاتورة" value={fmtYER(stats.lowestBill)} icon={<Wallet className="w-3 h-3" />} /></div>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2"><StatBox label="المدفوعة" value={String(stats.paidCount)} tone="ok" icon={<CheckCircle2 className="w-3 h-3" />} /><StatBox label="غير المدفوعة" value={String(stats.unpaidCount)} tone={stats.unpaidCount > 0 ? "danger" : undefined} icon={<XCircle className="w-3 h-3" />} /><StatBox label="متوسط الاستهلاك" value={`${fmtNum(stats.avgConsumption)} م³`} icon={<BarChart3 className="w-3 h-3" />} /></div>
    {lastReading && (<Card><CardContent className="p-3"><div className="text-xs font-semibold mb-2 flex items-center gap-1"><Droplet className="w-3.5 h-3.5 text-water" /> آخر قراءة</div><div className="grid grid-cols-3 gap-2 text-xs"><div><div className="text-muted-foreground">التاريخ</div><div className="font-semibold">{new Date(lastReading.date).toLocaleDateString("ar-EG")}</div></div><div><div className="text-muted-foreground">القراءة الحالية</div><div className="font-semibold">{fmtNum(lastReading.current)}</div></div><div><div className="text-muted-foreground">الاستهلاك</div><div className="font-semibold">{fmtNum(lastReading.consumption)} م³</div></div></div></CardContent></Card>)}
    {monthlyConsumption.length > 1 && (<Card><CardContent className="p-3"><div className="text-xs font-semibold mb-2 flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5 text-primary" /> استهلاك شهري — آخر {monthlyConsumption.length} شهر</div><div className="h-36"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyConsumption}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="month" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} /><Tooltip formatter={(v: number) => `${fmtNum(v)} م³`} /><Bar dataKey="consumption" name="استهلاك" fill="var(--water)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></CardContent></Card>)}
    {readings.length > 0 && (<Card><CardContent className="p-3"><div className="text-xs font-semibold mb-2 flex items-center gap-1"><Droplet className="w-3.5 h-3.5 text-water" /> سجل القراءات ({readings.length})</div><div className="overflow-auto max-h-40"><Table><TableHeader><TableRow><TableHead className="text-right text-[10px] h-7">التاريخ</TableHead><TableHead className="text-right text-[10px] h-7">السابقة</TableHead><TableHead className="text-right text-[10px] h-7">الحالية</TableHead><TableHead className="text-right text-[10px] h-7">الاستهلاك</TableHead><TableHead className="text-right text-[10px] h-7">الحالة</TableHead></TableRow></TableHeader><TableBody>{readings.map((r) => (<TableRow key={r.id}><TableCell className="text-[10px] py-1">{new Date(r.date).toLocaleDateString("ar-EG")}</TableCell><TableCell className="text-[10px] py-1">{fmtNum(r.previous)}</TableCell><TableCell className="text-[10px] py-1">{fmtNum(r.current)}</TableCell><TableCell className="text-[10px] font-semibold py-1">{fmtNum(r.consumption)} م³</TableCell><TableCell className="py-1"><Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"} className="text-[9px]">{r.status === "approved" ? "معتمدة" : r.status === "rejected" ? "مرفوضة" : "معلقة"}</Badge></TableCell></TableRow>))}</TableBody></Table></div></CardContent></Card>)}
    <Card><CardContent className="p-3"><div className="text-xs font-semibold mb-2">سجل الفواتير ({bills.length})</div>{bills.length === 0 ? (<p className="text-xs text-muted-foreground text-center py-3">لا توجد فواتير.</p>) : (<div className="overflow-auto max-h-48"><Table><TableHeader><TableRow><TableHead className="text-right text-[10px] h-7">التاريخ</TableHead><TableHead className="text-right text-[10px] h-7">رقم الفاتورة</TableHead><TableHead className="text-right text-[10px] h-7">الاستهلاك</TableHead><TableHead className="text-right text-[10px] h-7">المبلغ</TableHead><TableHead className="text-right text-[10px] h-7">المدفوع</TableHead><TableHead className="text-right text-[10px] h-7">الحالة</TableHead></TableRow></TableHeader><TableBody>{bills.map((b) => (<TableRow key={b.id}><TableCell className="text-[10px] py-1">{new Date(b.date).toLocaleDateString("ar-EG")}</TableCell><TableCell className="font-mono text-[10px] py-1">{b.serial}</TableCell><TableCell className="text-[10px] py-1">{fmtNum(b.consumption)} م³</TableCell><TableCell className="text-[10px] font-semibold py-1">{fmtYER(b.total)}</TableCell><TableCell className="text-[10px] py-1">{fmtYER(b.paid)}</TableCell><TableCell className="py-1"><Badge variant={statusVariant(b.status)} className="text-[9px]">{statusLabel(b.status)}</Badge></TableCell></TableRow>))}</TableBody></Table></div>)}</CardContent></Card>
    <Card><CardContent className="p-3"><div className="text-xs font-semibold mb-2">سجل الدفعات ({payments.length})</div>{payments.length === 0 ? (<p className="text-xs text-muted-foreground text-center py-3">لا توجد دفعات.</p>) : (<div className="overflow-auto max-h-48"><Table><TableHeader><TableRow><TableHead className="text-right text-[10px] h-7">التاريخ</TableHead><TableHead className="text-right text-[10px] h-7">المبلغ</TableHead><TableHead className="text-right text-[10px] h-7">الطريقة</TableHead><TableHead className="text-right text-[10px] h-7">الحالة</TableHead></TableRow></TableHeader><TableBody>{payments.map((p) => (<TableRow key={p.id}><TableCell className="text-[10px] py-1">{new Date(p.date).toLocaleDateString("ar-EG")}</TableCell><TableCell className="text-[10px] font-semibold py-1">{fmtYER(p.amount)}</TableCell><TableCell className="py-1"><Badge variant={p.method === "cash" ? "outline" : "secondary"} className="text-[9px]">{methodLabel(p.method)}</Badge></TableCell><TableCell className="py-1"><Badge variant={payStatusVariant(p.status)} className="text-[9px]">{payStatusLabel(p.status)}</Badge></TableCell></TableRow>))}</TableBody></Table></div>)}</CardContent></Card>
    {timeline.length > 0 && (<Card><CardContent className="p-3"><div className="text-xs font-semibold mb-2 flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-muted-foreground" /> Timeline — آخر الأحداث</div><div className="space-y-1.5 max-h-48 overflow-auto">{timeline.map((t, i) => (<div key={i} className={`flex items-start gap-2 p-1.5 rounded border ${timelineColor(t.type)}`}><span className="mt-0.5 shrink-0">{timelineIcon(t.type)}</span><div className="flex-1 min-w-0"><div className="text-[10px] text-muted-foreground">{new Date(t.date).toLocaleDateString("ar-EG")}</div><div className="text-[11px] font-medium">{t.description}</div></div></div>))}</div></CardContent></Card>)}
    <div className="flex gap-2 flex-wrap"><Button size="sm" variant="outline" onClick={() => exportStatementPDF(response)}><Printer className="w-3 h-3 ms-1" /> طباعة PDF</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("متى آخر قراءة؟")}>آخر قراءة</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("آخر فاتورة")}>آخر فاتورة</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("آخر دفعة")}>آخر دفعة</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("سجل القراءات")}>سجل القراءات</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("هل دفع آخر فاتورة؟")}>هل دفع؟</Button><Button size="sm" variant="outline" onClick={() => onSuggestion("قارن استهلاكه")}>مقارنة الاستهلاك</Button>{totals.balance > 0 && <Button size="sm" variant="outline" onClick={() => onSuggestion("كم المتبقي عليه؟")}>كم المتبقي؟</Button>}<Button size="sm" variant="outline" onClick={() => onSuggestion("استعلام عن التحصيل اليوم")}>تقرير التحصيل</Button></div>
  </div>);
}
