"use client";

/**
 * Form kit — the shared field system for every entry form in the app
 * (New Document form + Receiving / Shipping / BOM / Products / MO drawers).
 *
 * Design goals (polished dark):
 *  - Inputs sit ON the surface (bg-stone-900 over a stone-950 panel) so fields
 *    read as distinct controls, not flat rectangles that vanish into the page.
 *  - One consistent field anatomy: micro-label → control → hint/error.
 *  - Real focus affordance (emerald ring), hover feedback, smooth transitions.
 *  - Line-item tables use "ghost" cell controls that read like a clean ledger:
 *    transparent until hovered/focused, so a grid of inputs stops looking boxy.
 *
 * These are the single source of truth — don't hand-roll input class strings in
 * feature components; compose from here so every form stays consistent.
 */

import { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

// ── Control class tokens ──────────────────────────────────────────────────
/** Standard boxed control (text / number / date / native select). h-9 ≈ 36px. */
export const control =
  "w-full h-9 rounded-lg bg-stone-900 border border-stone-700/70 px-3 text-[13px] text-stone-100 " +
  "placeholder:text-stone-600 outline-none transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:border-stone-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";
/** Native <select> variant — hide the OS arrow (we draw our own chevron). */
export const controlSelect = control + " appearance-none pr-9 cursor-pointer";
/** Micro field label. */
export const fieldLabel = "block text-[11px] font-medium uppercase tracking-wider text-stone-400 mb-1.5";

/**
 * Inset variants — for surfaces that are already stone-900 (the side drawers).
 * Here the control sits BELOW the surface (bg-stone-950) so it still separates.
 */
export const controlInset =
  "w-full h-9 rounded-lg bg-stone-950 border border-stone-700/70 px-3 text-[13px] text-stone-100 " +
  "placeholder:text-stone-600 outline-none transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:border-stone-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";
export const controlSelectInset = controlInset + " appearance-none pr-9 cursor-pointer";

/** Ghost table-cell control — chrome only on hover/focus, reads like a ledger. */
export const cell =
  "w-full h-8 rounded-md bg-transparent border border-transparent px-2 text-[13px] text-stone-100 " +
  "placeholder:text-stone-600 outline-none transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:bg-stone-900/70 hover:border-stone-700/70 focus:bg-stone-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
export const cellSelectCls = cell + " appearance-none pr-6 cursor-pointer";
/** Table header cell. */
export const th = "text-left font-medium text-[10px] uppercase tracking-wider text-stone-500 px-2.5 py-2.5";

// ── Field wrapper: label → control → hint/error ───────────────────────────
export function Field({
  label, required, hint, error, htmlFor, className = "", children,
}: {
  label?: ReactNode; required?: boolean; hint?: ReactNode; error?: ReactNode;
  htmlFor?: string; className?: string; children: ReactNode;
}) {
  return (
    <div className={className}>
      {label != null && (
        <label htmlFor={htmlFor} className={fieldLabel}>
          {label}{required && <span className="text-emerald-500/80 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error != null ? (
        <p className="mt-1 text-[11px] text-rose-400">{error}</p>
      ) : hint != null ? (
        <p className="mt-1 text-[11px] text-stone-500">{hint}</p>
      ) : null}
    </div>
  );
}

// ── Native select with our own chevron (boxed variant) ────────────────────
export function SelectField({
  className = "", inset = false, children, ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { inset?: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      <select className={`${inset ? controlSelectInset : controlSelect} ${className}`} {...props}>{children}</select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
    </div>
  );
}

// ── Ghost cell select with a compact chevron (for line-item tables) ───────
export function CellSelect({
  className = "", children, ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div className="relative">
      <select className={`${cellSelectCls} ${className}`} {...props}>{children}</select>
      <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-stone-600" />
    </div>
  );
}

// ── Titled section: groups related fields with a quiet heading ────────────
export function Section({
  title, desc, right, className = "", children,
}: {
  title?: ReactNode; desc?: ReactNode; right?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`space-y-3.5 ${className}`}>
      {(title != null || right != null) && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title != null && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{title}</h3>}
            {desc != null && <p className="text-[11px] text-stone-500 mt-0.5">{desc}</p>}
          </div>
          {right != null && <div className="shrink-0">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A quiet card surface to sit a section on (raises it off the panel). */
export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-stone-800/80 bg-stone-900/40 p-4 ${className}`}>
      {children}
    </div>
  );
}
