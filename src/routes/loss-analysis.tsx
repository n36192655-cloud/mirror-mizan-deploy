import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, Droplets, Trash2, Camera, TrendingDown } from "lucide-react";
import { fmtNum } from "@/lib/pricing";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

export const Route = createFileRoute("/loss-analysis")({
  head: () => ({ meta: [{ title: "تحليل فاقد المياه — ميزان" }] }),
  component: LossAnalysisPage,
});

const LOSS_THRESHOLD = 15; // %

// تعديل لضمان استخراج التاريخ بناءً على التوقيت المحلي للميدان وليس توقيت UTC العالمي
function todayISO() { 
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10); 
}

function monthAgoISO() {
  const d = new Date(); 
  d.setMonth(d.getMonth() - 1);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function LossAnalysisPage() {
  const { productionLogs, addProductionLog, deleteProductionLog, readings, meters } = useStore();
  const [units, setUnits] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const [from, setFrom] = useState(monthAgoISO());
  const [to, setTo] = useState(todayISO());

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    
    // تنبيه تقني: تخزين Base64 محلياً يستهلك مساحة المتصفح سرياً إذا تخطت الصور حجم 5 ميجا
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(f);
  }

  function submit() {
    const n = Number(units);
    if (!n || n <= 0) return toast.error("أدخل قيمة إنتاج صحيحة");
    addProductionLog({ type: "water", units: n, note, photo, date: new Date().toISOString() });
    setUnits(""); setNote(""); setPhoto(undefined);
    if (fileRef.current) fileRef.current.value = "";
    toast.success("تم تسجيل الإنتاج");
  }

  const analytics = useMemo(() => {
    const fromT = new Date(from).getTime();
    const toT = new Date(to).getTime() + 24 * 3600 * 1000 - 1;
    
    const inRange = (d: string) => {
      const t = new Date(d).getTime();
      return t >= fromT && t <= toT;
    };
    
    const waterMeters = new Set(meters.map((m) => m.id));
    
    // تحسين الأداء: دمج العمليات في حلقة reduce واحدة مباشرة لتوفير الذاكرة والمعالجة
    const produced = productionLogs.reduce((acc, p) => inRange(p.date) ? acc + p.units : acc, 0);
    const consumed = readings.reduce((acc, r) => (waterMeters.has(r.meter_id) && inRange(r.date)) ? acc + r.consumption : acc, 0);
    
    const loss = Math.max(0, produced - consumed);
    const pct = produced > 0 ? (loss / produced) * 100 : 0;
    
    return { produced, consumed, loss, pct };
  }, [productionLogs, readings, meters, from, to]);

  // تحسين الأداء: تغليف بيانات المخطط بـ useMemo لمنع الـ Re-render غير المبرر للمكون الرسومي
  const chartData = useMemo(() => [
    { name: "المياه (م³)", produced: analytics.produced, consumed: analytics.consumed, loss: analytics.loss },
  ], [analytics]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">تحليل فاقد المياه والتسرب</h1>
        <p className="text-sm text-muted-foreground mt-1">قياس الفرق بين إنتاج المياه من المصدر واستهلاك المشتركين</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">تسجيل إنتاج مياه جديد</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>إجمالي الوحدات (م³)</Label>
              <Input type="number" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="مثال: 12500" />
            </div>
            <div>
              <Label>ملاحظة</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: قراءة عداد المضخة الرئيسية بتاريخ..." />
            </div>
            <div>
              <Label>تصوير العداد الرئيسي للمياه</Label>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPickPhoto}
                className="block w-full text-xs file:me-2 file:py-1.5 file:px-3 file:rounded-md file:border file:bg-muted file:text-foreground" />
              {photo && <img src={photo} alt="عداد رئيسي" className="mt-2 h-32 w-full object-cover rounded-lg border" />}
            </div>
            <Button onClick={submit} className="w-full"><Camera className="w-4 h-4 ms-1" /> حفظ الإنتاج</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">فلترة الفترة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>من تاريخ</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <Label>إلى تاريخ</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div className="pt-2">
              <LossStat label="فاقد المياه" pct={analytics.pct} loss={analytics.loss} unit="م³" icon={<Droplets className="w-4 h-4" />} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">المُنتج مقابل المُفوتر</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtNum(v)} />
              <Legend />
              <Bar dataKey="produced" name="مُنتج" fill="var(--water)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="consumed" name="مُستهلك" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              <Bar dataKey="loss" name="فاقد" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {analytics.pct > LOSS_THRESHOLD && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold">تنبيه ذكي — نسبة الفاقد مرتفعة</div>
              <div className="text-muted-foreground mt-1">
                فاقد المياه {analytics.pct.toFixed(1)}% — يوصى بفحص شبكة التوزيع لاحتمال وجود تسرب أو استهلاك غير مُقاس.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">سجلات الإنتاج</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {productionLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">لا توجد سجلات بعد.</p>
          ) : (
            productionLogs.slice().sort((a, b) => +new Date(b.date) - +new Date(a.date)).map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3 border rounded-lg">
                {p.photo ? <img src={p.photo} alt="" className="w-12 h-12 object-cover rounded" /> : <div className="w-12 h-12 bg-muted rounded grid place-items-center"><TrendingDown className="w-4 h-4 text-muted-foreground" /></div>}
                <div className="flex-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge>مياه</Badge>
                    <span className="font-semibold">{fmtNum(p.units)} م³</span>
                    <span className="text-xs text-muted-foreground">{new Date(p.date).toLocaleString("ar-YE")}</span>
                  </div>
                  {p.note && <div className="text-xs text-muted-foreground mt-0.5">{p.note}</div>}
                </div>
                <Button size="icon" variant="ghost" onClick={() => deleteProductionLog(p.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LossStat({ label, pct, loss, unit, icon }: { label: string; pct: number; loss: number; unit: string; icon: React.ReactNode }) {
  const danger = pct > LOSS_THRESHOLD;
  return (
    <div className={`p-3 rounded-lg border ${danger ? "border-destructive/40 bg-destructive/5" : "bg-muted/30"}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-xl font-bold mt-1 ${danger ? "text-destructive" : ""}`}>{pct.toFixed(1)}%</div>
      <div className="text-[11px] text-muted-foreground">{fmtNum(loss)} {unit}</div>
    </div>
  );
}