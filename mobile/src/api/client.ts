import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "../config";

const ACCESS_KEY = "pax_access_token";
const REFRESH_KEY = "pax_refresh_token";

export async function getStoredTokens() {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  return { accessToken, refreshToken };
}

export async function storeTokens(accessToken: string, refreshToken: string) {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
  ]);
}

export async function clearTokens() {
  await Promise.all([SecureStore.deleteItemAsync(ACCESS_KEY), SecureStore.deleteItemAsync(REFRESH_KEY)]);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refreshToken } = await getStoredTokens();
    if (!refreshToken) return null;
    const res = await fetch(`${API_BASE_URL}/api/mobile/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      await clearTokens();
      return null;
    }
    const data = await res.json();
    await storeTokens(data.accessToken, data.refreshToken);
    return data.accessToken as string;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

/** Fires when a refresh fails and the user must sign in again. Set by AuthContext. */
export let onSessionExpired: (() => void) | null = null;
export function setOnSessionExpired(cb: (() => void) | null) {
  onSessionExpired = cb;
}

async function request<T>(path: string, init: RequestInit = {}, opts: { skipAuth?: boolean; retried?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as any) };

  if (!opts.skipAuth) {
    const { accessToken } = await getStoredTokens();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (res.status === 401 && !opts.skipAuth && !opts.retried) {
    const newToken = await refreshAccessToken();
    if (newToken) return request<T>(path, init, { ...opts, retried: true });
    onSessionExpired?.();
    throw new ApiError(401, "Session expired, please sign in again");
  }

  let body: any = null;
  try { body = await res.json(); } catch { /* empty body, e.g. some 204s */ }

  if (!res.ok) throw new ApiError(res.status, body?.error || `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body: unknown, opts?: { skipAuth?: boolean }) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }, opts),
};
