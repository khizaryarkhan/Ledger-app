"use client";

import { useEffect, ReactNode } from "react";
import Link from "next/link";
import { X, Check, AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";

/**
 * Standard wrapper for a single accounting report page — back-link to the
 * reports hub, title + icon, refresh button, and the report body. Shared by
 * finance/procurement/sales/stock report components.
 */
export function ReportShell({ title, sub, icon: Icon, children, onRefresh, loading }: { title: string; sub: string; icon: any; children: ReactNode; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="p-6 max-w-5xl">
      <Link href="/accounting/reports" className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-3"><ArrowLeft size={13} /> All reports</Link>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center"><Icon size={18} className="text-indigo-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">{title}</h1>
        </div>
        <button onClick={onRefresh} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">{sub}</p>
      {children}
    </div>
  );
}

export const Badge = ({ children, variant = "neutral", size = "sm" }: { children: ReactNode; variant?: string; size?: string }) => {
  const variants: Record<string, string> = {
    neutral: "bg-stone-800 text-stone-300 ring-stone-700",
    blue: "bg-blue-500/15 text-blue-400 ring-blue-500/30",
    green: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
    yellow: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
    red: "bg-rose-500/15 text-rose-400 ring-rose-500/30",
    purple: "bg-violet-500/15 text-violet-400 ring-violet-500/30",
    orange: "bg-orange-500/15 text-orange-400 ring-orange-500/30",
  };
  const sizes: Record<string, string> = { sm: "text-[11px] px-2 py-0.5", md: "text-xs px-2.5 py-1" };
  return <span className={`inline-flex items-center gap-1 rounded-md ring-1 ring-inset font-medium ${variants[variant]} ${sizes[size]}`}>{children}</span>;
};

export const stageBadge = (stage: string) => {
  const map: Record<string, string> = {
    "New": "neutral",
    "Scheduled": "blue", "Reminder Scheduled": "blue",
    "Reminder Sent": "blue",
    "Second Notice": "purple",
    "Final Notice": "purple",
    "Awaiting": "purple", "Awaiting Reply": "purple",
    "Promised": "yellow", "Promise to Pay": "yellow",
    "Disputed": "red",
    "Escalated": "red",
    "On Hold": "orange",
    "Closed": "green",
  };
  return map[stage] || "neutral";
};

export const dueStatusBadge = (status: string) => {
  const map: Record<string, string> = { "Paid": "green", "Overdue": "red", "Due Today": "orange", "Due Soon": "yellow", "Not Due": "neutral", "Written Off": "neutral" };
  return map[status] || "neutral";
};

export const Button = ({ children, variant = "primary", size = "md", onClick, disabled, icon: Icon, type = "button", className = "" }: any) => {
  const variants: Record<string, string> = {
    primary: "bg-emerald-500 text-white hover:bg-emerald-400 disabled:bg-stone-700 disabled:text-stone-500",
    secondary: "bg-stone-800 text-stone-200 ring-1 ring-stone-700 hover:bg-stone-700 hover:ring-stone-600",
    ghost: "text-stone-400 hover:bg-stone-800 hover:text-stone-100",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
  };
  const sizes: Record<string, string> = { sm: "h-7 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-10 px-4 text-sm gap-2" };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center font-medium rounded-md transition-colors ${variants[variant]} ${sizes[size]} ${className}`}>
      {Icon && <Icon size={size === "sm" ? 13 : 15} strokeWidth={2} />}
      {children}
    </button>
  );
};

export const Input = ({ value, onChange, placeholder, type = "text", className = "", icon: Icon, ...rest }: any) => (
  <div className={`relative ${className}`}>
    {Icon && <Icon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" strokeWidth={2} />}
    <input type={type} value={value ?? ""} onChange={onChange} placeholder={placeholder}
      className={`w-full h-9 ${Icon ? "pl-8" : "pl-3"} pr-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors`}
      {...rest} />
  </div>
);

export const Select = ({ value, onChange, options, placeholder, className = "" }: any) => (
  <select value={value ?? ""} onChange={onChange}
    className={`h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none appearance-none bg-no-repeat ${className}`}
    style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundSize: "12px" }}>
    {placeholder && <option value="">{placeholder}</option>}
    {options.map((o: any) => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
  </select>
);

export const Card = ({ children, className = "", padding = "md", ...rest }: any) => {
  const pad: Record<string, string> = { none: "", sm: "p-3", md: "p-5", lg: "p-6" };
  return <div className={`bg-stone-900 rounded-lg border border-stone-800 ${pad[padding]} ${className}`} {...rest}>{children}</div>;
};

export const Modal = ({ open, onClose, title, children, size = "md", footer }: any) => {
  if (!open) return null;
  const sizes: Record<string, string> = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-stone-900 border border-stone-800 rounded-xl shadow-2xl w-full ${sizes[size]} max-h-[92vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <h3 className="text-base font-semibold text-white tracking-tight">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-md text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition-colors"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-stone-800 flex items-center justify-end gap-2 bg-stone-950/50 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
};

export const EmptyState = ({ icon: Icon, title, description, action }: any) => (
  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mb-4">
      <Icon size={20} className="text-stone-500" strokeWidth={1.75} />
    </div>
    <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
    <p className="text-sm text-stone-500 max-w-sm mb-5">{description}</p>
    {action}
  </div>
);

export const Toast = ({ toast, onClose }: any) => {
  useEffect(() => {
    if (toast) { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }
  }, [toast, onClose]);
  if (!toast) return null;
  const variants: Record<string, string> = { success: "bg-emerald-600", error: "bg-rose-600", info: "bg-stone-800 border border-stone-700" };
  return (
    <div className="fixed bottom-6 right-6 z-50 animate-toast">
      <div className={`${variants[toast.type] || variants.info} text-white px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2`}>
        {toast.type === "success" && <Check size={16} />}
        {toast.type === "error" && <AlertCircle size={16} />}
        {toast.message}
      </div>
    </div>
  );
};

export const RegionFilter = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const { REGIONS } = require("@/lib/regions");
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none appearance-none bg-no-repeat"
      style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundSize: "12px" }}>
      <option value="">All regions</option>
      {REGIONS.map((r: any) => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select>
  );
};
