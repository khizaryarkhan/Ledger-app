"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard, Users, Briefcase, FileText, Kanban, Filter, Inbox,
  CheckSquare, BarChart3, Zap, LogOut, Shield, TrendingUp, X,
  MessageSquare, ShoppingCart, Receipt, Building2, CreditCard,
  ChevronDown, ArrowLeftRight, Bell, Workflow, Package, BookOpen,
  Layers, History, Clock, GitBranch, ListTree, Check, Database, ChevronRight, Contact,
  Scale, ClipboardList, PackageCheck, Truck, Landmark, Factory, ShieldCheck
} from "lucide-react";
import { createPortal } from "react-dom";
import { useData } from "./data-provider";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;
  count?: number;
  urgent?: boolean;
}

export function Sidebar({ isOpen = false, onClose, collapsed = false }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { invoices, communications, tasks, orgSettings } = useData();

  const role = (session?.user as any)?.role;
  const isAdmin = role === "super_admin" || role === "company_admin";

  // Determine active department from URL
  const isPayables   = pathname.startsWith("/payables");
  const isReporting  = pathname.startsWith("/reporting");
  const isBatch      = pathname.startsWith("/batch");
  const isProduction = pathname.startsWith("/production");
  const isAccounting = pathname.startsWith("/accounting");
  type Department = "ar" | "ap" | "reporting" | "batch" | "accounting" | "production";
  // Cross-cutting pages (Settings, Help) belong to no module. Landing on one
  // must NOT snap the sidebar back to Receivable — keep the module the user was
  // in so "click Settings → go back" stays in context.
  const isChrome = pathname.startsWith("/settings") || pathname.startsWith("/guide");
  const pathDepartment: Department | null =
    isProduction ? "production" : isAccounting ? "accounting" : isBatch ? "batch" : isReporting ? "reporting" : isPayables ? "ap" : isChrome ? null : "ar";
  const [lastDept, setLastDept] = useState<Department>(() => {
    if (typeof window === "undefined") return "ar";
    return ((localStorage.getItem("pa:lastDept") as Department) || "ar");
  });
  useEffect(() => {
    if (pathDepartment) { setLastDept(pathDepartment); try { localStorage.setItem("pa:lastDept", pathDepartment); } catch {} }
  }, [pathDepartment]);
  const department: Department = pathDepartment ?? lastDept;

  const [wsOpen, setWsOpen] = useState(false);

  const [responsesCount, setResponsesCount] = useState(0);
  useEffect(() => {
    fetch("/api/responses")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.counts) setResponsesCount(d.counts.needsAttention || 0); })
      .catch(() => {});
  }, [pathname]);

  const counts = {
    inbox: communications.filter(c => c.direction === "Inbound").length,
    invoices: invoices.filter(i => i.paymentStatus !== "Paid").length,
    tasks: tasks.filter(t => !t.completed).length,
    responses: responsesCount,
  };

  const arSections: { label?: string; items: NavItem[] }[] = [
    {
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      ],
    },
    {
      label: "SALES",
      items: [
        { href: "/invoices", label: "Invoices", icon: FileText, count: counts.invoices },
        { href: "/customers", label: "Customers", icon: Users },
        { href: "/projects", label: "Projects", icon: Briefcase },
      ],
    },
    {
      label: "RECEIVABLES",
      items: [
        { href: "/board", label: "Collections Board", icon: Kanban },
        { href: "/automations", label: "Automations", icon: Zap },
        { href: "/responses", label: "Customer Responses", icon: MessageSquare, count: counts.responses, urgent: true },
        { href: "/inbox", label: "Communication Notes", icon: Inbox, count: counts.inbox },
        { href: "/tasks", label: "Tasks", icon: CheckSquare, count: counts.tasks },
      ],
    },
    {
      label: "INSIGHTS",
      items: [
        { href: "/smart-views", label: "Smart Views", icon: Filter },
        { href: "/performance", label: "Performance", icon: TrendingUp },
        { href: "/reports", label: "Reports", icon: BarChart3 },
      ],
    },
  ];

  const apSections: { label?: string; items: NavItem[] }[] = [
    {
      items: [
        { href: "/payables/dashboard", label: "Dashboard", icon: LayoutDashboard },
      ],
    },
    {
      label: "PAYABLES",
      items: [
        { href: "/payables/purchase-orders", label: "Purchase Orders", icon: ShoppingCart },
        { href: "/payables/bills", label: "Bills", icon: Receipt },
        { href: "/payables/suppliers", label: "Suppliers", icon: Building2 },
      ],
    },
    {
      label: "OPERATIONS",
      items: [
        { href: "/payables/workspace", label: "Workspace", icon: Kanban },
        { href: "/payables/approval-inbox", label: "Approval Inbox", icon: Bell },
        { href: "/payables/supplier-queries", label: "Supplier Queries", icon: MessageSquare },
        { href: "/payables/payment-runs", label: "Payment Runs", icon: CreditCard },
        { href: "/payables/tasks", label: "Tasks", icon: CheckSquare },
        { href: "/payables/workflow-rules", label: "Workflow Rules", icon: Workflow },
        { href: "/payables/reports", label: "Reports", icon: BarChart3 },
      ],
    },
    {
      label: "INSIGHTS",
      items: [
        { href: "/payables/smart-views", label: "Smart Views", icon: Filter },
        { href: "/payables/performance", label: "Performance", icon: TrendingUp },
      ],
    },
  ];

  const reportingSections: { label?: string; items: NavItem[] }[] = [
    {
      items: [
        { href: "/reporting", label: "Overview", icon: LayoutDashboard },
      ],
    },
    {
      label: "FINANCIAL",
      items: [
        { href: "/reporting/profit-loss",    label: "Profit & Loss",    icon: TrendingUp },
        { href: "/reporting/balance-sheet",  label: "Balance Sheet",    icon: BookOpen },
        { href: "/reporting/cash-flow",      label: "Cash Flow",        icon: CreditCard },
        { href: "/reporting/trial-balance",  label: "Trial Balance",    icon: FileText },
      ],
    },
    {
      label: "AGEING",
      items: [
        { href: "/reporting/ar-aging", label: "AR Ageing",  icon: BarChart3 },
        { href: "/reporting/ap-aging", label: "AP Ageing",  icon: BarChart3 },
      ],
    },
    {
      label: "MANAGEMENT REPORTING",
      items: [
        { href: "/reporting/structure",    label: "P&L Structure",    icon: ListTree },
        { href: "/reporting/studio",       label: "Profit Centers",   icon: Layers },
        { href: "/reporting/by-dimension", label: "Management P&L",   icon: BarChart3 },
      ],
    },
  ];

  const accountingSections: { label?: string; items: NavItem[]; collapsible?: boolean; icon?: any }[] = [
    {
      label: "Sales",
      items: [
        { href: "/accounting/parties/customers",  label: "Customers",      icon: Users },
        { href: "/accounting/trade/estimates",    label: "Estimates",      icon: FileText },
        { href: "/accounting/trade/sales-orders", label: "Sales Orders",   icon: ShoppingCart },
        { href: "/accounting/shipping",           label: "Shipping",       icon: Truck },
      ],
    },
    {
      label: "Purchases",
      items: [
        { href: "/accounting/parties/suppliers",      label: "Suppliers",       icon: Building2 },
        { href: "/accounting/trade/purchase-orders",  label: "Purchase Orders", icon: ShoppingCart },
        { href: "/accounting/receiving",              label: "Receiving",       icon: PackageCheck },
        { href: "/accounting/jobwork",                label: "Job Work",        icon: Factory },
      ],
    },
    {
      label: "Master Data",
      collapsible: true,
      icon: Database,
      items: [
        { href: "/accounting/accounts",         label: "Chart of Accounts",   icon: BookOpen },
        { href: "/accounting/journal",          label: "Journal",             icon: FileText },
        { href: "/accounting/opening-balances", label: "Opening Balances",    icon: Scale },
        { href: "/accounting/products",      label: "Products & Services", icon: Package },
        { href: "/accounting/bom",           label: "Bill of Materials",   icon: GitBranch },
        { href: "/accounting/tax-rates",     label: "Tax Rates",           icon: Receipt },
        { href: "/accounting/classes",       label: "Classes",             icon: Layers },
        { href: "/accounting/locations",     label: "Locations",           icon: Building2 },
        { href: "/accounting/cost-centres",  label: "Cost Centres",        icon: CreditCard },
        { href: "/accounting/custom-fields", label: "Custom Fields",       icon: ListTree },
        { href: "/accounting/parties/employees", label: "Employees",       icon: Contact },
      ],
    },
    {
      items: [
        { href: "/accounting/reconcile", label: "Reconcile", icon: Landmark },
        { href: "/accounting/approvals", label: "Approvals", icon: ShieldCheck },
        { href: "/accounting/reports", label: "Reports", icon: BarChart3 },
      ],
    },
  ];

  const batchSections: { label?: string; items: NavItem[] }[] = [
    {
      items: [
        { href: "/batch", label: "Data Studio", icon: Layers },
        { href: "/batch/scheduled", label: "Scheduled Imports", icon: Clock },
        { href: "/batch/history", label: "Job History", icon: History },
      ],
    },
  ];


  const productionSections: { label?: string; items: NavItem[] }[] = [
    {
      items: [
        { href: "/production", label: "Schedule", icon: LayoutDashboard },
        { href: "/production/build", label: "Quick Build", icon: Workflow },
      ],
    },
    {
      label: "Reference",
      items: [
        { href: "/accounting/bom", label: "Bills of Material", icon: GitBranch },
        { href: "/accounting/products", label: "Products & Services", icon: Package },
      ],
    },
  ];

  const sections = department === "batch" ? batchSections
    : department === "production" ? productionSections
    : department === "accounting" ? accountingSections
    : department === "reporting" ? reportingSections
    : department === "ap" ? apSections
    : arSections;

  // Workspace switcher entries — literal Tailwind classes (never build at runtime).
  const reportingEnabled = !!orgSettings?.reportingEnabled;
  const WORKSPACES = [
    { key: "ar",         label: "Receivables", Icon: ArrowLeftRight, href: "/dashboard",          active: "bg-emerald-500/20 text-emerald-400", dot: "bg-emerald-400" },
    { key: "ap",         label: "Payables",    Icon: Package,        href: "/payables/dashboard", active: "bg-violet-500/20 text-violet-400",   dot: "bg-violet-400" },
    { key: "accounting", label: "Accounting",  Icon: BookOpen,       href: "/accounting",         active: "bg-teal-500/20 text-teal-400",       dot: "bg-teal-400" },
    { key: "production", label: "Production",  Icon: Workflow,       href: "/production",         active: "bg-orange-500/20 text-orange-400",   dot: "bg-orange-400" },
    ...(reportingEnabled ? [{ key: "reporting", label: "Reporting", Icon: BarChart3, href: "/reporting", active: "bg-blue-500/20 text-blue-400", dot: "bg-blue-400" }] : []),
    { key: "batch",      label: "Studio",      Icon: Layers,         href: "/batch",              active: "bg-amber-500/20 text-amber-400",     dot: "bg-amber-400" },
  ];
  const currentWs = WORKSPACES.find(w => w.key === department) ?? WORKSPACES[0];

  const userName = session?.user?.name || "User";
  const initials = userName.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();

  return (
    <aside
      className={[
        "bg-stone-950 border-r border-stone-800 flex flex-col h-screen overflow-hidden",
        "fixed inset-y-0 left-0 z-50",
        // Mobile: always w-60, transform controls visibility
        "w-60",
        isOpen ? "translate-x-0 shadow-2xl shadow-black/60 transition-transform duration-200" : "-translate-x-full transition-transform duration-200",
        // Desktop: sticky, width transitions on collapse
        collapsed
          ? "md:sticky md:top-0 md:translate-x-0 md:shadow-none md:w-0 md:min-w-0 md:border-r-0 md:transition-[width] md:duration-200 md:ease-in-out"
          : "md:sticky md:top-0 md:translate-x-0 md:shadow-none md:w-60 md:transition-[width] md:duration-200 md:ease-in-out",
      ].join(" ")}
    >
      {/* Logo */}
      <div className="px-4 py-4 border-b border-stone-800 flex items-start justify-between">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          {orgSettings?.logoUrl ? (
            <img
              src={orgSettings.logoUrl}
              alt={orgSettings?.displayName || orgSettings?.name || "Logo"}
              className="h-8 w-auto object-contain"
            />
          ) : (
            <div className="flex items-start gap-2">
              <div className="w-6 h-6 rounded-md bg-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-white tracking-tight leading-snug">
                {orgSettings?.displayName || orgSettings?.name || "Prime Accountax"}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="md:hidden p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-300 shrink-0"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>

      {/* Workspace switcher (dropdown) */}
      <div className="px-3 py-2 border-b border-stone-800 relative">
        <button
          onClick={() => setWsOpen(o => !o)}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border border-stone-700 hover:bg-stone-800 transition-colors"
        >
          <span className={`flex items-center gap-2 text-[12px] font-semibold rounded px-1.5 py-0.5 ${currentWs.active}`}>
            <currentWs.Icon size={13} />
            {currentWs.label}
          </span>
          <ChevronDown size={13} className={`text-stone-500 transition-transform ${wsOpen ? "rotate-180" : ""}`} />
        </button>
        {wsOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setWsOpen(false)} />
            <div className="absolute left-3 right-3 mt-1 z-50 bg-stone-900 border border-stone-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden py-1">
              {WORKSPACES.map(w => (
                <button
                  key={w.key}
                  onClick={() => { router.push(w.href); setWsOpen(false); onClose?.(); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-medium text-left transition-colors ${
                    w.key === department ? w.active : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                  }`}
                >
                  <w.Icon size={13} />
                  {w.label}
                  {w.key === department && <Check size={12} className="ml-auto" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col">
        <div className="flex-1">
          {sections.map((sec, si) => {
            const collapsible = (sec as any).collapsible as boolean | undefined;
            const SecIcon = (sec as any).icon as any;
            if (collapsible) {
              return <FlyoutGroup key={si} label={sec.label ?? ""} Icon={SecIcon} items={sec.items} onNavigate={() => onClose?.()} />;
            }
            return (
            <div key={si} className="mb-4">
              {sec.label && (
                <div className="px-2.5 mb-1.5 text-[10px] font-semibold text-stone-600 tracking-widest">
                  {sec.label}
                </div>
              )}
              {sec.items.map(item => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors mb-0.5 ${
                      isActive
                        ? department === "ap"
                          ? "bg-violet-500/15 text-violet-400"
                          : department === "reporting"
                          ? "bg-blue-500/15 text-blue-400"
                          : department === "batch"
                          ? "bg-amber-500/15 text-amber-400"
                          : "bg-emerald-500/15 text-emerald-400"
                        : "text-stone-400 hover:bg-stone-800/70 hover:text-stone-100"
                    }`}
                  >
                    <Icon
                      size={15}
                      strokeWidth={isActive ? 2.25 : 2}
                      className={isActive
                        ? department === "ap" ? "text-violet-400" : department === "reporting" ? "text-blue-400" : department === "batch" ? "text-amber-400" : "text-emerald-400"
                        : "text-stone-500"}
                    />
                    <span className="flex-1">{item.label}</span>
                    {item.count != null && item.count > 0 && (
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          (item as any).urgent
                            ? "bg-rose-500 text-white"
                            : isActive
                              ? department === "ap" ? "bg-violet-500/20 text-violet-400" : "bg-emerald-500/20 text-emerald-400"
                              : "bg-stone-800 text-stone-400"
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            );
          })}
        </div>
      </nav>

      <div className="p-3 border-t border-stone-800">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-600 to-emerald-900 flex items-center justify-center text-white text-[11px] font-semibold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-white truncate">{userName}</div>
            <div className="text-[10px] text-stone-500 truncate">{(session?.user as any)?.role || "User"}</div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-300"
            title="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * A nav group that reveals its items as a floating panel to the side on hover
 * (QBO-rail style) — portaled to <body> so the sidebar's scroll never clips it,
 * and positioned next to the header so it doesn't push the other sections.
 */
function FlyoutGroup({ label, Icon, items, onNavigate }: {
  label: string;
  Icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;
  items: NavItem[];
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [theme, setTheme] = useState<string>("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<any>(null);
  const active = items.some(i => pathname === i.href || pathname.startsWith(i.href + "/"));

  const openNow = () => {
    if (timer.current) clearTimeout(timer.current);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.round(r.right + 6), top: Math.round(r.top) });
    // The panel is portaled to <body>, outside the themed app shell — carry the
    // active theme across so it isn't stuck on the default (dark) tokens.
    setTheme(document.querySelector("[data-theme]")?.getAttribute("data-theme") ?? "");
    setOpen(true);
  };
  const closeSoon = () => { timer.current = setTimeout(() => setOpen(false), 160); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className="mb-4" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button ref={btnRef} onClick={openNow}
        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors ${active || open ? "bg-stone-800/70 text-stone-100" : "text-stone-300 hover:bg-stone-800/70 hover:text-stone-100"}`}>
        <Icon size={15} strokeWidth={2} className="text-stone-400" />
        <span className="flex-1 text-left">{label}</span>
        <ChevronRight size={13} className="text-stone-500" />
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div data-theme={theme || undefined}>
          <div style={{ position: "fixed", left: pos.left, top: pos.top }} onMouseEnter={openNow} onMouseLeave={closeSoon}
            className="z-[60] bg-stone-900 border border-stone-700 rounded-xl shadow-2xl shadow-black/50 py-2 min-w-[220px]">
            <div className="px-3 pb-1.5 text-[10px] font-semibold text-stone-500 uppercase tracking-widest">{label}</div>
            {items.map(item => {
              const Ic = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link key={item.href} href={item.href} onClick={() => { setOpen(false); onNavigate(); }}
                  className={`flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium transition-colors ${isActive ? "bg-emerald-500/15 text-emerald-400" : "text-stone-300 hover:bg-stone-800 hover:text-white"}`}>
                  <Ic size={15} className={isActive ? "text-emerald-400" : "text-stone-500"} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>, document.body)}
    </div>
  );
}
