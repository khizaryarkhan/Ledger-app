"use client";

import { useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function LoginForm({ brandName, brandLogo }: { brandName: string; brandLogo: string | null }) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const mfaRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showMfa, setShowMfa] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const email = (emailRef.current?.value ?? "").trim();
    const password = passwordRef.current?.value ?? "";
    const mfaCode = (mfaRef.current?.value ?? "").trim();
    try {
      const res = await signIn("credentials", { email, password, mfaCode, redirect: false });
      if (res?.error) {
        setError(showMfa
          ? "Invalid email, password, or authentication code"
          : "Invalid email or password");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-950 p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-emerald-500/5 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          {brandLogo ? (
            <img src={brandLogo} alt={brandName} className="inline-flex w-10 h-10 rounded-xl object-contain mb-4" />
          ) : (
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500 mb-4">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
          )}
          <h1 className="text-xl font-semibold text-white tracking-tight">{brandName}</h1>
          <p className="text-sm text-stone-500 mt-1">Sign in to your account</p>
        </div>

        <div className="bg-stone-900 rounded-xl border border-stone-800 p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-stone-400 block mb-1.5">Email</label>
              <input ref={emailRef} type="email" required autoComplete="email"
                className="w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-stone-400">Password</label>
                <Link href="/forgot-password" className="text-xs text-stone-500 hover:text-emerald-400 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <input ref={passwordRef} type="password" required autoComplete="current-password"
                className="w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors" />
            </div>
            {showMfa ? (
              <div>
                <label className="text-xs font-medium text-stone-400 block mb-1.5">Authentication code</label>
                <input ref={mfaRef} type="text" inputMode="numeric" autoComplete="one-time-code"
                  placeholder="6-digit code or recovery code"
                  className="w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors" />
              </div>
            ) : (
              <button type="button" onClick={() => setShowMfa(true)}
                className="text-xs text-stone-500 hover:text-emerald-400 transition-colors">
                Have a two-factor code?
              </button>
            )}
            {error && (
              <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">{error}</div>
            )}
            <button type="submit" disabled={loading}
              className="w-full h-10 bg-emerald-500 hover:bg-emerald-400 disabled:bg-stone-700 disabled:text-stone-500 text-white text-sm font-semibold rounded-lg transition-colors">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-stone-600 mt-5">Contact your administrator to get access.</p>
        <p className="text-center text-xs text-stone-700 mt-2">
          <Link href="/" className="hover:text-stone-500 transition-colors">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
