"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

type DataContextType = {
  loaded: boolean;
  customers: any[];
  contacts: any[];
  projects: any[];
  invoices: any[];
  communications: any[];
  tasks: any[];
  reps: any[];
  regions: any[];
  orgSettings: {
    classificationLevel: "customer" | "project";
    dateFormat: string;
    currency: string;
    logoUrl: string | null;
    displayName: string | null;
    name: string;
    stages: import("@/lib/stages").Stage[];
    disabledRules: string[];
    lastCronRun: string | null;
    lastCronStats: { emailsSent: number; skipped: number; errors: string[] } | null;
    showPaymentHistory: boolean;
    reportingEnabled: boolean;
    multicurrencyEnabled: boolean;
    fiscalYearStartMonth: number;
    company?: Record<string, string | null>;
  };
  refresh: () => Promise<void>;
  toast: (message: string, type?: string) => void;
  toastState: any;
  clearToast: () => void;
  updateInvoice: (id: string, patch: any) => Promise<any>;
  recordPayment: (id: string, amount: number, paidDate?: string) => Promise<any>;
  addContact: (data: any) => Promise<any>;
  addNote: (data: any) => Promise<any>;
  sendEmail: (data: any) => Promise<any>;
  addTask: (data: any) => Promise<any>;
  toggleTask: (id: string, completed: boolean) => Promise<any>;
  addCustomer: (data: any) => Promise<any>;
  updateCustomer: (id: string, data: any) => Promise<any>;
  addProject: (data: any) => Promise<any>;
  updateProject: (id: string, data: any) => Promise<any>;
  addInvoice: (data: any) => Promise<any>;
  bulkDeleteInvoices: (ids: string[]) => Promise<any>;
  bulkDeleteCustomers: (ids: string[]) => Promise<any>;
  bulkDeleteProjects: (ids: string[]) => Promise<any>;
  reclassifyCustomers: (ids: string[], repId?: string | null, regionId?: string | null) => Promise<any>;
  reclassifyProjects: (ids: string[], repId?: string | null, regionId?: string | null) => Promise<any>;
  addRep: (data: { name: string; email?: string; tier?: string }) => Promise<any>;
  updateRepTier: (id: string, tier: string) => Promise<any>;
  updateRepManager: (id: string, managerId: string | null) => Promise<any>;
  deleteRep: (id: string) => Promise<void>;
  addRegion: (data: { name: string }) => Promise<any>;
  deleteRegion: (id: string) => Promise<void>;
  updateOrgSettings: (s: Partial<{ classificationLevel: "customer" | "project"; dateFormat: string; currency: string; logoUrl: string | null; displayName: string | null; showPaymentHistory: boolean; reportingEnabled: boolean; company: Record<string, string | null> }>) => Promise<void>;
};

const DataContext = createContext<DataContextType | null>(null);

