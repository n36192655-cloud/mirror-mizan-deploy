/**
 * Convert an Arabic project name (e.g. "مشروع المعافر") into a compact
 * Latin slug suitable for username prefixes (e.g. "almaafer").
 *
 * Strategy:
 *  - strip diacritics/tatweel
 *  - drop common project noise words ("مشروع", "شركة", "مؤسسة", …)
 *  - transliterate the leading definite article "ال" to "al"
 *  - map each Arabic letter to its closest Latin equivalent
 *  - collapse runs of repeated letters and lowercase
 */
const AR_MAP: Record<string, string> = {
  "ا": "a", "أ": "a", "إ": "i", "آ": "a",
  "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
  "د": "d", "ذ": "th", "ر": "r", "ز": "z", "س": "s", "ش": "sh",
  "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh",
  "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n",
  "ه": "h", "و": "w", "ي": "y", "ى": "a", "ة": "h",
  "ء": "", "ؤ": "w", "ئ": "y",
};

const NOISE = /مشروع|مؤسسة|شركة|إدارة|هيئة|جمعية/g;

export function slugifyArabic(input: string): string {
  if (!input) return "";
  let s = input.trim();
  // strip Arabic diacritics + tatweel
  s = s.replace(/[\u064B-\u0652\u0640]/g, "");
  // remove noise words
  s = s.replace(NOISE, " ").trim();
  // handle leading article ال → al
  const startsWithAl = /^ال/.test(s);
  if (startsWithAl) s = s.replace(/^ال/, "");

  let out = "";
  for (const ch of s) {
    if (AR_MAP[ch] !== undefined) out += AR_MAP[ch];
    else if (/[a-zA-Z0-9]/.test(ch)) out += ch;
    else out += " ";
  }
  out = out.toLowerCase();
  out = out.replace(/\s+/g, "");
  out = out.replace(/[^a-z0-9]/g, "");
  // collapse triple+ same letters, then double vowels stay (looks nicer)
  out = out.replace(/([a-z])\1{2,}/g, "$1$1");
  if (startsWithAl) out = "al" + out;
  return out.slice(0, 32);
}
