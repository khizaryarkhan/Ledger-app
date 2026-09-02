"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard, XCircle, CreditCard, ScrollText, Users,
  Building2, FileText, LogOut, ShieldCheck, ChevronRight, Percent, BookOpen,
  Mail, Plug, Search, Package, ListTodo, BarChart3, Megaphone, Receipt, Clock, Copy, Zap,
  SlidersHorizontal, ShieldAlert, Network,
} from "lucide-react";
import type { ReactNode } from "react";
import { AdminCommandPalette, useCommandPalette } from "./_command-palette";
import { AdminNotifications } from "./_notifications";
import { PageGuide } from "./_page-guide";

type NavItem = { href: string; icon: any; label: string; exact?: boolean };
type NavSection = { label?: string; items: NavItem[] };

const NAV: NavSection[] = [
  { items: [{ href: "/admin", icon: LayoutDashboard, label: "Overview", exact: true }] },
  { label: "CRM", items: [
    { href: "/admin/queue",         icon: ListTodo,  label: "Today" },
    { href: "/admin/accounts",      icon: Building2, label: "Billing actions" },
    { href: "/admin/leads",         icon: FileText,  label: "Pipeline" },
    { href: "/admin/workflows",     icon: Zap,       label: "Workflows" },
    { href: "/admin/reports",       icon: BarChart3, label: "Reports" },
    { href: "/admin/campaigns",     icon: Megaphone, label: "Campaigns" },
    { href: "/admin/inbox",         icon: Mail,      label: "Mail" },
    { href: "/admin/accounts/duplicates", icon: Copy,        label: "Duplicates" },
    { href: "/admin/leads/spam",          icon: ShieldAlert, label: "Spam cleanup" },
  ] },
  { label: "BILLING", items: [
    { href: "/admin/customers",     icon: Building2,  label: "Customers" },
    { href: "/admin/groups",        icon: Network,    label: "Group Accounts" },
    { href: "/admin/invoices",      icon: Receipt,    label: "Invoices" },
    { href: "/admin/discounts",     icon: Percent,    label: "Discounts" },
    { href: "/admin/settings/items", icon: Package,   label: "Items" },
    { href: "/admin/cancellations", icon: XCircle,    label: "Cancellations" },
    { href: "/admin/temp-access",   icon: Clock,      label: "Temp access" },
    { href: "/admin/audit",         icon: ScrollText, label: "Audit Log" },
    { href: "/admin/reconcile",     icon: ShieldCheck, label: "Ledger Health" },
  ] },
  { label: "SETTINGS", items: [
    { href: "/admin/settings/email",         icon: Plug,             label: "Email Integration" },
    { href: "/admin/settings/custom-fields", icon: SlidersHorizontal, label: "Custom Fields" },
    { href: "/admin/team",                   icon: Users,            label: "Admin Team" },
  ] },
  { items: [{ href: "/admin/guide", icon: BookOpen, label: "Guide" }] },
];

// Premium navy/indigo re-skin, scoped to .pa-admin so the customer app is
// untouched. Remaps the warm "stone" palette the pages use to cool navy.
const THEME_CSS = `
.pa-admin{--pa-bg:#0B0E15;--pa-panel:#0E1320;--pa-ac:#7C7AF6}
.pa-admin .bg-stone-950{background-color:#0B0E15 !important}
.pa-admin .bg-stone-900{background-color:#111726 !important}
.pa-admin .bg-stone-800{background-color:#1B2336 !important}
.pa-admin .bg-stone-700{background-color:#243049 !important}
.pa-admin .bg-stone-600{background-color:#2f3d59 !important}
.pa-admin .bg-stone-900\\/40{background-color:rgba(17,23,38,.55) !important}
.pa-admin .bg-stone-900\\/50{background-color:rgba(17,23,38,.65) !important}
.pa-admin .bg-stone-900\\/60{background-color:rgba(17,23,38,.78) !important}
.pa-admin .bg-stone-800\\/60{background-color:rgba(27,35,54,.6) !important}
.pa-admin .bg-stone-800\\/50{background-color:rgba(27,35,54,.5) !important}
.pa-admin .bg-stone-800\\/40{background-color:rgba(27,35,54,.4) !important}
.pa-admin .bg-stone-800\\/30{background-color:rgba(27,35,54,.32) !important}
.pa-admin .bg-stone-800\\/25{background-color:rgba(27,35,54,.28) !important}
.pa-admin .bg-stone-800\\/20{background-color:rgba(27,35,54,.24) !important}
.pa-admin .hover\\:bg-stone-800:hover{background-color:#1B2336 !important}
.pa-admin .hover\\:bg-stone-900:hover{background-color:#111726 !important}
.pa-admin .hover\\:bg-stone-800\\/70:hover{background-color:rgba(27,35,54,.7) !important}
.pa-admin .hover\\:bg-stone-800\\/40:hover{background-color:rgba(27,35,54,.4) !important}
.pa-admin .border-stone-800{border-color:#202A3E !important}
.pa-admin .border-stone-700{border-color:#2A3650 !important}
.pa-admin .border-stone-600{border-color:#3a4a66 !important}
.pa-admin .border-stone-800\\/60{border-color:rgba(32,42,62,.6) !important}
.pa-admin .border-stone-800\\/50{border-color:rgba(32,42,62,.5) !important}
.pa-admin .ring-stone-800{--tw-ring-color:#202A3E !important}
.pa-admin .ring-stone-700{--tw-ring-color:#2A3650 !important}
.pa-admin .text-stone-200{color:#E8EBF4 !important}
.pa-admin .text-stone-300{color:#CDD4E2 !important}
.pa-admin .text-stone-400{color:#98A1B6 !important}
.pa-admin .text-stone-500{color:#6F7A92 !important}
.pa-admin .text-stone-600{color:#525C72 !important}
.pa-admin .text-stone-700{color:#3d465a !important}
`;

