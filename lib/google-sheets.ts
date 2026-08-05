/**
 * Google Sheets helpers — token refresh + reading a sheet's values.
 * Separate connection from Gmail (scope spreadsheets.readonly). Reuses the same
 * Google OAuth app credentials (GMAIL_CLIENT_ID/SECRET).
 */

import { db } from "@/db";
import { googleSheetsTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/userinfo.email";

export async function getValidSheetsToken(orgId: string): Promise<{ accessToken: string; email: string } | null> {
  const [token] = await db.select().from(googleSheetsTokens).where(eq(googleSheetsTokens.orgId, orgId)).limit(1);
  if (!token) return null;

  const refreshToken = decryptSecret(token.refreshToken)!;
  const accessToken = decryptSecret(token.accessToken)!;
  const now = Date.now();

  if (new Date(token.accessTokenExpiresAt).getTime() - now < 5 * 60 * 1000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await db.update(googleSheetsTokens).set({
        accessToken: encryptSecret(data.access_token)!,
        accessTokenExpiresAt: new Date(now + (data.expires_in || 3600) * 1000),
        updatedAt: new Date(),
      }).where(eq(googleSheetsTokens.id, token.id));
      return { accessToken: data.access_token, email: token.email };
    }
  }
  return { accessToken, email: token.email };
}

/** Extract a spreadsheet id from a full Google Sheets URL or a raw id. */
export function parseSpreadsheetId(input: string): string {
  const m = String(input).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(input).trim();
}

export interface SheetData { headers: string[]; rows: Record<string, any>[]; }

/**
 * Read a sheet's values (first row = headers) via the Sheets API.
 * `range` is a tab name ("Sheet1") or an A1 range ("Sheet1!A1:Z1000").
 */
export async function fetchSheetValues(accessToken: string, spreadsheetId: string, range: string): Promise<SheetData> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Google Sheets read failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  const values: any[][] = data.values || [];
  if (values.length === 0) return { headers: [], rows: [] };

  const headers = (values[0] || []).map((h) => String(h ?? "").trim());
  const rows: Record<string, any>[] = [];
  for (let i = 1; i < values.length; i++) {
    const arr = values[i] || [];
    if (arr.every((c) => c == null || c === "")) continue;
    const row: Record<string, any> = {};
    headers.forEach((h, idx) => { if (h) row[h] = arr[idx]; });
    rows.push(row);
  }
  return { headers, rows };
}
