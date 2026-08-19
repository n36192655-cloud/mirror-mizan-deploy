import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertCircle, CheckCircle2, Camera, MapPin, ShieldAlert,
  Check, X, Image as ImageIcon, Loader2, RefreshCw,
} from "lucide-react";
import { fmtYER } from "@/lib/pricing";
import { MeterCamera } from "@/components/meter-camera";
import { getGeoFix, type GeoFix } from "@/lib/geolocation";
import { addPending } from "@/lib/sync";
import type { Database } from "@/integrations/supabase/types";

type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
type ReadingRow = Database["public"]["Tables"]["water_readings"]["Row"];
type BillRow = Database["public"]["Tables"]["water_bills"]["Row"];

export const Route = createFileRoute("/readings")({
  head: () => ({ meta: [{ title: "القراءات — ميزان" }] }),
  component: ReadingsPage,
});

function ReadingsPage() {
  const { user } = useAuth();
  const isReader = user?.role === "reader";
  const tenantId = user?.tenantId;

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [readings, setReadings] = useState<ReadingRow[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [meterLinks, setMeterLinks] = useState<{ id: string; number: string; customer_id: string }[]>([]);
  // العدد الحقيقي في قاعدة البيانات (COUNT(*)) لا طول المصفوفة المحمّلة.
  const [readingsCount, setReadingsCount] = useState(0);
  const [billsCount, setBillsCount] = useState(0);
  const [loading, setLoading] = useState(true);


  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [meterId, setMeterId] = useState<string | null>(null);
  const [current, setCurrent] = useState<string>("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | undefined>();
  const [ocrSerial, setOcrSerial] = useState<string | undefined>();
  const [geo, setGeo] = useState<GeoFix | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readingDate, setReadingDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<"input" | "pending" | "log" | "bills">("input");

  const selectedCustomer = customerId ? customers.find((c) => c.id === customerId) ?? null : null;

  const meterByCustomer = useMemo(() => {
    const map = new Map<string, { id: string; number: string; customer_id: string }>();
    meterLinks.forEach((l) => map.set(l.customer_id, l));
    return map;
  }, [meterLinks]);

  const meterSerialById = useMemo(() => {
    const map = new Map<string, string>();
    meterLinks.forEach((l) => map.set(l.id, l.number));
    return map;
  }, [meterLinks]);

  const selectedMeter = meterId ? { id: meterId, number: meterSerialById.get(meterId) ?? "" } : null;
  const meterNumber = selectedMeter?.number ?? "";

  const lastReading = useMemo(() => {
    if (!meterId) return null;
    return readings
      .filter((r) => r.meter_id === meterId && r.status !== "rejected")
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null;
  }, [readings, meterId]);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [cs, rs, bs, rc, bc, ma] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("water_readings").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("water_bills").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("water_readings").select("id", { count: "exact", head: true }),
      supabase.from("water_bills").select("id", { count: "exact", head: true }),
      supabase
        .from("meter_assignments")
        .select("meter_id, customer_id, ended_at, meters(serial)")
        .is("ended_at", null),
    ]);
    if (cs.error) toast.error("تعذّر جلب المشتركين");
    else setCustomers(cs.data ?? []);
    if (!rs.error) setReadings(rs.data ?? []);
    if (!bs.error) setBills(bs.data ?? []);
    if (!rc.error) setReadingsCount(rc.count ?? 0);
    if (!bc.error) setBillsCount(bc.count ?? 0);
    if (!ma.error) {
      setMeterLinks(
        (ma.data ?? [])
          .filter((a) => a.customer_id && a.meter_id)
          .map((a) => ({
            id: a.meter_id as string,
            customer_id: a.customer_id as string,
            number: ((a as unknown as { meters?: { serial?: string } }).meters?.serial) ?? "",
          })),
      );
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void refresh(); }, [refresh]);


  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`readings-live-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "water_readings", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === "INSERT") setReadingsCount((n) => n + 1);
          if (payload.eventType === "DELETE") setReadingsCount((n) => Math.max(0, n - 1));
          setReadings((prev) => {
            if (payload.eventType === "INSERT") return [payload.new as ReadingRow, ...prev];
            if (payload.eventType === "UPDATE") {
              const upd = payload.new as ReadingRow;
              return prev.map((r) => (r.id === upd.id ? upd : r));
            }
            if (payload.eventType === "DELETE") {
              const old = payload.old as ReadingRow;
              return prev.filter((r) => r.id !== old.id);
            }
            return prev;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "water_bills", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === "INSERT") setBillsCount((n) => n + 1);
          if (payload.eventType === "DELETE") setBillsCount((n) => Math.max(0, n - 1));
          setBills((prev) => {
            if (payload.eventType === "INSERT") {
              const b = payload.new as BillRow;
              toast.success(`صدرت فاتورة جديدة بقيمة ${fmtYER(b.total)}`);
              return [b, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const upd = payload.new as BillRow;
              return prev.map((b) => (b.id === upd.id ? upd : b));
            }
            if (payload.eventType === "DELETE") {
              const old = payload.old as BillRow;
              return prev.filter((b) => b.id !== old.id);
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  const pending = useMemo(
    () => readings.filter((r) => r.status === "pending_approval"),
    [readings],
  );

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return customers.slice(0, 8);
    const norm = (v: string) => v.toLowerCase().replace(/[-\s]/g, "");
    return customers.filter((c) => {
      if (c.name.toLowerCase().includes(query)) return true;
      const serial = meterByCustomer.get(c.id)?.number;
      if (serial && norm(serial).includes(norm(query))) return true;
      if (c.phone && c.phone.includes(query)) return true;
      return false;
    }).slice(0, 15);
  }, [q, customers, meterByCustomer]);

  function pickCustomer(c: CustomerRow) {
    const m = meterByCustomer.get(c.id) ?? null;
    setCustomerId(c.id);
    setMeterId(m?.id ?? null);
    setQ(`${c.name}${m ? " · " + m.number : ""}`);
    if (!m) toast.error("لا يوجد عداد مرتبط بهذا المشترك — اربط عداداً من صفحة المشتركين");
  }

  function handleCapture(file: File, previewUrl: string) {
    setPhotoBlob(file);
    setPhotoPreview(previewUrl);
    setOcrSerial(undefined);
    toast.success("تم إرفاق صورة العداد");
  }

  function clearPhoto() {
    setPhotoBlob(null);
    setPhotoPreview(undefined);
  }

  async function captureGeo() {
    setGeoBusy(true);
    try {
      const fix = await getGeoFix();
      setGeo(fix);
      toast.success(`تم تحديد الموقع (${fix.accuracy.toFixed(0)} م)`);
    } catch (e) {
      toast.error(`فشل تحديد الموقع: ${(e as Error).message}`);
    } finally { setGeoBusy(false); }
  }

  function resetForm() {
    setCurrent(""); setPhotoBlob(null); setPhotoPreview(undefined);
    setOcrSerial(undefined); setGeo(null);
    setReadingDate(new Date().toISOString().slice(0, 10));
  }

  async function saveReading() {
    if (!tenantId || !user) return toast.error("لا توجد جلسة نشطة");
    if (!selectedCustomer) return toast.error("اختر مشتركاً");
    if (!selectedMeter) return toast.error("لا يوجد عداد مرتبط بهذا المشترك");
    if (current === "" || Number.isNaN(+current)) return toast.error("أدخل القراءة الحالية");

    if (ocrSerial &&
        ocrSerial.replace(/[-\s]/g, "").toUpperCase() !==
        meterNumber.replace(/[-\s]/g, "").toUpperCase()) {
      return toast.error(`رفض: رقم العداد الملتقط (${ocrSerial}) لا يطابق (${meterNumber})`);
    }

    let fix = geo;
    if (!fix && isReader) {
      try { fix = await getGeoFix(); setGeo(fix); }
      catch (e) { return toast.error(`الموقع مطلوب للقارئ: ${(e as Error).message}`); }
    }

    setSaving(true);
    try {
      const clientUuid = crypto.randomUUID();

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        addPending({
          clientId: clientUuid,
          meterId: selectedMeter.id,
          meterNumber: selectedMeter.number,
          customerId: customerId!,
          current: +current,
          readingDate,
          by: user.userId,
          latitude: fix?.lat,
          longitude: fix?.lng,
          accuracy: fix?.accuracy,
          tenantId,
        });
        toast.success("لا يوجد اتصال — حُفظت القراءة محلياً وسترسل تلقائياً عند عودة الشبكة");
        resetForm();
        return;
      }

      let photoUrl: string | null = null;
      if (photoBlob) {
        const path = `tenants/${tenantId}/readings/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage
          .from("meter-readings")
          .upload(path, photoBlob, { contentType: photoBlob.type, upsert: false });
        if (up.error) throw new Error(`رفع الصورة فشل: ${up.error.message}`);
        photoUrl = path;
      }

      const { error } = await supabase.from("water_readings").insert({
        tenant_id: tenantId,
        customer_id: customerId!,
        meter_id: selectedMeter.id,
        current_reading: +current,
        reading_date: readingDate,
        client_uuid: clientUuid,
        reader_id: user.userId,
        photo_url: photoUrl,
        lat: fix?.lat ?? null,
        lng: fix?.lng ?? null,
        gps_verified: !!fix,
      } as Database["public"]["Tables"]["water_readings"]["Insert"]);

      if (error) {
        if (error.code === "23505" && /one_per_meter_day/.test(error.message)) {
          throw new Error("توجد قراءة مسجلة لهذا العداد في نفس التاريخ");
        }
        throw new Error(error.message);
      }

      toast.success("تم حفظ القراءة — يجري إصدار الفاتورة تلقائياً");
      resetForm();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  }

  async function approve(id: string) {
    const { error } = await supabase.rpc("approve_reading", { _reading_id: id });
    if (error) return toast.error("فشل الاعتماد: " + error.message);
    toast.success("تم الاعتماد — ستصدر الفاتورة تلقائياً");
  }

  async function reject(id: string) {
    const reason = window.prompt("سبب الرفض؟") ?? undefined;
    const { error } = await (supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    }).rpc("reject_reading", { _reading_id: id, _reason: reason ?? null });
    if (error) {
      return toast.error(
        /already has payments/.test(error.message)
          ? "تعذّر الرفض: الفاتورة عليها دفعات مسجلة"
          : "فشل الرفض: " + error.message,
      );
    }
    toast.info("تم الرفض وإلغاء الفاتورة المرتبطة");
    void refresh();
  }

  const photoSignedUrl = useCallback(async (path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data } = await supabase.storage.from("meter-readings").createSignedUrl(path, 600);
    return data?.signedUrl ?? null;
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">القراءات</h1>
          <p className="text-sm text-muted-foreground mt-1">
            بيانات حية — يتم رفع الصور إلى مخزن معزول للمشروع وحساب الفواتير تلقائياً على السيرفر
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ms-1 ${loading ? "animate-spin" : ""}`} /> تحديث
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={tab === "input" ? "default" : "outline"} onClick={() => setTab("input")}>إدخال</Button>
        {!isReader && (
          <Button size="sm" variant={tab === "pending" ? "default" : "outline"} onClick={() => setTab("pending")}>
            بانتظار الاعتماد {pending.length > 0 && <Badge className="ms-1" variant="secondary">{pending.length}</Badge>}
          </Button>
        )}
        {!isReader && (
          <Button size="sm" variant={tab === "log" ? "default" : "outline"} onClick={() => setTab("log")}>
            سجل القراءات
          </Button>
        )}
        <Button size="sm" variant={tab === "bills" ? "default" : "outline"} onClick={() => setTab("bills")}>
          الفواتير الحية {billsCount > 0 && <Badge className="ms-1" variant="secondary">{billsCount}</Badge>}
        </Button>
      </div>

      {tab === "input" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>تسجيل قراءة</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={captureGeo} disabled={geoBusy}>
                <MapPin className="w-4 h-4 ms-1" /> {geo ? "✓ موقع مسبق" : "تحديد الموقع"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCameraOpen((v) => !v)}>
                <Camera className="w-4 h-4 ms-1" /> {cameraOpen ? "إخفاء الكاميرا" : "تصوير العداد"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="mb-1 block">بحث عن المشترك (الاسم / رقم العداد / الهاتف)</Label>
              <Input value={q} onChange={(e) => { setQ(e.target.value); setCustomerId(null); }} placeholder="ابدأ الكتابة…" />
              {q && !selectedCustomer && (
                <div className="mt-2 border rounded-md divide-y max-h-64 overflow-auto">
                  {results.length === 0 && <div className="p-3 text-sm text-muted-foreground text-center">لا نتائج</div>}
                  {results.map((c) => (
                    <button key={c.id} type="button" onClick={() => pickCustomer(c)}
                      className="w-full text-right p-2 hover:bg-muted/50 text-sm flex justify-between items-center gap-3">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground font-mono" dir="ltr">
                        {meterByCustomer.get(c.id)?.number ?? "بدون عداد"} · {c.phone ?? "—"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedCustomer && (
              <div className="rounded-lg border p-3 bg-muted/30 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Info label="الاسم">{selectedCustomer.name}</Info>
                <Info label="الهاتف"><span dir="ltr">{selectedCustomer.phone ?? "—"}</span></Info>
                <Info label="القراءة السابقة"><span className="font-mono">{lastReading?.current_reading ?? 0}</span></Info>
                <Info label="الرصيد">{fmtYER(selectedCustomer.balance)}</Info>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>رقم العداد</Label>
                <Input value={meterNumber} readOnly dir="ltr" className="font-mono bg-muted/40"
                  placeholder="يُحدَّد تلقائياً من العداد المرتبط بالمشترك" />
              </div>
              <div>
                <Label>القراءة الحالية</Label>
                <Input type="number" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>تاريخ القراءة</Label>
                <Input
                  type="date" dir="ltr" value={readingDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setReadingDate(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  القراءات بأثر رجعي تُحفظ بانتظار اعتماد المدير.
                </p>
              </div>
            </div>

            <Button onClick={saveReading} size="lg" disabled={saving || geoBusy} className="w-full md:w-auto">
              {saving ? <><Loader2 className="w-4 h-4 ms-1 animate-spin" /> جاري الحفظ…</> : "حفظ القراءة"}
            </Button>

            {(photoPreview || ocrSerial || geo) && (
              <div className="flex flex-wrap gap-2 text-xs items-center">
                {photoPreview && (
                  <>
                    <Badge variant="outline" className="gap-1"><ImageIcon className="w-3 h-3" /> صورة جاهزة</Badge>
                    <img src={photoPreview} alt="preview" className="h-16 rounded border" />
                  </>
                )}
                {ocrSerial && (
                  <Badge variant={ocrSerial.replace(/[-\s]/g, "").toUpperCase() === meterNumber.replace(/[-\s]/g, "").toUpperCase() ? "default" : "destructive"} className="gap-1">
                    <ShieldAlert className="w-3 h-3" /> OCR: {ocrSerial}
                  </Badge>
                )}
                {geo && <Badge variant="outline" className="gap-1"><MapPin className="w-3 h-3" /> {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}</Badge>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "input" && cameraOpen && (
        <Card>
          <CardHeader><CardTitle>صورة العداد</CardTitle></CardHeader>
          <CardContent>
            <MeterCamera
              onCapture={handleCapture}
              onClear={clearPhoto}
              initialPreview={photoPreview}
            />
          </CardContent>
        </Card>
      )}

      {tab === "pending" && !isReader && (
        <Card>
          <CardHeader><CardTitle>قراءات بانتظار الاعتماد ({pending.length})</CardTitle></CardHeader>
          <CardContent className="p-4 space-y-3">
            {pending.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">لا يوجد قراءات معلقة</p>}
            {pending.map((r) => {
              const c = customers.find((x) => x.id === r.customer_id);
              return (
                <div key={r.id} className="rounded-lg border p-3 grid md:grid-cols-[1fr_auto] gap-3 items-start">
                  <div className="text-xs space-y-1">
                    <div className="text-sm font-semibold">{c?.name ?? "—"} — <span className="font-mono">{meterSerialById.get(r.meter_id ?? "") ?? "—"}</span></div>
                    <div className="text-muted-foreground">
                      قراءة {r.previous} → <span className="text-foreground font-mono">{r.current_reading}</span> · استهلاك {r.consumption}
                    </div>
                    <div className="flex gap-2 flex-wrap text-[11px] text-muted-foreground">
                      {r.lat != null && r.lng != null && (
                        <a className="underline hover:text-primary" href={`https://maps.google.com/?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">
                          <MapPin className="inline w-3 h-3" /> {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                        </a>
                      )}
                      <span>{new Date(r.created_at).toLocaleString("ar")}</span>
                      {r.photo_url && <PhotoLink path={r.photo_url} loader={photoSignedUrl} />}
                    </div>
                  </div>
                  <div className="flex md:flex-col gap-2">
                    <Button size="sm" onClick={() => approve(r.id)}>
                      <Check className="w-3 h-3 ms-1" /> اعتماد
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => reject(r.id)}>
                      <X className="w-3 h-3 ms-1" /> رفض
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {tab === "log" && !isReader && (
        <Card>
          <CardHeader><CardTitle>سجل القراءات ({readingsCount})</CardTitle></CardHeader>
          <CardContent className="p-4 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">العداد</TableHead>
                  <TableHead className="text-right">المشترك</TableHead>
                  <TableHead className="text-right">السابقة</TableHead>
                  <TableHead className="text-right">الحالية</TableHead>
                  <TableHead className="text-right">الاستهلاك</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readings.slice(0, 200).map((r) => {
                  const c = customers.find((x) => x.id === r.customer_id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString("ar-EG")}</TableCell>
                      <TableCell className="font-mono">{meterSerialById.get(r.meter_id ?? "") ?? "—"}</TableCell>
                      <TableCell>{c?.name ?? "—"}</TableCell>
                      <TableCell>{r.previous}</TableCell>
                      <TableCell>{r.current_reading}</TableCell>
                      <TableCell className="font-semibold">{r.consumption}</TableCell>
                      <TableCell>
                        {r.status === "pending_approval" ? (
                          <Badge variant="secondary">معلقة</Badge>
                        ) : r.status === "rejected" ? (
                          <Badge variant="destructive"><X className="w-3 h-3 ms-1" /> مرفوضة</Badge>
                        ) : r.flag === "suspicious" ? (
                          <Badge variant="secondary" className="gap-1"><AlertCircle className="w-3 h-3" /> مشبوهة</Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1"><CheckCircle2 className="w-3 h-3" /> معتمدة</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "bills" && (
        <Card>
          <CardHeader><CardTitle>الفواتير الحية ({billsCount})</CardTitle></CardHeader>
          <CardContent className="p-4 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">المشترك</TableHead>
                  <TableHead className="text-right">الاستهلاك</TableHead>
                  <TableHead className="text-right">متأخرات</TableHead>
                  <TableHead className="text-right">الإجمالي</TableHead>
                  <TableHead className="text-right">مدفوع</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.slice(0, 200).map((b) => {
                  const c = customers.find((x) => x.id === b.customer_id);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs">{new Date(b.created_at).toLocaleDateString("ar-EG")}</TableCell>
                      <TableCell>{c?.name ?? "—"}</TableCell>
                      <TableCell>{fmtYER(b.subtotal)}</TableCell>
                      <TableCell>{b.arrears > 0 ? <span className="text-destructive">{fmtYER(b.arrears)}</span> : "—"}</TableCell>
                      <TableCell className="font-bold">{fmtYER(b.total)}</TableCell>
                      <TableCell>{fmtYER(b.paid_amount)}</TableCell>
                      <TableCell>
                        <Badge variant={b.status === "paid" ? "default" : b.status === "partial" ? "secondary" : "destructive"}>
                          {b.status === "paid" ? "مدفوعة" : b.status === "partial" ? "جزئية" : "غير مدفوعة"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PhotoLink({ path, loader }: { path: string; loader: (p: string) => Promise<string | null> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { void loader(path).then(setUrl); }, [path, loader]);
  if (!url) return <span>📷 صورة</span>;
  return <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-primary">📷 عرض الصورة</a>;
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className="text-sm font-medium mt-0.5">{children}</div>
    </div>
  );
}
