import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import type { AiResponse } from "../ai-intent";
import { ar, registerArabicFont, AR_FONT } from "./arabic-text";

/**
 * Professional PDF export for account statements using jsPDF.
 * Arabic-ready: embeds the Cairo font, reshapes letters and renders RTL.
 *
 * All data comes from the existing response — no new calculations.
 */

type StatementResponse = Extract<AiResponse, { kind: "account_statement" }>;

const PRIMARY: [number, number, number] = [14, 165, 233];
const DARK: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 116, 139];
const LIGHT: [number, number, number] = [241, 245, 249];
const DANGER: [number, number, number] = [239, 68, 68];
const OK: [number, number, number] = [22, 163, 74];
const WHITE: [number, number, number] = [255, 255, 255];

function statusLabel(s: string): string {
  return s === "paid" ? "مدفوعة" : s === "partial" ? "جزئية" : "غير مدفوعة";
}
function payStatusLabel(s: string): string {
  return s === "approved" ? "معتمدة" : s === "pending" ? "معلقة" : "مرفوضة";
}
function methodLabel(m: string): string {
  return m === "cash" ? "نقدي" : m === "wallet" ? "الكريمي" : "تحويل";
}
function readingStatusLabel(s: string): string {
  return s === "approved" ? "معتمدة" : s === "rejected" ? "مرفوضة" : "معلقة";
}

