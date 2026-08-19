import type { jsPDF } from "jspdf";
import { CAIRO_REGULAR_BASE64 } from "./cairo-font";

/**
 * Arabic support helpers for jsPDF:
 *  - embeds the Cairo font (Arabic glyphs) into the jsPDF VFS
 *  - leaves text in logical Unicode order for jsPDF's built-in Arabic parser
 */

export const AR_FONT = "Cairo";

/** Registers the Arabic font on a jsPDF instance and makes it the active font. */
export function registerArabicFont(doc: jsPDF): void {
  doc.addFileToVFS("Cairo-Regular.ttf", CAIRO_REGULAR_BASE64);
  doc.addFont("Cairo-Regular.ttf", AR_FONT, "normal");
  doc.addFont("Cairo-Regular.ttf", AR_FONT, "bold");
  doc.setFont(AR_FONT, "normal");
  doc.setR2L(false);
}

/**
 * Prepares a string for rendering with jsPDF.
 * jsPDF shapes logical Arabic internally. Keeping global R2L disabled avoids a
 * second BiDi pass that reverses Arabic while preserving Latin and numeric runs.
 */
export function ar(text: string | number | null | undefined): string {
  return text === null || text === undefined ? "" : String(text);
}
