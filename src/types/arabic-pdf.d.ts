declare module "arabic-persian-reshaper" {
  export const ArabicShaper: { convertArabic(text: string): string };
  export const PersianShaper: { convertArabic(text: string): string };
}

declare module "bidi-js" {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  interface Bidi {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl"): EmbeddingLevels;
    getReorderedString(text: string, embeddingLevels: EmbeddingLevels): string;
  }
  export default function bidiFactory(): Bidi;
}
