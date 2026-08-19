import type { Customer, Bill, Reading, Payment } from "../store";

/**
 * Conversation Context — stores the full assistant session state.
 * Tracks: current customer, meter, bill, reading, report, and the
 * last disambiguation list so the user can say "اعرض اول واحد".
 *
 * Lives in module scope — resets on page reload.
 */

export interface ConversationContext {
  currentCustomer: Customer | null;
  currentMeterNumber: string | null;
  currentBill: Bill | null;
  currentReading: Reading | null;
  /** The last account_statement response, for "اطبعه" */
  currentReport: "account_statement" | "subscriber_ledger" | "loss_analysis" | "revenue_report" | "payment_status" | null;
  /** Last disambiguation list — for "اعرض أول واحد" */
  lastDisambiguation: Customer[] | null;
  /** Last ranking list (e.g. top debtors, top consumers) — for "اعرض الثاني/الثالث" */
  currentRanking: Customer[] | null;
  /** Last time range label used in a report — for context-aware follow-ups */
  currentTimeRange: string | null;
}

let ctx: ConversationContext = {
  currentCustomer: null,
  currentMeterNumber: null,
  currentBill: null,
  currentReading: null,
  currentReport: null,
  lastDisambiguation: null,
  currentRanking: null,
  currentTimeRange: null,
};

export function setContext(c: Partial<ConversationContext>) {
  ctx = { ...ctx, ...c };
}

export function resetContext() {
  ctx = {
    currentCustomer: null,
    currentMeterNumber: null,
    currentBill: null,
    currentReading: null,
    currentReport: null,
    lastDisambiguation: null,
    currentRanking: null,
    currentTimeRange: null,
  };
}

export function getContext(): Readonly<ConversationContext> {
  return ctx;
}

/** Convenience: set customer + meter together. */
export function setCustomerContext(customer: Customer, meterNumber?: string) {
  ctx = {
    ...ctx,
    currentCustomer: customer,
    currentMeterNumber: meterNumber ?? ctx.currentMeterNumber,
  };
}

/** Convenience: set the disambiguation list. */
export function setDisambiguation(customers: Customer[]) {
  ctx = { ...ctx, lastDisambiguation: customers };
}
