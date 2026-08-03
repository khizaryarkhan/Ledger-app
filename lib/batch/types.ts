/**
 * Shared types for the Batch Functions engine.
 */

import type { RefResolver, RefKind } from "./ref-resolver";

export type BatchGroup = "customer" | "vendor" | "other" | "list";

export interface BatchSupport {
  upload: boolean;
  download: boolean;
  delete: boolean;
  modify: boolean;
}

/** A row keyed by template column header → cell value. */
export type SheetRow = Record<string, any>;

/** One logical document = the header row + all its line rows (grouped by docKey). */
export interface GroupedDoc {
  key: string;
  rows: SheetRow[];   // 1..n rows that share the same docKey
}

export interface BuildResult {
  payload: any;
  /** Existing QBO Id for modify/delete flows, when present in the sheet. */
  qboId?: string;
}

export interface BatchEntity {
  id: string;                 // stable slug, e.g. "invoice"
  label: string;              // display, e.g. "Invoices"
  group: BatchGroup;
  /** Lowercase QBO API path segment for create/update/delete (e.g. "invoice"). */
  qboEntity?: string;
  /** QBO query entity name (e.g. "Invoice"). */
  qboReadName?: string;
  supports: BatchSupport;
  /** Template column headers, in order. */
  columns: string[];
  /** Header column that groups multiple line rows into one document (line-item docs only). */
  docKey?: string;
  /** Column holding an existing QBO Id (used by Download/Modify round-trips). */
  idColumn?: string;
  /** Column used for date-range filters in Download/Delete. */
  dateColumn?: string;
  /** QBO field name for date filtering (e.g. "TxnDate", "MetaData.CreateTime"). */
  qboDateField?: string;
  /** Column used for reference-number lookups in Delete-by-reference. */
  refNumberColumn?: string;
  /** QBO field for reference-number filtering (e.g. "DocNumber"). */
  qboRefNumberField?: string;
  /** Always-applied WHERE clause — disambiguates entities that share a QBO read
   * name (e.g. Expense/Check/CreditCardCredit all query "Purchase"). */
  qboExtraWhere?: string;
  /** List types to preload for name→Ref resolution (upload). */
  refs?: RefKind[];
  /** List types to preload for id→name resolution (download/sample). */
  reverseRefs?: RefKind[];
  /** Note shown in the UI when a capability is limited/unsupported. */
  note?: string;
  /** Builds a QBO create/update payload from one grouped document. */
  build?: (doc: GroupedDoc, refs: RefResolver) => Promise<BuildResult>;
  /** Maps a QBO record back to one-or-more flat template rows (Download / Sample). */
  toRows?: (record: any, refs: RefResolver) => Promise<SheetRow[]>;
}
