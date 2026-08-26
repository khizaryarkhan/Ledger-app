import { api } from "./client";
import type {
  ArSummary, ReceivableInvoice, InvoiceDetail, EscalationList, ReceivableCustomer,
} from "./types";

export const getArSummary = () => api.get<ArSummary>("/api/mobile/receivables/summary");

export const listReceivableInvoices = (opts: { filter?: string; q?: string; customerId?: string } = {}) => {
  const p = new URLSearchParams();
  if (opts.filter) p.set("filter", opts.filter);
  if (opts.q) p.set("q", opts.q);
  if (opts.customerId) p.set("customerId", opts.customerId);
  const qs = p.toString();
  return api.get<{ total: number; invoices: ReceivableInvoice[] }>(
    `/api/mobile/receivables/invoices${qs ? `?${qs}` : ""}`);
};

export const getInvoiceDetail = (id: string) =>
  api.get<InvoiceDetail>(`/api/mobile/receivables/invoices/${id}`);

export const listEscalations = () => api.get<EscalationList>("/api/mobile/receivables/escalations");

export const listReceivableCustomers = () =>
  api.get<{ count: number; customers: ReceivableCustomer[] }>("/api/mobile/receivables/customers");

// ── Actions ─────────────────────────────────────────────────────────────────
// All three go through /api/invoices/[id]/response — the canonical
// "set the customer response" action the board and portals share. It keeps
// promise ⇄ dispute ⇄ clear consistent (logging a promise resolves an open
// dispute, and either way `recomputeInvoiceState` syncs the stage), so an
// outcome logged on a phone is indistinguishable from one logged at a desk.

export const logPromise = (invoiceId: string, body: { promiseDate: string; amount?: number | null; note?: string | null }) =>
  api.post<any>(`/api/invoices/${invoiceId}/response`, { type: "promise", ...body });

export const raiseDispute = (invoiceId: string, body: { category: string; reason?: string | null }) =>
  api.post<any>(`/api/invoices/${invoiceId}/response`, { type: "dispute", ...body });

/** Clears an open dispute and any active promise — back to a neutral state. */
export const clearResponse = (invoiceId: string) =>
  api.post<any>(`/api/invoices/${invoiceId}/response`, { type: "clear" });

export const updateInvoice = (invoiceId: string, patch: Record<string, unknown>) =>
  api.patch<any>(`/api/invoices/${invoiceId}`, patch);

/** Logs an internal note. The server derives customer/project/author itself. */
export const addInvoiceNote = (invoiceId: string, body: string, subject?: string) =>
  api.post<any>(`/api/mobile/receivables/invoices/${invoiceId}/note`, { body, subject });

/** Moves the invoice to another collection stage (same endpoint as the board). */
export const setInvoiceStage = (invoiceId: string, collectionStage: string) =>
  updateInvoice(invoiceId, { collectionStage });
