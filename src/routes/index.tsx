import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useStore, billBalance } from "@/lib/store";
import { fmtYER, fmtNum } from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Droplets,
  Users,
  AlertTriangle,
  Leaf,
  Wallet,
  TrendingUp,
  ShieldCheck,
  Activity,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend,
} from "recharts";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "لوحة الاستدامة — محرك ذكاء استدامة المياه (WSIE)" },
      { name: "description", content: "لوحة قيادة استدامة المياه: كفاءة الشبكة، الفاقد، الاستهلاك، والتحصيل — بيانات مباشرة." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { customers, meters, readings, bills, payments, productionLogs, counts, hydrateFromSupabase } = useStore();

  useEffect(() => {
    void hydrateFromSupabase();
  }, [hydrateFromSupabase]);

  const k = useMemo(() => {
    // Financial
    const paidBills = bills.filter((b) => b.status === "paid");
    const unpaidBills = bills.filter((b) => b.status !== "paid");
    const totalBilled = bills.reduce((a, b) => a + b.total, 0);
    const totalCollected =
      bills.reduce((a, b) => a + (b.paid ?? 0), 0);
    // المستحق = المتبقي الفعلي على كل فاتورة (نفس معادلة الخادم)، وليس إجمالي الفاتورة.
    const outstanding = unpaidBills.reduce((a, b) => a + billBalance(b, payments), 0);
    const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;

    // Water production vs consumption (NRW = Non-Revenue Water)
    const produced = productionLogs.reduce((a, p) => a + p.units, 0);
    const consumed = readings.reduce((a, r) => a + Math.max(0, r.consumption), 0);
    const billedVolume = bills.reduce((a, b) => {
      // approximate billed volume via reading linked to bill
      const r = readings.find((x) => x.id === b.reading_id);
      return a + (r ? Math.max(0, r.consumption) : 0);
    }, 0);
    const nrwVolume = Math.max(0, produced - billedVolume);
    const nrwPct = produced > 0 ? (nrwVolume / produced) * 100 : 0;
    const efficiencyPct = Math.max(0, 100 - nrwPct);

    // Consumption behavior
    const suspicious = readings.filter((r) => r.flag !== "ok");
    const okReadings = readings.filter((r) => r.flag === "ok");
    const avgConsumption =
      okReadings.length > 0
        ? okReadings.reduce((a, r) => a + r.consumption, 0) / okReadings.length
        : 0;

    // Daily per subscriber (assume monthly reading cycle → /30)
    const activeSubs = customers.filter((c) => c.status !== "rejected").length || customers.length;
    const totalConsumed30d = consumed; // simplification: dataset total
    const perCapitaDaily = activeSubs > 0 ? totalConsumed30d / activeSubs / 30 : 0;

    // Consumption categories
    const buckets = { normal: 0, high: 0, waste: 0 };
    readings.forEach((r) => {
      if (avgConsumption <= 0) {
        buckets.normal++;
        return;
      }
      if (r.consumption > avgConsumption * 2) buckets.waste++;
      else if (r.consumption > avgConsumption * 1.2) buckets.high++;
      else buckets.normal++;
    });

    return {
      produced,
      consumed,
      billedVolume,
      nrwVolume,
      nrwPct,
      efficiencyPct,
      collectionRate,
      totalCollected,
      outstanding,
      paidBills: paidBills.length,
      unpaidBills: unpaidBills.length,
      paymentsCount: counts.payments || payments.length,
      avgConsumption,
      perCapitaDaily,
      subscribers: counts.customers || customers.length,
      suspiciousCount: suspicious.length,
      buckets,
    };
  }, [customers, meters, readings, bills, payments, productionLogs, counts]);

  const productionChart = useMemo(() => {
    // group by month (YYYY-MM) using productionLogs vs readings consumption
    const map = new Map<string, { month: string; produced: number; consumed: number }>();
    const keyOf = (d: string) => d.slice(0, 7);
    productionLogs.forEach((p) => {
      const k = keyOf(p.date);
      const row = map.get(k) ?? { month: k, produced: 0, consumed: 0 };
      row.produced += p.units;
      map.set(k, row);
    });
    readings.forEach((r) => {
      const k = keyOf(r.date);
      const row = map.get(k) ?? { month: k, produced: 0, consumed: 0 };
      row.consumed += Math.max(0, r.consumption);
      map.set(k, row);
    });
    return Array.from(map.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6)
      .map((r) => ({
        ...r,
        loss: Math.max(0, r.produced - r.consumed),
      }));
  }, [productionLogs, readings]);

  const bucketsChart = [
    { name: "استهلاك طبيعي", value: k.buckets.normal, fill: "hsl(142 71% 45%)" },
    { name: "استهلاك مرتفع", value: k.buckets.high, fill: "hsl(38 92% 50%)" },
    { name: "هدر محتمل", value: k.buckets.waste, fill: "hsl(0 84% 60%)" },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">لوحة استدامة المياه</h1>
        <p className="text-sm text-muted-foreground mt-1">
          محرك ذكاء استدامة المياه (WSIE) — مؤشرات مباشرة من قاعدة البيانات
        </p>
      </div>

      {/* Top KPI row — 4 consolidated cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. Network Efficiency & NRW */}
        <KpiCard
          title="استدامة الشبكة والفاقد"
          icon={<Droplets className="w-5 h-5" />}
          tone="water"
        >
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[11px] text-muted-foreground">نسبة الفاقد (NRW)</div>
              <div className={`text-2xl font-bold ${k.nrwPct > 25 ? "text-destructive" : k.nrwPct > 15 ? "text-amber-600" : "text-emerald-600"}`}>
                {k.nrwPct.toFixed(1)}%
              </div>
            </div>
            <Badge variant={k.nrwPct > 25 ? "destructive" : "secondary"} className="text-[10px]">
              {k.nrwPct > 25 ? "مرتفع" : k.nrwPct > 15 ? "متوسط" : "منخفض"}
            </Badge>
          </div>
          <Progress value={Math.min(100, k.efficiencyPct)} className="h-1.5 mt-2" />
          <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
            <MiniStat label="مُنتجة" value={`${fmtNum(Math.round(k.produced))} م³`} />
            <MiniStat label="حجم الفاقد" value={`${fmtNum(Math.round(k.nrwVolume))} م³`} danger />
          </div>
        </KpiCard>

        {/* 2. Consumption Efficiency */}
        <KpiCard
          title="كفاءة الاستهلاك والترشيد"
          icon={<Leaf className="w-5 h-5" />}
          tone="eco"
        >
          <div>
            <div className="text-[11px] text-muted-foreground">متوسط الفرد اليومي</div>
            <div className="text-2xl font-bold text-emerald-600">
              {k.perCapitaDaily.toFixed(2)}
              <span className="text-xs font-normal text-muted-foreground"> م³/يوم</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
            <MiniStat label="قراءات منتظمة" value={fmtNum(Math.max(0, (counts.readings || readings.length) - k.suspiciousCount))} />
            <MiniStat label="قراءات شاذة" value={fmtNum(k.suspiciousCount)} danger={k.suspiciousCount > 0} />
          </div>
        </KpiCard>

        {/* 3. Financial Sustainability */}
        <KpiCard
          title="الاستدامة المالية والتحصيل"
          icon={<Wallet className="w-5 h-5" />}
          tone="gold"
        >
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[11px] text-muted-foreground">كفاءة التحصيل</div>
              <div className={`text-2xl font-bold ${k.collectionRate >= 70 ? "text-emerald-600" : k.collectionRate >= 40 ? "text-amber-600" : "text-destructive"}`}>
                {k.collectionRate.toFixed(1)}%
              </div>
            </div>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </div>
          <Progress value={Math.min(100, k.collectionRate)} className="h-1.5 mt-2" />
          <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
            <MiniStat label="محصّل" value={fmtYER(k.totalCollected)} />
            <MiniStat label="متأخرات" value={fmtYER(k.outstanding)} danger={k.outstanding > 0} />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {fmtNum(counts.bills || bills.length)} فاتورة · {fmtNum(k.paymentsCount)} دفعة
          </div>
        </KpiCard>

        {/* 4. Safety & Subscribers */}
        <KpiCard
          title="السلامة والمشتركون"
          icon={<ShieldCheck className="w-5 h-5" />}
          tone={k.suspiciousCount > 0 ? "danger" : "eco"}
        >
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[11px] text-muted-foreground">إجمالي المشتركين</div>
              <div className="text-2xl font-bold">{fmtNum(k.subscribers)}</div>
            </div>
            <Users className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
            <MiniStat label="عدادات نشطة" value={fmtNum(meters.filter((m) => m.status === "active").length)} />
            <MiniStat
              label="تنبيهات نشطة"
              value={fmtNum(k.suspiciousCount)}
              danger={k.suspiciousCount > 0}
            />
          </div>
        </KpiCard>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              كفاءة الضخ مقابل الاستهلاك (آخر 6 أشهر)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {productionChart.length === 0 ? (
              <EmptyState text="لا توجد بيانات إنتاج بعد. سجّل قراءات الإنتاج من صفحة تحليل الفاقد." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productionChart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} reversed />
                  <YAxis tick={{ fontSize: 11 }} orientation="right" />
                  <Tooltip formatter={(v: number) => `${fmtNum(v)} م³`} />
                  <Legend />
                  <Bar dataKey="produced" name="مُنتج" fill="hsl(199 89% 48%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="consumed" name="مُستهلَك مُفوتَر" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="loss" name="فاقد" fill="hsl(0 84% 60%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Leaf className="w-4 h-4 text-emerald-600" />
              توزيع الاستهلاك حسب الفئة
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {readings.length === 0 ? (
              <EmptyState text="لا توجد قراءات بعد." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={bucketsChart}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {bucketsChart.map((b, i) => (
                      <Cell key={i} fill={b.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtNum(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            التنبيهات الذكية النشطة
          </CardTitle>
          <Badge variant={k.suspiciousCount > 0 ? "destructive" : "outline"}>
            {fmtNum(k.suspiciousCount)}
          </Badge>
        </CardHeader>
        <CardContent>
          {k.suspiciousCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد قراءات شاذة حالياً. النظام يراقب الشبكة تلقائياً ويكشف: التسريب، التلاعب،
              والقفزات غير الطبيعية (أكثر من ٣× المتوسط).
            </p>
          ) : (
            <ul className="space-y-2">
              {readings
                .filter((r) => r.flag !== "ok")
                .slice(0, 8)
                .map((r) => {
                  const m = meters.find((x) => x.id === r.meter_id);
                  const c = customers.find((x) => x.id === m?.customer_id);
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/40 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold">{c?.name ?? "مشترك"}</span>
                        <span className="text-muted-foreground"> — عداد {m?.number ?? "—"}</span>
                      </div>
                      <Badge variant={r.flag === "error" ? "destructive" : "secondary"}>
                        {r.flag === "error" ? "قراءة خاطئة" : "استهلاك مشبوه"}
                      </Badge>
                    </li>
                  );
                })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "water" | "eco" | "gold" | "danger";
  children: React.ReactNode;
}) {
  const toneMap = {
    water: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    eco: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    gold: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger: "bg-red-500/10 text-red-600 dark:text-red-400",
  };
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-muted-foreground">{title}</div>
          <div className={`w-9 h-9 rounded-lg grid place-items-center ${toneMap[tone]}`}>{icon}</div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-xs font-bold truncate ${danger ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-full grid place-items-center text-center">
      <p className="text-sm text-muted-foreground max-w-xs">{text}</p>
    </div>
  );
}
