"use client";

import { useState } from "react";
import { Modal, Button, Input, Select } from "./ui";
import { useData } from "./data-provider";
import { today, daysFromNow } from "@/lib/format";

// =====================
// CREATE / EDIT CUSTOMER
// =====================
const EMPTY_CUSTOMER = {
  name: "", code: "", companyName: "", country: "Ireland", currency: "",
  paymentTerms: 30, taxNumber: "", riskRating: "Low", status: "Active",
  creditLimit: "", phone: "", email: "",
  addressStreet: "", addressCity: "", addressPostcode: "",
  paymentMethod: "", notes: "",
  accountOwnerId: null as string | null,
  collectionOwnerId: null as string | null,
};

export function CustomerModal({ customer, onClose }: { customer?: any; onClose: () => void }) {
  const { addCustomer, updateCustomer, orgSettings } = useData() as any;
  const isEdit = !!customer;
  // Default currency to the org's home currency — never a hardcoded literal,
  // so a customer created with no explicit choice matches the books it's
  // posted into (a create-time-only default; edits keep the existing value).
  const [form, setForm] = useState(customer ? {
    ...EMPTY_CUSTOMER, ...customer,
    creditLimit: customer.creditLimit ?? "",
  } : { ...EMPTY_CUSTOMER, currency: orgSettings?.currency || "EUR" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handle = async () => {
    if (!form.name || !form.code) { setError("Name and code are required"); return; }
    setSubmitting(true); setError("");
    try {
      const payload = { ...form, creditLimit: form.creditLimit ? parseFloat(form.creditLimit) : null };
      if (isEdit) await updateCustomer(customer.id, payload);
      else await addCustomer(payload);
      onClose();
    } catch (e: any) { setError(e.message || "Failed to save"); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit customer" : "New customer"} size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={submitting}>{submitting ? "Saving…" : isEdit ? "Save changes" : "Create customer"}</Button>
      </>}>
      <div className="p-5 space-y-5">
        {error && <div className="text-sm text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded-md p-3">{error}</div>}

        <div>
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Basic info</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Display name *</label><Input value={form.name} onChange={(e: any) => set("name", e.target.value)} placeholder="Atlas Logistics Ltd" /></div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Company name</label><Input value={form.companyName} onChange={(e: any) => set("companyName", e.target.value)} placeholder="Atlas Logistics Limited" /></div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Customer code *</label><Input value={form.code} onChange={(e: any) => set("code", e.target.value)} placeholder="ATL001" /></div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Tax / VAT number</label><Input value={form.taxNumber} onChange={(e: any) => set("taxNumber", e.target.value)} placeholder="IE1234567T" /></div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Contact</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Email</label><Input type="email" value={form.email} onChange={(e: any) => set("email", e.target.value)} placeholder="accounts@customer.com" /></div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Phone</label><Input value={form.phone} onChange={(e: any) => set("phone", e.target.value)} placeholder="+353 1 555 0100" /></div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Address</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3"><label className="text-xs font-medium text-stone-700 block mb-1">Street</label><Input value={form.addressStreet} onChange={(e: any) => set("addressStreet", e.target.value)} placeholder="123 Main Street" /></div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">City</label><Input value={form.addressCity} onChange={(e: any) => set("addressCity", e.target.value)} placeholder="Dublin" /></div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Postcode</label><Input value={form.addressPostcode} onChange={(e: any) => set("addressPostcode", e.target.value)} placeholder="D01 AB12" /></div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Country</label>
              <Select value={form.country} onChange={(e: any) => set("country", e.target.value)} className="w-full"
                options={["Ireland", "United Kingdom", "Germany", "France", "United States", "Other"]} />
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Financial settings</div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Currency</label>
              <Select value={form.currency} onChange={(e: any) => set("currency", e.target.value)} className="w-full" options={["EUR", "GBP", "USD", "CHF", "SEK", "NOK"]} />
            </div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Payment terms (days)</label><Input type="number" value={form.paymentTerms} onChange={(e: any) => set("paymentTerms", parseInt(e.target.value))} /></div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Credit limit</label><Input type="number" value={form.creditLimit} onChange={(e: any) => set("creditLimit", e.target.value)} placeholder="250000" /></div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Payment method</label>
              <Select value={form.paymentMethod} onChange={(e: any) => set("paymentMethod", e.target.value)} className="w-full" placeholder="Select method"
                options={["Bank Transfer", "Credit Card", "Direct Debit", "Cheque", "Other"]} />
            </div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Risk rating</label>
              <Select value={form.riskRating} onChange={(e: any) => set("riskRating", e.target.value)} className="w-full" options={["Low", "Medium", "High"]} />
            </div>
            <div><label className="text-xs font-medium text-stone-700 block mb-1">Status</label>
              <Select value={form.status} onChange={(e: any) => set("status", e.target.value)} className="w-full" options={["Active", "On Hold", "Inactive"]} />
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-stone-700 block mb-1">Notes</label>
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
            className="w-full text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none p-2.5" placeholder="Any notes about this customer..." />
        </div>
      </div>
    </Modal>
  );
}

// =====================
// CREATE / EDIT PROJECT
// =====================
const EMPTY_PROJECT = {
  customerId: "", name: "", code: "", status: "Active",
  startDate: today(), endDate: "", projectedEndDate: "", ownerId: null as string | null,
};

export function ProjectModal({ project, preCustomerId, onClose }: { project?: any; preCustomerId?: string; onClose: () => void }) {
  const { customers, addProject, updateProject } = useData() as any;
  const isEdit = !!project;
  const [form, setForm] = useState(project ? { ...EMPTY_PROJECT, ...project } : { ...EMPTY_PROJECT, customerId: preCustomerId || "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handle = async () => {
    if (!form.customerId || !form.name || !form.code) { setError("Customer, name and code are required"); return; }
    setSubmitting(true); setError("");
    try {
      if (isEdit) await updateProject(project.id, form);
      else await addProject(form);
      onClose();
    } catch (e: any) { setError(e.message || "Failed to save"); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit project" : "New project"} size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={submitting}>{submitting ? "Saving…" : isEdit ? "Save changes" : "Create project"}</Button>
      </>}>
      <div className="p-5 space-y-4">
        {error && <div className="text-sm text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded-md p-3">{error}</div>}
        <div><label className="text-xs font-medium text-stone-700 block mb-1">Customer *</label>
          <Select value={form.customerId} onChange={(e: any) => set("customerId", e.target.value)} className="w-full" placeholder="Select customer"
            options={customers.map((c: any) => ({ value: c.id, label: c.name }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Project name *</label><Input value={form.name} onChange={(e: any) => set("name", e.target.value)} placeholder="Cloud Migration Phase II" /></div>
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Project code *</label><Input value={form.code} onChange={(e: any) => set("code", e.target.value)} placeholder="HTG-CM2" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Start date</label><Input type="date" value={form.startDate} onChange={(e: any) => set("startDate", e.target.value)} /></div>
          <div><label className="text-xs font-medium text-stone-700 block mb-1">End date</label><Input type="date" value={form.endDate} onChange={(e: any) => set("endDate", e.target.value)} /></div>
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Projected end</label><Input type="date" value={form.projectedEndDate} onChange={(e: any) => set("projectedEndDate", e.target.value)} /></div>
        </div>
        <div><label className="text-xs font-medium text-stone-700 block mb-1">Status</label>
          <Select value={form.status} onChange={(e: any) => set("status", e.target.value)} className="w-full"
            options={["Pending", "Active", "In Progress", "Completed", "On Hold", "Cancelled"]} />
        </div>
      </div>
    </Modal>
  );
}

// =====================
// CREATE INVOICE
// =====================
type LineItem = { description: string; quantity: number; unitPrice: number; amount: number };

const EMPTY_LINE: LineItem = { description: "", quantity: 1, unitPrice: 0, amount: 0 };

export function InvoiceModal({ onClose }: { onClose: () => void }) {
  const { customers, projects, addInvoice } = useData() as any;
  const [form, setForm] = useState({
    customerId: "", projectId: "", invoiceNumber: "", poNumber: "",
    invoiceDate: today(), dueDate: daysFromNow(30),
    currency: "EUR", taxRate: 23, notes: "", collectionStage: "New",
  });
  const [lines, setLines] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const selectedCustomer = customers.find((c: any) => c.id === form.customerId);
  const filteredProjects = projects.filter((p: any) => p.customerId === form.customerId);

  const updateLine = (i: number, k: keyof LineItem, v: any) => {
    setLines(prev => {
      const updated = [...prev];
      updated[i] = { ...updated[i], [k]: v };
      if (k === "quantity" || k === "unitPrice") {
        updated[i].amount = updated[i].quantity * updated[i].unitPrice;
      }
      return updated;
    });
  };

  const subtotal = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const taxAmount = Math.round(subtotal * (form.taxRate / 100) * 100) / 100;
  const total = subtotal + taxAmount;

  // Auto-update due date when customer or invoice date changes
  const handleCustomerChange = (custId: string) => {
    const cust = customers.find((c: any) => c.id === custId);
    if (cust) {
      const due = new Date(form.invoiceDate);
      due.setDate(due.getDate() + (cust.paymentTerms || 30));
      set("dueDate", due.toISOString().slice(0, 10));
      set("currency", cust.currency || "EUR");
    }
    set("customerId", custId);
    set("projectId", "");
  };

  const handle = async () => {
    if (!form.customerId || !form.invoiceNumber) { setError("Customer and invoice number are required"); return; }
    if (lines.every(l => !l.description)) { setError("Add at least one line item"); return; }
    setSubmitting(true); setError("");
    try {
      await addInvoice({
        ...form,
        projectId: form.projectId || null,
        amount: subtotal,
        taxAmount,
        total,
        paymentTerms: selectedCustomer?.paymentTerms || 30,
        paymentStatus: "Unpaid",
        collectionOwnerId: selectedCustomer?.collectionOwnerId || null,
      });
      onClose();
    } catch (e: any) { setError(e.message || "Failed to create invoice"); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title="New invoice" size="xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={submitting}>{submitting ? "Creating…" : "Create invoice"}</Button>
      </>}>
      <div className="p-5 space-y-5">
        {error && <div className="text-sm text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded-md p-3">{error}</div>}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Invoice details</div>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-stone-700 block mb-1">Customer *</label>
                <Select value={form.customerId} onChange={(e: any) => handleCustomerChange(e.target.value)} className="w-full" placeholder="Select customer"
                  options={customers.map((c: any) => ({ value: c.id, label: c.name }))} />
              </div>
              <div><label className="text-xs font-medium text-stone-700 block mb-1">Project</label>
                <Select value={form.projectId} onChange={(e: any) => set("projectId", e.target.value)} className="w-full" placeholder="Select project (optional)"
                  options={filteredProjects.map((p: any) => ({ value: p.id, label: p.name }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-stone-700 block mb-1">Invoice number *</label><Input value={form.invoiceNumber} onChange={(e: any) => set("invoiceNumber", e.target.value)} placeholder="INV-2025-0001" /></div>
                <div><label className="text-xs font-medium text-stone-700 block mb-1">PO number</label><Input value={form.poNumber} onChange={(e: any) => set("poNumber", e.target.value)} placeholder="PO-12345" /></div>
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Dates & payment</div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-stone-700 block mb-1">Invoice date</label><Input type="date" value={form.invoiceDate} onChange={(e: any) => set("invoiceDate", e.target.value)} /></div>
                <div><label className="text-xs font-medium text-stone-700 block mb-1">Due date</label><Input type="date" value={form.dueDate} onChange={(e: any) => set("dueDate", e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-stone-700 block mb-1">Currency</label>
                  <Select value={form.currency} onChange={(e: any) => set("currency", e.target.value)} className="w-full" options={["EUR", "GBP", "USD", "CHF"]} />
                </div>
                <div><label className="text-xs font-medium text-stone-700 block mb-1">Tax rate (%)</label><Input type="number" value={form.taxRate} onChange={(e: any) => set("taxRate", parseFloat(e.target.value))} /></div>
              </div>
              <div><label className="text-xs font-medium text-stone-700 block mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
                  className="w-full text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none p-2.5" />
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Line items</div>
          <div className="ring-1 ring-stone-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 gap-0 bg-stone-50 px-3 py-2 text-[11px] font-semibold text-stone-500 uppercase tracking-wider border-b border-stone-200">
              <div className="col-span-6">Description</div>
              <div className="col-span-2 text-right">Qty</div>
              <div className="col-span-2 text-right">Unit price</div>
              <div className="col-span-2 text-right">Amount</div>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-stone-100 last:border-0 items-center">
                <div className="col-span-6">
                  <input value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)}
                    className="w-full text-sm focus:outline-none placeholder-stone-400" placeholder="Service description..." />
                </div>
                <div className="col-span-2">
                  <input type="number" value={line.quantity} onChange={(e) => updateLine(i, "quantity", parseFloat(e.target.value) || 0)}
                    className="w-full text-sm text-right focus:outline-none tabular-nums" />
                </div>
                <div className="col-span-2">
                  <input type="number" value={line.unitPrice} onChange={(e) => updateLine(i, "unitPrice", parseFloat(e.target.value) || 0)}
                    className="w-full text-sm text-right focus:outline-none tabular-nums" />
                </div>
                <div className="col-span-2 flex items-center justify-between">
                  <span className="text-sm font-medium tabular-nums text-right flex-1">{line.amount.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  {lines.length > 1 && (
                    <button onClick={() => setLines(prev => prev.filter((_, j) => j !== i))} className="ml-2 text-stone-300 hover:text-rose-500 text-lg leading-none">×</button>
                  )}
                </div>
              </div>
            ))}
            <div className="px-3 py-2 bg-stone-50/50">
              <button onClick={() => setLines(prev => [...prev, { ...EMPTY_LINE }])} className="text-xs text-stone-500 hover:text-stone-900 font-medium">+ Add line</button>
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between text-stone-600"><span>Subtotal</span><span className="tabular-nums">{subtotal.toLocaleString("en-IE", { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-stone-600"><span>Tax ({form.taxRate}%)</span><span className="tabular-nums">{taxAmount.toLocaleString("en-IE", { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between font-semibold text-stone-900 pt-1.5 border-t border-stone-200"><span>Total ({form.currency})</span><span className="tabular-nums">{total.toLocaleString("en-IE", { minimumFractionDigits: 2 })}</span></div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// ADD CONTACT MODAL
// ============================================================
export function AddContactModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { addContact } = useData();
  const [form, setForm] = useState({ name: "", title: "", email: "", phone: "", type: "Billing", isPrimary: false, isEscalation: false, receivesAuto: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    if (!form.email.trim()) { setError("Email is required"); return; }
    setSaving(true);
    try {
      await addContact({ ...form, customerId });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add contact" size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Add contact"}</Button>
      </>}>
      <div className="space-y-3">
        {error && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Full name *</label>
            <Input value={form.name} onChange={(e: any) => set("name", e.target.value)} placeholder="Jane Smith" />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Title</label>
            <Input value={form.title} onChange={(e: any) => set("title", e.target.value)} placeholder="Finance Manager" />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Email *</label>
          <Input type="email" value={form.email} onChange={(e: any) => set("email", e.target.value)} placeholder="jane@company.com" />
        </div>
        <div>
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Phone</label>
          <Input value={form.phone} onChange={(e: any) => set("phone", e.target.value)} placeholder="+353 1 234 5678" />
        </div>
        <div>
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Type</label>
          <Select value={form.type} onChange={(e: any) => set("type", e.target.value)} options={["Billing", "Finance", "Project", "Escalation", "Legal", "Other"]} />
        </div>
        <div className="flex flex-col gap-2 pt-1">
          {[
            { key: "isPrimary", label: "Primary contact — receives all communications" },
            { key: "isEscalation", label: "Escalation contact — CC'd on overdue notices" },
            { key: "receivesAuto", label: "Receives automated reminders" },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
              <input type="checkbox" checked={(form as any)[key]} onChange={e => set(key, e.target.checked)}
                className="rounded border-stone-300" />
              {label}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
