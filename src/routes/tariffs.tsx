import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Save, Loader2, Layers, Droplets, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTariff, priceWithTariff, type Tier } from "@/lib/tariff";
import { fmtYER } from "@/lib/pricing";

export const Route = createFileRoute("/tariffs")({
  head: () => ({
    meta: [
      { title: "التعرفة الشرائحية — ميزان" },
      { name: "description", content: "ضبط شرائح تسعير المياه التصاعدية واحتسابها تلقائياً في قاعدة البيانات." },
      { property: "og:title", content: "التعرفة الشرائحية — ميزان" },
      { property: "og:description", content: "لوحة مدير المشروع لضبط التسعير الشرائحي المستدام." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TariffsPage,
});

function TariffsPage() {
  const { load, save, loading, loaded, name: dbName, fixedFee: dbFee, tiers: dbTiers } = useTariff();
  const [name, setName] = useState("التعرفة الأساسية");
  const [fixedFee, setFixedFee] = useState(0);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [saving, setSaving] = useState(false);
  const [simUnits, setSimUnits] = useState(10);
  const [simFamily, setSimFamily] = useState(6);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!loaded) return;
    setName(dbName);
    setFixedFee(dbFee);
    setTiers(dbTiers.length ? dbTiers : [
      { tier_order: 1, upper_bound: 5, rate_per_m3: 100 },
      { tier_order: 2, upper_bound: 12, rate_per_m3: 250 },
      { tier_order: 3, upper_bound: null, rate_per_m3: 500 },
    ]);
  }, [loaded, dbName, dbFee, dbTiers]);

  function update(i: number, patch: Partial<Tier>) {
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function addTier() {
    setTiers((ts) => {
      const bounded = ts.filter((t) => t.upper_bound != null);
      const lastBound = bounded.length ? Number(bounded[bounded.length - 1].upper_bound) : 0;
      const open = ts.find((t) => t.upper_bound == null);
      const next: Tier = { tier_order: 0, upper_bound: lastBound + 5, rate_per_m3: 0 };
      const list = open ? [...bounded, next, open] : [...bounded, next];
      return list.map((t, i) => ({ ...t, tier_order: i + 1 }));
    });
  }
  function removeTier(i: number) {
    setTiers((ts) => ts.filter((_, idx) => idx !== i).map((t, idx) => ({ ...t, tier_order: idx + 1 })));
  }

  async function onSave() {
    setSaving(true);
    const res = await save({ name: name.trim() || "التعرفة الأساسية", fixedFee, tiers });
    setSaving(false);
    if (res.ok) toast.success("تم حفظ التعرفة — سيتم الاحتساب تلقائياً في قاعدة البيانات");
    else toast.error(res.error ?? "تعذّر الحفظ");
  }

  const simAmount = useMemo(() => priceWithTariff(fixedFee, tiers, simUnits), [fixedFee, tiers, simUnits]);
  const lpcd = useMemo(
    () => (simFamily > 0 ? (simUnits * 1000) / (simFamily * 30) : 0),
    [simUnits, simFamily],
  );
  const sustain =
    lpcd < 50 ? { label: "دون الحد الأدنى الأممي (50 ل/ف/ي)", tone: "warn" }
    : lpcd <= 100 ? { label: "استهلاك مستدام ضمن النطاق الموصى به", tone: "ok" }
    : { label: "استهلاك مرتفع — يستوجب توعية وترشيد", tone: "high" };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Layers className="w-6 h-6 text-primary" /> التعرفة الشرائحية
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          تسعير تصاعدي: المستهلك الأكبر يدفع أكثر. تُحفظ الشرائح في قاعدة البيانات وتُحتسب الفواتير تلقائياً عند اعتماد القراءة.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">شرائح الاستهلاك (م³)</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
              <Button size="sm" variant="secondary" onClick={addTier}><Plus className="w-4 h-4 ms-1" /> شريحة</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>اسم التعرفة</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>الرسوم الثابتة (ريال / فاتورة)</Label>
                <Input
                  type="number" dir="ltr" min={0} value={fixedFee}
                  onChange={(e) => setFixedFee(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">#</TableHead>
                    <TableHead className="text-right">حتى (م³)</TableHead>
                    <TableHead className="text-right">السعر (ريال/م³)</TableHead>
                    <TableHead className="text-right">النطاق</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((t, i) => {
                    const prev = i === 0 ? 0 : Number(tiers[i - 1].upper_bound ?? 0);
                    return (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          {t.upper_bound == null ? (
                            <Badge variant="outline">ما فوق</Badge>
                          ) : (
                            <Input
                              className="w-28" dir="ltr" type="number" min={0}
                              value={t.upper_bound}
                              onChange={(e) => update(i, { upper_bound: Number(e.target.value) || 0 })}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            className="w-32" dir="ltr" type="number" min={0}
                            value={t.rate_per_m3}
                            onChange={(e) => update(i, { rate_per_m3: Number(e.target.value) || 0 })}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.upper_bound == null ? `أكثر من ${prev} م³` : `${prev} – ${t.upper_bound} م³`}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => removeTier(i)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <Button onClick={onSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin ms-1" /> : <Save className="w-4 h-4 ms-1" />}
                حفظ التعرفة
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Droplets className="w-4 h-4 text-water" /> محاكاة الفاتورة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>الاستهلاك الشهري (م³)</Label>
              <Input dir="ltr" type="number" min={0} value={simUnits} onChange={(e) => setSimUnits(Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>عدد أفراد الأسرة</Label>
              <Input dir="ltr" type="number" min={1} value={simFamily} onChange={(e) => setSimFamily(Number(e.target.value) || 1)} />
            </div>
            <div className="rounded-lg border p-3 bg-muted/30 space-y-1">
              <div className="text-xs text-muted-foreground">قيمة الفاتورة المتوقعة</div>
              <div className="text-2xl font-bold">{fmtYER(simAmount)}</div>
            </div>
            <div className="rounded-lg border p-3 space-y-1">
              <div className="text-xs text-muted-foreground">نصيب الفرد اليومي</div>
              <div className="text-lg font-semibold" dir="ltr">{lpcd.toFixed(1)} L/person/day</div>
              <Badge variant={sustain.tone === "ok" ? "default" : "outline"} className="mt-1">{sustain.label}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-5">
              المعاينة إرشادية فقط؛ القيمة المالية المعتمدة تُحتسب داخل قاعدة البيانات بنفس الشرائح لضمان عدم التلاعب.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
