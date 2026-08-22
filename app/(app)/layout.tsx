"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, Sun, Moon, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import AuthProvider from "@/components/auth-provider";
import { DataProvider, useData } from "@/components/data-provider";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import { OrgSwitcher } from "@/components/org-switcher";
import { CreateMenu } from "@/components/create-menu";
import { ConfigMenu } from "@/components/config-menu";
import { GlobalSearch } from "@/components/global-search";
import { SyncButton } from "@/components/sync-button";
import { Toast } from "@/components/ui";
import { SubscriptionGate } from "@/components/subscription-gate";

function ThemeToggle() {
  const { resolved, setPref } = useTheme();
  return (
    <button
      onClick={() => setPref(resolved === "dark" ? "light" : "dark")}
      className="p-1.5 rounded-md hover:bg-stone-800 text-stone-500 hover:text-stone-200 transition-colors"
      title={`Switch to ${resolved === "dark" ? "light" : "dark"} view · more options in Settings → Appearance`}
      aria-label="Toggle theme"
    >
      {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { loaded, toastState, clearToast } = useData();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (localStorage.getItem("sidebar-collapsed") === "true") setSidebarCollapsed(true);
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed(v => {
      localStorage.setItem("sidebar-collapsed", String(!v));
      return !v;
    });
  };
  const isAdminRoute  = pathname === "/admin" || pathname.startsWith("/admin/");
  const isReportRoute = pathname === "/ar-report" || pathname.startsWith("/ar-report/");

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950">
        <div className="text-stone-500 text-sm">Loading…</div>
      </div>
    );
  }

  // Admin portal and print report get their own clean shell — no sidebar/org-switcher
  if (isAdminRoute || isReportRoute) {
    return (
      <div className="min-h-screen bg-white">
        {children}
        <Toast toast={toastState} onClose={clearToast} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-stone-950 text-stone-100">
      {/* Mobile backdrop — tap to close sidebar */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} collapsed={sidebarCollapsed} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="h-11 shrink-0 border-b border-stone-800 bg-stone-950 flex items-center px-2 gap-1">
          {/* Desktop sidebar toggle */}
          <button
            className="hidden md:flex p-1.5 rounded-md hover:bg-stone-800 text-stone-500 hover:text-stone-200 transition-colors"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          {/* Mobile hamburger */}
          <button
            className="md:hidden p-1.5 rounded-md hover:bg-stone-800 text-stone-500 hover:text-stone-200 transition-colors"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <div className="ml-1"><CreateMenu /></div>
          <div className="ml-2 hidden sm:block"><GlobalSearch /></div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 pr-3">
            <ThemeToggle />
            <ConfigMenu />
            <SyncButton />
            <OrgSwitcher />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <SubscriptionGate>{children}</SubscriptionGate>
        </main>
      </div>

      <Toast toast={toastState} onClose={clearToast} />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </DataProvider>
    </AuthProvider>
  );
}
