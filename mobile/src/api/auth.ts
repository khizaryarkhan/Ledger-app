import { api } from "./client";
import type { Org } from "./types";

export type LoginResult =
  | { needsOrgSelection: false; accessToken: string; refreshToken: string; org: Org; role: string; user: { id: string; email: string; name: string } }
  | { needsOrgSelection: true; preAuthToken: string; orgs: Org[]; user: { id: string; email: string; name: string } };

export function login(email: string, password: string, mfaCode?: string) {
  return api.post<any>("/api/mobile/auth/login", { email, password, mfaCode }, { skipAuth: true }).then((data) => {
    if (data.preAuthToken) return { needsOrgSelection: true, ...data } as LoginResult;
    return { needsOrgSelection: false, ...data } as LoginResult;
  });
}

export function selectOrg(preAuthToken: string, orgId: string) {
  return api.post<{ accessToken: string; refreshToken: string; role: string; orgId: string; user: { id: string; email: string; name: string } }>(
    "/api/mobile/auth/select-org", { preAuthToken, orgId }, { skipAuth: true },
  );
}

export function me() {
  return api.get<{ user: { id: string; email: string; name: string }; org: Org; role: string }>("/api/mobile/me");
}
