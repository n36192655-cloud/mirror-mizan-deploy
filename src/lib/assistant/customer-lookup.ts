import { useStore, type Customer } from "../store";

/**
 * Single source of truth for customer search.
 * Used by: subscriber ledger, account statement, balance, bills, payments.
 * Supports: full name, partial name, first/last word, account number,
 * meter number (MSR-0004 / MSR0004 / 0004), phone — case-insensitive.
 *
 * Returns either a single match, or a disambiguation list when multiple
 * customers match.  Callers handle the two cases.
 */

export type LookupResult =
  | { kind: "single"; customer: Customer }
  | { kind: "multiple"; customers: Customer[] }
  | { kind: "none" };

/** Normalize Arabic text: unify alef, hamza, taa marbuta, alef maqsura, remove tatweel, lowercase, collapse spaces. */
function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/\u0624/g, "و")
    .replace(/\u0626/g, "ي")
    .replace(/\u0629/g, "ه")
    .replace(/\u0649/g, "ي")
    .replace(/\s+/g, " ");
}

/** Extract a meter number token from free text (MSR-0004, MSR0004, 0004). */
export function extractMeterToken(text: string): string | null {
  const m = text.match(/(MSR[-]?\d{3,5})/i);
  if (m) return m[1].toUpperCase().replace("MSR-", "MSR-");
  const bare = text.match(/\b(\d{4})\b/);
  return bare ? bare[1] : null;
}

/** Compact form for fuzzy matching (no spaces, normalized). */
function compact(s: string): string { return norm(s).replace(/\s/g, ""); }

/** Score how well a query matches a customer — higher = better. */
function scoreCustomer(c: Customer, q: string): number {
  const nq = norm(q);
  if (!nq) return 0;
  const cq = compact(q);
  const name = norm(c.name);
  const cname = compact(c.name);
  const nameParts = name.split(" ");
  const phone = (c.phone ?? "").replace(/\D/g, "");
  const payAccount = norm(c.pay_account ?? "");
  const meter = useStore.getState().meters.find((m) => m.customer_id === c.id);
  const meterNum = meter?.number.toLowerCase() ?? "";
  const meterDigits = meterNum.replace(/\D/g, "");

  if (meterNum === nq) return 100;
  if (meterNum === nq.replace("-", "") || meterNum.replace("-", "") === nq) return 95;
  if (meterDigits && meterDigits === nq) return 90;
  if (meterDigits && meterDigits.endsWith(nq) && nq.length >= 3) return 85;
  if (name === nq) return 80;
  if (cname === cq) return 78;
  if (name.startsWith(nq)) return 70;
  if (cname.startsWith(cq) && cq.length >= 3) return 68;
  if (nameParts[0] === nq) return 65;
  if (nameParts[nameParts.length - 1] === nq) return 60;
  if (name.includes(nq)) return 50;
  if (cname.includes(cq) && cq.length >= 3) return 48;
  if (nq.includes(name)) return 45;
  if (nameParts.some((p) => p === nq)) return 40;
  if (nameParts.some((p) => p.startsWith(nq) && nq.length >= 2)) return 30;
  if (nameParts.some((p) => compact(p).startsWith(cq) && cq.length >= 2)) return 28;
  if (phone === nq.replace(/\D/g, "")) return 75;
  if (phone && phone.includes(nq.replace(/\D/g, "")) && nq.replace(/\D/g, "").length >= 6) return 55;
  if (payAccount && payAccount.includes(nq)) return 35;
  if (String(c.id) === nq) return 60;
  return 0;
}

let cacheVersion = 0;
let cachedResults: Map<string, LookupResult> = new Map();

export function clearLookupCache() {
  cachedResults = new Map();
  cacheVersion++;
}

let lastCustomerCount = -1;
function maybeClearCache() {
  const count = useStore.getState().customers.length;
  if (count !== lastCustomerCount) {
    lastCustomerCount = count;
    clearLookupCache();
  }
}

export function lookupCustomer(query: string): LookupResult {
  maybeClearCache();
  const cached = cachedResults.get(query);
  if (cached) return cached;
  const s = useStore.getState();
  if (s.customers.length === 0) return { kind: "none" };
  const meterToken = extractMeterToken(query);
  let searchQuery = query;
  if (meterToken) {
    if (norm(query) === norm(meterToken) || norm(query).replace(/\D/g, "") === meterToken.replace(/\D/g, "")) {
      searchQuery = meterToken;
    }
  }
  const scored = s.customers
    .map((c) => ({ c, score: scoreCustomer(c, searchQuery) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  let result: LookupResult;
  if (scored.length === 0) {
    result = { kind: "none" };
  } else if (scored.length === 1 || scored[0].score > scored[1].score + 10) {
    result = { kind: "single", customer: scored[0].c };
  } else {
    result = { kind: "multiple", customers: scored.slice(0, 8).map((x) => x.c) };
  }
  cachedResults.set(query, result);
  return result;
}

export function lookupByName(name: string): LookupResult {
  return lookupCustomer(name);
}
