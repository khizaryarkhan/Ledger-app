import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { getStoredTokens, storeTokens, clearTokens, setOnSessionExpired } from "../api/client";
import { login as apiLogin, selectOrg as apiSelectOrg, me as apiMe } from "../api/auth";
import type { Org } from "../api/types";

type AuthUser = { id: string; email: string; name: string };

type AuthState =
  | { status: "loading" }
  | { status: "signedOut"; error?: string }
  | { status: "orgSelection"; preAuthToken: string; orgs: Org[]; user: AuthUser }
  | { status: "signedIn"; user: AuthUser; org: Org; role: string };

type AuthContextValue = {
  state: AuthState;
  submitLogin: (email: string, password: string, mfaCode?: string) => Promise<void>;
  submitOrgSelection: (orgId: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const signOut = useCallback(async () => {
    await clearTokens();
    setState({ status: "signedOut" });
  }, []);

  useEffect(() => {
    setOnSessionExpired(() => setState({ status: "signedOut", error: "Your session expired — please sign in again." }));
    (async () => {
      const { accessToken } = await getStoredTokens();
      if (!accessToken) {
        setState({ status: "signedOut" });
        return;
      }
      try {
        const data = await apiMe();
        setState({ status: "signedIn", user: data.user, org: data.org, role: data.role });
      } catch {
        setState({ status: "signedOut" });
      }
    })();
    return () => setOnSessionExpired(null);
  }, []);

  const submitLogin = useCallback(async (email: string, password: string, mfaCode?: string) => {
    const result = await apiLogin(email, password, mfaCode);
    if (result.needsOrgSelection) {
      setState({ status: "orgSelection", preAuthToken: result.preAuthToken, orgs: result.orgs, user: result.user });
    } else {
      await storeTokens(result.accessToken, result.refreshToken);
      setState({ status: "signedIn", user: result.user, org: result.org, role: result.role });
    }
  }, []);

  const submitOrgSelection = useCallback(async (orgId: string) => {
    if (state.status !== "orgSelection") return;
    const result = await apiSelectOrg(state.preAuthToken, orgId);
    await storeTokens(result.accessToken, result.refreshToken);
    const org = state.orgs.find((o) => o.id === orgId)!;
    setState({ status: "signedIn", user: result.user, org, role: result.role });
  }, [state]);

  const value = useMemo(() => ({ state, submitLogin, submitOrgSelection, signOut }), [state, submitLogin, submitOrgSelection, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
