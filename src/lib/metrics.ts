import type { Bill, Payment, ProductionLog, Reading } from "@/lib/store";
import { billBalance } from "@/lib/store";

/**
 * مصدر الحساب الموحّد لكل مؤشرات الاستدامة والفاقد والتحصيل.
 * كل الشاشات (لوحة القيادة، تحليل الفاقد، ...) تستدعي هذه الدوال
 * حتى لا توجد معادلات مختلفة لنفس المؤشر.
 */

export interface DateRange {
  /** YYYY-MM-DD */
  from?: string;
  /** YYYY-MM-DD */
  to?: string;
}

export function inDateRange(date: string, range?: DateRange): boolean {
  if (!range?.from && !range?.to) return true;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return false;
  if (range.from) {
    const f = new Date(range.from).getTime();
    if (t < f) return false;
  }
  if (range.to) {
    const to = new Date(range.to).getTime() + 24 * 3600 * 1000 - 1;
    if (t > to) return false;
  }
  return true;
}

/** استهلاك القراءة بعد التطبيع (لا قيم سالبة). */
export function readingConsumption(r: Reading): number {
  return Math.max(0, Number(r.consumption || 0));
}

export interface WaterMetrics {
  /** إجمالي المياه المُنتجة من المصدر (م³). */
  produced: number;
  /** إجمالي الاستهلاك المُقاس بالعدادات (م³). */
  consumed: number;
  /** الحجم المُفوتر فعلياً (استهلاك القراءات المرتبطة بفواتير). */
  billedVolume: number;
  /** الفاقد غير المُدِر للإيراد = المُنتج − المُفوتر. */
  nrwVolume: number;
  nrwPct: number;
  efficiencyPct: number;
  /** الفاقد الفيزيائي التقديري = المُنتج − المُقاس. */
  unmeasuredVolume: number;
}

/**
 * معادلة الفاقد الموحّدة: NRW = (المُنتج − المُفوتر) ÷ المُنتج.
 * تُطبَّق نفس المعادلة في كل الشاشات مع إمكانية تحديد فترة زمنية.
 */
export function computeWaterMetrics(
  input: { productionLogs: ProductionLog[]; readings: Reading[]; bills: Bill[] },
  range?: DateRange,
): WaterMetrics {
  const { productionLogs, readings, bills } = input;

  const readingsInRange = readings.filter((r) => inDateRange(r.date, range));
  const readingById = new Map(readings.map((r) => [r.id, r]));

  const produced = productionLogs
    .filter((p) => inDateRange(p.date, range))
    .reduce((a, p) => a + Number(p.units || 0), 0);

  const consumed = readingsInRange.reduce((a, r) => a + readingConsumption(r), 0);

  const billedVolume = bills.reduce((a, b) => {
    const r = readingById.get(b.reading_id);
    if (!r || !inDateRange(r.date, range)) return a;
    return a + readingConsumption(r);
  }, 0);

  const nrwVolume = Math.max(0, produced - billedVolume);
  const nrwPct = produced > 0 ? (nrwVolume / produced) * 100 : 0;

  return {
    produced,
    consumed,
    billedVolume,
    nrwVolume,
    nrwPct,
    efficiencyPct: Math.max(0, 100 - nrwPct),
    unmeasuredVolume: Math.max(0, produced - consumed),
  };
}

export interface FinanceMetrics {
  totalBilled: number;
  totalCollected: number;
  /** المتأخرات = مجموع المتبقي على الفواتير غير المسددة (نفس معادلة الخادم). */
  outstanding: number;
  collectionRate: number;
  paidBills: number;
  unpaidBills: number;
}

/** معادلة التحصيل والمتأخرات الموحّدة لكل الشاشات. */
export function computeFinanceMetrics(
  bills: Bill[],
  payments: Payment[],
  range?: DateRange,
): FinanceMetrics {
  const scoped = bills.filter((b) => inDateRange(b.date, range));
  const paid = scoped.filter((b) => b.status === "paid");
  const unpaid = scoped.filter((b) => b.status !== "paid");

  const totalBilled = scoped.reduce((a, b) => a + Number(b.total || 0), 0);
  const totalCollected = scoped.reduce((a, b) => a + Number(b.paid ?? 0), 0);
  const outstanding = unpaid.reduce((a, b) => a + billBalance(b, payments), 0);

  return {
    totalBilled,
    totalCollected,
    outstanding,
    collectionRate: totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0,
    paidBills: paid.length,
    unpaidBills: unpaid.length,
  };
}
