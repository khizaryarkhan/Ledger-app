/**
 * Departments — the top-level structure of the app.
 *
 * The app is organised by department rather than by screen, so new areas
 * (Payables, Reports, …) slot in as another entry here instead of another
 * button on a flat home screen.
 *
 * Each department declares which roles may use it. The home screen only shows
 * what the signed-in role can actually do — a collections rep opening the app
 * sees Receivables and nothing else, warehouse staff see Operations. That's
 * both clearer and honest: a section you can't act in shouldn't be offered
 * and then fail with a 403.
 *
 * Roles come from the org membership (`users.role` / `user_organisations.role`):
 *   rep            — "Rep / PM": field collections. Receivables only; reps
 *                    don't move stock (`canPostInventoryTxn` excludes them).
 *   company_user   — "Full Access" staff: both departments.
 *   company_admin  — everything in their org.
 *   super_admin    — everything.
 *   platform_admin — our own staff, not an org operator: no department. They
 *                    see an empty home screen rather than a section that 403s.
 */

export type DepartmentKey = "receivables" | "operations";

export type DepartmentItem = {
  key: string;
  title: string;
  subtitle: string;
  route: string;
};

export type Department = {
  key: DepartmentKey;
  title: string;
  blurb: string;
  roles: string[];
  items: DepartmentItem[];
};

export const DEPARTMENTS: Department[] = [
  {
    key: "receivables",
    title: "Receivables",
    blurb: "Collections — your invoices, promises, disputes and escalations.",
    // Reps live here; full-access staff and admins supervise the same book.
    roles: ["rep", "company_user", "company_admin", "super_admin"],
    items: [
      { key: "overview",    title: "Overview",    subtitle: "Your book at a glance — total, overdue and aging",   route: "ReceivablesOverview" },
      { key: "invoices",    title: "My Invoices", subtitle: "Work the book — log promises, disputes and notes",   route: "ReceivablesInvoices" },
      { key: "escalations", title: "Escalations", subtitle: "Invoices escalated to you",                          route: "ReceivablesEscalations" },
      { key: "customers",   title: "Customers",   subtitle: "Open balance by customer",                           route: "ReceivablesCustomers" },
    ],
  },
  {
    key: "operations",
    title: "Operations",
    blurb: "Warehouse and production — stock in, stock made, stock out.",
    // Floor staff and up — the same line `canPostInventoryTxn` draws on the
    // server. Reps are deliberately excluded: they don't move stock.
    roles: ["company_user", "company_admin", "super_admin"],
    items: [
      { key: "receiving",  title: "Receiving",  subtitle: "Post a goods receipt, with or without a PO", route: "ReceivingList" },
      { key: "production", title: "Production", subtitle: "Build finished goods from a BOM",            route: "ProductionList" },
      { key: "shipping",   title: "Shipping",   subtitle: "Ship against a sales order",                 route: "ShippingList" },
    ],
  },
];

export function departmentsForRole(role: string | null | undefined): Department[] {
  if (!role) return [];
  return DEPARTMENTS.filter(d => d.roles.includes(role));
}
