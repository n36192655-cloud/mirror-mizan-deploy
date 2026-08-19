import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useStore, billBalance } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtYER } from "@/lib/pricing";
import { Printer, Wallet, Droplets, Smartphone, ShieldCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/bills")({
  head: () => ({ meta: [{ title: "الفواتير — ميزان" }] }),
  component: BillsPage,
});

function BillsPage() {
  const { bills, meters, customers, addPayment, payments } = useStore();
  const { user } = useAuth();
  const isCashier = user?.role === "collector";
  const [tab, setTab] = useState<"all" | "unpaid" | "paid">("all");
  const [search, setSearch] = useState("");
  const [payFor, setPayFor] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "wallet">("cash");
  const [printBill, setPrintBill] = useState<number | null>(null);
  const [kuraimiFor, setKuraimiFor] = useState<number | null>(null);

  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );
  const meterByCustomerId = useMemo(
    () => new Map(meters.map((m) => [m.id, m])),
    [meters],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((b) => {
      if (tab === "unpaid" && !(b.status === "unpaid" || b.status === "partial")) return false;
      if (tab === "paid" && b.status !== "paid") return false;
      if (!q) return true;
      const c = customerById.get(b.customer_id);
      const m = meterByCustomerId.get(b.meter_id);
      const name = (c?.name ?? "").toLowerCase();
      const phone = (c?.phone ?? "").toLowerCase();
      const meterNum = (m?.number ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || meterNum.includes(q);
    });
  }, [bills, tab, search, customerById, meterByCustomerId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">الفواتير</h1>
        <p className="text-sm text-muted-foreground mt-1">إصدار تلقائي عند اعتماد القراءة — تشمل بند «متأخرات سابقة»</p>
      </div>

      <div className="flex gap-2">
        {(["all", "unpaid", "paid"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
            {t === "all" ? "الكل" : t === "unpaid" ? "غير مدفوعة" : "مدفوعة"}
          </Button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="بحث بالاسم أو رقم العداد أو الهاتف…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pr-9"
        />
      </div>

      <Card>
        <CardContent className="p-4 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">التسلسل</TableHead>
                <TableHead className="text-right">المشترك</TableHead>
                <TableHead className="text-right">العداد</TableHead>
                <TableHead className="text-right">التاريخ</TableHead>
                <TableHead className="text-right">الاستهلاك</TableHead>
                <TableHead className="text-right">متأخرات سابقة</TableHead>
                <TableHead className="text-right">الإجمالي</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => {
                const m = meters.find((x) => x.id === b.meter_id);
                const c = customers.find((x) => x.id === b.customer_id);
                const remaining = billBalance(b, payments);
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-[11px]">{b.serial}</TableCell>
                    <TableCell className="font-medium">{c?.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        <Droplets className="w-3 h-3 text-water" />
                        {m?.number}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{new Date(b.date).toLocaleDateString("ar-EG")}</TableCell>
                    <TableCell>{fmtYER(b.subtotal)}</TableCell>
                    <TableCell>
                      {b.arrears > 0 ? <span className="text-destructive font-semibold">{fmtYER(b.arrears)}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-bold">{fmtYER(b.total)}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === "paid" ? "default" : b.status === "partial" ? "secondary" : "destructive"}>
                        {b.status === "paid" ? "مدفوعة" : b.status === "partial" ? `جزئية (${fmtYER(remaining)})` : "غير مدفوعة"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setPrintBill(b.id)}><Printer className="w-3 h-3" /></Button>
                        {b.status !== "paid" && (
                          <>
                            <Button size="sm" onClick={() => { setPayFor(b.id); setAmount(String(remaining)); setMethod("cash"); }}>
                              <Wallet className="w-3 h-3 ms-1" /> نقدي
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setKuraimiFor(b.id)}>
                              <Smartphone className="w-3 h-3 ms-1" /> الكريمي
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={payFor !== null} onOpenChange={(v) => !v && setPayFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>تسجيل دفعة نقدية</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>المبلغ</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div>
              <Label>طريقة الدفع</Label>
              <Select value={method} onValueChange={(v: "cash" | "wallet") => setMethod(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي (يتم استلامه من الميدان)</SelectItem>
                  <SelectItem value="wallet">تحويل بنكي — الكريمي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground bg-muted/40 p-2 rounded-md">
              سيتم إدراج الدفعة بحالة <b>معلقة</b> بانتظار اعتماد الإدارة قبل خصمها من رصيد المشترك.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => {
              if (payFor === null || !amount) return;
              const p = addPayment({ billId: payFor, amount: +amount, method, by: user?.name });
              const id = payFor;
              setPayFor(null);
              toast.success(`تم تسجيل الدفعة #${p.id} — بانتظار اعتماد الإدارة`);
              if (isCashier) setPrintBill(id);
            }}>تأكيد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {printBill !== null && <PrintDialog id={printBill} onClose={() => setPrintBill(null)} />}
      {kuraimiFor !== null && (
        <KuraimiDialog
          id={kuraimiFor}
          onClose={() => setKuraimiFor(null)}
          onPaid={(id) => { setKuraimiFor(null); setPrintBill(id); }}
        />
      )}
    </div>
  );
}

function KuraimiDialog({ id, onClose, onPaid }: { id: number; onClose: () => void; onPaid: (id: number) => void }) {
  const { bills, customers, addPayment, payments } = useStore();
  const { user } = useAuth();
  const b = bills.find((x) => x.id === id);
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"init" | "otp" | "done">("init");
  if (!b) return null;
  const c = customers.find((x) => x.id === b.customer_id);
  const remaining = billBalance(b, payments);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-primary" /> تحويل عبر الكريمي
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border p-4 bg-gradient-to-br from-primary/5 to-primary/0 space-y-3 text-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-emerald-600" /> اتصال آمن — بنك الكريمي
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-muted-foreground">المشترك</div><div className="font-semibold">{c?.name}</div>
            <div className="text-muted-foreground">حساب السداد</div><div className="font-mono" dir="ltr">{c?.pay_account}</div>
            <div className="text-muted-foreground">فاتورة</div><div className="font-mono">{b.serial}</div>
            <div className="text-muted-foreground">المستحق</div><div className="font-bold text-lg">{fmtYER(remaining)}</div>
          </div>
          {step === "otp" && (
            <div className="pt-2 border-t">
              <Label className="text-xs">رمز التحقق OTP (تجريبي: 1234)</Label>
              <Input dir="ltr" className="text-center tracking-widest text-lg" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value)} />
            </div>
          )}
          {step === "done" && (
            <div className="pt-2 text-center text-emerald-600 font-semibold">✓ تم إرسال إشعار التحويل — بانتظار اعتماد الإدارة</div>
          )}
        </div>
        <DialogFooter>
          {step === "init" && (
            <>
              <Button variant="outline" onClick={onClose}>إلغاء</Button>
              <Button onClick={() => setStep("otp")}>متابعة الدفع</Button>
            </>
          )}
          {step === "otp" && (
            <Button onClick={() => {
              if (otp !== "1234") return toast.error("رمز التحقق غير صحيح");
              addPayment({ billId: b.id, amount: remaining, method: "wallet", by: user?.name });
              setStep("done");
              toast.success("تم إرسال الإشعار — بانتظار اعتماد الإدارة");
              setTimeout(() => onPaid(b.id), 900);
            }}>تأكيد OTP</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrintDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { bills, customers, meters, readings } = useStore();
  const b = bills.find((x) => x.id === id);
  if (!b) return null;
  const c = customers.find((x) => x.id === b.customer_id);
  const m = meters.find((x) => x.id === b.meter_id);
  const r = readings.find((x) => x.id === b.reading_id);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{b.serial}</DialogTitle></DialogHeader>
        <div id="printable" className="p-6 bg-white text-slate-900 rounded-lg border">
          <div className="text-center border-b pb-3 mb-4">
            <div className="text-2xl font-bold" style={{ color: "var(--water)" }}>ميزان</div>
            <div className="text-xs text-slate-500 mt-1">فاتورة مياه — تعز، اليمن</div>
            <div className="text-xs font-mono mt-1">{b.serial}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-slate-500 text-xs">المشترك</div><div className="font-semibold">{c?.name}</div></div>
            <div><div className="text-slate-500 text-xs">الهاتف</div><div dir="ltr" className="text-right">{c?.phone}</div></div>
            <div><div className="text-slate-500 text-xs">المديرية</div><div>{c?.directorate ?? "—"}</div></div>
            <div><div className="text-slate-500 text-xs">رقم العداد</div><div className="font-mono">{m?.number}</div></div>
            <div><div className="text-slate-500 text-xs">القراءة السابقة</div><div>{r?.previous}</div></div>
            <div><div className="text-slate-500 text-xs">القراءة الحالية</div><div>{r?.current}</div></div>
            <div className="col-span-2"><div className="text-slate-500 text-xs">الاستهلاك</div><div className="font-semibold">{r?.consumption} م³</div></div>
          </div>
          <div className="mt-4 pt-4 border-t space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">استهلاك الشهر</span><span>{fmtYER(b.subtotal)}</span></div>
            {b.arrears > 0 && (
              <div className="flex justify-between text-red-700"><span>متأخرات سابقة</span><span>{fmtYER(b.arrears)}</span></div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>الإجمالي</span>
              <span style={{ color: "var(--water)" }}>{fmtYER(b.total)}</span>
            </div>
          </div>
          <div className="mt-3 text-center text-xs text-slate-500">شكراً لالتزامكم بالسداد</div>
        </div>
        <DialogFooter>
          <Button onClick={() => window.print()}><Printer className="w-4 h-4 ms-1" /> طباعة / PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
