"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard, Users, Briefcase, FileText, Kanban, Filter, Inbox,
  CheckSquare, BarChart3, Upload, Zap, Settings, LogOut, Shield, TrendingUp, X,
  MessageSquare, ShoppingCart, Receipt, Building2, CreditCard,
  ChevronDown, ArrowLeftRight, Bell, Workflow, Package, BookOpen,
  Layers, History, Clock, GitBranch, ListTree
} from "lucide-react";
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
  const isPayables  = pathname.startsWith("/payables");
  const isReporting = pathname.startsWith("/reporting");
  const isBatch     = pathname.startsWith("/batch");
  const department: "ar" | "ap" | "reporting" | "batch" =
    isBatch ? "batch" : isReporting ? "reporting" : isPayables ? "ap" : "ar";

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

  const batchSections: { label?: string; items: NavItem[] }[] = [
    {
      items: [
        { href: "/batch", label: "Data Studio", icon: Layers },
        { href: "/batch/scheduled", label: "Scheduled Imports", icon: Clock },
        { href: "/batch/history", label: "Job History", icon: History },
      ],
    },
  ];

  // CONFIGURE is shared — always rendered at the bottom regardless of department.
  // Links are contextual so Settings/Imports point to the right section.
  const configureSections: { label?: string; items: NavItem[] }[] = [
    {
      label: "CONFIGURE",
      items: [
        {
          href: department === "ap" ? "/payables/imports" : "/imports",
          label: "Imports",
          icon: Upload,
        },
        {
          href: department === "ap" ? "/payables/settings" : "/settings",
          label: "Settings",
          icon: Settings,
        },
        {
          href: "/guide",
          label: "Help & Guide",
          icon: BookOpen,
        },
      ],
    },
  ];

  const sections = department === "batch" ? batchSections
    : department === "reporting" ? reportingSections
    : department === "ap" ? apSections
    : arSections;

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

      {/* Department switcher */}
      <div className="px-3 py-2 border-b border-stone-800">
        <div className={`flex rounded-md overflow-hidden border border-stone-700 ${orgSettings?.reportingEnabled ? "flex-wrap" : ""}`}>
          <button
            onClick={() => { router.push("/dashboard"); onClose?.(); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold transition-colors ${
              department === "ar"
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-stone-500 hover:text-stone-300 hover:bg-stone-800"
            }`}
          >
            <ArrowLeftRight size={11} />
            Receivables
          </button>
          <div className="w-px bg-stone-700" />
          <button
            onClick={() => { router.push("/payables/dashboard"); onClose?.(); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold transition-colors ${
              department === "ap"
                ? "bg-violet-500/20 text-violet-400"
                : "text-stone-500 hover:text-stone-300 hover:bg-stone-800"
            }`}
          >
            <Package size={11} />
            Payables
          </button>
          {orgSettings?.reportingEnabled && (
            <>
              <div className="w-px bg-stone-700" />
              <button
                onClick={() => { router.push("/reporting"); onClose?.(); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  department === "reporting"
                    ? "bg-blue-500/20 text-blue-400"
                    : "text-stone-500 hover:text-stone-300 hover:bg-stone-800"
                }`}
              >
                <BarChart3 size={11} />
                Reporting
              </button>
            </>
          )}
          <div className="w-px bg-stone-700" />
          <button
            onClick={() => { router.push("/batch"); onClose?.(); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold transition-colors ${
              department === "batch"
                ? "bg-amber-500/20 text-amber-400"
                : "text-stone-500 hover:text-stone-300 hover:bg-stone-800"
            }`}
          >
            <Layers size={11} />
            Studio
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col">
        <div className="flex-1">
          {sections.map((sec, si) => (
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
          ))}
        </div>

        {/* Shared CONFIGURE — always at the bottom, same in both departments */}
        <div className="border-t border-stone-800/60 pt-3 mt-1">
          {configureSections.map((sec, si) => (
            <div key={si} className="mb-2">
              <div className="px-2.5 mb-1.5 text-[10px] font-semibold text-stone-600 tracking-widest">
                {sec.label}
              </div>
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
                        ? "bg-stone-700/60 text-stone-200"
                        : "text-stone-500 hover:bg-stone-800/70 hover:text-stone-300"
                    }`}
                  >
                    <Icon
                      size={15}
                      strokeWidth={isActive ? 2.25 : 2}
                      className={isActive ? "text-stone-300" : "text-stone-600"}
                    />
                    <span className="flex-1">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
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
