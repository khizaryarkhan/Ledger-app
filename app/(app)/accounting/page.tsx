import { redirect } from "next/navigation";

// Accounting workspace lands on the first Master Data list. The left panel
// (sidebar) drives which list is shown via /accounting/<list>.
export default function AccountingHome() {
  redirect("/accounting/accounts");
}
