/**
 * POST /api/batch/upload/validate
 * JSON body: { entity, operation, mapping, overrides, rawRows }
 *
 * Pre-flight dry run: builds each document's QBO payload WITHOUT sending it, so
 * missing references / required fields surface as errors up front. Also flags
 * documents whose reference number already exists in QuickBooks (duplicate
 * guard). No records are created.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { normalizeRows, groupDocs, ensureIdentityMapping } from "@/lib/batch/engine";
import { getOrgQboToken } from "@/lib/qbo-token";
import { RefResolver } from "@/lib/batch/ref-resolver";
import { preloadPaymentApplicationIds } from "@/lib/batch/builders";
import { qboQueryAll } from "@/lib/batch/qbo-client";
import { detectProvider } from "@/lib/batch/provider";
import { getXeroEntity } from "@/lib/batch/xero/registry";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON body");

  // Large-file path (see blob-token/route.ts and preview/route.ts): the
  // request body's own ~4.5 MB ceiling means a big enough import can't
  // inline rawRows at all — fetch from Blob storage instead, an outbound
  // call not subject to that inbound limit.
  let resolvedRawRows: any[] = Array.isArray(body.rawRows) ? body.rawRows : [];
  if (resolvedRawRows.length === 0 && body.rawRowsBlobUrl) {
    const fileRes = await fetch(String(body.rawRowsBlobUrl)).catch(() => null);
    if (!fileRes || !fileRes.ok) return bad("Could not read the uploaded file — try again.", 502);
    const fileJson = await fileRes.json().catch(() => null);
    resolvedRawRows = Array.isArray(fileJson?.rows) ? fileJson.rows : [];
  }

  const mappingIn: Record<string, string> = body.mapping || {};
  const overridesIn: Record<string, Record<string, string>> = body.overrides || {};
  const rawRowsIn: any[] = resolvedRawRows;

  // ── Xero: build dry-run (no create), no duplicate query ──
  if ((await detectProvider(orgId!)) === "xero") {
    const xe = getXeroEntity(String(body.entity || ""));
    if (!xe || !xe.build) return bad("Unknown entity", 404);
    if (rawRowsIn.length === 0) return bad("No rows to validate");
    const norm = normalizeRows(rawRowsIn, mappingIn);
    for (const row of norm) for (const [col, map] of Object.entries(overridesIn)) { const cur = row[col]; if (cur != null && map[String(cur)] != null) row[col] = map[String(cur)]; }
    const xdocs = groupDocs(norm, xe);
    const errs: any[] = [];
    xdocs.forEach((d, i) => { try { xe.build!(d); } catch (e: any) { errs.push({ row: i + 1, ref: d.key, error: e?.message || "Invalid" }); } });
    return ok({ total: xdocs.length, valid: xdocs.length - errs.length, errorCount: errs.length, duplicateCount: 0, errors: errs, duplicates: [] });
  }

  const entity = getEntity(String(body.entity || ""));
  if (!entity || !entity.build) return bad("Unknown entity", 404);

  const operation: "upload" | "modify" = body.operation === "modify" ? "modify" : "upload";
  const overrides: Record<string, Record<string, string>> = body.overrides || {};
  const rawRows: any[] = resolvedRawRows;
  if (rawRows.length === 0) return bad("No rows to validate");
  // Update needs the record's identity columns (Id/SyncToken). Those aren't
  // "data" columns so the auto-mapping (app/api/batch/upload/preview) drops
  // them — chunk-runner.ts and commit-runner.ts both already restore them
  // before building; this dry-run route never did, so every modify
  // validation would have failed every single row with a false "needs an
  // Id column", the moment the Update screen actually started calling it.
  const mapping: Record<string, string> = operation === "modify" && rawRows[0]
    ? ensureIdentityMapping(body.mapping || {}, rawRows[0])
    : (body.mapping || {});

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return bad("QuickBooks is not connected for this organisation", 400);

  const normalized = normalizeRows(rawRows, mapping);
  for (const row of normalized)
    for (const [col, map] of Object.entries(overrides)) {
      const cur = row[col];
      if (cur != null && map[String(cur)] != null) row[col] = map[String(cur)];
    }
  const docs = groupDocs(normalized, entity);

  const resolver = new RefResolver(token);
  if (entity.refs?.length) {
    // preloadOrThrow, not preload: a transient list-fetch failure here would
    // otherwise silently poison every single row's validation with a false
    // "not found" — see ref-resolver.ts's docstring. This route has no outer
    // try/catch (unlike chunk-runner.ts/commit-runner.ts), so catch it here
    // and return a clean, honest error instead of a raw 500.
    try {
      await resolver.preloadOrThrow(entity.refs);
    } catch (e: any) {
      return bad(e?.message || "Could not load reference lists from QuickBooks — try again shortly", 502);
    }
  }
  await preloadPaymentApplicationIds(entity.id, docs, resolver);

  const refCol = entity.refNumberColumn ? entity.refNumberColumn.trim() : null;
  const errors: { row: number; ref: string; error: string }[] = [];
  const okDocs: { row: number; ref: string; number: string | null }[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const ref = refCol ? String(doc.rows[0][refCol] ?? "") : doc.key;
    try {
      await entity.build(doc, resolver);
      if (operation === "modify") {
        const id = doc.rows[0]["Id"] ?? doc.rows[0]["QBO Id"];
        if (!id) throw new Error("Update needs an 'Id' column");
      }
      okDocs.push({ row: i + 1, ref, number: refCol ? (doc.rows[0][refCol] ?? null) : null });
    } catch (e: any) {
      errors.push({ row: i + 1, ref, error: e?.message || "Invalid" });
    }
  }

  // Duplicate guard (create only): flag reference numbers that already exist.
  const duplicates: { row: number; ref: string }[] = [];
  if (operation === "upload" && entity.qboReadName && entity.qboRefNumberField) {
    const numbers = [...new Set(okDocs.map((d) => d.number).filter((n): n is string => n != null && String(n).trim() !== "").map(String))];
    const existing = new Set<string>();
    for (let i = 0; i < numbers.length; i += 40) {
      const chunk = numbers.slice(i, i + 40).map((n) => `'${n.replace(/'/g, "\\'")}'`).join(",");
      const extra = entity.qboExtraWhere ? `${entity.qboExtraWhere} AND ` : "";
      try {
        let recs = await qboQueryAll(token, entity.qboReadName, `${extra}${entity.qboRefNumberField} IN (${chunk})`);
        if (entity.qboClientFilter) recs = recs.filter(entity.qboClientFilter);
        for (const r of recs) {
          const v = r.DocNumber ?? r.DisplayName ?? r.Name;
          if (v) existing.add(String(v));
        }
      } catch { /* ignore — dedup is best-effort */ }
    }
    for (const d of okDocs) {
      if (d.number != null && existing.has(String(d.number))) duplicates.push({ row: d.row, ref: d.ref });
    }
  }

  return ok({
    total: docs.length,
    valid: okDocs.length - duplicates.length,
    errorCount: errors.length,
    duplicateCount: duplicates.length,
    errors,
    duplicates,
  });
}
