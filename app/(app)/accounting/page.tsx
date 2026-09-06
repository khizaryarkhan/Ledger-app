import { redirect } from "next/navigation";

// Accounting workspace lands on the Accounting Dashboard (matching
// Receivables/Payables, which both land on their own dashboard). The left
// panel (sidebar) drives which list is shown via /accounting/<list> from there.
export default function AccountingHome() {
  redirect("/accounting/dashboard");
}