async function fetchJSON(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

const postJSON = (url: string, data: any) => fetchJSON(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const patchJSON = (url: string, data: any) => fetchJSON(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

export function DataProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [communications, setCommunications] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [orgSettings, setOrgSettings] = useState<{ classificationLevel: "customer" | "project"; dateFormat: string; currency: string; logoUrl: string | null; displayName: string | null; name: string; stages: import("@/lib/stages").Stage[]; disabledRules: string[]; lastCronRun: string | null; lastCronStats: { emailsSent: number; skipped: number; errors: string[] } | null; showPaymentHistory: boolean; reportingEnabled: boolean; multicurrencyEnabled: boolean; fiscalYearStartMonth: number; company?: Record<string, string | null> }>({ classificationLevel: "customer", dateFormat: "DD MMM YYYY", currency: "EUR", logoUrl: null, displayName: null, name: "", stages: [], disabledRules: [], lastCronRun: null, lastCronStats: null, showPaymentHistory: false, reportingEnabled: false, multicurrencyEnabled: false, fiscalYearStartMonth: 1 });
  const [toastState, setToastState] = useState<any>(null);

  const refresh = useCallback(async () => {
    try {
      // Use allSettled so one failing endpoint never blanks the whole app.
      const [c, ct, p, i, comm, t, r, reg, settings] = await Promise.allSettled([
        fetchJSON("/api/customers"),
        fetchJSON("/api/contacts"),
        fetchJSON("/api/projects"),
        fetchJSON("/api/invoices"),
        fetchJSON("/api/communications"),
        fetchJSON("/api/tasks"),
        fetchJSON("/api/reps"),
        fetchJSON("/api/regions"),
        fetchJSON("/api/org/settings"),
      ]);

      const unwrap = (r: PromiseSettledResult<any>, label: string) => {
        if (r.status === "rejected") { console.error(`[data-provider] ${label} failed:`, r.reason); return null; }
        return r.value;
      };

      const customers_    = unwrap(c,    "customers");
      const contacts_     = unwrap(ct,   "contacts");
      const projects_     = unwrap(p,    "projects");
      const invoices_     = unwrap(i,    "invoices");
      const comms_        = unwrap(comm, "communications");
      const tasks_        = unwrap(t,    "tasks");
      const reps_         = unwrap(r,    "reps");
      const regions_      = unwrap(reg,  "regions");
      const settings_     = unwrap(settings, "org/settings");

      if (customers_)  setCustomers(customers_);
      if (contacts_)   setContacts(contacts_);
      if (projects_)   setProjects(projects_);
      if (invoices_)   setInvoices(invoices_);
      if (comms_)      setCommunications(comms_);
      if (tasks_)      setTasks(tasks_);
      if (reps_)       setReps(reps_);
      if (regions_)    setRegions(regions_);
      if (settings_)   setOrgSettings(settings_);
    } catch (e: any) {
      console.error("Refresh failed:", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toast = (message: string, type = "success") => setToastState({ message, type });
  const clearToast = () => setToastState(null);

  const addCustomer = async (data: any) => {
    const created = await postJSON("/api/customers", data);
    setCustomers(prev => [created, ...prev]);
    toast("Customer created");
    return created;
  };

  const updateCustomer = async (id: string, data: any) => {
    const updated = await patchJSON(`/api/customers/${id}`, data);
    setCustomers(prev => prev.map(c => c.id === id ? updated : c));
    toast("Customer updated");
    return updated;
  };

  const addProject = async (data: any) => {
    const created = await postJSON("/api/projects", data);
    setProjects(prev => [created, ...prev]);
    toast("Project created");
    return created;
  };

  const updateProject = async (id: string, data: any) => {
    const updated = await patchJSON(`/api/projects/${id}`, data);
    setProjects(prev => prev.map(p => p.id === id ? updated : p));
    toast("Project updated");
    return updated;
  };

  const addInvoice = async (data: any) => {
    const created = await postJSON("/api/invoices", data);
    setInvoices(prev => [created, ...prev]);
    toast("Invoice created");
    return created;
  };

  const updateInvoice = async (id: string, patch: any) => {
    const updated = await patchJSON(`/api/invoices/${id}`, patch);
    setInvoices(prev => prev.map(i => i.id === id ? updated : i));
    // When a stage change is saved, immediately pull the fresh communications for this
    // invoice and merge them into state so the activity feed updates without waiting
    // for a full refresh().
    if (patch.collectionStage !== undefined) {
      try {
        const freshComms: any[] = await fetchJSON(`/api/communications?invoiceId=${id}`);
        setCommunications(prev => [
          ...freshComms,
          ...prev.filter((c: any) => c.invoiceId !== id),
        ]);
      } catch { /* full refresh() will reconcile on next cycle */ }
    }
    toast("Invoice updated");
    return updated;
  };

  const recordPayment = async (id: string, amount: number, paidDate?: string) => {
    const updated = await postJSON(`/api/invoices/${id}/payment`, { amount, ...(paidDate ? { paidDate } : {}) });
    setInvoices(prev => prev.map(i => i.id === id ? updated : i));
    toast(updated.paymentStatus === "Paid" ? "Invoice marked as paid" : "Partial payment recorded");
    return updated;
  };

  const addContact = async (data: any) => {
    const created = await postJSON("/api/contacts", data);
    setContacts(prev => [...prev, created]);
    toast("Contact added");
    return created;
  };

  const addNote = async ({ customerId, invoiceId, body }: any) => {
    const created = await postJSON("/api/communications", { customerId, invoiceId, direction: "Outbound", channel: "Note", subject: "Internal note", body });
    setCommunications(prev => [created, ...prev]);
    toast("Note saved");
    return created;
  };

  const sendEmail = async (data: any) => {
    const created = await postJSON("/api/communications", { ...data, direction: "Outbound", channel: "Email" });
    setCommunications(prev => [created, ...prev]);
    if (data.invoiceId && !data.isDraft) {
      const inv = await fetchJSON("/api/invoices");
      setInvoices(inv);
    }
    toast(data.isDraft ? "Draft saved" : "Email sent");
    return created;
  };

  const addTask = async (data: any) => {
    const created = await postJSON("/api/tasks", data);
    setTasks(prev => [created, ...prev]);
    toast("Task added");
    return created;
  };

  const toggleTask = async (id: string, completed: boolean) => {
    const updated = await patchJSON(`/api/tasks/${id}`, { completed });
    setTasks(prev => prev.map(t => t.id === id ? updated : t));
    return updated;
  };


  const bulkDeleteInvoices = async (ids: string[]) => {
    await postJSON("/api/invoices/bulk-delete", { ids });
    setInvoices(prev => prev.filter(i => !ids.includes(i.id)));
    toast(`${ids.length} invoice${ids.length > 1 ? "s" : ""} deleted`);
  };

  const bulkDeleteCustomers = async (ids: string[]) => {
    await postJSON("/api/customers/bulk-delete", { ids });
    setCustomers(prev => prev.filter(c => !ids.includes(c.id)));
    toast(`${ids.length} customer${ids.length > 1 ? "s" : ""} deleted`);
  };

  const bulkDeleteProjects = async (ids: string[]) => {
    await postJSON("/api/projects/bulk-delete", { ids });
    setProjects(prev => prev.filter(p => !ids.includes(p.id)));
    toast(`${ids.length} project${ids.length > 1 ? "s" : ""} deleted`);
  };

  const reclassifyCustomers = async (ids: string[], repId?: string | null, regionId?: string | null) => {
    await postJSON("/api/customers/reclassify", { ids, repId, regionId });
    setCustomers(prev => prev.map(c => ids.includes(c.id) ? { ...c, ...(repId !== undefined ? { repId } : {}), ...(regionId !== undefined ? { regionId } : {}) } : c));
    toast(`${ids.length} customer${ids.length > 1 ? "s" : ""} reclassified`);
  };

  const reclassifyProjects = async (ids: string[], repId?: string | null, regionId?: string | null) => {
    await postJSON("/api/projects/reclassify", { ids, repId, regionId });
    setProjects(prev => prev.map(p => ids.includes(p.id) ? { ...p, ...(repId !== undefined ? { repId } : {}), ...(regionId !== undefined ? { regionId } : {}) } : p));
    toast(`${ids.length} project${ids.length > 1 ? "s" : ""} reclassified`);
  };

  const addRep = async (data: { name: string; email?: string; tier?: string }) => {
    const rep = await postJSON("/api/reps", data);
    setReps(prev => [...prev, rep]);
    toast("Rep added");
    return rep;
  };

  const updateRepTier = async (id: string, tier: string) => {
    const updated = await patchJSON(`/api/reps/${id}`, { tier });
    setReps(prev => prev.map(r => r.id === id ? updated : r));
    toast("Rep tier updated");
    return updated;
  };

  const updateRepManager = async (id: string, managerId: string | null) => {
    const updated = await patchJSON(`/api/reps/${id}`, { managerId });
    setReps(prev => prev.map(r => r.id === id ? updated : r));
    return updated;
  };

  const deleteRep = async (id: string) => {
    await fetchJSON("/api/reps", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setReps(prev => prev.filter(r => r.id !== id));
    toast("Rep removed");
  };

  const addRegion = async (data: { name: string }) => {
    const region = await postJSON("/api/regions", data);
    setRegions(prev => [...prev, region]);
    toast("Region added");
    return region;
  };

  const deleteRegion = async (id: string) => {
    await fetchJSON("/api/regions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setRegions(prev => prev.filter(r => r.id !== id));
    toast("Region removed");
  };

  const updateOrgSettings = async (s: Partial<{ classificationLevel: "customer" | "project"; dateFormat: string; currency: string; logoUrl: string | null; displayName: string | null; showPaymentHistory: boolean; company: Record<string, string | null> }>) => {
    const updated = await fetchJSON("/api/org/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    setOrgSettings(prev => ({ ...prev, ...updated }));
    toast("Settings saved");
  };

  return (
    <DataContext.Provider value={{
      loaded, customers, contacts, projects, invoices, communications, tasks, reps, regions, orgSettings,
      refresh, toast, toastState, clearToast,
      updateInvoice, recordPayment, addContact, addNote, sendEmail, addTask, toggleTask,
      addCustomer, updateCustomer, addProject, updateProject, addInvoice, bulkDeleteInvoices, bulkDeleteCustomers, bulkDeleteProjects,
      reclassifyCustomers, reclassifyProjects, addRep, updateRepTier, updateRepManager, deleteRep, addRegion, deleteRegion, updateOrgSettings,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