export async function exportStatementPDF(response: StatementResponse): Promise<void> {
  const { customer, totals, stats, lastReading, readings, monthlyConsumption, bills, payments } = response;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  registerArabicFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const right = pageW - margin;
  let y = margin;

  // ── Header ────────────────────────────────────────────────────
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageW, 25, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(16);
  doc.setFont(AR_FONT, "bold");
  doc.text("MIZAN AI", margin, 12);
  doc.setFontSize(10);
  doc.setFont(AR_FONT, "normal");
  doc.text(ar("المساعد الذكي - كشف حساب"), right, 12, { align: "right" });
  doc.setFontSize(8);
  doc.text(new Date().toLocaleString("en-GB"), margin, 18);

  y = 32;
  doc.setTextColor(...DARK);
  doc.setFontSize(13);
  doc.setFont(AR_FONT, "bold");
  doc.text(ar("كشف حساب المشترك"), pageW / 2, y, { align: "center" });
  y += 6;

  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.5);
  doc.line(margin, y, right, y);
  y += 6;

  // ── Customer info (RTL) ───────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont(AR_FONT, "normal");
  const infoLines: Array<[string, string]> = [
    ["الاسم", customer.name],
    ["رقم العداد", customer.meterNumber ?? "-"],
    ["الهاتف", customer.phone],
    ["الحالة", customer.status === "active" ? "نشط" : "موقوف"],
  ];
  if (customer.directorate) infoLines.push(["المديرية", customer.directorate]);

  for (const [label, value] of infoLines) {
    doc.setTextColor(...MUTED);
    doc.text(ar(label + ":"), right, y, { align: "right" });
    doc.setTextColor(...DARK);
    doc.text(ar(String(value)), right - 35, y, { align: "right" });
    y += 5;
  }
  y += 3;

  // ── Summary boxes ─────────────────────────────────────────────
  const boxW = (pageW - margin * 2 - 9) / 4;
  const boxH = 14;
  const drawBoxes = (
    items: Array<{ label: string; value: string; color: [number, number, number] }>,
  ) => {
    items.forEach((s, i) => {
      // right-to-left order
      const x = right - boxW - i * (boxW + 3);
      doc.setFillColor(...LIGHT);
      doc.roundedRect(x, y, boxW, boxH, 1.5, 1.5, "F");
      doc.setTextColor(...MUTED);
      doc.setFontSize(7);
      doc.setFont(AR_FONT, "normal");
      doc.text(ar(s.label), x + boxW - 2, y + 5, { align: "right" });
      doc.setTextColor(...s.color);
      doc.setFontSize(10);
      doc.setFont(AR_FONT, "bold");
      doc.text(ar(s.value), x + boxW - 2, y + 11, { align: "right" });
      doc.setFont(AR_FONT, "normal");
    });
    y += boxH + 5;
  };

  drawBoxes([
    { label: "إجمالي الفواتير", value: fmtYERShort(totals.billed), color: DARK },
    { label: "المدفوع", value: fmtYERShort(totals.paid), color: OK },
    { label: "المتأخرات", value: fmtYERShort(totals.arrears), color: DANGER },
    { label: "الرصيد", value: fmtYERShort(totals.balance), color: totals.balance > 0 ? DANGER : OK },
  ]);

  if (stats) {
    drawBoxes([
      { label: "عدد الفواتير", value: String(stats.billCount), color: DARK },
      { label: "نسبة التحصيل", value: stats.collectionPct + "%", color: stats.collectionPct >= 70 ? OK : DANGER },
      { label: "أعلى فاتورة", value: fmtYERShort(stats.highestBill), color: DARK },
      { label: "أقل فاتورة", value: fmtYERShort(stats.lowestBill), color: DARK },
    ]);
  }

  if (lastReading) {
    doc.setTextColor(...PRIMARY);
    doc.setFontSize(10);
    doc.setFont(AR_FONT, "bold");
    doc.text(ar("آخر قراءة"), right, y, { align: "right" });
    y += 5;
    doc.setFont(AR_FONT, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    const rd = new Date(lastReading.date).toLocaleDateString("en-GB");
    doc.text(ar(`التاريخ: ${rd}`), right, y, { align: "right" });
    doc.text(ar(`القراءة الحالية: ${lastReading.current}`), right - 55, y, { align: "right" });
    doc.text(ar(`الاستهلاك: ${lastReading.consumption} م3`), right - 105, y, { align: "right" });
    y += 6;
  }

  if (readings && readings.length > 0) {
    y = drawTable(doc, margin, y, pageW - margin * 2, "سجل القراءات",
      ["التاريخ", "السابقة", "الحالية", "الاستهلاك", "الحالة"],
      readings.slice(0, 20).map((r) => [
        new Date(r.date).toLocaleDateString("en-GB"),
        String(r.previous), String(r.current),
        String(r.consumption) + " م3",
        readingStatusLabel(r.status),
      ]),
      pageH);
  }

  if (monthlyConsumption && monthlyConsumption.length > 0) {
    if (y > pageH - 25) { doc.addPage(); y = margin; }
    doc.setTextColor(...PRIMARY);
    doc.setFontSize(10);
    doc.setFont(AR_FONT, "bold");
    doc.text(ar("الاستهلاك الشهري (آخر 12 شهر)"), right, y, { align: "right" });
    y += 5;
    doc.setFont(AR_FONT, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    const items = monthlyConsumption.slice(0, 12);
    const colW = (pageW - margin * 2) / items.length;
    items.forEach((m, i) => {
      const x = right - (i + 1) * colW;
      doc.text(ar(m.month), x + colW - 1, y, { align: "right" });
      doc.text(String(m.consumption), x + colW - 1, y + 4, { align: "right" });
    });
    y += 10;
  }

  y = drawTable(doc, margin, y, pageW - margin * 2, "سجل الفواتير",
    ["التاريخ", "رقم الفاتورة", "الاستهلاك", "المبلغ", "المدفوع", "الحالة"],
    bills.map((b) => [
      new Date(b.date).toLocaleDateString("en-GB"), b.serial, String(b.consumption) + " م3",
      fmtYERShort(b.total), fmtYERShort(b.paid), statusLabel(b.status),
    ]),
    pageH);

  y = drawTable(doc, margin, y, pageW - margin * 2, "سجل المدفوعات",
    ["التاريخ", "المبلغ", "الطريقة", "الحالة"],
    payments.map((p) => [
      new Date(p.date).toLocaleDateString("en-GB"), fmtYERShort(p.amount),
      methodLabel(p.method), payStatusLabel(p.status),
    ]),
    pageH);

  // ── Final balance ─────────────────────────────────────────────
  if (y > pageH - 45) { doc.addPage(); y = margin; }
  y += 5;
  doc.setFillColor(...(totals.balance > 0 ? DANGER : OK));
  doc.roundedRect(margin, y, pageW - margin * 2, 12, 2, 2, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(11);
  doc.setFont(AR_FONT, "bold");
  doc.text(ar("الرصيد النهائي:"), right - 3, y + 8, { align: "right" });
  doc.text(ar(fmtYERShort(totals.balance)), margin + 3, y + 8);
  y += 16;

  // ── QR ────────────────────────────────────────────────────────
  const qrData = JSON.stringify({
    customer: customer.name,
    meter: customer.meterNumber ?? "",
    balance: totals.balance,
    date: new Date().toISOString().slice(0, 10),
  });
  try {
    const qrDataUrl = await QRCode.toDataURL(qrData, { width: 100, margin: 0 });
    const qrSize = 22;
    if (y + qrSize > pageH - 15) { doc.addPage(); y = margin; }
    doc.addImage(qrDataUrl, "PNG", right - qrSize, y, qrSize, qrSize);
    doc.setTextColor(...MUTED);
    doc.setFontSize(7);
    doc.setFont(AR_FONT, "normal");
    doc.text(ar("امسح للتحقق"), right, y + qrSize + 4, { align: "right" });
  } catch { /* QR generation failed — non-fatal */ }

  // ── Footer ────────────────────────────────────────────────────
  const footerY = pageH - 10;
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 3, right, footerY - 3);
  doc.setTextColor(...MUTED);
  doc.setFontSize(7);
  doc.setFont(AR_FONT, "normal");
  doc.text(ar("تم الإنشاء بواسطة المساعد الذكي MIZAN AI"), right, footerY, { align: "right" });
  doc.text(new Date().toLocaleString("en-GB"), margin, footerY);

  const fileName = `MIZAN_Statement_${customer.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}

function fmtYERShort(n: number): string {
  return Math.round(n).toLocaleString("en-US") + " YER";
}

function drawTable(
  doc: jsPDF, x: number, y: number, w: number, title: string,
  headers: string[], rows: string[][], pageH: number,
): number {
  const colW = w / headers.length;
  const rowH = 6;
  const headerH = 7;
  const rightEdge = x + w;
  // column index i is placed from the right
  const cellRight = (i: number) => rightEdge - i * colW - 1.5;

  if (y > pageH - 30) { doc.addPage(); y = 15; }
  doc.setTextColor(...PRIMARY);
  doc.setFontSize(10);
  doc.setFont(AR_FONT, "bold");
  doc.text(ar(title), rightEdge, y, { align: "right" });
  y += 4;
  doc.setFillColor(...PRIMARY);
  doc.rect(x, y, w, headerH, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(7);
  headers.forEach((h, i) => { doc.text(ar(h), cellRight(i), y + 5, { align: "right" }); });
  y += headerH;
  doc.setFont(AR_FONT, "normal");
  doc.setFontSize(7);
  rows.forEach((row, ri) => {
    if (y > pageH - 15) { doc.addPage(); y = 15; }
    if (ri % 2 === 0) { doc.setFillColor(...LIGHT); doc.rect(x, y, w, rowH, "F"); }
    doc.setTextColor(...DARK);
    row.forEach((cell, ci) => {
      const text = cell.length > 18 ? cell.slice(0, 16) + ".." : cell;
      doc.text(ar(text), cellRight(ci), y + 4.5, { align: "right" });
    });
    y += rowH;
  });
  if (rows.length === 0) {
    doc.setTextColor(...MUTED);
    doc.text(ar("لا توجد سجلات"), rightEdge - 2, y + 4, { align: "right" });
    y += rowH;
  }
  return y + 4;
}
