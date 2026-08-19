import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useStore, paymentMethodLabel } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtYER } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wallet, Check, X, CircleDollarSign, Smartphone } from "lucide-react";

import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/payments")({
  head: () => ({ meta: [{ title: "التحصيل — ميزان" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const { payments, bills, customers, approvePayment, rejectPayment } = useStore();
  const { user } = useAuth();
  const isAdmin = user?.role === "manager" || user?.role === "super_admin";
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");

  const list = useMemo(
    () => [...payments].filter((p) => p.status === tab).sort((a, b) => +new Date(b.date) - +new Date(a.date)),
    [payments, tab],
  );

  const approved = payments.filter((p) => p.status === "approved");
  const totals = useMemo(() => {
    const cash = approved.filter((p) => p.method === "cash").reduce((a, b) => a + b.amount, 0);
    const wallet = approved.filter((p) => p.method === "wallet").reduce((a, b) => a + b.amount, 0);
    const pending = payments.filter((p) => p.status === "pending").reduce((a, b) => a + b.amount, 0);
    return { cash, wallet, total: cash + wallet, pending };
  }, [payments, approved]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">التحصيل</h1>
        <p className="text-sm text-muted-foreground mt-1">اعتماد الدفعات (نقدي / الكريمي) وخصمها آنياً من رصيد المشترك</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="نقدي معتمد" value={fmtYER(totals.cash)} icon={<Wallet className="w-5 h-5 text-water" />} />
        <Stat label="تحويلات معتمدة" value={fmtYER(totals.wallet)} icon={<Smartphone className="w-5 h-5 text-primary" />} />
        <Stat label="الإجمالي" value={fmtYER(totals.total)} icon={<CircleDollarSign className="w-5 h-5 text-emerald-600" />} highlight />
        <Stat label="بانتظار الاعتماد" value={fmtYER(totals.pending)} icon={<Wallet className="w-5 h-5 text-amber-600" />} />
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["pending", "approved", "rejected"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
            {t === "pending" ? "بانتظار الاعتماد" : t === "approved" ? "معتمَدة" : "مرفوضة"}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>{tab === "pending" ? "طلبات اعتماد الدفعات" : tab === "approved" ? "الدفعات المعتمدة" : "الدفعات المرفوضة"} ({list.length})</CardTitle></CardHeader>
        <CardContent className="p-4 overflow-auto">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">لا يوجد.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">#</TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">الفاتورة</TableHead>
                  <TableHead className="text-right">المشترك</TableHead>
                  <TableHead className="text-right">المبلغ</TableHead>
                  <TableHead className="text-right">الطريقة</TableHead>
                  <TableHead className="text-right">المُحصِّل</TableHead>
                  {tab === "pending" && <TableHead className="text-right"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((p) => {
                  const b = bills.find((x) => x.id === p.bill_id);
                  const c = customers.find((x) => x.id === b?.customer_id);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="text-muted-foreground">#{p.id}</TableCell>
                      <TableCell className="text-xs">{new Date(p.date).toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="font-mono text-[11px]">{b?.serial ?? `#${p.bill_id}`}</TableCell>
                      <TableCell>{c?.name ?? "—"}</TableCell>
                      <TableCell className="font-semibold">{fmtYER(p.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={p.method === "cash" ? "outline" : "secondary"}>{paymentMethodLabel(p.method)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.by ?? "—"}</TableCell>
                      {tab === "pending" && (
                        <TableCell>
                          {isAdmin ? (
                            <div className="flex gap-1">
                              <Button size="sm" onClick={() => approvePayment(p.id)}>
                                <Check className="w-3 h-3 ms-1" /> اعتماد
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => rejectPayment(p.id)}>
                                <X className="w-3 h-3 ms-1" /> رفض
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">بانتظار الإدارة</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, icon, highlight }: { label: string; value: string; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-primary/40 bg-primary/5" : ""}>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg md:text-xl font-bold mt-1">{value}</div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-muted/40 grid place-items-center">{icon}</div>
      </CardContent>
    </Card>
  );
}
