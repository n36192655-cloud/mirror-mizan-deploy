export type MeterType = "water" | "electric";

export function calcConsumption(previous: number, current: number): number {
  return current - previous;
}

// ملاحظة معمارية: التسعير وكشف الشذوذ ليسا مسؤولية العميل.
//  • التسعير      → public.price_consumption + جدولا tariffs / tariff_tiers.
//  • كشف الشذوذ   → public.tg_reading_before_insert (قراءة أقل من السابقة، أو
//                    استهلاك يتجاوز 3× المتوسط المعتمد).
// للمعاينة فقط في شاشة التعرفة تُستخدم priceWithTariff من "@/lib/tariff"
// وهي تقرأ نفس شرائح قاعدة البيانات، ولا تُخزَّن نتيجتها مالياً.


export function fmtYER(n: number): string {
  return new Intl.NumberFormat("ar-YE").format(Math.round(n)) + " ريال";
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat("ar-YE").format(n);
}