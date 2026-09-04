/**
 * One-off audit (not part of the app): for every Data Studio entity, checks
 * whether each declared column is referenced (as a string literal) inside its
 * `build` and `toRows` function source. This is the mechanical version of the
 * "three things must agree" check CLAUDE.md's Data Studio section calls for
 * (columns / toRows / build) — approximate (string containment, so a column
 * referenced only via a shared variable name wouldn't be caught), but good
 * enough to flag candidates for a manual look rather than eyeballing all ~32
 * entities cold.
 *
 * Run: npx tsx scripts/audit-batch-columns.ts
 */
import { ENTITIES } from "../lib/batch/entities";

const IGNORE_ALWAYS = new Set(["Id", "SyncToken", "QBO Id", "Sync Token"]);

function refsColumn(fnSrc: string, col: string): boolean {
  const c = col.trim();
  // A column may appear with or without its declared trailing space, and
  // some builders/mappers strip it (e.g. row["Class"] vs row["Class "]).
  const variants = new Set([c, col]);
  for (const v of variants) {
    if (fnSrc.includes(`"${v}"`) || fnSrc.includes(`'${v}'`)) return true;
  }
  return false;
}

let anyFound = false;
for (const e of ENTITIES) {
  if (!e.columns || e.columns.length === 0) continue;
  const buildSrc = e.build ? e.build.toString() : "";
  const toRowsSrc = e.toRows ? e.toRows.toString() : "";

  const missingBuild: string[] = [];
  const missingToRows: string[] = [];
  for (const col of e.columns) {
    const c = col.trim();
    if (IGNORE_ALWAYS.has(c)) continue;
    if (e.build && !refsColumn(buildSrc, col)) missingBuild.push(col);
    if (e.toRows && !refsColumn(toRowsSrc, col)) missingToRows.push(col);
  }

  if (missingBuild.length || missingToRows.length) {
    anyFound = true;
    console.log(`\n=== ${e.id} (${e.label}) ===`);
    if (missingBuild.length) console.log(`  build() never references: ${missingBuild.join(", ")}`);
    if (missingToRows.length) console.log(`  toRows() never references: ${missingToRows.join(", ")}`);
  }
}
if (!anyFound) console.log("No candidates found.");