export default function AdminLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const user = session?.user as any;
  const { open: searchOpen, setOpen: setSearchOpen } = useCommandPalette();

  if (role !== "super_admin" && role !== "platform_admin") {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <ShieldCheck size={28} className="text-stone-600" />
        <p className="text-sm text-stone-400">Access restricted to platform administrators.</p>
      </div>
    );
  }

  const initials = (user?.name ?? "A").split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();

  const renderItem = ({ href, icon: Icon, label, exact }: NavItem) => {
    const active = exact ? path === href : (path === href || path.startsWith(href + "/"));
    return (
      <Link key={href} href={href}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition-colors group ${
          active ? "text-white font-medium" : "text-stone-500 hover:text-stone-200"}`}
        style={active ? { background: "rgba(124,122,246,0.14)", boxShadow: "inset 0 0 0 0.5px rgba(124,122,246,0.35)" } : undefined}>
        <Icon size={15} className={active ? "text-violet-300" : "text-stone-600 group-hover:text-stone-400"} />
        <span className="flex-1">{label}</span>
        {active && <ChevronRight size={12} className="text-violet-300/60" />}
      </Link>
    );
  };

  return (
    <div className="pa-admin flex min-h-screen" style={{ background: "#0B0E15" }}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />

      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col pt-5 pb-4" style={{ background: "#0E1320", borderRight: "0.5px solid #202A3E" }}>
        <div className="px-4 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "#7C7AF6" }}>
              <ShieldCheck size={16} className="text-white" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-white leading-none">Admin Portal</p>
              <p className="text-[10px] text-stone-600 mt-1">Prime Accountax</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2.5 space-y-3.5 overflow-y-auto">
          {NAV.map((section, i) => (
            <div key={i} className="space-y-1">
              {section.label && <p className="text-[9px] text-stone-700 font-semibold uppercase tracking-[0.14em] px-2.5 pb-1 pt-0.5">{section.label}</p>}
              {section.items.map(renderItem)}
            </div>
          ))}
        </nav>

        <div className="px-2.5 pt-3 mt-3" style={{ borderTop: "0.5px solid rgba(32,42,62,0.6)" }}>
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0" style={{ background: "linear-gradient(135deg,#7C7AF6,#4F46E5)" }}>{initials}</div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-stone-300 truncate">{user?.name ?? "Admin"}</p>
              <p className="text-[10px] text-stone-600 truncate">{user?.email ?? ""}</p>
            </div>
            <button onClick={() => signOut({ callbackUrl: "https://admin.primeaccountax.com/login" })}
              className="p-1.5 rounded-lg text-stone-600 hover:text-rose-400 transition-colors" title="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Command top bar */}
        <header className="h-14 shrink-0 flex items-center gap-3 px-6" style={{ borderBottom: "0.5px solid #202A3E" }}>
          <button type="button" onClick={() => setSearchOpen(true)}
            className="flex-1 max-w-md h-9 rounded-xl flex items-center gap-2.5 px-3.5 text-left transition-colors hover:border-stone-600"
            style={{ background: "#111726", border: "0.5px solid #202A3E" }}>
            <Search size={14} className="text-stone-600" />
            <span className="text-[12.5px] text-stone-600">Search leads, deals, customers…</span>
            <span className="ml-auto text-[10px] text-stone-500 px-1.5 py-0.5 rounded-md" style={{ background: "#1B2336" }}>⌘K</span>
          </button>
          <div className="flex-1" />
          <PageGuide />
          <AdminNotifications />
        </header>

        <AdminCommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

        <main className="flex-1 min-w-0 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
