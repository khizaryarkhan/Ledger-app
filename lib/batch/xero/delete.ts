/**
 * Xero delete — semantics differ per entity:
 *  - transactions (invoices/bills/credit notes): set Status DELETED (drafts).
 *    Authorised documents can't be deleted via the API and must be voided in
 *    Xero; those return an error the caller reports.
 *  - contacts: ARCHIVED (Xero has no hard contact delete).
 *  - items/accounts: HTTP DELETE.
 */

import type { OrgXeroToken } from "@/lib/xero-token";
import type { XeroEntity } from "./registry";
import { xeroPost, xeroHttpDelete, type XeroResult } from "./client";

export async function deleteXeroRecord(token: OrgXeroToken, entity: XeroEntity, id: string): Promise<XeroResult> {
  switch (entity.deleteVia) {
    case "http":
      return xeroHttpDelete(token, entity.xeroEntity, id);
    case "archive":
      return xeroPost(token, entity.xeroEntity, { ContactID: id, ContactStatus: "ARCHIVED" });
    case "status":
      return xeroPost(token, entity.xeroEntity, { [entity.xeroIdKey || "ID"]: id, Status: "DELETED" });
    default:
      return { ok: false, error: "This entity can't be deleted via the API" };
  }
}
