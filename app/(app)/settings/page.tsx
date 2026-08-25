"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useData } from "@/components/data-provider";
import { Card } from "@/components/ui";
import { Building2, Users, Link2, Mail, Layers, CreditCard, ChevronRight, CheckCircle, AlertCircle, Loader, BookOpen, BarChart3, SunMoon, Coins, CalendarRange, Hash } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export default function SettingsPage() {
  const { data: session } = useSession();
  const { reps, regions, orgSettings } = useData();
  const [qboStatus, setQboStatus]     = useState<any>(null);
  const [xeroStatus, setXeroStatus]   = useState<any>(null);
  const [emailStatus, setEmailStatus] = useState<any>(null);

  useEffect(() => {
    fetch("/api/qbo/sync")
      .then(r => r.json()).then(setQboStatus)
      .catch(() => setQboStatus({ connected: false }));
    fetch("/api/xero/sync")
      .then(r => r.json()).then(setXeroStatus)
      .catch(() => setXeroStatus({ connected: false }));
    // Check active email transport (Gmail first, then Microsoft, then SMTP)
    Promise.all([
      fetch("/api/gmail?status=1").then(r => r.json()).catch(() => ({ connected: false })),
      fetch("/api/microsoft?status=1").then(r => r.json()).catch(() => ({ connected: false })),
      fetch("/api/org/smtp").then(r => r.json()).catch(() => ({ configured: false })),
    ]).then(([gmail, ms, smtp]) => {
      if (gmail.connected)      setEmailStatus({ state: "ok",  label: `Gmail · ${gmail.email}` });
      else if (ms.connected)    setEmailStatus({ state: "ok",  label: `Microsoft · ${ms.email}` });
      else if (smtp.configured) setEmailStatus({ state: "ok",  label: `SMTP · ${smtp.settings?.fromEmail}` });
      else                      setEmailStatus({ state: "off", label: "Not configured" });
    });
  }, []);

  const userName  = session?.user?.name  || "";
  const userEmail = session?.user?.email || "";

  // Grouped by what you came here to change, so the page can be scanned rather
  // than read. A flat list mixed "who we are" with "how the books behave" and
  // with shortcuts to data views that aren't settings at all.
  const sections = [
    {
      heading: "Organisation",
      blurb: "Who you are, who works here, and what you pay for the service.",
      items: [
        {
          href: "/settings/company",
          icon: Building2,
          title: "Company",
          description: "Profile, logo, address and the company details printed on invoices and purchase orders.",
          badge: null,
        },
        {
          href: "/settings/team",
          icon: Users,
          title: "Team",
          description: `${reps?.length ?? 0} rep${(reps?.length ?? 0) !== 1 ? "s" : ""} · ${regions?.length ?? 0} region${(regions?.length ?? 0) !== 1 ? "s" : ""}. Reps, regions, portal logins and classification.`,
          badge: null,
        },
        {
          href: "/settings/billing",
          icon: CreditCard,
          title: "Billing",
          description: "Your plan, payment history, payment method and cancellation.",
          badge: null,
        },
      ],
    },
    {
      heading: "Accounting",
      blurb: "How your books are structured and how entries are posted.",
      items: [
        {
          // The real settings page for accounting master data. The index used to
          // link to /accounting (the module) instead, leaving this orphaned.
          href: "/settings/accounting",
          icon: BookOpen,
          title: "Chart of Accounts",
          description: "Accounts, products & services, tax rates and dimensions — synced or created natively.",
          badge: null,
        },
        {
          href: "/settings/currency",
          icon: Coins,
          title: "Currency",
          description: "The home currency your books are kept in, and whether foreign-currency entry is allowed.",
          badge: orgSettings?.currency
            ? { state: "info", label: `${orgSettings.currency}${orgSettings.multicurrencyEnabled ? " · multi-currency" : ""}` }
            : null,
        },
        {
          href: "/settings/financial-year",
          icon: CalendarRange,
          title: "Financial Year",
          description: "Fiscal year start month and the period-close lock date for posted entries.",
          badge: orgSettings?.fiscalYearStartMonth
            ? { state: "info", label: `Starts ${MONTHS[(orgSettings.fiscalYearStartMonth - 1) % 12]}` }
            : null,
        },
        {
          href: "/settings/numbering",
          icon: Hash,
          title: "Transaction Numbers",
          description: "Prefix, next number and padding for each document series.",
          badge: null,
        },
      ],
    },
    {
      heading: "Connections",
      blurb: "External systems this workspace talks to. Reporting reads live figures from whichever ledger is connected here.",
      items: [
        {
          href: "/settings/integrations",
          icon: Link2,
          title: "Integrations",
          description: "QuickBooks Online and Xero sync, reconciliation and data verification.",
          badge:
            (qboStatus === null && xeroStatus === null)
              ? { state: "loading", label: "" }
              : qboStatus?.connected
              ? { state: "ok",  label: `Connected · ${qboStatus.companyName || "QBO"}` }
              : xeroStatus?.connected
              ? { state: "ok",  label: `Connected · ${xeroStatus.tenantName || "Xero"}` }
              : (qboStatus !== null || xeroStatus !== null)
              ? { state: "off", label: "Not connected" }
              : { state: "loading", label: "" },
        },
        {
          // Grouped with Integrations because that's what it depends on — it's
          // switched on here but powered by the connected QBO/Xero ledger.
          href: "/settings/reporting",
          icon: BarChart3,
          title: "Reporting",
          description: "Live P&L, Balance Sheet and Cash Flow pulled from the connected QuickBooks or Xero ledger.",
          badge: orgSettings?.reportingEnabled
            ? { state: "ok",  label: "Enabled" }
            : { state: "off", label: "Disabled" },
        },
        {
          href: "/settings/email",
          icon: Mail,
          title: "Email",
          description: "Gmail, Microsoft or SMTP for outbound collection emails.",
          badge: emailStatus === null ? { state: "loading", label: "" } : emailStatus,
        },
      ],
    },
    {
      heading: "Workspace",
      blurb: "How the app itself looks and behaves for your team.",
      items: [
        {
          href: "/settings/stages",
          icon: Layers,
          title: "Collection Stages",
          description: "Rename, recolour and show/hide the board columns to match your process.",
          badge: null,
        },
        {
          href: "/settings/appearance",
          icon: SunMoon,
          title: "Appearance",
          description: "Dark, light or system theme — how the app looks on this device.",
          badge: null,
        },
      ],
    },
  ];

  return (
    <div className="p-6 max-w-[860px] mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Settings</h1>
        <p className="text-sm text-stone-400 mt-1">
          Manage your company, team, integrations and email preferences.
        </p>
      </div>

      {/* Profile summary */}
      <div className="flex items-center gap-3 mb-8 p-4 bg-stone-900 rounded-xl ring-1 ring-stone-800">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-stone-600 to-stone-800 flex items-center justify-center text-white text-sm font-semibold shrink-0">
          {userName.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-semibold text-white">{userName}</div>
          <div className="text-[12px] text-stone-400">{userEmail}</div>
        </div>
        <div className="ml-auto">
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-700 text-stone-300">
            {(session?.user as any)?.role || "User"}
          </span>
        </div>
      </div>

      {/* Grouped settings */}
      {sections.map(section => (
        <section key={section.heading} className="mb-8 last:mb-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{section.heading}</h2>
          <p className="text-[12px] text-stone-600 mt-0.5 mb-3">{section.blurb}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {section.items.map(group => {
          const Icon = group.icon;
          return (
            <Link key={group.href} href={group.href} className="block">
              <Card className="h-full hover:shadow-md hover:ring-stone-700 transition-all cursor-pointer group p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-stone-800 flex items-center justify-center shrink-0 group-hover:bg-stone-700 transition-colors">
                    <Icon size={18} className="text-stone-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-semibold text-white">{group.title}</h3>
                      <ChevronRight size={15} className="text-stone-500 group-hover:text-stone-200 transition-colors shrink-0" />
                    </div>
                    <p className="text-[12px] text-stone-500 leading-relaxed mb-3">{group.description}</p>

                    {group.badge && (
                      group.badge.state === "loading" ? (
                        <div className="inline-flex items-center gap-1.5">
                          <Loader size={11} className="animate-spin text-stone-400" />
                          <span className="text-[11px] text-stone-400">Checking…</span>
                        </div>
                      ) : group.badge.state === "info" ? (
                        // A current value, not a health status — so no tick and
                        // no warning icon, both of which would imply otherwise.
                        <div className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-stone-800 text-stone-300">
                          {group.badge.label}
                        </div>
                      ) : (
                        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          group.badge.state === "ok"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-stone-800 text-stone-400"
                        }`}>
                          {group.badge.state === "ok"
                            ? <CheckCircle size={11} />
                            : <AlertCircle size={11} />}
                          {group.badge.label}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
