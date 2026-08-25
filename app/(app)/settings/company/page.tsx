"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import { MfaCard } from "@/components/mfa-card";
import { ChevronLeft, User, Palette, Calendar, LayoutDashboard, ChevronDown, Search, Check, Upload, FileText } from "lucide-react";


export default function CompanySettingsPage() {
  const { data: session } = useSession();
  const { orgSettings, updateOrgSettings, toast } = useData();
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Downscale the chosen image in the browser to a small PNG data URL, so a
  // logo works with no external storage (no Vercel Blob / token needed). Max
  // 512px on the longest side keeps it tiny (typically 20–90 KB) — plenty for
  // the sidebar (~32px) and the statement PDF masthead (~36px). Rasterising
  // also means SVG logos render on the PDF, which pdf-lib can't embed directly.
  function fileToScaledDataUrl(file: File, max = 512): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Couldn't read the file"));
      reader.onload = () => {
        img.onerror = () => reject(new Error("That file isn't a valid image"));
        img.onload = () => {
          const w0 = img.naturalWidth || max, h0 = img.naturalHeight || max;
          const scale = Math.min(max / w0, max / h0, 1);
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Canvas not available"));
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/png"));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleLogoFile(file: File) {
    if (!file.type.startsWith("image/")) { toast?.("Please choose an image file (PNG, JPG or SVG)", "error"); return; }
    if (file.size > 8 * 1024 * 1024) { toast?.("Image must be 8 MB or smaller", "error"); return; }
    setUploadingLogo(true);
    try {
      const dataUrl = await fileToScaledDataUrl(file);
      setBrandingForm(p => ({ ...p, logoUrl: dataUrl }));
      await updateOrgSettings({ logoUrl: dataUrl });
      toast?.("Logo saved");
    } catch (e: any) {
      toast?.(e?.message || "Couldn't process that image", "error");
    } finally {
      setUploadingLogo(false);
    }
  }

  const role = (session?.user as any)?.role;
  const isAdmin = role === "company_admin" || role === "super_admin";

  const userName = session?.user?.name || "";
  const userEmail = session?.user?.email || "";
  const initials = userName.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();

  // Branding
  const [brandingForm, setBrandingForm] = useState({ logoUrl: "", displayName: "" });
  // Company details printed on invoices, quotes and purchase orders.
  const [companyForm, setCompanyForm] = useState<Record<string, string>>({});
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);

  // Date format
  const [dateFormat, setDateFormat] = useState("DD MMM YYYY");
  const [savingDateFormat, setSavingDateFormat] = useState(false);

  // Portal settings
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [savingPortal, setSavingPortal] = useState(false);

  // Currency picker
  const [currency, setCurrency] = useState(orgSettings?.currency || "EUR");
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const [savingCurrency, setSavingCurrency] = useState(false);
  const currencyRef = useRef<HTMLDivElement>(null);

  const ALL_CURRENCIES = [
    { value: "USD", symbol: "$",  name: "US Dollar" },
    { value: "EUR", symbol: "€",  name: "Euro" },
    { value: "GBP", symbol: "£",  name: "British Pound" },
    { value: "CAD", symbol: "CA$", name: "Canadian Dollar" },
    { value: "AUD", symbol: "A$", name: "Australian Dollar" },
    { value: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
    { value: "SGD", symbol: "S$", name: "Singapore Dollar" },
    { value: "CHF", symbol: "CHF", name: "Swiss Franc" },
    { value: "NOK", symbol: "kr", name: "Norwegian Krone" },
    { value: "SEK", symbol: "kr", name: "Swedish Krona" },
    { value: "DKK", symbol: "kr", name: "Danish Krone" },
    { value: "ZAR", symbol: "R",  name: "South African Rand" },
    { value: "AED", symbol: "د.إ", name: "UAE Dirham" },
    { value: "INR", symbol: "₹",  name: "Indian Rupee" },
    { value: "JPY", symbol: "¥",  name: "Japanese Yen" },
    { value: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
    { value: "MXN", symbol: "MX$", name: "Mexican Peso" },
    { value: "BRL", symbol: "R$", name: "Brazilian Real" },
    { value: "PLN", symbol: "zł", name: "Polish Złoty" },
    { value: "CZK", symbol: "Kč", name: "Czech Koruna" },
    { value: "HUF", symbol: "Ft", name: "Hungarian Forint" },
    { value: "RON", symbol: "lei", name: "Romanian Leu" },
    { value: "TRY", symbol: "₺",  name: "Turkish Lira" },
    { value: "ILS", symbol: "₪",  name: "Israeli Shekel" },
    { value: "THB", symbol: "฿",  name: "Thai Baht" },
    { value: "MYR", symbol: "RM", name: "Malaysian Ringgit" },
    { value: "IDR", symbol: "Rp", name: "Indonesian Rupiah" },
    { value: "PHP", symbol: "₱",  name: "Philippine Peso" },
    { value: "NGN", symbol: "₦",  name: "Nigerian Naira" },
    { value: "KES", symbol: "KSh", name: "Kenyan Shilling" },
    { value: "GHS", symbol: "GH₵", name: "Ghanaian Cedi" },
    { value: "PKR", symbol: "₨",  name: "Pakistani Rupee" },
    { value: "BDT", symbol: "৳",  name: "Bangladeshi Taka" },
    { value: "EGP", symbol: "£",  name: "Egyptian Pound" },
    { value: "UAH", symbol: "₴",  name: "Ukrainian Hryvnia" },
    { value: "VND", symbol: "₫",  name: "Vietnamese Dong" },
  ];



  useEffect(() => {
    if (orgSettings) {
      setBrandingForm({ logoUrl: orgSettings.logoUrl || "", displayName: orgSettings.displayName || "" });
      setCompanyForm(Object.fromEntries(
        Object.entries((orgSettings as any).company ?? {}).map(([k, v]) => [k, (v as any) ?? ""]),
      ));
      setDateFormat(orgSettings.dateFormat || "DD MMM YYYY");
      setShowPaymentHistory(orgSettings.showPaymentHistory ?? false);
    }
  }, [orgSettings]);

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200 mb-3 transition-colors"
        >
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-white tracking-tight">Company</h1>
        <p className="text-sm text-stone-400 mt-1">Profile, branding and date preferences.</p>
      </div>

      {/* Profile — read-only */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <User size={16} className="text-stone-400" />
          <h3 className="text-sm font-semibold text-white">Your profile</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-stone-600 to-stone-800 flex items-center justify-center text-white text-lg font-semibold">
            {initials}
          </div>
          <div className="flex-1">
            <div className="text-base font-medium text-white">{userName}</div>
            <div className="text-sm text-stone-400">{userEmail}</div>
            <div className="mt-1">
              <Badge variant={isAdmin ? "purple" : "neutral"} size="sm">
                {(session?.user as any)?.role || "User"}
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* Two-factor auth (super admins only — self-gates) */}
      <div className="mb-4">
        <MfaCard />
      </div>

      {/* Organisation branding */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Palette size={16} className="text-stone-400" />
            <h3 className="text-sm font-semibold text-white">Organisation branding</h3>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  Display name
                </label>
                <input
                  value={brandingForm.displayName}
                  onChange={e => setBrandingForm(p => ({ ...p, displayName: e.target.value }))}
                  placeholder={orgSettings?.name || "Company name shown in sidebar"}
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
                <p className="text-[11px] text-stone-400 mt-1">Override the sidebar company name.</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  Logo
                </label>
                <div className="flex items-center gap-2">
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.currentTarget.value = ""; }}
                  />
                  <button
                    type="button"
                    onClick={() => logoFileRef.current?.click()}
                    disabled={uploadingLogo}
                    className="h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 hover:ring-stone-500 inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <Upload size={14} /> {uploadingLogo ? "Uploading…" : "Upload logo"}
                  </button>
                  {brandingForm.logoUrl && (
                    <button
                      type="button"
                      onClick={async () => { setBrandingForm(p => ({ ...p, logoUrl: "" })); await updateOrgSettings({ logoUrl: null }); toast?.("Logo removed"); }}
                      className="text-[12px] text-stone-500 hover:text-rose-400 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  value={brandingForm.logoUrl}
                  onChange={e => setBrandingForm(p => ({ ...p, logoUrl: e.target.value }))}
                  placeholder="…or paste a logo URL"
                  className="w-full h-9 px-3 mt-2 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
                <p className="text-[11px] text-stone-400 mt-1">PNG, JPG or SVG · up to 4 MB. Used on statements and in the sidebar.</p>
              </div>
            </div>

            {brandingForm.logoUrl && (
              <div className="flex items-center gap-3 p-3 bg-stone-800 rounded-md ring-1 ring-stone-700">
                <img
                  src={brandingForm.logoUrl}
                  alt="Logo preview"
                  className="w-10 h-10 object-contain rounded"
                  onError={e => (e.currentTarget.style.display = "none")}
                />
                <div>
                  <div className="text-sm font-semibold text-white">
                    {brandingForm.displayName || orgSettings?.name || "Company name"}
                  </div>
                  <div className="text-[10px] text-stone-500 tracking-wide">COLLECTIONS CRM</div>
                </div>
                <span className="ml-auto text-[11px] text-stone-400">Sidebar preview</span>
              </div>
            )}

            <Button
              size="sm"
              disabled={savingBranding}
              onClick={async () => {
                setSavingBranding(true);
                try {
                  await updateOrgSettings({
                    logoUrl: brandingForm.logoUrl || null,
                    displayName: brandingForm.displayName || null,
                  });
                } finally {
                  setSavingBranding(false);
                }
              }}
            >
              {savingBranding ? "Saving…" : "Save branding"}
            </Button>
          </div>
        </Card>
      )}

      {/* Company details printed on documents */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText size={16} className="text-stone-400" />
            <h3 className="text-sm font-semibold text-white">Document details</h3>
          </div>
          <p className="text-[12px] text-stone-500 mb-4">
            Printed on every invoice, quote and purchase order you send. Blank fields are simply left off the
            document, so fill in whatever applies to your business.
          </p>

          {(() => {
            const set = (k: string) => (e: any) => setCompanyForm(p => ({ ...p, [k]: e.target.value }));
            const inputCls = "w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-[13px] text-stone-100 placeholder-stone-600 focus:outline-none focus:border-stone-500";
            const Lbl = ({ children }: { children: any }) => (
              <label className="block text-[11px] font-medium text-stone-400 mb-1">{children}</label>
            );
            const Txt = ({ k, label, ph, wide }: { k: string; label: string; ph?: string; wide?: boolean }) => (
              <div className={wide ? "sm:col-span-2" : ""}>
                <Lbl>{label}</Lbl>
                <input value={companyForm[k] ?? ""} onChange={set(k)} placeholder={ph} className={inputCls} />
              </div>
            );
            return (
              <div className="space-y-5">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Registered address</div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Txt k="addressStreet" label="Street" ph="Plot 42, Korangi Industrial Area" wide />
                    <Txt k="addressLine2" label="Line 2" wide />
                    <Txt k="addressCity" label="City" />
                    <Txt k="addressState" label="State / Province" />
                    <Txt k="addressPostcode" label="Postal code" />
                    <Txt k="addressCountry" label="Country" />
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Contact &amp; registration</div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Txt k="phone" label="Phone" />
                    <Txt k="email" label="Email" ph="accounts@yourcompany.com" />
                    <Txt k="website" label="Website" />
                    <Txt k="taxNumber" label="Tax registration no." ph="VAT / GST / NTN" />
                    <Txt k="registrationNumber" label="Company registration no." />
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Payment details</div>
                  <p className="text-[11px] text-stone-600 mb-2">
                    Shown on documents where you&apos;re owed money, so customers can pay without asking.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Txt k="bankName" label="Bank" />
                    <Txt k="bankBranch" label="Branch" />
                    <Txt k="bankAccountName" label="Account name" />
                    <Txt k="bankAccountNumber" label="Account number" />
                    <Txt k="bankIban" label="IBAN" />
                    <Txt k="bankSwift" label="SWIFT / BIC" />
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Accent colour</div>
                  <p className="text-[11px] text-stone-600 mb-2">
                    Used for the document title, the table header and the total block. One accent against black
                    text on white is what keeps a printed document looking professional.
                  </p>
                  <div className="flex items-center gap-3">
                    <input type="color" value={companyForm.documentAccentColor || "#1F3A5F"}
                      onChange={set("documentAccentColor")}
                      className="w-12 h-9 rounded border border-stone-700 bg-stone-900 p-1 cursor-pointer" />
                    <input value={companyForm.documentAccentColor || ""} onChange={set("documentAccentColor")}
                      placeholder="#1F3A5F" className={`${inputCls} max-w-[140px] font-mono`} />
                    {["#1F3A5F", "#0F766E", "#7C2D12", "#3730A3", "#111827"].map(c => (
                      <button key={c} type="button" onClick={() => setCompanyForm(p => ({ ...p, documentAccentColor: c }))}
                        title={c} style={{ background: c }}
                        className="w-6 h-6 rounded-full border border-stone-600 hover:scale-110 transition-transform" />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Standard wording</div>
                  <div className="space-y-3">
                    <div>
                      <Lbl>Terms &amp; conditions</Lbl>
                      <textarea rows={3} value={companyForm.documentTerms ?? ""} onChange={set("documentTerms")}
                        placeholder="Payment due within 30 days of invoice date."
                        className={inputCls} />
                    </div>
                    <div>
                      <Lbl>Footer note</Lbl>
                      <input value={companyForm.documentFooter ?? ""} onChange={set("documentFooter")}
                        placeholder="Thank you for your business." className={inputCls} />
                    </div>
                  </div>
                </div>

                <Button
                  size="sm"
                  disabled={savingCompany}
                  onClick={async () => {
                    setSavingCompany(true);
                    try {
                      await updateOrgSettings({ company: companyForm });
                      toast?.("Document details saved");
                    } finally {
                      setSavingCompany(false);
                    }
                  }}
                >
                  {savingCompany ? "Saving…" : "Save document details"}
                </Button>
              </div>
            );
          })()}
        </Card>
      )}

      {/* Date format */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={16} className="text-stone-400" />
            <h3 className="text-sm font-semibold text-white">Date format</h3>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "DD MMM YYYY",  label: "07 May 2026",  desc: "DD MMM YYYY" },
                { value: "DD/MM/YYYY",   label: "07/05/2026",   desc: "DD/MM/YYYY" },
                { value: "MM/DD/YYYY",   label: "05/07/2026",   desc: "MM/DD/YYYY" },
                { value: "YYYY-MM-DD",   label: "2026-05-07",   desc: "YYYY-MM-DD" },
                { value: "MMM DD, YYYY", label: "May 07, 2026", desc: "MMM DD, YYYY" },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDateFormat(opt.value)}
                  className={`px-3 py-2 rounded-md text-left text-sm border transition-colors ${
                    dateFormat === opt.value
                      ? "bg-emerald-600/20 text-white border-emerald-500"
                      : "bg-stone-800 text-stone-300 border-stone-700 hover:border-stone-500"
                  }`}
                >
                  <div className="font-medium font-mono">{opt.label}</div>
                  <div className={`text-[10px] ${dateFormat === opt.value ? "text-stone-300" : "text-stone-400"}`}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={savingDateFormat}
              onClick={async () => {
                setSavingDateFormat(true);
                try {
                  await updateOrgSettings({ dateFormat });
                } finally {
                  setSavingDateFormat(false);
                }
              }}
            >
              {savingDateFormat ? "Saving…" : "Save date format"}
            </Button>
          </div>
        </Card>
      )}

      {/* Customer Portal settings */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <LayoutDashboard size={16} className="text-stone-400" />
            <h3 className="text-sm font-semibold text-white">Customer portal</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="text-sm font-medium text-white">Show payment history tab</div>
                <p className="text-[12px] text-stone-400 mt-0.5">
                  When enabled, customers can see all their paid invoices in a separate tab on the portal.
                  Useful for transparency and reducing "did you receive my payment?" queries.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={showPaymentHistory}
                onClick={() => setShowPaymentHistory(v => !v)}
                className={`relative shrink-0 mt-0.5 w-10 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-stone-900 ${showPaymentHistory ? "bg-emerald-600" : "bg-stone-700"}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${showPaymentHistory ? "translate-x-4" : ""}`} />
              </button>
            </div>
            <Button
              size="sm"
              disabled={savingPortal}
              onClick={async () => {
                setSavingPortal(true);
                try {
                  await updateOrgSettings({ showPaymentHistory });
                } finally {
                  setSavingPortal(false);
                }
              }}
            >
              {savingPortal ? "Saving…" : "Save portal settings"}
            </Button>
          </div>
        </Card>
      )}

      {/* Home currency setting removed — amounts now shown in native invoice currency from QBO/Xero */}
      {false && isAdmin && (
        <Card className="mb-4">
          <div className="space-y-3">
            {/* Searchable currency picker */}
            <div ref={currencyRef} className="relative">
              {/* Trigger */}
              <button
                onClick={() => { setCurrencyOpen(o => !o); setCurrencySearch(""); }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-md ring-1 ring-stone-700 bg-stone-800 text-sm text-white hover:ring-stone-500 transition-colors"
              >
                <span className="flex items-center gap-2">
                  {(() => {
                    const c = ALL_CURRENCIES.find(c => c.value === currency);
                    return c ? (
                      <>
                        <span className="font-mono font-semibold text-emerald-400">{c.value}</span>
                        <span className="text-stone-300">{c.symbol}</span>
                        <span className="text-stone-400">{c.name}</span>
                      </>
                    ) : <span className="text-stone-500">Select currency…</span>;
                  })()}
                </span>
                <ChevronDown size={14} className={`text-stone-500 transition-transform ${currencyOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Dropdown */}
              {currencyOpen && (
                <div className="absolute z-50 mt-1 w-full bg-stone-900 rounded-lg ring-1 ring-stone-700 shadow-2xl overflow-hidden">
                  {/* Search */}
                  <div className="p-2 border-b border-stone-800">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-stone-800 ring-1 ring-stone-700">
                      <Search size={13} className="text-stone-500 shrink-0" />
                      <input
                        autoFocus
                        value={currencySearch}
                        onChange={e => setCurrencySearch(e.target.value)}
                        placeholder="Search currency code or name…"
                        className="flex-1 bg-transparent text-sm text-white placeholder-stone-500 outline-none"
                      />
                    </div>
                  </div>
                  {/* List */}
                  <div className="max-h-64 overflow-y-auto">
                    {ALL_CURRENCIES
                      .filter(c => {
                        const q = currencySearch.toLowerCase();
                        return c.value.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
                      })
                      .map(c => (
                        <button
                          key={c.value}
                          onClick={() => { setCurrency(c.value); setCurrencyOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-stone-800 transition-colors ${
                            currency === c.value ? "bg-emerald-600/10" : ""
                          }`}
                        >
                          <span className="w-10 font-mono font-semibold text-[13px] text-emerald-400 shrink-0">{c.value}</span>
                          <span className="w-6 text-stone-400 text-[13px] shrink-0">{c.symbol}</span>
                          <span className="text-[13px] text-stone-300 flex-1">{c.name}</span>
                          {currency === c.value && <Check size={13} className="text-emerald-400 shrink-0" />}
                        </button>
                      ))}
                    {ALL_CURRENCIES.filter(c => {
                      const q = currencySearch.toLowerCase();
                      return c.value.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
                    }).length === 0 && (
                      <div className="px-4 py-6 text-center text-sm text-stone-500">No currencies match "{currencySearch}"</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Button
              size="sm"
              disabled={savingCurrency}
              onClick={async () => {
                setSavingCurrency(true);
                try {
                  await updateOrgSettings({ currency });
                } finally {
                  setSavingCurrency(false);
                }
              }}
            >
              {savingCurrency ? "Saving…" : "Save currency"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
